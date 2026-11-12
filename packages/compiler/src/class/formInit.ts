import * as ts from 'typescript';
import { FormControl, FormGroup, ValidatorFn, Validators } from '../../../runtime/src/index';

/**
 * Reactive form field initializers (Stage 8).
 *
 * A component field initialised with `new FormGroup(...)` or
 * `new FormControl(...)` is a stable forms instance, not state: codegen
 * holds it in a React ref, and the preview builds the real runtime
 * instance so templates can read `profileForm.get('email').invalid`
 * before any interaction.
 *
 * Both jobs need to understand the initializer's shape, and the preview
 * additionally needs to EVALUATE it. The supported subset is exactly:
 *
 *   new FormControl(<literal>, Validators.x)
 *   new FormControl(<literal>, [Validators.x, Validators.minLength(3), ...])
 *   new FormGroup({ name: <new FormControl expression>, ... })
 *
 * where a literal is a string, number, boolean, null, or unary-minus
 * number, and validator arguments are literals. Anything richer is
 * reported as unsupported: the generated app still runs the initializer
 * verbatim (it is the author's real code), only the preview cannot
 * build the instance, and compile.ts says so with GEN_FORM_INITIALIZER.
 */

export interface FormFieldInfo {
  kind: 'group' | 'control';
  /** Control names of a FormGroup, when its config is an object literal. */
  controlNames: string[];
  /** True when the preview evaluator below can build the instance. */
  supported: boolean;
  /** Why not, when supported is false. */
  reason?: string;
}

const FORM_INIT_RE = /^\s*new\s+(FormGroup|FormControl)\s*\(/;

/** True for field initializers of the form `new FormGroup(...)` / `new FormControl(...)`. */
export function isFormInitializer(initializer: string | undefined): boolean {
  return !!initializer && FORM_INIT_RE.test(initializer);
}

/** Kind and group control names from the initializer's shape alone. */
export function formFieldKind(initializer: string): { kind: 'group' | 'control'; controlNames: string[] } {
  const m = FORM_INIT_RE.exec(initializer);
  const kind = m?.[1] === 'FormGroup' ? 'group' : 'control';
  const controlNames: string[] = [];
  if (kind === 'group') {
    const expr = topNewExpression(initializer);
    const config = expr?.arguments?.[0];
    if (config && ts.isObjectLiteralExpression(config)) {
      for (const prop of config.properties) {
        if (ts.isPropertyAssignment(prop)) controlNames.push(prop.name.getText().replace(/^['"]|['"]$/g, ''));
      }
    }
  }
  return { kind, controlNames };
}

/** Parse `const __x = <initializer>;` and return its top-level NewExpression. */
function topNewExpression(initializer: string): ts.NewExpression | undefined {
  const sf = ts.createSourceFile(
    'form-init.ts',
    `const __x = ${initializer};`,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );
  let found: ts.NewExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isNewExpression(node.initializer)) {
      found = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

class Unsupported extends Error {}

function evalLiteral(node: ts.Expression): unknown {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    const inner = evalLiteral(node.operand);
    if (typeof inner === 'number') return -inner;
  }
  throw new Unsupported(`a ${ts.SyntaxKind[node.kind]} is not a literal value`);
}

/** `Validators.required` and friends, as member or call expressions. */
function evalValidator(node: ts.Expression): ValidatorFn {
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)
    && node.expression.text === 'Validators') {
    if (node.name.text === 'required') return Validators.required;
    if (node.name.text === 'email') return Validators.email;
    throw new Unsupported(`Validators.${node.name.text} is used as a value but takes an argument`);
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === 'Validators') {
    const name = node.expression.name.text;
    const arg = node.arguments[0] ? evalLiteral(node.arguments[0]) : undefined;
    if (name === 'minLength' && typeof arg === 'number') return Validators.minLength(arg);
    if (name === 'maxLength' && typeof arg === 'number') return Validators.maxLength(arg);
    if (name === 'pattern' && typeof arg === 'string') return Validators.pattern(arg);
    throw new Unsupported(`Validators.${name}(...) is outside the supported subset`);
  }
  throw new Unsupported('validators must be Validators references or calls');
}

function evalValidators(node: ts.Expression | undefined): ValidatorFn[] {
  if (!node) return [];
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(evalValidator);
  return [evalValidator(node)];
}

function evalFormNode(node: ts.Expression): FormControl | FormGroup {
  if (!ts.isNewExpression(node) || !ts.isIdentifier(node.expression)) {
    throw new Unsupported('expected new FormControl(...) or new FormGroup(...)');
  }
  if (node.expression.text === 'FormControl') {
    const args = node.arguments ?? [];
    const initial = args[0] ? evalLiteral(args[0]) : null;
    return new FormControl(initial, evalValidators(args[1]));
  }
  if (node.expression.text === 'FormGroup') {
    const config = node.arguments?.[0];
    if (!config || !ts.isObjectLiteralExpression(config)) {
      throw new Unsupported('a FormGroup config must be an object literal of FormControls');
    }
    const controls: Record<string, FormControl> = {};
    for (const prop of config.properties) {
      if (!ts.isPropertyAssignment(prop)) {
        throw new Unsupported('FormGroup entries must be name: new FormControl(...) pairs');
      }
      const name = prop.name.getText().replace(/^['"]|['"]$/g, '');
      const control = evalFormNode(prop.initializer);
      if (!(control instanceof FormControl)) {
        throw new Unsupported(`FormGroup entry '${name}' is not a FormControl`);
      }
      controls[name] = control;
    }
    return new FormGroup(controls);
  }
  throw new Unsupported(`new ${node.expression.text}(...) is not a form class`);
}

/**
 * Analyse one form field initializer: its kind, its group control names,
 * and whether the preview can evaluate it.
 */
export function analyzeFormInitializer(initializer: string): FormFieldInfo {
  const { kind, controlNames } = formFieldKind(initializer);
  const expr = topNewExpression(initializer);
  if (!expr) return { kind, controlNames, supported: false, reason: 'the initializer could not be parsed' };
  try {
    evalFormNode(expr);
    return { kind, controlNames, supported: true };
  } catch (e) {
    return {
      kind, controlNames, supported: false,
      reason: e instanceof Unsupported ? e.message : 'the initializer could not be evaluated',
    };
  }
}

/**
 * Build the real runtime instance for a form field initializer, for the
 * preview's server-side paint. Fails with { ok: false } on the same
 * shapes analyzeFormInitializer reports as unsupported.
 */
export function evaluateFormInitializer(
  initializer: string,
): { ok: true; value: FormControl | FormGroup } | { ok: false; reason: string } {
  const expr = topNewExpression(initializer);
  if (!expr) return { ok: false, reason: 'the initializer could not be parsed' };
  try {
    return { ok: true, value: evalFormNode(expr) };
  } catch (e) {
    return { ok: false, reason: e instanceof Unsupported ? e.message : 'the initializer could not be evaluated' };
  }
}
