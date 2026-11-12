import { Expr, parseExpression } from './expr';
import { applyBuiltinPipe, isBuiltinPipe } from './pipes';

export type Scope = Record<string, unknown>;

/**
 * Custom pipe functions by pipe name (Stage 12): a @Pipe class's
 * transform, supplied by whoever owns the compilation (the preview
 * builds them from the resolved pipe classes). The evaluator stays a
 * pure walker; it never sees TypeScript source.
 */
export type PipeFunctions = Record<string, (value: unknown, ...args: unknown[]) => unknown>;

/**
 * Evaluate a parsed template expression against a scope object.
 * This walks the expression AST produced by the Pratt parser, it never
 * uses eval/Function on source text.
 *
 * Semantics follow Angular templates pragmatically:
 *  - unknown identifiers evaluate to undefined;
 *  - member/index access on null/undefined evaluates to undefined;
 *  - method calls through a member (obj.fn()) keep `obj` as `this`;
 *  - built-in pipes: uppercase, lowercase, titlecase, json.
 *    Unknown pipes throw a clear error.
 */
/**
 * Evaluate a parsed template expression against a scope object.
 * This walks the expression AST produced by the Pratt parser, it never
 * uses eval/Function on source text.
 *
 * Semantics follow Angular templates pragmatically:
 *  - unknown identifiers evaluate to undefined;
 *  - member/index access on null/undefined evaluates to undefined;
 *  - method calls through a member (obj.fn()) keep `obj` as `this`;
 *  - built-in pipes: the Stage 12 set in template/pipes.ts
 *    (uppercase, lowercase, titlecase, json, date, number, percent,
 *    currency, slice, keyvalue, async), plus any custom pipes the
 *    caller supplies. Unknown pipes throw a clear error.
 *
 * `refs` (Stage 8) carries template reference variables: when the base
 * of a member chain is a reference name (an ngModel input ref like
 * `#email="ngModel"`), the chain reads from the reference object
 * (its live validation state), not from the scope field of the same
 * name. A bare reference identifier still resolves in the scope, exactly
 * like the generated code, where only chain roots are rewritten.
 */
export function evaluateExpression(source: string, scope: Scope, refs?: Scope, pipes?: PipeFunctions): unknown {
  return evaluateExpr(parseExpression(source), scope, refs, pipes);
}

export function evaluateExpr(expr: Expr, scope: Scope, refs?: Scope, pipes?: PipeFunctions): unknown {
  switch (expr.type) {
    case 'literal':
      return expr.value;
    case 'identifier':
      return scope[expr.name];
    case 'member': {
      if (expr.object.type === 'identifier' && refs
        && Object.prototype.hasOwnProperty.call(refs, expr.object.name)) {
        const base = refs[expr.object.name];
        if (base === null || base === undefined) return undefined;
        return (base as Record<string, unknown>)[expr.property];
      }
      const obj = evaluateExpr(expr.object, scope, refs, pipes);
      if (obj === null || obj === undefined) return undefined;
      return (obj as Record<string, unknown>)[expr.property];
    }
    case 'index': {
      const obj = evaluateExpr(expr.object, scope, refs, pipes);
      if (obj === null || obj === undefined) return undefined;
      const key = evaluateExpr(expr.index, scope, refs, pipes) as string | number;
      return (obj as Record<string, unknown>)[key as string];
    }
    case 'call': {
      const args = expr.args.map((a) => evaluateExpr(a, scope, refs, pipes));
      if (expr.callee.type === 'member') {
        const obj = evaluateExpr(expr.callee.object, scope, refs, pipes);
        if (obj === null || obj === undefined) return undefined;
        const fn = (obj as Record<string, unknown>)[expr.callee.property];
        if (typeof fn !== 'function') {
          throw new Error(`Expression error: '${expr.callee.property}' is not a function`);
        }
        return (fn as (...a: unknown[]) => unknown).apply(obj, args);
      }
      const fn = evaluateExpr(expr.callee, scope, refs, pipes);
      if (typeof fn !== 'function') {
        throw new Error('Expression error: attempted to call a non-function value');
      }
      return (fn as (...a: unknown[]) => unknown)(...args);
    }
    case 'unary': {
      const v = evaluateExpr(expr.argument, scope, refs, pipes);
      if (expr.op === '!') return !v;
      if (expr.op === '-') return -(v as number);
      if (expr.op === '+') return +(v as number);
      throw new Error(`Expression error: unsupported unary operator '${expr.op}'`);
    }
    case 'binary':
      return evaluateBinary(expr.op, expr.left, expr.right, scope, refs, pipes);
    case 'conditional':
      return evaluateExpr(expr.test, scope, refs, pipes)
        ? evaluateExpr(expr.consequent, scope, refs, pipes)
        : evaluateExpr(expr.alternate, scope, refs, pipes);
    case 'array':
      return expr.elements.map((el) => evaluateExpr(el, scope, refs, pipes));
    case 'pipe': {
      const value = evaluateExpr(expr.input, scope, refs, pipes);
      const args = expr.args.map((a) => evaluateExpr(a, scope, refs, pipes));
      return applyPipe(expr.name, value, args, pipes);
    }
  }
}

function evaluateBinary(op: string, left: Expr, right: Expr, scope: Scope, refs?: Scope, pipes?: PipeFunctions): unknown {
  // Short-circuiting operators return operand values, like JavaScript.
  if (op === '&&') {
    const l = evaluateExpr(left, scope, refs, pipes);
    return l ? evaluateExpr(right, scope, refs, pipes) : l;
  }
  if (op === '||') {
    const l = evaluateExpr(left, scope, refs, pipes);
    return l ? l : evaluateExpr(right, scope, refs, pipes);
  }
  const l = evaluateExpr(left, scope, refs, pipes) as number;
  const r = evaluateExpr(right, scope, refs, pipes) as number;
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

export function applyPipe(name: string, value: unknown, args: unknown[] = [], pipes?: PipeFunctions): unknown {
  if (pipes && Object.prototype.hasOwnProperty.call(pipes, name)) {
    return pipes[name](value, ...args);
  }
  if (isBuiltinPipe(name)) return applyBuiltinPipe(name, value, args);
  throw new Error(`Unknown pipe '${name}'`);
}
