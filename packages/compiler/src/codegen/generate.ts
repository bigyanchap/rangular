import { ComponentInfo, ServiceInfo } from '../class/parseComponent';
import { Diagnostic, error, warning } from '../diagnostics';
import { ParsedCss } from '../style/css';
import { ElementNode, TemplateNode, TemplateRoot } from '../template/ast';
import { exprToCode, parseExpression } from '../template/expr';
import { isLiteralSource } from '../template/literal';
import { parseNgFor, parseNgIf } from '../template/structural';
import { analyzeMutatedFields, setterName, translateMethods } from './methods';

export interface GenerateResult {
  code: string;
  diagnostics: Diagnostic[];
}

/** A child component taking part in this compilation (Stage 3, M5). */
export interface ChildUnitInput {
  info: ComponentInfo;
  ast: TemplateRoot;
  css: ParsedCss;
}

export interface GenerateContext {
  /** Every other @Component class resolved through imports, keyed by selector in codegen. */
  children?: ChildUnitInput[];
  /** Every @Injectable class resolved through imports (Stage 3, M6). */
  services?: ServiceInfo[];
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
  input: { component: 'TextInput', fromUi: false },
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

/** Template (event) name -> React Native prop name, for known events. */
export const EVENT_PROPS: Record<string, string> = {
  click: 'onPress',
  change: 'onChange',
  submit: 'onSubmit',
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
class Generator {
  diagnostics: Diagnostic[] = [];
  private usedRn = new Set<string>();
  private usedUi = new Set<string>();
  private usedRuntime = new Set<string>();
  private reactImports = new Set<string>();
  private childBySelector = new Map<string, ComponentInfo>();
  private rootServices = new Map<string, ServiceInfo>();
  private allServices: ServiceInfo[] = [];
  private styles: StyleEntry[] = [];

  constructor(context: GenerateContext) {
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
      childBlocks.push(this.generateUnit(child.info, child.ast, child.css, {
        entry: false,
        stylePrefix: stylePrefixOf(child.info),
        order: i,
      }));
    });
    const entryBlock = this.generateUnit(entry, ast, css, { entry: true, stylePrefix: '', order: -1 });

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
      `// Generated by Rangular from ${entry.className} (${entry.selector ?? 'no selector'}). Do not edit by hand.`,
      ...importLines,
      '',
    ];
    for (const block of serviceBlocks) lines.push(...block, '');
    if (registrations.length) lines.push(...registrations, '');
    for (const block of childBlocks) lines.push(...block, '');
    lines.push(...entryBlock, ...styleBlock, '');
    return lines.join('\n');
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
        lines.push(`  // TODO: field '${field.name}' has a non-literal initializer (${field.initializer}), not hoisted; wire it up manually for now.`);
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
    opts: { entry: boolean; stylePrefix: string; order: number },
  ): string[] {
    const diagnostics = this.diagnostics;
    diagnostics.push(...css.diagnostics);

    // --- State analysis (M3) -------------------------------------------------
    const mutated = analyzeMutatedFields(component);
    const stateFields = new Set<string>();
    for (const field of component.fields) {
      if (field.isInput || field.isOutput) continue;
      if (field.initializer && isLiteralInitializer(field.initializer) && mutated.has(field.name)) {
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

    const codeExpr = (source: string): string => {
      const code = exprToCode(source);
      if (code.includes("pipe('")) this.usedRuntime.add('pipe');
      return code;
    };

    const renderText = (node: TemplateNode & { type: 'text' }, indent: string): string => {
      const parts = node.parts.map((p) => {
        if (p.type === 'static') return p.value;
        return `{${codeExpr(p.expression)}}`;
      });
      return indent + parts.join('');
    };

    /** Render one element without its structural directive (handled by renderElement). */
    const renderCore = (el: ElementNode, depth: number, extraProps: string[]): string[] => {
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
          'Known blocks: screen, appbar, card, list, row, fab, button, input, h1, h2, h3, p, span, label, div, section, header, or use a Capitalised component tag',
        ));
        componentName = 'View';
        this.usedRn.add('View');
      }

      const props: string[] = [...extraProps];
      if (mapping?.variant) props.push(`variant="${mapping.variant}"`);
      for (const [name, value] of Object.entries(el.attrs)) {
        if (name === 'class') continue;
        props.push(`${name}="${value}"`);
      }
      for (const b of el.booleanAttrs) props.push(b);
      for (const p of el.propBindings) {
        props.push(`${p.name}={${codeExpr(p.expression)}}`);
      }
      // Event bindings (M3): (click) -> onPress={() => handler()} etc.
      // On a child component, an event named after one of its @Output fields
      // becomes that output's callback prop instead (M5).
      for (const ev of el.eventBindings) {
        const src = ev.expression.trim();
        let isBareRef = false;
        try { isBareRef = parseExpression(src).type === 'identifier'; } catch { /* raw fallback below */ }
        if (childInfo && childInfo.fields.some((f) => f.isOutput && f.name === ev.name)) {
          const cb = outputPropName(ev.name);
          props.push(isBareRef ? `${cb}={${src}}` : `${cb}={($event) => ${codeExpr(src)}}`);
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

      const open = `${indent}<${componentName}${props.length ? ' ' + props.join(' ') : ''}`;
      const childLines: string[] = [];
      for (const child of el.children) {
        if (child.type === 'text') childLines.push(renderText(child, ''));
        else childLines.push(...renderElement(child, depth + 1));
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
    const renderElement = (el: ElementNode, depth: number): string[] => {
      const indent = '  '.repeat(depth + 2);
      if (!el.structural) return renderCore(el, depth, []);
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
            `${indent}{/* TODO(M5+): *ngIf else/then, "${el.structural.expression}" */}`,
            ...renderCore(stripped, depth, []),
          ];
        }
        const inner = renderCore(stripped, depth + 1, []);
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
            `${indent}{/* TODO: unparseable *ngFor="${el.structural.expression}", element emitted once */}`,
            ...renderCore(stripped, depth, []),
          ];
        }
        const indexName = parts.indexVar ?? 'index';
        const keyExpr = parts.trackBy
          ? `${parts.trackBy}(${parts.itemVar})`
          : `${parts.itemVar}?.id ?? ${indexName}`;
        const inner = renderCore(stripped, depth + 1, [`key={${keyExpr}}`]);
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
        `${indent}{/* TODO: *${el.structural.name}="${el.structural.expression}" */}`,
        ...renderCore(stripped, depth, []),
      ];
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
        depLines.push(`  // TODO(Rangular DI): no provider for '${dep.typeName}', '${dep.propertyName}' is unavailable.`);
      }
    }

    // --- Fields: state hoisting (M3) ------------------------------------------
    const fieldLines: string[] = [];
    for (const field of component.fields) {
      if (field.isInput || field.isOutput) continue;
      if (field.initializer && isLiteralInitializer(field.initializer)) {
        if (stateFields.has(field.name)) {
          fieldLines.push(`  const [${field.name}, ${setterName(field.name)}] = useState(${field.initializer});`);
        } else {
          fieldLines.push(`  const ${field.name} = ${field.initializer};`);
        }
      } else if (field.initializer) {
        fieldLines.push(`  // TODO: field '${field.name}' has a non-literal initializer (${field.initializer}), not hoisted; wire it up manually for now.`);
        diagnostics.push(warning('GEN_FIELD', `Field '${field.name}' has a non-literal initializer; not hoisted`, undefined, undefined, `Initialise '${field.name}' with a literal (including arrays/objects of literals) or wire the value up manually in the generated component`));
      }
    }

    // --- Methods: translation (M3) --------------------------------------------
    const outputCallbacks = new Map<string, string>();
    for (const f of outputs) outputCallbacks.set(f.name, outputPropName(f.name));
    const { methods: translated, diagnostics: methodDiags } = translateMethods(component, 'react', stateFields, { outputCallbacks });
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
  return { code, diagnostics: generator.diagnostics };
}
