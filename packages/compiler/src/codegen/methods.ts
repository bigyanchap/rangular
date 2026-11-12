import * as ts from 'typescript';
import { ComponentField, ComponentMethod } from '../class/parseComponent';
import { Diagnostic, warning } from '../diagnostics';

/**
 * Method translation (Stage 2, M3).
 *
 * Component methods are translated statement-by-statement from the
 * TypeScript AST. Two output modes share one walker:
 *  - 'react': `this.field` reads become the bare variable; assignments to
 *    state fields become setter calls (`this.count++` -> `setCount(count + 1)`).
 *  - 'state': `this.field` becomes `state.field` and `this.method()` becomes
 *    `methods.method()`, used by the interactive HTML preview runtime.
 *
 * Anything outside the supported subset yields a METHOD_UNSUPPORTED warning
 * plus a TODO comment at that spot, code is never silently dropped and
 * broken syntax is never emitted.
 */

/**
 * 'react' , component -> function component (this.field -> state/setter).
 * 'state' , the interactive preview (this.field -> state.field).
 * 'service', a service stays a real class, so `this.` survives verbatim;
 *             assignments to fields additionally emit `this.__notify()` so
 *             subscribed components re-render (Stage 3, M6).
 * 'pipe',    a @Pipe class also stays a real class (Stage 12): `this.`
 *             survives and assignments stay plain, but there is no
 *             __notify, a pipe has no subscribers; the generated class
 *             does not extend ReactiveService.
 */
export type TranslateMode = 'react' | 'state' | 'service' | 'pipe';

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
 * The array methods that mutate their receiver in place. A call of one
 * of these on `this.<field>` changes the field's value, so the field
 * counts as mutated (proof fix): without this, `this.items.push(x)`
 * compiled silently against a plain const and the generated app never
 * re-rendered, while the preview (whose state is a mutable object)
 * did, a direct parity break.
 */
export const MUTATING_ARRAY_METHODS = new Set([
  'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill',
]);

/** If `node` is a call `this.<field>.<method>(...)`, name its parts. */
function thisMethodCall(node: ts.Node): { field: string; method: string } | undefined {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return undefined;
  const self = isThisProperty(node.expression.expression);
  if (!self) return undefined;
  return { field: self.name, method: node.expression.name.text };
}

/** The fix line that teaches the assignment form for array changes. */
export function arrayAssignmentFix(field: string): string {
  return `Assign a new array instead: this.${field} = [...this.${field}, item] to add, this.${field} = this.${field}.filter(...) to remove, this.${field} = this.${field}.slice(...) to copy a range; push, pop and shift written as plain statements are translated for you`;
}

/**
 * First pass: which fields are assigned anywhere inside any method?
 * Those fields become React state (useState) in codegen.
 */
export function analyzeMutatedFields(component: MethodHost): Set<string> {
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
      const call = thisMethodCall(node);
      if (call && fieldNames.has(call.field) && MUTATING_ARRAY_METHODS.has(call.method)) {
        mutated.add(call.field);
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
  /**
   * @Output EventEmitter fields -> the callback expression an `.emit(x)`
   * call becomes (react: `onSaved`, preview state mode: `props.onSaved`).
   */
  outputCallbacks?: Map<string, string>;
  /**
   * Reactive form fields (Stage 8): fields initialised with
   * new FormGroup(...) / new FormControl(...). In react mode they are
   * held in a ref, so `this.profileForm` reads as `profileFormRef.current`;
   * in state mode they live in the preview state like any other field.
   */
  formFields?: Set<string>;
  /** Set when the current statement uses an unsupported construct. */
  unsupported?: string;
  /** A statement specific fix line for the unsupported construct, when set. */
  unsupportedFix?: string;
}

class Translator {
  constructor(private ctx: Ctx) {}

  private fail(what: string, fix?: string): string {
    this.ctx.unsupported = what;
    if (fix !== undefined) this.ctx.unsupportedFix = fix;
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
      // An array mutation method on a field, reached in expression
      // position (its result is used, or it sits inside a larger
      // expression): generated code holds fields in consts and state
      // setters, so there is no faithful translation; refuse it and
      // teach the assignment form (proof fix). Statement position is
      // handled separately in statement(), where push, pop and shift
      // do translate. State, service and pipe modes keep the native
      // call: their fields really are mutable properties.
      if (c.mode === 'react') {
        const call = thisMethodCall(node);
        if (call && c.fieldNames.has(call.field) && MUTATING_ARRAY_METHODS.has(call.method)) {
          return this.fail(
            `array mutation method '${call.method}' on field 'this.${call.field}' used as a value`,
            arrayAssignmentFix(call.field),
          );
        }
      }
      // @Output: this.saved.emit(x) -> onSaved?.(x) / props.onSaved?.(x).
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'emit') {
        const self = isThisProperty(node.expression.expression);
        const callback = self ? c.outputCallbacks?.get(self.name) : undefined;
        if (self && callback) {
          const args = node.arguments.map((a) => this.expr(a)).join(', ');
          return `${callback}?.(${args})`;
        }
      }
      const callee = this.expr(node.expression);
      const args = node.arguments.map((a) => this.expr(a)).join(', ');
      return `${callee}(${args})`;
    }
    if (ts.isBinaryExpression(node)) {
      // An assignment buried inside an expression (e.g. an expression-bodied
      // arrow `data => this.field = data`) cannot become a React setter call;
      // refuse it so the statement degrades to METHOD_UNSUPPORTED instead of
      // emitting `field = data` against a const. State/service modes can
      // express it faithfully (state.field = data / this.field = data), and
      // the generic path below already produces exactly that.
      if (c.mode === 'react' && ASSIGN_OPS.has(node.operatorToken.kind) && isThisProperty(node.left)) {
        return this.fail('assignment to a field inside an expression, use a block body with assignment statements');
      }
      return `${this.expr(node.left)} ${node.operatorToken.getText()} ${this.expr(node.right)}`;
    }
    if (ts.isPrefixUnaryExpression(node)) {
      if (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) {
        const target = isThisProperty(node.operand);
        if (target) {
          const opText = node.operator === ts.SyntaxKind.PlusPlusToken ? '++' : '--';
          if (c.mode === 'state') return `${opText}state.${target.name}`;
          if (c.mode === 'service' || c.mode === 'pipe') return `${opText}this.${target.name}`;
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
        if (c.mode === 'service' || c.mode === 'pipe') return `this.${target.name}${opText}`;
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
      // Preview (state mode) bodies run as plain JavaScript in the page, so
      // type annotations must be stripped there; generated .tsx keeps them.
      const params = node.parameters
        .map((p) => (c.mode === 'state' ? p.name.getText() : p.getText()))
        .join(', ');
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
    const callback = c.outputCallbacks?.get(name);
    if (callback) return callback;
    if (c.mode === 'service' || c.mode === 'pipe') return `this.${name}`;
    if (c.methodNames.has(name)) return c.mode === 'state' ? `methods.${name}` : name;
    // Stage 8: a reactive form instance is ref-held in generated code.
    if (c.mode === 'react' && c.formFields?.has(name)) return `${name}Ref.current`;
    return c.mode === 'state' ? `state.${name}` : name;
  }

  /** Translate a list of statements at the given indent (no leading spaces beyond it). */
  statements(list: ts.Statement[], indent: string): string[] {
    const lines: string[] = [];
    for (const stmt of list) lines.push(...this.statement(stmt, indent));
    return lines;
  }

  private unsupportedLine(indent: string, what: string, fix?: string): string[] {
    this.ctx.diagnostics.push(warning(
      'METHOD_UNSUPPORTED',
      `Method '${this.ctx.methodName}': ${what} is not in the Stage 2 translation subset, left as a TODO`,
      undefined, undefined,
      fix ?? this.ctx.unsupportedFix
        ?? 'Rewrite with the supported subset: this.field assignments (+=, ++, =), this.method() calls, if/else, return, local const/let, or move the unsupported logic out of the method',
    ));
    return [`${indent}/* TODO(Rangular): unsupported in method '${this.ctx.methodName}': ${what} */`];
  }

  /**
   * A statement that is exactly an array mutation call on a field,
   * in react mode (proof fix). push becomes a concat assignment
   * through the state setter; pop and shift with no arguments (their
   * return values unused by construction in statement position)
   * become slice assignments. The remaining mutating methods
   * (unshift, splice, sort, reverse, fill) have no honest one-line
   * setter form, so they degrade to METHOD_UNSUPPORTED with the
   * assignment form as the fix. Returns undefined when the statement
   * is not such a call, or the mode keeps native mutation (state
   * mode mutates the preview state object; services and pipes are
   * real classes).
   */
  private arrayMutationStatement(e: ts.Expression, indent: string): string[] | undefined {
    const c = this.ctx;
    if (c.mode !== 'react' || !ts.isCallExpression(e)) return undefined;
    const call = thisMethodCall(e);
    if (!call || !c.fieldNames.has(call.field) || !MUTATING_ARRAY_METHODS.has(call.method)) {
      return undefined;
    }
    const { field, method } = call;
    if (!c.stateFields.has(field)) {
      return this.unsupportedLine(
        indent,
        `array mutation method '${method}' on field '${field}', which was not hoisted to React state`,
        arrayAssignmentFix(field),
      );
    }
    const set = setterName(field);
    if (method === 'push') {
      const args = e.arguments.map((a) => this.expr(a)).join(', ');
      if (c.unsupported) return this.unsupportedLine(indent, c.unsupported);
      return [`${indent}${set}(${field}.concat(${args}));`];
    }
    if ((method === 'pop' || method === 'shift') && e.arguments.length === 0) {
      return [`${indent}${set}(${method === 'pop' ? `${field}.slice(0, -1)` : `${field}.slice(1)`});`];
    }
    return this.unsupportedLine(
      indent,
      `array mutation method '${method}' on field 'this.${field}' as a statement`,
      arrayAssignmentFix(field),
    );
  }

  private statement(node: ts.Statement, indent: string): string[] {
    const c = this.ctx;
    c.unsupported = undefined;
    c.unsupportedFix = undefined;

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
          if (c.mode === 'service') {
            return [
              `${indent}this.${target.name} ${op} ${rhs};`,
              `${indent}this.__notify();`,
            ];
          }
          if (c.mode === 'pipe') {
            return [`${indent}this.${target.name} ${op} ${rhs};`];
          }
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
          if (c.mode === 'service') {
            const sym = delta.startsWith('+') ? '++' : '--';
            return [
              ts.isPostfixUnaryExpression(e)
                ? `${indent}this.${target.name}${sym};`
                : `${indent}${sym}this.${target.name};`,
              `${indent}this.__notify();`,
            ];
          }
          if (c.mode === 'pipe') {
            const sym = delta.startsWith('+') ? '++' : '--';
            return [ts.isPostfixUnaryExpression(e)
              ? `${indent}this.${target.name}${sym};`
              : `${indent}${sym}this.${target.name};`];
          }
          return [`${indent}${setterName(target.name)}(${target.name} ${delta});`];
        }
      }
      // A bare array mutation call on a field: push/pop/shift
      // translate to setter calls (proof fix), the rest degrade.
      const mutation = this.arrayMutationStatement(e, indent);
      if (mutation) return mutation;
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
  /** Parameter source texts (react mode), e.g. `step: number = 1`. */
  paramTexts: string[];
  /** Parameter bare names (state/preview mode). */
  paramNames: string[];
  /** Body lines at zero indent (statements already end with ';'). */
  lines: string[];
}

/** Anything with fields and methods to translate: a component or a service. */
export interface MethodHost {
  fields: ComponentField[];
  methods: string[];
  methodDetails: ComponentMethod[];
}

export interface TranslateOptions {
  /** @Output field name -> callback expression for `.emit(...)` calls. */
  outputCallbacks?: Map<string, string>;
  /** Reactive form fields held in refs in generated code (Stage 8). */
  formFields?: Set<string>;
}

/**
 * Translate all methods of a component (or service) in the given mode.
 * Returns the translated methods plus accumulated diagnostics.
 */
export function translateMethods(
  component: MethodHost,
  mode: TranslateMode,
  stateFields: Set<string>,
  options: TranslateOptions = {},
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
      outputCallbacks: options.outputCallbacks,
      formFields: options.formFields,
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
