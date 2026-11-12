import * as ts from 'typescript';
import { DirectiveInfo } from './parseComponent';

/**
 * Attribute directive style extraction (Stage 12).
 *
 * The supported directive subset: @Input fields, an ElementRef, and
 * styling logic in ngOnInit (or a setter for one input) whose
 * statements are only
 *
 *   this.el.nativeElement.style.<prop> = <expr>;
 *
 * plus local const/let declarations feeding those assignments. Each
 * <expr> may use literals, the @Input fields (as this.<input>), the
 * setter's parameter, locals, string concatenation and other binary
 * operators, ternaries, member/index access and method calls on those
 * values. The extractor rewrites each right-hand side into a template
 * expression whose identifiers are the input names, so codegen can
 * substitute the host element's bound values with exprToCode and the
 * preview can evaluate it with its expression evaluator: one source
 * of truth for what the directive computes.
 *
 * Anything outside the subset comes back as `unsupported` with a
 * human reason; codegen turns that into a DIR_UNSUPPORTED warning
 * and the directive applies no styles. Nothing is silently dropped.
 */

export interface DirectiveStyleAssign {
  /** The style property as written, a camelCase RN style key (backgroundColor). */
  prop: string;
  /** A template-expression source whose identifiers are @Input names. */
  rhs: string;
}

export interface DirectiveStyles {
  assignments: DirectiveStyleAssign[];
  /** Set when the directive's logic is outside the supported subset. */
  unsupported?: string;
}

const BINARY_OPS = new Set([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
]);

class Extractor {
  private locals = new Map<string, string>();
  private inputNames: Set<string>;

  constructor(
    private info: DirectiveInfo,
    private setterParam?: { name: string; input: string },
  ) {
    this.inputNames = new Set(info.inputs.map((i) => i.name));
  }

  /** Convert one TypeScript expression to a template-expression source. */
  expr(node: ts.Expression): string {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return JSON.stringify(node.text);
    }
    if (ts.isNumericLiteral(node)) return node.text;
    if (node.kind === ts.SyntaxKind.TrueKeyword) return 'true';
    if (node.kind === ts.SyntaxKind.FalseKeyword) return 'false';
    if (node.kind === ts.SyntaxKind.NullKeyword) return 'null';
    if (ts.isIdentifier(node)) {
      if (this.setterParam && node.text === this.setterParam.name) return this.setterParam.input;
      const local = this.locals.get(node.text);
      if (local !== undefined) return `(${local})`;
      if (this.inputNames.has(node.text)) return node.text;
      throw new Error(`'${node.text}' is not an @Input, a local or the setter parameter`);
    }
    if (ts.isPropertyAccessExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ThisKeyword) {
        if (this.inputNames.has(node.name.text)) return node.name.text;
        throw new Error(`this.${node.name.text} is not an @Input of the directive`);
      }
      return `${this.expr(node.expression)}.${node.name.text}`;
    }
    if (ts.isElementAccessExpression(node)) {
      return `${this.expr(node.expression)}[${this.expr(node.argumentExpression)}]`;
    }
    if (ts.isCallExpression(node)) {
      const args = node.arguments.map((a) => this.expr(a)).join(', ');
      return `${this.expr(node.expression)}(${args})`;
    }
    if (ts.isBinaryExpression(node)) {
      if (!BINARY_OPS.has(node.operatorToken.kind)) {
        throw new Error(`operator '${node.operatorToken.getText()}' is not supported in a directive`);
      }
      return `(${this.expr(node.left)} ${node.operatorToken.getText()} ${this.expr(node.right)})`;
    }
    if (ts.isConditionalExpression(node)) {
      return `(${this.expr(node.condition)} ? ${this.expr(node.whenTrue)} : ${this.expr(node.whenFalse)})`;
    }
    if (ts.isParenthesizedExpression(node)) return `(${this.expr(node.expression)})`;
    if (ts.isPrefixUnaryExpression(node)) {
      const op = node.operator === ts.SyntaxKind.ExclamationToken ? '!'
        : node.operator === ts.SyntaxKind.MinusToken ? '-'
        : node.operator === ts.SyntaxKind.PlusToken ? '+' : undefined;
      if (op === undefined) throw new Error('an unsupported unary operator in a directive');
      return `${op}${this.expr(node.operand)}`;
    }
    if (ts.isTemplateExpression(node)) {
      const parts: string[] = [JSON.stringify(node.head.text)];
      for (const span of node.templateSpans) {
        parts.push(this.expr(span.expression));
        parts.push(JSON.stringify(span.literal.text));
      }
      return `(${parts.join(' + ')})`;
    }
    if (ts.isAsExpression(node) || ts.isNonNullExpression(node)) return this.expr(node.expression);
    throw new Error(`${ts.SyntaxKind[node.kind]} is not supported in a directive style expression`);
  }

  /** The style property an assignment targets, or undefined when the shape is wrong. */
  private stylePropOf(left: ts.Expression): string | undefined {
    // this.<el>.nativeElement.style.<prop>
    if (!ts.isPropertyAccessExpression(left)) return undefined;
    const prop = left.name.text;
    const styleAccess = left.expression;
    if (!ts.isPropertyAccessExpression(styleAccess) || styleAccess.name.text !== 'style') return undefined;
    const nativeAccess = styleAccess.expression;
    if (!ts.isPropertyAccessExpression(nativeAccess) || nativeAccess.name.text !== 'nativeElement') return undefined;
    const elAccess = nativeAccess.expression;
    if (!ts.isPropertyAccessExpression(elAccess)) return undefined;
    if (elAccess.expression.kind !== ts.SyntaxKind.ThisKeyword) return undefined;
    if (this.info.elProp !== undefined && elAccess.name.text !== this.info.elProp) return undefined;
    return prop;
  }

  run(bodySource: string): DirectiveStyles {
    const sf = ts.createSourceFile(
      'directive.ts',
      `function __d() ${bodySource}`,
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
    if (!statements) return { assignments: [], unsupported: 'the styling body could not be read' };
    const assignments: DirectiveStyleAssign[] = [];
    try {
      for (const stmt of statements) {
        if (ts.isVariableStatement(stmt)) {
          for (const decl of stmt.declarationList.declarations) {
            if (!ts.isIdentifier(decl.name) || !decl.initializer) {
              return { assignments: [], unsupported: 'a local declaration without a plain name and value' };
            }
            this.locals.set(decl.name.text, this.expr(decl.initializer));
          }
          continue;
        }
        if (ts.isExpressionStatement(stmt) && ts.isBinaryExpression(stmt.expression)
          && stmt.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
          const prop = this.stylePropOf(stmt.expression.left);
          if (prop === undefined) {
            return { assignments: [], unsupported: 'a statement that is not a this.el.nativeElement.style.<prop> assignment' };
          }
          assignments.push({ prop, rhs: this.expr(stmt.expression.right) });
          continue;
        }
        const snippet = stmt.getText(sf).replace(/\s+/g, ' ').trim();
        return {
          assignments: [],
          unsupported: `the statement \`${snippet.length > 60 ? `${snippet.slice(0, 57)}...` : snippet}\`; only style assignments and local declarations are supported`,
        };
      }
    } catch (e) {
      return { assignments: [], unsupported: e instanceof Error ? e.message : 'an unsupported expression' };
    }
    return { assignments };
  }
}

/**
 * Extract the style assignments of a directive. ngOnInit wins when
 * both exist (it is the canonical Angular shape); otherwise the
 * setter for an input carries the logic, with its parameter standing
 * for that input's value.
 */
export function directiveStyles(info: DirectiveInfo): DirectiveStyles {
  if (info.attrName === undefined) {
    return {
      assignments: [],
      unsupported: `the selector '${info.selector ?? ''}' is not an attribute selector like [appHighlight]`,
    };
  }
  if (info.initBody) return new Extractor(info).run(info.initBody);
  if (info.setter) {
    return new Extractor(info, { name: info.setter.paramName, input: info.setter.prop })
      .run(info.setter.body);
  }
  return {
    assignments: [],
    unsupported: 'no styling logic: the subset reads ngOnInit or a setter for an input',
  };
}
