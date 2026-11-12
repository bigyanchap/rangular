import * as ts from 'typescript';

/**
 * Evaluate a field initializer that is composed purely of literals:
 * strings, numbers, booleans, null, arrays and objects (nested), with
 * unary minus on numbers. Anything else (identifiers, calls, spreads,
 * methods, template substitutions) is NOT a literal and reports
 * { ok: false }, callers keep their warning + TODO behaviour for those.
 *
 * Implemented by walking the TypeScript AST, never by eval/Function.
 */
export function literalValue(initializer: string): { ok: boolean; value?: unknown } {
  const sf = ts.createSourceFile(
    'literal.ts',
    `const __v = ${initializer};`,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
  );
  let expr: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (expr) return;
    if (ts.isVariableDeclaration(node) && node.initializer) expr = node.initializer;
    else ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!expr) return { ok: false };
  return walk(expr);
}

function walk(node: ts.Expression): { ok: boolean; value?: unknown } {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { ok: true, value: node.text };
  }
  if (ts.isNumericLiteral(node)) return { ok: true, value: Number(node.text) };
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { ok: true, value: true };
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { ok: true, value: false };
  if (node.kind === ts.SyntaxKind.NullKeyword) return { ok: true, value: null };
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    const inner = walk(node.operand);
    return inner.ok && typeof inner.value === 'number'
      ? { ok: true, value: -inner.value }
      : { ok: false };
  }
  if (ts.isArrayLiteralExpression(node)) {
    const out: unknown[] = [];
    for (const el of node.elements) {
      const r = walk(el);
      if (!r.ok) return { ok: false };
      out.push(r.value);
    }
    return { ok: true, value: out };
  }
  if (ts.isObjectLiteralExpression(node)) {
    const out: Record<string, unknown> = {};
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop)) {
        const key = keyOf(prop.name);
        if (key === undefined) return { ok: false };
        const r = walk(prop.initializer);
        if (!r.ok) return { ok: false };
        // defineProperty, not assignment: a key like "__proto__" must
        // become an own data property (the JSON.parse semantics), never
        // a prototype mutation of the object being built.
        Object.defineProperty(out, key, {
          value: r.value, enumerable: true, writable: true, configurable: true,
        });
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        // `({ x })` refers to a variable, not a literal.
        return { ok: false };
      } else {
        return { ok: false };
      }
    }
    return { ok: true, value: out };
  }
  if (ts.isParenthesizedExpression(node)) return walk(node.expression);
  return { ok: false };
}

function keyOf(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

/** True when the initializer source is a literal (or nested literal structure). */
export function isLiteralSource(initializer: string): boolean {
  return literalValue(initializer).ok;
}

/** Parse an initializer into its expression node (shared by the walks below). */
function initializerExpression(initializer: string): ts.Expression | undefined {
  const sf = ts.createSourceFile(
    'literal.ts',
    `const __v = ${initializer};`,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
  );
  let expr: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (expr) return;
    if (ts.isVariableDeclaration(node) && node.initializer) expr = node.initializer;
    else ts.forEachChild(node, visit);
  };
  visit(sf);
  return expr;
}

/**
 * True when an initializer mentions `this` anywhere (a real `this`
 * keyword, found by walking the AST, so the word inside a string does
 * not count). Such an initializer cannot be emitted verbatim into a
 * generated function component, which has no `this` to resolve, and
 * cannot be evaluated by the preview against an empty scope either.
 */
export function initializerUsesThis(initializer: string): boolean {
  const expr = initializerExpression(initializer);
  if (!expr) return true;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (node.kind === ts.SyntaxKind.ThisKeyword) { found = true; return; }
    ts.forEachChild(node, visit);
  };
  visit(expr);
  return found;
}

/**
 * Evaluate a non-literal field initializer that needs no scope: the
 * shapes the preview can rebuild identically to the generated app,
 * which emits such initializers verbatim (proof fix). Supported:
 * literals, `new Date(...)` with supported arguments, `Date.now()`,
 * unary minus, and `+ - * / %` over supported operands. Anything else
 * (identifiers, other constructors, other calls) reports { ok: false }
 * and callers keep the field out of the preview state, where reads of
 * it yield undefined, the same value the generated fallback declares.
 * Implemented by walking the TypeScript AST, never by eval/Function.
 */
export function evaluateExprInitializer(initializer: string): { ok: boolean; value?: unknown } {
  const expr = initializerExpression(initializer);
  if (!expr) return { ok: false };
  return walkExpr(expr);
}

function walkExpr(node: ts.Expression): { ok: boolean; value?: unknown } {
  const lit = literalOf(node);
  if (lit.ok) return lit;
  if (ts.isParenthesizedExpression(node)) return walkExpr(node.expression);
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Date') {
    const args: unknown[] = [];
    for (const arg of node.arguments ?? []) {
      const r = walkExpr(arg);
      if (!r.ok) return { ok: false };
      args.push(r.value);
    }
    const Ctor = Date as unknown as new (...a: unknown[]) => Date;
    return { ok: true, value: new Ctor(...args) };
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'Date'
    && node.expression.name.text === 'now' && node.arguments.length === 0) {
    return { ok: true, value: Date.now() };
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    const inner = walkExpr(node.operand);
    return inner.ok && typeof inner.value === 'number'
      ? { ok: true, value: -inner.value }
      : { ok: false };
  }
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (op === ts.SyntaxKind.PlusToken || op === ts.SyntaxKind.MinusToken
      || op === ts.SyntaxKind.AsteriskToken || op === ts.SyntaxKind.SlashToken
      || op === ts.SyntaxKind.PercentToken) {
      const l = walkExpr(node.left);
      const r = walkExpr(node.right);
      if (!l.ok || !r.ok) return { ok: false };
      const a = l.value as number;
      const b = r.value as number;
      if (typeof a !== 'number' || typeof b !== 'number') return { ok: false };
      switch (op) {
        case ts.SyntaxKind.PlusToken: return { ok: true, value: a + b };
        case ts.SyntaxKind.MinusToken: return { ok: true, value: a - b };
        case ts.SyntaxKind.AsteriskToken: return { ok: true, value: a * b };
        case ts.SyntaxKind.SlashToken: return { ok: true, value: a / b };
        default: return { ok: true, value: a % b };
      }
    }
  }
  return { ok: false };
}

/** The literal walk over an already-parsed node (literalValue on a subnode). */
function literalOf(node: ts.Expression): { ok: boolean; value?: unknown } {
  return walk(node);
}
