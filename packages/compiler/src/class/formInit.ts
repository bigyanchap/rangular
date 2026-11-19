import * as ts from 'typescript';
import { FormArray, FormControl, FormGroup, FormNode, ValidatorFn, Validators } from '../../../runtime/src/index';

/**
 * Reactive form field initializers (Stage 8; tree and builder shapes
 * since the forms completion pass).
 *
 * A component field initialised with a form tree is a stable forms
 * instance, not state: codegen holds it in a React ref, and the
 * preview builds the real runtime instance so templates can read
 * `profileForm.get('email').invalid` before any interaction.
 *
 * Both jobs need to understand the initializer's shape, and the
 * preview additionally needs to EVALUATE it. The supported subset is
 * exactly:
 *
 *   new FormControl(<literal>, Validators.x)
 *   new FormControl(<literal>, [Validators.x, Validators.minLength(3), ...])
 *   new FormGroup({ name: <any form node expression>, ... })
 *   new FormArray([ <any form node expression>, ... ])
 *   this.<fb>.group({ name: <entry>, ... })   (<fb> a FormBuilder dep)
 *   this.<fb>.control(<literal>, Validators.x)
 *   this.<fb>.array([ <entry>, ... ])
 *
 * where a form node expression is any of the `new ...` shapes or a
 * nested builder call, a builder <entry> is a form node expression, a
 * plain literal (a control holding it), or a tuple
 * [ <literal>, Validators.x | [Validators.x, ...] ], a literal is a
 * string, number, boolean, null, or unary-minus number, and validator
 * arguments are literals. Anything richer is reported as unsupported:
 * the generated app still runs the initializer verbatim (it is the
 * author's real code), only the preview cannot build the instance,
 * and compile.ts says so with GEN_FORM_INITIALIZER.
 */

export type FormKind = 'group' | 'control' | 'array';

export interface FormFieldInfo {
  kind: FormKind;
  /** Control names of a FormGroup, when its config is an object literal. */
  controlNames: string[];
  /** The kind of each named control of a group, when known. */
  controlKinds: Record<string, FormKind>;
  /** True when the preview evaluator below can build the instance. */
  supported: boolean;
  /** Why not, when supported is false. */
  reason?: string;
  /**
   * The constructor dep the initializer calls, when it is a builder
   * initializer (`this.fb.group(...)`): codegen rewrites `this.fb` to
   * the generated dep local of the same name.
   */
  builderDep?: string;
}

const FORM_NEW_RE = /^\s*new\s+(FormGroup|FormControl|FormArray)\s*\(/;
const FORM_BUILDER_RE = /^\s*this\.([A-Za-z_$][\w$]*)\.(group|control|array)\s*\(/;

/**
 * True for field initializers that build a form tree: a `new
 * FormGroup/FormControl/FormArray(...)`, or a call on a FormBuilder
 * constructor dep (`this.fb.group(...)`) when the dep name is in
 * builderDeps.
 */
export function isFormInitializer(initializer: string | undefined, builderDeps?: Set<string>): boolean {
  if (!initializer) return false;
  if (FORM_NEW_RE.test(initializer)) return true;
  const m = FORM_BUILDER_RE.exec(initializer);
  return !!m && !!builderDeps && builderDeps.has(m[1]);
}

/** The FormBuilder constructor dep names of a host component or service. */
export function builderDepsOf(host: { constructorDeps?: { propertyName: string; typeName: string }[] }): Set<string> {
  return new Set((host.constructorDeps ?? [])
    .filter((d) => d.typeName === 'FormBuilder')
    .map((d) => d.propertyName));
}

/** Parse `const __x = <initializer>;` and return its top-level expression. */
function topExpression(initializer: string): ts.Expression | undefined {
  const sf = ts.createSourceFile(
    'form-init.ts',
    `const __x = ${initializer};`,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && node.initializer) {
      found = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** The builder call parts of `this.<dep>.<method>(...)`, when it is one. */
function builderCallOf(node: ts.Expression): { dep: string; method: string; args: readonly ts.Expression[] } | undefined {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return undefined;
  const target = node.expression.expression;
  if (!ts.isPropertyAccessExpression(target) || target.expression.kind !== ts.SyntaxKind.ThisKeyword) return undefined;
  const method = node.expression.name.text;
  if (method !== 'group' && method !== 'control' && method !== 'array') return undefined;
  return { dep: target.name.text, method, args: node.arguments };
}

/** The kind one config entry builds, from its shape alone. */
function kindOfEntry(node: ts.Expression): FormKind {
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
    if (node.expression.text === 'FormGroup') return 'group';
    if (node.expression.text === 'FormArray') return 'array';
    return 'control';
  }
  const call = builderCallOf(node);
  if (call) return call.method === 'group' ? 'group' : call.method === 'array' ? 'array' : 'control';
  return 'control';
}

function kindsOfConfig(config: ts.Expression | undefined): { controlNames: string[]; controlKinds: Record<string, FormKind> } {
  const controlNames: string[] = [];
  const controlKinds: Record<string, FormKind> = {};
  if (config && ts.isObjectLiteralExpression(config)) {
    for (const prop of config.properties) {
      if (ts.isPropertyAssignment(prop)) {
        const name = prop.name.getText().replace(/^['"]|['"]$/g, '');
        controlNames.push(name);
        controlKinds[name] = kindOfEntry(prop.initializer);
      }
    }
  }
  return { controlNames, controlKinds };
}

/** Kind and group control names from the initializer's shape alone. */
export function formFieldKind(
  initializer: string,
  builderDeps?: Set<string>,
): { kind: FormKind; controlNames: string[]; controlKinds: Record<string, FormKind>; builderDep?: string } {
  const expr = topExpression(initializer);
  if (!expr) return { kind: 'control', controlNames: [], controlKinds: {} };
  if (ts.isNewExpression(expr) && ts.isIdentifier(expr.expression)) {
    if (expr.expression.text === 'FormGroup') {
      return { kind: 'group', ...kindsOfConfig(expr.arguments?.[0]) };
    }
    if (expr.expression.text === 'FormArray') return { kind: 'array', controlNames: [], controlKinds: {} };
    return { kind: 'control', controlNames: [], controlKinds: {} };
  }
  const call = builderCallOf(expr);
  if (call && builderDeps && builderDeps.has(call.dep)) {
    if (call.method === 'group') {
      return { kind: 'group', ...kindsOfConfig(call.args[0]), builderDep: call.dep };
    }
    return { kind: call.method === 'array' ? 'array' : 'control', controlNames: [], controlKinds: {}, builderDep: call.dep };
  }
  return { kind: 'control', controlNames: [], controlKinds: {} };
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

/** One builder config entry: a node expression, a tuple, or a literal. */
function evalBuilderEntry(node: ts.Expression): FormNode {
  if (ts.isArrayLiteralExpression(node)) {
    const initial = node.elements[0] ? evalLiteral(node.elements[0]) : null;
    return new FormControl(initial, evalValidators(node.elements[1]));
  }
  if (ts.isNewExpression(node) || ts.isCallExpression(node)) return evalFormNode(node);
  return new FormControl(evalLiteral(node));
}

function evalFormNode(node: ts.Expression): FormNode {
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
    if (node.expression.text === 'FormControl') {
      const args = node.arguments ?? [];
      const initial = args[0] ? evalLiteral(args[0]) : null;
      return new FormControl(initial, evalValidators(args[1]));
    }
    if (node.expression.text === 'FormGroup') {
      const config = node.arguments?.[0];
      if (!config || !ts.isObjectLiteralExpression(config)) {
        throw new Unsupported('a FormGroup config must be an object literal of form nodes');
      }
      const controls: Record<string, FormNode> = {};
      for (const prop of config.properties) {
        if (!ts.isPropertyAssignment(prop)) {
          throw new Unsupported('FormGroup entries must be name: <form node> pairs');
        }
        const name = prop.name.getText().replace(/^['"]|['"]$/g, '');
        controls[name] = evalFormNode(prop.initializer);
      }
      return new FormGroup(controls);
    }
    if (node.expression.text === 'FormArray') {
      const list = node.arguments?.[0];
      if (!list || !ts.isArrayLiteralExpression(list)) {
        throw new Unsupported('a FormArray argument must be an array literal of form nodes');
      }
      return new FormArray(list.elements.map(evalFormNode));
    }
    throw new Unsupported(`new ${node.expression.text}(...) is not a form class`);
  }
  const call = builderCallOf(node);
  if (call) {
    if (call.method === 'control') {
      const initial = call.args[0] ? evalLiteral(call.args[0]) : null;
      return new FormControl(initial, evalValidators(call.args[1]));
    }
    if (call.method === 'group') {
      const config = call.args[0];
      if (!config || !ts.isObjectLiteralExpression(config)) {
        throw new Unsupported('a builder group config must be an object literal');
      }
      const controls: Record<string, FormNode> = {};
      for (const prop of config.properties) {
        if (!ts.isPropertyAssignment(prop)) {
          throw new Unsupported('builder group entries must be name: <entry> pairs');
        }
        const name = prop.name.getText().replace(/^['"]|['"]$/g, '');
        controls[name] = evalBuilderEntry(prop.initializer);
      }
      return new FormGroup(controls);
    }
    const list = call.args[0];
    if (!list || !ts.isArrayLiteralExpression(list)) {
      throw new Unsupported('a builder array argument must be an array literal');
    }
    return new FormArray(list.elements.map(evalBuilderEntry));
  }
  throw new Unsupported('expected new FormControl(...), new FormGroup(...), new FormArray(...) or a FormBuilder call');
}

/**
 * Rewrite the `this.<dep>` roots of a builder initializer to the bare
 * dep name, for generated code: the generated component holds the
 * injected FormBuilder in a local of the dep's own name, so
 * `this.fb.group(...)` becomes `fb.group(...)`, nested builder calls
 * included. Spans come from the TypeScript AST, so the text of a
 * string literal in the config is never touched.
 */
export function rewriteBuilderInitializer(initializer: string, dep: string): string {
  const prefix = 'const __x = ';
  const sf = ts.createSourceFile(
    'form-init.ts',
    `${prefix}${initializer};`,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );
  const spans: { start: number; end: number }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)
      && node.expression.kind === ts.SyntaxKind.ThisKeyword
      && node.name.text === dep) {
      spans.push({ start: node.getStart() - prefix.length, end: node.name.getEnd() - prefix.length });
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  let out = initializer;
  for (const span of spans.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, span.start) + dep + out.slice(span.end);
  }
  return out;
}

/**
 * Analyse one form field initializer: its kind, its group control
 * names and kinds, and whether the preview can evaluate it.
 * builderDeps names the component's FormBuilder constructor deps, so
 * `this.fb.group(...)` initializers are recognised as builder calls.
 */
export function analyzeFormInitializer(initializer: string, builderDeps?: Set<string>): FormFieldInfo {
  const { kind, controlNames, controlKinds, builderDep } = formFieldKind(initializer, builderDeps);
  const expr = topExpression(initializer);
  if (!expr) return { kind, controlNames, controlKinds, supported: false, reason: 'the initializer could not be parsed', builderDep };
  try {
    evalFormNode(expr);
    return { kind, controlNames, controlKinds, supported: true, builderDep };
  } catch (e) {
    return {
      kind, controlNames, controlKinds, supported: false,
      reason: e instanceof Unsupported ? e.message : 'the initializer could not be evaluated',
      builderDep,
    };
  }
}

/**
 * Build the real runtime instance for a form field initializer, for
 * the preview's server-side paint. Fails with { ok: false } on the
 * same shapes analyzeFormInitializer reports as unsupported.
 */
export function evaluateFormInitializer(
  initializer: string,
  builderDeps?: Set<string>,
): { ok: true; value: FormNode } | { ok: false; reason: string } {
  const expr = topExpression(initializer);
  if (!expr) return { ok: false, reason: 'the initializer could not be parsed' };
  try {
    void builderDeps;
    return { ok: true, value: evalFormNode(expr) };
  } catch (e) {
    return { ok: false, reason: e instanceof Unsupported ? e.message : 'the initializer could not be evaluated' };
  }
}
