import * as ts from 'typescript';
import { ComponentInfo, ComponentMethod } from '../class/parseComponent';
import { Diagnostic, warning } from '../diagnostics';

/**
 * Method translation (Stage 2, M3).
 *
 * Component methods are translated statement-by-statement from the
 * TypeScript AST. Two output modes share one walker:
 *  - 'react': `this.field` reads become the bare variable; assignments to
 *    state fields become setter calls (`this.count++` -> `setCount(count + 1)`).
 *  - 'state': `this.field` becomes `state.field` and `this.method()` becomes
 *    `methods.method()` — used by the interactive HTML preview runtime.
 *
 * Anything outside the supported subset yields a METHOD_UNSUPPORTED warning
 * plus a TODO comment at that spot — code is never silently dropped and
 * broken syntax is never emitted.
 */

export type TranslateMode = 'react' | 'state';

export function setterName(field: string): string {
  return 'set' + field.charAt(0).toUpperCase() + field.slice(1);
}

const ASSIGN_OPS = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
]);

/** Parse a method body block once and hand back its statements. */
function bodyStatements(method: ComponentMethod): ts.Statement[] | undefined {
  if (!method.body) return undefined;
  const params = method.params.map((p) => p.name).join(', ');
  const sf = ts.createSourceFile(
    'method.ts',
    `function __m(${params}) ${method.body}`,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );
  let statements: ts.Statement[] | undefined;
  const visit = (node: ts.Node): void => {
    if (statements) return;
    if (ts.isFunctionDeclaration(node) && node.body) statements = [...node.body.statements];
    else ts.forEachChild(node, visit);
  };
  visit(sf);
  return statements;
}

function isThisProperty(node: ts.Node): { name: string } | undefined {
  if (ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword) {
    return { name: node.name.text };
  }
  return undefined;
}

/**
 * First pass: which fields are assigned anywhere inside any method?
 * Those fields become React state (useState) in codegen.
 */
export function analyzeMutatedFields(component: ComponentInfo): Set<string> {
  const fieldNames = new Set(component.fields.map((f) => f.name));
  const mutated = new Set<string>();
  for (const method of component.methodDetails) {
    const statements = bodyStatements(method);
    if (!statements) continue;
    const walk = (node: ts.Node): void => {
      if (ts.isBinaryExpression(node) && ASSIGN_OPS.has(node.operatorToken.kind)) {
        const target = isThisProperty(node.left);
        if (target && fieldNames.has(target.name)) mutated.add(target.name);
      }
      if ((ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
        const target = isThisProperty(node.operand);
        if (target && fieldNames.has(target.name)) mutated.add(target.name);
      }
      ts.forEachChild(node, walk);
    };
    for (const s of statements) walk(s);
  }
  return mutated;
}

interface Ctx {
  mode: TranslateMode;
  fieldNames: Set<string>;
  methodNames: Set<string>;
  stateFields: Set<string>;
  methodName: string;
  diagnostics: Diagnostic[];
  /** Set when the current statement uses an unsupported construct. */
  unsupported?: string;
}

class Translator {
  constructor(private ctx: Ctx) {}

  private fail(what: string): string {
    this.ctx.unsupported = what;
    return 'undefined';
  }

  /** Translate an expression node to code, or mark the statement unsupported. */
  expr(node: ts.Expression): string {
    const c = this.ctx;
    if (ts.isIdentifier(node)) return node.text;
    if (node.kind === ts.SyntaxKind.TrueKeyword) return 'true';
    if (node.kind === ts.SyntaxKind.FalseKeyword) return 'false';
    if (node.kind === ts.SyntaxKind.NullKeyword) return 'null';
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.getText();
    if (ts.isNumericLiteral(node)) return node.text;
    if (ts.isRegularExpressionLiteral(node)) return node.getText();
    if (ts.isPropertyAccessExpression(node)) {
      const self = isThisProperty(node);
      if (self) return this.thisMember(self.name);
      return `${this.expr(node.expression)}.${node.name.text}`;
    }
    if (ts.isElementAccessExpression(node)) {
      return `${this.expr(node.expression)}[${this.expr(node.argumentExpression)}]`;
    }
    if (ts.isCallExpression(node)) {
      const callee = this.expr(node.expression);
      const args = node.arguments.map((a) => this.expr(a)).join(', ');
      return `${callee}(${args})`;
    }
    if (ts.isBinaryExpression(node)) {
      return `${this.expr(node.left)} ${node.operatorToken.getText()} ${this.expr(node.right)}`;
    }
    if (ts.isPrefixUnaryExpression(node)) {
      if (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) {
        const target = isThisProperty(node.operand);
        if (target) {
          const opText = node.operator === ts.SyntaxKind.PlusPlusToken ? '++' : '--';
          if (c.mode === 'state') return `${opText}state.${target.name}`;
          return this.fail(`'${opText}this.${target.name}' inside an expression`);
        }
        return `${node.operator === ts.SyntaxKind.PlusPlusToken ? '++' : '--'}${this.expr(node.operand)}`;
      }
      const op = node.operator === ts.SyntaxKind.ExclamationToken ? '!'
        : node.operator === ts.SyntaxKind.MinusToken ? '-'
        : node.operator === ts.SyntaxKind.PlusToken ? '+'
        : node.operator === ts.SyntaxKind.TildeToken ? '~' : undefined;
      if (op === undefined) return this.fail(`unary operator ${ts.SyntaxKind[node.operator]}`);
      return `${op}${this.expr(node.operand)}`;
    }
    if (ts.isPostfixUnaryExpression(node)) {
      const target = isThisProperty(node.operand);
      const opText = node.operator === ts.SyntaxKind.PlusPlusToken ? '++' : '--';
      if (target) {
        if (c.mode === 'state') return `state.${target.name}${opText}`;
        return this.fail(`'this.${target.name}${opText}' inside an expression`);
      }
      return `${this.expr(node.operand)}${opText}`;
    }
    if (ts.isConditionalExpression(node)) {
      return `(${this.expr(node.condition)} ? ${this.expr(node.whenTrue)} : ${this.expr(node.whenFalse)})`;
    }
    if (ts.isParenthesizedExpression(node)) return `(${this.expr(node.expression)})`;
    if (ts.isTemplateExpression(node)) {
      let out = '`' + node.head.text;
      for (const span of node.templateSpans) {
        out += '${' + this.expr(span.expression) + '}' + span.literal.text;
      }
      return out + '`';
    }
    if (ts.isArrayLiteralExpression(node)) {
      return `[${node.elements.map((e) => this.expr(e)).join(', ')}]`;
    }
    if (ts.isObjectLiteralExpression(node)) {
      const parts: string[] = [];
      for (const prop of node.properties) {
        if (ts.isPropertyAssignment(prop)) parts.push(`${prop.name.getText()}: ${this.expr(prop.initializer)}`);
        else if (ts.isShorthandPropertyAssignment(prop)) parts.push(prop.name.text);
        else if (ts.isSpreadAssignment(prop)) parts.push(`...${this.expr(prop.expression)}`);
        else return this.fail('object literal method/getter');
      }
      return `{ ${parts.join(', ')} }`;
    }
    if (ts.isSpreadElement(node)) return `...${this.expr(node.expression)}`;
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) return this.expr(node.expression);
    if (ts.isNonNullExpression(node)) return this.expr(node.expression);
    if (ts.isArrowFunction(node)) {
      const params = node.parameters.map((p) => p.getText()).join(', ');
      if (ts.isBlock(node.body)) {
        const saved = c.unsupported;
        const lines = this.statements([...node.body.statements], '  ');
        if (c.unsupported) return this.fail(c.unsupported);
        void saved;
        return `(${params}) => {\n${lines.join('\n')}\n}`;
      }
      return `(${params}) => ${this.expr(node.body)}`;
    }
    return this.fail(ts.SyntaxKind[node.kind]);
  }

  private thisMember(name: string): string {
    const c = this.ctx;
    if (c.methodNames.has(name)) return c.mode === 'state' ? `methods.${name}` : name;
    return c.mode === 'state' ? `state.${name}` : name;
  }

  /** Translate a list of statements at the given indent (no leading spaces beyond it). */
  statements(list: ts.Statement[], indent: string): string[] {
    const lines: string[] = [];
    for (const stmt of list) lines.push(...this.statement(stmt, indent));
    return lines;
  }

  private unsupportedLine(indent: string, what: string): string[] {
    this.ctx.diagnostics.push(warning(
      'METHOD_UNSUPPORTED',
      `Method '${this.ctx.methodName}': ${what} is not in the Stage 2 translation subset — left as a TODO`,
      undefined, undefined,
      'Rewrite with the supported subset: this.field assignments (+=, ++, =), this.method() calls, if/else, return, local const/let — or move the unsupported logic out of the method',
    ));
    return [`${indent}/* TODO(Rangular): unsupported in method '${this.ctx.methodName}': ${what} */`];
  }

  private statement(node: ts.Statement, indent: string): string[] {
    const c = this.ctx;
    c.unsupported = undefined;

    if (ts.isBlock(node)) return this.statements([...node.statements], indent);

    if (ts.isExpressionStatement(node)) {
      const e = node.expression;
      // Assignment / update directly on this.field.
      if (ts.isBinaryExpression(e) && ASSIGN_OPS.has(e.operatorToken.kind)) {
        const target = isThisProperty(e.left);
        if (target) {
          if (!c.fieldNames.has(target.name)) {
            return this.unsupportedLine(indent, `assignment to undeclared field 'this.${target.name}'`);
          }
          if (c.mode === 'react' && !c.stateFields.has(target.name)) {
            return this.unsupportedLine(indent, `assignment to field '${target.name}', which was not hoisted to React state`);
          }
          const rhs = this.expr(e.right);
          if (c.unsupported) return this.unsupportedLine(indent, c.unsupported);
          const op = e.operatorToken.getText();
          if (c.mode === 'state') return [`${indent}state.${target.name} ${op} ${rhs};`];
          const set = setterName(target.name);
          if (op === '=') return [`${indent}${set}(${rhs});`];
          const binOp = op.slice(0, -1);
          return [`${indent}${set}(${target.name} ${binOp} ${rhs});`];
        }
      }
      if ((ts.isPostfixUnaryExpression(e) || ts.isPrefixUnaryExpression(e)) &&
        (e.operator === ts.SyntaxKind.PlusPlusToken || e.operator === ts.SyntaxKind.MinusMinusToken)) {
        const target = isThisProperty(e.operand);
        if (target) {
          if (!c.fieldNames.has(target.name)) {
            return this.unsupportedLine(indent, `update of undeclared field 'this.${target.name}'`);
          }
          if (c.mode === 'react' && !c.stateFields.has(target.name)) {
            return this.unsupportedLine(indent, `update of field '${target.name}', which was not hoisted to React state`);
          }
          const delta = e.operator === ts.SyntaxKind.PlusPlusToken ? '+ 1' : '- 1';
          if (c.mode === 'state') {
            return [ts.isPostfixUnaryExpression(e)
              ? `${indent}state.${target.name}${delta.startsWith('+') ? '++' : '--'};`
              : `${indent}${delta.startsWith('+') ? '++' : '--'}state.${target.name};`];
          }
          return [`${indent}${setterName(target.name)}(${target.name} ${delta});`];
        }
      }
      const code = this.expr(e);
      if (c.unsupported) return this.unsupportedLine(indent, c.unsupported);
      return [`${indent}${code};`];
    }

    if (ts.isReturnStatement(node)) {
      if (!node.expression) return [`${indent}return;`];
      const code = this.expr(node.expression);
      if (c.unsupported) return this.unsupportedLine(indent, c.unsupported);
      return [`${indent}return ${code};`];
    }

    if (ts.isIfStatement(node)) {
      const cond = this.expr(node.expression);
      if (c.unsupported) return this.unsupportedLine(indent, c.unsupported);
      const lines = [`${indent}if (${cond}) {`];
      lines.push(...this.statement(node.thenStatement, indent + '  '));
      lines.push(`${indent}}`);
      if (node.elseStatement) {
        if (ts.isIfStatement(node.elseStatement)) {
          const elseLines = this.statement(node.elseStatement, indent);
          // Merge "} else if (...) {" onto one line.
          lines[lines.length - 1] = `${indent}} else ${elseLines[0].trimStart()}`;
          lines.push(...elseLines.slice(1));
        } else {
          lines[lines.length - 1] = `${indent}} else {`;
          lines.push(...this.statement(node.elseStatement, indent + '  '));
          lines.push(`${indent}}`);
        }
      }
      return lines;
    }

    if (ts.isVariableStatement(node)) {
      const stmtText = node.getText();
      const keyword = stmtText.startsWith('let') ? 'let' : stmtText.startsWith('var') ? 'var' : 'const';
      const lines: string[] = [];
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) {
          return this.unsupportedLine(indent, 'destructuring declaration');
        }
        if (!decl.initializer) { lines.push(`${indent}${keyword} ${decl.name.text};`); continue; }
        const code = this.expr(decl.initializer);
        if (c.unsupported) return this.unsupportedLine(indent, c.unsupported);
        lines.push(`${indent}${keyword} ${decl.name.text} = ${code};`);
      }
      return lines;
    }

    return this.unsupportedLine(indent, ts.SyntaxKind[node.kind]);
  }
}

export interface TranslatedMethod {
  name: string;
  /** Parameter source texts (react mode) — e.g. `step: number = 1`. */
  paramTexts: string[];
  /** Parameter bare names (state/preview mode). */
  paramNames: string[];
  /** Body lines at zero indent (statements already end with ';'). */
  lines: string[];
}

/**
 * Translate all methods of a component in the given mode.
 * Returns the translated methods plus accumulated diagnostics.
 */
export function translateMethods(
  component: ComponentInfo,
  mode: TranslateMode,
  stateFields: Set<string>,
): { methods: TranslatedMethod[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const methods: TranslatedMethod[] = [];
  const fieldNames = new Set(component.fields.map((f) => f.name));
  const methodNames = new Set(component.methods);
  for (const method of component.methodDetails) {
    const statements = bodyStatements(method);
    if (!statements) continue;
    const ctx: Ctx = {
      mode, fieldNames, methodNames, stateFields,
      methodName: method.name, diagnostics,
    };
    const translator = new Translator(ctx);
    const lines = translator.statements(statements, '');
    methods.push({
      name: method.name,
      paramTexts: method.params.map((p) => p.text),
      paramNames: method.params.map((p) => p.name),
      lines,
    });
  }
  return { methods, diagnostics };
}
