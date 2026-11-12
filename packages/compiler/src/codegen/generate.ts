import { ComponentInfo } from '../class/parseComponent';
import { Diagnostic, warning } from '../diagnostics';
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

/**
 * Generate a React Native .tsx function component from a parsed component,
 * its template AST and its parsed styles.
 *
 * Stage 2 (M3/M4): fields assigned inside methods become useState state;
 * methods are translated to const arrow functions; (event) bindings become
 * onPress-style props; *ngIf wraps its element in `{cond && (...)}` and
 * *ngFor in `{items.map((item, i) => (...))}`.
 */
export function generateComponent(
  component: ComponentInfo,
  ast: TemplateRoot,
  css: ParsedCss,
): GenerateResult {
  const diagnostics: Diagnostic[] = [...css.diagnostics];
  const usedRn = new Set<string>();
  const usedUi = new Set<string>();
  const usesPipeHelper = { value: false };

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
        `Initialise '${field.name}' with a literal (0, 'text', true, [ ... ], { ... }) so it can become state — e.g. ${field.name} = 0;`,
      ));
    }
  }

  const styleKeys = new Set(Object.keys(css.styles));

  const styleFor = (el: ElementNode): string | undefined => {
    const refs: string[] = [];
    if (styleKeys.has(el.tag)) refs.push(`styles.${styleKeyName(el.tag)}`);
    const classes = (el.attrs['class'] ?? '').split(/\s+/).filter(Boolean);
    for (const cls of classes) if (styleKeys.has(cls)) refs.push(`styles.${styleKeyName(cls)}`);
    if (!refs.length) return undefined;
    usedRn.add('StyleSheet');
    return refs.length === 1 ? refs[0] : `[${refs.join(', ')}]`;
  };

  const codeExpr = (source: string): string => {
    const code = exprToCode(source);
    if (code.includes("pipe('")) usesPipeHelper.value = true;
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
    let componentName: string;
    if (mapping) {
      componentName = mapping.component;
      (mapping.fromUi ? usedUi : usedRn).add(mapping.component);
    } else if (/^[A-Z]/.test(el.tag) || el.tag.includes('-')) {
      // A component-looking tag: keep it, the app's own registry resolves it.
      componentName = el.tag;
    } else {
      diagnostics.push(warning(
        'GEN_UNKNOWN_TAG',
        `Unknown tag <${el.tag}> — emitted as <View>. Use a known block or a component tag.`,
        el.pos.line, el.pos.column,
        'Known blocks: screen, appbar, card, list, row, fab, button, input, h1, h2, h3, p, span, div, section, header — or use a Capitalised component tag',
      ));
      componentName = 'View';
      usedRn.add('View');
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
    for (const ev of el.eventBindings) {
      const { prop, known } = eventPropName(ev.name, el.tag);
      if (!known) {
        lines.push(`${indent}{/* (${ev.name}) has no standard RN prop — mapped to ${prop} */}`);
      }
      const src = ev.expression.trim();
      let isBareRef = false;
      try { isBareRef = parseExpression(src).type === 'identifier'; } catch { /* raw fallback below */ }
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
          `*ngIf with 'else'/'then' microsyntax is not generated yet — element emitted unconditionally`,
          el.pos.line, el.pos.column,
          'Split it into two elements: one with *ngIf="cond" and a second with *ngIf="!(cond)"',
        ));
        return [
          `${indent}{/* TODO(M5+): *ngIf else/then — "${el.structural.expression}" */}`,
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
          `${indent}{/* TODO: unparseable *ngFor="${el.structural.expression}" — element emitted once */}`,
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
      `*${el.structural.name} is not supported yet — element emitted unconditionally`,
      el.pos.line, el.pos.column,
      'Only *ngIf and *ngFor are supported — rewrite the element with one of those',
    ));
    return [
      `${indent}{/* TODO: *${el.structural.name}="${el.structural.expression}" */}`,
      ...renderCore(stripped, depth, []),
    ];
  };

  const bodyLines: string[] = [];
  for (const node of ast.children) {
    if (node.type === 'text') {
      usedRn.add('Text');
      bodyLines.push(`      <Text>${renderText(node, '').trim()}</Text>`);
    } else {
      bodyLines.push(...renderElement(node, 0));
    }
  }

  const fnName = componentFunctionName(component.className);
  const inputs = component.fields.filter((f) => f.isInput);
  const propsDecl = inputs.length
    ? `{ ${inputs.map((f) => f.name).join(', ')} }: { ${inputs.map((f) => `${f.name}?: any`).join('; ')} }`
    : '';

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
      fieldLines.push(`  // TODO: field '${field.name}' has a non-literal initializer (${field.initializer}) — not hoisted; wire it up manually for now.`);
      diagnostics.push(warning('GEN_FIELD', `Field '${field.name}' has a non-literal initializer; not hoisted`, undefined, undefined, `Initialise '${field.name}' with a literal (including arrays/objects of literals) or wire the value up manually in the generated component`));
    }
  }

  // --- Methods: translation (M3) --------------------------------------------
  const { methods: translated, diagnostics: methodDiags } = translateMethods(component, 'react', stateFields);
  diagnostics.push(...methodDiags);
  const methodLines: string[] = [];
  for (const m of translated) {
    methodLines.push(`  const ${m.name} = (${m.paramTexts.join(', ')}) => {`);
    for (const line of m.lines) methodLines.push(line ? `    ${line}` : line);
    methodLines.push('  };');
  }

  const importLines: string[] = [];
  if (stateFields.size) importLines.push(`import { useState } from 'react';`);
  if (usedRn.size) {
    const rn = [...usedRn].filter((n) => n !== 'StyleSheet').sort();
    const all = usedRn.has('StyleSheet') ? [...rn, 'StyleSheet'] : rn;
    if (all.length) importLines.push(`import { ${all.join(', ')} } from 'react-native';`);
  }
  if (usedUi.size) importLines.push(`import { ${[...usedUi].sort().join(', ')} } from '@rangular/ui';`);
  if (usesPipeHelper.value) importLines.push(`import { pipe } from '@rangular/runtime';`);

  const styleBlock: string[] = [];
  if (Object.keys(css.styles).length) {
    styleBlock.push('', 'const styles = StyleSheet.create({');
    for (const [key, styleObj] of Object.entries(css.styles)) {
      styleBlock.push(`  ${styleKeyName(key)}: ${JSON.stringify(styleObj)},`);
    }
    styleBlock.push('});');
  }

  const code = [
    `// Generated by Rangular from ${component.className} (${component.selector ?? 'no selector'}). Do not edit by hand.`,
    ...importLines,
    '',
    `export default function ${fnName}(${propsDecl}) {`,
    ...fieldLines,
    ...methodLines,
    '  return (',
    ...bodyLines,
    '  );',
    '}',
    ...styleBlock,
    '',
  ].join('\n');

  return { code, diagnostics };
}
