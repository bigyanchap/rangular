import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { compileComponent, CompileResult, hasErrors } from '../packages/compiler/src/compile';
import { TAG_MAP } from '../packages/compiler/src/codegen/generate';
import { DIAGNOSTIC_CODES } from '../packages/compiler/src/diagnostics';
import { doctorStyleTexts, runDoctor } from '../packages/compiler/src/doctor';
import { buildCatalog, renderCatalogMarkdown } from '../packages/compiler/src/catalog';
import { renderPreview } from '../packages/compiler/src/preview/renderPreview';
import { buildStyleSnapshot } from '../packages/compiler/src/preview/styleSnapshot';
import { ICON_NAMES, ICON_PATHS, ICON_SIZES, DEFAULT_ICON_SIZE } from '../packages/ui/src/icons';
import { colours } from '../packages/ui/src/tokens';

const ROOT = path.join(__dirname, '..', '..');
const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

function compileExample(name: string): { dir: string; entry: string; result: CompileResult } {
  const dir = path.join(ROOT, 'examples', name);
  const entry = path.join(dir, `${name}.component.ts`);
  const result = compileComponent({
    tsSource: fs.readFileSync(entry, 'utf8'),
    fileName: entry,
    resolveFile: (rel) => {
      const p = path.join(dir, rel);
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined;
    },
    resolveImport: (spec, importer) => {
      const base = path.resolve(path.dirname(importer), spec);
      for (const cand of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
          return { source: fs.readFileSync(cand, 'utf8'), fileName: cand };
        }
      }
      return undefined;
    },
  });
  return { dir, entry, result };
}

function compileProject(files: Record<string, string>, entryName: string): { dir: string; entry: string; result: CompileResult } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rangular-s7-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  const entry = path.join(dir, entryName);
  const result = compileComponent({
    tsSource: fs.readFileSync(entry, 'utf8'),
    fileName: entry,
    resolveFile: (rel) => {
      const p = path.join(dir, rel);
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined;
    },
    resolveImport: (spec, importer) => {
      const base = path.resolve(path.dirname(importer), spec);
      for (const cand of [base, `${base}.ts`]) {
        if (fs.existsSync(cand)) return { source: fs.readFileSync(cand, 'utf8'), fileName: cand };
      }
      return undefined;
    },
  });
  return { dir, entry, result };
}

const projectWith = (template: string, fields = ''): CompileResult => compileProject({
  'icons.component.ts': `
    import { Component } from '@angular/core';
    @Component({ selector: 'app-t', templateUrl: './icons.component.html' })
    export class TComponent { ${fields} }
  `,
  'icons.component.html': template,
}, 'icons.component.ts').result;

// --- A: the set and the registrations ------------------------------------------------

test('Stage 7: the icon set is exactly the curated list, every name has path data', () => {
  const expected = ['menu', 'search', 'close', 'check', 'chevron-left', 'chevron-right',
    'arrow-left', 'arrow-right', 'plus', 'minus', 'bell', 'heart', 'star', 'settings',
    'home', 'person', 'calendar', 'alarm', 'play', 'pause', 'edit', 'delete', 'share',
    'info', 'warning', 'mail', 'sun'];
  assert.deepEqual(ICON_NAMES, [...expected].sort());
  assert.equal(ICON_NAMES.length, 27);
  for (const name of ICON_NAMES) {
    assert.ok(Array.isArray(ICON_PATHS[name]) && ICON_PATHS[name].length >= 1, `${name} has no path data`);
    for (const d of ICON_PATHS[name]) assert.ok(d.startsWith('M'), `${name} path does not start with M`);
  }
  assert.deepEqual(ICON_SIZES, [20, 24, 28]);
  assert.equal(DEFAULT_ICON_SIZE, 24);
});

test('Stage 7: TAG_MAP, diagnostics and catalog register the icon capability', () => {
  assert.equal(TAG_MAP['icon'].component, 'RgIcon');
  assert.ok(DIAGNOSTIC_CODES['GEN_ICON_UNKNOWN']);
  assert.ok(DIAGNOSTIC_CODES['GEN_ICON_NAME']);
  assert.ok(DIAGNOSTIC_CODES['GEN_ICON_SIZE']);
  const catalog = buildCatalog();
  assert.deepEqual(catalog.icons, ICON_NAMES);
  assert.ok(catalog.tags.some((t) => t.tag === 'icon' && t.component === 'RgIcon'));
  assert.ok(catalog.primitives.some((p) => p.name === 'RgIcon'
    && p.props.map((x) => x.name).join(',') === 'name,size,color,style'));
  const md = renderCatalogMarkdown(catalog);
  assert.ok(md.includes('## Icons'));
  for (const name of ICON_NAMES) assert.ok(md.includes(`- \`${name}\``), `catalog.md missing ${name}`);
});

// --- B: codegen ----------------------------------------------------------------------

test('Stage 7 codegen: static name, size and color become RgIcon props', () => {
  const result = projectWith(`
    <screen>
      <icon name="search"></icon>
      <icon name="heart" size="28" color="error"></icon>
      <icon name="sun" size="20"></icon>
    </screen>
  `);
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(result.code.includes('<RgIcon name="search" />'), result.code);
  assert.ok(result.code.includes('<RgIcon name="heart" size={28} color="error" />'), result.code);
  assert.ok(result.code.includes('<RgIcon name="sun" size={20} />'), result.code);
  assert.ok(result.code.includes("import { RgIcon, RgScreen } from '@rangular/ui';"), result.code);
});

test('Stage 7 codegen: [name] binding passes through unvalidated; icons work inside *ngFor', () => {
  const result = projectWith(`
    <screen>
      <icon [name]="current"></icon>
      <div *ngFor="let n of names">
        <icon name="star"></icon>
        <icon [name]="n"></icon>
      </div>
    </screen>
  `, `current = 'bell'; names = ['home', 'mail'];`);
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(result.code.includes('<RgIcon name={current} />'), result.code);
  assert.ok(result.code.includes('<RgIcon name="star" />'), result.code);
  assert.ok(result.code.includes('<RgIcon name={n} />'), result.code);
});

test('Stage 7 codegen: color binding and [size] expression pass through', () => {
  const result = projectWith(`
    <screen>
      <icon name="bell" [color]="tone" [size]="iconSize"></icon>
    </screen>
  `, `tone = 'primary'; iconSize = 28;`);
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(result.code.includes('<RgIcon name="bell" size={iconSize} color={tone} />'), result.code);
});

test('Stage 7 validation: unknown name is an error carrying the full valid list', () => {
  const result = projectWith(`<screen><icon name="rocket"></icon></screen>`);
  const errs = result.diagnostics.filter((d) => d.code === 'GEN_ICON_UNKNOWN');
  assert.equal(errs.length, 1, JSON.stringify(result.diagnostics));
  assert.equal(hasErrors(result.diagnostics), true);
  const d = errs[0];
  assert.equal(d.severity, 'error');
  assert.ok(d.message.includes("'rocket'"), d.message);
  assert.ok(d.file?.endsWith('icons.component.html'), d.file);
  assert.ok(d.fix?.includes('catalog.md'), d.fix);
  assert.deepEqual(d.validIcons, ICON_NAMES);
  // The JSON form (what `rangular build --json` prints) keeps the list.
  const roundTripped = JSON.parse(JSON.stringify(d));
  assert.deepEqual(roundTripped.validIcons, ICON_NAMES);
});

test('Stage 7 validation: a missing name is an error with a fix', () => {
  const result = projectWith(`<screen><icon></icon></screen>`);
  const errs = result.diagnostics.filter((d) => d.code === 'GEN_ICON_NAME');
  assert.equal(errs.length, 1, JSON.stringify(result.diagnostics));
  assert.equal(errs[0].severity, 'error');
  assert.ok(errs[0].file?.endsWith('icons.component.html'), errs[0].file);
  assert.ok(errs[0].fix && errs[0].fix.length > 10, JSON.stringify(errs[0]));
});

test('Stage 7 validation: off-scale sizes warn and snap, non-numeric size falls back to the default', () => {
  const result = projectWith(`
    <screen>
      <icon name="bell" size="26"></icon>
      <icon name="bell" [size]="22"></icon>
      <icon name="bell" size="big"></icon>
    </screen>
  `);
  assert.equal(hasErrors(result.diagnostics), false, JSON.stringify(result.diagnostics));
  const warns = result.diagnostics.filter((d) => d.code === 'GEN_ICON_SIZE');
  assert.equal(warns.length, 3, JSON.stringify(result.diagnostics));
  for (const w of warns) {
    assert.equal(w.severity, 'warning');
    assert.ok(w.file?.endsWith('icons.component.html'), w.file);
    assert.ok(w.fix && w.fix.length > 10);
  }
  // 26 ties between 24 and 28 and goes to the lower neighbour, like styles;
  // the non-numeric size also lands on 24, the default.
  assert.equal((result.code.match(/size=\{24\}/g) ?? []).length, 2, result.code);
  // A literal [size] binding snaps the same way: 22 ties and goes to 20.
  assert.equal((result.code.match(/size=\{20\}/g) ?? []).length, 1, result.code);
  // A non-numeric static size warns and generates the default size.
  assert.ok(warns.some((w) => w.message.includes("'big'")), JSON.stringify(warns));
  assert.ok(result.code.includes(`size={${DEFAULT_ICON_SIZE}}`), result.code);
});

// --- C: the icons example --------------------------------------------------------------

test('icons example: zero diagnostics, doctor clean, golden and style snapshot match', () => {
  const { dir, entry, result } = compileExample('icons');
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  const golden = fs.readFileSync(path.join(dir, 'icons.component.tsx'), 'utf8');
  assert.equal(normalize(result.code), normalize(golden));
  const findings = runDoctor({
    result,
    entryFile: entry,
    styleTexts: doctorStyleTexts(result, entry, (abs) => (
      fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : undefined
    )),
  });
  assert.deepEqual(findings, [], JSON.stringify(findings));
  const snap = buildStyleSnapshot('icons', result.component!, result.ast!, result.css!, result.children);
  const committed = JSON.parse(fs.readFileSync(path.join(dir, 'styles.snapshot.json'), 'utf8'));
  assert.deepEqual(snap, committed);
  assert.equal(snap.themes.light.roles.icon.color, colours.light.text);
  assert.equal(snap.themes.dark.roles.icon.color, colours.dark.text);
});

test('icons example: generated code uses only known primitives and no web APIs', () => {
  const code = fs.readFileSync(path.join(ROOT, 'examples', 'icons', 'icons.component.tsx'), 'utf8');
  const allowed = new Set(Object.values(TAG_MAP).map((m) => m.component));
  for (const m of code.matchAll(/export (?:default )?function (\w+)\(/g)) allowed.add(m[1]);
  for (const m of code.matchAll(/(?:^|[\s(])<([A-Z][A-Za-z0-9]*)(?=[\s/>])/gm)) {
    assert.ok(allowed.has(m[1]), `generated JSX element ${m[1]} is not a known primitive`);
  }
  assert.ok(!/\bdocument\.|\bwindow\.|localStorage|sessionStorage|react-dom/.test(code));
});

// --- D: primitives ---------------------------------------------------------------------

test('primitives: RgIcon draws with react-native-svg; appbar and checkbox use real icons', () => {
  const source = fs.readFileSync(path.join(ROOT, 'packages', 'ui', 'src', 'primitives.tsx'), 'utf8');
  assert.ok(source.includes("from 'react-native-svg'"));
  assert.ok(source.includes('export function RgIcon'));
  assert.ok(source.includes('ICON_PATHS'));
  assert.ok(source.includes('<RgIcon name="menu" size={24} color="textMuted" />'));
  assert.ok(source.includes('<RgIcon name="check" size={20} color="onPrimary" />'));
  assert.ok(!source.includes('☰'), 'appbar still fakes the menu with a character');
  assert.ok(!source.includes('✓'), 'a check mark is still faked with a character');
});

// --- E: preview ------------------------------------------------------------------------

test('icons preview: server paint draws every icon with its label, coloured by role variables', () => {
  const { result } = compileExample('icons');
  const html = renderPreview(result.component!, result.ast!, {
    children: result.children,
    services: result.services,
  });
  // 27 set icons + the appbar menu + 4 usage icons, in the server paint
  // (everything before the page script).
  assert.equal((html.split('<script>')[0].match(/<svg /g) ?? []).length, 32);
  for (const name of ICON_NAMES) {
    assert.ok(html.includes(`<path d="${ICON_PATHS[name][0]}"`), `preview missing path for ${name}`);
    assert.ok(html.includes(`>${name}<`), `preview missing label for ${name}`);
  }
  // Colour roles exist as variables in both themes with different values.
  assert.ok(html.includes(`--role-primary: ${colours.light.primary}`));
  assert.ok(html.includes(`--role-primary: ${colours.dark.primary}`));
  // Usage strip: bell in the primary role at 24, heart in error at 28, search at 20.
  assert.ok(html.includes('style="color: var(--role-primary)"><svg width="24"'));
  assert.ok(html.includes('style="color: var(--role-error)"><svg width="28"'));
  assert.ok(html.includes('<span class="icon"><svg width="20"'));
});

// --- Preview DOM shim (same pattern as Stage 6, innerHTML recorded) ---------------------

class ShimText {
  constructor(private text: string) {}
  get textContent(): string { return this.text; }
}

class ShimElement {
  className = '';
  disabled = false;
  markup = '';
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
  set innerHTML(value: string) { this.children = []; this.markup = value; }
  get innerHTML(): string { return this.markup; }
  set textContent(value: string) { this.children = [new ShimText(value)]; }
  get textContent(): string { return this.children.map((c) => c.textContent).join(''); }
}

function loadPreview(html: string): ShimElement {
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
  return app;
}

function findAll(el: ShimElement, pred: (e: ShimElement) => boolean, out: ShimElement[] = []): ShimElement[] {
  if (pred(el)) out.push(el);
  for (const child of el.children) {
    if (child instanceof ShimElement) findAll(child, pred, out);
  }
  return out;
}

test('icons preview behaviour: the page runtime draws the same paths as the server paint', () => {
  const { result } = compileExample('icons');
  const html = renderPreview(result.component!, result.ast!, {
    children: result.children,
    services: result.services,
  });
  const app = loadPreview(html);
  const iconEls = findAll(app, (e) => e.className === 'icon');
  // 27 in the *ngFor set + appbar menu + 4 usage icons, all drawn at runtime.
  assert.equal(iconEls.length, 32);
  const runtimeMarkup = iconEls.map((e) => e.markup).join('\n');
  for (const name of ICON_NAMES) {
    // Parity: the identical path data the server painted and RgIcon ships.
    assert.ok(runtimeMarkup.includes(`<path d="${ICON_PATHS[name][0]}"/>`), `runtime missing path for ${name}`);
    assert.ok(app.textContent.includes(name), `runtime missing label for ${name}`);
  }
  // Sizes survive: the heart usage icon is drawn at 28, the search at 20.
  assert.ok(runtimeMarkup.includes('width="28" height="28"'));
  assert.ok(runtimeMarkup.includes('width="20" height="20"'));
  // Colour roles survive: bell carries the primary role variable.
  const bell = iconEls.find((e) => e.markup.includes(ICON_PATHS['bell'][0])
    && (e.getAttribute('style') ?? '').includes('--role-primary'));
  assert.ok(bell, 'bell icon lost its primary role colour');
});
