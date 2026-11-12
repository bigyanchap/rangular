import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { spawn, spawnSync } from 'node:child_process';
import { compileComponent, CompileResult, hasErrors } from '../packages/compiler/src/compile';
import { buildStyleSnapshot } from '../packages/compiler/src/preview/styleSnapshot';
import { renderPreview } from '../packages/compiler/src/preview/renderPreview';
import { doctorStyleTexts, runDoctor } from '../packages/compiler/src/doctor';
import { encodeVlq } from '../packages/compiler/src/codegen/sourceMap';
import { SUPPORTED_STYLE_PROPERTIES } from '../packages/compiler/src/style/css';
import { TAG_MAP } from '../packages/compiler/src/codegen/generate';
import { colours } from '../packages/ui/src/tokens';

const ROOT = path.join(__dirname, '..', '..');
const cliPath = path.join(ROOT, 'dist', 'packages', 'cli', 'src', 'cli.js');
const EXAMPLES = ['hello', 'counter', 'inbox', 'profile', 'favourite', 'shared-inbox', 'showcase', 'dinacharya-row'];
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rangular-s5-'));
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

// --- A3: per-file diagnostics ---------------------------------------------------

test('per-file diagnostics: a broken template names the .html file', () => {
  const { result } = compileProject({
    'x.component.ts': `
      import { Component } from '@angular/core';
      @Component({ selector: 'app-x', templateUrl: './x.component.html' })
      export class XComponent { title = 'Hi'; }
    `,
    'x.component.html': '<screen><h1>{{ title </h1></screen>',
  }, 'x.component.ts');
  const diag = result.diagnostics.find((d) => d.code === 'TPL_INTERPOLATION');
  assert.ok(diag, JSON.stringify(result.diagnostics));
  assert.ok(diag!.file?.endsWith('x.component.html'), diag!.file);
});

test('per-file diagnostics: a class error names the .ts file', () => {
  const { result } = compileProject({
    'x.component.ts': `
      import { Component } from '@angular/core';
      @Component({ selector: 'app-x', template: '<p>x</p>' })
      export class XComponent { constructor(private nope: MissingService) {} }
    `,
  }, 'x.component.ts');
  const diag = result.diagnostics.find((d) => d.code === 'DI_UNKNOWN_TOKEN');
  assert.ok(diag, JSON.stringify(result.diagnostics));
  assert.ok(diag!.file?.endsWith('x.component.ts'), diag!.file);
});

test('CLI build --json carries the per-diagnostic file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rangular-s5cli-'));
  const tsFile = path.join(dir, 'x.component.ts');
  fs.writeFileSync(path.join(dir, 'x.component.html'), '<screen><h1>{{ title </h1></screen>');
  fs.writeFileSync(tsFile, `
    import { Component } from '@angular/core';
    @Component({ selector: 'app-x', templateUrl: './x.component.html' })
    export class XComponent { title = 'Hi'; }
  `);
  const run = spawnSync('node', [cliPath, 'build', tsFile, '--out', path.join(dir, 'x.tsx'), '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  const payload = JSON.parse(run.stdout);
  const diag = payload.diagnostics.find((d: { code: string }) => d.code === 'TPL_INTERPOLATION');
  assert.ok(diag.file.endsWith('x.component.html'), JSON.stringify(diag));
  assert.equal(payload.file, 'x.component.ts');
});

// --- B: source maps ---------------------------------------------------------------

const B64D = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeVlq(str: string, start: number): [number, number] {
  let result = 0;
  let shift = 0;
  let i = start;
  let digit = 0;
  do {
    digit = B64D.indexOf(str[i++]);
    result |= (digit & 31) << shift;
    shift += 5;
  } while (digit & 32);
  const negative = result & 1;
  result >>= 1;
  return [negative ? -result : result, i];
}

interface DecodedSegment { genLine: number; genCol: number; src: number; srcLine: number; srcCol: number }

function decodeMappings(mappings: string): DecodedSegment[] {
  const segs: DecodedSegment[] = [];
  let src = 0;
  let srcLine = 0;
  let srcCol = 0;
  mappings.split(';').forEach((lineStr, genLine) => {
    let genCol = 0;
    if (!lineStr) return;
    for (const part of lineStr.split(',')) {
      let i = 0;
      let v = 0;
      [v, i] = decodeVlq(part, i); genCol += v;
      [v, i] = decodeVlq(part, i); src += v;
      [v, i] = decodeVlq(part, i); srcLine += v;
      [v, i] = decodeVlq(part, i); srcCol += v;
      segs.push({ genLine, genCol, src, srcLine, srcCol });
    }
  });
  return segs;
}

test('VLQ encoder round-trips through the test decoder', () => {
  for (const n of [0, 1, -1, 5, -5, 63, -64, 12345, -12345]) {
    const [decoded] = decodeVlq(encodeVlq(n), 0);
    assert.equal(decoded, n);
  }
});

test('source map: version 3, template and class sources, decodable segments', () => {
  const dir = path.join(ROOT, 'examples', 'counter');
  const entry = path.join(dir, 'counter.component.ts');
  const result = compileComponent({
    tsSource: fs.readFileSync(entry, 'utf8'),
    fileName: entry,
    resolveFile: (rel) => fs.readFileSync(path.join(dir, rel), 'utf8'),
    sourceMap: true,
  });
  const map = result.sourceMap;
  assert.ok(map, 'sourceMap present when requested');
  assert.equal(map!.version, 3);
  const htmlIdx = map!.sources.findIndex((s) => s.endsWith('counter.component.html'));
  const tsIdx = map!.sources.findIndex((s) => s.endsWith('counter.component.ts'));
  assert.ok(htmlIdx >= 0 && tsIdx >= 0, JSON.stringify(map!.sources));
  assert.ok(Array.isArray(map!.sourcesContent));
  const segs = decodeMappings(map!.mappings);
  assert.ok(segs.length >= 5, `expected several segments, got ${segs.length}`);
  for (const s of segs) assert.ok(s.src < map!.sources.length);
  // The <screen> element sits at template line 1 (0-based 0).
  assert.ok(segs.some((s) => s.src === htmlIdx && s.srcLine === 0), JSON.stringify(segs));
  // The generated function start maps back to the class file.
  const fnLine = result.code.split('\n').findIndex((l) => l.startsWith('export default function Counter('));
  assert.ok(fnLine >= 0);
  assert.ok(segs.some((s) => s.genLine === fnLine && s.src === tsIdx), JSON.stringify(segs));
});

test('source map: not produced unless requested', () => {
  const { result } = compileExample('counter');
  assert.equal(result.sourceMap, undefined);
});

test('CLI build --source-map writes the .map file and the comment; without the flag, neither', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rangular-s5map-'));
  const src = path.join(ROOT, 'examples', 'counter', 'counter.component.ts');
  const out = path.join(dir, 'counter.tsx');
  const withMap = spawnSync('node', [cliPath, 'build', src, '--out', out, '--source-map', '--json'], { encoding: 'utf8' });
  assert.equal(withMap.status, 0, withMap.stdout + withMap.stderr);
  const payload = JSON.parse(withMap.stdout);
  assert.equal(payload.sourceMapFile, `${out}.map`);
  assert.ok(fs.existsSync(`${out}.map`));
  const map = JSON.parse(fs.readFileSync(`${out}.map`, 'utf8'));
  assert.equal(map.version, 3);
  assert.equal(map.file, 'counter.tsx');
  assert.ok(map.sources.some((s: string) => s.endsWith('counter.component.html')));
  const code = fs.readFileSync(out, 'utf8');
  assert.ok(code.trimEnd().endsWith('//# sourceMappingURL=counter.tsx.map'));
  // Apart from the comment line the output is the usual golden code.
  assert.equal(normalize(code.split('//# sourceMappingURL=')[0]), normalize(fs.readFileSync(path.join(ROOT, 'examples', 'counter', 'counter.component.tsx'), 'utf8')));

  const out2 = path.join(dir, 'plain.tsx');
  const noMap = spawnSync('node', [cliPath, 'build', src, '--out', out2, '--json'], { encoding: 'utf8' });
  assert.equal(noMap.status, 0);
  assert.ok(!fs.existsSync(`${out2}.map`));
  assert.ok(!fs.readFileSync(out2, 'utf8').includes('sourceMappingURL'));
});

// --- A1: watch ----------------------------------------------------------------------

test('watch: initial compile, then a template edit recompiles, SIGINT exits 0', { timeout: 40000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rangular-s5watch-'));
  const srcDir = path.join(ROOT, 'examples', 'counter');
  const tsFile = path.join(dir, 'counter.component.ts');
  const htmlFile = path.join(dir, 'counter.component.html');
  fs.writeFileSync(tsFile, fs.readFileSync(path.join(srcDir, 'counter.component.ts'), 'utf8'));
  fs.writeFileSync(htmlFile, fs.readFileSync(path.join(srcDir, 'counter.component.html'), 'utf8'));
  const out = path.join(dir, 'counter.component.tsx');
  const child = spawn('node', [cliPath, 'watch', tsFile, '--out', out]);
  let buf = '';
  child.stdout.on('data', (d) => { buf += String(d); });
  child.stderr.on('data', () => undefined);
  const okCount = () => (buf.match(/\] OK /g) ?? []).length;
  const waitFor = async (pred: () => boolean, ms: number): Promise<boolean> => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (pred()) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return pred();
  };
  try {
    assert.ok(await waitFor(() => okCount() >= 1, 20000), `no initial OK in: ${buf}`);
    assert.ok(fs.existsSync(out));
    const html = fs.readFileSync(htmlFile, 'utf8');
    fs.writeFileSync(htmlFile, html.replace('Counter', 'Counter edited'));
    assert.ok(await waitFor(() => okCount() >= 2, 20000), `no second OK in: ${buf}`);
    assert.ok(fs.readFileSync(out, 'utf8').includes('Counter edited'));
  } finally {
    child.kill('SIGINT');
  }
  const exitCode = await new Promise<number | null>((resolve) => child.on('exit', resolve));
  assert.equal(exitCode, 0);
});

// --- A2: init -------------------------------------------------------------------------

test('init: scaffolds a starter that compiles clean and previews; refuses a non-empty dir', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rangular-s5init-')), 'my-app');
  const run = spawnSync('node', [cliPath, 'init', dir], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  for (const rel of ['src/app.component.ts', 'src/app.component.html', 'README.md', '.gitignore']) {
    assert.ok(fs.existsSync(path.join(dir, rel)), rel);
  }
  const tsFile = path.join(dir, 'src', 'app.component.ts');
  const build = spawnSync('node', [cliPath, 'build', tsFile, '--out', path.join(dir, 'src', 'app.component.tsx'), '--json'], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  assert.deepEqual(JSON.parse(build.stdout).diagnostics, []);
  const preview = spawnSync('node', [cliPath, 'preview', tsFile, '--out', path.join(dir, 'preview.html'), '--json'], { encoding: 'utf8' });
  assert.equal(preview.status, 0, preview.stdout + preview.stderr);
  assert.ok(fs.readFileSync(path.join(dir, 'preview.html'), 'utf8').includes('Welcome to Rangular'));
  const again = spawnSync('node', [cliPath, 'init', dir], { encoding: 'utf8' });
  assert.equal(again.status, 1);
  assert.match(again.stderr, /not empty/);
  assert.match(again.stderr, /fix:/);
});

// --- C: doctor ---------------------------------------------------------------------------

const BAD_FILES = {
  'bad.component.ts': `
    import { Component } from '@angular/core';
    @Component({
      selector: 'app-bad',
      template: '<screen><card>Loose words<button class="tiny" (click)="go()">Go</button></card></screen>',
      styles: ['.tiny { width: 30px; height: 30px; color: #ff0000; margin-top: 13px; }'],
    })
    export class BadComponent { go() {} }
  `,
};

test('doctor: the unpolished fixture triggers every rule with file, line and fix', () => {
  const { entry, result } = compileProject(BAD_FILES, 'bad.component.ts');
  const findings = runDoctor({
    result,
    entryFile: entry,
    styleTexts: doctorStyleTexts(result, entry, () => undefined),
  });
  const byCode = new Map(findings.map((f) => [f.code, f]));
  for (const code of ['DOC_HEX_COLOR', 'DOC_OFF_SCALE', 'DOC_RAW_TEXT', 'DOC_TAP_TARGET']) {
    const f = byCode.get(code);
    assert.ok(f, `${code} missing from ${JSON.stringify(findings)}`);
    assert.ok(f!.file?.endsWith('bad.component.ts'), `${code} file: ${f!.file}`);
    assert.ok(typeof f!.line === 'number' && f!.line >= 1, `${code} line`);
    assert.ok(f!.fix && f!.fix.length > 10, `${code} fix`);
  }
  assert.equal(byCode.get('DOC_TAP_TARGET')!.severity, 'error');
  assert.equal(byCode.get('DOC_HEX_COLOR')!.severity, 'warning');
  assert.equal(byCode.get('DOC_OFF_SCALE')!.severity, 'warning');
  assert.equal(byCode.get('DOC_RAW_TEXT')!.severity, 'warning');
});

test('doctor: the allow-hex suppression comment silences DOC_HEX_COLOR only', () => {
  const { entry, result } = compileProject({
    'ok.component.ts': `
      import { Component } from '@angular/core';
      @Component({
        selector: 'app-ok',
        template: '<screen><p>Hi</p></screen>',
        styles: ['/* doctor: allow-hex: brand colour */ .x { color: #123456; margin-top: 13px; }'],
      })
      export class OkComponent {}
    `,
  }, 'ok.component.ts');
  const findings = runDoctor({
    result,
    entryFile: entry,
    styleTexts: doctorStyleTexts(result, entry, () => undefined),
  });
  assert.ok(!findings.some((f) => f.code === 'DOC_HEX_COLOR'), JSON.stringify(findings));
  assert.ok(findings.some((f) => f.code === 'DOC_OFF_SCALE'), 'other rules still run');
});

test('doctor: showcase passes with no errors; dinacharya-row is fully clean', () => {
  const showcase = compileExample('showcase');
  const showcaseFindings = runDoctor({
    result: showcase.result,
    entryFile: showcase.entry,
    styleTexts: doctorStyleTexts(showcase.result, showcase.entry, (abs) => (
      fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : undefined
    )),
  });
  assert.equal(hasErrors(showcaseFindings), false, JSON.stringify(showcaseFindings));
  const cli = spawnSync('node', [cliPath, 'doctor', showcase.entry], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);

  const dina = compileExample('dinacharya-row');
  const dinaFindings = runDoctor({
    result: dina.result,
    entryFile: dina.entry,
    styleTexts: doctorStyleTexts(dina.result, dina.entry, (abs) => (
      fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : undefined
    )),
  });
  assert.deepEqual(dinaFindings, [], JSON.stringify(dinaFindings));
});

test('CLI doctor --json: shape, exit 1 on the error finding', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rangular-s5doc-'));
  const tsFile = path.join(dir, 'bad.component.ts');
  fs.writeFileSync(path.join(dir, 'bad.component.html'), '<screen><card>Loose<button class="tiny" (click)="go()">Go</button></card></screen>');
  fs.writeFileSync(tsFile, `
    import { Component } from '@angular/core';
    @Component({
      selector: 'app-bad',
      templateUrl: './bad.component.html',
      styles: ['.tiny { width: 30px; height: 30px; color: #ff0000; }'],
    })
    export class BadComponent { go() {} }
  `);
  const run = spawnSync('node', [cliPath, 'doctor', tsFile, '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 1, run.stdout + run.stderr);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, false);
  const tap = payload.diagnostics.find((d: { code: string }) => d.code === 'DOC_TAP_TARGET');
  assert.ok(tap, JSON.stringify(payload.diagnostics));
  assert.ok(tap.file.endsWith('bad.component.html'));
  assert.equal(typeof tap.line, 'number');
  assert.equal(typeof tap.fix, 'string');
});

// --- E: dogfood example ----------------------------------------------------------------------

test('dogfood: dinacharya-row compiles with zero diagnostics and matches its golden', () => {
  const { dir, result } = compileExample('dinacharya-row');
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  const golden = fs.readFileSync(path.join(dir, 'dinacharya-row.component.tsx'), 'utf8');
  assert.equal(normalize(result.code), normalize(golden));
  // The real app's values survive untouched: 34 by 34 is not snapped, gold is gold.
  assert.match(result.code, /checkOn: \{"width":34,"height":34,"borderRadius":12,"backgroundColor":"#d9a441"/);
});

test('dogfood: preview behaviour, tapping the featured row toggles the check square', () => {
  const { result } = compileExample('dinacharya-row');
  const html = renderPreview(result.component!, result.ast!, {
    children: result.children,
    services: result.services,
  });
  const app = loadPreview(html);
  assert.ok(app.textContent.includes('Morning Yoga'));
  assert.ok(app.textContent.includes('3 pieces, 2 done'));
  // Featured row starts not done: only the Puja row shows a check mark.
  assert.equal((app.textContent.match(/✓/g) ?? []).length, 1);
  const rows = findAll(app, (e) => e.className === 'row');
  assert.equal(rows.length, 4);
  rows[0].click();
  assert.equal((app.textContent.match(/✓/g) ?? []).length, 2);
  assert.ok(app.textContent.includes('Morning Yoga is done'));
  findAll(app, (e) => e.className === 'row')[0].click();
  assert.equal((app.textContent.match(/✓/g) ?? []).length, 1);
});

// --- D: style snapshot goldens ------------------------------------------------------------------

test('style snapshots: every example matches its committed styles.snapshot.json', () => {
  for (const name of EXAMPLES) {
    const { dir, result } = compileExample(name);
    const snap = buildStyleSnapshot(name, result.component!, result.ast!, result.css!, result.children);
    const committed = JSON.parse(fs.readFileSync(path.join(dir, 'styles.snapshot.json'), 'utf8'));
    assert.deepEqual(snap, committed, `${name} style snapshot drifted; regenerate it deliberately if the change is intended`);
  }
});

test('style snapshots: both themes resolve from the token values, dogfood gold is pinned', () => {
  const { result } = compileExample('dinacharya-row');
  const snap = buildStyleSnapshot('dinacharya-row', result.component!, result.ast!, result.css!, result.children);
  assert.equal(snap.themes.light.roles.screen.background, colours.light.background);
  assert.equal(snap.themes.dark.roles.screen.background, colours.dark.background);
  assert.notEqual(snap.themes.light.roles.appbar.background, snap.themes.dark.roles.appbar.background);
  assert.equal(snap.themes.light.styles['check-on'].backgroundColor, '#d9a441');
  assert.equal(snap.themes.light.styles['check-on'].width, 34);
});

// --- Parity guard (preview promise) ---------------------------------------------------------------

test('parity guard: generated goldens contain no web-only APIs, tags or style properties', () => {
  const webApis = [/\bdocument\./, /\bwindow\./, /\blocalStorage\b/, /\bsessionStorage\b/, /react-dom/];
  const webTags = ['div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'img', 'ul', 'li', 'button', 'input', 'form', 'section', 'header'];
  const webTagRe = new RegExp(`</?(?:${webTags.join('|')})[\\s/>]`);
  // Every generated JSX element must be a React Native or @rangular/ui
  // component from TAG_MAP, or a component function generated in the same
  // file (child components). Type generics like get<MailService> are not
  // JSX: the pattern only matches a tag that follows whitespace, '(' or
  // the start of a line, never an identifier character.
  const tagMapComponents = new Set(Object.values(TAG_MAP).map((m) => m.component));
  for (const name of EXAMPLES) {
    const code = fs.readFileSync(path.join(ROOT, 'examples', name, `${name}.component.tsx`), 'utf8');
    for (const re of webApis) assert.ok(!re.test(code), `${name}: web API ${re} leaked into generated code`);
    assert.ok(!webTagRe.test(code), `${name}: a web tag leaked into generated JSX`);
    const allowed = new Set(tagMapComponents);
    for (const m of code.matchAll(/export (?:default )?function (\w+)\(/g)) allowed.add(m[1]);
    for (const m of code.matchAll(/(?:^|[\s(])<([A-Z][A-Za-z0-9]*)(?=[\s/>])/gm)) {
      assert.ok(allowed.has(m[1]), `${name}: generated JSX element ${m[1]} is not an RN primitive, a TAG_MAP component or a generated component`);
    }
    const sheetAt = code.indexOf('StyleSheet.create(');
    if (sheetAt >= 0) {
      const sheet = code.slice(sheetAt);
      for (const m of sheet.matchAll(/\{[^{}]*\}/g)) {
        let parsed: Record<string, unknown> | undefined;
        try { parsed = JSON.parse(m[0]); } catch { continue; }
        if (!parsed || typeof parsed !== 'object') continue;
        for (const key of Object.keys(parsed)) {
          assert.ok(
            SUPPORTED_STYLE_PROPERTIES.has(key),
            `${name}: style property ${key} is outside the supported CSS subset`,
          );
        }
      }
    }
  }
});

// --- Preview DOM shim (same pattern as Stage 3 and 4) ----------------------------------------------

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
