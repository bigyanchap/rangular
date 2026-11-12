import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { compileComponent, hasErrors } from '../packages/compiler/src/compile';
import { renderPreview } from '../packages/compiler/src/preview/renderPreview';
import { parseCss } from '../packages/compiler/src/style/css';
import { colours, elevation, themes } from '../packages/ui/src/tokens';

const ROOT = path.join(__dirname, '..', '..');
const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

function compileExample(name: string) {
  const dir = path.join(ROOT, 'examples', name);
  const tsSource = fs.readFileSync(path.join(dir, `${name}.component.ts`), 'utf8');
  const result = compileComponent({
    tsSource,
    fileName: `${name}.component.ts`,
    resolveFile: (rel) => fs.readFileSync(path.join(dir, rel), 'utf8'),
  });
  return { dir, result };
}

function compileSnippet(template: string, classBody = '') {
  const tsSource = `
    @Component({ selector: 'app-t', template: ${JSON.stringify(template)} })
    export class TComponent { ${classBody} }
  `;
  return compileComponent({ tsSource });
}

// --- Tokens (A) ---------------------------------------------------------------

const REQUIRED_ROLES = [
  'primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer',
  'secondary', 'surface', 'surfaceVariant', 'onSurface', 'onSurfaceVariant',
  'background', 'error', 'onError', 'outline', 'scrim',
] as const;

test('every colour role exists in BOTH themes with a hex value', () => {
  for (const mode of ['light', 'dark'] as const) {
    for (const role of REQUIRED_ROLES) {
      assert.match(colours[mode][role], /^#[0-9a-fA-F]{6}$/, `${mode}.${role}`);
    }
    // Legacy names from Stages 0 to 3 keep working.
    for (const legacy of ['accent', 'text', 'textMuted', 'danger', 'border'] as const) {
      assert.match(colours[mode][legacy], /^#/, `${mode}.${legacy}`);
    }
  }
});

test('legacy colour names are aliases of the Material roles', () => {
  for (const mode of ['light', 'dark'] as const) {
    assert.equal(colours[mode].text, colours[mode].onSurface);
    assert.equal(colours[mode].textMuted, colours[mode].onSurfaceVariant);
    assert.equal(colours[mode].danger, colours[mode].error);
  }
});

test('themes export carries both modes, and light/dark actually differ', () => {
  assert.equal(themes.light.mode, 'light');
  assert.equal(themes.dark.mode, 'dark');
  assert.equal(themes.dark.colors.background, '#131314');
  assert.equal(themes.light.colors.background, '#ffffff');
  assert.notEqual(themes.light.colors.primary, themes.dark.colors.primary);
});

test('elevation presets are three named levels', () => {
  assert.deepEqual(Object.keys(elevation), ['level0', 'level1', 'level2']);
  assert.equal(elevation.level0.elevation, 0);
  assert.equal(elevation.level0.shadowOpacity, 0);
  assert.ok(elevation.level2.shadowRadius > elevation.level1.shadowRadius);
});

// --- Primitives (B) -------------------------------------------------------------

test('primitives.tsx contains no hard-coded hex colours', () => {
  const src = fs.readFileSync(path.join(ROOT, 'packages', 'ui', 'src', 'primitives.tsx'), 'utf8');
  assert.deepEqual(src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], []);
});

test('primitives deliver the theme through context with a light default', () => {
  const src = fs.readFileSync(path.join(ROOT, 'packages', 'ui', 'src', 'primitives.tsx'), 'utf8');
  assert.match(src, /createContext<Theme>\(makeTheme\('light'\)\)/);
  assert.match(src, /export function useRgTheme\(\)/);
  assert.match(src, /export function RgThemeProvider/);
  assert.match(src, /export function RgScreen\(\{ children, style, theme: mode \}/);
});

// --- Snapping (C) ---------------------------------------------------------------

test('off-scale spacing snaps to the nearest scale value and warns with the snapped value in the fix', () => {
  const { styles, diagnostics } = parseCss('h1 { margin-bottom: 13px; }');
  assert.equal(styles['h1'].marginBottom, 12);
  const d = diagnostics.find((x) => x.code === 'STYLE_OFF_SCALE');
  assert.ok(d, 'STYLE_OFF_SCALE emitted');
  assert.equal(d!.severity, 'warning');
  assert.match(d!.message, /snapped to 12/);
  assert.match(d!.fix ?? '', /margin-bottom: 12px/);
});

test('snapping ties resolve to the lower scale value', () => {
  assert.equal(parseCss('.x { padding: 10px; }').styles['x'].padding, 8);
  assert.equal(parseCss('.x { border-radius: 14px; }').styles['x'].borderRadius, 12);
  assert.equal(parseCss('.x { font-size: 15px; }').styles['x'].fontSize, 14);
});

test('font sizes snap to the type scale and the fix names the step', () => {
  const { styles, diagnostics } = parseCss('.x { font-size: 18px; }');
  assert.equal(styles['x'].fontSize, 16);
  const d = diagnostics.find((x) => x.code === 'STYLE_OFF_SCALE');
  assert.match(d!.fix ?? '', /16 \(bodyLarge\)/);
});

test('negative spacing snaps by magnitude; gap and offsets snap too', () => {
  const { styles } = parseCss('.x { margin-top: -13px; gap: 18px; top: 6px; }');
  assert.equal(styles['x'].marginTop, -12);
  assert.equal(styles['x'].gap, 16);
  assert.equal(styles['x'].top, 4);
});

test('on-scale values and 0 pass silently; colours are never snapped', () => {
  const { styles, diagnostics } = parseCss(
    'h1 { margin-bottom: 8px; font-size: 14px; border-radius: 16px; gap: 0px; color: #123456; }',
  );
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(styles['h1'], {
    marginBottom: 8, fontSize: 14, borderRadius: 16, gap: 0, color: '#123456',
  });
  // radius full is on-scale by definition
  assert.deepEqual(parseCss('.x { border-radius: 9999px; }').diagnostics, []);
});

// --- Codegen: screen theme + label (C) -------------------------------------------

test('<screen theme="dark"> compiles to <RgScreen theme="dark">', () => {
  const { code } = compileSnippet('<screen theme="dark"><p>x</p></screen>');
  assert.match(code, /<RgScreen theme="dark">/);
  const light = compileSnippet('<screen><p>x</p></screen>');
  assert.match(light.code, /<RgScreen>/);
});

test('<label> compiles to RgText with the label variant', () => {
  const { code } = compileSnippet('<screen><label>Text variants</label></screen>');
  assert.match(code, /<RgText variant="label">Text variants<\/RgText>/);
});

// --- Showcase (D) ------------------------------------------------------------------

test('showcase compiles with zero diagnostics and matches its golden .tsx', () => {
  const { dir, result } = compileExample('showcase');
  assert.equal(hasErrors(result.diagnostics), false, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  const golden = fs.readFileSync(path.join(dir, 'showcase.component.tsx'), 'utf8');
  assert.equal(normalize(result.code), normalize(golden));
});

test('showcase preview starts in the declared (light) theme and carries both palettes', () => {
  const { result } = compileExample('showcase');
  const html = renderPreview(result.component!, result.ast!);
  assert.match(html, /<html lang="en" data-theme="light">/);
  assert.match(html, /id="theme-toggle"/);
  assert.match(html, /--screen-bg: #ffffff/);
  assert.match(html, /--screen-bg: #131314/);
  assert.match(html, /Design tokens, live/);
});

// --- Preview theme toggle: behaviour (DOM shim) --------------------------------------

class ShimText {
  constructor(private text: string) {}
  get textContent(): string { return this.text; }
}

class ShimElement {
  className = '';
  disabled = false;
  children: (ShimElement | ShimText)[] = [];
  private listeners = new Map<string, ((ev: unknown) => void)[]>();
  private attrs = new Map<string, string>();
  constructor(public tagName: string) { this.tagName = tagName.toUpperCase(); }
  appendChild(node: ShimElement | ShimText): unknown { this.children.push(node); return node; }
  addEventListener(type: string, fn: (ev: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  click(): void {
    for (const fn of this.listeners.get('click') ?? []) fn({});
  }
  setAttribute(name: string, value: string): void { this.attrs.set(name, value); }
  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null; }
  set innerHTML(_value: string) { this.children = []; }
  get innerHTML(): string { return ''; }
  set textContent(value: string) { this.children = [new ShimText(value)]; }
  get textContent(): string { return this.children.map((c) => c.textContent).join(''); }
}

function loadThemedPreview(html: string) {
  const app = new ShimElement('div');
  const toggle = new ShimElement('button');
  const documentElement = new ShimElement('html');
  const documentShim = {
    createElement: (tag: string) => new ShimElement(tag),
    createTextNode: (text: string) => new ShimText(text),
    getElementById: (id: string) => (id === 'app' ? app : id === 'theme-toggle' ? toggle : null),
    documentElement,
  };
  const script = html.split('<script>')[1].split('</script>')[0];
  vm.runInNewContext(script, { document: documentShim, console });
  return { app, toggle, documentElement };
}

test('preview behaviour: the Light/Dark toggle flips data-theme and its own label', () => {
  const { result } = compileExample('showcase');
  const html = renderPreview(result.component!, result.ast!);
  const { app, toggle, documentElement } = loadThemedPreview(html);
  assert.match(app.textContent, /Design tokens, live/);
  assert.equal(toggle.textContent, 'Switch to dark theme');
  toggle.click();
  assert.equal(documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(toggle.textContent, 'Switch to light theme');
  toggle.click();
  assert.equal(documentElement.getAttribute('data-theme'), 'light');
  assert.equal(toggle.textContent, 'Switch to dark theme');
});

test('preview behaviour: a screen declaring theme="dark" starts dark', () => {
  const result = compileSnippet('<screen theme="dark"><p>Night</p></screen>');
  const html = renderPreview(result.component!, result.ast!);
  assert.match(html, /<html lang="en" data-theme="dark">/);
  const { toggle, documentElement } = loadThemedPreview(html);
  assert.equal(toggle.textContent, 'Switch to light theme');
  toggle.click();
  assert.equal(documentElement.getAttribute('data-theme'), 'light');
});

// --- Standing rule guard: no em dashes ------------------------------------------------

test('guard: no em dash (U+2014) in any tracked text file in the repo', () => {
  const skipDirs = new Set(['node_modules', 'dist', '.git']);
  const exts = new Set(['.ts', '.tsx', '.js', '.json', '.md', '.txt', '.html', '.css', '.yml', '.yaml']);
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skipDirs.has(entry.name)) continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (exts.has(path.extname(entry.name))) {
        if (fs.readFileSync(p, 'utf8').includes('\u2014')) offenders.push(path.relative(ROOT, p));
      }
    }
  };
  walk(ROOT);
  assert.deepEqual(offenders, []);
});
