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
