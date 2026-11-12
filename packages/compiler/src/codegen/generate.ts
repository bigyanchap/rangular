import { ICON_NAMES, ICON_PATHS, ICON_SIZES, DEFAULT_ICON_SIZE } from '../../../ui/src/icons';
import { PICKER_MODES } from '../../../ui/src/datetime';
import { ComponentInfo, DirectiveInfo, PipeInfo, ServiceInfo } from '../class/parseComponent';
import { DirectiveStyleAssign, directiveStyles } from '../class/parseDirective';
import { ResolvedRoute } from '../class/parseRoutes';
import { analyzeFormInitializer, FormFieldInfo, isFormInitializer } from '../class/formInit';
import { Diagnostic, error, warning } from '../diagnostics';
import { nearestOnScale, ParsedCss } from '../style/css';
import { ElementNode, EventBinding, TemplateNode, TemplateRoot } from '../template/ast';
import { Expr, exprAstToCode, exprToCode, parseExpression } from '../template/expr';
import { BUILTIN_PIPES, isBuiltinPipe } from '../template/pipes';
import {
  hasNgModelSurface,
  ngModelBindingOf,
  plainFieldOf,
  ValidatorSpec,
  validatorsOf,
} from '../template/forms';
import { initializerUsesThis, isLiteralSource } from '../template/literal';
import { parseNgFor, parseNgIf } from '../template/structural';
import { analyzeMutatedFields, MethodHost, setterName, translateMethods } from './methods';
import { makeSourceMap, SourceMapV3, SourceSegment } from './sourceMap';

export interface GenerateResult {
  code: string;
  diagnostics: Diagnostic[];
  /** Present only when the caller asked for a source map (Stage 5). */
  sourceMap?: SourceMapV3;
}

/** A child component taking part in this compilation (Stage 3, M5). */
export interface ChildUnitInput {
  info: ComponentInfo;
  ast: TemplateRoot;
  css: ParsedCss;
  /** Source file keys for this child (Stage 5, source maps and diagnostics). */
  fileName?: string;
  templateFile?: string;
}

export interface GenerateContext {
  /** Every other @Component class resolved through imports, keyed by selector in codegen. */
  children?: ChildUnitInput[];
  /** Every @Injectable class resolved through imports (Stage 3, M6). */
  services?: ServiceInfo[];
  /** Every custom @Pipe class resolved through imports (Stage 12). */
  pipes?: PipeInfo[];
  /** Every attribute @Directive class resolved through imports (Stage 12). */
  directives?: DirectiveInfo[];
  /**
   * The resolved route table (Stage 9), present when a routes file was
   * resolved for this compilation. When routing is also USED (an outlet,
   * a routerLink, or a Router/ActivatedRoute injection), codegen emits
   * the module-level navigator and router and wires the outlet.
   */
  routes?: ResolvedRoute[];
  /**
   * Source map request (Stage 5): when present, codegen records block
   * level segments (component function starts and template element
   * starts) and the result carries a source map v3 object.
   */
  sourceMap?: {
    entryTsFile: string;
    entryTemplateFile: string;
    contents: Map<string, string>;
  };
}

export interface TagMapping {
  component: string;
  /** true when the mapping comes from @rangular/ui rather than react-native */
  fromUi: boolean;
  /** Text variant for heading/paragraph mappings */
  variant?: string;
}

/**
 * The tag -> generated-component contract. Single source of truth:
 * codegen renders from this table and the catalog is generated from it.
 */
export const TAG_MAP: Record<string, TagMapping> = {
  div: { component: 'View', fromUi: false },
  section: { component: 'View', fromUi: false },
  header: { component: 'View', fromUi: false },
  span: { component: 'Text', fromUi: false },
  // Text with a meaning compiles to RgText (default polish pass):
  // the primitive applies the token type step (size, line height,
  // weight) and the theme's on-surface colour, so the app renders
  // the same type scale the preview shows. Plain RN Text ignored
  // the variant prop, so headings reached the phone unstyled.
  // <span> stays plain Text: it is the inline element, nested inside
  // a text block and inheriting from it.
  p: { component: 'RgText', fromUi: true, variant: 'bodyLarge' },
  label: { component: 'RgText', fromUi: true, variant: 'label' },
  h1: { component: 'RgText', fromUi: true, variant: 'display' },
  h2: { component: 'RgText', fromUi: true, variant: 'heading' },
  h3: { component: 'RgText', fromUi: true, variant: 'title' },
  button: { component: 'RgButton', fromUi: true },
  screen: { component: 'RgScreen', fromUi: true },
  appbar: { component: 'RgAppbar', fromUi: true },
  card: { component: 'RgCard', fromUi: true },
  list: { component: 'RgList', fromUi: true },
  row: { component: 'RgRow', fromUi: true },
  fab: { component: 'RgFab', fromUi: true },
  icon: { component: 'RgIcon', fromUi: true },
  switch: { component: 'RgSwitch', fromUi: true },
  switcher: { component: 'RgSwitcher', fromUi: true },
  option: { component: 'RgOption', fromUi: true },
  checkbox: { component: 'RgCheckbox', fromUi: true },
  'radio-group': { component: 'RgRadioGroup', fromUi: true },
  radio: { component: 'RgRadio', fromUi: true },
  input: { component: 'RgInput', fromUi: true },
  form: { component: 'View', fromUi: false },
  'router-outlet': { component: 'RgOutlet', fromUi: true },
  sheet: { component: 'RgSheet', fromUi: true },
  dialog: { component: 'RgDialog', fromUi: true },
  actions: { component: 'RgActions', fromUi: true },
  'datetime-picker': { component: 'RgDateTimePicker', fromUi: true },
  tabs: { component: 'RgTabs', fromUi: true },
  tab: { component: 'RgTab', fromUi: true },
  accordion: { component: 'RgAccordion', fromUi: true },
  panel: { component: 'RgPanel', fromUi: true },
  table: { component: 'RgTable', fromUi: true },
  column: { component: 'RgColumn', fromUi: true },
  slider: { component: 'RgSlider', fromUi: true },
  'progress-bar': { component: 'RgProgressBar', fromUi: true },
  spinner: { component: 'RgSpinner', fromUi: true },
  chips: { component: 'RgChips', fromUi: true },
  chip: { component: 'RgChip', fromUi: true },
};

/** True when an initializer source text is a plain literal we may hoist. */
export function isLiteralInitializer(init: string): boolean {
  return isLiteralSource(init);
}

/**
 * Fields the generated component declares by emitting their initializer
 * verbatim as a plain const (proof fix): a field whose initializer is
 * not a literal and not a reactive form instance, which no method
 * assigns (mutation calls included), and whose initializer does not
 * reference `this` (a generated function component has no `this` to
 * resolve). The classic case is `today = new Date()` read by a date
 * pipe: before this fix it warned GEN_FIELD, emitted only a TODO
 * comment, and the generated code referenced a name it never declared.
 * The preview rebuilds exactly these fields from their initializer
 * source, so the two sides cannot drift.
 */
export function verbatimInitFields(
  component: MethodHost,
): { name: string; initializer: string }[] {
  const mutated = analyzeMutatedFields(component);
  const out: { name: string; initializer: string }[] = [];
  for (const field of component.fields) {
    if (field.isInput || field.isOutput) continue;
    if (!field.initializer) continue;
    if (isLiteralInitializer(field.initializer)) continue;
    if (isFormInitializer(field.initializer)) continue;
    if (mutated.has(field.name)) continue;
    if (initializerUsesThis(field.initializer)) continue;
    out.push({ name: field.name, initializer: field.initializer });
  }
  return out;
}

/** StyleSheet keys must be valid JS identifiers: `card-note` -> `cardNote`. */
export function styleKeyName(key: string): string {
  return key.replace(/-([a-zA-Z])/g, (_, c: string) => c.toUpperCase());
}

export function componentFunctionName(className: string): string {
  return className.endsWith('Component') ? className.slice(0, -'Component'.length) : className;
}

/** @Output field name -> generated callback prop name: `saved` -> `onSaved`. */
export function outputPropName(fieldName: string): string {
  return 'on' + fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
}

/**
 * Security (audit, 2026-11-12): plain text and static strings in a
 * template are data, never code. The helpers below keep them inside
 * their literal context in the generated .tsx:
 * - a static text part containing JSX-special characters ({, }, <, >)
 *   is emitted as a {'...'} string expression instead of raw JSX text,
 *   where a { would otherwise open an expression container;
 * - a static attribute value is entity-escaped so a quote inside it
 *   cannot end the JSX attribute string and inject extra props;
 * - author-controlled strings placed inside generated comments are
 *   flattened so a newline cannot end a // comment and a star-slash
 *   cannot end a block comment.
 * Text and values without special characters are emitted exactly as
 * before, so existing examples are unchanged.
 */
function escapeJsxAttrValue(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

const JSX_TEXT_SPECIALS = /[{}<>]/;

function jsxTextPart(value: string): string {
  return JSX_TEXT_SPECIALS.test(value) ? `{${JSON.stringify(value)}}` : value;
}

function forLineComment(s: string): string {
  return s.replace(/[\r\n]+/g, ' ');
}

function forBlockComment(s: string): string {
  return forLineComment(s).replace(/\*\//g, '* /');
}

/** Template (event) name -> React Native prop name, for known events. */
export const EVENT_PROPS: Record<string, string> = {
  click: 'onPress',
  change: 'onChange',
  submit: 'onSubmit',
  blur: 'onBlur',
  close: 'onClose',
  focus: 'onFocus',
  toggle: 'onToggle',
  remove: 'onRemove',
  optionSelected: 'onOptionSelected',
};

/** Map a template (event) to its React Native prop name. */
export function eventPropName(eventName: string, tag: string): { prop: string; known: boolean } {
  if (eventName === 'input') {
    return tag.toLowerCase() === 'input'
      ? { prop: 'onChangeText', known: true }
      : { prop: 'onInput', known: false };
  }
  const known = EVENT_PROPS[eventName];
  if (known) return { prop: known, known: true };
  return { prop: 'on' + eventName.charAt(0).toUpperCase() + eventName.slice(1), known: false };
}

/**
 * True when an event binding's expression is an assignment statement,
 * e.g. `(close)="sheetOpen = false"` or `(click)="count += 1"`
 * (Stage 10). Evidence from the code: the template expression grammar
 * (template/expr.ts) has no assignment operator at all, its tokenizer
 * does not even produce a bare `=` token, so such a binding cannot be
 * translated; before Stage 10 codegen silently fell back to the raw
 * source, emitting `onClose={() => sheetOpen = false}` against a
 * const state binding, which compiles and then throws at runtime.
 * Assignment bindings are therefore detected explicitly and dropped
 * with a GEN_EVENT_ASSIGNMENT warning: authors write a method
 * (`closeSheet() { this.sheetOpen = false; }`) and bind that instead,
 * the pattern the Stage 6 controls already document.
 */
export function isAssignmentExpression(source: string): boolean {
  const src = source.trim();
  try {
    parseExpression(src);
    return false; // it parses as an expression: a call, a bare ref, a comparison
  } catch {
    // Did not parse. An assignment is the common cause; look for a
    // bare `=` (not ==, <=, >=, !=) or a compound assignment operator.
    return /(^|[^=!<>])=(?![=])/.test(src) || /[+\-*/%]+=(?![=])/.test(src);
  }
}

const HTTP_CLIENT = 'HttpClient';

/**
 * Forms analysis for one component (Stage 8). FormInfo is what a <form>
 * offers its subtree: its (submit) handler, its [formGroup] field, and
 * the touched-state keys of the ngModel inputs inside it (a submit
 * attempt marks them all touched). InputInfo is the binding mode of one
 * <input>: plain (value/events only), ngmodel (template-driven, with an
 * optional validation model keyed by `key`), valueOnly (an ngModel whose
 * target is not a plain field: bound one way, GEN_NGMODEL_EXPR), or
 * reactive (formControlName inside a [formGroup] form).
 */
interface FormInfo {
  submit?: EventBinding;
  groupField?: string;
  touchedKeys: string[];
}

interface InputInfo {
  mode: 'plain' | 'ngmodel' | 'valueOnly' | 'reactive';
  field?: string;
  expression?: string;
  twoWay?: boolean;
  validators: ValidatorSpec[];
  refName?: string;
  /** Touched/model key when a validation model is generated for this input. */
  key?: string;
  groupField?: string;
  controlName?: string;
}

interface StyleEntry {
  key: string;
  styleObj: Record<string, unknown>;
}

/**
 * File-level generator (Stage 3). One generated .tsx holds, in order:
 * imports, the @Injectable services as ReactiveService classes, the DI
 * container registrations, the child components as exported functions, and
 * finally the entry component as the default export. Sharing one file is
 * what makes the container a true singleton: every component resolves its
 * dependencies from the same module-level `__container`.
 *
 * With no children and no services the output is exactly the Stage 2 shape.
 */
interface UnitSourceInfo {
  fnName: string;
  exportKw: string;
  tsFile?: string;
  templateFile?: string;
  classLine?: number;
}

class Generator {
  diagnostics: Diagnostic[] = [];
  sourceMapOut?: SourceMapV3;
  private usedRn = new Set<string>();
  private usedUi = new Set<string>();
  private usedRuntime = new Set<string>();
  private reactImports = new Set<string>();
  private childBySelector = new Map<string, ComponentInfo>();
  private childByClassName = new Map<string, ComponentInfo>();
  private rootServices = new Map<string, ServiceInfo>();
  private allServices: ServiceInfo[] = [];
  /** The resolved route table (Stage 9), when a routes file was resolved. */
  private routes?: ResolvedRoute[];
  /**
   * True when a route table exists AND routing is used somewhere in the
   * compilation (Stage 9): only then are the module-level navigator and
   * router emitted and the outlet and links wired to them.
   */
  private routingActive = false;
  /**
   * True when any component in the compilation injects SnackBar
   * (Stage 10): only then is the module-level snackbar service
   * emitted and the entry component given its host state.
   */
  private snackActive = false;
  /** Custom @Pipe classes by pipe name (Stage 12), with their instance vars. */
  private pipesByName = new Map<string, PipeInfo>();
  private pipeInstances = new Map<string, string>();
  /**
   * Attribute directives by attribute name (Stage 12), with their
   * extracted style assignments. A directive whose logic is outside
   * the subset carries `unsupported` and applies no styles; generate()
   * reports it once with DIR_UNSUPPORTED.
   */
  private directivesByAttr = new Map<string, {
    info: DirectiveInfo;
    assignments: DirectiveStyleAssign[];
    unsupported?: string;
  }>();
  private styles: StyleEntry[] = [];
  /** Source map bookkeeping (Stage 5): element records keyed by marker id. */
  private smConfig?: GenerateContext['sourceMap'];
  private smRecords: { templateFile: string; el: ElementNode }[] = [];
  private smUnits: UnitSourceInfo[] = [];

  constructor(context: GenerateContext) {
    this.smConfig = context.sourceMap;
    this.routes = context.routes;
    for (const child of context.children ?? []) {
      if (child.info.selector) this.childBySelector.set(child.info.selector, child.info);
      this.childByClassName.set(child.info.className, child.info);
    }
    this.allServices = context.services ?? [];
    for (const svc of this.allServices) {
      if (svc.providedInRoot) this.rootServices.set(svc.className, svc);
    }
    for (const pipe of context.pipes ?? []) {
      if (this.pipesByName.has(pipe.pipeName)) continue;
      this.pipesByName.set(pipe.pipeName, pipe);
      this.pipeInstances.set(pipe.pipeName, `__pipe${pipe.className}`);
    }
    for (const directive of context.directives ?? []) {
      if (!directive.attrName || this.directivesByAttr.has(directive.attrName)) continue;
      const styles = directiveStyles(directive);
      this.directivesByAttr.set(directive.attrName, {
        info: directive,
        assignments: styles.assignments,
        unsupported: styles.unsupported,
      });
    }
  }

  /** The generated instance variable for a custom pipe class: `__pipe` + class name. */
  private pipeInstanceVar(pipeName: string): string | undefined {
    return this.pipeInstances.get(pipeName);
  }

  generate(entry: ComponentInfo, ast: TemplateRoot, css: ParsedCss, children: ChildUnitInput[]): string {
    const serviceBlocks: string[][] = [];
    for (const svc of this.allServices) {
      if (!svc.providedInRoot) continue;
      serviceBlocks.push(this.generateService(svc));
    }
    // Custom pipes (Stage 12): every resolved @Pipe class is emitted
    // as a plain class plus one shared instance, next to the services.
    // A directive outside the supported subset is reported once here,
    // whether or not any template uses it: the class was resolved, so
    // its author expects it to work.
    const pipeBlocks: string[][] = [];
    for (const pipe of this.pipesByName.values()) {
      pipeBlocks.push(this.generatePipeClass(pipe));
    }
    for (const [attr, entry2] of this.directivesByAttr) {
      if (!entry2.unsupported) continue;
      this.diagnostics.push(warning(
        'DIR_UNSUPPORTED',
        `Directive '${entry2.info.className}' ([${attr}]) is outside the supported subset: ${entry2.unsupported}; it applies no styles`,
        undefined, undefined,
        'Keep the directive to @Input fields, an ElementRef, and ngOnInit or setter bodies made only of this.el.nativeElement.style.<prop> = <expr over inputs and literals> statements',
      ));
    }
    const registrations = this.registrationLines(entry, children);

    // --- Routing activation (Stage 9) --------------------------------------
    // The navigator and router exist in the output only when a route
    // table was resolved AND routing is used: an outlet or routerLink
    // in any template of the compilation, or a Router / ActivatedRoute
    // injection in any unit. The entry template's outlet also gives the
    // entry component its navigation state (see generateUnit).
    const templateUsage = (nodes: TemplateNode[]): { outlet: boolean; used: boolean } => {
      const usage = { outlet: false, used: false };
      const walk = (list: TemplateNode[]): void => {
        for (const n of list) {
          if (n.type !== 'element') continue;
          if (n.tag.toLowerCase() === 'router-outlet') { usage.outlet = true; usage.used = true; }
          if (n.attrs['routerLink'] !== undefined
            || n.propBindings.some((b) => b.name === 'routerLink')) usage.used = true;
          walk(n.children);
        }
      };
      walk(nodes);
      return usage;
    };
    const entryUsage = templateUsage(ast.children);
    const childUsage = children.map((c) => templateUsage(c.ast.children));
    const injectsRouter = [entry, ...children.map((c) => c.info)]
      .some((info) => (info.constructorDeps ?? []).some(
        (d) => d.typeName === 'Router' || d.typeName === 'ActivatedRoute',
      ));
    this.routingActive = this.routes !== undefined
      && (entryUsage.used || childUsage.some((u) => u.used) || injectsRouter);
    const navLines: string[] = [];
    if (this.routingActive) {
      this.usedRuntime.add('RgNavigator');
      this.usedRuntime.add('Router');
      const defs = (this.routes ?? []).map((r) => (r.redirectTo !== undefined
        ? { path: r.path, redirectTo: r.redirectTo }
        : { path: r.path }));
      navLines.push(`const __navigator = new RgNavigator(${JSON.stringify(defs)});`);
      navLines.push('const __router = new Router(__navigator);');
    }

    // --- Snackbar activation (Stage 10) ------------------------------------
    // One module-level SnackBar instance serves the whole app, like
    // the navigator: components inject it and call open(); the entry
    // component mirrors its state and renders the host pill. It is
    // emitted only when some component actually injects the token.
    this.snackActive = [entry, ...children.map((c) => c.info)]
      .some((info) => (info.constructorDeps ?? []).some((d) => d.typeName === 'SnackBar'));
    const snackModuleLines: string[] = [];
    if (this.snackActive) {
      this.usedRuntime.add('SnackBar');
      snackModuleLines.push('const __snackBar = new SnackBar();');
    }

    const childBlocks: string[][] = [];
    children.forEach((child, i) => {
      this.smUnits.push({
        fnName: componentFunctionName(child.info.className),
        exportKw: 'export function',
        tsFile: child.fileName,
        templateFile: child.templateFile,
        classLine: child.info.sourceLine,
      });
      childBlocks.push(this.generateUnit(child.info, child.ast, child.css, {
        entry: false,
        stylePrefix: stylePrefixOf(child.info),
        order: i,
        tsFile: child.fileName,
        templateFile: child.templateFile,
      }));
    });
    this.smUnits.push({
      fnName: componentFunctionName(entry.className),
      exportKw: 'export default function',
      tsFile: this.smConfig?.entryTsFile,
      templateFile: this.smConfig?.entryTemplateFile,
      classLine: entry.sourceLine,
    });
    const entryBlock = this.generateUnit(entry, ast, css, {
      entry: true,
      stylePrefix: '',
      order: -1,
      hasOutlet: entryUsage.outlet,
      tsFile: this.smConfig?.entryTsFile,
      templateFile: this.smConfig?.entryTemplateFile,
    });

    const importLines: string[] = [];
    if (this.reactImports.size) {
      importLines.push(`import { ${[...this.reactImports].sort().join(', ')} } from 'react';`);
    }
    if (this.usedRn.size) {
      const rn = [...this.usedRn].filter((n) => n !== 'StyleSheet').sort();
      const all = this.usedRn.has('StyleSheet') ? [...rn, 'StyleSheet'] : rn;
      if (all.length) importLines.push(`import { ${all.join(', ')} } from 'react-native';`);
    }
    if (this.usedUi.size) importLines.push(`import { ${[...this.usedUi].sort().join(', ')} } from '@rangular/ui';`);
    if (this.usedRuntime.size) {
      importLines.push(`import { ${[...this.usedRuntime].sort().join(', ')} } from '@rangular/runtime';`);
    }

    const styleBlock: string[] = [];
    if (this.styles.length) {
      styleBlock.push('', 'const styles = StyleSheet.create({');
      for (const entry2 of this.styles) {
        styleBlock.push(`  ${entry2.key}: ${JSON.stringify(entry2.styleObj)},`);
      }
      styleBlock.push('});');
    }

    const lines: string[] = [
      `// Generated by Rangular from ${entry.className} (${forLineComment(entry.selector ?? 'no selector')}). Do not edit by hand.`,
      ...importLines,
      '',
    ];
    for (const block of serviceBlocks) lines.push(...block, '');
    for (const block of pipeBlocks) lines.push(...block, '');
    if (registrations.length) lines.push(...registrations, '');
    if (navLines.length) lines.push(...navLines, '');
    if (snackModuleLines.length) lines.push(...snackModuleLines, '');
    for (const block of childBlocks) lines.push(...block, '');
    lines.push(...entryBlock, ...styleBlock, '');
    if (this.smConfig) this.finishSourceMap(lines);
    return lines.join('\n');
  }

  /**
   * Source map finalisation (Stage 5): the renderers left marker comment
   * lines (a JSX comment holding "@sm:N") in front of every element's
   * generated lines.
   * Each marker maps the NEXT kept line (the element's JSX start, or its
   * *ngIf wrapper line) back to the element's template position. Marker
   * lines are removed, so the emitted code is unchanged apart from the
   * map itself. Component function starts are found by their signature
   * lines and mapped to the class declarations.
   */
  private finishSourceMap(lines: string[]): void {
    const segments: SourceSegment[] = [];
    const sources: string[] = [];
    const indexOf = new Map<string, number>();
    const idxFor = (file: string): number => {
      let i = indexOf.get(file);
      if (i === undefined) {
        i = sources.length;
        sources.push(file);
        indexOf.set(file, i);
      }
      return i;
    };
    const cleaned: string[] = [];
    let pending: { templateFile: string; el: ElementNode }[] = [];
    for (const line of lines) {
      const marker = line.match(/@sm:(\d+)@/);
      if (marker) {
        const rec = this.smRecords[Number(marker[1])];
        if (rec) pending.push(rec);
        continue;
      }
      const genLine = cleaned.length;
      for (const rec of pending) {
        const lt = line.indexOf('<');
        segments.push({
          generatedLine: genLine,
          generatedColumn: lt >= 0 ? lt : line.length - line.trimStart().length,
          sourceIndex: idxFor(rec.templateFile),
          sourceLine: rec.el.pos.line - 1,
          sourceColumn: rec.el.pos.column - 1,
        });
      }
      pending = [];
      cleaned.push(line);
    }
    let searchFrom = 0;
    for (const unit of this.smUnits) {
      if (!unit.tsFile) continue;
      const sig = `${unit.exportKw} ${unit.fnName}(`;
      let found = -1;
      for (let i = searchFrom; i < cleaned.length; i++) {
        if (cleaned[i].startsWith(sig)) { found = i; break; }
      }
      if (found >= 0) {
        segments.push({
          generatedLine: found,
          generatedColumn: 0,
          sourceIndex: idxFor(unit.tsFile),
          sourceLine: (unit.classLine ?? 1) - 1,
          sourceColumn: 0,
        });
        searchFrom = found + 1;
      }
    }
    lines.length = 0;
    lines.push(...cleaned);
    this.sourceMapOut = makeSourceMap(sources, segments, {
      sourcesContent: sources.map((s) => this.smConfig!.contents.get(s) ?? null),
    });
  }

  // --- Services (M6) --------------------------------------------------------

  private validateDeps(
    owner: string,
    deps: { propertyName: string; typeName: string }[],
    allowSnackBar = false,
  ): void {
    for (const dep of deps) {
      if (dep.typeName === HTTP_CLIENT || this.rootServices.has(dep.typeName)) continue;
      if (this.routingActive && (dep.typeName === 'Router' || dep.typeName === 'ActivatedRoute')) continue;
      // SnackBar is a component-level built-in (Stage 10): components
      // receive the module-level instance; a service injecting it has
      // no host to render through, so it stays an unknown token there.
      if (allowSnackBar && dep.typeName === 'SnackBar') continue;
      this.diagnostics.push(error(
        'DI_UNKNOWN_TOKEN',
        `${owner}: no provider for '${dep.typeName}' (injected as '${dep.propertyName}'), it is not an @Injectable({ providedIn: 'root' }) service in this compilation and not a built-in token`,
        undefined, undefined,
        `Make '${dep.typeName}' an @Injectable({ providedIn: 'root' }) class and import it from the component file (imports are followed transitively), or inject a built-in: HttpClient, Router / ActivatedRoute in a routed app, or SnackBar in a component`,
      ));
    }
  }

  private generateService(svc: ServiceInfo): string[] {
    this.usedRuntime.add('ReactiveService');
    this.validateDeps(`Service ${svc.className}`, svc.constructorDeps);
    const lines: string[] = [`export class ${svc.className} extends ReactiveService {`];
    for (const field of svc.fields) {
      if (field.initializer && isLiteralInitializer(field.initializer)) {
        lines.push(`  ${field.name}${field.type ? `: ${field.type}` : ''} = ${field.initializer};`);
      } else if (field.initializer) {
        this.diagnostics.push(warning('GEN_FIELD', `Service '${svc.className}': field '${field.name}' has a non-literal initializer; not hoisted`, undefined, undefined, `Initialise '${field.name}' with a literal (including arrays/objects of literals) or assign it in the constructor`));
        lines.push(`  // TODO: field '${forLineComment(field.name)}' has a non-literal initializer (${forLineComment(field.initializer)}), not hoisted; wire it up manually for now.`);
      } else if (field.type) {
        lines.push(`  ${field.name}: ${field.type};`);
      }
    }
    if (svc.constructorDeps.length || svc.constructorBody) {
      const params = svc.constructorDeps.map((d) => `private ${d.propertyName}: ${d.typeName}`).join(', ');
      lines.push(`  constructor(${params}) {`);
      lines.push('    super();');
      if (svc.constructorBody) {
        const host = {
          fields: svc.fields,
          methods: svc.methods,
          methodDetails: [{
            name: 'constructor',
            params: svc.constructorDeps.map((d) => ({
              name: d.propertyName,
              text: `private ${d.propertyName}: ${d.typeName}`,
            })),
            body: svc.constructorBody,
          }],
        };
        const { methods, diagnostics } = translateMethods(host, 'service', new Set(svc.fields.map((f) => f.name)));
        this.diagnostics.push(...diagnostics);
        for (const line of methods[0]?.lines ?? []) lines.push(line ? `    ${line}` : line);
      }
      lines.push('  }');
    }
    const { methods, diagnostics } = translateMethods(svc, 'service', new Set(svc.fields.map((f) => f.name)));
    this.diagnostics.push(...diagnostics);
    for (const m of methods) {
      lines.push(`  ${m.name}(${m.paramTexts.join(', ')}) {`);
      for (const line of m.lines) lines.push(line ? `    ${line}` : line);
      lines.push('  }');
    }
    lines.push('}');
    return lines;
  }

  /**
   * Emit one custom @Pipe class (Stage 12): a plain class (no
   * ReactiveService base, no container), its literal fields, its
   * constructor when it has one, and its methods translated in 'pipe'
   * mode (this. survives, no notify). One shared instance follows:
   * pipes are pure by convention, exactly Angular's assumption.
   */
  private generatePipeClass(pipe: PipeInfo): string[] {
    const lines: string[] = [`export class ${pipe.className} {`];
    for (const field of pipe.fields) {
      if (field.initializer && isLiteralInitializer(field.initializer)) {
        lines.push(`  ${field.name}${field.type ? `: ${field.type}` : ''} = ${field.initializer};`);
      } else if (field.initializer) {
        this.diagnostics.push(warning('GEN_FIELD', `Pipe '${pipe.className}': field '${field.name}' has a non-literal initializer; not hoisted`, undefined, undefined, `Initialise '${field.name}' with a literal (including arrays/objects of literals) or assign it in the constructor`));
        lines.push(`  // TODO: field '${forLineComment(field.name)}' has a non-literal initializer (${forLineComment(field.initializer)}), not hoisted; wire it up manually for now.`);
      } else if (field.type) {
        lines.push(`  ${field.name}: ${field.type};`);
      }
    }
    if (pipe.constructorDeps.length || pipe.constructorBody) {
      const params = pipe.constructorDeps.map((d) => `private ${d.propertyName}: ${d.typeName}`).join(', ');
      lines.push(`  constructor(${params}) {`);
      if (pipe.constructorBody) {
        const host = {
          fields: pipe.fields,
          methods: pipe.methods,
          methodDetails: [{
            name: 'constructor',
            params: pipe.constructorDeps.map((d) => ({
              name: d.propertyName,
              text: `private ${d.propertyName}: ${d.typeName}`,
            })),
            body: pipe.constructorBody,
          }],
        };
        const { methods, diagnostics } = translateMethods(host, 'pipe', new Set(pipe.fields.map((f) => f.name)));
        this.diagnostics.push(...diagnostics);
        for (const line of methods[0]?.lines ?? []) lines.push(line ? `    ${line}` : line);
      }
      lines.push('  }');
    }
    const { methods, diagnostics } = translateMethods(pipe, 'pipe', new Set(pipe.fields.map((f) => f.name)));
    this.diagnostics.push(...diagnostics);
    for (const m of methods) {
      lines.push(`  ${m.name}(${m.paramTexts.join(', ')}) {`);
      for (const line of m.lines) lines.push(line ? `    ${line}` : line);
      lines.push('  }');
    }
    lines.push('}');
    const instance = this.pipeInstanceVar(pipe.pipeName);
    if (instance) {
      if (pipe.constructorDeps.length) {
        // A pipe with constructor dependencies cannot be instantiated
        // honestly in this version (Angular would inject services);
        // the error names it instead of emitting a silent wrong call.
        this.diagnostics.push(error(
          'DI_UNKNOWN_TOKEN',
          `Pipe '${pipe.className}': constructor dependencies (${pipe.constructorDeps.map((d) => d.typeName).join(', ')}) are not wired for @Pipe classes in this version; the shared instance is created with no arguments`,
          undefined, undefined,
          'Keep @Pipe classes dependency-free (pure transforms of their arguments), or move the shared logic into an @Injectable service the component injects',
        ));
        lines.push(`const ${instance} = new ${pipe.className}(); // TODO(Rangular): pipe constructor dependencies are not wired, see DI_UNKNOWN_TOKEN`);
      } else {
        lines.push(`const ${instance} = new ${pipe.className}();`);
      }
    }
    return lines;
  }

  /** Container registrations, dependency-ordered (a service's deps register first). */
  private registrationLines(entry: ComponentInfo, children: ChildUnitInput[]): string[] {
    const needsHttp = [entry, ...children.map((c) => c.info), ...this.allServices]
      .some((host) => (host.constructorDeps ?? []).some((d) => d.typeName === HTTP_CLIENT));
    if (!this.rootServices.size && !needsHttp) return [];
    this.usedRuntime.add('Container');
    if (needsHttp) this.usedRuntime.add(HTTP_CLIENT);

    const order: string[] = [];
    const done = new Set<string>();
    const visiting = new Set<string>();
    let cycleReported = false;
    const visit = (name: string): void => {
      if (done.has(name)) return;
      if (visiting.has(name)) {
        if (!cycleReported) {
          cycleReported = true;
          this.diagnostics.push(error(
            'DI_CYCLE',
            `Service dependency cycle detected at '${name}', registrations cannot be ordered`,
            undefined, undefined,
            'Break the cycle: have one service stop injecting the other (pass the value through a method call instead)',
          ));
        }
        return;
      }
      visiting.add(name);
      const svc = this.rootServices.get(name);
      if (svc) {
        for (const dep of svc.constructorDeps) {
          if (this.rootServices.has(dep.typeName)) visit(dep.typeName);
        }
      }
      visiting.delete(name);
      done.add(name);
      order.push(name);
    };
    for (const name of this.rootServices.keys()) visit(name);

    const lines: string[] = ['const __container = new Container();'];
    for (const name of order) {
      const svc = this.rootServices.get(name)!;
      const args = svc.constructorDeps.map((d) => {
        if (d.typeName === HTTP_CLIENT) return `__container.get<HttpClient>(HttpClient)`;
        if (this.rootServices.has(d.typeName)) return `__container.get<${d.typeName}>(${d.typeName})`;
        return 'undefined';
      });
      lines.push(`__container.register(${name}, new ${name}(${args.join(', ')}));`);
    }
    if (needsHttp) lines.push(`__container.register(HttpClient, new HttpClient());`);
    return lines;
  }

  // --- Components (M3/M4 + M5/M6) --------------------------------------------

  private generateUnit(
    component: ComponentInfo,
    ast: TemplateRoot,
    css: ParsedCss,
    opts: { entry: boolean; stylePrefix: string; order: number; hasOutlet?: boolean; tsFile?: string; templateFile?: string },
  ): string[] {
    const diagnostics = this.diagnostics;
    diagnostics.push(...css.diagnostics);

    // Controls have declaration children (Stage 6): option only belongs
    // in switcher, radio only belongs in radio-group, and each group
    // accepts only its own declaration element.
    const validateControlNesting = (nodes: TemplateNode[], parentTag?: string): void => {
      for (const node of nodes) {
        if (node.type !== 'element') continue;
        const tag = node.tag.toLowerCase();
        if (tag === 'option' && parentTag !== 'switcher' && parentTag !== 'radio-group') {
          diagnostics.push(warning(
            'GEN_CONTROL_NESTING',
            '<option> is outside <switcher>; it declares one segment and has no meaning on its own',
            node.pos.line, node.pos.column,
            'Move the option inside a switcher: <switcher [value]="view" (change)="onView($event)"><option value="list">List</option></switcher>',
          ));
        }
        if (tag === 'radio' && parentTag !== 'radio-group' && parentTag !== 'switcher') {
          diagnostics.push(warning(
            'GEN_CONTROL_NESTING',
            '<radio> is outside <radio-group>; it declares one choice and has no meaning on its own',
            node.pos.line, node.pos.column,
            'Move the radio inside a radio group: <radio-group [value]="size" (change)="onSize($event)"><radio value="m">Medium</radio></radio-group>',
          ));
        }
        if (parentTag === 'switcher' && tag !== 'option') {
          diagnostics.push(warning(
            'GEN_CONTROL_NESTING',
            `<${node.tag}> is inside <switcher>; only <option> declarations belong there`,
            node.pos.line, node.pos.column,
            'Replace it with <option value="...">Label</option>, or move the element outside the switcher',
          ));
        }
        if (parentTag === 'radio-group' && tag !== 'radio') {
          diagnostics.push(warning(
            'GEN_CONTROL_NESTING',
            `<${node.tag}> is inside <radio-group>; only <radio> declarations belong there`,
            node.pos.line, node.pos.column,
            'Replace it with <radio value="...">Label</radio>, or move the element outside the radio group',
          ));
        }
        // Data display declarations (Stage 11): tab belongs in tabs,
        // column belongs in table, and tabs, table and accordion each
        // accept only their own declaration element. A panel outside
        // an accordion is fine (panels work standalone); a tab or a
        // column outside its group declares nothing and renders
        // nothing, so the author hears about it.
        if (tag === 'tab' && parentTag !== 'tabs') {
          diagnostics.push(warning(
            'GEN_CONTROL_NESTING',
            '<tab> is outside <tabs>; it declares one tab page and has no meaning on its own',
            node.pos.line, node.pos.column,
            'Move the tab inside tabs: <tabs [index]="tabIndex" (change)="onTab($event)"><tab label="Overview">...</tab></tabs>',
          ));
        }
        if (tag === 'column' && parentTag !== 'table') {
          diagnostics.push(warning(
            'GEN_CONTROL_NESTING',
            '<column> is outside <table>; it declares one table column and has no meaning on its own',
            node.pos.line, node.pos.column,
            'Move the column inside a table: <table [data]="rows"><column name="sender" header="From"></column></table>',
          ));
        }
        if (parentTag === 'tabs' && tag !== 'tab') {
          diagnostics.push(warning(
            'GEN_CONTROL_NESTING',
            `<${node.tag}> is inside <tabs>; only <tab> declarations belong there`,
            node.pos.line, node.pos.column,
            'Replace it with <tab label="...">...</tab>, or move the element outside the tabs',
          ));
        }
        if (parentTag === 'table' && tag !== 'column') {
          diagnostics.push(warning(
            'GEN_CONTROL_NESTING',
            `<${node.tag}> is inside <table>; only <column> declarations belong there`,
            node.pos.line, node.pos.column,
            'Replace it with <column name="..." header="..."></column>, or move the element outside the table',
          ));
        }
        if (parentTag === 'accordion' && tag !== 'panel') {
          diagnostics.push(warning(
            'GEN_CONTROL_NESTING',
            `<${node.tag}> is inside <accordion>; only <panel> declarations belong there`,
            node.pos.line, node.pos.column,
            'Replace it with <panel title="...">...</panel>, or move the element outside the accordion',
          ));
        }
        validateControlNesting(node.children, tag);
      }
    };
    validateControlNesting(ast.children);

    // Overlays (Stage 10): a <sheet> or <dialog> is driven by its
    // [open] binding; without one it can only ever render statically
    // open (the primitives treat a missing open as shown), so the
    // author hears about it instead of wondering why it never closes.
    const validateOverlays = (nodes: TemplateNode[]): void => {
      for (const node of nodes) {
        if (node.type !== 'element') continue;
        const tag = node.tag.toLowerCase();
        if ((tag === 'sheet' || tag === 'dialog')
          && node.attrs['open'] === undefined
          && !node.booleanAttrs.includes('open')
          && !node.propBindings.some((b) => b.name === 'open')) {
          diagnostics.push(warning(
            'GEN_OVERLAY_OPEN',
            `<${tag}> has no [open] binding; it renders statically open and cannot be opened or closed from the component`,
            node.pos.line, node.pos.column,
            `Bind it to a boolean field and flip the field in methods: <${tag} [open]="confirmOpen" (close)="closeConfirm()"> with closeConfirm() { this.confirmOpen = false; }`,
          ));
        }
        validateOverlays(node.children);
      }
    };
    validateOverlays(ast.children);

    // Chips (Stage 11): a chip's leading icon names the Stage 7 icon
    // set, so a static icon attribute is validated exactly like an
    // <icon> name (GEN_ICON_UNKNOWN, the JSON form carries the valid
    // list). A [icon] binding passes through unchecked, its value is
    // only known at runtime.
    const validateChipIcons = (nodes: TemplateNode[]): void => {
      for (const node of nodes) {
        if (node.type !== 'element') continue;
        if (node.tag.toLowerCase() === 'chip' && node.attrs['icon'] !== undefined
          && !(node.attrs['icon'] in ICON_PATHS)) {
          diagnostics.push({
            severity: 'error',
            code: 'GEN_ICON_UNKNOWN',
            message: `Unknown icon name '${node.attrs['icon']}' in a <chip> icon attribute: it is not in the Rangular icon set`,
            line: node.pos.line,
            column: node.pos.column,
            fix: 'Use one of the names listed under Icons in catalog.md, e.g. <chip icon="star">Starred</chip>',
            validIcons: ICON_NAMES,
          });
        }
        validateChipIcons(node.children);
      }
    };
    validateChipIcons(ast.children);

    // --- Forms analysis (Stage 8) --------------------------------------------
    // Reactive form fields: initialised with new FormGroup(...) or
    // new FormControl(...); they are stable instances, never state.
    const formFields = new Map<string, FormFieldInfo>();
    for (const field of component.fields) {
      if (field.isInput || field.isOutput) continue;
      if (isFormInitializer(field.initializer)) {
        formFields.set(field.name, analyzeFormInitializer(field.initializer!));
      }
    }

    // ngModel belongs on <input> only in this version, and a two-way
    // ngModel field becomes state by definition (Angular semantics: the
    // binding itself writes the field).
    const ngModelStateFields = new Set<string>();
    const walkNgModel = (nodes: TemplateNode[]): void => {
      for (const node of nodes) {
        if (node.type !== 'element') continue;
        if (node.tag.toLowerCase() === 'input') {
          const tw = node.twoWayBindings.find((b) => b.name === 'ngModel');
          const field = tw ? plainFieldOf(tw.expression) : undefined;
          if (field) ngModelStateFields.add(field);
        } else if (hasNgModelSurface(node)) {
          diagnostics.push(error(
            'GEN_NGMODEL_TARGET',
            `ngModel is used on <${node.tag}>; in this version ngModel binds <input> only (selection controls already have their [checked]/[value] plus (change) contract)`,
            node.pos.line, node.pos.column,
            'Move [(ngModel)] to an <input>, or bind the control explicitly: <switch [checked]="wifiOn" (change)="onWifi($event)"></switch>',
          ));
        }
        walkNgModel(node.children);
      }
    };
    walkNgModel(ast.children);

    // --- State analysis (M3) -------------------------------------------------
    const mutated = analyzeMutatedFields(component);
    const stateFields = new Set<string>();
    for (const field of component.fields) {
      if (field.isInput || field.isOutput) continue;
      if (formFields.has(field.name)) continue;
      if (field.initializer && isLiteralInitializer(field.initializer)
        && (mutated.has(field.name) || ngModelStateFields.has(field.name))) {
        stateFields.add(field.name);
      } else if (mutated.has(field.name) && field.initializer && !isLiteralInitializer(field.initializer)) {
        diagnostics.push(warning(
          'GEN_FIELD_STATE',
          `Field '${field.name}' is assigned in a method but has a non-literal initializer; it cannot be hoisted to useState yet`,
          undefined, undefined,
          `Initialise '${field.name}' with a literal (0, 'text', true, [ ... ], { ... }) so it can become state, e.g. ${field.name} = 0;`,
        ));
      }
    }
    if (stateFields.size) this.reactImports.add('useState');

    // Per-form and per-input binding modes, walked with the form stack
    // so formControlName finds its [formGroup] and submit buttons find
    // the touched keys they must set.
    const fieldByName = new Map(component.fields.map((f) => [f.name, f]));
    const formInfos = new Map<ElementNode, FormInfo>();
    const inputInfos = new Map<ElementNode, InputInfo>();
    const modelInfos: InputInfo[] = [];
    const modelKeys = new Set<string>();

    const inputInfoOf = (el: ElementNode, form: FormInfo | undefined): InputInfo => {
      const validators = validatorsOf(el);
      const refName = el.ref && el.refExport === 'ngModel' ? el.ref : undefined;
      const info: InputInfo = { mode: 'plain', validators, refName };
      if (el.propBindings.some((b) => b.name === 'formControlName')) {
        diagnostics.push(warning(
          'GEN_FORM_CONTROL',
          'formControlName is written as a [formControlName] binding; it must be a static attribute naming a control of the enclosing [formGroup]',
          el.pos.line, el.pos.column,
          'Write formControlName="email" (no brackets) on the input',
        ));
      }
      const fcn = el.attrs['formControlName'];
      if (fcn !== undefined) {
        if (!form?.groupField) {
          diagnostics.push(error(
            'GEN_FORM_CONTROL',
            `formControlName="${fcn}" is not inside a <form> with a [formGroup] binding, so there is no control to bind`,
            el.pos.line, el.pos.column,
            `Wrap the input in <form [formGroup]="profileForm"> ... </form> and give the group a control named '${fcn}'`,
          ));
          return info;
        }
        info.mode = 'reactive';
        info.groupField = form.groupField;
        info.controlName = fcn;
        const names = formFields.get(form.groupField)?.controlNames ?? [];
        if (names.length && !names.includes(fcn)) {
          diagnostics.push(error(
            'GEN_FORM_CONTROL',
            `formControlName="${fcn}" does not match any control of the form group '${form.groupField}' (controls: ${names.join(', ')})`,
            el.pos.line, el.pos.column,
            `Use one of the group's controls (${names.join(', ')}), or add a '${fcn}' FormControl to the group`,
          ));
        }
        return info;
      }
      const ng = ngModelBindingOf(el);
      if (ng) {
        info.expression = ng.expression;
        info.twoWay = ng.mode === 'twoWay';
        const field = plainFieldOf(ng.expression);
        const fieldInfo = field ? fieldByName.get(field) : undefined;
        if (field && fieldInfo && !fieldInfo.isInput && !fieldInfo.isOutput
          && fieldInfo.initializer && isLiteralInitializer(fieldInfo.initializer)) {
          info.mode = 'ngmodel';
          info.field = field;
          if (validators.length || refName) info.key = refName ?? field;
        } else {
          info.mode = 'valueOnly';
          diagnostics.push(warning(
            'GEN_NGMODEL_EXPR',
            `ngModel is bound to '${ng.expression}', which is not a plain component field with a literal initial value; the value is bound one way, with no write-back and no validation state`,
            el.pos.line, el.pos.column,
            `Bind ngModel to a plain field with a literal initial value, e.g. email = ''; in the component class`,
          ));
        }
      }
      return info;
    };

    const walkForms = (nodes: TemplateNode[], formStack: FormInfo[]): void => {
      for (const node of nodes) {
        if (node.type !== 'element') continue;
        const tag = node.tag.toLowerCase();
        let stack = formStack;
        if (tag === 'form') {
          const info: FormInfo = { touchedKeys: [] };
          info.submit = node.eventBindings.find(
            (b) => b.name === 'submit' || b.name === 'ngSubmit',
          );
          const fg = node.propBindings.find((b) => b.name === 'formGroup');
          if (fg) {
            const name = plainFieldOf(fg.expression);
            const target = name ? formFields.get(name) : undefined;
            const named = name ? fieldByName.get(name) : undefined;
            if (name && target?.kind === 'group') {
              info.groupField = name;
            } else if (name && named && !named.isInput && !named.isOutput) {
              diagnostics.push(error(
                'GEN_FORMGROUP_TYPE',
                `[formGroup] is bound to '${name}', which is not a field initialised with new FormGroup(...)`,
                node.pos.line, node.pos.column,
                `Initialise the field as a form group: ${name} = new FormGroup({ email: new FormControl('') });`,
              ));
            } else {
              diagnostics.push(warning(
                'GEN_FORMGROUP_TYPE',
                `[formGroup] expression '${fg.expression}' cannot be verified as a field initialised with new FormGroup(...); its formControlName inputs cannot be wired`,
                node.pos.line, node.pos.column,
                'Bind [formGroup] to a plain field initialised with new FormGroup({ ... })',
              ));
              // groupField stays unset: wiring inputs to a ref that is
              // never generated would be broken code, so the inputs
              // report GEN_FORM_CONTROL instead.
            }
          }
          formInfos.set(node, info);
          stack = [...formStack, info];
        }
        if (tag === 'input') {
          const info = inputInfoOf(node, stack[stack.length - 1]);
          inputInfos.set(node, info);
          if (info.key) {
            if (!modelKeys.has(info.key)) {
              modelKeys.add(info.key);
              modelInfos.push(info);
            }
            const form = stack[stack.length - 1];
            if (form && !form.touchedKeys.includes(info.key)) form.touchedKeys.push(info.key);
          }
        }
        walkForms(node.children, stack);
      }
    };
    walkForms(ast.children, []);

    const styleKeys = new Set(Object.keys(css.styles));
    for (const [key, styleObj] of Object.entries(css.styles)) {
      this.styles.push({ key: styleKeyFor(opts.stylePrefix, key), styleObj: styleObj as Record<string, unknown> });
    }

    const styleFor = (el: ElementNode): string | undefined => {
      const refs: string[] = [];
      if (styleKeys.has(el.tag)) refs.push(`styles.${styleKeyFor(opts.stylePrefix, el.tag)}`);
      const classes = (el.attrs['class'] ?? '').split(/\s+/).filter(Boolean);
      for (const cls of classes) if (styleKeys.has(cls)) refs.push(`styles.${styleKeyFor(opts.stylePrefix, cls)}`);
      if (!refs.length) return undefined;
      this.usedRn.add('StyleSheet');
      return refs.length === 1 ? refs[0] : `[${refs.join(', ')}]`;
    };

    // Template expressions (Stage 8): reactive form fields read through
    // their ref (profileForm -> profileFormRef.current), and member
    // chains rooted at an ngModel template reference read from the
    // generated model object (email.invalid -> emailModel.invalid).
    const identRenames = new Map<string, string>();
    for (const name of formFields.keys()) identRenames.set(name, `${name}Ref.current`);
    const refBases = new Map<string, string>();
    for (const info of modelInfos) {
      if (info.refName) refBases.set(info.refName, `${info.key}Model`);
    }
    // Pipes (Stage 12): one expression-options object per unit, shared
    // by every codeExpr call below. customPipes rewrites a pipe use to
    // the generated instance's transform; asyncVars rewrites a hoisted
    // `expr | async` to its subscription hook variable. The scan that
    // fills both runs before any rendering, so codegen sees the final
    // maps everywhere.
    const customPipes = new Map<string, string>();
    for (const [name] of this.pipesByName) {
      const instance = this.pipeInstanceVar(name);
      if (instance) customPipes.set(name, instance);
    }
    const exprOptions: import('../template/expr').ExprToCodeOptions = {
      renames: identRenames,
      refBases,
      customPipes,
      asyncVars: new Map<string, string>(),
    };
    const codeExpr = (source: string): string => {
      const code = exprToCode(source, exprOptions);
      if (code.includes("pipe('")) this.usedRuntime.add('pipe');
      return code;
    };

    // --- Pipe scan (Stage 12) ---------------------------------------------
    // Walk every expression this unit will compile (interpolations,
    // bindings, event handlers, structural conditions and sources) and
    // collect its pipe uses: an unknown name is a PIPE_UNKNOWN error
    // naming the element, and every distinct async input earns a
    // subscription hook (asyncLines, assembled with the unit's lines).
    const asyncInputs: { code: string; varName: string }[] = [];
    {
      const reportedUnknown = new Set<string>();
      const knownList = [...BUILTIN_PIPES, ...this.pipesByName.keys()].join(', ');
      const scanExpr = (source: string, el: ElementNode): void => {
        let parsed: Expr;
        try {
          parsed = parseExpression(source);
        } catch {
          return; // a broken expression is reported by its own path
        }
        const walkExpr = (e: Expr): void => {
          if (e.type === 'pipe') {
            if (!isBuiltinPipe(e.name) && !this.pipesByName.has(e.name)) {
              const key = `${e.name}@${el.pos.line}:${el.pos.column}`;
              if (!reportedUnknown.has(key)) {
                reportedUnknown.add(key);
                diagnostics.push(error(
                  'PIPE_UNKNOWN',
                  `Unknown pipe '${e.name}' on <${el.tag}>; known pipes: ${knownList}`,
                  el.pos.line, el.pos.column,
                  `Use a built-in pipe (${BUILTIN_PIPES.join(', ')}), or define a @Pipe class with name '${e.name}' and import it from the component file`,
                ));
              }
            }
            if (e.name === 'async') {
              const inputCode = exprAstToCode(e.input, exprOptions);
              if (!exprOptions.asyncVars!.has(inputCode)) {
                const varName = `__async${asyncInputs.length}`;
                exprOptions.asyncVars!.set(inputCode, varName);
                asyncInputs.push({ code: inputCode, varName });
              }
            }
          }
          switch (e.type) {
            case 'member': walkExpr(e.object); break;
            case 'index': walkExpr(e.object); walkExpr(e.index); break;
            case 'call': walkExpr(e.callee); e.args.forEach(walkExpr); break;
            case 'unary': walkExpr(e.argument); break;
            case 'binary': walkExpr(e.left); walkExpr(e.right); break;
            case 'conditional': walkExpr(e.test); walkExpr(e.consequent); walkExpr(e.alternate); break;
            case 'array': e.elements.forEach(walkExpr); break;
            case 'pipe': walkExpr(e.input); e.args.forEach(walkExpr); break;
            default: break;
          }
        };
        walkExpr(parsed);
      };
      const scanNodes = (nodes: TemplateNode[]): void => {
        for (const node of nodes) {
          if (node.type === 'text') {
            for (const part of node.parts) {
              if (part.type === 'expr') {
                // A text node has no element position of its own here;
                // attribute it to the enclosing scan through a dummy
                // element anchored at the text position.
                scanExpr(part.expression, {
                  type: 'element', tag: '#text', attrs: {}, booleanAttrs: [],
                  propBindings: [], twoWayBindings: [], eventBindings: [],
                  children: [], pos: node.pos,
                });
              }
            }
            continue;
          }
          for (const b of node.propBindings) scanExpr(b.expression, node);
          for (const b of node.twoWayBindings) scanExpr(b.expression, node);
          for (const ev of node.eventBindings) scanExpr(ev.expression, node);
          if (node.structural?.name === 'ngIf') {
            scanExpr(parseNgIf(node.structural.expression).condition, node);
          } else if (node.structural?.name === 'ngFor') {
            const { parts } = parseNgFor(node.structural.expression);
            if (parts) scanExpr(parts.source, node);
          }
          scanNodes(node.children);
        }
      };
      scanNodes(ast.children);
    }
    const asyncLines: string[] = [];
    if (asyncInputs.length) {
      this.reactImports.add('useState');
      this.reactImports.add('useEffect');
      for (const input of asyncInputs) {
        asyncLines.push(`  const [${input.varName}, ${setterName(input.varName)}] = useState<any>(null);`);
        asyncLines.push('  useEffect(() => {');
        asyncLines.push(`    const __obs = (${input.code}) as any;`);
        asyncLines.push("    if (!__obs || typeof __obs.subscribe !== 'function') return;");
        asyncLines.push(`    const __sub = __obs.subscribe((__v: any) => ${setterName(input.varName)}(__v));`);
        asyncLines.push("    return () => { if (__sub && typeof __sub.unsubscribe === 'function') __sub.unsubscribe(); };");
        asyncLines.push('  }, []);');
      }
    }

    /**
     * Assignment guard for event bindings (Stage 10): true (and a
     * GEN_EVENT_ASSIGNMENT warning recorded) when the binding is an
     * assignment statement. The binding is dropped by the caller; see
     * isAssignmentExpression for why assignments cannot be translated.
     */
    const isAssignmentBinding = (el: ElementNode, ev: EventBinding): boolean => {
      if (!isAssignmentExpression(ev.expression)) return false;
      diagnostics.push(warning(
        'GEN_EVENT_ASSIGNMENT',
        `Event binding (${ev.name}) on <${el.tag}> holds an assignment ('${ev.expression.trim()}'); template event bindings take a method call, so the binding was dropped`,
        el.pos.line, el.pos.column,
        `Call a method instead and assign inside it: (${ev.name})="onEvent()" in the template, onEvent() { this.field = false; } in the class`,
      ));
      return true;
    };

    /**
     * Attribute directives on one element (Stage 12): the directives
     * whose attribute name the element carries, plus the attribute and
     * input names they consume (those never become host props).
     */
    const directivesOn = (el: ElementNode) => {
      const active: { attr: string; info: DirectiveInfo; assignments: DirectiveStyleAssign[]; unsupported?: string }[] = [];
      for (const [attr, d] of this.directivesByAttr) {
        if (el.attrs[attr] !== undefined
          || el.propBindings.some((b) => b.name === attr)
          || el.booleanAttrs.includes(attr)) {
          active.push({ attr, info: d.info, assignments: d.assignments, unsupported: d.unsupported });
        }
      }
      return active;
    };
    const directiveConsumedNames = (el: ElementNode): Set<string> => {
      const names = new Set<string>();
      for (const d of directivesOn(el)) {
        names.add(d.attr);
        for (const input of d.info.inputs) names.add(input.name);
      }
      return names;
    };
    /**
     * The merged style object a host element's directives compute, as
     * generated code: each assignment's right-hand side with the
     * element's bound values substituted for the input names. Bound
     * inputs win over static attributes, which win over the declared
     * default; an unbound input with no default reads as undefined,
     * exactly Angular's initial value.
     */
    const directiveStyleCode = (el: ElementNode): string | undefined => {
      const entries: string[] = [];
      for (const d of directivesOn(el)) {
        if (d.unsupported) continue;
        const renames = new Map<string, string>();
        for (const input of d.info.inputs) {
          const binding = el.propBindings.find((b) => b.name === input.name);
          if (binding) renames.set(input.name, codeExpr(binding.expression));
          else if (el.attrs[input.name] !== undefined) renames.set(input.name, JSON.stringify(el.attrs[input.name]));
          else if (el.booleanAttrs.includes(input.name)) renames.set(input.name, 'true');
          else if (input.initializer) renames.set(input.name, input.initializer);
          else renames.set(input.name, 'undefined');
        }
        for (const a of d.assignments) {
          entries.push(`${a.prop}: ${exprToCode(a.rhs, { renames })}`);
        }
      }
      return entries.length ? `{ ${entries.join(', ')} }` : undefined;
    };

    const renderText = (node: TemplateNode & { type: 'text' }, indent: string): string => {
      const parts = node.parts.map((p) => {
        if (p.type === 'static') return jsxTextPart(p.value);
        return `{${codeExpr(p.expression)}}`;
      });
      return indent + parts.join('');
    };

    /**
     * Render an <icon> element (Stage 7). Icons are validated here, at
     * compile time, against the curated set in @rangular/ui icons.ts:
     * an unknown static name is an error (the JSON diagnostic carries
     * the full valid list in validIcons), a missing name is an error,
     * and an off-scale size warns and snaps to the icon size scale,
     * the same warn-and-snap behaviour the style translator uses. A
     * [name] binding is passed through unvalidated, its value is only
     * known at runtime. Only name, size and color exist in v1; any
     * other attribute or binding on <icon> is ignored.
     */
    const renderIcon = (el: ElementNode, depth: number, extraProps: string[]): string[] => {
      const indent = '  '.repeat(depth + 2);
      this.usedUi.add('RgIcon');
      const props: string[] = [...extraProps];
      const nameBinding = el.propBindings.find((b) => b.name === 'name');
      const sizeBinding = el.propBindings.find((b) => b.name === 'size');
      const colorBinding = el.propBindings.find((b) => b.name === 'color');
      const staticName = el.attrs['name'];

      if (staticName !== undefined) {
        if (staticName in ICON_PATHS) {
          props.push(`name="${escapeJsxAttrValue(staticName)}"`);
        } else {
          diagnostics.push({
            severity: 'error',
            code: 'GEN_ICON_UNKNOWN',
            message: `Unknown icon name '${staticName}': it is not in the Rangular icon set`,
            line: el.pos.line,
            column: el.pos.column,
            fix: 'Use one of the names listed under Icons in catalog.md, e.g. <icon name="search"></icon>',
            validIcons: ICON_NAMES,
          });
          props.push(`name="${escapeJsxAttrValue(staticName)}"`);
        }
      } else if (nameBinding) {
        props.push(`name={${codeExpr(nameBinding.expression)}}`);
      } else {
        diagnostics.push(error(
          'GEN_ICON_NAME',
          '<icon> has no name attribute and no [name] binding; there is nothing to draw',
          el.pos.line, el.pos.column,
          'Add a name from the icon set, e.g. <icon name="search"></icon>; the full set is listed under Icons in catalog.md',
        ));
      }

      const snapIconSize = (raw: number): number => {
        const snapped = nearestOnScale(ICON_SIZES, raw);
        if (snapped !== raw) {
          diagnostics.push(warning(
            'GEN_ICON_SIZE',
            `Icon size ${raw} is off the icon size scale (${ICON_SIZES.join(', ')}); the generated code uses ${snapped}`,
            el.pos.line, el.pos.column,
            `Use size="${snapped}" (the icon size scale is ${ICON_SIZES.join(', ')})`,
          ));
        }
        return snapped;
      };
      if (el.attrs['size'] !== undefined) {
        const raw = Number(el.attrs['size']);
        if (Number.isFinite(raw)) {
          props.push(`size={${snapIconSize(raw)}}`);
        } else {
          diagnostics.push(warning(
            'GEN_ICON_SIZE',
            `Icon size '${el.attrs['size']}' is not a number; the generated code uses the default size ${DEFAULT_ICON_SIZE}`,
            el.pos.line, el.pos.column,
            `Use size="20", size="24" or size="28"`,
          ));
          props.push(`size={${DEFAULT_ICON_SIZE}}`);
        }
      } else if (sizeBinding) {
        const literal = /^-?\d+(\.\d+)?$/.test(sizeBinding.expression.trim())
          ? Number(sizeBinding.expression.trim())
          : undefined;
        props.push(literal !== undefined
          ? `size={${snapIconSize(literal)}}`
          : `size={${codeExpr(sizeBinding.expression)}}`);
      }

      if (el.attrs['color'] !== undefined) {
        props.push(`color="${escapeJsxAttrValue(el.attrs['color'])}"`);
      } else if (colorBinding) {
        props.push(`color={${codeExpr(colorBinding.expression)}}`);
      }

      // Badge (Stage 11): <icon> is one of the three badge hosts, so a
      // badge attribute or [badge] binding becomes the badge prop the
      // RgIcon primitive draws as a count dot (see renderCore for the
      // other two hosts and the GEN_BADGE_HOST warning elsewhere).
      if (el.attrs['badge'] !== undefined) {
        props.push(`badge="${escapeJsxAttrValue(el.attrs['badge'])}"`);
      } else {
        const badgeBinding = el.propBindings.find((b) => b.name === 'badge');
        if (badgeBinding) props.push(`badge={${codeExpr(badgeBinding.expression)}}`);
      }

      return [`${indent}<RgIcon${props.length ? ' ' + props.join(' ') : ''} />`];
    };

    // Attributes of <input> that are forms machinery, never RgInput
    // props: the validators, the reactive name, the ngModel options, and
    // `type`/`name` (type is translated to secure/keyboardType below;
    // Angular's `name` keys controls inside an NgForm, which Rangular
    // does not track, refs and fields do that job here).
    const INPUT_DROP_ATTRS = new Set([
      'required', 'minlength', 'maxlength', 'email', 'pattern',
      'name', 'formControlName', 'ngModelOptions', 'type',
    ]);

    /**
     * Render an <input> (Stage 8). The binding mode comes from the forms
     * analysis: ngModel inputs get value plus write-back (and a touched
     * hook feeding their validation model), reactive inputs wire to
     * their FormControl (setValue on change, markAsTouched on blur),
     * plain inputs keep the Stage 2 value/event behaviour. Handler
     * expressions receive the text as $event, the Stage 6 control
     * pattern. Validator attributes, formControlName and ngModelOptions
     * are consumed, never emitted as props.
     */
    const renderInput = (el: ElementNode, depth: number, extraProps: string[]): string[] => {
      const indent = '  '.repeat(depth + 2);
      const info = inputInfos.get(el);
      this.usedUi.add('RgInput');
      const lines: string[] = [];
      const props: string[] = [...extraProps];

      const typeAttr = el.attrs['type'];
      if (typeAttr === 'password') props.push('secure');
      else if (typeAttr === 'email') props.push('keyboardType="email-address"');
      else if (typeAttr === 'number') props.push('keyboardType="numeric"');

      for (const [name, value] of Object.entries(el.attrs)) {
        if (name === 'class' || INPUT_DROP_ATTRS.has(name)) continue;
        props.push(`${name}="${escapeJsxAttrValue(value)}"`);
      }
      for (const b of el.booleanAttrs) {
        if (INPUT_DROP_ATTRS.has(b)) continue;
        props.push(b);
      }

      /** A handler binding in $event call form: bare ref -> fn($event). */
      const callOf = (src: string): string => {
        const trimmed = src.trim();
        let bare = false;
        try { bare = parseExpression(trimmed).type === 'identifier'; } catch { /* raw fallback */ }
        return bare ? `${trimmed}($event)` : codeExpr(src);
      };

      const textCalls: string[] = [];
      const blurCalls: string[] = [];
      const selectCalls: string[] = [];
      if (info?.mode === 'ngmodel' && info.field) {
        props.push(info.twoWay
          ? `value={${info.field}}`
          : `value={${codeExpr(info.expression ?? info.field)}}`);
        if (info.twoWay) textCalls.push(`${setterName(info.field)}($event)`);
        if (info.key) blurCalls.push(`${setterName(`${info.key}Touched`)}(true)`);
      } else if (info?.mode === 'valueOnly') {
        props.push(`value={${codeExpr(info.expression ?? '')}}`);
        lines.push(`${indent}{/* TODO(Rangular forms): ngModel target "${forBlockComment(info.expression ?? '')}" is not a plain field, the value is one-way only */}`);
      } else if (info?.mode === 'reactive' && info.groupField && info.controlName) {
        const group = `${info.groupField}Ref.current`;
        props.push(`value={${group}.get('${info.controlName}').value}`);
        textCalls.push(`${group}.get('${info.controlName}').setValue($event)`);
        blurCalls.push(`${group}.get('${info.controlName}').markAsTouched()`);
        blurCalls.push('setFormVersion((v) => v + 1)');
      }

      const consumedEvents = new Set(['input', 'change', 'blur', 'ngModelChange', 'optionSelected']);
      for (const ev of el.eventBindings) {
        if (isAssignmentBinding(el, ev)) {
          lines.push(`${indent}{/* TODO(Rangular): (${ev.name}) assignment handler dropped, see GEN_EVENT_ASSIGNMENT */}`);
          continue;
        }
        if (ev.name === 'ngModelChange' && info?.mode !== 'reactive') {
          textCalls.push(callOf(ev.expression));
        } else if (ev.name === 'optionSelected') {
          // Autocomplete (Stage 11): the chosen option string is the
          // $event, the Stage 6 control pattern, like (change).
          selectCalls.push(callOf(ev.expression));
        } else if (ev.name === 'input' || ev.name === 'change') {
          textCalls.push(callOf(ev.expression));
        } else if (ev.name === 'blur') {
          const trimmed = ev.expression.trim();
          let bare = false;
          try { bare = parseExpression(trimmed).type === 'identifier'; } catch { /* raw fallback */ }
          blurCalls.push(bare ? `${trimmed}()` : codeExpr(ev.expression));
        }
      }
      if (textCalls.length) {
        props.push(textCalls.length === 1
          ? `onChangeText={($event) => ${textCalls[0]}}`
          : `onChangeText={($event) => { ${textCalls.join('; ')}; }}`);
      }
      if (blurCalls.length) {
        props.push(blurCalls.length === 1
          ? `onBlur={() => ${blurCalls[0]}}`
          : `onBlur={() => { ${blurCalls.join('; ')}; }}`);
      }
      if (selectCalls.length) {
        props.push(selectCalls.length === 1
          ? `onOptionSelected={($event) => ${selectCalls[0]}}`
          : `onOptionSelected={($event) => { ${selectCalls.join('; ')}; }}`);
      }

      // [options] is autocomplete machinery (Stage 11), consumed by
      // name here and emitted explicitly as the RgInput options prop;
      // it stays in consumedProps so the generic loop never doubles it.
      const consumedProps = new Set(['ngModel', 'ngModelOptions', 'formControlName', 'options']);
      const optionsBinding = el.propBindings.find((b) => b.name === 'options');
      if (optionsBinding) props.push(`options={${codeExpr(optionsBinding.expression)}}`);
      if (info && info.mode !== 'plain') consumedProps.add('value');
      for (const p of el.propBindings) {
        if (consumedProps.has(p.name)) continue;
        if (p.name === 'type') {
          lines.push(`${indent}{/* TODO(Rangular forms): a [type] binding on <input> is not supported, use a static type="password|email|number" attribute */}`);
          continue;
        }
        props.push(`${p.name}={${codeExpr(p.expression)}}`);
      }
      // Remaining events keep the generic mapping (e.g. (focus)).
      for (const ev of el.eventBindings) {
        if (consumedEvents.has(ev.name)) continue;
        if (isAssignmentBinding(el, ev)) {
          lines.push(`${indent}{/* TODO(Rangular): (${ev.name}) assignment handler dropped, see GEN_EVENT_ASSIGNMENT */}`);
          continue;
        }
        const src = ev.expression.trim();
        let isBareRef = false;
        try { isBareRef = parseExpression(src).type === 'identifier'; } catch { /* raw fallback */ }
        const { prop, known } = eventPropName(ev.name, el.tag);
        if (!known) {
          lines.push(`${indent}{/* (${ev.name}) has no standard RN prop, mapped to ${prop} */}`);
        }
        props.push(isBareRef ? `${prop}={${src}}` : `${prop}={() => ${codeExpr(src)}}`);
      }
      const style = styleFor(el);
      if (style) props.push(`style={${style}}`);
      // A forms ref (#email="ngModel") is a template-level validation
      // object, not a DOM ref; only plain inputs keep the ref prop.
      if (el.ref && (!info || info.mode === 'plain')) props.push(`ref={${el.ref}Ref}`);

      lines.push(`${indent}<RgInput${props.length ? ' ' + props.join(' ') : ''} />`);
      return lines;
    };

    /**
     * Render a <router-outlet> (Stage 9). Only the entry component may
     * host one: nested outlets belong to child routes, which are not in
     * this version (GEN_ROUTE_UNSUPPORTED). The outlet renders the
     * route component whose pattern equals the navigator's current
     * routePath; each route component is keyed by the concrete path, so
     * navigating to the same component with new parameters remounts it
     * (the stated v1 simplification) and its ActivatedRoute, created
     * here per render, always carries the current entry's params.
     * Redirect-only routes render nothing. With no route table in the
     * compilation the outlet renders empty; compile.ts has already
     * reported GEN_ROUTES_MISSING for the entry template, and a child
     * template's outlet earns that warning here.
     */
    const renderOutlet = (el: ElementNode, depth: number): string[] => {
      const indent = '  '.repeat(depth + 2);
      this.usedUi.add('RgOutlet');
      if (!opts.entry) {
        if (this.routingActive) {
          diagnostics.push(warning(
            'GEN_ROUTE_UNSUPPORTED',
            '<router-outlet> appears in a child component; nested outlets belong to child routes, which Rangular routing does not support yet',
            el.pos.line, el.pos.column,
            'Keep the single <router-outlet> in the root component; child routes are on the roadmap in docs/ROADMAP.md',
          ));
        } else {
          diagnostics.push(warning(
            'GEN_ROUTES_MISSING',
            '<router-outlet> appears in a child component template, but no routes file was resolved for this compilation',
            el.pos.line, el.pos.column,
            "Create app.routes.ts next to the root component: export const routes: Routes = [{ path: 'home', component: HomeComponent }];",
          ));
        }
        return [`${indent}<RgOutlet />`];
      }
      if (!this.routingActive) return [`${indent}<RgOutlet />`];
      const lines: string[] = [`${indent}<RgOutlet>`];
      for (const route of this.routes ?? []) {
        if (!route.componentName) continue;
        const info = this.childByClassName.get(route.componentName);
        if (!info) continue;
        const fn = componentFunctionName(route.componentName);
        const needsRoute = (info.constructorDeps ?? []).some((d) => d.typeName === 'ActivatedRoute');
        if (needsRoute) this.usedRuntime.add('ActivatedRoute');
        lines.push(`${indent}  {__route.routePath === ${JSON.stringify(route.path)} && (`);
        lines.push(`${indent}    <${fn} key={__route.path}${needsRoute ? ' __rgRoute={new ActivatedRoute(__route.params, __navigator)}' : ''} />`);
        lines.push(`${indent}  )}`);
      }
      lines.push(`${indent}</RgOutlet>`);
      return lines;
    };

    /**
     * Render a <datetime-picker> (Stage 10). The picker is a dedicated
     * block with a small validated surface: mode (date, time or
     * datetime; a static value outside the three is a GEN_PICKER_MODE
     * error, a [mode] binding passes through unchecked), label,
     * minuteInterval (1 or 5; anything else warns GEN_PICKER_INTERVAL
     * and snaps to the nearest, the icon size pattern), [value] in
     * and (change) out with the ISO string as $event, wired like the
     * Stage 6 controls. Children are meaningless on a picker and are
     * ignored. The wheels and formatting live in the primitive and
     * the shared helpers in @rangular/ui datetime.ts.
     */
    const renderDateTimePicker = (el: ElementNode, depth: number, extraProps: string[]): string[] => {
      const indent = '  '.repeat(depth + 2);
      this.usedUi.add('RgDateTimePicker');
      const lines: string[] = [];
      const props: string[] = [...extraProps];

      const snapInterval = (raw: number): number => {
        const snapped = nearestOnScale([1, 5], raw);
        if (snapped !== raw) {
          diagnostics.push(warning(
            'GEN_PICKER_INTERVAL',
            `minuteInterval ${raw} is not 1 or 5; the generated code uses ${snapped}`,
            el.pos.line, el.pos.column,
            `Use minuteInterval="1" or minuteInterval="5"`,
          ));
        }
        return snapped;
      };

      const modeBinding = el.propBindings.find((b) => b.name === 'mode');
      if (el.attrs['mode'] !== undefined) {
        const mode = el.attrs['mode'];
        if (!(PICKER_MODES as string[]).includes(mode)) {
          diagnostics.push(error(
            'GEN_PICKER_MODE',
            `<datetime-picker> mode '${mode}' is not a picker mode; the picker treats it as datetime`,
            el.pos.line, el.pos.column,
            'Use mode="date", mode="time" or mode="datetime" (datetime is the default and can be omitted)',
          ));
        }
        props.push(`mode="${escapeJsxAttrValue(mode)}"`);
      } else if (modeBinding) {
        props.push(`mode={${codeExpr(modeBinding.expression)}}`);
      }

      if (el.attrs['minuteInterval'] !== undefined) {
        const raw = Number(el.attrs['minuteInterval']);
        if (Number.isFinite(raw)) {
          props.push(`minuteInterval={${snapInterval(raw)}}`);
        } else {
          diagnostics.push(warning(
            'GEN_PICKER_INTERVAL',
            `minuteInterval '${el.attrs['minuteInterval']}' is not a number; the generated code uses the default 1`,
            el.pos.line, el.pos.column,
            'Use minuteInterval="1" or minuteInterval="5"',
          ));
          props.push('minuteInterval={1}');
        }
      } else {
        const intervalBinding = el.propBindings.find((b) => b.name === 'minuteInterval');
        if (intervalBinding) {
          const literal = /^-?\d+(\.\d+)?$/.test(intervalBinding.expression.trim())
            ? Number(intervalBinding.expression.trim())
            : undefined;
          props.push(literal !== undefined
            ? `minuteInterval={${snapInterval(literal)}}`
            : `minuteInterval={${codeExpr(intervalBinding.expression)}}`);
        }
      }

      const consumedAttrs = new Set(['class', 'mode', 'minuteInterval']);
      for (const [name, value] of Object.entries(el.attrs)) {
        if (consumedAttrs.has(name)) continue;
        props.push(`${name}="${escapeJsxAttrValue(value)}"`);
      }
      for (const b of el.booleanAttrs) props.push(b);
      const consumedProps = new Set(['mode', 'minuteInterval']);
      for (const p of el.propBindings) {
        if (consumedProps.has(p.name)) continue;
        props.push(`${p.name}={${codeExpr(p.expression)}}`);
      }
      for (const ev of el.eventBindings) {
        if (isAssignmentBinding(el, ev)) {
          lines.push(`${indent}{/* TODO(Rangular): (${ev.name}) assignment handler dropped, see GEN_EVENT_ASSIGNMENT */}`);
          continue;
        }
        const src = ev.expression.trim();
        let isBareRef = false;
        try { isBareRef = parseExpression(src).type === 'identifier'; } catch { /* raw fallback */ }
        if (ev.name === 'change') {
          // The picker emits the ISO string as $event (the Stage 6
          // control pattern): the wrapper must receive it.
          props.push(isBareRef ? `onChange={${src}}` : `onChange={($event) => ${codeExpr(src)}}`);
          continue;
        }
        const { prop, known } = eventPropName(ev.name, el.tag);
        if (!known) {
          lines.push(`${indent}{/* (${ev.name}) has no standard RN prop, mapped to ${prop} */}`);
        }
        props.push(isBareRef ? `${prop}={${src}}` : `${prop}={() => ${codeExpr(src)}}`);
      }
      const style = styleFor(el);
      if (style) props.push(`style={${style}}`);
      if (el.ref) props.push(`ref={${el.ref}Ref}`);

      lines.push(`${indent}<RgDateTimePicker${props.length ? ' ' + props.join(' ') : ''} />`);
      return lines;
    };

    /**
     * Render a <column> (Stage 11). A column is a declaration inside
     * <table>: its `name` attribute names the row property it displays
     * (the name of a matColumnDef in Angular Material's table) and
     * `header` is the header cell text, defaulting to the name. React
     * reserves the JSX `key` prop (it is extracted by React and never
     * reaches the component), so `name` is the documented attribute; a
     * `key` attribute is accepted as an alias and normalised to the
     * same name prop. Children and other attributes are meaningless on
     * a column and are ignored. A column with neither name nor key is
     * a GEN_TABLE_COLUMN error: the table cannot read its cells.
     */
    const renderColumn = (el: ElementNode, depth: number, extraProps: string[]): string[] => {
      const indent = '  '.repeat(depth + 2);
      this.usedUi.add('RgColumn');
      const props: string[] = [...extraProps];
      const name = el.attrs['name'] ?? el.attrs['key'];
      if (name === undefined) {
        diagnostics.push(error(
          'GEN_TABLE_COLUMN',
          '<column> has no name attribute; a column declares which row property it displays by name',
          el.pos.line, el.pos.column,
          'Add the row property name: <column name="sender" header="From"></column> (key="sender" works as an alias)',
        ));
      } else {
        props.push(`name="${escapeJsxAttrValue(name)}"`);
      }
      if (el.attrs['header'] !== undefined) {
        props.push(`header="${escapeJsxAttrValue(el.attrs['header'])}"`);
      }
      return [`${indent}<RgColumn${props.length ? ' ' + props.join(' ') : ''} />`];
    };

    /**
     * Render a <slider> (Stage 11), the mat-slider adaptation: [value]
     * in, (change) out with the snapped number as $event (the Stage 6
     * control pattern), plus min, max and step. Range validation runs
     * here whenever values are statically known (static attributes or
     * literal bindings): min at or above max is a GEN_SLIDER_RANGE
     * error, a step at or below zero warns GEN_SLIDER_RANGE and the
     * generated code uses 1, and a non-numeric static min, max or step
     * warns and drops the attribute so the primitive default applies.
     * Field bindings pass through unchecked; the primitive clamps and
     * snaps at runtime. Children are meaningless and ignored.
     */
    const renderSlider = (el: ElementNode, depth: number, extraProps: string[]): string[] => {
      const indent = '  '.repeat(depth + 2);
      this.usedUi.add('RgSlider');
      const lines: string[] = [];
      const props: string[] = [...extraProps];

      const staticNumber = (name: string): number | undefined => {
        if (el.attrs[name] === undefined) return undefined;
        const raw = Number(el.attrs[name]);
        return Number.isFinite(raw) ? raw : undefined;
      };
      const literalNumber = (name: string): number | undefined => {
        const b = el.propBindings.find((x) => x.name === name);
        if (!b) return undefined;
        const text = b.expression.trim();
        return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : undefined;
      };
      const knownNumber = (name: string): number | undefined =>
        staticNumber(name) ?? literalNumber(name);

      const emitNumberProp = (name: string, forced?: number): void => {
        if (forced !== undefined) {
          props.push(`${name}={${forced}}`);
          return;
        }
        if (el.attrs[name] !== undefined) {
          const stat = staticNumber(name);
          if (stat !== undefined) {
            props.push(`${name}={${stat}}`);
            return;
          }
          diagnostics.push(warning(
            'GEN_SLIDER_RANGE',
            `<slider> ${name}="${el.attrs[name]}" is not a number; the attribute is dropped and the primitive default applies`,
            el.pos.line, el.pos.column,
            `Use a number for ${name}, e.g. ${name}="0"`,
          ));
          return;
        }
        const b = el.propBindings.find((x) => x.name === name);
        if (b) props.push(`${name}={${codeExpr(b.expression)}}`);
      };

      const minKnown = knownNumber('min');
      const maxKnown = knownNumber('max');
      if (minKnown !== undefined && maxKnown !== undefined && minKnown >= maxKnown) {
        diagnostics.push(error(
          'GEN_SLIDER_RANGE',
          `<slider> min (${minKnown}) must be below max (${maxKnown}); the slider cannot move`,
          el.pos.line, el.pos.column,
          'Give the slider a range with room to move, e.g. min="0" max="100" step="1"',
        ));
      }
      emitNumberProp('min');
      emitNumberProp('max');
      const stepKnown = knownNumber('step');
      if (stepKnown !== undefined && stepKnown <= 0) {
        diagnostics.push(warning(
          'GEN_SLIDER_RANGE',
          `<slider> step (${stepKnown}) must be above zero; the generated code uses step 1`,
          el.pos.line, el.pos.column,
          'Use a positive step, e.g. step="1"',
        ));
        emitNumberProp('step', 1);
      } else {
        emitNumberProp('step');
      }

      const consumedAttrs = new Set(['class', 'min', 'max', 'step']);
      for (const [name, value] of Object.entries(el.attrs)) {
        if (consumedAttrs.has(name)) continue;
        props.push(`${name}="${escapeJsxAttrValue(value)}"`);
      }
      for (const b of el.booleanAttrs) props.push(b);
      const consumedProps = new Set(['min', 'max', 'step']);
      for (const p of el.propBindings) {
        if (consumedProps.has(p.name)) continue;
        props.push(`${p.name}={${codeExpr(p.expression)}}`);
      }
      for (const ev of el.eventBindings) {
        if (isAssignmentBinding(el, ev)) {
          lines.push(`${indent}{/* TODO(Rangular): (${ev.name}) assignment handler dropped, see GEN_EVENT_ASSIGNMENT */}`);
          continue;
        }
        const src = ev.expression.trim();
        let isBareRef = false;
        try { isBareRef = parseExpression(src).type === 'identifier'; } catch { /* raw fallback */ }
        if (ev.name === 'change') {
          props.push(isBareRef ? `onChange={${src}}` : `onChange={($event) => ${codeExpr(src)}}`);
          continue;
        }
        const { prop, known } = eventPropName(ev.name, el.tag);
        if (!known) {
          lines.push(`${indent}{/* (${ev.name}) has no standard RN prop, mapped to ${prop} */}`);
        }
        props.push(isBareRef ? `${prop}={${src}}` : `${prop}={() => ${codeExpr(src)}}`);
      }
      const style = styleFor(el);
      if (style) props.push(`style={${style}}`);
      if (el.ref) props.push(`ref={${el.ref}Ref}`);

      lines.push(`${indent}<RgSlider${props.length ? ' ' + props.join(' ') : ''} />`);
      return lines;
    };

    /**
     * Render a <progress-bar> (Stage 11), the mat-progress-bar
     * adaptation: [value] from 0 to 100 in determinate mode (the
     * default), mode="indeterminate" for the animated form. A
     * statically known value outside the range warns
     * GEN_PROGRESS_RANGE and the generated code carries the clamped
     * number; a field binding passes through and the primitive clamps
     * at runtime. An unknown static mode is passed through and the
     * primitive treats anything but indeterminate as determinate.
     * Children are meaningless and ignored.
     */
    const renderProgressBar = (el: ElementNode, depth: number, extraProps: string[]): string[] => {
      const indent = '  '.repeat(depth + 2);
      this.usedUi.add('RgProgressBar');
      const props: string[] = [...extraProps];

      const clampValue = (raw: number): number => {
        const clamped = Math.min(100, Math.max(0, raw));
        if (clamped !== raw) {
          diagnostics.push(warning(
            'GEN_PROGRESS_RANGE',
            `<progress-bar> value ${raw} is outside 0 to 100; the generated code uses ${clamped}`,
            el.pos.line, el.pos.column,
            'Bind [value] to a number from 0 to 100, e.g. [value]="82"',
          ));
        }
        return clamped;
      };

      if (el.attrs['mode'] !== undefined) {
        props.push(`mode="${escapeJsxAttrValue(el.attrs['mode'])}"`);
      } else {
        const modeBinding = el.propBindings.find((b) => b.name === 'mode');
        if (modeBinding) props.push(`mode={${codeExpr(modeBinding.expression)}}`);
      }
      if (el.attrs['value'] !== undefined) {
        const raw = Number(el.attrs['value']);
        if (Number.isFinite(raw)) props.push(`value={${clampValue(raw)}}`);
        else props.push(`value="${escapeJsxAttrValue(el.attrs['value'])}"`);
      } else {
        const valueBinding = el.propBindings.find((b) => b.name === 'value');
        if (valueBinding) {
          const text = valueBinding.expression.trim();
          props.push(/^-?\d+(\.\d+)?$/.test(text)
            ? `value={${clampValue(Number(text))}}`
            : `value={${codeExpr(valueBinding.expression)}}`);
        }
      }
      const consumedAttrs = new Set(['class', 'mode', 'value']);
      for (const [name, value] of Object.entries(el.attrs)) {
        if (consumedAttrs.has(name)) continue;
        props.push(`${name}="${escapeJsxAttrValue(value)}"`);
      }
      for (const b of el.booleanAttrs) props.push(b);
      for (const p of el.propBindings) {
        if (p.name === 'mode' || p.name === 'value') continue;
        props.push(`${p.name}={${codeExpr(p.expression)}}`);
      }
      const style = styleFor(el);
      if (style) props.push(`style={${style}}`);
      if (el.ref) props.push(`ref={${el.ref}Ref}`);
      return [`${indent}<RgProgressBar${props.length ? ' ' + props.join(' ') : ''} />`];
    };

    /**
     * Render a <spinner> (Stage 11), the mat-progress-spinner
     * adaptation: a small rotating arc drawn from one SVG path, the
     * same drawing in the app (react-native-svg, like the icons) and
     * in the preview (inline SVG, static there). The size sits on the
     * icon size scale (20, 24, 28) and an off-scale size warns
     * GEN_SPINNER_SIZE and snaps, the icon rule; color names a theme
     * colour role and defaults to the primary role in the primitive.
     * Children are meaningless and ignored.
     */
    const renderSpinner = (el: ElementNode, depth: number, extraProps: string[]): string[] => {
      const indent = '  '.repeat(depth + 2);
      this.usedUi.add('RgSpinner');
      const props: string[] = [...extraProps];

      const snapSpinnerSize = (raw: number): number => {
        const snapped = nearestOnScale(ICON_SIZES, raw);
        if (snapped !== raw) {
          diagnostics.push(warning(
            'GEN_SPINNER_SIZE',
            `Spinner size ${raw} is off the icon size scale (${ICON_SIZES.join(', ')}); the generated code uses ${snapped}`,
            el.pos.line, el.pos.column,
            `Use size="${snapped}" (the icon size scale is ${ICON_SIZES.join(', ')})`,
          ));
        }
        return snapped;
      };
      if (el.attrs['size'] !== undefined) {
        const raw = Number(el.attrs['size']);
        if (Number.isFinite(raw)) {
          props.push(`size={${snapSpinnerSize(raw)}}`);
        } else {
          diagnostics.push(warning(
            'GEN_SPINNER_SIZE',
            `Spinner size '${el.attrs['size']}' is not a number; the generated code uses the default size ${DEFAULT_ICON_SIZE}`,
            el.pos.line, el.pos.column,
            'Use size="20", size="24" or size="28"',
          ));
          props.push(`size={${DEFAULT_ICON_SIZE}}`);
        }
      } else {
        const sizeBinding = el.propBindings.find((b) => b.name === 'size');
        if (sizeBinding) {
          const literal = /^-?\d+(\.\d+)?$/.test(sizeBinding.expression.trim())
            ? Number(sizeBinding.expression.trim())
            : undefined;
          props.push(literal !== undefined
            ? `size={${snapSpinnerSize(literal)}}`
            : `size={${codeExpr(sizeBinding.expression)}}`);
        }
      }
      if (el.attrs['color'] !== undefined) {
        props.push(`color="${escapeJsxAttrValue(el.attrs['color'])}"`);
      } else {
        const colorBinding = el.propBindings.find((b) => b.name === 'color');
        if (colorBinding) props.push(`color={${codeExpr(colorBinding.expression)}}`);
      }
      const style = styleFor(el);
      if (style) props.push(`style={${style}}`);
      if (el.ref) props.push(`ref={${el.ref}Ref}`);
      return [`${indent}<RgSpinner${props.length ? ' ' + props.join(' ') : ''} />`];
    };

    /** Render one element without its structural directive (handled by renderElement). */
    const renderCore = (el: ElementNode, depth: number, extraProps: string[], formCtx?: FormInfo): string[] => {
      // Content projection (Stage 12): <ng-content> in a child
      // component's template is where the children written inside the
      // child's tag in the host template land; they arrive as the
      // generated function's React children prop. A select attribute
      // (multi-slot projection) is not supported: it warns and the
      // element behaves as the default slot.
      if (el.tag.toLowerCase() === 'ng-content') {
        const indent = '  '.repeat(depth + 2);
        if (el.attrs['select'] !== undefined) {
          diagnostics.push(warning(
            'PROJECTION_SELECT_UNSUPPORTED',
            `<ng-content select="${el.attrs['select']}"> uses multi-slot projection, which is not supported yet; the element behaves as the default slot and receives all projected children`,
            el.pos.line, el.pos.column,
            'Use a single <ng-content></ng-content> with no select attribute; every child written inside the component tag lands there',
          ));
        }
        return [`${indent}{children}`];
      }
      // Dedicated renderers have no style merge point, so a directive
      // on one of their hosts warns instead of silently doing nothing.
      if (['icon', 'input', 'datetime-picker'].includes(el.tag.toLowerCase())) {
        for (const d of directivesOn(el)) {
          diagnostics.push(warning(
            'DIR_UNSUPPORTED',
            `Directive [${d.attr}] sits on <${el.tag}>, which has a dedicated renderer with no host style to merge into; it applied no styles`,
            el.pos.line, el.pos.column,
            `Move [${d.attr}] onto a plain element (a <p>, <div>, <span> or <card>)`,
          ));
        }
      }
      if (el.tag.toLowerCase() === 'router-outlet') return renderOutlet(el, depth);
      if (el.tag.toLowerCase() === 'icon') return renderIcon(el, depth, extraProps);
      if (el.tag.toLowerCase() === 'input') return renderInput(el, depth, extraProps);
      if (el.tag.toLowerCase() === 'datetime-picker') return renderDateTimePicker(el, depth, extraProps);
      if (el.tag.toLowerCase() === 'column') return renderColumn(el, depth, extraProps);
      if (el.tag.toLowerCase() === 'slider') return renderSlider(el, depth, extraProps);
      if (el.tag.toLowerCase() === 'progress-bar') return renderProgressBar(el, depth, extraProps);
      if (el.tag.toLowerCase() === 'spinner') return renderSpinner(el, depth, extraProps);
      const indent = '  '.repeat(depth + 2);
      const lines: string[] = [];
      const mapping = TAG_MAP[el.tag.toLowerCase()];
      const childInfo = !mapping ? this.childBySelector.get(el.tag) : undefined;
      let componentName: string;
      if (mapping) {
        componentName = mapping.component;
        (mapping.fromUi ? this.usedUi : this.usedRn).add(mapping.component);
      } else if (childInfo) {
        componentName = componentFunctionName(childInfo.className);
      } else if (/^[A-Z]/.test(el.tag) || el.tag.includes('-')) {
        // A component-looking tag: keep it, the app's own registry resolves it.
        componentName = el.tag;
      } else {
        diagnostics.push(warning(
          'GEN_UNKNOWN_TAG',
          `Unknown tag <${el.tag}>, emitted as <View>. Use a known block or a component tag.`,
          el.pos.line, el.pos.column,
          'Known blocks: screen, appbar, card, list, row, fab, button, input, form, switch, switcher, checkbox, radio-group, tabs, accordion, panel, table, slider, progress-bar, spinner, chips, chip, sheet, dialog, datetime-picker, h1, h2, h3, p, span, label, div, section, header, or use a Capitalised component tag',
        ));
        componentName = 'View';
        this.usedRn.add('View');
      }

      // Routing links (Stage 9): routerLink and [routerLink] are
      // consumed here, never emitted as props. They become navigation
      // in the element's onPress below: an array expression goes
      // through Router.navigate (the Angular commands form), anything
      // else through navigateByUrl. On a child component tag a link has
      // nowhere to attach (the child renders its own root), so it is
      // dropped with a GEN_ROUTE_UNSUPPORTED warning. Without an active
      // route table the attributes are consumed silently in the entry
      // unit (compile.ts already reported GEN_ROUTES_MISSING) and earn
      // that warning in child units, whose usage compile.ts cannot see
      // before codegen.
      const linkAttr = el.attrs['routerLink'];
      const linkBinding = el.propBindings.find((b) => b.name === 'routerLink');
      let navCall: string | undefined;
      if (linkAttr !== undefined || linkBinding) {
        if (childInfo) {
          diagnostics.push(warning(
            'GEN_ROUTE_UNSUPPORTED',
            `routerLink on the component tag <${el.tag}> is not supported; a link belongs on a tappable block of the template`,
            el.pos.line, el.pos.column,
            'Put routerLink on a <button> or <row>, or handle the tap inside the component and call this.router.navigate([...]) from its class',
          ));
        } else if (this.routingActive) {
          if (linkAttr !== undefined) {
            navCall = `__router.navigateByUrl(${JSON.stringify(linkAttr)})`;
          } else if (linkBinding) {
            let isArrayForm = false;
            try { isArrayForm = parseExpression(linkBinding.expression).type === 'array'; } catch { /* raw fallback: treated as a URL */ }
            navCall = isArrayForm
              ? `__router.navigate(${codeExpr(linkBinding.expression)})`
              : `__router.navigateByUrl(${codeExpr(linkBinding.expression)})`;
          }
        } else if (!opts.entry) {
          diagnostics.push(warning(
            'GEN_ROUTES_MISSING',
            'routerLink appears in a child component template, but no routes file was resolved for this compilation',
            el.pos.line, el.pos.column,
            "Create app.routes.ts next to the root component: export const routes: Routes = [{ path: 'home', component: HomeComponent }];",
          ));
        }
      }

      // Badge (Stage 11): matBadge as an attribute. <button> and <row>
      // are hosts (the third host, <icon>, is handled in renderIcon);
      // on them the generic attribute and binding loops below emit
      // badge as a prop untouched, and the primitives draw the dot.
      // On any other element the badge has nowhere to sit: warn
      // GEN_BADGE_HOST and strip it from both loops so no stray badge
      // prop reaches the output.
      const badgeUsed = el.attrs['badge'] !== undefined
        || el.propBindings.some((b) => b.name === 'badge');
      const badgeHost = el.tag.toLowerCase() === 'button' || el.tag.toLowerCase() === 'row';
      const dropBadge = badgeUsed && !badgeHost;
      if (dropBadge) {
        diagnostics.push(warning(
          'GEN_BADGE_HOST',
          `badge on <${el.tag}> cannot render; badges sit on <button>, <row> and <icon> in this version, so the badge was dropped`,
          el.pos.line, el.pos.column,
          'Move the badge to a button, row or icon: <button badge="3">Inbox</button>, or bind it: <row [badge]="unread"></row>',
        ));
      }

      // Attribute directives (Stage 12): a directive's attribute and
      // its input attributes are consumed by the directive (they feed
      // the merged style below), never emitted as host props. On a
      // child component tag there is no host element to style, so a
      // directive there warns DIR_UNSUPPORTED and applies nothing.
      const consumedByDirective = directiveConsumedNames(el);
      if (childInfo && consumedByDirective.size) {
        for (const d of directivesOn(el)) {
          diagnostics.push(warning(
            'DIR_UNSUPPORTED',
            `Directive [${d.attr}] sits on the component tag <${el.tag}>; attribute directives style plain host elements in this version, so it applied no styles`,
            el.pos.line, el.pos.column,
            `Move [${d.attr}] onto a plain element inside the component's template (a <p>, <div>, <span> or <card>), or style the component through its @Input props`,
          ));
        }
      }

      const props: string[] = [...extraProps];
      if (mapping?.variant) props.push(`variant="${mapping.variant}"`);
      const isFormEl = el.tag.toLowerCase() === 'form';
      const isButtonEl = el.tag.toLowerCase() === 'button';
      for (const [name, value] of Object.entries(el.attrs)) {
        if (name === 'class') continue;
        if (name === 'routerLink') continue;
        if (consumedByDirective.has(name)) continue;
        if (name === 'badge' && dropBadge) continue;
        // A button's type is forms machinery (Stage 8): type="submit"
        // is consumed by the submit rewrite below, never a prop.
        if (isButtonEl && name === 'type') continue;
        props.push(`${name}="${escapeJsxAttrValue(value)}"`);
      }
      for (const b of el.booleanAttrs) {
        if (consumedByDirective.has(b)) continue;
        props.push(b);
      }
      for (const p of el.propBindings) {
        // [formGroup] is the reactive binding mechanism, not a View prop.
        if (isFormEl && p.name === 'formGroup') continue;
        if (p.name === 'routerLink') continue;
        if (consumedByDirective.has(p.name)) continue;
        if (p.name === 'badge' && dropBadge) continue;
        props.push(`${p.name}={${codeExpr(p.expression)}}`);
      }
      // Form submit (Stage 8): a <button type="submit"> statically
      // nested in a form with a (submit) handler calls that handler
      // directly (there is no DOM form to submit in React Native). A
      // submit attempt first marks every ngModel input in the form
      // touched, so validation errors appear on save, the standard UX.
      let submitPress: string | undefined;
      if (isButtonEl && el.attrs['type'] === 'submit' && formCtx?.submit
        && !el.eventBindings.some((b) => b.name === 'click')) {
        const src = formCtx.submit.expression.trim();
        let bare = false;
        try { bare = parseExpression(src).type === 'identifier'; } catch { /* raw fallback */ }
        const call = bare ? `${src}()` : codeExpr(formCtx.submit.expression);
        const parts = [
          ...formCtx.touchedKeys.map((k) => `${setterName(`${k}Touched`)}(true)`),
          ...(formCtx.groupField
            ? [`${formCtx.groupField}Ref.current.markAllAsTouched()`, 'setFormVersion((v) => v + 1)']
            : []),
          call,
        ];
        submitPress = parts.length === 1
          ? `() => ${call}`
          : `${formCtx.submit.expression.includes('$event') ? '($event)' : '()'} => { ${parts.join('; ')}; }`;
      }
      // Event bindings (M3): (click) -> onPress={() => handler()} etc.
      // On a child component, an event named after one of its @Output fields
      // becomes that output's callback prop instead (M5).
      let navComposed = false;
      for (const ev of el.eventBindings) {
        // A form's own (submit)/(ngSubmit) is consumed by the rewrite
        // above; it is not a prop on the generated View.
        if (isFormEl && (ev.name === 'submit' || ev.name === 'ngSubmit')) continue;
        // Assignment handlers (Stage 10) are dropped with a warning:
        // the expression grammar has no assignment operator, and the
        // raw fallback used to emit an assignment against a const.
        if (isAssignmentBinding(el, ev)) {
          lines.push(`${indent}{/* TODO(Rangular): (${ev.name}) assignment handler dropped, see GEN_EVENT_ASSIGNMENT */}`);
          continue;
        }
        const src = ev.expression.trim();
        let isBareRef = false;
        try { isBareRef = parseExpression(src).type === 'identifier'; } catch { /* raw fallback below */ }
        if (childInfo && childInfo.fields.some((f) => f.isOutput && f.name === ev.name)) {
          const cb = outputPropName(ev.name);
          props.push(isBareRef ? `${cb}={${src}}` : `${cb}={($event) => ${codeExpr(src)}}`);
          continue;
        }
        const controlTag = ['switch', 'checkbox', 'switcher', 'radio-group', 'tabs'].includes(el.tag.toLowerCase());
        if (controlTag && ev.name === 'change') {
          // Controls emit their next value as $event (Stage 6). Unlike
          // the generic event path, the generated wrapper must receive
          // that value and pass it to the Angular style handler call.
          // Tabs joined the contract in Stage 11: (change) emits the
          // newly selected tab index.
          props.push(isBareRef ? `onChange={${src}}` : `onChange={($event) => ${codeExpr(src)}}`);
          continue;
        }
        if (el.tag.toLowerCase() === 'panel' && ev.name === 'toggle') {
          // Panels emit their next open state as $event (Stage 11),
          // the same control pattern as (change) above.
          props.push(isBareRef ? `onToggle={${src}}` : `onToggle={($event) => ${codeExpr(src)}}`);
          continue;
        }
        if (ev.name === 'click' && navCall) {
          // A tap that both handles and navigates (Stage 9): the
          // handler runs first, then the navigation, one onPress.
          props.push(isBareRef
            ? `onPress={() => { ${src}(); ${navCall}; }}`
            : `onPress={() => { ${codeExpr(src)}; ${navCall}; }}`);
          navComposed = true;
          continue;
        }
        const { prop, known } = eventPropName(ev.name, el.tag);
        if (!known) {
          lines.push(`${indent}{/* (${ev.name}) has no standard RN prop, mapped to ${prop} */}`);
        }
        props.push(isBareRef ? `${prop}={${src}}` : `${prop}={() => ${codeExpr(src)}}`);
      }
      if (submitPress) props.push(`onPress={${submitPress}}`);
      // A link with no (click) of its own navigates on tap (Stage 9).
      // A submit button keeps its submit onPress; the link is dropped
      // there, a form submit and a navigation are two different intents.
      if (navCall && !navComposed && !submitPress) {
        props.push(`onPress={() => ${navCall}}`);
      }
      const style = styleFor(el);
      // Directive styles merge after the element's own style, so a
      // directive wins over the class style for the same property,
      // the way a directive's inline style beats a stylesheet rule.
      const dirStyle = childInfo ? undefined : directiveStyleCode(el);
      if (style && dirStyle) props.push(`style={[${style}, ${dirStyle}]}`);
      else if (dirStyle) props.push(`style={${dirStyle}}`);
      else if (style) props.push(`style={${style}}`);
      if (el.ref) props.push(`ref={${el.ref}Ref}`);

      const open = `${indent}<${componentName}${props.length ? ' ' + props.join(' ') : ''}`;
      const childLines: string[] = [];
      // The form context flows to descendants (submit buttons and
      // reactive inputs find their form); it stops at child components,
      // whose templates render as their own units.
      const childForm = isFormEl ? formInfos.get(el) : formCtx;
      for (const child of el.children) {
        if (child.type === 'text') childLines.push(renderText(child, ''));
        else childLines.push(...renderElement(child, depth + 1, childForm));
      }
      if (!childLines.length) {
        lines.push(`${open} />`);
        return lines;
      }
      // Text-only children stay on one line, JSX-style.
      if (el.children.every((c) => c.type === 'text')) {
        const inner = el.children
          .map((c) => renderText(c as TemplateNode & { type: 'text' }, '').trim())
          .join(' ');
        lines.push(`${open}>${inner}</${componentName}>`);
        return lines;
      }
      lines.push(`${open}>`);
      for (const cl of childLines) lines.push(cl);
      lines.push(`${indent}</${componentName}>`);
      return lines;
    };

    /** Render an element, applying *ngIf / *ngFor wrapping when present (M4). */
    const renderElementInner = (el: ElementNode, depth: number, formCtx?: FormInfo): string[] => {
      const indent = '  '.repeat(depth + 2);
      if (!el.structural) return renderCore(el, depth, [], formCtx);
      const stripped: ElementNode = { ...el, structural: undefined };

      if (el.structural.name === 'ngIf') {
        const parts = parseNgIf(el.structural.expression);
        if (parts.elseRef || parts.thenRef) {
          diagnostics.push(warning(
            'GEN_NGIF_ELSE_TODO',
            `*ngIf with 'else'/'then' microsyntax is not generated yet, element emitted unconditionally`,
            el.pos.line, el.pos.column,
            'Split it into two elements: one with *ngIf="cond" and a second with *ngIf="!(cond)"',
          ));
          return [
            `${indent}{/* TODO(M5+): *ngIf else/then, "${forBlockComment(el.structural.expression)}" */}`,
            ...renderCore(stripped, depth, [], formCtx),
          ];
        }
        const inner = renderCore(stripped, depth + 1, [], formCtx);
        return [
          `${indent}{${codeExpr(parts.condition)} && (`,
          ...inner,
          `${indent})}`,
        ];
      }

      if (el.structural.name === 'ngFor') {
        const { parts, diagnostics: forDiags } = parseNgFor(el.structural.expression, el.pos.line, el.pos.column);
        diagnostics.push(...forDiags);
        if (!parts) {
          return [
            `${indent}{/* TODO: unparseable *ngFor="${forBlockComment(el.structural.expression)}", element emitted once */}`,
            ...renderCore(stripped, depth, [], formCtx),
          ];
        }
        const indexName = parts.indexVar ?? 'index';
        const keyExpr = parts.trackBy
          ? `${parts.trackBy}(${parts.itemVar})`
          : `${parts.itemVar}?.id ?? ${indexName}`;
        const inner = renderCore(stripped, depth + 1, [`key={${keyExpr}}`], formCtx);
        return [
          `${indent}{${codeExpr(parts.source)}.map((${parts.itemVar}, ${indexName}) => (`,
          ...inner,
          `${indent}))}`,
        ];
      }

      diagnostics.push(warning(
        'GEN_STRUCTURAL_TODO',
        `*${el.structural.name} is not supported yet, element emitted unconditionally`,
        el.pos.line, el.pos.column,
        'Only *ngIf and *ngFor are supported, rewrite the element with one of those',
      ));
      return [
        `${indent}{/* TODO: *${el.structural.name}="${forBlockComment(el.structural.expression)}" */}`,
        ...renderCore(stripped, depth, [], formCtx),
      ];
    };

    /**
     * Source map wrapper (Stage 5): with a map requested, every element's
     * lines are preceded by a marker comment that finishSourceMap turns
     * into a segment and removes. Without a map this is a pass-through,
     * so default output is byte identical to before.
     */
    const renderElement = (el: ElementNode, depth: number, formCtx?: FormInfo): string[] => {
      const lines = renderElementInner(el, depth, formCtx);
      if (!this.smConfig || !opts.templateFile) return lines;
      const id = this.smRecords.length;
      this.smRecords.push({ templateFile: opts.templateFile, el });
      const indent = '  '.repeat(depth + 2);
      return [`${indent}{/*@sm:${id}@*/}`, ...lines];
    };

    const bodyLines: string[] = [];
    for (const node of ast.children) {
      if (node.type === 'text') {
        this.usedRn.add('Text');
        bodyLines.push(`      <Text>${renderText(node, '').trim()}</Text>`);
      } else {
        bodyLines.push(...renderElement(node, 0));
      }
    }

    const fnName = componentFunctionName(component.className);
    const inputs = component.fields.filter((f) => f.isInput);
    const outputs = component.fields.filter((f) => f.isOutput);
    // Content projection (Stage 12): a template that places
    // <ng-content> receives the host's children as the React children
    // prop; without one the generated signature stays exactly as before.
    const usesProjection = ((): boolean => {
      let found = false;
      const walk = (nodes: TemplateNode[]): void => {
        for (const n of nodes) {
          if (n.type !== 'element') continue;
          if (n.tag.toLowerCase() === 'ng-content') found = true;
          walk(n.children);
        }
      };
      walk(ast.children);
      return found;
    })();
    // Routing (Stage 9): a component injecting ActivatedRoute receives
    // its instance through a compiler-owned prop, __rgRoute, which the
    // outlet supplies per mount. It is not an @Input and never appears
    // in author templates.
    const injectsRoute = this.routingActive
      && (component.constructorDeps ?? []).some((d) => d.typeName === 'ActivatedRoute');
    let propsDecl = '';
    if (inputs.length || outputs.length || injectsRoute || usesProjection) {
      const destructured: string[] = [];
      const types: string[] = [];
      if (usesProjection) {
        destructured.push('children');
        types.push('children?: any');
      }
      for (const f of inputs) {
        const def = f.initializer && isLiteralInitializer(f.initializer) ? ` = ${f.initializer}` : '';
        destructured.push(`${f.name}${def}`);
        types.push(`${f.name}?: any`);
      }
      for (const f of outputs) {
        destructured.push(outputPropName(f.name));
        types.push(`${outputPropName(f.name)}?: (value: any) => void`);
      }
      if (injectsRoute) {
        destructured.push('__rgRoute');
        types.push('__rgRoute?: any');
      }
      propsDecl = `{ ${destructured.join(', ')} }: { ${types.join('; ')} }`;
    }

    // --- Dependency injection (M6): constructor deps -> container lookups.
    const depLines: string[] = [];
    for (const dep of component.constructorDeps ?? []) {
      if (dep.typeName === HTTP_CLIENT) {
        this.usedRuntime.add('Container');
        this.usedRuntime.add(HTTP_CLIENT);
        depLines.push(`  const ${dep.propertyName} = __container.get<HttpClient>(HttpClient);`);
      } else if (this.routingActive && dep.typeName === 'Router') {
        depLines.push(`  const ${dep.propertyName} = __router;`);
      } else if (this.routingActive && dep.typeName === 'ActivatedRoute') {
        depLines.push(`  const ${dep.propertyName} = __rgRoute;`);
      } else if (dep.typeName === 'SnackBar') {
        depLines.push(`  const ${dep.propertyName} = __snackBar;`);
      } else if (this.rootServices.has(dep.typeName)) {
        this.usedRuntime.add('Container');
        this.reactImports.add('useSyncExternalStore');
        depLines.push(`  const ${dep.propertyName} = __container.get<${dep.typeName}>(${dep.typeName});`);
        depLines.push(`  useSyncExternalStore((cb) => ${dep.propertyName}.__subscribe(cb), () => ${dep.propertyName}.__getVersion());`);
      } else {
        this.validateDeps(`Component ${component.className}`, [dep], true);
        depLines.push(`  // TODO(Rangular DI): no provider for '${forLineComment(dep.typeName)}', '${forLineComment(dep.propertyName)}' is unavailable.`);
      }
    }

    // --- Fields: state hoisting (M3) ------------------------------------------
    // A non-literal initializer that is never assigned and does not
    // reference `this` is emitted verbatim as a plain const (proof
    // fix): `today = new Date()` becomes `const today = new Date();`.
    // Anything else non-literal still cannot be placed, but it is
    // ALWAYS declared, as undefined with a TODO, so generated code
    // never references a name it does not declare.
    const verbatimInits = new Map(verbatimInitFields(component).map((f) => [f.name, f.initializer]));
    const fieldLines: string[] = [];
    for (const field of component.fields) {
      if (field.isInput || field.isOutput) continue;
      if (formFields.has(field.name)) continue; // Stage 8: a ref below, not state.
      if (field.initializer && isLiteralInitializer(field.initializer)) {
        if (stateFields.has(field.name)) {
          fieldLines.push(`  const [${field.name}, ${setterName(field.name)}] = useState(${field.initializer});`);
        } else {
          fieldLines.push(`  const ${field.name} = ${field.initializer};`);
        }
      } else if (field.initializer && verbatimInits.has(field.name)) {
        fieldLines.push(`  const ${field.name} = ${verbatimInits.get(field.name)};`);
      } else if (field.initializer) {
        fieldLines.push(`  // TODO: field '${forLineComment(field.name)}' has a non-literal initializer (${forLineComment(field.initializer)}) that cannot be emitted verbatim; it is declared as undefined so this file still compiles, wire the value up manually for now.`);
        fieldLines.push(`  const ${field.name} = undefined;`);
        diagnostics.push(warning('GEN_FIELD', `Field '${field.name}' has a non-literal initializer that cannot be emitted verbatim (it references 'this', or the field is assigned in a method); it is declared as undefined in the generated component`, undefined, undefined, `Initialise '${field.name}' with a literal (including arrays/objects of literals), or with a value that does not reference 'this' (for example new Date() or Date.now()), or wire the value up manually in the generated component`));
      }
    }

    // --- Reactive form instances (Stage 8) -----------------------------------
    // A FormGroup/FormControl field is one stable instance per component
    // instance, held in a ref with its initializer verbatim (the author's
    // own @angular/forms code, re-homed to the runtime classes). Control
    // value changes bump a version counter through valueChanges, so the
    // component re-renders and template reads like
    // profileForm.get('email').invalid stay live, the same notify shape
    // services use.
    const formLines: string[] = [];
    if (formFields.size) {
      this.reactImports.add('useRef');
      this.reactImports.add('useState');
      this.reactImports.add('useEffect');
      for (const field of component.fields) {
        if (!formFields.has(field.name)) continue;
        formLines.push(`  const ${field.name}Ref = useRef(${field.initializer});`);
      }
      const formTexts: string[] = [];
      for (const field of component.fields) {
        if (formFields.has(field.name) && field.initializer) formTexts.push(field.initializer);
      }
      for (const m of component.methodDetails) if (m.body) formTexts.push(m.body);
      for (const name of ['FormGroup', 'FormControl', 'Validators']) {
        if (formTexts.some((t) => new RegExp(`\\b${name}\\b`).test(t))) this.usedRuntime.add(name);
      }
      formLines.push('  const [, setFormVersion] = useState(0);');
      formLines.push('  useEffect(() => {');
      formLines.push('    const subs = [');
      for (const field of component.fields) {
        const info = formFields.get(field.name);
        if (!info) continue;
        if (info.kind === 'group') {
          formLines.push(`      ...Object.values(${field.name}Ref.current.controls).map((control) => control.valueChanges.subscribe(() => setFormVersion((v) => v + 1))),`);
        } else {
          formLines.push(`      ${field.name}Ref.current.valueChanges.subscribe(() => setFormVersion((v) => v + 1)),`);
        }
      }
      formLines.push('    ];');
      formLines.push('    return () => { subs.forEach((sub) => sub.unsubscribe()); };');
      formLines.push('  }, []);');
    }

    // --- Template-driven validation models (Stage 8) -------------------------
    // One model per ngModel input that declares validators or an
    // #ref="ngModel": a touched state plus an errors object recomputed
    // from the field on every render by the runtime validators. The
    // model is what a template reference reads (email.invalid,
    // email.touched, email.errors), via the chain-root rewrite in
    // exprToCode.
    const modelLines: string[] = [];
    for (const info of modelInfos) {
      const key = info.key!;
      const field = info.field!;
      this.reactImports.add('useState');
      modelLines.push(`  const [${key}Touched, ${setterName(`${key}Touched`)}] = useState(false);`);
      const validSpecs = info.validators.filter((v) => !v.argInvalid);
      for (const v of info.validators) {
        if (!v.argInvalid) continue;
        diagnostics.push(warning(
          'GEN_VALIDATOR_ARG',
          `The ${v.fn} validator on the '${field}' input has a static attribute value that is not a plain number; the validator was dropped (static attribute text is never emitted into generated code)`,
          undefined, undefined,
          `Write the length as a plain number, e.g. minlength="3", or bind it: [minlength]="3"`,
        ));
      }
      if (validSpecs.length) {
        this.usedRuntime.add('Validators');
        this.usedRuntime.add('validateValue');
        const calls = validSpecs
          .map((v) => (v.argSource !== undefined ? `Validators.${v.fn}(${v.argSource})` : `Validators.${v.fn}`))
          .join(', ');
        modelLines.push(`  const ${key}Errors = validateValue(${field}, [${calls}]);`);
      } else {
        modelLines.push(`  const ${key}Errors = null;`);
      }
      modelLines.push(`  const ${key}Model = { value: ${field}, errors: ${key}Errors, valid: ${key}Errors === null, invalid: ${key}Errors !== null, touched: ${key}Touched };`);
    }

    // --- Methods: translation (M3) --------------------------------------------
    const outputCallbacks = new Map<string, string>();
    for (const f of outputs) outputCallbacks.set(f.name, outputPropName(f.name));
    const { methods: translated, diagnostics: methodDiags } = translateMethods(component, 'react', stateFields, {
      outputCallbacks,
      formFields: new Set(formFields.keys()),
    });
    diagnostics.push(...methodDiags);
    const methodLines: string[] = [];
    for (const m of translated) {
      methodLines.push(`  const ${m.name} = (${m.paramTexts.join(', ')}) => {`);
      for (const line of m.lines) methodLines.push(line ? `    ${line}` : line);
      methodLines.push('  };');
    }

    // --- Lifecycle (M6): ngOnInit / ngOnDestroy -> useEffect ----------------
    const lifecycleLines: string[] = [];
    const translatedNames = new Set(translated.map((m) => m.name));
    const hasInit = translatedNames.has('ngOnInit');
    const hasDestroy = translatedNames.has('ngOnDestroy');
    if (hasInit || hasDestroy) {
      this.reactImports.add('useEffect');
      lifecycleLines.push('  useEffect(() => {');
      if (hasInit) lifecycleLines.push('    ngOnInit();');
      if (hasDestroy) {
        lifecycleLines.push('    return () => {');
        lifecycleLines.push('      ngOnDestroy();');
        lifecycleLines.push('    };');
      }
      lifecycleLines.push('  }, []);');
    }

    // Snackbar host (Stage 10): only the entry component renders it,
    // as the last sibling inside the returned tree, so an app with a
    // snackbar always returns a fragment even for a single root.
    if (opts.entry && this.snackActive) {
      this.usedUi.add('RgSnackbar');
      bodyLines.push('    {__snack && (<RgSnackbar message={__snack.message} actionLabel={__snack.actionLabel} onAction={() => __snackBar.pressAction()} />)}');
    }

    // A template whose root is a structural directive (or several roots)
    // cannot be returned bare, `{cond && (...)}` alone is not valid JSX,
    // so it is wrapped in a fragment. A single plain element root (the
    // common <screen> shape) is returned as-is, exactly as in Stage 2.
    const only = ast.children.length === 1 ? ast.children[0] : undefined;
    const bareRoot = !!only && (only.type === 'text' || !only.structural) && !(opts.entry && this.snackActive);
    const returnLines = bareRoot
      ? ['  return (', ...bodyLines, '  );']
      : [
          '  return (',
          '    <>',
          ...bodyLines.map((l) => (l ? `  ${l}` : l)),
          '    </>',
          '  );',
        ];

    // --- Navigation state (Stage 9) ------------------------------------------
    // The entry component hosting the outlet mirrors the navigator's
    // current entry in state, so a navigation re-renders it and the
    // outlet swaps the route component. The subscription is the
    // useEffect cleanup, the same shape lifecycle uses.
    const navLines: string[] = [];
    if (opts.entry && opts.hasOutlet && this.routingActive) {
      this.reactImports.add('useState');
      this.reactImports.add('useEffect');
      navLines.push('  const [__route, __setRoute] = useState(__navigator.current);');
      navLines.push('  useEffect(() => __navigator.subscribe(() => __setRoute(__navigator.current)), []);');
    }

    // Snackbar state (Stage 10): the entry component mirrors the
    // module-level service's current bar in React state. The service
    // owns timing and action callbacks; this bridge only renders the
    // host while a bar is open.
    const snackLines: string[] = [];
    if (opts.entry && this.snackActive) {
      this.reactImports.add('useState');
      this.reactImports.add('useEffect');
      snackLines.push('  const [__snack, __setSnack] = useState(__snackBar.current);');
      snackLines.push('  useEffect(() => __snackBar.subscribe(() => __setSnack(__snackBar.current)), []);');
    }

    const exportKw = opts.entry ? 'export default function' : 'export function';
    return [
      `${exportKw} ${fnName}(${propsDecl}) {`,
      ...depLines,
      ...navLines,
      ...snackLines,
      ...fieldLines,
      ...formLines,
      ...modelLines,
      ...asyncLines,
      ...methodLines,
      ...lifecycleLines,
      ...returnLines,
      '}',
    ];
  }
}

function stylePrefixOf(info: ComponentInfo): string {
  const fn = componentFunctionName(info.className);
  return fn.charAt(0).toLowerCase() + fn.slice(1);
}

/** StyleSheet key for a component's CSS rule, namespaced per child component. */
function styleKeyFor(prefix: string, key: string): string {
  const base = styleKeyName(key);
  if (!prefix) return base;
  return prefix + base.charAt(0).toUpperCase() + base.slice(1);
}

/**
 * Generate a React Native .tsx from a parsed component, its template AST
 * and its parsed styles. Stage 3: the optional context carries the child
 * components and services resolved through the entry's imports, everything
 * is emitted into the same file (see the Generator note above).
 */
export function generateComponent(
  component: ComponentInfo,
  ast: TemplateRoot,
  css: ParsedCss,
  context: GenerateContext = {},
): GenerateResult {
  const generator = new Generator(context);
  const children = context.children ?? [];
  const code = generator.generate(component, ast, css, children);
  return { code, diagnostics: generator.diagnostics, sourceMap: generator.sourceMapOut };
}
