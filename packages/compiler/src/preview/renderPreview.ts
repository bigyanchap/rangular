import { theme } from '../../../ui/src/tokens';
import { ComponentField, ComponentInfo } from '../class/parseComponent';
import { ElementNode, TemplateNode, TemplateRoot } from '../template/ast';

/**
 * Dev preview renderer: renders the same template AST the codegen consumes
 * into a standalone HTML page that mimics the React Native screen, using the
 * Rangular Material tokens. This is what visual eye-checks look at — it is a
 * preview of the generated screen, not the shipped app.
 *
 * Field values come only from literal initializers, evaluated as literals —
 * arbitrary expressions are never executed.
 */
export function evaluateLiteral(initializer: string): unknown {
  const t = initializer.trim();
  if (/^'([^'\\]|\\.)*'$/.test(t) || /^"([^"\\]|\\.)*"$/.test(t)) {
    return t.slice(1, -1).replace(/\\(.)/g, '$1');
  }
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;
  return undefined;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderPreview(component: ComponentInfo, ast: TemplateRoot): string {
  const t = theme('light');
  const c = t.colors;
  const values = new Map<string, unknown>();
  for (const f of component.fields as ComponentField[]) {
    if (f.initializer) {
      const v = evaluateLiteral(f.initializer);
      if (v !== undefined) values.set(f.name, v);
    }
  }

  const resolve = (expr: string): string => {
    const v = values.get(expr.trim());
    return v === undefined ? `{{ ${expr} }}` : String(v);
  };

  const renderNodes = (nodes: TemplateNode[]): string => nodes.map(renderNode).join('\n');

  const renderNode = (node: TemplateNode): string => {
    if (node.type === 'text') {
      return node.parts
        .map((p) => (p.type === 'static' ? escapeHtml(p.value) : escapeHtml(resolve(p.expression))))
        .join('');
    }
    return renderElement(node);
  };

  const renderElement = (el: ElementNode): string => {
    const inner = renderNodes(el.children);
    const title = el.attrs['title'] ?? '';
    switch (el.tag) {
      case 'screen':
        return `<div class="screen">${inner}</div>`;
      case 'appbar':
        return `<header class="appbar"><span class="appbar-menu">&#9776;</span>` +
          (el.attrs['search']
            ? `<span class="search">${escapeHtml(el.attrs['search'])}</span>`
            : `<span class="appbar-title">${escapeHtml(title)}</span>`) +
          `<span class="avatar">${escapeHtml((title || 'R').charAt(0))}</span></header>`;
      case 'h1': return `<h1 class="display">${inner}</h1>`;
      case 'h2': return `<h2 class="heading">${inner}</h2>`;
      case 'h3': return `<h3 class="title">${inner}</h3>`;
      case 'p': return `<p class="body">${inner}</p>`;
      case 'span': return `<span>${inner}</span>`;
      case 'card': return `<section class="card">${inner}</section>`;
      case 'button': {
        const disabled = el.propBindings.some(
          (b) => b.name === 'disabled' && values.get(b.expression.trim()) === true,
        );
        return `<button class="btn" ${disabled ? 'disabled' : ''}>${inner}</button>`;
      }
      case 'list': return `<div class="list">${inner}</div>`;
      case 'row': {
        const rowTitle = el.attrs['title'] ?? inner;
        const sub = el.attrs['subtitle'] ?? '';
        const detail = el.attrs['detail'] ?? '';
        const initial = (el.attrs['title'] ?? '•').charAt(0);
        return `<div class="row">${el.booleanAttrs.includes('avatar') ? `<span class="avatar-lg">${escapeHtml(initial)}</span>` : ''}` +
          `<span class="row-main"><span class="row-title">${escapeHtml(rowTitle)}</span>` +
          (sub ? `<span class="row-sub">${escapeHtml(sub)}</span>` : '') +
          (detail ? `<span class="row-detail">${escapeHtml(detail)}</span>` : '') +
          `</span>${el.attrs['time'] ? `<span class="row-time">${escapeHtml(el.attrs['time'])}</span>` : ''}</div>`;
      }
      case 'fab': return `<div class="fab">${inner || escapeHtml(el.attrs['label'] ?? 'Compose')}</div>`;
      case 'header': return `<header>${inner}</header>`;
      case 'section': return `<section>${inner}</section>`;
      default: return `<div>${inner}</div>`;
    }
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Rangular preview — ${escapeHtml(component.selector ?? component.className)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Roboto, system-ui, sans-serif; background: #e8eaed; display: flex; justify-content: center; padding: 24px 12px; }
  .screen { width: 360px; max-width: 100%; min-height: 640px; background: ${c.background}; color: ${c.text}; border-radius: 28px; overflow: hidden; box-shadow: 0 10px 28px rgba(0,0,0,.18); padding-bottom: ${t.spacing.xxl}px; }
  .appbar { display: flex; align-items: center; gap: ${t.spacing.md}px; margin: ${t.spacing.md}px; background: ${c.surfaceVariant}; border-radius: ${t.radius.full}px; padding: 10px ${t.spacing.lg}px; }
  .search { flex: 1; color: ${c.textMuted}; font-size: 14px; }
  .appbar-title { flex: 1; font-size: ${t.typography.title.fontSize}px; font-weight: 600; }
  .avatar { width: 28px; height: 28px; border-radius: 50%; background: #7b1fa2; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; }
  .avatar-lg { width: 40px; height: 40px; flex: 0 0 40px; border-radius: 50%; background: ${c.primary}; color: ${c.onPrimary}; display: inline-flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 600; }
  .display { font-size: ${t.typography.display.fontSize}px; line-height: ${t.typography.display.lineHeight}px; font-weight: 700; margin: ${t.spacing.lg}px ${t.spacing.lg}px ${t.spacing.sm}px; }
  .heading { font-size: ${t.typography.heading.fontSize}px; line-height: ${t.typography.heading.lineHeight}px; font-weight: 700; margin: 0 0 ${t.spacing.sm}px; }
  .title { font-size: ${t.typography.title.fontSize}px; line-height: ${t.typography.title.lineHeight}px; font-weight: 600; margin: 0 0 ${t.spacing.sm}px; }
  .body { font-size: ${t.typography.bodyLarge.fontSize}px; line-height: ${t.typography.bodyLarge.lineHeight}px; color: ${c.textMuted}; margin: 0 ${t.spacing.lg}px ${t.spacing.lg}px; }
  .card { background: ${c.surfaceVariant}; border: 1px solid ${c.border}; border-radius: ${t.radius.lg}px; padding: ${t.spacing.lg}px; margin: 0 ${t.spacing.lg}px ${t.spacing.lg}px; }
  .card .body { margin: 0; font-size: ${t.typography.body.fontSize}px; }
  .btn { display: block; margin: ${t.spacing.sm}px ${t.spacing.lg}px 0; background: ${c.primary}; color: ${c.onPrimary}; border: none; border-radius: ${t.radius.full}px; padding: 0 ${t.spacing.xxl}px; min-height: 48px; font-size: ${t.typography.label.fontSize}px; font-weight: 600; cursor: pointer; }
  .btn[disabled] { opacity: .38; cursor: default; }
  .list { border-top: 1px solid ${c.border}; }
  .row { display: flex; gap: ${t.spacing.md}px; align-items: flex-start; padding: 11px ${t.spacing.lg}px; border-bottom: 1px solid ${c.border}; }
  .row-main { flex: 1; display: flex; flex-direction: column; }
  .row-title { font-weight: 600; font-size: 14px; }
  .row-sub { font-size: 13px; }
  .row-detail { font-size: 12.5px; color: ${c.textMuted}; }
  .row-time { font-size: 11px; color: ${c.textMuted}; }
  .fab { display: inline-block; float: right; margin: ${t.spacing.sm}px ${t.spacing.lg}px 0 0; background: #c2e7ff; color: #001d35; border-radius: ${t.radius.lg}px; padding: 13px 18px; font-size: 14px; font-weight: 600; box-shadow: 0 3px 8px rgba(0,0,0,.25); }
</style>
</head>
<body>
${renderNodes(ast.children)}
</body>
</html>
`;
}
