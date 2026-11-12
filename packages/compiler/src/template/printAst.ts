import { TemplateNode, TemplateRoot } from './ast';

/** M0: print a template AST as an indented tree, for eyeballing and tests. */
export function printAst(root: TemplateRoot): string {
  const lines: string[] = [];
  const walk = (nodes: TemplateNode[], depth: number) => {
    for (const node of nodes) {
      const indent = '  '.repeat(depth);
      if (node.type === 'text') {
        const body = node.parts
          .map((p) => (p.type === 'static' ? p.value : `{{ ${p.expression} }}`))
          .join('');
        lines.push(`${indent}text "${body}"`);
        continue;
      }
      const bits: string[] = [`<${node.tag}>`];
      for (const [k, v] of Object.entries(node.attrs)) bits.push(`${k}="${v}"`);
      for (const b of node.booleanAttrs) bits.push(b);
      for (const p of node.propBindings) bits.push(`[${p.name}]="${p.expression}"`);
      for (const e of node.eventBindings) bits.push(`(${e.name})="${e.expression}"`);
      if (node.structural) bits.push(`*${node.structural.name}="${node.structural.expression}"`);
      if (node.ref) bits.push(`#${node.ref}`);
      lines.push(indent + bits.join(' '));
      walk(node.children, depth + 1);
    }
  };
  walk(root.children, 0);
  return lines.join('\n');
}
