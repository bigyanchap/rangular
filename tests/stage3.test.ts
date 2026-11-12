import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { compileComponent, CompileResult, hasErrors } from '../packages/compiler/src/compile';
import { renderPreview } from '../packages/compiler/src/preview/renderPreview';
import { HttpClient, ReactiveService } from '../packages/runtime/src/index';

const ROOT = path.join(__dirname, '..', '..');
const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Compile an example directory the way the CLI does (absolute file keys). */
function compileExample(name: string): { dir: string; result: CompileResult } {
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
      for (const cand of [base, `${base}.ts`]) {
        if (fs.existsSync(cand)) return { source: fs.readFileSync(cand, 'utf8'), fileName: cand };
      }
      return undefined;
    },
  });
  return { dir, result };
}

/** Write a throwaway multi-file project and compile its entry component. */
function compileProject(files: Record<string, string>, entryName: string): CompileResult {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rangular-s3-'));
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

// --- M5: child components -----------------------------------------------------

test('favourite example compiles with zero errors and matches its golden .tsx', () => {
  const { dir, result } = compileExample('favourite');
  assert.equal(hasErrors(result.diagnostics), false, JSON.stringify(result.diagnostics));
  const golden = fs.readFileSync(path.join(dir, 'favourite.component.tsx'), 'utf8');
  assert.equal(normalize(result.code), normalize(golden));
});

test('child codegen: inputs become props with literal defaults, emit becomes the callback prop', () => {
  const { result } = compileExample('favourite');
  // Child: destructured props, '' defaults from the @Input initializers,
  // and this.favourited.emit(this.quote) -> onFavourited?.(quote).
  assert.match(result.code, /export function QuoteCard\(\{ quote = '', author = '', onFavourited \}/);
  assert.match(result.code, /onFavourited\?\.\(quote\)/);
  // Parent: [input] passes props, (favourited) wires the callback with $event.
  assert.match(result.code, /<QuoteCard key=\{q\?\.id \?\? i\} quote=\{q\.text\} author=\{q\.author\} onFavourited=\{\(\$event\) => recordFavourite\(\$event\)\} \/>/);
});

test('a child used without a binding relies on the @Input default in its signature', () => {
  const result = compileProject({
    'kid.component.ts': `
      import { Component, Input } from '@angular/core';
      @Component({ selector: 'kid-star', template: '<p>{{ label }}</p>' })
      export class KidComponent { @Input() label = 'untitled'; }
    `,
    'app.component.ts': `
      import { Component } from '@angular/core';
      import { KidComponent } from './kid.component';
      @Component({ selector: 'app-x', template: '<screen><kid-star></kid-star></screen>' })
      export class AppComponent {}
    `,
  }, 'app.component.ts');
  assert.equal(hasErrors(result.diagnostics), false, JSON.stringify(result.diagnostics));
  assert.match(result.code, /export function Kid\(\{ label = 'untitled' \}/);
  assert.match(result.code, /<Kid \/>/);
});

test('import cycles produce a CMP_IMPORT_CYCLE warning and still compile', () => {
  const result = compileProject({
    'bee.component.ts': `
      import { Component } from '@angular/core';
      import { AppComponent } from './app.component';
      @Component({ selector: 'bee', template: '<p>bee</p>' })
      export class BeeComponent {}
    `,
    'app.component.ts': `
      import { Component } from '@angular/core';
      import { BeeComponent } from './bee.component';
      @Component({ selector: 'app-x', template: '<screen><bee></bee></screen>' })
      export class AppComponent {}
    `,
  }, 'app.component.ts');
  assert.ok(result.diagnostics.some((d) => d.code === 'CMP_IMPORT_CYCLE' && d.severity === 'warning'),
    JSON.stringify(result.diagnostics));
  assert.equal(hasErrors(result.diagnostics), false, JSON.stringify(result.diagnostics));
  assert.match(result.code, /export function Bee\(\)/);
  assert.match(result.code, /<Bee \/>/);
});

// --- M6: services, DI, lifecycle ----------------------------------------------

test('shared-inbox example compiles with zero errors and matches its golden .tsx', () => {
  const { dir, result } = compileExample('shared-inbox');
  assert.equal(hasErrors(result.diagnostics), false, JSON.stringify(result.diagnostics));
  const golden = fs.readFileSync(path.join(dir, 'shared-inbox.component.tsx'), 'utf8');
  assert.equal(normalize(result.code), normalize(golden));
});

test('service codegen: ReactiveService class, one container, both components subscribed', () => {
  const { result } = compileExample('shared-inbox');
  assert.match(result.code, /export class MailService extends ReactiveService/);
  assert.match(result.code, /const __container = new Container\(\);/);
  assert.match(result.code, /__container\.register\(MailService, new MailService\(\)\);/);
  // The same singleton serves parent and child; both subscribe for re-render.
  assert.equal(result.code.match(/__container\.get<MailService>\(MailService\)/g)?.length, 2);
  assert.equal(result.code.match(/useSyncExternalStore\(\(cb\) => mail\.__subscribe\(cb\), \(\) => mail\.__getVersion\(\)\)/g)?.length, 2);
  // Mutating service methods notify after the assignment.
  assert.match(result.code, /this\.mails = this\.mails\.map/);
  assert.match(result.code, /this\.__notify\(\);/);
});

test('lifecycle codegen: ngOnInit runs in useEffect(..., []) after first render', () => {
  const { result } = compileExample('shared-inbox');
  assert.match(result.code, /const ngOnInit = \(\) => \{\s+setLoaded\(true\);/);
  assert.match(result.code, /useEffect\(\(\) => \{\s+ngOnInit\(\);\s+\}, \[\]\);/);
});

test('services can inject services; registrations are dependency-ordered', () => {
  const result = compileProject({
    'mail.service.ts': `
      import { Injectable } from '@angular/core';
      @Injectable({ providedIn: 'root' })
      export class MailService { mails = []; }
    `,
    'report.service.ts': `
      import { Injectable } from '@angular/core';
      import { MailService } from './mail.service';
      @Injectable({ providedIn: 'root' })
      export class ReportService {
        constructor(private mail: MailService) {}
        total() { return this.mail.mails.length; }
      }
    `,
    'app.component.ts': `
      import { Component } from '@angular/core';
      import { ReportService } from './report.service';
      @Component({ selector: 'app-x', template: '<screen><p>{{ report.total() }}</p></screen>' })
      export class AppComponent { constructor(private report: ReportService) {} }
    `,
  }, 'app.component.ts');
  assert.equal(hasErrors(result.diagnostics), false, JSON.stringify(result.diagnostics));
  const mailReg = result.code.indexOf('__container.register(MailService');
  const reportReg = result.code.indexOf('__container.register(ReportService');
  assert.ok(mailReg >= 0 && reportReg > mailReg, 'MailService registers before ReportService');
  assert.match(result.code, /new ReportService\(__container\.get<MailService>\(MailService\)\)/);
  assert.match(result.code, /constructor\(private mail: MailService\) \{\s+super\(\);/);
});

test('an unknown constructor token is a DI_UNKNOWN_TOKEN error with a fix', () => {
  const result = compileProject({
    'app.component.ts': `
      import { Component } from '@angular/core';
      @Component({ selector: 'app-x', template: '<screen><p>hi</p></screen>' })
      export class AppComponent { constructor(private mystery: MysteryService) {} }
    `,
  }, 'app.component.ts');
  const diag = result.diagnostics.find((d) => d.code === 'DI_UNKNOWN_TOKEN');
  assert.ok(diag, JSON.stringify(result.diagnostics));
  assert.equal(diag.severity, 'error');
  assert.match(diag.fix ?? '', /providedIn: 'root'/);
  assert.equal(hasErrors(result.diagnostics), true);
});

// --- M6: HttpClient -------------------------------------------------------------

test('HttpClient codegen: injected like a service, subscribe shape translates to a setter', () => {
  const result = compileProject({
    'app.component.ts': `
      import { Component } from '@angular/core';
      import { HttpClient } from '@angular/common/http';
      @Component({ selector: 'app-x', template: '<screen><p>{{ mails.length }}</p></screen>' })
      export class AppComponent {
        mails = [];
        constructor(private http: HttpClient) {}
        load() {
          this.http.get('https://example.com/mails').subscribe((data) => {
            this.mails = data;
          });
        }
      }
    `,
  }, 'app.component.ts');
  assert.equal(hasErrors(result.diagnostics), false, JSON.stringify(result.diagnostics));
  assert.match(result.code, /import \{ Container, HttpClient \} from '@rangular\/runtime';/);
  assert.match(result.code, /__container\.register\(HttpClient, new HttpClient\(\)\);/);
  assert.match(result.code, /const http = __container\.get<HttpClient>\(HttpClient\);/);
  assert.match(result.code, /http\.get\('https:\/\/example\.com\/mails'\)\.subscribe\(\(data\) => \{/);
  assert.match(result.code, /setMails\(data\);/);
});

test('the expression-bodied subscribe assignment degrades to METHOD_UNSUPPORTED, not wrong code', () => {
  const result = compileProject({
    'app.component.ts': `
      import { Component } from '@angular/core';
      import { HttpClient } from '@angular/common/http';
      @Component({ selector: 'app-x', template: '<screen><p>x</p></screen>' })
      export class AppComponent {
        mails = [];
        constructor(private http: HttpClient) {}
        load() {
          this.http.get('https://example.com/mails').subscribe((data) => this.mails = data);
        }
      }
    `,
  }, 'app.component.ts');
  assert.ok(result.diagnostics.some((d) => d.code === 'METHOD_UNSUPPORTED'),
    JSON.stringify(result.diagnostics));
  assert.doesNotMatch(result.code, /\(data\) => mails = data/);
});

test('HttpClient emits parsed JSON from an injected stub fetch (no network)', async () => {
  const http = new HttpClient(async (url: string) => {
    assert.equal(url, 'https://example.com/mails');
    return { json: async () => [{ id: 1, from: 'Sarju' }] };
  });
  const data = await new Promise<unknown>((resolve, reject) => {
    http.get('https://example.com/mails').subscribe(resolve, reject);
  });
  assert.deepEqual(data, [{ id: 1, from: 'Sarju' }]);
});

test('HttpClient routes fetch failures to the error callback', async () => {
  const http = new HttpClient(async () => { throw new Error('offline'); });
  const err = await new Promise<unknown>((resolve) => {
    http.get('https://example.com/x').subscribe(
      () => resolve('unexpected next'),
      (e) => resolve(e),
    );
  });
  assert.ok(err instanceof Error && err.message === 'offline');
});

test('HttpClient unsubscribe before resolution suppresses delivery', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const http = new HttpClient(async () => {
    await gate;
    return { json: async () => 42 };
  });
  let seen = 0;
  const sub = http.get('https://example.com/x').subscribe(() => { seen++; });
  sub.unsubscribe();
  release();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(seen, 0);
});

test('ReactiveService notifies subscribers and bumps its version snapshot', () => {
  class CounterService extends ReactiveService {
    n = 0;
    inc() {
      this.n++;
      this.__notify();
    }
  }
  const svc = new CounterService();
  let calls = 0;
  const off = svc.__subscribe(() => { calls++; });
  const v0 = svc.__getVersion();
  svc.inc();
  svc.inc();
  assert.equal(calls, 2);
  assert.equal(svc.__getVersion(), v0 + 2);
  off();
  svc.inc();
  assert.equal(calls, 2);
});

// --- Preview: server render -----------------------------------------------------

test('favourite preview server-renders the child cards and the Saved: 0 appbar', () => {
  const { result } = compileExample('favourite');
  const html = renderPreview(result.component!, result.ast!, {
    children: result.children,
    services: result.services,
  });
  const initial = html.split('<script>')[0];
  assert.match(initial, /Saved: 0/);
  for (const text of ['The present moment is all you ever have.', 'Silence is a source of great strength.', 'What you seek is seeking you.']) {
    assert.ok(initial.includes(text), text);
  }
  assert.equal((initial.match(/>Save</g) ?? []).length, 3);
});

test('shared-inbox preview server-renders rows + unread dots from the service; badge waits for ngOnInit', () => {
  const { result } = compileExample('shared-inbox');
  const html = renderPreview(result.component!, result.ast!, {
    children: result.children,
    services: result.services,
  });
  const initial = html.split('<script>')[0];
  for (const name of ['Sarju', 'Google', 'Medium', 'Awaken Me']) {
    assert.ok(initial.includes(name), name);
  }
  assert.equal((initial.match(/●/g) ?? []).length, 2);
  // loaded starts false and ngOnInit does not run in the static paint.
  assert.doesNotMatch(initial, /unread</);
});

// --- Preview: interactive behaviour (DOM shim) ----------------------------------

class ShimText {
  constructor(private text: string) {}
  get textContent(): string { return this.text; }
}

class ShimElement {
  className = '';
  disabled = false;
  children: (ShimElement | ShimText)[] = [];
  private listeners = new Map<string, ((ev: unknown) => void)[]>();
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
  set innerHTML(_value: string) { this.children = []; }
  get innerHTML(): string { return ''; }
  set textContent(value: string) { this.children = [new ShimText(value)]; }
  get textContent(): string { return this.children.map((c) => c.textContent).join(''); }
}

/** Load the interactive preview page into the shim and return its app root. */
function loadPreview(html: string): ShimElement {
  const app = new ShimElement('div');
  const documentShim = {
    createElement: (tag: string) => new ShimElement(tag),
    createTextNode: (text: string) => new ShimText(text),
    getElementById: (id: string) => (id === 'app' ? app : null),
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

function buttonsWith(app: ShimElement, text: string): ShimElement[] {
  return findAll(app, (e) => e.tagName === 'BUTTON' && e.textContent.includes(text));
}

test('preview behaviour: favourite — a child Save click runs the parent handler and re-renders', () => {
  const { result } = compileExample('favourite');
  const html = renderPreview(result.component!, result.ast!, {
    children: result.children,
    services: result.services,
  });
  const app = loadPreview(html);
  assert.match(app.textContent, /Saved: 0/);
  const saves = buttonsWith(app, 'Save');
  assert.equal(saves.length, 3);
  saves[0].click();
  assert.match(app.textContent, /Saved: 1/);
  buttonsWith(app, 'Save')[2].click();
  assert.match(app.textContent, /Saved: 2/);
});

test('preview behaviour: shared-inbox — ngOnInit shows the badge; Mark all read updates badge AND list', () => {
  const { result } = compileExample('shared-inbox');
  const html = renderPreview(result.component!, result.ast!, {
    children: result.children,
    services: result.services,
  });
  const app = loadPreview(html);
  // Badge appears after mount (ngOnInit set loaded) with the service count.
  assert.match(app.textContent, /2 unread/);
  assert.equal((app.textContent.match(/●/g) ?? []).length, 2);
  buttonsWith(app, 'Mark all read')[0].click();
  // Both consumers of the same singleton reflect the mutation.
  assert.match(app.textContent, /0 unread/);
  assert.equal((app.textContent.match(/●/g) ?? []).length, 0);
  for (const name of ['Sarju', 'Google', 'Medium', 'Awaken Me']) {
    assert.ok(app.textContent.includes(name), name);
  }
});
