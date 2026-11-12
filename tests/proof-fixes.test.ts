import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { compileComponent, CompileResult } from '../packages/compiler/src/compile';
import { buildCatalog } from '../packages/compiler/src/catalog';
import { renderPreview } from '../packages/compiler/src/preview/renderPreview';
import { formatDateValue } from '../packages/compiler/src/template/pipes';

/**
 * Proof fixes: the defects and gaps the Stage 12 fresh-AI proof test
 * exposed. Fix 1: array mutation methods on fields were silently
 * broken in generated code while the preview masked it (parity).
 * Fix 2: a never-assigned field with a non-literal initializer
 * (today = new Date()) warned and was never declared, so the output
 * did not compile. Fix 3: the init --app README recompile command
 * mixed path bases and could not run from any single directory.
 */

const ROOT = path.join(__dirname, '..', '..');
const cliPath = path.join(ROOT, 'dist', 'packages', 'cli', 'src', 'cli.js');
const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

function compileClass(classBody: string, template = '<p>x</p>'): CompileResult {
  const tsSource = `
    import { Component } from '@angular/core';
    @Component({ selector: 'app-t', template: ${JSON.stringify(template)} })
    export class TComponent { ${classBody} }
  `;
  return compileComponent({ tsSource });
}

function compileProject(files: Record<string, string>, entryName = 'app.component.ts'): CompileResult {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rangular-proof-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  const entry = path.join(dir, entryName);
  return compileComponent({
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
}

// --- Fix 1: array mutation methods on fields --------------------------------

test('Fix 1 codegen: push on a field hoists it to state and becomes a concat setter call, silently no more', () => {
  const result = compileClass(`
    newHabit = '';
    habits = ['Morning yoga'];
    addHabit() { if (this.newHabit) { this.habits.push(this.newHabit); this.newHabit = ''; } }
  `, '<p>{{ habits.length }} habits</p>');
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.match(result.code!, /const \[habits, setHabits\] = useState\(\['Morning yoga'\]\);/);
  assert.match(result.code!, /setHabits\(habits\.concat\(newHabit\)\);/);
  assert.doesNotMatch(result.code!, /\.push\(/);
});

test('Fix 1 codegen: push passes every argument through to concat', () => {
  const result = compileClass(`
    items = [1];
    add(a: number, b: number) { this.items.push(a, b); }
  `);
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.match(result.code!, /setItems\(items\.concat\(a, b\)\);/);
});

test('Fix 1 codegen: pop and shift as bare statements become slice setter calls', () => {
  const result = compileClass(`
    items = [1, 2, 3];
    dropLast() { this.items.pop(); }
    dropFirst() { this.items.shift(); }
  `);
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.match(result.code!, /setItems\(items\.slice\(0, -1\)\);/);
  assert.match(result.code!, /setItems\(items\.slice\(1\)\);/);
});

test('Fix 1 codegen: splice as a statement warns METHOD_UNSUPPORTED and teaches the assignment form', () => {
  const result = compileClass(`
    items = [1, 2, 3];
    cut() { this.items.splice(0, 1); }
  `);
  const diag = result.diagnostics.find((d) => d.code === 'METHOD_UNSUPPORTED');
  assert.ok(diag, JSON.stringify(result.diagnostics));
  assert.equal(diag!.severity, 'warning');
  assert.ok(diag!.fix?.includes('Assign a new array instead'), diag!.fix);
  assert.ok(diag!.fix?.includes('this.items = [...this.items, item]'), diag!.fix);
  assert.match(result.code!, /TODO\(Rangular\): unsupported in method 'cut': array mutation method 'splice'/);
  assert.doesNotMatch(result.code!, /\.splice\(/);
});

test('Fix 1 codegen: unshift, sort, reverse and fill as statements warn the same way', () => {
  for (const stmt of ['this.items.unshift(0);', 'this.items.sort();', 'this.items.reverse();', 'this.items.fill(0);']) {
    const result = compileClass(`
      items = [1, 2, 3];
      m() { ${stmt} }
    `);
    const diag = result.diagnostics.find((d) => d.code === 'METHOD_UNSUPPORTED');
    assert.ok(diag, `${stmt} should warn: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(diag!.fix?.includes('Assign a new array instead'), diag!.fix);
  }
});

test('Fix 1 codegen: pop whose return value is used warns instead of translating', () => {
  const result = compileClass(`
    items = [1, 2, 3];
    last = 0;
    take() { this.last = this.items.pop(); }
  `);
  const diag = result.diagnostics.find((d) => d.code === 'METHOD_UNSUPPORTED');
  assert.ok(diag, JSON.stringify(result.diagnostics));
  assert.ok(diag!.message.includes("'pop'"), diag!.message);
  assert.ok(diag!.message.includes('used as a value'), diag!.message);
  assert.ok(diag!.fix?.includes('Assign a new array instead'), diag!.fix);
  assert.doesNotMatch(result.code!, /\.pop\(\)/);
});

test('Fix 1 codegen: a mutation call on a field that cannot become state warns, never emits a setter for it', () => {
  const result = compileClass(`
    items = buildItems();
    add() { this.items.push(4); }
  `);
  assert.ok(
    result.diagnostics.some((d) => d.code === 'METHOD_UNSUPPORTED'),
    JSON.stringify(result.diagnostics),
  );
  assert.doesNotMatch(result.code!, /setItems\(/);
});

// --- Fix 1: preview behaviour mirrors the app outcome -------------------------

class ShimText {
  constructor(private text: string) {}
  get textContent(): string { return this.text; }
}

class ShimElement {
  className = '';
  disabled = false;
  value = '';
  type = '';
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
  dispatch(type: string): void {
    for (const fn of this.listeners.get(type) ?? []) fn({});
  }
  click(): void { this.dispatch('click'); }
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

function hasClass(el: ShimElement, name: string): boolean {
  return el.className.split(/\s+/).includes(name);
}

function buttonWith(app: ShimElement, label: string): ShimElement {
  const btn = findAll(app, (e) => hasClass(e, 'btn')).find((e) => e.textContent.includes(label));
  assert.ok(btn, `button ${label} exists`);
  return btn!;
}

const HABIT_FILES = {
  'app.component.ts': `
    import { Component } from '@angular/core';
    @Component({ selector: 'app-habits', templateUrl: './app.component.html' })
    export class HabitsComponent {
      newHabit = '';
      habits = ['Morning yoga'];
      addHabit() { if (this.newHabit) { this.habits.push(this.newHabit); this.newHabit = ''; } }
      dropFirst() { this.habits.shift(); }
      dropLast() { this.habits.pop(); }
    }
  `,
  'app.component.html': `
    <screen>
      <h1>Habits</h1>
      <input label="New habit" [(ngModel)]="newHabit">
      <button (click)="addHabit()">Add</button>
      <button (click)="dropFirst()">Drop first</button>
      <button (click)="dropLast()">Drop last</button>
      <p>{{ habits.length }} habits</p>
      <list>
        <row *ngFor="let h of habits" [title]="h"></row>
      </list>
    </screen>
  `,
};

test('Fix 1 codegen: the proof habit flow compiles clean with concat and slice setters', () => {
  const result = compileProject(HABIT_FILES);
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.match(result.code!, /const \[habits, setHabits\] = useState\(\['Morning yoga'\]\);/);
  assert.match(result.code!, /setHabits\(habits\.concat\(newHabit\)\);/);
  assert.match(result.code!, /setHabits\(habits\.slice\(1\)\);/);
  assert.match(result.code!, /setHabits\(habits\.slice\(0, -1\)\);/);
});

test('Fix 1 preview behaviour: add grows the list, shift and pop shrink it, like the app', () => {
  const result = compileProject(HABIT_FILES);
  const html = renderPreview(result.component!, result.ast!, {
    children: result.children,
    services: result.services,
  });
  const app = loadPreview(html);
  assert.ok(app.textContent.includes('Morning yoga'));
  assert.ok(app.textContent.includes('1 habits'));

  const input = findAll(app, (e) => e.tagName === 'INPUT')[0];
  input.value = 'Evening walk';
  input.dispatch('input');
  buttonWith(app, 'Add').click();
  assert.ok(app.textContent.includes('Evening walk'), 'the pushed habit renders');
  assert.ok(app.textContent.includes('2 habits'));

  buttonWith(app, 'Drop first').click();
  assert.ok(!app.textContent.includes('Morning yoga'), 'shift removed the first habit');
  assert.ok(app.textContent.includes('Evening walk'));
  assert.ok(app.textContent.includes('1 habits'));

  buttonWith(app, 'Drop last').click();
  assert.ok(!app.textContent.includes('Evening walk'), 'pop removed the last habit');
  assert.ok(app.textContent.includes('0 habits'));
});

// --- Fix 2: verbatim non-literal initializers ---------------------------------

test('Fix 2 codegen: today = new Date() is emitted verbatim, with no GEN_FIELD warning', () => {
  const result = compileClass(`
    today = new Date();
  `, "<p>{{ today | date:'shortDate' }}</p>");
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.match(result.code!, /const today = new Date\(\);/);
});

test('Fix 2 codegen: Date.now() and literal expressions are emitted verbatim too', () => {
  const result = compileClass(`
    stamp = Date.now();
    limit = 2 * 60 * 1000;
  `, '<p>{{ stamp }} {{ limit }}</p>');
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.match(result.code!, /const stamp = Date\.now\(\);/);
  assert.match(result.code!, /const limit = 2 \* 60 \* 1000;/);
});

test('Fix 2 preview: the date pipe line renders the real date in the paint and in the page', () => {
  const result = compileProject({
    'app.component.ts': `
      import { Component } from '@angular/core';
      @Component({ selector: 'app-today', templateUrl: './app.component.html' })
      export class TodayComponent { today = new Date(); }
    `,
    'app.component.html': `<screen><p>Today is {{ today | date:'yyyy-MM-dd' }}</p></screen>`,
  });
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  const expected = formatDateValue(new Date(), 'yyyy-MM-dd');
  assert.ok(typeof expected === 'string' && expected.length === 10, String(expected));
  const html = renderPreview(result.component!, result.ast!, {
    children: result.children,
    services: result.services,
  });
  const paint = html.split('<script>')[0];
  assert.ok(paint.includes(`Today is ${expected}`), `paint shows the date: ${normalize(paint)}`);
  const app = loadPreview(html);
  assert.ok(app.textContent.includes(`Today is ${expected}`), 'the page rebuilt the Date from EXPR_INITS');
});

test('Fix 2 preview: a child component with a Date field paints its date too', () => {
  const result = compileProject({
    'app.component.ts': `
      import { Component } from '@angular/core';
      import { TodayComponent } from './today.component';
      @Component({ selector: 'app-root', template: '<screen><app-today></app-today></screen>' })
      export class AppComponent {}
    `,
    'today.component.ts': `
      import { Component } from '@angular/core';
      @Component({ selector: 'app-today', template: "<p>Child date {{ today | date:'yyyy-MM-dd' }}</p>" })
      export class TodayComponent { today = new Date(); }
    `,
  });
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  const expected = formatDateValue(new Date(), 'yyyy-MM-dd');
  const html = renderPreview(result.component!, result.ast!, {
    children: result.children,
    services: result.services,
  });
  const paint = html.split('<script>')[0];
  assert.ok(paint.includes(`Child date ${expected}`), `child paint shows the date: ${normalize(paint)}`);
  const app = loadPreview(html);
  assert.ok(app.textContent.includes(`Child date ${expected}`), 'the page rebuilt the child Date');
});

test('Fix 2 codegen: an initializer referencing this stays warned, but the name is always declared', () => {
  const result = compileClass(`
    base = 'x';
    label = this.base + 'y';
  `, '<p>{{ label }}</p>');
  const diag = result.diagnostics.find((d) => d.code === 'GEN_FIELD');
  assert.ok(diag, JSON.stringify(result.diagnostics));
  assert.equal(diag!.severity, 'warning');
  assert.match(result.code!, /const label = undefined;/);
  assert.match(result.code!, /TODO: field 'label'/);
  assert.ok(result.code!.includes('{label}'), 'template reads resolve to the declared name');
});

test('Fix 2 codegen: a mutated non-literal field keeps the GEN_FIELD_STATE path and is declared', () => {
  const result = compileClass(`
    items = buildItems();
    clear() { this.items = []; }
  `, '<p>{{ items.length }}</p>');
  assert.ok(
    result.diagnostics.some((d) => d.code === 'GEN_FIELD_STATE'),
    JSON.stringify(result.diagnostics),
  );
  assert.match(result.code!, /const items = undefined;/);
});

// --- Item 5 (code part): the void element mismatch fix --------------------------

test('TPL_MISMATCH: a stray </input> fix line says input takes no closing tag', () => {
  const result = compileClass(`
    name = '';
  `, '<card><input [(ngModel)]="name"></input></card>');
  const diag = result.diagnostics.find((d) => d.code === 'TPL_MISMATCH');
  assert.ok(diag, JSON.stringify(result.diagnostics));
  assert.ok(diag!.fix?.includes('void element'), diag!.fix);
  assert.ok(diag!.fix?.includes('takes no closing tag'), diag!.fix);
  assert.ok(diag!.fix?.includes('</input>'), diag!.fix);
});

test('TPL_MISMATCH: an ordinary mismatch keeps the nesting fix line', () => {
  const result = compileClass('', '<card><p>Hi</card>');
  const diag = result.diagnostics.find((d) => d.code === 'TPL_MISMATCH');
  assert.ok(diag, JSON.stringify(result.diagnostics));
  assert.ok(diag!.fix?.includes('mis-nested'), diag!.fix);
});

// --- Item 11: the catalog lists the prop callers pass ---------------------------

test('catalog: RgScreen lists theme (the prop codegen emits), not the local alias mode', () => {
  const catalog = buildCatalog();
  const screen = catalog.primitives.find((p) => p.name === 'RgScreen');
  assert.ok(screen, 'RgScreen is catalogued');
  const names = screen!.props.map((p) => p.name);
  assert.ok(names.includes('theme'), JSON.stringify(names));
  assert.ok(!names.includes('mode'), JSON.stringify(names));
  // A genuine mode prop stays mode: the picker and the theme provider.
  const picker = catalog.primitives.find((p) => p.name === 'RgDateTimePicker');
  assert.ok(picker!.props.map((p) => p.name).includes('mode'));
  const provider = catalog.primitives.find((p) => p.name === 'RgThemeProvider');
  assert.ok(provider!.props.map((p) => p.name).includes('mode'));
});

// --- Fix 3: the scaffold README command runs as written -------------------------

function runCli(args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  const run = spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: 'utf8' });
  return { status: run.status ?? -1, stdout: run.stdout, stderr: run.stderr };
}

test('Fix 3 scaffold: the README recompile command is repo-root relative and runs as written', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rangular-proof-scaffold-'));
  const appDir = path.join(tmp, 'nested', 'habit-app');
  // Scaffold from a working directory that is neither the repo root
  // nor the app parent: the README must not depend on it.
  const run = runCli(['init', appDir, '--app'], tmp);
  assert.equal(run.status, 0, run.stderr);

  const readme = fs.readFileSync(path.join(appDir, 'README.md'), 'utf8');
  const entryAbs = path.join(appDir, 'src', 'app.component.ts');
  const outAbs = path.join(appDir, 'src', 'AppRoot.tsx');
  const relEntry = path.relative(ROOT, entryAbs).split(path.sep).join('/');
  const relOut = path.relative(ROOT, outAbs).split(path.sep).join('/');
  assert.ok(
    readme.includes(`build ${relEntry} --out ${relOut}`),
    `README build command uses repo-root relative paths:\n${readme}`,
  );
  // Every path the command names exists relative to the stated
  // directory, the Rangular repo root.
  assert.ok(fs.existsSync(path.resolve(ROOT, relEntry)), 'the component path resolves from the repo root');
  assert.ok(fs.existsSync(path.resolve(ROOT, relOut)), 'the output path resolves from the repo root');
  assert.ok(readme.includes('From the Rangular repo root') || readme.includes('from the Rangular repo root'));

  // And the command, run exactly as written from the repo root, works.
  const before = fs.readFileSync(outAbs, 'utf8');
  const rebuild = runCli(['build', relEntry, '--out', relOut], ROOT);
  assert.equal(rebuild.status, 0, rebuild.stderr);
  assert.equal(fs.readFileSync(outAbs, 'utf8'), before, 'the documented rebuild reproduces AppRoot.tsx');

  // The preview guidance line is present and its paths resolve too.
  const relPreview = path.relative(ROOT, path.join(appDir, 'preview.html')).split(path.sep).join('/');
  assert.ok(
    readme.includes(`preview ${relEntry} --out ${relPreview}`),
    `README preview command:\n${readme}`,
  );
});
