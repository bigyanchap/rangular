import { Expr, parseExpression } from './expr';

export type Scope = Record<string, unknown>;

/**
 * Evaluate a parsed template expression against a scope object.
 * This walks the expression AST produced by the Pratt parser — it never
 * uses eval/Function on source text.
 *
 * Semantics follow Angular templates pragmatically:
 *  - unknown identifiers evaluate to undefined;
 *  - member/index access on null/undefined evaluates to undefined;
 *  - method calls through a member (obj.fn()) keep `obj` as `this`;
 *  - built-in pipes: uppercase, lowercase, titlecase, json.
 *    Unknown pipes throw a clear error.
 */
export function evaluateExpression(source: string, scope: Scope): unknown {
  return evaluateExpr(parseExpression(source), scope);
}

export function evaluateExpr(expr: Expr, scope: Scope): unknown {
  switch (expr.type) {
    case 'literal':
      return expr.value;
    case 'identifier':
      return scope[expr.name];
    case 'member': {
      const obj = evaluateExpr(expr.object, scope);
      if (obj === null || obj === undefined) return undefined;
      return (obj as Record<string, unknown>)[expr.property];
    }
    case 'index': {
      const obj = evaluateExpr(expr.object, scope);
      if (obj === null || obj === undefined) return undefined;
      const key = evaluateExpr(expr.index, scope) as string | number;
      return (obj as Record<string, unknown>)[key as string];
    }
    case 'call': {
      const args = expr.args.map((a) => evaluateExpr(a, scope));
      if (expr.callee.type === 'member') {
        const obj = evaluateExpr(expr.callee.object, scope);
        if (obj === null || obj === undefined) return undefined;
        const fn = (obj as Record<string, unknown>)[expr.callee.property];
        if (typeof fn !== 'function') {
          throw new Error(`Expression error: '${expr.callee.property}' is not a function`);
        }
        return (fn as (...a: unknown[]) => unknown).apply(obj, args);
      }
      const fn = evaluateExpr(expr.callee, scope);
      if (typeof fn !== 'function') {
        throw new Error('Expression error: attempted to call a non-function value');
      }
      return (fn as (...a: unknown[]) => unknown)(...args);
    }
    case 'unary': {
      const v = evaluateExpr(expr.argument, scope);
      if (expr.op === '!') return !v;
      if (expr.op === '-') return -(v as number);
      if (expr.op === '+') return +(v as number);
      throw new Error(`Expression error: unsupported unary operator '${expr.op}'`);
    }
    case 'binary':
      return evaluateBinary(expr.op, expr.left, expr.right, scope);
    case 'conditional':
      return evaluateExpr(expr.test, scope)
        ? evaluateExpr(expr.consequent, scope)
        : evaluateExpr(expr.alternate, scope);
    case 'pipe': {
      const value = evaluateExpr(expr.input, scope);
      const args = expr.args.map((a) => evaluateExpr(a, scope));
      return applyPipe(expr.name, value, args);
    }
  }
}

function evaluateBinary(op: string, left: Expr, right: Expr, scope: Scope): unknown {
  // Short-circuiting operators return operand values, like JavaScript.
  if (op === '&&') {
    const l = evaluateExpr(left, scope);
    return l ? evaluateExpr(right, scope) : l;
  }
  if (op === '||') {
    const l = evaluateExpr(left, scope);
    return l ? l : evaluateExpr(right, scope);
  }
  const l = evaluateExpr(left, scope) as number;
  const r = evaluateExpr(right, scope) as number;
  switch (op) {
    case '+': return (l as unknown as number) + (r as unknown as number);
    case '-': return l - r;
    case '*': return l * r;
    case '/': return l / r;
    case '%': return l % r;
    // eslint-disable-next-line eqeqeq -- Angular templates use JS loose equality for ==
    case '==': return l == r; // NOSONAR
    case '===': return l === r;
    // eslint-disable-next-line eqeqeq -- see above
    case '!=': return l != r; // NOSONAR
    case '!==': return l !== r;
    case '<': return l < r;
    case '>': return l > r;
    case '<=': return l <= r;
    case '>=': return l >= r;
    default: throw new Error(`Expression error: unsupported binary operator '${op}'`);
  }
}

export function applyPipe(name: string, value: unknown, _args: unknown[]): unknown {
  switch (name) {
    case 'uppercase':
      return typeof value === 'string' ? value.toUpperCase() : value;
    case 'lowercase':
      return typeof value === 'string' ? value.toLowerCase() : value;
    case 'titlecase':
      return typeof value === 'string'
        ? value.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        : value;
    case 'json':
      return JSON.stringify(value);
    default:
      throw new Error(`Unknown pipe '${name}'`);
  }
}
