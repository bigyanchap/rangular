import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { compileComponent, CompileResult } from '../packages/compiler/src/compile';
import { DIAGNOSTIC_CODES } from '../packages/compiler/src/diagnostics';
import { renderPreview } from '../packages/compiler/src/preview/renderPreview';
import { buildStyleSnapshot } from '../packages/compiler/src/preview/styleSnapshot';
import { applyPipe } from '../packages/compiler/src/template/evaluate';
import {
  formatDateValue, formatNumber, parseDigitsInfo,
} from '../packages/compiler/src/template/pipes';
import { pipe, ObservableLite } from '../packages/runtime/src/index';

const ROOT = path.join(__dirname, '..', '..');
const cliPath = path.join(ROOT, 'dist', 'packages', 'cli', 'src', 'cli.js');
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

function compileProject(
  files: Record<string, string>,
  entryName = 'app.component.ts',
): { dir: string; entry: string; result: CompileResult } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rangular-s12-'));
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

function compileInline(template: string, classBody = '', imports = ''): CompileResult {
  const src = `import { Component } from '@angular/core';
${imports}
@Component({ selector: 'app-test', template: ${JSON.stringify(template)} })
export class TestComponent { ${classBody} }
`;
  return compileProject({ 'app.component.ts': src }).result;
}

function previewOf(result: CompileResult): string {
  return renderPreview(result.component!, result.ast!, {
    children: result.children,
    services: result.services,
    routes: result.routes,
    pipes: result.pipes,
    directives: result.directives,
  });
}

// --- A: built-in pipes, three-way parity -------------------------------------

const leap = new Date(2024, 1, 29, 15, 4, 5);
const PIPE_CASES: [string, unknown, unknown[], unknown][] = [
  ['uppercase', 'rangular', [], 'RANGULAR'],
  ['lowercase', 'RANGULAR', [], 'rangular'],
  ['titlecase', 'hello world', [], 'Hello World'],
  ['json', { a: 1 }, [], '{"a":1}'],
  ['date', leap, ['shortDate'], '2/29/24'],
  ['date', leap, ['mediumDate'], 'Feb 29, 2024'],
  ['date', leap, ['shortTime'], '3:04 PM'],
  ['date', leap, ['yyyy-MM-dd HH:mm:ss'], '2024-02-29 15:04:05'],
  ['date', leap, ['HH:mm'], '15:04'],
  ['date', leap, ['h a'], '3 PM'],
  ['date', '2024-02-29T15:04:05', ['shortDate'], '2/29/24'],
  ['date', 'not a date', ['shortDate'], 'not a date'],
  ['number', 1234567.891, ['1.2-2'], '1,234,567.89'],
  ['number', 5, ['3.2-2'], '005.00'],
  ['number', 0.125, ['1.0-2'], '0.13'],
  ['number', -42.5, ['1.1-1'], '-42.5'],
  ['number', 1000, [], '1,000'],
  ['number', 1.23456, ['bogus'], '1.235'],
  ['percent', 0.756, ['1.0-1'], '75.6%'],
  ['percent', 0.5, [], '50%'],
  ['percent', 1, ['1.2-2'], '100.00%'],
  ['currency', 49.5, ['USD'], '$49.50'],
  ['currency', 49.5, ['EUR'], '€49.50'],
  ['currency', 49.5, ['GBP'], '£49.50'],
  ['currency', 49.5, ['INR'], '₹49.50'],
  ['currency', 49.5, ['NPR'], 'Rs49.50'],
  ['currency', 49.5, ['XYZ'], 'XYZ 49.50'],
  ['currency', 49.5, ['USD', 'code'], 'USD 49.50'],
  ['currency', -3, ['USD'], '-$3.00'],
  ['currency', 5, ['USD', 'symbol', '1.0-0'], '$5'],
  ['slice', 'Angular', [0, 5], 'Angul'],
  ['slice', 'Angular', [-3], 'lar'],
  ['slice', 'Angular', [2], 'gular'],
  ['slice', [1, 2, 3, 4], [-2], [3, 4]],
  ['slice', 42, [0, 1], 42],
  ['keyvalue', { b: 2, a: 1 }, [], [{ key: 'a', value: 1 }, { key: 'b', value: 2 }]],
  ['keyvalue', {}, [], []],
];

test('built-in pipes: the compiler evaluator and the runtime pipe() agree on the full table', () => {
  for (const [name, value, args, expected] of PIPE_CASES) {
    assert.deepEqual(applyPipe(name, value, args), expected, `evaluator ${name}`);
    assert.deepEqual(pipe(name, value, ...(args as never[])), expected, `runtime ${name}`);
  }
});

test('built-in pipes: digitsInfo parsing and the pure formatters', () => {
  assert.deepEqual(parseDigitsInfo('1.2-2'), { minInt: 1, minFrac: 2, maxFrac: 2 });
  assert.deepEqual(parseDigitsInfo(' 3.0-0 '), { minInt: 3, minFrac: 0, maxFrac: 0 });
  assert.deepEqual(parseDigitsInfo('1.2'), { minInt: 1, minFrac: 0, maxFrac: 3 },
    'an unreadable digitsInfo falls back instead of throwing');
  assert.deepEqual(parseDigitsInfo('1.3-2', { minInt: 2, minFrac: 1, maxFrac: 1 }),
    { minInt: 2, minFrac: 1, maxFrac: 1 }, 'maxFrac below minFrac is invalid and falls back');
  assert.deepEqual(parseDigitsInfo(2 as never), { minInt: 1, minFrac: 0, maxFrac: 3 });
  assert.equal(formatNumber(1234.5, { minInt: 1, minFrac: 0, maxFrac: 3 }), '1,234.5');
  assert.equal(formatDateValue(leap, 'medium'), 'Feb 29, 2024, 3:04:05 PM');
  assert.equal(formatDateValue(leap, 'short'), '2/29/24, 3:04 PM');
  assert.equal(formatDateValue(leap, undefined), 'Feb 29, 2024');
});

test('built-in pipes: an unknown pipe name throws in the evaluator and the runtime', () => {
  assert.throws(() => applyPipe('shout', 'x', []), /Unknown pipe 'shout'/);
  assert.throws(() => pipe('shout', 'x'), /Unknown pipe 'shout'/);
});

// --- Preview page harness ------------------------------------------------------

class ShimText {
  constructor(public text: string) {}
  get textContent(): string { return this.text; }
}

class ShimElement {
  className = '';
  disabled = false;
  value = '';
  type = '';
  style: Record<string, string> = {};
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

function loadPreview(html: string): { app: ShimElement; sandbox: Record<string, unknown> } {
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
  const sandbox: Record<string, unknown> = { document: documentShim, console };
  vm.runInNewContext(script, sandbox);
  return { app, sandbox };
}

function findAll(el: ShimElement, pred: (e: ShimElement) => boolean, out: ShimElement[] = []): ShimElement[] {
  if (pred(el)) out.push(el);
  for (const child of el.children) {
    if (child instanceof ShimElement) findAll(child, pred, out);
  }
  return out;
}

type PagePipe = (name: string, value: unknown, args?: unknown[]) => unknown;

test('built-in pipes: the preview page __pipe agrees with the compiler on the same table', () => {
  const { result } = compileExample('pipes-demo');
  const { sandbox } = loadPreview(previewOf(result));
  const pagePipe = sandbox['__pipe'] as PagePipe;
  assert.equal(typeof pagePipe, 'function');
  // Values cross the vm realm boundary, so objects compare by JSON,
  // not by prototype identity.
  const plain = (v: unknown) => JSON.parse(JSON.stringify(v ?? null)) as unknown;
  for (const [name, value, args, expected] of PIPE_CASES) {
    const argList = args.map((a) => a);
    assert.deepEqual(plain(pagePipe(name, value, argList)), plain(expected), `page ${name}`);
  }
});

// --- B: custom pipes -----------------------------------------------------------

test('custom pipes: pipes-demo compiles clean, golden and snapshot are current', () => {
  const { dir, result } = compileExample('pipes-demo');
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  const code = result.code!;
  assert.ok(code.includes('export class ExclaimPipe'), 'the pipe class is emitted');
  assert.ok(code.includes('const __pipeExclaimPipe = new ExclaimPipe();'), 'one shared instance');
  assert.ok(code.includes('__pipeExclaimPipe.transform(name, 3)'), 'a use calls transform on the instance');
  assert.ok(code.includes("pipe('date', day, 'shortDate')"), 'built-ins go through the runtime pipe()');
  assert.ok(code.includes("pipe('keyvalue', facts).map((fact, index)"), 'keyvalue feeds the *ngFor map');
  assert.equal(result.pipes?.length, 1);
  assert.equal(result.pipes![0].pipeName, 'exclaim');
  const committed = fs.readFileSync(path.join(dir, 'pipes-demo.component.tsx'), 'utf8');
  assert.equal(code, committed, 'pipes-demo golden drifted; regenerate it with the CLI if intended');
  const snap = buildStyleSnapshot('pipes-demo', result.component!, result.ast!, result.css!, result.children);
  assert.deepEqual(snap, JSON.parse(fs.readFileSync(path.join(dir, 'styles.snapshot.json'), 'utf8')));
  const committedPreview = fs.readFileSync(path.join(dir, 'preview.html'), 'utf8');
  assert.equal(previewOf(result), committedPreview, 'pipes-demo preview drifted; regenerate it with the CLI if intended');
});

test('custom pipes: the preview paints a single-return transform and the page runs the full body', () => {
  const { result } = compileExample('pipes-demo');
  const html = previewOf(result);
  const paint = html.split('<script>')[0];
  assert.ok(paint.includes('rangular!!!'), 'the static paint evaluates the exclaim pipe');
  assert.ok(paint.includes('2/29/24'), 'the static paint formats the leap date');
  assert.ok(paint.includes('Rs49.50'), 'the static paint formats NPR currency');
  assert.ok(paint.includes('lang: TypeScript'), 'keyvalue entries paint in key order');
  const { sandbox } = loadPreview(html);
  const pagePipe = sandbox['__pipe'] as PagePipe;
  assert.equal(pagePipe('exclaim', 'hey', [2]), 'hey!!');
  assert.equal(pagePipe('exclaim', 'hey', []), 'hey!', 'the default argument applies in the page');
});

test('custom pipes: an unknown pipe is a PIPE_UNKNOWN error listing every known pipe', () => {
  const result = compileProject({
    'app.component.ts': `
      import { Component } from '@angular/core';
      import { ExclaimPipe } from './exclaim.pipe';
      @Component({ selector: 'app-x', template: '<screen><p>{{ name | shout }}</p></screen>' })
      export class XComponent { name = 'hi'; }
    `,
    'exclaim.pipe.ts': `
      import { Pipe } from '@angular/core';
      @Pipe({ name: 'exclaim' })
      export class ExclaimPipe { transform(value: string): string { return value + '!'; } }
    `,
  }).result;
  const diag = result.diagnostics.find((d) => d.code === 'PIPE_UNKNOWN');
  assert.ok(diag, JSON.stringify(result.diagnostics));
  assert.equal(diag!.severity, 'error');
  assert.ok(diag!.message.includes('shout'), 'the message names the unknown pipe');
  assert.ok(diag!.message.includes('exclaim'), 'the message lists the project pipe');
  assert.ok(diag!.message.includes('keyvalue'), 'the message lists the built-ins');
  assert.ok(diag!.fix && diag!.fix.length > 0, 'the diagnostic carries a fix');
  assert.ok(DIAGNOSTIC_CODES['PIPE_UNKNOWN'], 'the code is registered');
});

test('custom pipes: an unsupported transform body degrades with METHOD_UNSUPPORTED', () => {
  const result = compileProject({
    'app.component.ts': `
      import { Component } from '@angular/core';
      import { LoopPipe } from './loop.pipe';
      @Component({ selector: 'app-x', template: '<screen><p>{{ name | loopy }}</p></screen>' })
      export class XComponent { name = 'hi'; }
    `,
    'loop.pipe.ts': `
      import { Pipe } from '@angular/core';
      @Pipe({ name: 'loopy' })
      export class LoopPipe {
        transform(value: string): string {
          try { return value.toUpperCase(); } catch { return value; }
        }
      }
    `,
  }).result;
  const diag = result.diagnostics.find((d) => d.code === 'METHOD_UNSUPPORTED');
  assert.ok(diag, JSON.stringify(result.diagnostics));
  assert.ok(result.code!.includes('TODO'), 'the generated code carries the TODO marker');
});

// --- C: the async pipe -----------------------------------------------------------

test('async pipe: the runtime snapshot helper yields the latest synchronous value or null', () => {
  const two: ObservableLite<string> = {
    subscribe: (next: (v: string) => void) => { next('a'); next('b'); return { unsubscribe: () => {} }; },
  };
  assert.equal(pipe('async', two), 'b');
  const quiet: ObservableLite<string> = {
    subscribe: () => ({ unsubscribe: () => {} }),
  };
  assert.equal(pipe('async', quiet), null);
  assert.equal(pipe('async', null), null);
  assert.equal(pipe('async', 42), 42, 'a non-observable passes through');
});

test('async pipe: generated code subscribes in an effect and unsubscribes on cleanup', () => {
  const result = compileProject({
    'app.component.ts': `
      import { Component } from '@angular/core';
      import { FeedService } from './feed.service';
      @Component({ selector: 'app-x', template: '<screen><p>{{ feed.userName$ | async }}</p></screen>' })
      export class XComponent { constructor(public feed: FeedService) {} }
    `,
    'feed.service.ts': `
      import { Injectable } from '@angular/core';
      import { HttpClient } from '@angular/common/http';
      @Injectable({ providedIn: 'root' })
      export class FeedService {
        userName$: unknown;
        constructor(private http: HttpClient) { this.userName$ = this.http.get('/user'); }
      }
    `,
  }).result;
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  const code = result.code!;
  assert.ok(code.includes('this.userName$ = this.http.get(\'/user\');'),
    'the service stream is a constructor assignment, the supported shape');
  assert.ok(code.includes('useState<any>(null)'), 'the latest value is a state slot');
  assert.ok(code.includes('useEffect(() => {'), 'the subscription lives in an effect');
  assert.ok(code.includes('const __obs = (feed.userName$) as any;'), 'the effect reads the streamed expression');
  assert.ok(code.includes('__obs.subscribe((__v: any) => set__async0(__v))'), 'the effect subscribes');
  assert.ok(code.includes('__sub.unsubscribe()'), 'the cleanup unsubscribes');
  assert.ok(code.includes('{__async0}'), 'the template renders the hook variable');
  assert.ok(!code.includes("pipe('async'"), 'the template use is the hook variable, not a pipe() call');
});

test('async pipe: the preview page subscribes once per observable and re-renders on emission', () => {
  const { result } = compileExample('pipes-demo');
  const { app, sandbox } = loadPreview(previewOf(result));
  const pagePipe = sandbox['__pipe'] as PagePipe;
  let emit: ((v: string) => void) | undefined;
  let subscribes = 0;
  const fake = {
    subscribe: (next: (v: string) => void) => { subscribes++; emit = next; return { unsubscribe: () => {} }; },
  };
  assert.equal(pagePipe('async', fake, []), null, 'nothing emitted yet reads as null');
  assert.equal(pagePipe('async', fake, []), null);
  assert.equal(subscribes, 1, 'the same observable subscribes once across renders');
  emit!('Fresh post');
  assert.equal(pagePipe('async', fake, []), 'Fresh post', 'the latest emission is yielded');
  assert.ok(app.textContent.includes('RANGULAR'), 'the emission re-rendered the page');
});

// --- D: attribute directives -----------------------------------------------------

test('directives: directives-demo compiles clean, golden and snapshot are current', () => {
  const { dir, result } = compileExample('directives-demo');
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  const code = result.code!;
  assert.ok(code.includes('style={{ backgroundColor: (("yellow" || \'\') || \'transparent\') }}'),
    'the static host merges the directive style');
  assert.ok(code.includes('style={{ backgroundColor: ((color || "violet") || \'transparent\') }}'),
    'the bound host resolves binding, then static default, then literal');
  assert.ok(!code.includes('appHighlight='), 'directive attributes never reach the generated props');
  assert.equal(result.directives?.length, 1);
  assert.equal(result.directives![0].attrName, 'appHighlight');
  const committed = fs.readFileSync(path.join(dir, 'directives-demo.component.tsx'), 'utf8');
  assert.equal(code, committed, 'directives-demo golden drifted; regenerate it with the CLI if intended');
  const snap = buildStyleSnapshot('directives-demo', result.component!, result.ast!, result.css!, result.children);
  assert.deepEqual(snap, JSON.parse(fs.readFileSync(path.join(dir, 'styles.snapshot.json'), 'utf8')));
  const committedPreview = fs.readFileSync(path.join(dir, 'preview.html'), 'utf8');
  assert.equal(previewOf(result), committedPreview, 'directives-demo preview drifted; regenerate it with the CLI if intended');
});

test('directives: the preview paint and the page both apply the merged style', () => {
  const { result } = compileExample('directives-demo');
  const html = previewOf(result);
  const paint = html.split('<script>')[0];
  assert.ok(paint.includes('background-color: yellow'), 'the static paint applies the static input');
  assert.ok(paint.includes('background-color: cyan'), 'the static paint applies the bound input');
  const { app } = loadPreview(html);
  const paras = findAll(app, (e) => e.tagName === 'P');
  const byText = (t: string) => paras.find((p) => p.textContent.includes(t))!;
  assert.equal(byText('A static highlight').style['backgroundColor'], 'yellow');
  assert.equal(byText('A bound highlight').style['backgroundColor'], 'cyan');
  assert.equal(byText('No directive here').style['backgroundColor'], undefined);
});

test('directives: a setter for the main input is the other supported shape', () => {
  const files = {
    'app.component.ts': `
      import { Component } from '@angular/core';
      import { TintDirective } from './tint.directive';
      @Component({ selector: 'app-x', template: '<screen><p [appTint]="shade">Tinted</p></screen>' })
      export class XComponent { shade = 'pink'; }
    `,
    'tint.directive.ts': `
      import { Directive, ElementRef, Input } from '@angular/core';
      @Directive({ selector: '[appTint]' })
      export class TintDirective {
        constructor(private el: ElementRef) {}
        @Input() set appTint(value: string) {
          this.el.nativeElement.style.color = value;
        }
      }
    `,
  };
  const result = compileProject(files).result;
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(normalize(result.code!).includes('style={{ color: shade }}'), result.code!);
});

test('directives: a body outside the subset warns DIR_UNSUPPORTED and the host still renders', () => {
  const files = {
    'app.component.ts': `
      import { Component } from '@angular/core';
      import { LoudDirective } from './loud.directive';
      @Component({ selector: 'app-x', template: '<screen><p appLoud="x">Text</p></screen>' })
      export class XComponent {}
    `,
    'loud.directive.ts': `
      import { Directive, ElementRef, Input } from '@angular/core';
      @Directive({ selector: '[appLoud]' })
      export class LoudDirective {
        @Input() appLoud = '';
        constructor(private el: ElementRef) {}
        ngOnInit() {
          this.el.nativeElement.classList.add('loud');
        }
      }
    `,
  };
  const result = compileProject(files).result;
  const diag = result.diagnostics.find((d) => d.code === 'DIR_UNSUPPORTED');
  assert.ok(diag, JSON.stringify(result.diagnostics));
  assert.equal(diag!.severity, 'warning');
  assert.ok(diag!.message.includes('classList'), 'the warning names the unsupported construct');
  assert.ok(result.code!.includes('Text'), 'the host element still renders');
  assert.ok(DIAGNOSTIC_CODES['DIR_UNSUPPORTED'], 'the code is registered');
});

test('directives: a directive on a child component tag warns instead of styling the child', () => {
  const files = {
    'app.component.ts': `
      import { Component } from '@angular/core';
      import { PanelComponent } from './panel.component';
      import { HighlightDirective } from './highlight.directive';
      @Component({ selector: 'app-x', template: '<screen><app-panel appHighlight="yellow"></app-panel></screen>' })
      export class XComponent {}
    `,
    'panel.component.ts': `
      import { Component } from '@angular/core';
      @Component({ selector: 'app-panel', template: '<card><p>Panel</p></card>' })
      export class PanelComponent {}
    `,
    'highlight.directive.ts': `
      import { Directive, ElementRef, Input } from '@angular/core';
      @Directive({ selector: '[appHighlight]' })
      export class HighlightDirective {
        @Input() appHighlight = '';
        constructor(private el: ElementRef) {}
        ngOnInit() { this.el.nativeElement.style.backgroundColor = this.appHighlight; }
      }
    `,
  };
  const result = compileProject(files).result;
  assert.ok(result.diagnostics.some((d) => d.code === 'DIR_UNSUPPORTED'),
    JSON.stringify(result.diagnostics));
});

// --- E: content projection ---------------------------------------------------------

test('projection: projection-demo compiles clean, golden and snapshot are current', () => {
  const { dir, result } = compileExample('projection-demo');
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  const code = result.code!;
  assert.ok(code.includes('export function Panel({ children }: { children?: any })'),
    'a child with <ng-content> receives the children prop');
  assert.ok(code.includes('{children}'), '<ng-content> compiles to the children prop');
  assert.ok(code.includes('<Panel>'), 'the parent renders the content inside the child tag');
  const committed = fs.readFileSync(path.join(dir, 'projection-demo.component.tsx'), 'utf8');
  assert.equal(code, committed, 'projection-demo golden drifted; regenerate it with the CLI if intended');
  const snap = buildStyleSnapshot('projection-demo', result.component!, result.ast!, result.css!, result.children);
  assert.deepEqual(snap, JSON.parse(fs.readFileSync(path.join(dir, 'styles.snapshot.json'), 'utf8')));
  const committedPreview = fs.readFileSync(path.join(dir, 'preview.html'), 'utf8');
  assert.equal(previewOf(result), committedPreview, 'projection-demo preview drifted; regenerate it with the CLI if intended');
});

test('projection: the preview paints the content inside the child and its events run in the parent scope', () => {
  const { result } = compileExample('projection-demo');
  const html = previewOf(result);
  const paint = html.split('<script>')[0];
  assert.ok(paint.includes('Inside the panel'), 'the static paint projects the heading');
  assert.ok(paint.includes('written in the parent'), 'the static paint projects the body');
  const { app } = loadPreview(html);
  assert.ok(app.textContent.includes('Inside the panel'), 'the page projects the content');
  const button = findAll(app, (e) => e.tagName === 'BUTTON' && e.textContent === 'Note it')[0];
  assert.ok(button, 'the projected button renders');
  button.click();
  assert.ok(app.textContent.includes('Noted 1 times'), 'the projected handler mutated the parent');
});

test('projection: a select attribute warns PROJECTION_SELECT_UNSUPPORTED and behaves as the default slot', () => {
  const files = {
    'app.component.ts': `
      import { Component } from '@angular/core';
      import { SlotComponent } from './slot.component';
      @Component({ selector: 'app-x', template: '<screen><app-slot><p>Body text</p></app-slot></screen>' })
      export class XComponent {}
    `,
    'slot.component.ts': `
      import { Component } from '@angular/core';
      @Component({ selector: 'app-slot', template: '<card><ng-content select=".body"></ng-content></card>' })
      export class SlotComponent {}
    `,
  };
  const result = compileProject(files).result;
  const diag = result.diagnostics.find((d) => d.code === 'PROJECTION_SELECT_UNSUPPORTED');
  assert.ok(diag, JSON.stringify(result.diagnostics));
  assert.equal(diag!.severity, 'warning');
  assert.ok(DIAGNOSTIC_CODES['PROJECTION_SELECT_UNSUPPORTED'], 'the code is registered');
  const paint = previewOf(result).split('<script>')[0];
  assert.ok(paint.includes('Body text'), 'the content still lands in the default slot');
});

// --- F: the Expo app scaffold -------------------------------------------------------

function runCli(args: string[], cwd = ROOT): { status: number; stdout: string; stderr: string } {
  const run = spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: 'utf8' });
  return { status: run.status ?? -1, stdout: run.stdout, stderr: run.stderr };
}

test('scaffold: init --app at an explicit path writes a real Expo app around genuine compiler output', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rangular-s12-app-'));
  const appDir = path.join(tmp, 'my-app');
  const run = runCli(['init', appDir, '--app']);
  assert.equal(run.status, 0, run.stderr);
  for (const rel of ['package.json', 'app.json', 'babel.config.js', 'metro.config.js',
    'tsconfig.json', 'App.tsx', 'README.md', '.gitignore',
    'src/app.component.ts', 'src/app.component.html', 'src/AppRoot.tsx']) {
    assert.ok(fs.existsSync(path.join(appDir, rel)), `missing ${rel}`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'my-app');
  assert.equal(pkg.dependencies['expo'], '~54.0.0');
  assert.equal(pkg.dependencies['react'], '19.1.0');
  assert.equal(pkg.dependencies['react-native'], '0.81.4');
  assert.equal(pkg.dependencies['react-native-svg'], '15.12.1');
  assert.equal(pkg.devDependencies['babel-preset-expo'], '~54.0.0');
  for (const dep of ['@rangular/ui', '@rangular/runtime']) {
    const spec = pkg.dependencies[dep] as string;
    assert.ok(spec.startsWith('file:'), `${dep} is a file: dependency`);
    const target = path.resolve(appDir, spec.slice('file:'.length));
    assert.equal(target, path.join(ROOT, 'packages', dep.split('/')[1]),
      `${dep} resolves to this repo's package`);
    assert.ok(fs.existsSync(path.join(target, 'package.json')), `${dep} target exists`);
  }
  const appJson = JSON.parse(fs.readFileSync(path.join(appDir, 'app.json'), 'utf8'));
  assert.equal(appJson.expo.slug, 'my-app');
  assert.equal(appJson.expo.scheme, 'my-app');
  const metro = fs.readFileSync(path.join(appDir, 'metro.config.js'), 'utf8');
  assert.ok(metro.includes('watchFolders'), 'the metro config watches the workspace root');
  assert.ok(metro.includes('nodeModulesPaths'), 'the metro config resolves both node_modules');
  const appTsx = fs.readFileSync(path.join(appDir, 'App.tsx'), 'utf8');
  assert.ok(appTsx.includes("from './src/AppRoot'"), 'App.tsx imports the compiled root');
  const appRoot = fs.readFileSync(path.join(appDir, 'src', 'AppRoot.tsx'), 'utf8');
  assert.ok(appRoot.includes('Generated by Rangular from AppComponent'), 'AppRoot.tsx is compiler output');
  assert.ok(appRoot.includes('Welcome to Rangular'), 'AppRoot.tsx is the starter, compiled');
  // The compiled root is exactly what the compiler produces for the
  // scaffolded starter source, not a stored sample.
  const starterEntry = path.join(appDir, 'src', 'app.component.ts');
  const recompiled = compileComponent({
    tsSource: fs.readFileSync(starterEntry, 'utf8'),
    fileName: starterEntry,
    resolveFile: (rel) => {
      const p = path.join(appDir, 'src', rel);
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined;
    },
    resolveImport: () => undefined,
    rootDir: appDir,
  });
  assert.equal(recompiled.code, appRoot, 'AppRoot.tsx is the real compiler output for the starter');
  const readme = fs.readFileSync(path.join(appDir, 'README.md'), 'utf8');
  assert.ok(readme.includes('npx expo start'), 'the README gives the run command');
  assert.ok(readme.includes('Expo Go'), 'the README names Expo Go');
  assert.ok(normalize(readme).includes('was not run'), 'the README states the device run was not done here');
  // Rebuilding inside the app works: the CLI compiles the starter in
  // place and the output is unchanged.
  const outFile = path.join(appDir, 'src', 'AppRoot.tsx');
  const before = fs.readFileSync(outFile, 'utf8');
  const rebuild = runCli(['build', starterEntry, '--out', outFile]);
  assert.equal(rebuild.status, 0, rebuild.stderr);
  assert.equal(fs.readFileSync(outFile, 'utf8'), before, 'a rebuild inside the app is stable');
});

test('scaffold: a bare name lands under the repo apps folder with short relative file: deps', () => {
  const name = 's12-smoke-app';
  const appDir = path.join(ROOT, 'apps', name);
  try {
    const run = runCli(['init', name, '--app']);
    assert.equal(run.status, 0, run.stderr);
    assert.ok(fs.existsSync(path.join(appDir, 'package.json')), 'the app was created under apps/');
    const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
    assert.equal(pkg.dependencies['@rangular/ui'], 'file:../../packages/ui');
    assert.equal(pkg.dependencies['@rangular/runtime'], 'file:../../packages/runtime');
  } finally {
    fs.rmSync(appDir, { recursive: true, force: true });
  }
});

test('scaffold: unsafe bare names are refused with CLI_INIT_UNSAFE and nothing is written', () => {
  for (const bad of ['bad name!', '..', '.']) {
    const run = runCli(['init', bad, '--app']);
    assert.equal(run.status, 1, `init ${JSON.stringify(bad)} should fail`);
    assert.ok(run.stderr.includes('CLI_INIT_UNSAFE'), run.stderr);
  }
  assert.ok(!fs.existsSync(path.join(ROOT, 'apps', 'bad name!')), 'no directory was created');
  assert.ok(DIAGNOSTIC_CODES['CLI_INIT_UNSAFE'], 'the code is registered');
});

test('scaffold: a non-empty target is refused, and plain init is unchanged', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rangular-s12-full-'));
  fs.writeFileSync(path.join(tmp, 'keep.txt'), 'mine');
  const run = runCli(['init', tmp, '--app']);
  assert.equal(run.status, 1);
  assert.ok(run.stderr.includes('CLI_INIT_NOT_EMPTY'), run.stderr);
  assert.equal(fs.readFileSync(path.join(tmp, 'keep.txt'), 'utf8'), 'mine', 'nothing was overwritten');
  const plainDir = path.join(tmp, 'plain');
  const plain = runCli(['init', plainDir]);
  assert.equal(plain.status, 0, plain.stderr);
  assert.ok(fs.existsSync(path.join(plainDir, 'src', 'app.component.ts')));
  assert.ok(!fs.existsSync(path.join(plainDir, 'package.json')), 'plain init writes no package.json');
});

// --- G: registration ------------------------------------------------------------------

test('Stage 12 registration: every new diagnostic code is catalogued with a fix', () => {
  for (const code of ['PIPE_UNKNOWN', 'DIR_UNSUPPORTED', 'PROJECTION_SELECT_UNSUPPORTED',
    'GEN_VALIDATOR_ARG', 'CLI_INIT_UNSAFE']) {
    assert.ok(DIAGNOSTIC_CODES[code], `missing diagnostic code ${code}`);
  }
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog.json'), 'utf8'));
  for (const code of ['PIPE_UNKNOWN', 'DIR_UNSUPPORTED', 'PROJECTION_SELECT_UNSUPPORTED']) {
    assert.ok(catalog.diagnostics.some((d: { code: string }) => d.code === code),
      `catalog lists ${code}`);
  }
});
