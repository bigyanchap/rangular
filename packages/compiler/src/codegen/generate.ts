import { ICON_NAMES, ICON_PATHS, ICON_SIZES, DEFAULT_ICON_SIZE } from '../../../ui/src/icons';
import { ComponentInfo, ServiceInfo } from '../class/parseComponent';
import { analyzeFormInitializer, FormFieldInfo, isFormInitializer } from '../class/formInit';
import { Diagnostic, error, warning } from '../diagnostics';
import { nearestOnScale, ParsedCss } from '../style/css';
import { ElementNode, EventBinding, TemplateNode, TemplateRoot } from '../template/ast';
import { exprToCode, parseExpression } from '../template/expr';
import {
  hasNgModelSurface,
  ngModelBindingOf,
  plainFieldOf,
  ValidatorSpec,
  validatorsOf,
} from '../template/forms';
import { isLiteralSource } from '../template/literal';
import { parseNgFor, parseNgIf } from '../template/structural';
import { analyzeMutatedFields, setterName, translateMethods } from './methods';
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
  p: { component: 'Text', fromUi: false, variant: 'body' },
  label: { component: 'Text', fromUi: false, variant: 'label' },
  h1: { component: 'Text', fromUi: false, variant: 'display' },
  h2: { component: 'Text', fromUi: false, variant: 'heading' },
  h3: { component: 'Text', fromUi: false, variant: 'title' },
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
};

/** True when an initializer source text is a plain literal we may hoist. */
export function isLiteralInitializer(init: string): boolean {
  return isLiteralSource(init);
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
  private rootServices = new Map<string, ServiceInfo>();
  private allServices: ServiceInfo[] = [];
  private styles: StyleEntry[] = [];
  /** Source map bookkeeping (Stage 5): element records keyed by marker id. */
  private smConfig?: GenerateContext['sourceMap'];
  private smRecords: { templateFile: string; el: ElementNode }[] = [];
  private smUnits: UnitSourceInfo[] = [];

  constructor(context: GenerateContext) {
    this.smConfig = context.sourceMap;
    for (const child of context.children ?? []) {
      if (child.info.selector) this.childBySelector.set(child.info.selector, child.info);
    }
    this.allServices = context.services ?? [];
    for (const svc of this.allServices) {
      if (svc.providedInRoot) this.rootServices.set(svc.className, svc);
    }
  }

  generate(entry: ComponentInfo, ast: TemplateRoot, css: ParsedCss, children: ChildUnitInput[]): string {
    const serviceBlocks: string[][] = [];
    for (const svc of this.allServices) {
      if (!svc.providedInRoot) continue;
      serviceBlocks.push(this.generateService(svc));
    }
    const registrations = this.registrationLines(entry, children);

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
    if (registrations.length) lines.push(...registrations, '');
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

  private validateDeps(owner: string, deps: { propertyName: string; typeName: string }[]): void {
    for (const dep of deps) {
      if (dep.typeName === HTTP_CLIENT || this.rootServices.has(dep.typeName)) continue;
      this.diagnostics.push(error(
        'DI_UNKNOWN_TOKEN',
        `${owner}: no provider for '${dep.typeName}' (injected as '${dep.propertyName}'), it is not an @Injectable({ providedIn: 'root' }) service in this compilation and not HttpClient`,
        undefined, undefined,
        `Make '${dep.typeName}' an @Injectable({ providedIn: 'root' }) class and import it from the component file (imports are followed transitively), or inject HttpClient`,
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
    opts: { entry: boolean; stylePrefix: string; order: number; tsFile?: string; templateFile?: string },
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
        validateControlNesting(node.children, tag);
      }
    };
    validateControlNesting(ast.children);

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
    const codeExpr = (source: string): string => {
      const code = exprToCode(source, { renames: identRenames, refBases });
      if (code.includes("pipe('")) this.usedRuntime.add('pipe');
      return code;
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

      const consumedEvents = new Set(['input', 'change', 'blur', 'ngModelChange']);
      for (const ev of el.eventBindings) {
        if (ev.name === 'ngModelChange' && info?.mode !== 'reactive') {
          textCalls.push(callOf(ev.expression));
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

      const consumedProps = new Set(['ngModel', 'ngModelOptions', 'formControlName']);
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

    /** Render one element without its structural directive (handled by renderElement). */
    const renderCore = (el: ElementNode, depth: number, extraProps: string[], formCtx?: FormInfo): string[] => {
      if (el.tag.toLowerCase() === 'icon') return renderIcon(el, depth, extraProps);
      if (el.tag.toLowerCase() === 'input') return renderInput(el, depth, extraProps);
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
          'Known blocks: screen, appbar, card, list, row, fab, button, input, form, switch, switcher, checkbox, radio-group, h1, h2, h3, p, span, label, div, section, header, or use a Capitalised component tag',
        ));
        componentName = 'View';
        this.usedRn.add('View');
      }

      const props: string[] = [...extraProps];
      if (mapping?.variant) props.push(`variant="${mapping.variant}"`);
      const isFormEl = el.tag.toLowerCase() === 'form';
      const isButtonEl = el.tag.toLowerCase() === 'button';
      for (const [name, value] of Object.entries(el.attrs)) {
        if (name === 'class') continue;
        // A button's type is forms machinery (Stage 8): type="submit"
        // is consumed by the submit rewrite below, never a prop.
        if (isButtonEl && name === 'type') continue;
        props.push(`${name}="${escapeJsxAttrValue(value)}"`);
      }
      for (const b of el.booleanAttrs) props.push(b);
      for (const p of el.propBindings) {
        // [formGroup] is the reactive binding mechanism, not a View prop.
        if (isFormEl && p.name === 'formGroup') continue;
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
      for (const ev of el.eventBindings) {
        // A form's own (submit)/(ngSubmit) is consumed by the rewrite
        // above; it is not a prop on the generated View.
        if (isFormEl && (ev.name === 'submit' || ev.name === 'ngSubmit')) continue;
        const src = ev.expression.trim();
        let isBareRef = false;
        try { isBareRef = parseExpression(src).type === 'identifier'; } catch { /* raw fallback below */ }
        if (childInfo && childInfo.fields.some((f) => f.isOutput && f.name === ev.name)) {
          const cb = outputPropName(ev.name);
          props.push(isBareRef ? `${cb}={${src}}` : `${cb}={($event) => ${codeExpr(src)}}`);
          continue;
        }
        const controlTag = ['switch', 'checkbox', 'switcher', 'radio-group'].includes(el.tag.toLowerCase());
        if (controlTag && ev.name === 'change') {
          // Controls emit their next value as $event (Stage 6). Unlike
          // the generic event path, the generated wrapper must receive
          // that value and pass it to the Angular style handler call.
          props.push(isBareRef ? `onChange={${src}}` : `onChange={($event) => ${codeExpr(src)}}`);
          continue;
        }
        const { prop, known } = eventPropName(ev.name, el.tag);
        if (!known) {
          lines.push(`${indent}{/* (${ev.name}) has no standard RN prop, mapped to ${prop} */}`);
        }
        props.push(isBareRef ? `${prop}={${src}}` : `${prop}={() => ${codeExpr(src)}}`);
      }
      if (submitPress) props.push(`onPress={${submitPress}}`);
      const style = styleFor(el);
      if (style) props.push(`style={${style}}`);
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
    let propsDecl = '';
    if (inputs.length || outputs.length) {
      const destructured: string[] = [];
      const types: string[] = [];
      for (const f of inputs) {
        const def = f.initializer && isLiteralInitializer(f.initializer) ? ` = ${f.initializer}` : '';
        destructured.push(`${f.name}${def}`);
        types.push(`${f.name}?: any`);
      }
      for (const f of outputs) {
        destructured.push(outputPropName(f.name));
        types.push(`${outputPropName(f.name)}?: (value: any) => void`);
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
      } else if (this.rootServices.has(dep.typeName)) {
        this.usedRuntime.add('Container');
        this.reactImports.add('useSyncExternalStore');
        depLines.push(`  const ${dep.propertyName} = __container.get<${dep.typeName}>(${dep.typeName});`);
        depLines.push(`  useSyncExternalStore((cb) => ${dep.propertyName}.__subscribe(cb), () => ${dep.propertyName}.__getVersion());`);
      } else {
        this.validateDeps(`Component ${component.className}`, [dep]);
        depLines.push(`  // TODO(Rangular DI): no provider for '${forLineComment(dep.typeName)}', '${forLineComment(dep.propertyName)}' is unavailable.`);
      }
    }

    // --- Fields: state hoisting (M3) ------------------------------------------
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
      } else if (field.initializer) {
        fieldLines.push(`  // TODO: field '${forLineComment(field.name)}' has a non-literal initializer (${forLineComment(field.initializer)}), not hoisted; wire it up manually for now.`);
        diagnostics.push(warning('GEN_FIELD', `Field '${field.name}' has a non-literal initializer; not hoisted`, undefined, undefined, `Initialise '${field.name}' with a literal (including arrays/objects of literals) or wire the value up manually in the generated component`));
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
      if (info.validators.length) {
        this.usedRuntime.add('Validators');
        this.usedRuntime.add('validateValue');
        const calls = info.validators
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

    // A template whose root is a structural directive (or several roots)
    // cannot be returned bare, `{cond && (...)}` alone is not valid JSX,
    // so it is wrapped in a fragment. A single plain element root (the
    // common <screen> shape) is returned as-is, exactly as in Stage 2.
    const only = ast.children.length === 1 ? ast.children[0] : undefined;
    const bareRoot = !!only && (only.type === 'text' || !only.structural);
    const returnLines = bareRoot
      ? ['  return (', ...bodyLines, '  );']
      : [
          '  return (',
          '    <>',
          ...bodyLines.map((l) => (l ? `  ${l}` : l)),
          '    </>',
          '  );',
        ];

    const exportKw = opts.entry ? 'export default function' : 'export function';
    return [
      `${exportKw} ${fnName}(${propsDecl}) {`,
      ...depLines,
      ...fieldLines,
      ...formLines,
      ...modelLines,
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
