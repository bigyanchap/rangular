import { theme } from '../../../ui/src/tokens';
import { ComponentInfo } from '../class/parseComponent';
import { translateMethods } from '../codegen/methods';
import { ElementNode, TemplateNode, TemplateRoot } from '../template/ast';
import { evaluateExpression, Scope } from '../template/evaluate';
import { literalValue } from '../template/literal';
import { parseNgFor, parseNgIf } from '../template/structural';

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
 * safe AST evaluator — no eval/Function anywhere.
 */

/** Evaluate a literal initializer (now including nested arrays/objects). */
export function evaluateLiteral(initializer: string): unknown {
  const r = literalValue(initializer);
  return r.ok ? r.value : undefined;
}

/** The preview state: every field whose initializer is a literal structure. */
export function componentState(component: ComponentInfo): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  for (const f of component.fields) {
    if (f.isInput || f.isOutput || !f.initializer) continue;
    const v = evaluateLiteral(f.initializer);
    if (v !== undefined) state[f.name] = v;
  }
  return state;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const UNSET = Symbol('unset');

/** Evaluate an expression against a scope; UNSET on any failure. */
function evalSafe(source: string, scope: Scope): unknown {
  try {
    const v = evaluateExpression(source, scope);
    return v === undefined ? UNSET : v;
  } catch {
    return UNSET;
  }
}

export function renderPreview(component: ComponentInfo, ast: TemplateRoot): string {
  const t = theme('light');
  const c = t.colors;
  const state = componentState(component);
  const baseScope: Scope = { ...state };

  const renderNodes = (nodes: TemplateNode[], scope: Scope): string =>
    nodes.map((n) => renderNode(n, scope)).join('\n');

  const renderNode = (node: TemplateNode, scope: Scope): string => {
    if (node.type === 'text') {
      return node.parts
        .map((p) => {
          if (p.type === 'static') return escapeHtml(p.value);
          const v = evalSafe(p.expression, scope);
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
      const v = evalSafe(b.expression, scope);
      if (v !== UNSET) return String(v ?? '');
    }
    return el.attrs[name];
  };

  const renderElement = (el: ElementNode, scope: Scope): string => {
    if (el.structural?.name === 'ngIf') {
      const parts = parseNgIf(el.structural.expression);
      const v = evalSafe(parts.condition, scope);
      if (v === UNSET || !v) return '';
      return renderCore({ ...el, structural: undefined }, scope);
    }
    if (el.structural?.name === 'ngFor') {
      const { parts } = parseNgFor(el.structural.expression);
      if (!parts) return '';
      const items = evalSafe(parts.source, scope);
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

  const renderCore = (el: ElementNode, scope: Scope): string => {
    const inner = renderNodes(el.children, scope);
    const title = bound(el, 'title', scope) ?? '';
    switch (el.tag) {
      case 'screen':
        return `<div class="screen">${inner}</div>`;
      case 'appbar': {
        const search = bound(el, 'search', scope);
        return `<header class="appbar"><span class="appbar-menu">&#9776;</span>` +
          (search
            ? `<span class="search">${escapeHtml(search)}</span>`
            : `<span class="appbar-title">${escapeHtml(title)}</span>`) +
          `<span class="avatar">${escapeHtml((title || 'R').charAt(0))}</span></header>`;
      }
      case 'h1': return `<h1 class="display">${inner}</h1>`;
      case 'h2': return `<h2 class="heading">${inner}</h2>`;
      case 'h3': return `<h3 class="title">${inner}</h3>`;
      case 'p': return `<p class="body">${inner}</p>`;
      case 'span': return `<span>${inner}</span>`;
      case 'card': return `<section class="card">${inner}</section>`;
      case 'button': {
        const dis = el.propBindings.find((b) => b.name === 'disabled');
        const disabled = dis ? evalSafe(dis.expression, scope) === true : false;
        return `<button class="btn" ${disabled ? 'disabled' : ''}>${inner}</button>`;
      }
      case 'list': return `<div class="list">${inner}</div>`;
      case 'row': {
        const rowTitle = bound(el, 'title', scope) ?? inner;
        const sub = bound(el, 'subtitle', scope) ?? '';
        const detail = bound(el, 'detail', scope) ?? '';
        const time = bound(el, 'time', scope) ?? '';
        const initial = (rowTitle || '•').charAt(0);
        return `<div class="row">${el.booleanAttrs.includes('avatar') ? `<span class="avatar-lg">${escapeHtml(initial)}</span>` : ''}` +
          `<span class="row-main"><span class="row-title">${escapeHtml(rowTitle)}</span>` +
          (sub ? `<span class="row-sub">${escapeHtml(sub)}</span>` : '') +
          (detail ? `<span class="row-detail">${escapeHtml(detail)}</span>` : '') +
          `</span>${time ? `<span class="row-time">${escapeHtml(time)}</span>` : ''}</div>`;
      }
      case 'fab': return `<div class="fab">${inner || escapeHtml(bound(el, 'label', scope) ?? 'Compose')}</div>`;
      case 'header': return `<header>${inner}</header>`;
      case 'section': return `<section>${inner}</section>`;
      default: return `<div>${inner}</div>`;
    }
  };

  const initialHtml = renderNodes(ast.children, baseScope);
  const script = previewScript(component, ast, state);

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
 * The interactive part of the page: serialized template + state + translated
 * methods + a compact in-page runtime (expression parser/evaluator and DOM
 * renderer supporting the same subset as the compiler).
 */
export function previewScript(
  component: ComponentInfo,
  ast: TemplateRoot,
  state: Record<string, unknown>,
): string {
  const { methods } = translateMethods(component, 'state', new Set());
  const methodEntries = methods.map((m) => {
    const body = m.lines.join('\n');
    return `  ${m.name}: function (${m.paramNames.join(', ')}) {\n${body}\n  }`;
  });
  return `// Rangular interactive preview runtime (Stage 2).
// State and methods are live: (click) handlers mutate state and re-render.
const TEMPLATE = ${JSON.stringify(ast)};
const state = ${JSON.stringify(state)};
const methods = {
${methodEntries.join(',\n')}
};
${PAGE_RUNTIME}`;
}

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
    throw new Error('preview: unexpected token ' + t.v);
  }
  var e = parsePipe();
  if (peek().k !== 'eof') throw new Error('preview: trailing tokens');
  return e;
}
function __pipe(name, value) {
  switch (name) {
    case 'uppercase': return typeof value === 'string' ? value.toUpperCase() : value;
    case 'lowercase': return typeof value === 'string' ? value.toLowerCase() : value;
    case 'titlecase': return typeof value === 'string' ? value.replace(/\w\S*/g, function (w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); }) : value;
    case 'json': return JSON.stringify(value);
    default: throw new Error("preview: unknown pipe '" + name + "'");
  }
}
function __eval(e, scope) {
  switch (e.type) {
    case 'literal': return e.value;
    case 'identifier': return scope[e.name];
    case 'member': {
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
    case 'pipe':
      return __pipe(e.name, __eval(e.input, scope));
  }
}
function __evalSrc(src, scope) { return __eval(__parse(src), scope); }
function __scope(extra) {
  var s = {}, k;
  for (k in state) s[k] = state[k];
  for (k in methods) s[k] = methods[k];
  if (extra) for (k in extra) s[k] = extra[k];
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
function __buildNodes(nodes, scope) {
  var out = [];
  nodes.forEach(function (n) {
    __buildNode(n, scope).forEach(function (d) { out.push(d); });
  });
  return out;
}
function __buildNode(node, scope) {
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
  return __buildElement(node, scope);
}
function __buildElement(el, scope) {
  if (el.structural && el.structural.name === 'ngIf') {
    var cond;
    try { cond = __evalSrc(el.structural.expression.split(';')[0].trim(), scope); }
    catch (err) { console.warn(err); cond = false; }
    if (!cond) return [];
    return __buildCore(el, scope);
  }
  if (el.structural && el.structural.name === 'ngFor') {
    var parts = __parseNgFor(el.structural.expression);
    if (!parts) { console.warn('preview: unparseable *ngFor'); return __buildCore(el, scope); }
    var items;
    try { items = __evalSrc(parts.source, scope); }
    catch (err) { console.warn(err); items = []; }
    if (!items || typeof items.length !== 'number') return [];
    var out = [];
    for (var idx = 0; idx < items.length; idx++) {
      var extra = {};
      extra[parts.item] = items[idx];
      if (parts.index) extra[parts.index] = idx;
      __buildCore(el, __extend(scope, extra)).forEach(function (d) { out.push(d); });
    }
    return out;
  }
  return __buildCore(el, scope);
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
function __buildCore(el, scope) {
  var kids = __buildNodes(el.children, scope);
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
      var menu = document.createElement('span');
      menu.textContent = '☰';
      bar.appendChild(menu);
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
    case 'span': return wrap('span', '');
    case 'card': return wrap('section', 'card');
    case 'button': {
      var b = document.createElement('button');
      b.className = 'btn';
      if (__binding(el, 'disabled', scope)) b.disabled = true;
      kids.forEach(function (k) { b.appendChild(k); });
      __attachEvents(b, el, scope);
      return [b];
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
      __attachEvents(row, el, scope);
      return [row];
    }
    case 'fab': {
      var f = wrap('div', 'fab')[0];
      if (!el.children.length) {
        var lbl = __attr(el, 'label', scope);
        f.textContent = lbl ? String(lbl) : 'Compose';
      }
      __attachEvents(f, el, scope);
      return [f];
    }
    case 'header': return wrap('header', '');
    case 'section': return wrap('section', '');
    default: return wrap('div', '');
  }
}
function __render() {
  var app = document.getElementById('app');
  app.innerHTML = '';
  __buildNodes(TEMPLATE.children, __scope()).forEach(function (n) { app.appendChild(n); });
}
__render();
`;
