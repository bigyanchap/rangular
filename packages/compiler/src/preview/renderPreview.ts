import { colours, theme } from '../../../ui/src/tokens';
import { ICON_PATHS, ICON_SIZES, DEFAULT_ICON_SIZE } from '../../../ui/src/icons';
import { formatDateTimeValue, parseDateTimeValue } from '../../../ui/src/datetime';
import type { PickerMode } from '../../../ui/src/datetime';
import { ActivatedRoute, FormGroup, matchRoute, RouteMatch, ValidatorFn, Validators, validateValue } from '../../../runtime/src/index';
import { ComponentField, ComponentInfo, DirectiveInfo, PipeInfo, ServiceInfo } from '../class/parseComponent';
import { DirectiveStyleAssign, directiveStyles } from '../class/parseDirective';
import { ResolvedRoute } from '../class/parseRoutes';
import { evaluateFormInitializer, isFormInitializer } from '../class/formInit';
import { ChildUnitInput, outputPropName, verbatimInitFields } from '../codegen/generate';
import { translateMethods } from '../codegen/methods';
import { nearestOnScale } from '../style/css';
import { ElementNode, TemplateNode, TemplateRoot } from '../template/ast';
import { evaluateExpression, PipeFunctions, Scope } from '../template/evaluate';
import { ngModelBindingOf, plainFieldOf, ValidatorSpec, validatorsOf } from '../template/forms';
import { evaluateExprInitializer, literalValue } from '../template/literal';
import { parseNgFor, parseNgIf } from '../template/structural';

/**
 * Stage 3 preview data: the child components and services the compiler
 * resolved through the entry component's imports. Child components render
 * recursively (inputs evaluated in the parent scope, outputs wired to the
 * parent handler), and every component that injects a service sees the
 * same singleton service object, in the server paint and in the page.
 */
export interface PreviewData {
  children?: ChildUnitInput[];
  services?: ServiceInfo[];
  /**
   * The resolved route table (Stage 9). The server paint renders the
   * initial route (the match for the empty path, redirects followed)
   * into the shell's <router-outlet>; the page runtime navigates.
   */
  routes?: ResolvedRoute[];
  /** Custom @Pipe classes resolved in this compilation (Stage 12). */
  pipes?: PipeInfo[];
  /** Attribute @Directive classes resolved in this compilation (Stage 12). */
  directives?: DirectiveInfo[];
}

/**
 * Dev preview renderer (Stage 2: interactive).
 *
 * Renders the same template AST the codegen consumes into a standalone
 * HTML page that mimics the React Native screen, using the Rangular
 * Material tokens. The page is a working preview:
 *
 *  - the component's literal field values become a JS `state` object;
 *  - its methods are translated (same subset as codegen, state mode) into
 *    JS functions that mutate `state` and trigger a re-render;
 *  - the template AST is embedded as JSON and re-rendered by a small
 *    in-page runtime (parser + evaluator + DOM builder, generated below),
 *    so (click) handlers, *ngIf and *ngFor behave like they will in RN.
 *
 * The initial HTML is also server-rendered with the compiler's own
 * expression evaluator, so the page is correct before the script runs.
 * Arbitrary expressions are never executed at compile time beyond the
 * safe AST evaluator, no eval/Function anywhere.
 */

/** Evaluate a literal initializer (now including nested arrays/objects). */
export function evaluateLiteral(initializer: string): unknown {
  const r = literalValue(initializer);
  return r.ok ? r.value : undefined;
}

/**
 * Add the reactive form instances of a host's fields to a preview state
 * (Stage 8): a field initialised with new FormGroup(...) or
 * new FormControl(...) becomes the real runtime instance, built by the
 * shared initializer evaluator. Initializers outside the supported
 * subset are skipped here; compile.ts reports them with
 * GEN_FORM_INITIALIZER.
 */
function addFormInstances(state: Record<string, unknown>, fields: ComponentField[]): void {
  for (const f of fields) {
    if (!f.initializer || !isFormInitializer(f.initializer)) continue;
    const built = evaluateFormInitializer(f.initializer);
    if (built.ok) state[f.name] = built.value;
  }
}

/**
 * Add the verbatim-initializer fields of a component to a preview
 * state (proof fix): the fields codegen declares by emitting their
 * initializer verbatim (`today = new Date()` is the classic case).
 * Only the scope-free shapes evaluateExprInitializer supports land a
 * value; anything richer leaves the field unset, so reads of it yield
 * undefined here exactly as the generated fallback declares it there.
 */
function addExprInstances(
  state: Record<string, unknown>,
  component: { fields: ComponentField[]; methods: string[]; methodDetails: ComponentInfo['methodDetails'] },
): void {
  for (const f of verbatimInitFields(component)) {
    const built = evaluateExprInitializer(f.initializer);
    if (built.ok) state[f.name] = built.value;
  }
}

/** The verbatim-initializer fields of a host, field name -> source text. */
function exprInitsOf(component: {
  fields: ComponentField[]; methods: string[]; methodDetails: ComponentInfo['methodDetails'];
}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of verbatimInitFields(component)) out[f.name] = f.initializer;
  return out;
}

/** The preview state: every field whose initializer is a literal structure. */
export function componentState(component: ComponentInfo): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  for (const f of component.fields) {
    if (f.isInput || f.isOutput || !f.initializer) continue;
    const v = evaluateLiteral(f.initializer);
    if (v !== undefined) state[f.name] = v;
  }
  addFormInstances(state, component.fields);
  addExprInstances(state, component);
  return state;
}

/**
 * State for a child component or a service: like componentState, but
 * @Input literal initializers are included, they are the input defaults.
 */
function stateWithInputs(host: { fields: ComponentField[] }): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  for (const f of host.fields) {
    if (f.isOutput || !f.initializer) continue;
    const v = evaluateLiteral(f.initializer);
    if (v !== undefined) state[f.name] = v;
  }
  addFormInstances(state, host.fields);
  return state;
}

/** The form field initializers of a host, field name -> source text (Stage 8). */
function formInitsOf(host: { fields: ComponentField[] }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of host.fields) {
    if (f.initializer && isFormInitializer(f.initializer)) out[f.name] = f.initializer;
  }
  return out;
}

/** Preview stand-in for HttpClient: get() returns an Observable that never emits. */
const HTTP_STUB = {
  get: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }),
};

/** Preview stand-in for Router in the static paint: navigation is a page-runtime behaviour. */
const ROUTER_STUB = {
  navigate: () => true,
  navigateByUrl: () => true,
};

/** Preview stand-in for SnackBar in the static paint: page runtime owns live bars. */
const SNACK_STUB = {
  open: () => ({ onAction: () => undefined, dismiss: () => undefined }),
};

/**
 * Singleton service objects for the server-side paint. Fields hold their
 * literal values (the SAME object is shared by every component that
 * injects the service, so a *ngFor over mail.mails works); methods are
 * inert, the interactive page replaces them with the real translated
 * methods. Service state mutation is a page-runtime behaviour.
 */
function buildServiceScopes(services: ServiceInfo[]): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  const byName = new Map(services.map((s) => [s.className, s]));
  const build = (svc: ServiceInfo): Record<string, unknown> => {
    const existing = map.get(svc.className);
    if (existing) return existing;
    const obj: Record<string, unknown> = { ...stateWithInputs(svc) };
    map.set(svc.className, obj);
    for (const m of svc.methods) obj[m] = () => undefined;
    for (const dep of svc.constructorDeps) {
      const depSvc = byName.get(dep.typeName);
      if (depSvc && depSvc.providedInRoot) obj[dep.propertyName] = build(depSvc);
      else if (dep.typeName === 'HttpClient') obj[dep.propertyName] = HTTP_STUB;
    }
    return obj;
  };
  for (const svc of services) if (svc.providedInRoot) build(svc);
  return map;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Colour role name to CSS variable suffix: onPrimaryContainer -> on-primary-container. */
export function kebabRole(role: string): string {
  return role.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * One icon as inline SVG (Stage 7). The path data is ICON_PATHS itself,
 * the same data RgIcon draws in a generated app through
 * react-native-svg, so the preview and the app show the identical
 * drawing. The fill is currentColor; a colour role wraps the SVG in a
 * span coloured by that role's CSS variable, so the theme toggle
 * recolours icons exactly like every other role.
 */
export function iconSvg(name: string, size: number, colorRole?: string): string {
  const paths = ICON_PATHS[name];
  if (!paths || !paths.length) return '';
  const body = paths.map((d) => `<path d="${d}"/>`).join('');
  const style = colorRole ? ` style="color: var(--role-${kebabRole(colorRole)})"` : '';
  return `<span class="icon"${style}><svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${body}</svg></span>`;
}

/**
 * The spinner arc path (Stage 11): a 270 degree arc in the 24 by 24
 * icon box. This is the same constant RgSpinner exports as
 * SPINNER_ARC in @rangular/ui and the page runtime draws, so all
 * three renderers show the identical arc; a test pins the three
 * copies together.
 */
export const SPINNER_ARC_PATH = 'M 12 3 A 9 9 0 1 1 3 12';

/**
 * The badge display text (Stage 11), mirroring badgeTextOf in
 * @rangular/ui: 0 or empty hides the badge, a number above 99 shows
 * as 99+, a non-numeric string shows as itself; null means no badge.
 */
export function badgeTextOf(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (Number.isFinite(n)) {
    if (n <= 0) return null;
    return n > 99 ? '99+' : String(Math.trunc(n));
  }
  return String(value);
}

const UNSET = Symbol('unset');

/** Evaluate an expression against a scope; UNSET on any failure. */
function evalSafeModule(source: string, scope: Scope, refs?: Scope, pipes?: PipeFunctions): unknown {
  try {
    const v = evaluateExpression(source, scope, refs, pipes);
    return v === undefined ? UNSET : v;
  } catch {
    return UNSET;
  }
}

/**
 * The server paint's custom pipe functions (Stage 12). A transform
 * whose body is a single return statement is evaluated with the safe
 * expression evaluator: the return expression runs against the
 * transform's parameters and a `this` holding the pipe's literal
 * fields. Richer bodies cannot run in a pure paint (no eval, ever),
 * so their function returns undefined and the interpolation paints
 * empty; the interactive page below runs the full translated body,
 * and the generated app runs the real class. That boundary is stated
 * in docs/VIBE_CODING.md.
 */
function buildPipeFunctions(pipes: PipeInfo[] | undefined): PipeFunctions {
  const fns: PipeFunctions = {};
  for (const pipe of pipes ?? []) {
    if (!pipe.transformReturn || !pipe.transformParams.length) {
      fns[pipe.pipeName] = () => undefined;
      continue;
    }
    const fieldsObj: Record<string, unknown> = {};
    for (const f of pipe.fields) {
      if (!f.initializer) continue;
      const v = evaluateLiteral(f.initializer);
      if (v !== undefined) fieldsObj[f.name] = v;
    }
    const returnSource = pipe.transformReturn;
    const params = pipe.transformParams;
    fns[pipe.pipeName] = (value: unknown, ...args: unknown[]) => {
      const scope: Scope = { this: fieldsObj };
      params.forEach((name, i) => {
        scope[name] = i === 0 ? value : args[i - 1];
      });
      try {
        return evaluateExpression(returnSource, scope, undefined, fns);
      } catch {
        return undefined;
      }
    };
  }
  return fns;
}

/** One resolved directive for the painters: extraction shared with codegen. */
export interface PreviewDirective {
  attr: string;
  info: DirectiveInfo;
  assignments: DirectiveStyleAssign[];
  unsupported?: string;
}

export function previewDirectives(directives: DirectiveInfo[] | undefined): PreviewDirective[] {
  const out: PreviewDirective[] = [];
  for (const info of directives ?? []) {
    if (!info.attrName) continue;
    const styles = directiveStyles(info);
    out.push({
      attr: info.attrName,
      info,
      assignments: styles.assignments,
      unsupported: styles.unsupported,
    });
  }
  return out;
}

/** One validator spec as a runtime ValidatorFn, its argument evaluated in scope. */
function validatorFnOf(spec: ValidatorSpec, scope: Scope): ValidatorFn {
  const arg = spec.argSource === undefined ? undefined : evalSafeModule(spec.argSource, scope);
  switch (spec.fn) {
    case 'required': return Validators.required;
    case 'email': return Validators.email;
    case 'minLength': return Validators.minLength(typeof arg === 'number' ? arg : 0);
    case 'maxLength': return Validators.maxLength(typeof arg === 'number' ? arg : 0);
    case 'pattern': return Validators.pattern(typeof arg === 'string' ? arg : '');
  }
}

/** The theme a component declares on its root <screen theme="..."> (default light). */
export function declaredThemeOf(ast: TemplateRoot): 'light' | 'dark' {
  const screenEl = ast.children.find(
    (n): n is ElementNode => n.type === 'element' && n.tag === 'screen',
  );
  return screenEl?.attrs['theme'] === 'dark' ? 'dark' : 'light';
}

/** The preview's colour roles as CSS custom properties for one theme mode. */
function cssVars(mode: 'light' | 'dark'): string {
  const cc = colours[mode];
  return [
    `--screen-bg: ${cc.background}`,
    `--surface-variant: ${cc.surfaceVariant}`,
    `--text: ${cc.text}`,
    `--text-muted: ${cc.textMuted}`,
    `--primary: ${cc.primary}`,
    `--on-primary: ${cc.onPrimary}`,
    `--primary-container: ${cc.primaryContainer}`,
    `--on-primary-container: ${cc.onPrimaryContainer}`,
    `--border: ${cc.border}`,
    `--avatar: ${cc.avatar}`,
    `--on-avatar: ${cc.onAvatar}`,
    // Stage 7: every colour role also gets a --role-* variable, so an
    // <icon color="..."> can name any role and follow the theme toggle.
    ...Object.entries(cc).map(([role, value]) => `--role-${kebabRole(role)}: ${value}`),
  ].join('; ') + ';';
}

export function renderPreview(component: ComponentInfo, ast: TemplateRoot, data: PreviewData = {}): string {
  const t = theme('light');
  const declaredTheme = declaredThemeOf(ast);
  const state = componentState(component);
  const baseScope: Scope = { ...state };

  // --- Stage 3: child components + injected services -----------------------
  const childDefs = new Map<string, ChildUnitInput>();
  for (const child of data.children ?? []) {
    if (child.info.selector) childDefs.set(child.info.selector, child);
  }
  const serviceScopes = buildServiceScopes(data.services ?? []);
  // --- Stage 12: custom pipes, directives, projected content ---------------
  // Every expression the paint evaluates goes through this shadow of
  // the module evalSafe, which threads the compilation's custom pipe
  // functions into the evaluator.
  const pipeFns = buildPipeFunctions(data.pipes);
  const evalSafe = (source: string, scope: Scope, refs?: Scope): unknown =>
    evalSafeModule(source, scope, refs, pipeFns);
  const directiveDefs = previewDirectives(data.directives);
  /**
   * The projected content in flight (Stage 12): while a child
   * component's template paints, this holds the children written
   * inside its tag, the scope they were written in, and the content
   * that was in flight outside (for content that itself projects).
   */
  let currentContent: {
    nodes: TemplateNode[];
    scope: Scope;
    outer?: { nodes: TemplateNode[]; scope: Scope; outer?: unknown };
  } | undefined;
  // --- Routing (Stage 9): the initial entry the static paint shows.
  // The runtime matcher resolves the empty path (redirects followed);
  // an unmatched start falls back to an empty entry and an empty outlet.
  const initialEntry: RouteMatch = (data.routes?.length
    ? matchRoute(data.routes.map((r) => ({ path: r.path, redirectTo: r.redirectTo })), '')
    : null) ?? { path: '', params: {}, routePath: '' };
  const assignDeps = (scope: Scope, info: ComponentInfo): void => {
    for (const dep of info.constructorDeps ?? []) {
      const svc = serviceScopes.get(dep.typeName);
      if (svc) scope[dep.propertyName] = svc;
      else if (dep.typeName === 'HttpClient') scope[dep.propertyName] = HTTP_STUB;
      else if (dep.typeName === 'ActivatedRoute') scope[dep.propertyName] = new ActivatedRoute(initialEntry.params);
      else if (dep.typeName === 'Router') scope[dep.propertyName] = ROUTER_STUB;
      else if (dep.typeName === 'SnackBar') scope[dep.propertyName] = SNACK_STUB;
    }
  };
  assignDeps(baseScope, component);

  // --- Template references (Stage 8) ---------------------------------------
  // The ngModel refs of the component whose template is being painted:
  // #email="ngModel" exposes the input's live validation state
  // (value, errors, valid, invalid, touched) to template expressions.
  // The static paint is the pre-interaction paint, so touched is false.
  // Child components compute their own refs when they render.
  let currentRefs: Scope = {};
  const computeRefs = (nodes: TemplateNode[], stateObj: Scope, scope: Scope): Scope => {
    const refs: Scope = {};
    const walk = (list: TemplateNode[]): void => {
      for (const node of list) {
        if (node.type !== 'element') continue;
        if (childDefs.has(node.tag)) continue;
        if (node.tag.toLowerCase() === 'input' && node.ref && node.refExport === 'ngModel') {
          const ng = ngModelBindingOf(node);
          const field = ng ? plainFieldOf(ng.expression) : undefined;
          if (field) {
            const errors = validateValue(
              stateObj[field],
              validatorsOf(node).filter((spec) => !spec.argInvalid)
                .map((spec) => validatorFnOf(spec, scope)),
            );
            refs[node.ref] = {
              value: stateObj[field],
              errors,
              valid: errors === null,
              invalid: errors !== null,
              touched: false,
            };
          }
        }
        walk(node.children);
      }
    };
    walk(nodes);
    return refs;
  };
  currentRefs = computeRefs(ast.children, state, baseScope);

  const renderNodes = (nodes: TemplateNode[], scope: Scope): string =>
    nodes.map((n) => renderNode(n, scope)).join('\n');

  const renderNode = (node: TemplateNode, scope: Scope): string => {
    if (node.type === 'text') {
      return node.parts
        .map((p) => {
          if (p.type === 'static') return escapeHtml(p.value);
          const v = evalSafe(p.expression, scope, currentRefs);
          return v === UNSET ? escapeHtml(`{{ ${p.expression} }}`) : escapeHtml(String(v ?? ''));
        })
        .join('');
    }
    return renderElement(node, scope);
  };

  /** A [prop] binding evaluated in scope, falling back to the static attr. */
  const bound = (el: ElementNode, name: string, scope: Scope): string | undefined => {
    const b = el.propBindings.find((x) => x.name === name);
    if (b) {
      const v = evalSafe(b.expression, scope, currentRefs);
      if (v !== UNSET) return String(v ?? '');
    }
    return el.attrs[name];
  };

  /** A [prop] binding in its real JS type (Stage 6 controls need booleans). */
  const rawBound = (el: ElementNode, name: string, scope: Scope): unknown => {
    const b = el.propBindings.find((x) => x.name === name);
    if (b) {
      const v = evalSafe(b.expression, scope, currentRefs);
      if (v !== UNSET) return v;
    }
    if (el.booleanAttrs.includes(name)) return true;
    return el.attrs[name];
  };

  const truthy = (value: unknown): boolean => value === true || value === 'true';

  /** The badge count dot for a host element (Stage 11), or ''. */
  const badgeHtml = (el: ElementNode, scope: Scope): string => {
    const text = badgeTextOf(rawBound(el, 'badge', scope));
    return text === null ? '' : `<span class="badge-dot">${escapeHtml(text)}</span>`;
  };

  // Accordion single-open coordination for the static paint (Stage
  // 11): while an <accordion> paints its children, the first panel
  // whose [expanded] seed is open claims the one open slot through
  // this hook; panels outside an accordion find it null.
  let panelClaim: (() => boolean) | null = null;

  /** A slider/progress number from an attribute or binding, with fallback. */
  const numOf = (el: ElementNode, name: string, scope: Scope, fallback: number): number => {
    const v = rawBound(el, name, scope);
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    return Number.isFinite(n) ? n : fallback;
  };

  /** An <icon> size resolved and snapped to the icon size scale (Stage 7). */
  const iconSizeOf = (el: ElementNode, scope: Scope): number => {
    const v = rawBound(el, 'size', scope);
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    return Number.isFinite(n) ? nearestOnScale(ICON_SIZES, n) : DEFAULT_ICON_SIZE;
  };

  const renderElement = (el: ElementNode, scope: Scope): string => {
    if (el.structural?.name === 'ngIf') {
      const parts = parseNgIf(el.structural.expression);
      const v = evalSafe(parts.condition, scope, currentRefs);
      if (v === UNSET || !v) return '';
      return renderCore({ ...el, structural: undefined }, scope);
    }
    if (el.structural?.name === 'ngFor') {
      const { parts } = parseNgFor(el.structural.expression);
      if (!parts) return '';
      const items = evalSafe(parts.source, scope, currentRefs);
      if (!Array.isArray(items)) return '';
      return items
        .map((item, idx) => {
          const childScope: Scope = { ...scope, [parts.itemVar]: item };
          if (parts.indexVar) childScope[parts.indexVar] = idx;
          return renderCore({ ...el, structural: undefined }, childScope);
        })
        .join('\n');
    }
    return renderCore(el, scope);
  };

  /**
   * Render a child component element (Stage 3, M5): inputs are evaluated
   * in the parent scope (prop bindings), static attributes arrive as
   * strings, and the child's own template renders in the child's scope.
   * Outputs do nothing in the static paint, the page runtime wires them.
   * ngOnInit is not run for the static paint: it shows pre-init state.
   */
  const renderChild = (el: ElementNode, def: ChildUnitInput, parentScope: Scope): string => {
    const scope: Scope = { ...stateWithInputs(def.info) };
    addExprInstances(scope, def.info);
    const inputNames = new Set(def.info.fields.filter((f) => f.isInput).map((f) => f.name));
    for (const b of el.propBindings) {
      if (!inputNames.has(b.name)) continue;
      const v = evalSafe(b.expression, parentScope, currentRefs);
      if (v !== UNSET) scope[b.name] = v;
    }
    for (const [name, value] of Object.entries(el.attrs)) {
      if (inputNames.has(name)) scope[name] = value;
    }
    for (const a of el.booleanAttrs) if (inputNames.has(a)) scope[a] = true;
    assignDeps(scope, def.info);
    // The child's template reads its own ngModel refs (Stage 8).
    const parentRefs = currentRefs;
    currentRefs = computeRefs(def.ast.children, scope, scope);
    // Content projection (Stage 12): the children written inside the
    // child's tag become the content its <ng-content> renders, in the
    // parent scope they were written in.
    const parentContent = currentContent;
    currentContent = {
      nodes: el.children,
      scope: parentScope,
      outer: parentContent as { nodes: TemplateNode[]; scope: Scope; outer?: unknown } | undefined,
    };
    const html = renderNodes(def.ast.children, scope);
    currentContent = parentContent;
    currentRefs = parentRefs;
    return html;
  };

  /**
   * The inline style attribute a host element's directives compute
   * (Stage 12), or '' when no directive applies. Input values resolve
   * like codegen's: a binding wins over a static attribute, which
   * wins over the declared default. Values are escaped for the
   * attribute; the property names come from the directive class
   * itself (identifiers from its own source, validated by the
   * extractor's grammar).
   */
  const directiveStyleAttr = (el: ElementNode, scope: Scope): string => {
    const parts: string[] = [];
    for (const d of directiveDefs) {
      if (d.unsupported) continue;
      const present = el.attrs[d.attr] !== undefined
        || el.propBindings.some((b) => b.name === d.attr)
        || el.booleanAttrs.includes(d.attr);
      if (!present) continue;
      const inputScope: Scope = { ...scope };
      for (const input of d.info.inputs) {
        const binding = el.propBindings.find((b) => b.name === input.name);
        if (binding) {
          const v = evalSafe(binding.expression, scope, currentRefs);
          if (v !== UNSET) { inputScope[input.name] = v; continue; }
        }
        if (el.attrs[input.name] !== undefined) { inputScope[input.name] = el.attrs[input.name]; continue; }
        if (el.booleanAttrs.includes(input.name)) { inputScope[input.name] = true; continue; }
        if (input.initializer) {
          const v = evaluateLiteral(input.initializer);
          if (v !== undefined) inputScope[input.name] = v;
        }
      }
      for (const a of d.assignments) {
        const v = evalSafe(a.rhs, inputScope, currentRefs);
        if (v === UNSET || v === undefined || v === null) continue;
        if (typeof v !== 'string' && typeof v !== 'number') continue;
        const cssProp = a.prop.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
        parts.push(`${cssProp}: ${String(v)}`);
      }
    }
    return parts.length ? ` style="${escapeHtml(parts.join('; '))}"` : '';
  };

  const renderCore = (el: ElementNode, scope: Scope): string => {
    // Content projection (Stage 12): <ng-content> paints the content
    // in flight, in its own scope, with the outer content restored
    // for any <ng-content> inside the projected nodes themselves.
    if (el.tag === 'ng-content') {
      if (!currentContent) return '';
      const content = currentContent;
      const saved = currentContent;
      currentContent = content.outer as typeof currentContent;
      const html = renderNodes(content.nodes, content.scope);
      currentContent = saved;
      return html;
    }
    const childDef = childDefs.get(el.tag);
    if (childDef) return renderChild(el, childDef, scope);
    // Routing (Stage 9): the outlet paints the initial route's
    // component, resolved through the same child machinery; the page
    // runtime takes over navigation from there.
    if (el.tag === 'router-outlet') {
      const route = (data.routes ?? []).find((r) => r.path === initialEntry.routePath && r.selector);
      const def = route?.selector ? childDefs.get(route.selector) : undefined;
      if (!route || !def) return '';
      const synthetic: ElementNode = {
        type: 'element', tag: route.selector!, attrs: {}, booleanAttrs: [],
        propBindings: [], twoWayBindings: [], eventBindings: [], children: [], pos: el.pos,
      };
      return renderChild(synthetic, def, scope);
    }
    // Forms (Stage 8): a form paints as a plain wrapper; its [formGroup]
    // instance is handed to descendant inputs through the scope so a
    // formControlName input paints its control's current value. The
    // static paint is pre-interaction, like every other control.
    if (el.tag === 'form') {
      const fg = el.propBindings.find((b) => b.name === 'formGroup');
      let childScope = scope;
      if (fg) {
        const g = evalSafe(fg.expression, scope, currentRefs);
        if (g !== UNSET && g !== null && g !== undefined) {
          childScope = { ...scope, __formGroup: g };
        }
      }
      return `<div class="form">${renderNodes(el.children, childScope)}</div>`;
    }
    if (el.tag === 'input') {
      const labelText = bound(el, 'label', scope);
      const placeholder = bound(el, 'placeholder', scope);
      const errorText = bound(el, 'error', scope);
      let value = '';
      const fcn = el.attrs['formControlName'];
      const group = scope['__formGroup'] as FormGroup | undefined;
      const ng = ngModelBindingOf(el);
      const valueBinding = el.propBindings.find((b) => b.name === 'value');
      if (fcn !== undefined && group && typeof group.get === 'function') {
        const control = group.get(fcn);
        if (control) value = String(control.value ?? '');
      } else if (ng) {
        const v = evalSafe(ng.expression, scope, currentRefs);
        if (v !== UNSET) value = String(v ?? '');
      } else if (valueBinding) {
        const v = evalSafe(valueBinding.expression, scope, currentRefs);
        if (v !== UNSET) value = String(v ?? '');
      } else if (el.attrs['value'] !== undefined) {
        value = el.attrs['value'];
      }
      const typeAttr = el.attrs['type'];
      const inputType = typeAttr === 'password' ? 'password'
        : typeAttr === 'email' ? 'email'
        : typeAttr === 'number' ? 'number' : 'text';
      const disabled = truthy(rawBound(el, 'disabled', scope));
      return `<div class="field">` +
        (labelText ? `<span class="field-label">${escapeHtml(labelText)}</span>` : '') +
        `<input class="field-input" type="${inputType}"${placeholder ? ` placeholder="${escapeHtml(placeholder)}"` : ''} value="${escapeHtml(value)}"${disabled ? ' disabled' : ''}>` +
        (errorText ? `<span class="field-error">${escapeHtml(errorText)}</span>` : '') +
        `</div>`;
    }
    if (el.tag === 'datetime-picker') {
      const labelText = bound(el, 'label', scope);
      const rawMode = bound(el, 'mode', scope) ?? 'datetime';
      const mode: PickerMode = rawMode === 'date' || rawMode === 'time' ? rawMode : 'datetime';
      const rawValue = rawBound(el, 'value', scope);
      const parts = parseDateTimeValue(rawValue);
      const display = parts ? formatDateTimeValue(parts, mode) : rawValue === undefined ? '' : String(rawValue ?? '');
      return `<div class="field">` +
        (labelText ? `<span class="field-label">${escapeHtml(labelText)}</span>` : '') +
        `<div class="picker-box"><span class="picker-value">${escapeHtml(display)}</span>${iconSvg('calendar', 20, 'textMuted')}</div>` +
        `</div>`;
    }
    // Data display (Stage 11): these four read their declaration
    // children themselves instead of rendering them generically.
    if (el.tag === 'tabs') {
      const tabEls = el.children.filter(
        (n): n is ElementNode => n.type === 'element' && n.tag === 'tab',
      );
      const idxRaw = rawBound(el, 'index', scope);
      const idx = typeof idxRaw === 'number' ? idxRaw : 0;
      const active = Math.min(Math.max(idx, 0), Math.max(tabEls.length - 1, 0));
      const headers = tabEls.map((tab, i) => {
        const label = bound(tab, 'label', scope) ?? '';
        return `<div class="tab-header${i === active ? ' selected' : ''}"><span class="tab-label">${escapeHtml(label)}</span>${i === active ? '<span class="tab-indicator"></span>' : ''}</div>`;
      }).join('');
      const content = tabEls[active] ? renderNodes(tabEls[active].children, scope) : '';
      return `<div class="tabs"><div class="tab-headers">${headers}</div>${content}</div>`;
    }
    if (el.tag === 'accordion') {
      const prev = panelClaim;
      let claimed = false;
      panelClaim = () => {
        if (claimed) return false;
        claimed = true;
        return true;
      };
      try {
        return `<div class="accordion">${renderNodes(el.children, scope)}</div>`;
      } finally {
        panelClaim = prev;
      }
    }
    if (el.tag === 'panel') {
      let open = truthy(rawBound(el, 'expanded', scope));
      if (open && panelClaim) open = panelClaim();
      const panelTitle = bound(el, 'title', scope) ?? '';
      const panelSub = bound(el, 'subtitle', scope) ?? '';
      const chevron = `<span class="panel-chevron${open ? ' open' : ''}">${iconSvg('chevron-right', 24, 'textMuted')}</span>`;
      const header = `<div class="panel-header"><div class="panel-titles">` +
        (panelTitle ? `<div class="panel-title">${escapeHtml(panelTitle)}</div>` : '') +
        (panelSub ? `<div class="panel-subtitle">${escapeHtml(panelSub)}</div>` : '') +
        `</div>${chevron}</div>`;
      const bodyHtml = open ? `<div class="panel-body">${renderNodes(el.children, scope)}</div>` : '';
      return `<div class="panel">${header}${bodyHtml}</div>`;
    }
    if (el.tag === 'table') {
      const cols = el.children
        .filter((n): n is ElementNode => n.type === 'element' && n.tag === 'column')
        .map((c) => {
          const name = c.attrs['name'] ?? c.attrs['key'] ?? '';
          return { name, header: c.attrs['header'] ?? name };
        })
        .filter((c) => c.name !== '');
      const dataBinding = el.propBindings.find((b) => b.name === 'data');
      const dataVal = dataBinding ? evalSafe(dataBinding.expression, scope, currentRefs) : UNSET;
      const rows = Array.isArray(dataVal) ? dataVal : [];
      const head = `<div class="table-row">${cols.map((c) => `<span class="table-cell head">${escapeHtml(c.header)}</span>`).join('')}</div>`;
      const bodyRows = rows.map((row) =>
        `<div class="table-row">${cols.map((c) => `<span class="table-cell">${escapeHtml(String((row as Record<string, unknown> | null)?.[c.name] ?? ''))}</span>`).join('')}</div>`,
      ).join('');
      const emptyText = el.attrs['emptyText'];
      const empty = !rows.length && emptyText
        ? `<div class="table-empty">${escapeHtml(emptyText)}</div>` : '';
      return `<div class="table">${head}${bodyRows}${empty}</div>`;
    }
    const inner = renderNodes(el.children, scope);
    const title = bound(el, 'title', scope) ?? '';
    const dirStyle = directiveStyleAttr(el, scope);
    switch (el.tag) {
      case 'screen':
        return `<div class="screen">${inner}</div>`;
      case 'appbar': {
        const search = bound(el, 'search', scope);
        return `<header class="appbar">${iconSvg('menu', 24, 'textMuted')}` +
          (search
            ? `<span class="search">${escapeHtml(search)}</span>`
            : `<span class="appbar-title">${escapeHtml(title)}</span>`) +
          `<span class="avatar">${escapeHtml((title || 'R').charAt(0))}</span></header>`;
      }
      case 'h1': return `<h1 class="display"${dirStyle}>${inner}</h1>`;
      case 'h2': return `<h2 class="heading"${dirStyle}>${inner}</h2>`;
      case 'h3': return `<h3 class="title"${dirStyle}>${inner}</h3>`;
      case 'p': return `<p class="body"${dirStyle}>${inner}</p>`;
      case 'label': return `<span class="label"${dirStyle}>${inner}</span>`;
      case 'span': {
        const cls = el.attrs['class'];
        return cls ? `<span class="${escapeHtml(cls)}"${dirStyle}>${inner}</span>` : `<span${dirStyle}>${inner}</span>`;
      }
      case 'card': return `<section class="card"${dirStyle}>${inner}</section>`;
      case 'sheet': {
        const open = rawBound(el, 'open', scope);
        if (open !== undefined && !truthy(open)) return '';
        return `<div class="overlay"><div class="overlay-backdrop"></div><section class="sheet"><div class="sheet-handle"></div>${inner}</section></div>`;
      }
      case 'dialog': {
        const open = rawBound(el, 'open', scope);
        if (open !== undefined && !truthy(open)) return '';
        return `<div class="overlay overlay-center"><div class="overlay-backdrop"></div><section class="dialog">${title ? `<div class="dialog-title">${escapeHtml(title)}</div>` : ''}${inner}</section></div>`;
      }
      case 'actions': return `<div class="actions">${inner}</div>`;
      case 'button': {
        const dis = el.propBindings.find((b) => b.name === 'disabled');
        const disabled = dis ? evalSafe(dis.expression, scope) === true : false;
        return `<button class="btn" ${disabled ? 'disabled' : ''}>${inner}${badgeHtml(el, scope)}</button>`;
      }
      case 'slider': {
        const min = numOf(el, 'min', scope, 0);
        const max = numOf(el, 'max', scope, 100);
        let step = numOf(el, 'step', scope, 1);
        if (!(step > 0)) step = 1;
        const valRaw = rawBound(el, 'value', scope);
        const val = typeof valRaw === 'number' ? valRaw : min;
        const frac = max > min ? Math.min(1, Math.max(0, (val - min) / (max - min))) : 0;
        const steps = Math.round((max - min) / step);
        const ticks = steps > 0 && steps <= 20
          ? Array.from({ length: steps + 1 }, (_, i) =>
            `<span class="slider-tick" style="left:${(i / steps) * 100}%"></span>`).join('')
          : '';
        return `<div class="slider"><div class="slider-track"><div class="slider-fill" style="width:${frac * 100}%"></div><div class="slider-thumb" style="left:${frac * 100}%"></div></div><div class="slider-ticks">${ticks}</div></div>`;
      }
      case 'progress-bar': {
        const mode = bound(el, 'mode', scope);
        let pct = 40;
        if (mode !== 'indeterminate') {
          const n = numOf(el, 'value', scope, NaN);
          pct = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
        }
        return `<div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>`;
      }
      case 'spinner': {
        const size = iconSizeOf(el, scope);
        const color = bound(el, 'color', scope);
        const stroke = color
          ? (/^[a-zA-Z]+$/.test(color) ? `var(--role-${kebabRole(color)})` : color)
          : 'var(--role-primary)';
        return `<span class="spinner"><svg width="${size}" height="${size}" viewBox="0 0 24 24"><path d="${SPINNER_ARC_PATH}" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round" fill="none"/></svg></span>`;
      }
      case 'chips': return `<div class="chips">${inner}</div>`;
      case 'chip': {
        const iconName = el.attrs['icon'];
        const icon = iconName ? iconSvg(iconName, 20, 'textMuted') : '';
        const removable = el.booleanAttrs.includes('removable');
        return `<span class="chip">${icon}<span class="chip-label">${inner}</span>${removable ? `<span class="chip-remove">${iconSvg('close', 20, 'textMuted')}</span>` : ''}</span>`;
      }
      case 'tab': return '';
      case 'column': return '';
      case 'switch': {
        const checked = truthy(rawBound(el, 'checked', scope));
        const disabled = truthy(rawBound(el, 'disabled', scope));
        return `<button type="button" class="switch${checked ? ' on' : ''}" ${disabled ? 'disabled' : ''}><span class="switch-track"><span class="switch-knob"></span></span><span class="control-label">${inner}</span></button>`;
      }
      case 'checkbox': {
        const checked = truthy(rawBound(el, 'checked', scope));
        const disabled = truthy(rawBound(el, 'disabled', scope));
        return `<button type="button" class="checkbox${checked ? ' on' : ''}" ${disabled ? 'disabled' : ''}><span class="checkbox-box">${checked ? iconSvg('check', 20, 'onPrimary') : ''}</span><span class="control-label">${inner}</span></button>`;
      }
      case 'switcher': {
        const current = rawBound(el, 'value', scope);
        const disabled = truthy(rawBound(el, 'disabled', scope));
        const options = el.children
          .filter((n): n is ElementNode => n.type === 'element' && n.tag === 'option')
          .map((option) => {
            const value = rawBound(option, 'value', scope);
            const selected = String(value ?? '') === String(current ?? '');
            return `<button type="button" class="switcher-option${selected ? ' selected' : ''}" ${disabled ? 'disabled' : ''}>${renderNodes(option.children, scope)}</button>`;
          })
          .join('');
        return `<div class="switcher">${options}</div>`;
      }
      case 'radio-group': {
        const current = rawBound(el, 'value', scope);
        const disabled = truthy(rawBound(el, 'disabled', scope));
        const options = el.children
          .filter((n): n is ElementNode => n.type === 'element' && n.tag === 'radio')
          .map((option) => {
            const value = rawBound(option, 'value', scope);
            const selected = String(value ?? '') === String(current ?? '');
            return `<button type="button" class="radio-option${selected ? ' selected' : ''}" ${disabled ? 'disabled' : ''}><span class="radio-circle">${selected ? '<span class="radio-dot"></span>' : ''}</span><span class="control-label">${renderNodes(option.children, scope)}</span></button>`;
          })
          .join('');
        return `<div class="radio-group">${options}</div>`;
      }
      case 'list': return `<div class="list">${inner}</div>`;
      case 'row': {
        const titleBound = bound(el, 'title', scope);
        const rowTitle = titleBound ?? inner;
        const sub = bound(el, 'subtitle', scope) ?? '';
        const detail = bound(el, 'detail', scope) ?? '';
        const time = bound(el, 'time', scope) ?? '';
        const initial = (rowTitle || '•').charAt(0);
        return `<div class="row">${el.booleanAttrs.includes('avatar') ? `<span class="avatar-lg">${escapeHtml(initial)}</span>` : ''}` +
          `<span class="row-main"><span class="row-title">${escapeHtml(rowTitle)}</span>` +
          (sub ? `<span class="row-sub">${escapeHtml(sub)}</span>` : '') +
          (detail ? `<span class="row-detail">${escapeHtml(detail)}</span>` : '') +
          // Row children render inside the main cell, like RgRow and the
          // page runtime do (e.g. an unread dot <span *ngIf="m.unread">),
          // unless the children already served as the title fallback.
          (titleBound !== undefined ? inner : '') +
          `</span>${time ? `<span class="row-time">${escapeHtml(time)}</span>` : ''}${badgeHtml(el, scope)}</div>`;
      }
      case 'icon': {
        const name = bound(el, 'name', scope);
        if (!name) return '';
        const svg = iconSvg(name, iconSizeOf(el, scope), bound(el, 'color', scope));
        const dot = badgeHtml(el, scope);
        return dot ? `<span class="icon-badge">${svg}${dot}</span>` : svg;
      }
      case 'fab': return `<div class="fab">${inner || escapeHtml(bound(el, 'label', scope) ?? 'Compose')}</div>`;
      case 'header': return `<header${dirStyle}>${inner}</header>`;
      case 'section': return `<section${dirStyle}>${inner}</section>`;
      default: return `<div${dirStyle}>${inner}</div>`;
    }
  };

  const initialHtml = renderNodes(ast.children, baseScope);
  const script = previewScript(component, ast, state, data);

  return `<!DOCTYPE html>
<html lang="en" data-theme="${declaredTheme}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Rangular preview: ${escapeHtml(component.selector ?? component.className)}</title>
<style>
  * { box-sizing: border-box; }
  /* Stage 4: every colour below resolves through these variables. The
     declared theme is the default; the Light/Dark toggle in the preview
     chrome flips data-theme on <html> and the other palette takes over,
     the same token swap a generated app does with RgScreen theme. */
  :root { ${cssVars(declaredTheme)} }
  html[data-theme="light"] { ${cssVars('light')} }
  html[data-theme="dark"] { ${cssVars('dark')} }
  body { margin: 0; font-family: Roboto, system-ui, sans-serif; background: #e8eaed; display: flex; flex-direction: column; align-items: center; padding: 24px 12px; }
  .preview-chrome { width: 360px; max-width: 100%; display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; font-size: 13px; color: #444746; }
  .preview-chrome button { background: #ffffff; color: #0b57d0; border: 1px solid #dadce0; border-radius: 9999px; padding: 6px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .preview-nav-back { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 12px 16px 0; padding: 8px 12px; border: 1px dashed #b3261e; border-radius: 12px; color: #b3261e; font-size: 12px; background: #ffffff; }
  .preview-nav-back button { background: #b3261e; color: #ffffff; border: none; border-radius: 9999px; padding: 4px 12px; font-size: 12px; font-weight: 600; cursor: pointer; }
  .screen { position: relative; width: 360px; max-width: 100%; min-height: 640px; background: var(--screen-bg); color: var(--text); border-radius: 28px; overflow: hidden; box-shadow: 0 10px 28px rgba(0,0,0,.18); padding-bottom: ${t.spacing.xxl}px; }
  .appbar { display: flex; align-items: center; gap: ${t.spacing.md}px; margin: ${t.spacing.md}px; background: var(--surface-variant); border-radius: ${t.radius.full}px; padding: 10px ${t.spacing.lg}px; }
  .search { flex: 1; color: var(--text-muted); font-size: 14px; }
  .appbar-title { flex: 1; font-size: ${t.typography.title.fontSize}px; font-weight: 600; }
  .avatar { width: 28px; height: 28px; border-radius: 50%; background: var(--avatar); color: var(--on-avatar); display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; }
  .avatar-lg { width: 40px; height: 40px; flex: 0 0 40px; border-radius: 50%; background: var(--primary); color: var(--on-primary); display: inline-flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 600; }
  .icon { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
  .icon svg { display: block; }
  .display { font-size: ${t.typography.display.fontSize}px; line-height: ${t.typography.display.lineHeight}px; font-weight: 700; margin: ${t.spacing.lg}px ${t.spacing.lg}px ${t.spacing.sm}px; }
  .heading { font-size: ${t.typography.heading.fontSize}px; line-height: ${t.typography.heading.lineHeight}px; font-weight: 700; margin: 0 0 ${t.spacing.sm}px; }
  .title { font-size: ${t.typography.title.fontSize}px; line-height: ${t.typography.title.lineHeight}px; font-weight: 600; margin: 0 0 ${t.spacing.sm}px; }
  .body { font-size: ${t.typography.bodyLarge.fontSize}px; line-height: ${t.typography.bodyLarge.lineHeight}px; color: var(--text-muted); margin: 0 ${t.spacing.lg}px ${t.spacing.lg}px; }
  .label { display: block; font-size: ${t.typography.label.fontSize}px; line-height: ${t.typography.label.lineHeight}px; font-weight: 600; letter-spacing: .4px; margin: 0 ${t.spacing.lg}px ${t.spacing.sm}px; }
  .badge { display: inline-block; background: var(--primary-container); color: var(--on-primary-container); border-radius: ${t.radius.full}px; padding: 4px 12px; font-size: ${t.typography.caption.fontSize}px; font-weight: 700; }
  .card { background: var(--surface-variant); border: 1px solid var(--border); border-radius: ${t.radius.lg}px; padding: ${t.spacing.lg}px; margin: 0 ${t.spacing.lg}px ${t.spacing.lg}px; }
  .card .body { margin: 0; font-size: ${t.typography.body.fontSize}px; }
  .btn { display: block; margin: ${t.spacing.sm}px ${t.spacing.lg}px 0; background: var(--primary); color: var(--on-primary); border: none; border-radius: ${t.radius.full}px; padding: 0 ${t.spacing.xxl}px; min-height: 48px; font-size: ${t.typography.label.fontSize}px; font-weight: 600; cursor: pointer; }
  .btn[disabled] { opacity: .38; cursor: default; }
  .form { display: flex; flex-direction: column; }
  .field { display: flex; flex-direction: column; gap: ${t.spacing.xs}px; margin: ${t.spacing.sm}px ${t.spacing.lg}px 0; }
  .field-label { font-size: ${t.typography.label.fontSize}px; font-weight: 600; color: var(--text-muted); }
  .field-input { font: inherit; font-size: ${t.typography.bodyLarge.fontSize}px; color: var(--text); background: var(--role-surface); border: 1px solid var(--border); border-radius: ${t.radius.sm}px; padding: 10px ${t.spacing.md}px; }
  .field-input[disabled] { opacity: .38; }
  .field-error { color: var(--role-error); font-size: ${t.typography.caption.fontSize}px; }
  .switch, .checkbox { display: flex; align-items: center; gap: ${t.spacing.md}px; width: calc(100% - ${t.spacing.lg * 2}px); margin: ${t.spacing.sm}px ${t.spacing.lg}px 0; padding: ${t.spacing.sm}px 0; background: transparent; border: none; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
  .switch[disabled], .checkbox[disabled], .switcher-option[disabled], .radio-option[disabled] { opacity: .38; cursor: default; }
  .switch-track { position: relative; width: 52px; height: 32px; flex: 0 0 52px; border: 2px solid var(--border); border-radius: ${t.radius.full}px; background: var(--surface-variant); transition: background-color .16s linear, border-color .16s linear; }
  .switch.on .switch-track { background: var(--primary); border-color: var(--primary); }
  .switch-knob { position: absolute; top: 2px; left: 2px; width: 24px; height: 24px; border-radius: 50%; background: var(--text-muted); transition: left .16s linear, background-color .16s linear; }
  .switch.on .switch-knob { left: 22px; background: var(--on-primary); }
  .control-label { flex: 1; font-size: ${t.typography.body.fontSize}px; }
  .checkbox-box { width: 24px; height: 24px; flex: 0 0 24px; border: 2px solid var(--text-muted); border-radius: ${t.radius.sm}px; display: inline-flex; align-items: center; justify-content: center; color: var(--on-primary); }
  .checkbox.on .checkbox-box { background: var(--primary); border-color: var(--primary); }
  .checkbox-mark { font-size: ${t.typography.bodyLarge.fontSize}px; font-weight: 700; line-height: 1; }
  .switcher { display: flex; gap: ${t.spacing.xs}px; padding: ${t.spacing.xs}px; margin: ${t.spacing.sm}px ${t.spacing.lg}px 0; background: var(--surface-variant); border: 1px solid var(--border); border-radius: ${t.radius.full}px; }
  .switcher-option { flex: 1; min-height: 40px; border: none; border-radius: ${t.radius.full}px; background: transparent; color: var(--text); padding: 0 ${t.spacing.md}px; font-size: ${t.typography.label.fontSize}px; cursor: pointer; }
  .switcher-option.selected { background: var(--primary-container); color: var(--on-primary-container); font-weight: 600; }
  .radio-option { display: flex; align-items: center; gap: ${t.spacing.md}px; width: calc(100% - ${t.spacing.lg * 2}px); margin: 0 ${t.spacing.lg}px; padding: ${t.spacing.sm}px 0; background: transparent; border: none; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
  .radio-circle { width: 24px; height: 24px; flex: 0 0 24px; border: 2px solid var(--text-muted); border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; }
  .radio-option.selected .radio-circle { border-color: var(--primary); }
  .radio-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--primary); }
  .list { border-top: 1px solid var(--border); }
  .row { display: flex; gap: ${t.spacing.md}px; align-items: flex-start; padding: 11px ${t.spacing.lg}px; border-bottom: 1px solid var(--border); }
  .row-main { flex: 1; display: flex; flex-direction: column; }
  .row-title { font-weight: 600; font-size: 14px; }
  .row-sub { font-size: 13px; }
  .row-detail { font-size: 12.5px; color: var(--text-muted); }
  .row-time { font-size: 11px; color: var(--text-muted); }
  .fab { display: inline-block; float: right; margin: ${t.spacing.sm}px ${t.spacing.lg}px 0 0; background: var(--primary-container); color: var(--on-primary-container); border-radius: ${t.radius.lg}px; padding: 13px 18px; font-size: 14px; font-weight: 600; box-shadow: 0 3px 8px rgba(0,0,0,.25); }
  .overlay { position: absolute; inset: 0; z-index: 10; display: flex; align-items: flex-end; }
  .overlay-center { align-items: center; justify-content: center; padding: 0 ${t.spacing.lg}px; }
  .overlay-backdrop { position: absolute; inset: 0; background: var(--role-scrim); opacity: .32; }
  .sheet { position: relative; width: 100%; background: var(--role-surface); border-radius: ${t.radius.xl}px ${t.radius.xl}px 0 0; padding: ${t.spacing.sm}px ${t.spacing.lg}px ${t.spacing.xxl}px; box-shadow: 0 -4px 18px rgba(0,0,0,.18); animation: sheet-up .22s linear; max-height: 88%; overflow-y: auto; }
  .sheet .body, .dialog .body, .sheet .label, .dialog .label { margin-left: 0; margin-right: 0; }
  .sheet .btn, .dialog .btn, .sheet .radio-option { width: 100%; margin-left: 0; margin-right: 0; }
  .sheet-handle { width: 36px; height: 4px; border-radius: ${t.radius.full}px; background: var(--border); margin: 0 auto ${t.spacing.md}px; }
  @keyframes sheet-up { from { transform: translateY(24px); } to { transform: translateY(0); } }
  .dialog { position: relative; width: 100%; background: var(--role-surface); border-radius: ${t.radius.xl}px; padding: ${t.spacing.xl}px; box-shadow: 0 10px 28px rgba(0,0,0,.25); animation: dialog-in .15s linear; }
  .dialog-title { font-size: ${t.typography.title.fontSize}px; line-height: ${t.typography.title.lineHeight}px; font-weight: 600; margin-bottom: ${t.spacing.md}px; }
  @keyframes dialog-in { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: scale(1); } }
  .actions { display: flex; justify-content: flex-end; align-items: center; gap: ${t.spacing.sm}px; margin-top: ${t.spacing.lg}px; }
  .actions .btn { margin: 0; }
  .picker-box { display: flex; align-items: center; gap: ${t.spacing.md}px; background: var(--role-surface); border: 1px solid var(--border); border-radius: ${t.radius.sm}px; padding: 10px ${t.spacing.md}px; cursor: pointer; }
  .picker-value { flex: 1; font-size: ${t.typography.bodyLarge.fontSize}px; color: var(--text); }
  .picker-head { display: flex; align-items: center; justify-content: space-between; min-height: 32px; margin-bottom: ${t.spacing.sm}px; }
  .picker-head-btn { border: none; background: transparent; color: var(--primary); font: inherit; font-size: ${t.typography.bodyLarge.fontSize}px; padding: ${t.spacing.xs}px 0; cursor: pointer; }
  .picker-head-done { font-weight: 600; }
  .picker-head-title { font-size: ${t.typography.label.fontSize}px; font-weight: 600; }
  .wheels { display: flex; gap: ${t.spacing.xs}px; }
  .wheel { flex: 1; max-height: 160px; overflow-y: auto; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); padding: 64px 0; }
  .wheel.wide { flex: 1.6; }
  .wheel-value { display: block; width: 100%; height: 32px; border: none; background: transparent; color: var(--text-muted); font: inherit; font-size: ${t.typography.body.fontSize}px; white-space: nowrap; cursor: pointer; }
  .wheel-value.selected { color: var(--text); font-weight: 600; }
  /* Data display (Stage 11). The badge dot is deliberately its own
     class: .badge above is the older showcase pill. */
  .btn, .row { position: relative; }
  .badge-dot { position: absolute; top: -6px; right: -6px; min-width: 18px; height: 18px; border-radius: ${t.radius.full}px; background: var(--role-error); color: var(--role-on-error); font-size: ${t.typography.caption.fontSize}px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; padding: 0 4px; z-index: 2; }
  .row .badge-dot { top: 6px; right: 12px; }
  .icon-badge { position: relative; display: inline-flex; }
  .icon-badge .badge-dot { top: -4px; right: -4px; }
  .tab-headers { display: flex; border-bottom: 1px solid var(--border); margin: 0 ${t.spacing.lg}px; }
  .tab-header { flex: 1; min-height: 48px; display: flex; align-items: center; justify-content: center; position: relative; padding: 0 ${t.spacing.sm}px; cursor: pointer; }
  .tab-label { font-size: ${t.typography.label.fontSize}px; color: var(--text-muted); }
  .tab-header.selected .tab-label { color: var(--primary); font-weight: 600; }
  .tab-indicator { position: absolute; left: ${t.spacing.md}px; right: ${t.spacing.md}px; bottom: 0; height: 3px; background: var(--primary); border-radius: ${t.radius.sm}px ${t.radius.sm}px 0 0; }
  .panel { border-bottom: 1px solid var(--border); }
  .panel-header { display: flex; align-items: center; gap: ${t.spacing.md}px; min-height: 48px; padding: ${t.spacing.sm}px ${t.spacing.lg}px; cursor: pointer; }
  .panel-titles { flex: 1; }
  .panel-title { font-size: ${t.typography.body.fontSize}px; font-weight: 600; color: var(--text); }
  .panel-subtitle { font-size: ${t.typography.caption.fontSize}px; color: var(--text-muted); }
  .panel-chevron { display: inline-flex; transform: rotate(90deg); }
  .panel-chevron.open { transform: rotate(-90deg); }
  .panel-body { padding: 0 ${t.spacing.lg}px ${t.spacing.lg}px; }
  .panel-body .body, .panel-body .label { margin-left: 0; margin-right: 0; }
  .panel-body .progress, .panel-body .slider { margin-left: 0; margin-right: 0; }
  .table { margin: 0 ${t.spacing.lg}px ${t.spacing.lg}px; }
  .table-row { display: flex; gap: ${t.spacing.md}px; padding: 11px 0; border-bottom: 1px solid var(--border); }
  .table-cell { flex: 1; font-size: ${t.typography.body.fontSize}px; color: var(--text); }
  .table-cell.head { font-size: ${t.typography.label.fontSize}px; font-weight: 600; color: var(--text-muted); }
  .table-empty { font-size: ${t.typography.body.fontSize}px; color: var(--text-muted); padding: 11px 0; }
  .slider { margin: 0 ${t.spacing.lg}px; padding: ${t.spacing.md}px 0; }
  .slider-track { position: relative; height: 4px; border-radius: ${t.radius.full}px; background: var(--surface-variant); }
  .slider-fill { position: absolute; left: 0; top: 0; height: 4px; border-radius: ${t.radius.full}px; background: var(--primary); }
  .slider-thumb { position: absolute; top: 50%; width: 20px; height: 20px; margin: -10px 0 0 -10px; border-radius: 50%; background: var(--primary); }
  .slider-ticks { position: relative; height: 20px; }
  .slider-tick { position: absolute; top: 6px; width: 10px; height: 10px; margin-left: -5px; border-radius: 50%; background: var(--border); border: none; cursor: pointer; padding: 0; }
  button.slider-tick { background: var(--primary); opacity: .55; }
  .progress { height: 4px; border-radius: ${t.radius.full}px; background: var(--surface-variant); margin: ${t.spacing.sm}px ${t.spacing.lg}px; overflow: hidden; }
  .progress-fill { height: 4px; border-radius: ${t.radius.full}px; background: var(--primary); }
  .spinner { display: inline-flex; vertical-align: middle; }
  .chips { display: flex; flex-wrap: wrap; gap: ${t.spacing.sm}px; margin: ${t.spacing.sm}px ${t.spacing.lg}px; }
  .chip { display: inline-flex; align-items: center; gap: ${t.spacing.xs}px; background: var(--surface-variant); border: 1px solid var(--border); border-radius: ${t.radius.full}px; padding: 6px ${t.spacing.md}px; font-size: ${t.typography.label.fontSize}px; color: var(--text); }
  .chip-remove { display: inline-flex; cursor: pointer; }
  .auto-anchor { position: relative; }
  .auto-panel { position: absolute; left: 0; right: 0; top: 100%; margin-top: ${t.spacing.xs}px; background: var(--role-surface); border: 1px solid var(--border); border-radius: ${t.radius.sm}px; z-index: 10; box-shadow: 0 6px 18px rgba(0,0,0,.18); }
  .auto-option { padding: 10px ${t.spacing.md}px; font-size: ${t.typography.body.fontSize}px; color: var(--text); cursor: pointer; }
  .snackbar { position: absolute; left: ${t.spacing.lg}px; right: ${t.spacing.lg}px; bottom: ${t.spacing.xxxl}px; z-index: 20; display: flex; align-items: center; gap: ${t.spacing.md}px; background: var(--text); color: var(--screen-bg); border-radius: ${t.radius.sm}px; padding: ${t.spacing.md}px ${t.spacing.lg}px; box-shadow: 0 6px 18px rgba(0,0,0,.25); }
  .snackbar-text { flex: 1; font-size: ${t.typography.body.fontSize}px; }
  .snackbar-action { border: none; background: transparent; color: var(--primary-container); font: inherit; font-size: ${t.typography.label.fontSize}px; font-weight: 600; text-transform: uppercase; cursor: pointer; padding: 0; }
</style>
</head>
<body>
<div class="preview-chrome"><span>Rangular preview</span><button id="theme-toggle" type="button">${declaredTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}</button></div>
<div id="app">
${initialHtml}
</div>
<script>
${script}
</script>
</body>
</html>
`;
}

/**
 * Serialize a value as JSON that is safe to embed in an inline <script>
 * block (security audit, 2026-11-12). Plain JSON.stringify leaves a
 * string like "</script>" untouched, which would end the script block
 * and let a field value inject markup and script into the preview page.
 * Escaping "<" (plus the two JS line terminators) keeps the JSON valid
 * and identical in meaning: the page parses the same values. Values
 * without "<" serialize exactly as before.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * The interactive part of the page: serialized template + state + translated
 * methods + a compact in-page runtime (expression parser/evaluator and DOM
 * renderer supporting the same subset as the compiler).
 */
export function previewScript(
  component: ComponentInfo,
  ast: TemplateRoot,
  state: Record<string, unknown>,
  data: PreviewData = {},
): string {
  const { methods } = translateMethods(component, 'state', new Set());
  const methodEntries = methods.map((m) => {
    const body = m.lines.join('\n');
    return `  ${m.name}: function (${m.paramNames.join(', ')}) {\n${body}\n  }`;
  });

  // Stage 3 definitions. Child/service methods are serialized as functions
  // of (state, methods, props, ...args): the page runtime binds them per
  // component instance / per service singleton, so `state.x`, `methods.y()`
  // and `props.onSaved?.(v)` in a translated body always mean THIS instance.
  const defMethods = (
    host: { fields: ComponentField[]; methods: string[]; methodDetails: ComponentInfo['methodDetails'] },
    outputCallbacks?: Map<string, string>,
  ): string => {
    const { methods: translated } = translateMethods(host, 'state', new Set(), { outputCallbacks });
    return translated
      .map((m) => {
        const params = ['state', 'methods', 'props', ...m.paramNames].join(', ');
        const body = m.lines.map((l) => (l ? `      ${l}` : l)).join('\n');
        return `      ${m.name}: function (${params}) {\n${body}\n      }`;
      })
      .join(',\n');
  };
  const depsOf = (deps: { propertyName: string; typeName: string }[] | undefined): Record<string, string> =>
    Object.fromEntries((deps ?? []).map((d) => [d.propertyName, d.typeName]));

  const serviceEntries: string[] = [];
  for (const svc of data.services ?? []) {
    if (!svc.providedInRoot) continue;
    serviceEntries.push(
      `  ${jsonForScript(svc.className)}: {\n` +
      `    "state": ${jsonForScript(stateWithInputs(svc))},\n` +
      `    "deps": ${jsonForScript(depsOf(svc.constructorDeps))},\n` +
      `    "methods": {\n${defMethods(svc)}\n    }\n  }`,
    );
  }
  const componentEntries: string[] = [];
  for (const child of data.children ?? []) {
    if (!child.info.selector) continue;
    const outputCallbacks = new Map<string, string>();
    for (const f of child.info.fields) {
      if (f.isOutput) outputCallbacks.set(f.name, `props.${outputPropName(f.name)}`);
    }
    // Form instances cannot be JSON serialized; the page rebuilds them
    // from the initializer source with its own mini evaluator (Stage 8).
    // Verbatim-initializer fields (proof fix) travel the same way: a
    // Date would degrade to a string in JSON, so the page rebuilds
    // them from source with __evalExprInit.
    const childFormInits = formInitsOf(child.info);
    const childExprInits = exprInitsOf(child.info);
    const childState = stateWithInputs(child.info);
    for (const k of Object.keys(childFormInits)) delete childState[k];
    componentEntries.push(
      `  ${jsonForScript(child.info.selector)}: {\n` +
      `    "template": ${jsonForScript(child.ast)},\n` +
      `    "state": ${jsonForScript(childState)},\n` +
      `    "formInits": ${jsonForScript(childFormInits)},\n` +
      `    "exprInits": ${jsonForScript(childExprInits)},\n` +
      `    "deps": ${jsonForScript(depsOf(child.info.constructorDeps))},\n` +
      `    "inputs": ${jsonForScript(child.info.fields.filter((f) => f.isInput).map((f) => f.name))},\n` +
      `    "outputs": ${jsonForScript(child.info.fields.filter((f) => f.isOutput).map((f) => f.name))},\n` +
      `    "onInit": ${child.info.methods.includes('ngOnInit') ? '"ngOnInit"' : 'null'},\n` +
      `    "methods": {\n${defMethods(child.info, outputCallbacks)}\n    }\n  }`,
    );
  }
  // Stage 12: custom pipes, serialized like services (state from the
  // literal fields, methods translated in state mode), and attribute
  // directives, serialized as their extracted style assignments plus
  // input defaults, so the page computes the same styles codegen does.
  const pipeEntries: string[] = [];
  for (const pipe of data.pipes ?? []) {
    const pipeState: Record<string, unknown> = {};
    for (const f of pipe.fields) {
      if (f.isOutput || !f.initializer) continue;
      const v = evaluateLiteral(f.initializer);
      if (v !== undefined) pipeState[f.name] = v;
    }
    pipeEntries.push(
      `  ${jsonForScript(pipe.pipeName)}: {\n` +
      `    "state": ${jsonForScript(pipeState)},\n` +
      `    "methods": {\n${defMethods(pipe)}\n    }\n  }`,
    );
  }
  const directiveEntries = previewDirectives(data.directives).map((d) => ({
    attr: d.attr,
    inputs: d.info.inputs.map((i) => ({
      name: i.name,
      def: i.initializer ? evaluateLiteral(i.initializer) : undefined,
    })),
    assignments: d.unsupported ? [] : d.assignments,
  }));
  const rootDeps = depsOf(component.constructorDeps);
  const rootOnInit = component.methods.includes('ngOnInit') ? '"ngOnInit"' : 'null';
  const needsWiring = Object.keys(rootDeps).length > 0 || rootOnInit !== 'null';
  const declaredTheme = declaredThemeOf(ast);
  // Root form instances: excluded from the serialized state (instances
  // do not survive JSON) and rebuilt in the page from FORM_INITS.
  // Verbatim-initializer fields (proof fix) are excluded the same way
  // and rebuilt from EXPR_INITS, so a Date stays a Date in the page.
  const rootFormInits = formInitsOf(component);
  const rootExprInits = exprInitsOf(component);
  const serialState: Record<string, unknown> = { ...state };
  for (const k of Object.keys(rootFormInits)) delete serialState[k];
  for (const k of Object.keys(rootExprInits)) delete serialState[k];

  return `// Rangular interactive preview runtime (Stage 2).
// State and methods are live: (click) handlers mutate state and re-render.
const TEMPLATE = ${jsonForScript(ast)};
const ICONS = ${jsonForScript(ICON_PATHS)};
const state = ${jsonForScript(serialState)};
const FORM_INITS = ${jsonForScript(rootFormInits)};
const EXPR_INITS = ${jsonForScript(rootExprInits)};
const methods = {
${methodEntries.join(',\n')}
};
const SERVICES = {
${serviceEntries.join(',\n')}
};
const COMPONENTS = {
${componentEntries.join(',\n')}
};
const PIPES = {
${pipeEntries.join(',\n')}
};
const DIRECTIVES = ${jsonForScript(directiveEntries)};
const ROUTES = ${jsonForScript((data.routes ?? []).map((r) => ({
    path: r.path,
    ...(r.selector ? { selector: r.selector } : {}),
    ...(r.redirectTo !== undefined ? { redirectTo: r.redirectTo } : {}),
  })))};
const ROOT_DEPS = ${jsonForScript(rootDeps)};
const ROOT_ONINIT = ${rootOnInit};
${PAGE_RUNTIME}${needsWiring ? `\n${ROOT_WIRING}` : ''}${Object.keys(rootFormInits).length ? `\n${ROOT_FORM_WIRING}` : ''}${Object.keys(rootExprInits).length ? `\n${ROOT_EXPR_WIRING}` : ''}
${themeWiring(declaredTheme)}`;
}

/**
 * Preview Light/Dark toggle wiring (Stage 4). A chrome affordance only,
 * the compiled app chooses its theme via <screen theme="..."> instead.
 * Colours live in CSS variables, so flipping data-theme on <html> swaps
 * the whole palette without re-rendering a single node.
 */
function themeWiring(declared: 'light' | 'dark'): string {
  return [
    '// Preview theme toggle (Stage 4): flips data-theme on <html>; the CSS',
    '// variables in <style> do the rest. Guarded so non-DOM harnesses and',
    '// older pages without the chrome button simply skip it.',
    `var __previewTheme = '${declared}';`,
    "var __themeBtn = document.getElementById('theme-toggle');",
    'function __syncThemeBtn() {',
    "  if (__themeBtn) __themeBtn.textContent = __previewTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';",
    '}',
    'if (__themeBtn) {',
    "  __themeBtn.addEventListener('click', function () {",
    "    __previewTheme = __previewTheme === 'dark' ? 'light' : 'dark';",
    '    if (document.documentElement && document.documentElement.setAttribute) {',
    "      document.documentElement.setAttribute('data-theme', __previewTheme);",
    '    }',
    '    __syncThemeBtn();',
    '  });',
    '  __syncThemeBtn();',
    '}',
  ].join('\n');
}

/**
 * Appended after the page runtime when the root component injects services
 * or has ngOnInit: the static first render happens without deps, then the
 * wiring epilogue assigns the singletons and runs ngOnInit once (the
 * preview analogue of the generated useEffect(..., [])).
 */
const ROOT_WIRING = String.raw`
// Root wiring (Stage 3): injected services, then ngOnInit once after mount.
Object.keys(ROOT_DEPS).forEach(function (k) { state[k] = __resolveDep(ROOT_DEPS[k]); });
__render();
if (ROOT_ONINIT && typeof methods[ROOT_ONINIT] === 'function') {
  methods[ROOT_ONINIT]();
  __render();
}
`;

/**
 * Appended after the page runtime when the root component has reactive
 * form fields (Stage 8): the instances are built only once the runtime
 * (and its Validators table) exists, then the screen re-renders with
 * live form values.
 */
const ROOT_FORM_WIRING = String.raw`
// Root form instances (Stage 8): build the FormGroup/FormControl fields
// from their initializers, then re-render with live values and validity.
Object.keys(FORM_INITS).forEach(function (k) { state[k] = __evalFormInit(FORM_INITS[k]); });
__render();
`;

/**
 * Appended after the page runtime when the root component has
 * verbatim-initializer fields (proof fix): the values the generated
 * app computes by running the initializer (a Date, a timestamp) are
 * rebuilt here from the same source, then the screen re-renders.
 */
const ROOT_EXPR_WIRING = String.raw`
// Root verbatim-initializer fields (proof fix): rebuild the values
// codegen emits verbatim (new Date(), Date.now(), literal expressions)
// from their initializers, then re-render with the real values.
Object.keys(EXPR_INITS).forEach(function (k) { state[k] = __evalExprInit(EXPR_INITS[k]); });
__render();
`;

/**
 * In-page runtime. Deliberately written without template literals or `${`
 * sequences so it can live inside a String.raw literal here. It implements
 * the same expression subset as the compiler's Pratt parser/evaluator.
 */
const PAGE_RUNTIME = String.raw`
function __tok(s) {
  var t = [], i = 0;
  while (i < s.length) {
    var ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '"' || ch === "'") {
      var j = i + 1, v = '';
      while (j < s.length && s[j] !== ch) {
        if (s[j] === '\\' && j + 1 < s.length) { v += s[j + 1]; j += 2; }
        else { v += s[j]; j++; }
      }
      t.push({ k: 'str', v: v }); i = j + 1; continue;
    }
    if (/[0-9]/.test(ch)) {
      var j2 = i;
      while (j2 < s.length && /[0-9.]/.test(s[j2])) j2++;
      t.push({ k: 'num', v: s.slice(i, j2) }); i = j2; continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      var j3 = i;
      while (j3 < s.length && /[A-Za-z0-9_$]/.test(s[j3])) j3++;
      t.push({ k: 'id', v: s.slice(i, j3) }); i = j3; continue;
    }
    var three = s.slice(i, i + 3), two = s.slice(i, i + 2);
    if (three === '===' || three === '!==') { t.push({ k: 'p', v: three }); i += 3; continue; }
    if (['==', '!=', '<=', '>=', '&&', '||'].indexOf(two) >= 0) { t.push({ k: 'p', v: two }); i += 2; continue; }
    if ('+-*/%<>!?:.,()[]|'.indexOf(ch) >= 0) { t.push({ k: 'p', v: ch }); i++; continue; }
    throw new Error('preview: unexpected character ' + ch);
  }
  t.push({ k: 'eof', v: '' });
  return t;
}
function __parse(src) {
  var toks = __tok(src), pos = 0;
  function peek() { return toks[pos]; }
  function next() { return toks[pos++]; }
  function atP(v) { var t = peek(); return t.k === 'p' && t.v === v; }
  function expect(v) { if (!atP(v)) throw new Error('preview: expected ' + v); next(); }
  var BP = { '||': 1, '&&': 2, '==': 3, '===': 3, '!=': 3, '!==': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
  function parsePipe() {
    var inp = parseCond();
    while (atP('|')) {
      next();
      var nm = next();
      if (nm.k !== 'id') throw new Error('preview: pipe name expected');
      var args = [];
      while (atP(':')) { next(); args.push(parseCond()); }
      inp = { type: 'pipe', input: inp, name: nm.v, args: args };
    }
    return inp;
  }
  function parseCond() {
    var test = parseBin(1);
    if (atP('?')) {
      next();
      var cons = parsePipe();
      expect(':');
      var alt = parseCond();
      return { type: 'conditional', test: test, consequent: cons, alternate: alt };
    }
    return test;
  }
  function parseBin(min) {
    var left = parseUnary();
    for (;;) {
      var t = peek();
      if (t.k !== 'p') break;
      var pw = BP[t.v];
      if (pw === undefined || pw < min) break;
      var op = next().v;
      var right = parseBin(pw + 1);
      left = { type: 'binary', op: op, left: left, right: right };
    }
    return left;
  }
  function parseUnary() {
    var t = peek();
    if (t.k === 'p' && (t.v === '!' || t.v === '-')) {
      var op = next().v;
      return { type: 'unary', op: op, argument: parseUnary() };
    }
    return parsePost();
  }
  function parsePost() {
    var e = parsePrim();
    for (;;) {
      if (atP('.')) {
        next();
        var pr = next();
        if (pr.k !== 'id') throw new Error('preview: property expected');
        e = { type: 'member', object: e, property: pr.v };
      } else if (atP('[')) {
        next();
        var ix = parsePipe();
        expect(']');
        e = { type: 'index', object: e, index: ix };
      } else if (atP('(')) {
        next();
        var args = [];
        if (!atP(')')) {
          args.push(parsePipe());
          while (atP(',')) { next(); args.push(parsePipe()); }
        }
        expect(')');
        e = { type: 'call', callee: e, args: args };
      } else break;
    }
    return e;
  }
  function parsePrim() {
    var t = next();
    if (t.k === 'id') {
      if (t.v === 'true') return { type: 'literal', value: true };
      if (t.v === 'false') return { type: 'literal', value: false };
      if (t.v === 'null') return { type: 'literal', value: null };
      return { type: 'identifier', name: t.v };
    }
    if (t.k === 'num') return { type: 'literal', value: Number(t.v) };
    if (t.k === 'str') return { type: 'literal', value: t.v };
    if (t.k === 'p' && t.v === '(') { var inner = parsePipe(); expect(')'); return inner; }
    if (t.k === 'p' && t.v === '[') {
      // Array literal (Stage 9): the [routerLink]="['/mail', m.id]" form,
      // mirroring the compiler parser, trailing comma included.
      var elements = [];
      if (!atP(']')) {
        elements.push(parsePipe());
        while (atP(',')) { next(); if (atP(']')) break; elements.push(parsePipe()); }
      }
      expect(']');
      return { type: 'array', elements: elements };
    }
    throw new Error('preview: unexpected token ' + t.v);
  }
  var e = parsePipe();
  if (peek().k !== 'eof') throw new Error('preview: trailing tokens');
  return e;
}
function __pipeDigits(info, fb) {
  if (typeof info !== 'string') return fb;
  var m = /^(\d+)\.(\d+)-(\d+)$/.exec(info.replace(/^\s+|\s+$/g, ''));
  if (!m) return fb;
  var d = { minInt: Number(m[1]), minFrac: Number(m[2]), maxFrac: Number(m[3]) };
  return d.maxFrac < d.minFrac ? fb : d;
}
function __pipeNum(value, digits) {
  if (!isFinite(value)) return String(value);
  var negative = value < 0;
  var fixed = Math.abs(value).toFixed(digits.maxFrac);
  var dot = fixed.indexOf('.');
  var intPart = dot >= 0 ? fixed.slice(0, dot) : fixed;
  var fracPart = dot >= 0 ? fixed.slice(dot + 1) : '';
  while (fracPart.length > digits.minFrac && fracPart.charAt(fracPart.length - 1) === '0') fracPart = fracPart.slice(0, -1);
  while (fracPart.length < digits.minFrac) fracPart += '0';
  while (intPart.length < digits.minInt) intPart = '0' + intPart;
  var grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (negative ? '-' : '') + grouped + (fracPart ? '.' + fracPart : '');
}
var __pipeMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var __pipeFormats = { shortDate: 'M/d/yy', mediumDate: 'MMM d, yyyy', shortTime: 'h:mm a', medium: 'MMM d, yyyy, h:mm:ss a', short: 'M/d/yy, h:mm a' };
function __pipeDate(value, formatArg) {
  var d = null;
  if (value !== null && typeof value === 'object' && typeof value.getTime === 'function') { if (!isNaN(value.getTime())) d = value; }
  else if (typeof value === 'number' && isFinite(value)) d = new Date(value);
  else if (typeof value === 'string' && value.replace(/^\s+|\s+$/g, '') !== '') {
    var parsed = new Date(value);
    if (!isNaN(parsed.getTime())) d = parsed;
  }
  if (!d) return value;
  var named = typeof formatArg === 'string' ? formatArg : 'mediumDate';
  var format = __pipeFormats[named] !== undefined ? __pipeFormats[named] : named;
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var hours = d.getHours();
  var hour12 = hours % 12 === 0 ? 12 : hours % 12;
  var tokens = [
    ['yyyy', '' + d.getFullYear()], ['MMM', __pipeMonths[d.getMonth()]],
    ['yy', pad(d.getFullYear() % 100)], ['MM', pad(d.getMonth() + 1)],
    ['dd', pad(d.getDate())], ['HH', pad(hours)], ['hh', pad(hour12)],
    ['mm', pad(d.getMinutes())], ['ss', pad(d.getSeconds())],
    ['M', '' + (d.getMonth() + 1)], ['d', '' + d.getDate()],
    ['H', '' + hours], ['h', '' + hour12], ['a', hours < 12 ? 'AM' : 'PM']
  ];
  var out = '', i = 0;
  while (i < format.length) {
    var hit = null;
    for (var j = 0; j < tokens.length; j++) {
      if (format.slice(i, i + tokens[j][0].length) === tokens[j][0]) { hit = tokens[j]; break; }
    }
    if (hit) { out += hit[1]; i += hit[0].length; } else { out += format.charAt(i); i++; }
  }
  return out;
}
var __pipeSymbols = { USD: '$', EUR: '€', GBP: '£', INR: '₹', NPR: 'Rs' };
function __pipeCurrency(value, args) {
  if (typeof value !== 'number') return value;
  var code = typeof args[0] === 'string' && args[0] !== '' ? args[0] : 'USD';
  var display = typeof args[1] === 'string' ? args[1] : 'symbol';
  var digits = __pipeDigits(args[2], { minInt: 1, minFrac: 2, maxFrac: 2 });
  var symbol = display === 'code' ? undefined : __pipeSymbols[code];
  var formatted = __pipeNum(Math.abs(value), digits);
  var sign = value < 0 ? '-' : '';
  return symbol !== undefined ? sign + symbol + formatted : sign + code + ' ' + formatted;
}
// The async pipe (Stage 12): one subscription per observable object,
// kept across renders; an emission stores the latest value and
// re-renders. During a render, an emission only marks the page dirty,
// and __render runs once more at the end (see __render).
var __asyncSubs = [];
var __asyncDirty = false;
var __rendering = false;
function __asyncPipe(value) {
  if (value === null || value === undefined) return null;
  if (typeof value.subscribe !== 'function') return value;
  for (var i = 0; i < __asyncSubs.length; i++) {
    if (__asyncSubs[i].obs === value) return __asyncSubs[i].latest;
  }
  var rec = { obs: value, latest: null };
  __asyncSubs.push(rec);
  try {
    value.subscribe(function (v) {
      rec.latest = v;
      if (__rendering) __asyncDirty = true; else __render();
    });
  } catch (e) { console.warn('preview: async pipe subscribe failed', e); }
  return rec.latest;
}
var __pipeInstances = {};
function __customPipe(name, value, args) {
  var def = PIPES[name];
  if (!def || typeof def.methods !== 'object') return undefined;
  var inst = __pipeInstances[name];
  if (!inst) {
    var st = {};
    Object.keys(def.state).forEach(function (k) { st[k] = def.state[k]; });
    inst = { state: st, props: {}, methods: {} };
    inst.methods = __bind(def, inst);
    __pipeInstances[name] = inst;
  }
  if (typeof inst.methods.transform !== 'function') return undefined;
  return inst.methods.transform.apply(null, [value].concat(args));
}
function __pipe(name, value, args) {
  args = args || [];
  switch (name) {
    case 'uppercase': return typeof value === 'string' ? value.toUpperCase() : value;
    case 'lowercase': return typeof value === 'string' ? value.toLowerCase() : value;
    case 'titlecase': return typeof value === 'string' ? value.replace(/\w\S*/g, function (w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); }) : value;
    case 'json': return JSON.stringify(value);
    case 'date': return __pipeDate(value, args[0]);
    case 'number': return typeof value === 'number' ? __pipeNum(value, __pipeDigits(args[0], { minInt: 1, minFrac: 0, maxFrac: 3 })) : value;
    case 'percent': return typeof value === 'number' ? __pipeNum(value * 100, __pipeDigits(args[0], { minInt: 1, minFrac: 0, maxFrac: 3 })) + '%' : value;
    case 'currency': return __pipeCurrency(value, args);
    case 'slice': {
      if (typeof value !== 'string' && !Array.isArray(value)) return value;
      var start = typeof args[0] === 'number' ? args[0] : 0;
      var end = typeof args[1] === 'number' ? args[1] : undefined;
      return value.slice(start, end);
    }
    case 'keyvalue': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
      return Object.keys(value).map(function (k) { return { key: k, value: value[k] }; })
        .sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
    }
    case 'async': return __asyncPipe(value);
  }
  if (PIPES[name]) return __customPipe(name, value, args);
  throw new Error("preview: unknown pipe '" + name + "'");
}
function __eval(e, scope) {
  switch (e.type) {
    case 'literal': return e.value;
    case 'identifier': return scope[e.name];
    case 'member': {
      // Template references (Stage 8): a member chain rooted at an
      // ngModel ref name reads the ref's live validation object.
      if (e.object.type === 'identifier' && scope.__refs
        && Object.prototype.hasOwnProperty.call(scope.__refs, e.object.name)) {
        var ro = scope.__refs[e.object.name];
        if (ro === null || ro === undefined) return undefined;
        return ro[e.property];
      }
      var o = __eval(e.object, scope);
      if (o === null || o === undefined) return undefined;
      return o[e.property];
    }
    case 'index': {
      var o2 = __eval(e.object, scope);
      if (o2 === null || o2 === undefined) return undefined;
      return o2[__eval(e.index, scope)];
    }
    case 'call': {
      var args = e.args.map(function (a) { return __eval(a, scope); });
      if (e.callee.type === 'member') {
        var obj = __eval(e.callee.object, scope);
        if (obj === null || obj === undefined) return undefined;
        var fn = obj[e.callee.property];
        if (typeof fn !== 'function') throw new Error('preview: ' + e.callee.property + ' is not a function');
        return fn.apply(obj, args);
      }
      var f = __eval(e.callee, scope);
      if (typeof f !== 'function') throw new Error('preview: attempted to call a non-function');
      return f.apply(null, args);
    }
    case 'unary': {
      var v = __eval(e.argument, scope);
      if (e.op === '!') return !v;
      if (e.op === '-') return -v;
      return +v;
    }
    case 'binary': {
      if (e.op === '&&') { var l = __eval(e.left, scope); return l ? __eval(e.right, scope) : l; }
      if (e.op === '||') { var l2 = __eval(e.left, scope); return l2 ? l2 : __eval(e.right, scope); }
      var a = __eval(e.left, scope), b = __eval(e.right, scope);
      switch (e.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return a / b;
        case '%': return a % b;
        case '==': return a == b;
        case '===': return a === b;
        case '!=': return a != b;
        case '!==': return a !== b;
        case '<': return a < b;
        case '>': return a > b;
        case '<=': return a <= b;
        case '>=': return a >= b;
      }
      throw new Error('preview: bad operator ' + e.op);
    }
    case 'conditional':
      return __eval(e.test, scope) ? __eval(e.consequent, scope) : __eval(e.alternate, scope);
    case 'array':
      return e.elements.map(function (el) { return __eval(el, scope); });
    case 'pipe':
      return __pipe(e.name, __eval(e.input, scope), e.args.map(function (a) { return __eval(a, scope); }));
  }
}
function __evalSrc(src, scope) { return __eval(__parse(src), scope); }
var __rootTouched = {};
function __scope(extra) {
  var s = {}, k;
  for (k in state) s[k] = state[k];
  for (k in methods) s[k] = methods[k];
  if (extra) for (k in extra) s[k] = extra[k];
  // Forms channels (Stage 8): __state is the backing store ngModel
  // writes land in (scopes are copies), __touched persists per input
  // across re-renders, __refs carries the live ngModel ref objects.
  s.__state = state;
  s.__touched = __rootTouched;
  s.__refs = __refsFor(TEMPLATE.children, state, __rootTouched, s);
  return s;
}
function __extend(scope, extra) {
  var s = {}, k;
  for (k in scope) s[k] = scope[k];
  for (k in extra) s[k] = extra[k];
  return s;
}
function __binding(el, name, scope) {
  for (var i = 0; i < el.propBindings.length; i++) {
    if (el.propBindings[i].name === name) {
      try { return __evalSrc(el.propBindings[i].expression, scope); }
      catch (err) { console.warn(err); return undefined; }
    }
  }
  return undefined;
}
function __attr(el, name, scope) {
  var b = __binding(el, name, scope);
  if (b !== undefined) return b;
  return el.attrs[name];
}
function __parseNgFor(expr) {
  var segs = expr.split(';').map(function (x) { return x.trim(); }).filter(Boolean);
  var m = /^let\s+([A-Za-z_$][\w$]*)\s+of\s+(.+)$/.exec(segs[0] || '');
  if (!m) return null;
  var parts = { item: m[1], source: m[2], index: null };
  for (var i = 1; i < segs.length; i++) {
    var lm = /^let\s+([A-Za-z_$][\w$]*)\s*=\s*index$/.exec(segs[i]);
    if (lm) parts.index = lm[1];
  }
  return parts;
}
function __buildNodes(nodes, scope, path, form) {
  var out = [];
  nodes.forEach(function (n, i) {
    __buildNode(n, scope, path + '/' + i, form).forEach(function (d) { out.push(d); });
  });
  return out;
}
function __buildNode(node, scope, path, form) {
  if (node.type === 'text') {
    var txt = '';
    node.parts.forEach(function (p) {
      if (p.type === 'static') txt += p.value;
      else {
        try {
          var v = __evalSrc(p.expression, scope);
          txt += (v === undefined || v === null) ? '' : String(v);
        } catch (err) { console.warn(err); txt += '{{ ' + p.expression + ' }}'; }
      }
    });
    return [document.createTextNode(txt)];
  }
  var built = __buildElement(node, scope, path, form);
  __applyDirectives(built, node, scope);
  return built;
}
// Attribute directives (Stage 12): after a host element is built, each
// directive it carries computes its style assignments (extracted from
// the directive class by the compiler, shipped in DIRECTIVES) against
// the host's input values and writes them onto the node's style, the
// page mirror of codegen's merged style prop. Hosts codegen cannot
// style (components, dedicated renderers) are skipped, as there.
function __applyDirectives(nodes, el, scope) {
  if (!nodes.length || !DIRECTIVES.length) return;
  var dom = nodes[0];
  if (!dom || !dom.style) return;
  if (COMPONENTS[el.tag]) return;
  if (el.tag === 'input' || el.tag === 'icon' || el.tag === 'datetime-picker' || el.tag === 'router-outlet') return;
  DIRECTIVES.forEach(function (d) {
    var present = el.attrs[d.attr] !== undefined
      || el.propBindings.some(function (b) { return b.name === d.attr; })
      || el.booleanAttrs.indexOf(d.attr) >= 0;
    if (!present) return;
    var values = {};
    d.inputs.forEach(function (input) {
      var v = __binding(el, input.name, scope);
      if (v !== undefined) { values[input.name] = v; return; }
      if (el.attrs[input.name] !== undefined) { values[input.name] = el.attrs[input.name]; return; }
      if (el.booleanAttrs.indexOf(input.name) >= 0) { values[input.name] = true; return; }
      if (input.def !== undefined) values[input.name] = input.def;
    });
    var s2 = __extend(scope, values);
    d.assignments.forEach(function (a) {
      var v;
      try { v = __evalSrc(a.rhs, s2); } catch (e) { console.warn(e); return; }
      if (typeof v === 'string' || typeof v === 'number') dom.style[a.prop] = String(v);
    });
  });
}
function __buildElement(el, scope, path, form) {
  if (el.structural && el.structural.name === 'ngIf') {
    var cond;
    try { cond = __evalSrc(el.structural.expression.split(';')[0].trim(), scope); }
    catch (err) { console.warn(err); cond = false; }
    if (!cond) return [];
    return __buildCore(el, scope, path, form);
  }
  if (el.structural && el.structural.name === 'ngFor') {
    var parts = __parseNgFor(el.structural.expression);
    if (!parts) { console.warn('preview: unparseable *ngFor'); return __buildCore(el, scope, path, form); }
    var items;
    try { items = __evalSrc(parts.source, scope); }
    catch (err) { console.warn(err); items = []; }
    if (!items || typeof items.length !== 'number') return [];
    var out = [];
    for (var idx = 0; idx < items.length; idx++) {
      var extra = {};
      extra[parts.item] = items[idx];
      if (parts.index) extra[parts.index] = idx;
      __buildCore(el, __extend(scope, extra), path + '/for' + idx, form).forEach(function (d) { out.push(d); });
    }
    return out;
  }
  return __buildCore(el, scope, path, form);
}
function __attachEvents(dom, el, scope) {
  el.eventBindings.forEach(function (ev) {
    if (ev.name !== 'click') {
      console.warn('preview: only (click) handlers are wired, got (' + ev.name + ')');
      return;
    }
    dom.addEventListener('click', function (event) {
      __runHandler(ev.expression, scope, event);
      __render();
    });
  });
}
function __runHandler(src, scope, event) {
  var s = __extend(scope, { $event: event });
  try {
    var e = __parse(src);
    if (e.type === 'call') { __eval(e, s); return; }
    if (e.type === 'identifier') {
      var fn = s[e.name];
      if (typeof fn === 'function') { fn(); return; }
      console.warn('preview: handler ' + e.name + ' is not a method');
      return;
    }
    __eval(e, s);
  } catch (err) { console.warn(err); }
}
function __truthy(value) { return value === true || value === 'true'; }
function __kebabRole(role) { return String(role).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase(); }
function __iconSize(el, scope) {
  var v = __controlValue(el, 'size', scope);
  var n = typeof v === 'number' ? v : (typeof v === 'string' && v !== '' ? Number(v) : NaN);
  if (!isFinite(n)) return 24;
  var scale = [20, 24, 28], best = scale[0];
  for (var i = 0; i < scale.length; i++) {
    if (Math.abs(scale[i] - n) < Math.abs(best - n)) best = scale[i];
  }
  return best;
}
function __icon(name, size, colorRole) {
  var paths = ICONS[name] || [];
  var span = document.createElement('span');
  span.className = 'icon';
  if (colorRole && span.setAttribute) span.setAttribute('style', 'color: var(--role-' + __kebabRole(colorRole) + ')');
  var svg = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">';
  paths.forEach(function (d) { svg += '<path d="' + d + '"/>'; });
  svg += '</svg>';
  span.innerHTML = svg;
  return span;
}
function __controlValue(el, name, scope) {
  var bound = __binding(el, name, scope);
  if (bound !== undefined) return bound;
  if (el.booleanAttrs.indexOf(name) >= 0) return true;
  return el.attrs[name];
}
function __runChange(el, scope, value) {
  el.eventBindings.forEach(function (ev) {
    if (ev.name !== 'change') return;
    var s = __extend(scope, { $event: value });
    try {
      var e = __parse(ev.expression);
      if (e.type === 'call') { __eval(e, s); return; }
      if (e.type === 'identifier') {
        var fn = s[e.name];
        if (typeof fn === 'function') { fn(value); return; }
        console.warn('preview: change handler ' + e.name + ' is not a method');
        return;
      }
      __eval(e, s);
    } catch (err) { console.warn(err); }
  });
  __render();
}
function __runClose(el, scope) {
  el.eventBindings.forEach(function (ev) {
    if (ev.name !== 'close') return;
    var s = __extend(scope, { $event: undefined });
    try {
      var e = __parse(ev.expression);
      if (e.type === 'call') { __eval(e, s); return; }
      if (e.type === 'identifier') {
        var fn = s[e.name];
        if (typeof fn === 'function') { fn(); return; }
        console.warn('preview: close handler ' + e.name + ' is not a method');
        return;
      }
      __eval(e, s);
    } catch (err) { console.warn(err); }
  });
  __render();
}
// Generic named-event runner (Stage 11), the __runClose shape for the
// events data display adds: (toggle) on panels, (remove) on chips and
// (optionSelected) on autocomplete inputs. The handler receives the
// value as $event, like the controls contract.
function __runEvent(el, scope, name, value) {
  var ran = false;
  el.eventBindings.forEach(function (ev) {
    if (ev.name !== name) return;
    ran = true;
    var s = __extend(scope, { $event: value });
    try {
      var e = __parse(ev.expression);
      if (e.type === 'call') { __eval(e, s); return; }
      if (e.type === 'identifier') {
        var fn = s[e.name];
        if (typeof fn === 'function') { fn(value); return; }
        console.warn('preview: ' + name + ' handler ' + e.name + ' is not a method');
        return;
      }
      __eval(e, s);
    } catch (err) { console.warn(err); }
  });
  if (ran) __render();
  return ran;
}
// Badge (Stage 11), a mirror of badgeTextOf in @rangular/ui: 0 or
// empty hides the badge, a number above 99 shows as 99+.
function __badgeText(value) {
  if (value === undefined || value === null || value === '') return null;
  var n = Number(value);
  if (isFinite(n)) {
    if (n <= 0) return null;
    return n > 99 ? '99+' : String(Math.trunc(n));
  }
  return String(value);
}
function __badgeDot(el, scope) {
  var text = __badgeText(__controlValue(el, 'badge', scope));
  if (text === null) return null;
  var dot = document.createElement('span');
  dot.className = 'badge-dot';
  dot.textContent = text;
  return dot;
}
// The spinner arc (Stage 11): the same path RgSpinner draws in
// @rangular/ui and the static paint draws; a test pins the copies.
var __SPINNER_ARC = 'M 12 3 A 9 9 0 1 1 3 12';
// Date-time helpers (Stage 10). Plain-JS mirrors of @rangular/ui
// datetime.ts: the same parsing, composition, wheel and formatting
// rules, parity-tested against the TypeScript helpers.
var __MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function __pad2(n) { return n < 10 ? '0' + n : '' + n; }
function __daysInMonth(year, month) {
  var lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2) {
    var leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return lengths[month - 1] || 31;
}
function __clampParts(parts) {
  var month = Math.min(12, Math.max(1, Math.trunc(parts.month) || 1));
  var year = Math.trunc(parts.year) || 2000;
  var day = Math.min(__daysInMonth(year, month), Math.max(1, Math.trunc(parts.day) || 1));
  var hour = Math.min(23, Math.max(0, Math.trunc(parts.hour) || 0));
  var minute = Math.min(59, Math.max(0, Math.trunc(parts.minute) || 0));
  return { year: year, month: month, day: day, hour: hour, minute: minute };
}
function __parseParts(value) {
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return { year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate(), hour: value.getHours(), minute: value.getMinutes() };
  }
  if (typeof value !== 'string') return null;
  var m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?\s*(?:Z)?$/.exec(value.replace(/^\s+|\s+$/g, ''));
  if (!m) return null;
  var parts = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: m[4] === undefined ? 0 : Number(m[4]), minute: m[5] === undefined ? 0 : Number(m[5]) };
  if (parts.month < 1 || parts.month > 12) return null;
  if (parts.day < 1 || parts.day > __daysInMonth(parts.year, parts.month)) return null;
  if (parts.hour < 0 || parts.hour > 23 || parts.minute < 0 || parts.minute > 59) return null;
  return parts;
}
function __composeIso(parts) {
  var p = __clampParts(parts);
  return p.year + '-' + __pad2(p.month) + '-' + __pad2(p.day) + 'T' + __pad2(p.hour) + ':' + __pad2(p.minute) + ':00';
}
function __nowParts() {
  var d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes() };
}
function __hour12(parts) { var h = parts.hour % 12; return h === 0 ? 12 : h; }
function __ampm(parts) { return parts.hour < 12 ? 'AM' : 'PM'; }
function __formatParts(parts, mode) {
  var p = __clampParts(parts);
  var date = __MONTH_SHORT[p.month - 1] + ' ' + p.day + ', ' + p.year;
  var time = __hour12(p) + ':' + __pad2(p.minute) + ' ' + __ampm(p);
  if (mode === 'date') return date;
  if (mode === 'time') return time;
  return date + ' ' + time;
}
function __addDays(year, month, day, n) {
  var dt = new Date(Date.UTC(year, month - 1, day + n));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}
function __wheelSpecs(parts, mode, minuteInterval) {
  var p = __clampParts(parts);
  var wheels = [];
  var i, d;
  if (mode === 'date') {
    var months = [];
    for (i = 0; i < 12; i++) months.push({ value: '' + (i + 1), label: __MONTH_SHORT[i] });
    wheels.push({ name: 'month', options: months, value: '' + p.month });
    var days = [];
    for (d = 1; d <= __daysInMonth(p.year, p.month); d++) days.push({ value: '' + d, label: '' + d });
    wheels.push({ name: 'day', options: days, value: '' + p.day });
    var years = [];
    for (i = p.year - 25; i <= p.year + 25; i++) years.push({ value: '' + i, label: '' + i });
    wheels.push({ name: 'year', options: years, value: '' + p.year });
  }
  if (mode === 'datetime') {
    var dates = [];
    for (i = -183; i <= 183; i++) {
      var dd = __addDays(p.year, p.month, p.day, i);
      dates.push({ value: dd.year + '-' + __pad2(dd.month) + '-' + __pad2(dd.day), label: __MONTH_SHORT[dd.month - 1] + ' ' + dd.day + ' ' + dd.year });
    }
    wheels.push({ name: 'date', options: dates, value: p.year + '-' + __pad2(p.month) + '-' + __pad2(p.day) });
  }
  if (mode === 'time' || mode === 'datetime') {
    var hours = [];
    for (i = 1; i <= 12; i++) hours.push({ value: '' + i, label: '' + i });
    wheels.push({ name: 'hour', options: hours, value: '' + __hour12(p) });
    var step = minuteInterval === 5 ? 5 : 1;
    var snappedMinute = Math.min(60 - step, Math.round(p.minute / step) * step);
    var minutes = [];
    for (i = 0; i < 60; i += step) minutes.push({ value: '' + i, label: __pad2(i) });
    wheels.push({ name: 'minute', options: minutes, value: '' + snappedMinute });
    wheels.push({ name: 'ampm', options: [{ value: 'AM', label: 'AM' }, { value: 'PM', label: 'PM' }], value: __ampm(p) });
  }
  return wheels;
}
function __applyWheel(parts, wheel, value) {
  var p = __clampParts(parts);
  var next, parsed, h12;
  if (wheel === 'month') { next = { year: p.year, month: Number(value), day: p.day, hour: p.hour, minute: p.minute }; return __clampParts(next); }
  if (wheel === 'day') { next = { year: p.year, month: p.month, day: Number(value), hour: p.hour, minute: p.minute }; return __clampParts(next); }
  if (wheel === 'year') { next = { year: Number(value), month: p.month, day: p.day, hour: p.hour, minute: p.minute }; return __clampParts(next); }
  if (wheel === 'date') {
    parsed = __parseParts(value);
    if (!parsed) return p;
    return { year: parsed.year, month: parsed.month, day: parsed.day, hour: p.hour, minute: p.minute };
  }
  if (wheel === 'hour') {
    h12 = Number(value);
    if (!isFinite(h12)) return p;
    return { year: p.year, month: p.month, day: p.day, hour: (h12 % 12) + (p.hour >= 12 ? 12 : 0), minute: p.minute };
  }
  if (wheel === 'minute') return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: Number(value) || 0 };
  if (wheel === 'ampm') {
    var wantPm = value === 'PM';
    var isPm = p.hour >= 12;
    if (wantPm === isPm) return p;
    return { year: p.year, month: p.month, day: p.day, hour: wantPm ? p.hour + 12 : p.hour - 12, minute: p.minute };
  }
  return p;
}
var __pickerStates = {};
function __buildPicker(el, scope, path) {
  var modeAttr = __attr(el, 'mode', scope);
  var mode = modeAttr === 'date' || modeAttr === 'time' ? modeAttr : 'datetime';
  var rawValue = __controlValue(el, 'value', scope);
  var current = __parseParts(rawValue) || __nowParts();
  var intervalRaw = Number(__controlValue(el, 'minuteInterval', scope));
  var interval = intervalRaw === 5 ? 5 : 1;
  var wrap = document.createElement('div');
  wrap.className = 'field';
  var label = __attr(el, 'label', scope);
  if (label) {
    var labelEl = document.createElement('span');
    labelEl.className = 'field-label';
    labelEl.textContent = String(label);
    wrap.appendChild(labelEl);
  }
  var box = document.createElement('div');
  box.className = 'picker-box';
  var valueEl = document.createElement('span');
  valueEl.className = 'picker-value';
  valueEl.textContent = __formatParts(current, mode);
  box.appendChild(valueEl);
  box.appendChild(__icon('calendar', 20, 'textMuted'));
  box.addEventListener('click', function () {
    var pending = __parseParts(__controlValue(el, 'value', scope)) || __nowParts();
    if (interval === 5) {
      pending.minute = Math.min(55, Math.round(pending.minute / 5) * 5);
    }
    __pickerStates[path] = { pending: pending };
    __render();
  });
  wrap.appendChild(box);
  var pickerState = __pickerStates[path];
  if (pickerState) wrap.appendChild(__buildPickerSheet(el, scope, path, mode, interval, pickerState));
  return wrap;
}
function __buildPickerSheet(el, scope, path, mode, interval, pickerState) {
  var overlay = document.createElement('div');
  overlay.className = 'overlay';
  var backdrop = document.createElement('div');
  backdrop.className = 'overlay-backdrop';
  backdrop.addEventListener('click', function () {
    delete __pickerStates[path];
    __render();
  });
  overlay.appendChild(backdrop);
  var sheet = document.createElement('section');
  sheet.className = 'sheet';
  var handle = document.createElement('div');
  handle.className = 'sheet-handle';
  sheet.appendChild(handle);
  var head = document.createElement('div');
  head.className = 'picker-head';
  var cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'picker-head-btn';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', function () {
    delete __pickerStates[path];
    __render();
  });
  head.appendChild(cancel);
  var headTitle = document.createElement('span');
  headTitle.className = 'picker-head-title';
  var label = __attr(el, 'label', scope);
  headTitle.textContent = label ? String(label) : 'Choose';
  head.appendChild(headTitle);
  var done = document.createElement('button');
  done.type = 'button';
  done.className = 'picker-head-btn picker-head-done';
  done.textContent = 'Done';
  done.addEventListener('click', function () {
    var st = __pickerStates[path];
    if (!st) return;
    var iso = __composeIso(st.pending);
    delete __pickerStates[path];
    __runChange(el, scope, iso);
  });
  head.appendChild(done);
  sheet.appendChild(head);
  var wheels = document.createElement('div');
  wheels.className = 'wheels';
  __wheelSpecs(pickerState.pending, mode, interval).forEach(function (spec) {
    var wheel = document.createElement('div');
    wheel.className = 'wheel' + (spec.name === 'date' ? ' wide' : '');
    wheel.setAttribute('data-wheel', spec.name);
    spec.options.forEach(function (option) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'wheel-value' + (option.value === spec.value ? ' selected' : '');
      item.textContent = option.label;
      item.setAttribute('data-value', option.value);
      item.addEventListener('click', function () {
        var st = __pickerStates[path];
        if (!st) return;
        st.pending = __applyWheel(st.pending, spec.name, option.value);
        __render();
      });
      wheel.appendChild(item);
    });
    wheels.appendChild(wheel);
  });
  sheet.appendChild(wheels);
  overlay.appendChild(sheet);
  return overlay;
}
function __overlayShell(el, scope, path, form, kids, kind) {
  var open = __controlValue(el, 'open', scope);
  if (open !== undefined && !__truthy(open)) return [];
  var overlay = document.createElement('div');
  overlay.className = 'overlay' + (kind === 'dialog' ? ' overlay-center' : '');
  var backdrop = document.createElement('div');
  backdrop.className = 'overlay-backdrop';
  backdrop.addEventListener('click', function () { __runClose(el, scope); });
  overlay.appendChild(backdrop);
  var panel = document.createElement('section');
  panel.className = kind;
  if (kind === 'sheet') {
    var handle = document.createElement('div');
    handle.className = 'sheet-handle';
    panel.appendChild(handle);
  }
  if (kind === 'dialog') {
    var title = __attr(el, 'title', scope);
    if (title) {
      var titleEl = document.createElement('div');
      titleEl.className = 'dialog-title';
      titleEl.textContent = String(title);
      panel.appendChild(titleEl);
    }
  }
  kids.forEach(function (k) { panel.appendChild(k); });
  overlay.appendChild(panel);
  return [overlay];
}
// Snackbar runtime (Stage 10). A plain-JS mirror of the runtime
// SnackBar service: one current bar, an auto-dismiss timer when the
// host environment provides timers, and action callbacks on the ref
// returned by open(). The preview tests dismiss through the action
// rather than waiting for real time.
var __snackState = null;
var __snackRef = null;
var __snackTimer = null;
function __snackClearTimer() {
  if (__snackTimer !== null && typeof clearTimeout === 'function') clearTimeout(__snackTimer);
  __snackTimer = null;
}
function __snackDismiss() {
  if (!__snackState) return;
  __snackClearTimer();
  __snackState = null;
  __snackRef = null;
}
function __snackPressAction() {
  var ref = __snackRef;
  __snackDismiss();
  if (ref) ref.__fire();
  __render();
}
var __snackBarObj = {
  open: function (message, actionLabel, durationMs) {
    __snackClearTimer();
    var callbacks = [];
    var ref = {
      onAction: function (cb) { callbacks.push(cb); return ref; },
      dismiss: function () {
        if (__snackRef === ref) { __snackDismiss(); __render(); }
      },
      __fire: function () { callbacks.slice().forEach(function (cb) { cb(); }); }
    };
    __snackRef = ref;
    var duration = durationMs === undefined ? 4000 : durationMs;
    __snackState = { message: String(message), actionLabel: actionLabel, durationMs: duration };
    if (duration > 0 && typeof setTimeout === 'function') {
      __snackTimer = setTimeout(function () { __snackDismiss(); __render(); }, duration);
    }
    return ref;
  }
};
function __buildSnackbar(host) {
  if (!__snackState || !host || !host.appendChild) return;
  var bar = document.createElement('div');
  bar.className = 'snackbar';
  var text = document.createElement('span');
  text.className = 'snackbar-text';
  text.textContent = __snackState.message;
  bar.appendChild(text);
  if (__snackState.actionLabel) {
    var action = document.createElement('button');
    action.type = 'button';
    action.className = 'snackbar-action';
    action.textContent = String(__snackState.actionLabel).toUpperCase();
    action.addEventListener('click', function () { __snackPressAction(); });
    bar.appendChild(action);
  }
  host.appendChild(bar);
}
// Forms runtime (Stage 8). Plain-JS mirrors of the @rangular/runtime
// forms core (Validators, FormControl, FormGroup semantics and error
// shapes), plus the mini evaluator for form field initializers and the
// ngModel ref builder. The preview never uses eval on author code: the
// initializer shapes are parsed by hand, like everything else here.
function __isEmptyValue(v) {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}
function __valueLength(v) {
  return (typeof v === 'string' || Array.isArray(v)) ? v.length : String(v).length;
}
var __Validators = {
  required: function (v) { return __isEmptyValue(v) ? { required: true } : null; },
  minLength: function (n) {
    return function (v) {
      if (__isEmptyValue(v)) return null;
      var len = __valueLength(v);
      return len < n ? { minlength: { requiredLength: n, actualLength: len } } : null;
    };
  },
  maxLength: function (n) {
    return function (v) {
      if (__isEmptyValue(v)) return null;
      var len = __valueLength(v);
      return len > n ? { maxlength: { requiredLength: n, actualLength: len } } : null;
    };
  },
  email: function (v) {
    if (__isEmptyValue(v)) return null;
    return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(String(v)) ? null : { email: true };
  },
  pattern: function (p) {
    var rp = String(p);
    if (rp.charAt(0) !== '^') rp = '^' + rp;
    if (rp.charAt(rp.length - 1) !== '$') rp = rp + '$';
    var re = new RegExp(rp);
    return function (v) {
      if (__isEmptyValue(v)) return null;
      return re.test(String(v)) ? null : { pattern: { requiredPattern: rp, actualValue: v } };
    };
  }
};
function __validateValue(value, fns) {
  var merged = null;
  (fns || []).forEach(function (fn) {
    var errs = fn(value);
    if (errs) {
      merged = merged || {};
      Object.keys(errs).forEach(function (k) { merged[k] = errs[k]; });
    }
  });
  return merged;
}
function __validatorsOf(el, scope) {
  var fns = [];
  function argOf(attr, binding) {
    var b = __binding(el, binding, scope);
    if (b !== undefined) return b;
    var a = el.attrs[attr];
    if (a === undefined) return undefined;
    return isNaN(Number(a)) ? a : Number(a);
  }
  if (el.booleanAttrs.indexOf('required') >= 0
    || (el.attrs['required'] !== undefined && el.attrs['required'] !== 'false')) fns.push(__Validators.required);
  var min = argOf('minlength', 'minlength');
  if (min !== undefined) fns.push(__Validators.minLength(min));
  var max = argOf('maxlength', 'maxlength');
  if (max !== undefined) fns.push(__Validators.maxLength(max));
  if (el.booleanAttrs.indexOf('email') >= 0
    || (el.attrs['email'] !== undefined && el.attrs['email'] !== 'false')) fns.push(__Validators.email);
  var pat = argOf('pattern', 'pattern');
  if (pat !== undefined) fns.push(__Validators.pattern(pat));
  return fns;
}
function __makeControl(args) {
  var spec = args.length > 1 ? args[1] : null;
  var c = {
    value: args.length ? args[0] : null,
    touched: false,
    dirty: false,
    errors: null,
    __validators: spec === null || spec === undefined ? [] : (Array.isArray(spec) ? spec : [spec]),
    setValue: function (v) {
      c.value = v;
      c.dirty = true;
      c.errors = __validateValue(c.value, c.__validators);
    },
    markAsTouched: function () { c.touched = true; }
  };
  c.errors = __validateValue(c.value, c.__validators);
  Object.defineProperty(c, 'valid', { get: function () { return c.errors === null; } });
  Object.defineProperty(c, 'invalid', { get: function () { return c.errors !== null; } });
  return c;
}
function __makeGroup(controls) {
  var g = {
    controls: controls || {},
    get: function (name) { return g.controls[name]; },
    markAllAsTouched: function () {
      Object.keys(g.controls).forEach(function (k) { g.controls[k].markAsTouched(); });
    }
  };
  Object.defineProperty(g, 'value', {
    get: function () {
      var out = {};
      Object.keys(g.controls).forEach(function (k) { out[k] = g.controls[k].value; });
      return out;
    }
  });
  Object.defineProperty(g, 'valid', {
    get: function () {
      return Object.keys(g.controls).every(function (k) { return g.controls[k].valid; });
    }
  });
  Object.defineProperty(g, 'invalid', { get: function () { return !g.valid; } });
  Object.defineProperty(g, 'touched', {
    get: function () {
      return Object.keys(g.controls).some(function (k) { return g.controls[k].touched; });
    }
  });
  return g;
}
function __evalFormInit(src) {
  var s = String(src), i = 0;
  function ws() { while (i < s.length && /\s/.test(s[i])) i++; }
  function parseArgs() {
    ws();
    var args = [];
    if (s[i] === '(') {
      i++;
      ws();
      if (s[i] !== ')') {
        for (;;) {
          args.push(parseValue());
          ws();
          if (s[i] === ',') { i++; ws(); if (s[i] === ')') break; continue; }
          break;
        }
      }
      ws();
      if (s[i] === ')') i++;
    }
    return args;
  }
  function parseValue() {
    ws();
    var ch = s[i];
    if (ch === "'" || ch === '"') {
      var j = i + 1, v = '';
      while (j < s.length && s[j] !== ch) {
        if (s[j] === '\\' && j + 1 < s.length) { v += s[j + 1]; j += 2; }
        else { v += s[j]; j++; }
      }
      i = j + 1;
      return v;
    }
    if (ch === '[') {
      i++;
      var arr = [];
      ws();
      if (s[i] !== ']') {
        for (;;) {
          arr.push(parseValue());
          ws();
          if (s[i] === ',') { i++; ws(); if (s[i] === ']') break; continue; }
          break;
        }
      }
      ws();
      if (s[i] === ']') i++;
      return arr;
    }
    if (ch === '{') {
      i++;
      var obj = {};
      ws();
      if (s[i] !== '}') {
        for (;;) {
          ws();
          if (s[i] === '}') break;
          var key;
          if (s[i] === "'" || s[i] === '"') key = parseValue();
          else {
            var km = /^[A-Za-z_$][\w$]*/.exec(s.slice(i));
            if (!km) throw new Error('preview: bad key in form initializer');
            key = km[0];
            i += km[0].length;
          }
          ws();
          if (s[i] === ':') i++;
          obj[key] = parseValue();
          ws();
          if (s[i] === ',') { i++; continue; }
          break;
        }
      }
      ws();
      if (s[i] === '}') i++;
      return obj;
    }
    if (s.substr(i, 3) === 'new' && !/[A-Za-z0-9_$]/.test(s[i + 3] || '')) {
      i += 3;
      ws();
      var nm = /^[A-Za-z_$][\w$]*/.exec(s.slice(i));
      if (!nm) throw new Error('preview: bad form initializer');
      i += nm[0].length;
      var args = parseArgs();
      if (nm[0] === 'FormControl') return __makeControl(args);
      if (nm[0] === 'FormGroup') return __makeGroup(args[0]);
      throw new Error('preview: unsupported form initializer ' + nm[0]);
    }
    var idm = /^[A-Za-z_$][\w$]*/.exec(s.slice(i));
    if (idm) {
      var name = idm[0];
      i += name.length;
      if (name === 'true') return true;
      if (name === 'false') return false;
      if (name === 'null') return null;
      if (name === 'Validators') {
        ws();
        if (s[i] === '.') {
          i++;
          var vm = /^[A-Za-z_$][\w$]*/.exec(s.slice(i));
          if (!vm) throw new Error('preview: bad Validators reference');
          i += vm[0].length;
          ws();
          if (s[i] === '(') {
            var vargs = parseArgs();
            return __Validators[vm[0]].apply(null, vargs);
          }
          return __Validators[vm[0]];
        }
      }
      throw new Error('preview: unsupported identifier in form initializer: ' + name);
    }
    var num = /^-?\d+(\.\d+)?/.exec(s.slice(i));
    if (num) { i += num[0].length; return Number(num[0]); }
    throw new Error('preview: cannot evaluate form initializer');
  }
  try {
    return parseValue();
  } catch (err) {
    console.warn(err);
    return undefined;
  }
}
function __evalExprInit(src) {
  // Verbatim field initializers (proof fix): the page rebuilds the
  // fields codegen declares by emitting the initializer verbatim.
  // Supported shapes mirror the compiler side evaluator: new Date(...)
  // with literal arguments, Date.now(), and plain expressions over
  // literals, which run through the page expression evaluator against
  // an empty scope. Anything else yields undefined, the same safe
  // fallback the generated code declares for initializers it cannot
  // place. A Date stays a Date here, never a JSON string.
  var s = String(src).replace(/^\s+|\s+$/g, '');
  try {
    var m = /^new\s+Date\s*\(([\s\S]*)\)$/.exec(s);
    if (m) {
      var inner = m[1].replace(/^\s+|\s+$/g, '');
      if (!inner) return new Date();
      var args = __eval(__parse('[' + inner + ']'), {});
      return new (Date.bind.apply(Date, [null].concat(args)))();
    }
    if (/^Date\.now\s*\(\s*\)$/.test(s)) return Date.now();
    return __eval(__parse(s), {});
  } catch (err) {
    console.warn('preview: cannot evaluate field initializer', err);
    return undefined;
  }
}
function __refsFor(nodes, stateObj, touched, scope) {
  var refs = {};
  function walk(list) {
    (list || []).forEach(function (n) {
      if (n.type !== 'element') return;
      if (COMPONENTS[n.tag]) return;
      if (n.tag === 'input' && n.ref && n.refExport === 'ngModel') {
        var expr = null;
        (n.twoWayBindings || []).forEach(function (b) { if (b.name === 'ngModel') expr = b.expression; });
        if (!expr) n.propBindings.forEach(function (b) { if (b.name === 'ngModel') expr = b.expression; });
        if (expr && /^[A-Za-z_$][\w$]*$/.test(expr.trim())) {
          var field = expr.trim();
          var errs = __validateValue(stateObj[field], __validatorsOf(n, scope));
          refs[n.ref] = {
            value: stateObj[field], errors: errs,
            valid: errs === null, invalid: errs !== null,
            touched: !!touched[n.ref]
          };
        }
      }
      walk(n.children);
    });
  }
  walk(nodes);
  return refs;
}
function __formCtx(el, scope) {
  var ctx = { submit: null, group: null, touchedKeys: [], touched: (scope && scope.__touched) || {} };
  el.eventBindings.forEach(function (ev) {
    if (ev.name === 'submit' || ev.name === 'ngSubmit') ctx.submit = ev;
  });
  var g = __binding(el, 'formGroup', scope);
  if (g !== undefined && g !== null) ctx.group = g;
  return ctx;
}
var __autoStates = {};
function __buildInput(el, scope, form, path) {
  var wrap = document.createElement('div');
  wrap.className = 'field';
  var labelText = __attr(el, 'label', scope);
  if (labelText) {
    var ls = document.createElement('span');
    ls.className = 'field-label';
    ls.textContent = String(labelText);
    wrap.appendChild(ls);
  }
  var input = document.createElement('input');
  input.className = 'field-input';
  var typeAttr = el.attrs['type'];
  input.type = typeAttr === 'password' ? 'password' : typeAttr === 'email' ? 'email' : typeAttr === 'number' ? 'number' : 'text';
  var ph = __attr(el, 'placeholder', scope);
  if (ph) input.setAttribute('placeholder', String(ph));
  var fcn = el.attrs['formControlName'];
  var control = null;
  if (fcn !== undefined && form && form.group && form.group.get) control = form.group.get(fcn);
  var tw = null, pair = null;
  (el.twoWayBindings || []).forEach(function (b) { if (b.name === 'ngModel') tw = b; });
  el.propBindings.forEach(function (b) { if (b.name === 'ngModel') pair = b; });
  var model = tw || pair;
  var field = null;
  if (model && /^[A-Za-z_$][\w$]*$/.test(model.expression.trim())) field = model.expression.trim();
  var value;
  if (control) value = control.value;
  else if (model) {
    try { value = __evalSrc(model.expression, scope); }
    catch (err) { console.warn(err); value = undefined; }
  } else {
    var vb = __binding(el, 'value', scope);
    value = vb !== undefined ? vb : el.attrs['value'];
  }
  input.value = value === undefined || value === null ? '' : String(value);
  if (__truthy(__controlValue(el, 'disabled', scope))) input.disabled = true;
  var touchedKey = el.ref || field;
  if (form && field && touchedKey && form.touchedKeys.indexOf(touchedKey) < 0) form.touchedKeys.push(touchedKey);
  input.addEventListener('input', function () {
    var v = input.value;
    if (control) control.setValue(v);
    if (tw && field && scope.__state) scope.__state[field] = v;
    el.eventBindings.forEach(function (ev) {
      if (ev.name === 'ngModelChange' || ev.name === 'input') __runHandler(ev.expression, scope, v);
    });
    __render();
  });
  input.addEventListener('change', function () {
    el.eventBindings.forEach(function (ev) {
      if (ev.name === 'change') __runHandler(ev.expression, scope, input.value);
    });
    __render();
  });
  input.addEventListener('blur', function () {
    if (control) control.markAsTouched();
    if (field && scope.__touched && touchedKey) scope.__touched[touchedKey] = true;
    el.eventBindings.forEach(function (ev) {
      if (ev.name === 'blur') __runHandler(ev.expression, scope, undefined);
    });
    __render();
  });
  input.addEventListener('focus', function () {
    el.eventBindings.forEach(function (ev) {
      if (ev.name === 'focus') __runHandler(ev.expression, scope, undefined);
    });
  });
  wrap.appendChild(input);
  // Autocomplete (Stage 11): with an [options] binding, while the
  // field is focused and its text is non-empty, a panel under the
  // field lists the options containing the text (case-insensitive
  // substring, the Angular Material example filter). Choosing one
  // writes it through the same path as typing, reports it through
  // (optionSelected), and closes the panel. Open state is keyed by
  // template path so it survives re-renders, like the picker state.
  var optionsBinding = null;
  el.propBindings.forEach(function (b) { if (b.name === 'options') optionsBinding = b; });
  if (optionsBinding) {
    var anchor = document.createElement('div');
    anchor.className = 'auto-anchor';
    anchor.appendChild(input);
    wrap.appendChild(anchor);
    var allOptions = [];
    try { allOptions = __evalSrc(optionsBinding.expression, scope); }
    catch (err) { console.warn(err); allOptions = []; }
    var autoText = input.value;
    var autoMatches = [];
    if (__autoStates[path] && Array.isArray(allOptions) && autoText !== '') {
      var lowerText = autoText.toLowerCase();
      allOptions.forEach(function (o) {
        if (typeof o === 'string' && o.toLowerCase().indexOf(lowerText) >= 0) autoMatches.push(o);
      });
    }
    if (autoMatches.length) {
      var autoPanel = document.createElement('div');
      autoPanel.className = 'auto-panel';
      autoMatches.forEach(function (option) {
        var optionRow = document.createElement('div');
        optionRow.className = 'auto-option';
        optionRow.textContent = option;
        var chosen = false;
        var choose = function () {
          if (chosen) return;
          chosen = true;
          if (control) control.setValue(option);
          if (tw && field && scope.__state) scope.__state[field] = option;
          el.eventBindings.forEach(function (ev) {
            if (ev.name === 'ngModelChange') __runHandler(ev.expression, scope, option);
          });
          __autoStates[path] = false;
          __runEvent(el, scope, 'optionSelected', option);
          __render();
        };
        // mousedown lands before the field's blur in a browser, click
        // is what simple harnesses dispatch; the guard makes the pair
        // choose exactly once.
        optionRow.addEventListener('mousedown', choose);
        optionRow.addEventListener('click', choose);
        autoPanel.appendChild(optionRow);
      });
      anchor.appendChild(autoPanel);
    }
    input.addEventListener('focus', function () {
      if (!__autoStates[path]) { __autoStates[path] = true; __render(); }
    });
    input.addEventListener('blur', function () {
      if (typeof setTimeout === 'function') {
        setTimeout(function () {
          if (__autoStates[path]) { __autoStates[path] = false; __render(); }
        }, 150);
      } else if (__autoStates[path]) {
        __autoStates[path] = false;
        __render();
      }
    });
  }
  var errText = __attr(el, 'error', scope);
  if (errText) {
    var es = document.createElement('span');
    es.className = 'field-error';
    es.textContent = String(errText);
    wrap.appendChild(es);
  }
  return wrap;
}
// Data display builders (Stage 11). Open and selection state that
// the primitives hold internally is keyed by template path here, so
// it survives re-renders: uncontrolled tab selection, standalone
// panel open state, and each accordion's one open panel.
var __tabStates = {};
var __panelStates = {};
var __accStates = {};
var __accStack = [];
function __panelSeedOpen(el, scope) {
  var v = __controlValue(el, 'expanded', scope);
  return v === true || v === 'true';
}
function __buildTabs(el, scope, path, form) {
  var wrap = document.createElement('div');
  wrap.className = 'tabs';
  var tabEls = el.children.filter(function (c) { return c.type === 'element' && c.tag === 'tab'; });
  var boundIndex = __controlValue(el, 'index', scope);
  var controlled = typeof boundIndex === 'number';
  var active = controlled ? boundIndex : (__tabStates[path] || 0);
  active = Math.min(Math.max(active, 0), Math.max(tabEls.length - 1, 0));
  var headers = document.createElement('div');
  headers.className = 'tab-headers';
  tabEls.forEach(function (tab, i) {
    var h = document.createElement('div');
    h.className = 'tab-header' + (i === active ? ' selected' : '');
    var label = document.createElement('span');
    label.className = 'tab-label';
    var lt = __attr(tab, 'label', scope);
    label.textContent = lt ? String(lt) : '';
    h.appendChild(label);
    if (i === active) {
      var ind = document.createElement('span');
      ind.className = 'tab-indicator';
      h.appendChild(ind);
    }
    h.addEventListener('click', function () {
      if (!controlled) __tabStates[path] = i;
      __runChange(el, scope, i);
      __render();
    });
    headers.appendChild(h);
  });
  wrap.appendChild(headers);
  var activeTab = tabEls[active];
  if (activeTab) {
    __buildNodes(activeTab.children, scope, path + '/tab' + active, form).forEach(function (k) { wrap.appendChild(k); });
  }
  return wrap;
}
function __buildAccordion(el, scope, path, form) {
  var wrap = document.createElement('div');
  wrap.className = 'accordion';
  var st = __accStates[path];
  if (!st) { st = { openPath: null, init: false }; __accStates[path] = st; }
  if (!st.init) {
    st.init = true;
    el.children.forEach(function (child, i) {
      if (st.openPath === null && child.type === 'element' && child.tag === 'panel' && __panelSeedOpen(child, scope)) {
        st.openPath = path + '/' + i;
      }
    });
  }
  __accStack.push({ path: path, state: st });
  try {
    __buildNodes(el.children, scope, path, form).forEach(function (k) { wrap.appendChild(k); });
  } finally {
    __accStack.pop();
  }
  return wrap;
}
function __buildPanel(el, scope, path, form) {
  // The nearest enclosing accordion (the longest matching path
  // prefix on the stack) owns this panel's open state; standalone
  // panels keep their own, seeded by [expanded].
  var group = null;
  for (var gi = __accStack.length - 1; gi >= 0; gi--) {
    if (path.indexOf(__accStack[gi].path + '/') === 0) { group = __accStack[gi]; break; }
  }
  var open;
  if (group) open = group.state.openPath === path;
  else {
    if (__panelStates[path] === undefined) __panelStates[path] = __panelSeedOpen(el, scope);
    open = !!__panelStates[path];
  }
  var wrap = document.createElement('div');
  wrap.className = 'panel';
  var header = document.createElement('div');
  header.className = 'panel-header';
  var titles = document.createElement('div');
  titles.className = 'panel-titles';
  var titleText = __attr(el, 'title', scope);
  if (titleText) {
    var pt = document.createElement('div');
    pt.className = 'panel-title';
    pt.textContent = String(titleText);
    titles.appendChild(pt);
  }
  var subText = __attr(el, 'subtitle', scope);
  if (subText) {
    var ps = document.createElement('div');
    ps.className = 'panel-subtitle';
    ps.textContent = String(subText);
    titles.appendChild(ps);
  }
  header.appendChild(titles);
  var chev = document.createElement('span');
  chev.className = 'panel-chevron' + (open ? ' open' : '');
  chev.appendChild(__icon('chevron-right', 24, 'textMuted'));
  header.appendChild(chev);
  header.addEventListener('click', function () {
    var next = !open;
    if (group) group.state.openPath = next ? path : null;
    else __panelStates[path] = next;
    __runEvent(el, scope, 'toggle', next);
    __render();
  });
  wrap.appendChild(header);
  if (open) {
    var body = document.createElement('div');
    body.className = 'panel-body';
    __buildNodes(el.children, scope, path, form).forEach(function (k) { body.appendChild(k); });
    wrap.appendChild(body);
  }
  return wrap;
}
function __buildTable(el, scope) {
  var wrap = document.createElement('div');
  wrap.className = 'table';
  var cols = [];
  el.children.forEach(function (c) {
    if (c.type !== 'element' || c.tag !== 'column') return;
    var name = c.attrs['name'] !== undefined ? c.attrs['name'] : c.attrs['key'];
    if (!name) return;
    cols.push({ name: name, header: c.attrs['header'] !== undefined ? c.attrs['header'] : name });
  });
  var head = document.createElement('div');
  head.className = 'table-row';
  cols.forEach(function (col) {
    var cell = document.createElement('span');
    cell.className = 'table-cell head';
    cell.textContent = col.header;
    head.appendChild(cell);
  });
  wrap.appendChild(head);
  var data = __binding(el, 'data', scope);
  var rows = Array.isArray(data) ? data : [];
  rows.forEach(function (row) {
    var r = document.createElement('div');
    r.className = 'table-row';
    cols.forEach(function (col) {
      var cell = document.createElement('span');
      cell.className = 'table-cell';
      var v = row ? row[col.name] : undefined;
      cell.textContent = v === undefined || v === null ? '' : String(v);
      r.appendChild(cell);
    });
    wrap.appendChild(r);
  });
  if (!rows.length && el.attrs['emptyText']) {
    var empty = document.createElement('div');
    empty.className = 'table-empty';
    empty.textContent = el.attrs['emptyText'];
    wrap.appendChild(empty);
  }
  return wrap;
}
function __sliderNum(el, name, scope, fallback) {
  var v = __controlValue(el, name, scope);
  var n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  return isFinite(n) ? n : fallback;
}
function __buildSlider(el, scope, path) {
  var min = __sliderNum(el, 'min', scope, 0);
  var max = __sliderNum(el, 'max', scope, 100);
  var step = __sliderNum(el, 'step', scope, 1);
  if (!(step > 0)) step = 1;
  var raw = __controlValue(el, 'value', scope);
  var value = typeof raw === 'number' ? raw : min;
  var frac = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
  var wrap = document.createElement('div');
  wrap.className = 'slider';
  var track = document.createElement('div');
  track.className = 'slider-track';
  var fill = document.createElement('div');
  fill.className = 'slider-fill';
  fill.style.width = (frac * 100) + '%';
  track.appendChild(fill);
  var thumb = document.createElement('div');
  thumb.className = 'slider-thumb';
  thumb.style.left = (frac * 100) + '%';
  track.appendChild(thumb);
  wrap.appendChild(track);
  // Preview simplification (documented): with at most 20 steps the
  // track also renders one tappable tick per step value, because a
  // DOM harness cannot click at an x fraction reliably. The app
  // slider takes taps and drags at any position.
  var steps = Math.round((max - min) / step);
  if (steps > 0 && steps <= 20) {
    var ticks = document.createElement('div');
    ticks.className = 'slider-ticks';
    for (var i = 0; i <= steps; i++) {
      (function (tickValue, leftPct) {
        var tick = document.createElement('button');
        tick.type = 'button';
        tick.className = 'slider-tick';
        tick.style.left = leftPct + '%';
        if (tick.setAttribute) tick.setAttribute('data-value', String(tickValue));
        tick.addEventListener('click', function () { __runChange(el, scope, tickValue); });
        ticks.appendChild(tick);
      })(min + i * step, (i / steps) * 100);
    }
    wrap.appendChild(ticks);
  }
  return wrap;
}
function __buildProgress(el, scope) {
  var mode = __attr(el, 'mode', scope);
  var pct = 40;
  if (mode !== 'indeterminate') {
    var v = __controlValue(el, 'value', scope);
    var n = typeof v === 'number' ? v : Number(v);
    pct = isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
  }
  var wrap = document.createElement('div');
  wrap.className = 'progress';
  var fill = document.createElement('div');
  fill.className = 'progress-fill';
  fill.style.width = pct + '%';
  wrap.appendChild(fill);
  return wrap;
}
function __buildSpinner(el, scope) {
  var size = __iconSize(el, scope);
  var color = __attr(el, 'color', scope);
  var stroke = 'var(--role-primary)';
  if (color) {
    stroke = /^[a-zA-Z]+$/.test(String(color))
      ? 'var(--role-' + __kebabRole(color) + ')'
      : String(color);
  }
  var span = document.createElement('span');
  span.className = 'spinner';
  // Static in the preview (documented): the app rotates this arc.
  span.innerHTML = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24"><path d="' + __SPINNER_ARC + '" stroke="' + stroke + '" stroke-width="2.5" stroke-linecap="round" fill="none"/></svg>';
  return span;
}
function __buildChip(el, scope, path, form) {
  var chip = document.createElement('span');
  chip.className = 'chip';
  var iconName = el.attrs['icon'];
  if (iconName) chip.appendChild(__icon(iconName, 20, 'textMuted'));
  var label = document.createElement('span');
  label.className = 'chip-label';
  __buildNodes(el.children, scope, path, form).forEach(function (k) { label.appendChild(k); });
  chip.appendChild(label);
  if (el.booleanAttrs.indexOf('removable') >= 0) {
    var rm = document.createElement('span');
    rm.className = 'chip-remove';
    rm.appendChild(__icon('close', 20, 'textMuted'));
    rm.addEventListener('click', function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      __runEvent(el, scope, 'remove', undefined);
      __render();
    });
    chip.appendChild(rm);
  }
  return chip;
}
function __buildCore(el, scope, path, form) {
  if (el.tag === 'ng-content') {
    // Content projection (Stage 12): paint the content the host wrote
    // inside this component's tag, in the host's scope; a nested
    // <ng-content> inside that content sees the outer content.
    var content = scope.__content;
    if (!content) return [];
    var cs = __extend(content.scope, {});
    cs.__content = content.outer;
    return __buildNodes(content.nodes, cs, path + '/content', form);
  }
  if (el.tag === 'router-outlet') return __buildOutlet(el, scope, path);
  if (COMPONENTS[el.tag]) return __buildChild(el, scope, path);
  if (el.tag === 'datetime-picker') return [__buildPicker(el, scope, path)];
  // Data display (Stage 11): dedicated builders, like the picker.
  if (el.tag === 'tabs') return [__buildTabs(el, scope, path, form)];
  if (el.tag === 'accordion') return [__buildAccordion(el, scope, path, form)];
  if (el.tag === 'panel') return [__buildPanel(el, scope, path, form)];
  if (el.tag === 'table') return [__buildTable(el, scope)];
  if (el.tag === 'column' || el.tag === 'tab') return [];
  if (el.tag === 'slider') return [__buildSlider(el, scope, path)];
  if (el.tag === 'progress-bar') return [__buildProgress(el, scope)];
  if (el.tag === 'spinner') return [__buildSpinner(el, scope)];
  if (el.tag === 'chip') return [__buildChip(el, scope, path, form)];
  var kidsForm = form;
  if (el.tag === 'form') kidsForm = __formCtx(el, scope);
  var kids = __buildNodes(el.children, scope, path, kidsForm);
  function wrap(tag, cls) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    kids.forEach(function (k) { d.appendChild(k); });
    return [d];
  }
  var title = __attr(el, 'title', scope);
  switch (el.tag) {
    case 'screen': return wrap('div', 'screen');
    case 'appbar': {
      var bar = document.createElement('header');
      bar.className = 'appbar';
      bar.appendChild(__icon('menu', 24, 'textMuted'));
      var search = __attr(el, 'search', scope);
      var mid = document.createElement('span');
      if (search) { mid.className = 'search'; mid.textContent = String(search); }
      else { mid.className = 'appbar-title'; mid.textContent = title ? String(title) : ''; }
      bar.appendChild(mid);
      var av = document.createElement('span');
      av.className = 'avatar';
      av.textContent = (title ? String(title) : 'R').charAt(0);
      bar.appendChild(av);
      return [bar];
    }
    case 'h1': return wrap('h1', 'display');
    case 'h2': return wrap('h2', 'heading');
    case 'h3': return wrap('h3', 'title');
    case 'p': return wrap('p', 'body');
    case 'label': return wrap('span', 'label');
    case 'span': {
      var sp = wrap('span', '');
      if (el.attrs['class']) sp[0].className = el.attrs['class'];
      return sp;
    }
    case 'card': return wrap('section', 'card');
    case 'sheet': return __overlayShell(el, scope, path, form, kids, 'sheet');
    case 'dialog': return __overlayShell(el, scope, path, form, kids, 'dialog');
    case 'actions': return wrap('div', 'actions');
    case 'form': return wrap('div', 'form');
    case 'input': return [__buildInput(el, scope, form, path)];
    case 'chips': return wrap('div', 'chips');
    case 'button': {
      var b = document.createElement('button');
      b.className = 'btn';
      if (__binding(el, 'disabled', scope)) b.disabled = true;
      kids.forEach(function (k) { b.appendChild(k); });
      var btnDot = __badgeDot(el, scope);
      if (btnDot) b.appendChild(btnDot);
      // Form submit (Stage 8): a submit button inside a form with a
      // (submit) handler runs that handler, first marking every ngModel
      // input touched (and every control of a reactive group), the
      // same composition the compiler generates.
      var hasClick = false;
      el.eventBindings.forEach(function (ev) { if (ev.name === 'click') hasClick = true; });
      if (el.attrs['type'] === 'submit' && form && form.submit && !hasClick) {
        b.addEventListener('click', function () {
          if (b.disabled) return;
          form.touchedKeys.forEach(function (k) { form.touched[k] = true; });
          if (form.group && form.group.markAllAsTouched) form.group.markAllAsTouched();
          __runHandler(form.submit.expression, scope, undefined);
          __render();
        });
      } else {
        __attachEvents(b, el, scope);
        // A routerLink on the button navigates after any (click)
        // handler, the same composition the compiler generates.
        __attachNav(b, el, scope);
      }
      return [b];
    }
    case 'switch': {
      var switchChecked = __truthy(__controlValue(el, 'checked', scope));
      var sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'switch' + (switchChecked ? ' on' : '');
      var swTrack = document.createElement('span');
      swTrack.className = 'switch-track';
      var swKnob = document.createElement('span');
      swKnob.className = 'switch-knob';
      swTrack.appendChild(swKnob);
      sw.appendChild(swTrack);
      var swLabel = document.createElement('span');
      swLabel.className = 'control-label';
      kids.forEach(function (k) { swLabel.appendChild(k); });
      sw.appendChild(swLabel);
      if (__truthy(__controlValue(el, 'disabled', scope))) sw.disabled = true;
      else sw.addEventListener('click', function () { __runChange(el, scope, !switchChecked); });
      return [sw];
    }
    case 'checkbox': {
      var checkboxChecked = __truthy(__controlValue(el, 'checked', scope));
      var checkbox = document.createElement('button');
      checkbox.type = 'button';
      checkbox.className = 'checkbox' + (checkboxChecked ? ' on' : '');
      var checkboxBox = document.createElement('span');
      checkboxBox.className = 'checkbox-box';
      if (checkboxChecked) {
        checkboxBox.appendChild(__icon('check', 20, 'onPrimary'));
      }
      checkbox.appendChild(checkboxBox);
      var checkboxLabel = document.createElement('span');
      checkboxLabel.className = 'control-label';
      kids.forEach(function (k) { checkboxLabel.appendChild(k); });
      checkbox.appendChild(checkboxLabel);
      if (__truthy(__controlValue(el, 'disabled', scope))) checkbox.disabled = true;
      else checkbox.addEventListener('click', function () { __runChange(el, scope, !checkboxChecked); });
      return [checkbox];
    }
    case 'switcher': {
      var switcher = document.createElement('div');
      switcher.className = 'switcher';
      var switcherValue = __controlValue(el, 'value', scope);
      var switcherDisabled = __truthy(__controlValue(el, 'disabled', scope));
      el.children.forEach(function (child, childIndex) {
        if (child.type !== 'element' || child.tag !== 'option') return;
        var optionValue = __controlValue(child, 'value', scope);
        var segment = document.createElement('button');
        segment.type = 'button';
        segment.className = 'switcher-option' + (String(switcherValue) === String(optionValue) ? ' selected' : '');
        __buildNodes(child.children, scope, path + '/option' + childIndex, kidsForm).forEach(function (k) { segment.appendChild(k); });
        if (switcherDisabled) segment.disabled = true;
        else segment.addEventListener('click', function () { __runChange(el, scope, optionValue); });
        switcher.appendChild(segment);
      });
      return [switcher];
    }
    case 'radio-group': {
      var radioGroup = document.createElement('div');
      radioGroup.className = 'radio-group';
      var radioValue = __controlValue(el, 'value', scope);
      var radioDisabled = __truthy(__controlValue(el, 'disabled', scope));
      el.children.forEach(function (child, childIndex) {
        if (child.type !== 'element' || child.tag !== 'radio') return;
        var choiceValue = __controlValue(child, 'value', scope);
        var selected = String(radioValue) === String(choiceValue);
        var choice = document.createElement('button');
        choice.type = 'button';
        choice.className = 'radio-option' + (selected ? ' selected' : '');
        var circle = document.createElement('span');
        circle.className = 'radio-circle';
        if (selected) {
          var dot = document.createElement('span');
          dot.className = 'radio-dot';
          circle.appendChild(dot);
        }
        choice.appendChild(circle);
        var choiceLabel = document.createElement('span');
        choiceLabel.className = 'control-label';
        __buildNodes(child.children, scope, path + '/radio' + childIndex, kidsForm).forEach(function (k) { choiceLabel.appendChild(k); });
        choice.appendChild(choiceLabel);
        if (radioDisabled) choice.disabled = true;
        else choice.addEventListener('click', function () { __runChange(el, scope, choiceValue); });
        radioGroup.appendChild(choice);
      });
      return [radioGroup];
    }
    case 'list': return wrap('div', 'list');
    case 'row': {
      var row = document.createElement('div');
      row.className = 'row';
      if (el.booleanAttrs.indexOf('avatar') >= 0) {
        var avl = document.createElement('span');
        avl.className = 'avatar-lg';
        avl.textContent = (title ? String(title) : '•').charAt(0);
        row.appendChild(avl);
      }
      var main = document.createElement('span');
      main.className = 'row-main';
      var rt = document.createElement('span');
      rt.className = 'row-title';
      rt.textContent = title ? String(title) : '';
      main.appendChild(rt);
      var sub = __attr(el, 'subtitle', scope);
      if (sub) {
        var rs = document.createElement('span');
        rs.className = 'row-sub';
        rs.textContent = String(sub);
        main.appendChild(rs);
      }
      var det = __attr(el, 'detail', scope);
      if (det) {
        var rd = document.createElement('span');
        rd.className = 'row-detail';
        rd.textContent = String(det);
        main.appendChild(rd);
      }
      kids.forEach(function (k) { main.appendChild(k); });
      row.appendChild(main);
      var tm = __attr(el, 'time', scope);
      if (tm) {
        var rtEl = document.createElement('span');
        rtEl.className = 'row-time';
        rtEl.textContent = String(tm);
        row.appendChild(rtEl);
      }
      var rowDot = __badgeDot(el, scope);
      if (rowDot) row.appendChild(rowDot);
      __attachEvents(row, el, scope);
      __attachNav(row, el, scope);
      return [row];
    }
    case 'icon': {
      var iconName = __attr(el, 'name', scope);
      if (!iconName) return [];
      var iconNode = __icon(String(iconName), __iconSize(el, scope), __attr(el, 'color', scope));
      var iconDot = __badgeDot(el, scope);
      if (!iconDot) return [iconNode];
      var iconBadgeWrap = document.createElement('span');
      iconBadgeWrap.className = 'icon-badge';
      iconBadgeWrap.appendChild(iconNode);
      iconBadgeWrap.appendChild(iconDot);
      return [iconBadgeWrap];
    }
    case 'fab': {
      var f = wrap('div', 'fab')[0];
      if (!el.children.length) {
        var lbl = __attr(el, 'label', scope);
        f.textContent = lbl ? String(lbl) : 'Compose';
      }
      __attachEvents(f, el, scope);
      __attachNav(f, el, scope);
      return [f];
    }
    case 'header': return wrap('header', '');
    case 'section': return wrap('section', '');
    default: return wrap('div', '');
  }
}
var __svcCache = {};
var __instances = {};
function __httpStub() {
  return { get: function () { return { subscribe: function () { return { unsubscribe: function () {} }; } }; } };
}
function __resolveDep(token) {
  if (token === 'HttpClient') return __httpStub();
  if (token === 'SnackBar') return __snackBarObj;
  // Routing tokens (Stage 9): the Router is one shared object over the
  // preview's navigation stack; ActivatedRoute is seeded per route
  // component instance by the outlet (see __buildOutlet), falling back
  // to the current entry's params for any other consumer.
  if (token === 'Router') return __routerObj;
  if (token === 'ActivatedRoute') {
    return __activatedRouteObj(__pendingRouteParams || __currentEntry().params);
  }
  return __service(token);
}
function __bind(def, inst) {
  var fns = {};
  Object.keys(def.methods).forEach(function (name) {
    fns[name] = function () {
      var args = [inst.state, fns, inst.props];
      for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
      return def.methods[name].apply(null, args);
    };
  });
  return fns;
}
function __service(name) {
  if (__svcCache[name]) return __svcCache[name];
  var def = SERVICES[name];
  if (!def) { console.warn('preview: no service named ' + name); return {}; }
  var st = {};
  Object.keys(def.state).forEach(function (k) { st[k] = def.state[k]; });
  var inst = { state: st, props: {}, methods: {} };
  __svcCache[name] = st;
  Object.keys(def.deps).forEach(function (k) { st[k] = __resolveDep(def.deps[k]); });
  inst.methods = __bind(def, inst);
  Object.keys(inst.methods).forEach(function (m) { st[m] = inst.methods[m]; });
  return st;
}
function __childInstance(path, def, props) {
  var inst = __instances[path];
  if (!inst) {
    var st = {};
    Object.keys(def.state).forEach(function (k) { st[k] = def.state[k]; });
    inst = { state: st, props: {}, methods: {}, fresh: true, touched: {} };
    Object.keys(def.deps).forEach(function (k) { st[k] = __resolveDep(def.deps[k]); });
    Object.keys(def.formInits || {}).forEach(function (k) { st[k] = __evalFormInit(def.formInits[k]); });
    Object.keys(def.exprInits || {}).forEach(function (k) { st[k] = __evalExprInit(def.exprInits[k]); });
    inst.methods = __bind(def, inst);
    __instances[path] = inst;
  }
  inst.props = props;
  def.inputs.forEach(function (n) { if (n in props) inst.state[n] = props[n]; });
  return inst;
}
function __childScope(inst, def, content) {
  var s = {}, k;
  for (k in inst.state) s[k] = inst.state[k];
  for (k in inst.methods) s[k] = inst.methods[k];
  s.__content = content;
  // Forms channels (Stage 8), the child instance's own stores.
  s.__state = inst.state;
  s.__touched = inst.touched;
  s.__refs = def ? __refsFor(def.template.children, inst.state, inst.touched, s) : {};
  return s;
}
function __buildChild(el, scope, path) {
  var def = COMPONENTS[el.tag];
  var props = {};
  el.propBindings.forEach(function (b) {
    var v = __binding(el, b.name, scope);
    if (v !== undefined) props[b.name] = v;
  });
  Object.keys(el.attrs).forEach(function (k) { props[k] = el.attrs[k]; });
  el.booleanAttrs.forEach(function (a) { props[a] = true; });
  el.eventBindings.forEach(function (ev) {
    if (def.outputs.indexOf(ev.name) >= 0) {
      var cap = 'on' + ev.name.charAt(0).toUpperCase() + ev.name.slice(1);
      props[cap] = (function (expr, sc) {
        return function (value) { __runHandler(expr, sc, value); __render(); };
      })(ev.expression, scope);
    }
  });
  var inst = __childInstance(path, def, props);
  if (inst.fresh) {
    inst.fresh = false;
    if (def.onInit && inst.methods[def.onInit]) inst.methods[def.onInit]();
  }
  var content = { nodes: el.children, scope: scope, outer: scope.__content };
  var nodes = __buildNodes(def.template.children, __childScope(inst, def, content), path);
  var domEvents = el.eventBindings.filter(function (ev) { return def.outputs.indexOf(ev.name) < 0; });
  if (domEvents.length && nodes[0] && nodes[0].addEventListener) {
    __attachEvents(nodes[0], { eventBindings: domEvents }, scope);
  }
  return nodes;
}
// Routing runtime (Stage 9). Plain-JS mirrors of the @rangular/runtime
// matcher and navigator: the same segment rules, the same redirect
// handling, parity-tested against the runtime over a table of paths.
// The stack lives outside component state, like the generated app has
// its module-level navigator; navigating re-renders the shell and the
// outlet renders the top entry's route component. An ActivatedRoute is
// seeded per route instance by __buildOutlet (through __pendingRoute
// params), and the instance path keys on the matched route plus the
// concrete path, so a parameter change remounts the component, the
// same simplification the generated outlet makes.
// The back bar __buildOutlet adds above the routed content at depth 2+
// is PREVIEW CHROME ONLY: it stands in for the phone's back affordance.
// The generated app exposes RgNavigator.back() and the Expo scaffold
// wires the hardware back button to it (Stage 12); nothing of the bar
// exists in generated code or in the app UI.
var __navStack = [];
var __pendingRouteParams = null;
function __normalizePath(p) {
  return String(p).split('/').filter(function (s) { return s.length > 0; }).join('/');
}
function __segmentsOf(p) {
  var n = __normalizePath(p);
  return n === '' ? [] : n.split('/');
}
function __matchSegments(pattern, path) {
  if (pattern === '**') return {};
  var want = __segmentsOf(pattern), got = __segmentsOf(path);
  if (want.length !== got.length) return null;
  var params = {};
  for (var i = 0; i < want.length; i++) {
    if (want[i].charAt(0) === ':') params[want[i].slice(1)] = got[i];
    else if (want[i] !== got[i]) return null;
  }
  return params;
}
function __matchRoute(rawPath) {
  var current = __normalizePath(rawPath);
  var seen = {};
  for (var hop = 0; hop <= 10; hop++) {
    var hit = null;
    for (var i = 0; i < ROUTES.length; i++) {
      var params = __matchSegments(ROUTES[i].path, current);
      if (params) { hit = { def: ROUTES[i], params: params }; break; }
    }
    if (!hit) return null;
    if (hit.def.redirectTo === undefined) {
      return { path: current, params: hit.params, routePath: hit.def.path };
    }
    if (seen[current]) return null;
    seen[current] = true;
    current = __normalizePath(hit.def.redirectTo);
  }
  return null;
}
function __currentEntry() {
  return __navStack[__navStack.length - 1] || { path: '', params: {}, routePath: '' };
}
function __navigateTo(target) {
  var raw = Array.isArray(target)
    ? target.map(function (c) { return String(c); }).join('/')
    : String(target);
  var match = __matchRoute(raw);
  if (!match) { console.warn('preview: no route matches ' + raw); return false; }
  __navStack.push(match);
  __render();
  return true;
}
function __navBack() {
  if (__navStack.length <= 1) return;
  __navStack.pop();
  __render();
}
var __routerObj = {
  navigate: function (commands) { return __navigateTo(commands); },
  navigateByUrl: function (url) { return __navigateTo(url); }
};
function __activatedRouteObj(params) {
  var p = params || {};
  return {
    snapshot: { params: p },
    paramMap: {
      subscribe: function (next) {
        if (next) next(p);
        return { unsubscribe: function () {} };
      }
    }
  };
}
function __navTarget(el, scope) {
  for (var i = 0; i < el.propBindings.length; i++) {
    if (el.propBindings[i].name === 'routerLink') {
      try { return __evalSrc(el.propBindings[i].expression, scope); }
      catch (err) { console.warn(err); return undefined; }
    }
  }
  return el.attrs['routerLink'];
}
function __attachNav(dom, el, scope) {
  if (!ROUTES.length || !dom || !dom.addEventListener) return;
  var target = __navTarget(el, scope);
  if (target === undefined) return;
  dom.addEventListener('click', function () { __navigateTo(target); });
}
function __buildOutlet(el, scope, path) {
  var entry = __currentEntry();
  var out = [];
  if (__navStack.length > 1) {
    var bar = document.createElement('div');
    bar.className = 'preview-nav-back';
    var label = document.createElement('span');
    label.textContent = 'Preview navigation: /' + entry.path;
    bar.appendChild(label);
    var back = document.createElement('button');
    back.type = 'button';
    back.textContent = 'Back';
    back.addEventListener('click', function () { __navBack(); });
    bar.appendChild(back);
    out.push(bar);
  }
  var def = null;
  for (var i = 0; i < ROUTES.length; i++) {
    if (ROUTES[i].path === entry.routePath && ROUTES[i].selector) { def = ROUTES[i]; break; }
  }
  if (!def) return out;
  var childEl = {
    type: 'element', tag: def.selector, attrs: {}, booleanAttrs: [],
    propBindings: [], twoWayBindings: [], eventBindings: [], children: [],
    pos: el.pos
  };
  __pendingRouteParams = entry.params;
  var nodes = __buildChild(childEl, scope, path + '/route:' + entry.routePath + ':' + entry.path);
  __pendingRouteParams = null;
  return out.concat(nodes);
}
if (ROUTES.length) {
  __navStack = [__matchRoute('') || { path: '', params: {}, routePath: '' }];
}
function __render() {
  __rendering = true;
  var app = document.getElementById('app');
  app.innerHTML = '';
  var nodes = __buildNodes(TEMPLATE.children, __scope(), 'root');
  var host = null;
  nodes.forEach(function (n) {
    if (!host && n && typeof n.className === 'string' && n.className.split(' ').indexOf('screen') >= 0) host = n;
  });
  nodes.forEach(function (n) { app.appendChild(n); });
  __buildSnackbar(host || app);
  __rendering = false;
  if (__asyncDirty) { __asyncDirty = false; __render(); }
}
__render();
`;
