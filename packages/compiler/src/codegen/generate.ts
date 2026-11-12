import { ComponentInfo } from '../class/parseComponent';
import { Diagnostic, warning } from '../diagnostics';
import { ParsedCss } from '../style/css';
import { ElementNode, TemplateNode, TemplateRoot } from '../template/ast';
import { exprToCode } from '../template/expr';

export interface GenerateResult {
  code: string;
  diagnostics: Diagnostic[];
}

interface TagMapping {
  component: string;
  /** true when the mapping comes from @rangular/ui rather than react-native */
  fromUi: boolean;
  /** Text variant for heading/paragraph mappings */
  variant?: string;
}

const TAG_MAP: Record<string, TagMapping> = {
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
};

/** True when an initializer source text is a plain literal we may hoist. */
export function isLiteralInitializer(init: string): boolean {
  const t = init.trim();
  return (
    /^('([^'\\]|\\.)*'|"([^"\\]|\\.)*"|`[^`]*`)$/.test(t) ||
    /^-?\d+(\.\d+)?$/.test(t) ||
    /^(true|false|null)$/.test(t) ||
    t.startsWith('[') ||
    t.startsWith('{')
  );
}

/** StyleSheet keys must be valid JS identifiers: `card-note` -> `cardNote`. */
export function styleKeyName(key: string): string {
  return key.replace(/-([a-zA-Z])/g, (_, c: string) => c.toUpperCase());
}

export function componentFunctionName(className: string): string {
  return className.endsWith('Component') ? className.slice(0, -'Component'.length) : className;
}

/**
 * Generate a React Native .tsx function component from a parsed component,
 * its template AST and its parsed styles. Events and structural directives
 * are parsed but their codegen is deferred (Stage 2): they emit a TODO
 * comment plus a warning instead of broken code.
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

  const renderText = (node: TemplateNode & { type: 'text' }, indent: string): string => {
    const parts = node.parts.map((p) => {
      if (p.type === 'static') return p.value;
      const code = exprToCode(p.expression);
      if (code.includes("pipe('")) usesPipeHelper.value = true;
      return `{${code}}`;
    });
    return indent + parts.join('');
  };

  const renderElement = (el: ElementNode, depth: number): string[] => {
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
      ));
      componentName = 'View';
      usedRn.add('View');
    }

    if (el.structural) {
      diagnostics.push(warning(
        'GEN_STRUCTURAL_TODO',
        `*${el.structural.name}="${el.structural.expression}" is parsed but code generation arrives in Stage 2 (M4) — element emitted unconditionally for now.`,
        el.pos.line, el.pos.column,
      ));
      lines.push(`${indent}{/* TODO(M4): *${el.structural.name}="${el.structural.expression}" */}`);
    }
    for (const ev of el.eventBindings) {
      diagnostics.push(warning(
        'GEN_EVENT_TODO',
        `(${ev.name})="${ev.expression}" is parsed but event code generation arrives in Stage 2 (M3) — handler not emitted yet.`,
        el.pos.line, el.pos.column,
      ));
      lines.push(`${indent}{/* TODO(M3): (${ev.name})="${ev.expression}" */}`);
    }

    const props: string[] = [];
    if (mapping?.variant) props.push(`variant="${mapping.variant}"`);
    for (const [name, value] of Object.entries(el.attrs)) {
      if (name === 'class') continue;
      props.push(`${name}="${value}"`);
    }
    for (const b of el.booleanAttrs) props.push(b);
    for (const p of el.propBindings) {
      const code = exprToCode(p.expression);
      if (code.includes("pipe('")) usesPipeHelper.value = true;
      props.push(`${p.name}={${code}}`);
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

  const fieldLines: string[] = [];
  for (const field of component.fields) {
    if (field.isInput || field.isOutput) continue;
    if (field.initializer && isLiteralInitializer(field.initializer)) {
      fieldLines.push(`  const ${field.name} = ${field.initializer};`);
    } else if (field.initializer) {
      fieldLines.push(`  // TODO: field '${field.name}' has a non-literal initializer (${field.initializer}) — state hoisting arrives in Stage 2 (M3).`);
      diagnostics.push(warning('GEN_FIELD', `Field '${field.name}' has a non-literal initializer; not hoisted in Stage 0+1`));
    }
  }

  const importLines: string[] = [];
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
    '  return (',
    ...bodyLines,
    '  );',
    '}',
    ...styleBlock,
    '',
  ].join('\n');

  return { code, diagnostics };
}
