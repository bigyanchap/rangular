import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { compileComponent, CompileResult, hasErrors } from '../packages/compiler/src/compile';
import { TAG_MAP } from '../packages/compiler/src/codegen/generate';
import { DIAGNOSTIC_CODES } from '../packages/compiler/src/diagnostics';
import { doctorStyleTexts, runDoctor } from '../packages/compiler/src/doctor';
import { exprToCode, parseExpression } from '../packages/compiler/src/template/expr';
import { evaluateExpression } from '../packages/compiler/src/template/evaluate';
import { parseRoutesFile } from '../packages/compiler/src/class/parseRoutes';
import { renderPreview } from '../packages/compiler/src/preview/renderPreview';
import { buildStyleSnapshot } from '../packages/compiler/src/preview/styleSnapshot';
import {
  ActivatedRoute, matchRoute, normalizeRoutePath, RgNavigator, Router,
} from '../packages/runtime/src/index';

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

function compileProject(
  files: Record<string, string>,
  entryName: string,
  extra: { routesSpecifier?: string } = {},
): { dir: string; entry: string; result: CompileResult } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rangular-s9-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  const entry = path.join(dir, entryName);
  const result = compileComponent({
    tsSource: fs.readFileSync(entry, 'utf8'),
    fileName: entry,
    routesSpecifier: extra.routesSpecifier,
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

// --- Registration ------------------------------------------------------------

test('Stage 9: TAG_MAP and diagnostics register the routing surface', () => {
  assert.equal(TAG_MAP['router-outlet'].component, 'RgOutlet');
  assert.equal(TAG_MAP['router-outlet'].fromUi, true);
  for (const code of ['GEN_ROUTES_MISSING', 'GEN_ROUTE_COMPONENT', 'GEN_ROUTE_DUPLICATE', 'GEN_ROUTE_UNSUPPORTED']) {
    assert.ok(DIAGNOSTIC_CODES[code], `missing diagnostic code ${code}`);
  }
});

// --- Runtime: matching --------------------------------------------------------

const ROUTES = [
  { path: '', redirectTo: 'inbox' },
  { path: 'inbox' },
  { path: 'mail/:id' },
  { path: 'settings/profile' },
  { path: '**' },
];

test('runtime matchRoute: static, param, redirect, wildcard and no-match cases', () => {
  assert.deepEqual(matchRoute(ROUTES, ''), { path: 'inbox', params: {}, routePath: 'inbox' });
  assert.deepEqual(matchRoute(ROUTES, 'inbox'), { path: 'inbox', params: {}, routePath: 'inbox' });
  assert.deepEqual(matchRoute(ROUTES, '/inbox/'), { path: 'inbox', params: {}, routePath: 'inbox' });
  assert.deepEqual(matchRoute(ROUTES, 'mail/42'), { path: 'mail/42', params: { id: '42' }, routePath: 'mail/:id' });
  assert.deepEqual(matchRoute(ROUTES, 'settings/profile'), { path: 'settings/profile', params: {}, routePath: 'settings/profile' });
  // Segment counts must be equal: the param route does not absorb extra.
  assert.deepEqual(matchRoute(ROUTES, 'mail'), { path: 'mail', params: {}, routePath: '**' });
  assert.deepEqual(matchRoute(ROUTES, 'mail/1/extra'), { path: 'mail/1/extra', params: {}, routePath: '**' });
  // Params are strings, always.
  const m = matchRoute(ROUTES, 'mail/007');
  assert.equal(m?.params.id, '007');
  assert.equal(typeof m?.params.id, 'string');
  // Without a wildcard an unknown path is a no-match.
  assert.equal(matchRoute([{ path: 'inbox' }], 'nope'), null);
  assert.equal(matchRoute([{ path: 'inbox' }], ''), null);
  // An empty pattern with no redirect matches only the empty path.
  assert.deepEqual(matchRoute([{ path: '' }], ''), { path: '', params: {}, routePath: '' });
  assert.equal(normalizeRoutePath('/a//b/'), 'a/b');
  assert.equal(normalizeRoutePath(''), '');
});

test('runtime matchRoute: redirect chains resolve and redirect loops fail closed', () => {
  const chain = [
    { path: '', redirectTo: 'a' },
    { path: 'a', redirectTo: 'b' },
    { path: 'b' },
  ];
  assert.deepEqual(matchRoute(chain, ''), { path: 'b', params: {}, routePath: 'b' });
  const loop = [
    { path: 'a', redirectTo: 'b' },
    { path: 'b', redirectTo: 'a' },
  ];
  assert.equal(matchRoute(loop, 'a'), null);
  const selfLoop = [{ path: '', redirectTo: '' }];
  assert.equal(matchRoute(selfLoop, ''), null);
});

// --- Runtime: navigator, Router, ActivatedRoute --------------------------------

test('runtime RgNavigator: seeds at the empty path, navigates, backs, notifies', () => {
  const nav = new RgNavigator(ROUTES);
  assert.equal(nav.depth, 1);
  assert.equal(nav.current.routePath, 'inbox', 'seed follows the empty-path redirect');
  const seen: string[] = [];
  const unsub = nav.subscribe(() => { seen.push(nav.current.path); });
  assert.equal(nav.navigate('mail/7'), true);
  assert.deepEqual(nav.current.params, { id: '7' });
  assert.equal(nav.depth, 2);
  assert.equal(nav.navigate('nowhere/at/all'), true, 'the wildcard catches it');
  assert.equal(nav.current.routePath, '**');
  assert.equal(nav.back(), true);
  assert.equal(nav.current.path, 'mail/7');
  assert.equal(nav.back(), true);
  assert.equal(nav.back(), false, 'back at the root is a no-op');
  assert.equal(nav.current.routePath, 'inbox');
  assert.deepEqual(seen, ['mail/7', 'nowhere/at/all', 'mail/7', 'inbox']);
  unsub();
  // An unmatched path with no wildcard route refuses and keeps state.
  const strict = new RgNavigator([{ path: 'home' }]);
  assert.equal(strict.current.routePath, '', 'unmatched seed is an empty entry');
  assert.equal(strict.navigate('nope'), false);
  assert.equal(strict.current.routePath, '');
});

test('runtime Router and ActivatedRoute: navigate commands, ByUrl, snapshot and paramMap', () => {
  const nav = new RgNavigator(ROUTES);
  const router = new Router(nav);
  assert.equal(router.navigate(['/mail', 3]), true, 'numeric commands stringify');
  assert.equal(nav.current.path, 'mail/3');
  assert.equal(router.navigateByUrl('/settings/profile'), true);
  const route = new ActivatedRoute(nav.current.params, nav);
  assert.deepEqual(route.snapshot.params, {});
  const emissions: Record<string, string>[] = [];
  const sub = route.paramMap.subscribe((p) => emissions.push(p));
  assert.equal(emissions.length, 1, 'paramMap emits the current params on subscribe');
  router.navigateByUrl('mail/9');
  assert.equal(emissions.length, 2, 'paramMap emits again on navigation while subscribed');
  assert.deepEqual(emissions[1], { id: '9' });
  assert.deepEqual(route.snapshot.params, { id: '9' }, 'the snapshot tracks the latest params');
  sub.unsubscribe();
  router.navigateByUrl('inbox');
  assert.equal(emissions.length, 2, 'no emissions after unsubscribe');
  // An ActivatedRoute without a navigator is a static snapshot holder.
  const solo = new ActivatedRoute({ id: '1' });
  assert.deepEqual(solo.snapshot.params, { id: '1' });
});

// --- Expressions: array literals -------------------------------------------------

test('Stage 9 expressions: array literals parse, evaluate and emit', () => {
  const empty = parseExpression('[]');
  assert.equal(empty.type, 'array');
  assert.deepEqual(evaluateExpression('[]', {}), []);
  assert.deepEqual(evaluateExpression("['/mail', m.id, 3]", { m: { id: 5 } }), ['/mail', 5, 3]);
  assert.equal(exprToCode("['/mail', m.id]"), "['/mail', m.id]");
  assert.deepEqual(evaluateExpression("['/inbox',]", {}), ['/inbox']);
  assert.deepEqual(evaluateExpression('[[1, 2], [3]]', {}), [[1, 2], [3]]);
});

// --- Routes file parsing -----------------------------------------------------------

test('parseRoutesFile: entries, redirects, ignored keys and the not-found case', () => {
  const src = `
import { Routes } from '@angular/router';
import { HomeComponent } from './home.component';
export const routes: Routes = [
  { path: '', redirectTo: 'home', pathMatch: 'full' },
  { path: 'home', component: HomeComponent, data: { title: 'Home' }, title: 'Home' },
  { path: '**', component: HomeComponent },
];
`;
  const parsed = parseRoutesFile(src, 'app.routes.ts');
  assert.equal(parsed.found, true);
  assert.deepEqual(parsed.diagnostics, [], JSON.stringify(parsed.diagnostics));
  assert.equal(parsed.routes.length, 3);
  assert.equal(parsed.routes[0].redirectTo, 'home');
  assert.equal(parsed.routes[1].componentName, 'HomeComponent');
  assert.deepEqual(parsed.routes[1].ignoredKeys, ['data', 'title'], 'data and title are accepted and recorded');
  const none = parseRoutesFile('export const x = 1;', 'other.ts');
  assert.equal(none.found, false);
  assert.deepEqual(none.routes, []);
});

test('parseRoutesFile: every unsupported feature is named by GEN_ROUTE_UNSUPPORTED', () => {
  for (const key of ['children', 'canActivate', 'canActivateChild', 'canDeactivate', 'canMatch', 'resolve', 'loadComponent', 'loadChildren']) {
    const src = `export const routes = [{ path: 'x', component: A, ${key}: [] }];`;
    const parsed = parseRoutesFile(src, 'app.routes.ts');
    const d = parsed.diagnostics.find((x) => x.code === 'GEN_ROUTE_UNSUPPORTED');
    assert.ok(d, `expected GEN_ROUTE_UNSUPPORTED for ${key}`);
    assert.equal(d.severity, 'error');
    assert.ok(d.message.includes(key), `message names the feature ${key}: ${d.message}`);
  }
  const weird = parseRoutesFile('export const routes = [{ path: 3, component: A }];', 'app.routes.ts');
  assert.ok(weird.diagnostics.some((d) => d.code === 'GEN_ROUTE_UNSUPPORTED'));
  const spread = parseRoutesFile('export const routes = [...base];', 'app.routes.ts');
  assert.ok(spread.diagnostics.some((d) => d.code === 'GEN_ROUTE_UNSUPPORTED'));
});

// --- Example: mini-mail -------------------------------------------------------------

test('mini-mail example: zero diagnostics, doctor clean, golden and style snapshot match', () => {
  const { dir, entry, result } = compileExample('mini-mail');
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.equal(result.routes.length, 4, 'all four route entries resolved');
  assert.deepEqual(
    result.routes.map((r) => [r.path, r.selector]),
    [['', undefined], ['inbox', 'app-inbox'], ['mail/:id', 'app-mail-detail'], ['**', 'app-not-found']],
  );
  const golden = fs.readFileSync(path.join(dir, 'mini-mail.component.tsx'), 'utf8');
  assert.equal(normalize(result.code), normalize(golden));
  const findings = runDoctor({
    result,
    entryFile: entry,
    styleTexts: doctorStyleTexts(result, entry, (abs) => (
      fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : undefined
    )),
  });
  assert.deepEqual(findings, [], JSON.stringify(findings));
  const snap = buildStyleSnapshot('mini-mail', result.component!, result.ast!, result.css!, result.children);
  const committed = JSON.parse(fs.readFileSync(path.join(dir, 'styles.snapshot.json'), 'utf8'));
  assert.deepEqual(snap, committed);
});

test('mini-mail codegen: navigator, outlet conditionals, route prop and link presses', () => {
  const { result } = compileExample('mini-mail');
  const code = normalize(result.code);
  assert.ok(code.includes('const __navigator = new RgNavigator([{"path":"","redirectTo":"inbox"},{"path":"inbox"},{"path":"mail/:id"},{"path":"**"}]);'));
  assert.ok(code.includes('const __router = new Router(__navigator);'));
  assert.ok(code.includes('import { ActivatedRoute, Container, ReactiveService, RgNavigator, Router } from \'@rangular/runtime\';'));
  // Outlet: one conditional per component route, keyed by concrete path.
  assert.ok(code.includes('{__route.routePath === "inbox" && ( <Inbox key={__route.path} /> )}'));
  assert.ok(code.includes('{__route.routePath === "mail/:id" && ( <MailDetail key={__route.path} __rgRoute={new ActivatedRoute(__route.params, __navigator)} /> )}'));
  // The shell mirrors the navigator in state so navigation re-renders.
  assert.ok(code.includes('const [__route, __setRoute] = useState(__navigator.current);'));
  assert.ok(code.includes('useEffect(() => __navigator.subscribe(() => __setRoute(__navigator.current)), []);'));
  // Dependency lines: the route prop and the shared router.
  assert.ok(code.includes('export function MailDetail({ __rgRoute }: { __rgRoute?: any }) {'));
  assert.ok(code.includes('const route = __rgRoute;'));
  assert.ok(code.includes('const router = __router;'));
  // Links: array form through navigate, string form through navigateByUrl,
  // and the translated method body keeps the Router call as written.
  assert.ok(code.includes('onPress={() => __router.navigate([\'/mail\', m.id])}'));
  assert.ok(code.includes('onPress={() => __router.navigateByUrl("/archive")}'));
  assert.ok(code.includes('onPress={() => __router.navigateByUrl("/inbox")}'));
  assert.ok(code.includes('router.navigate([\'/inbox\']);'));
  // No routerLink prop survives into generated props.
  assert.ok(!code.includes('routerLink='), 'routerLink is consumed by codegen, never a prop');
});

// --- Compile-level diagnostics -------------------------------------------------------

const SHELL = `import { Component } from '@angular/core';
@Component({ selector: 'app-root', template: '<screen><router-outlet></router-outlet></screen>' })
export class AppComponent {}
`;
const PAGE = (name: string, extra = '') => `import { Component } from '@angular/core';
@Component({ selector: 'app-${name.toLowerCase()}', template: '<p>${name}</p>' })
export class ${name}Component { ${extra} }
`;

test('routing diagnostics: outlet without a routes file is GEN_ROUTES_MISSING', () => {
  const { result } = compileProject({ 'app.component.ts': SHELL }, 'app.component.ts');
  assert.ok(hasErrors(result.diagnostics));
  const d = result.diagnostics.find((x) => x.code === 'GEN_ROUTES_MISSING');
  assert.ok(d, JSON.stringify(result.diagnostics));
  assert.ok(d.fix?.includes('app.routes.ts'), 'the fix names the discovery rule');
  assert.ok(d.fix?.includes('--routes'));
});

test('routing diagnostics: Router injection without routes is GEN_ROUTES_MISSING too', () => {
  const src = `import { Component } from '@angular/core';
import { Router } from '@angular/router';
@Component({ selector: 'app-root', template: '<button (click)="go()">Go</button>' })
export class AppComponent {
  constructor(private router: Router) {}
  go() { this.router.navigate(['/x']); }
}
`;
  const { result } = compileProject({ 'app.component.ts': src }, 'app.component.ts');
  assert.ok(result.diagnostics.some((d) => d.code === 'GEN_ROUTES_MISSING'));
});

test('routing diagnostics: unknown component, self route and duplicate paths', () => {
  const routes = `import { Routes } from '@angular/router';
import { HomeComponent } from './home.component';
export const routes: Routes = [
  { path: 'home', component: HomeComponent },
  { path: 'home', component: HomeComponent },
  { path: 'ghost', component: GhostComponent },
  { path: 'self', component: AppComponent },
];
`;
  const { result } = compileProject({
    'app.component.ts': SHELL,
    'home.component.ts': PAGE('Home'),
    'app.routes.ts': routes,
  }, 'app.component.ts');
  const codes = result.diagnostics.map((d) => d.code);
  assert.ok(codes.includes('GEN_ROUTE_COMPONENT'), JSON.stringify(result.diagnostics));
  const ghost = result.diagnostics.find((d) => d.code === 'GEN_ROUTE_COMPONENT' && d.message.includes('GhostComponent'));
  assert.ok(ghost, 'the unknown class is named');
  const self = result.diagnostics.find((d) => d.code === 'GEN_ROUTE_COMPONENT' && d.message.includes('AppComponent'));
  assert.ok(self, 'routing to the root component itself is named');
  const dup = result.diagnostics.find((d) => d.code === 'GEN_ROUTE_DUPLICATE');
  assert.ok(dup, 'duplicate paths warn');
  assert.equal(dup.severity, 'warning');
  assert.ok(hasErrors(result.diagnostics), 'the unknown component is an error');
});

test('routing diagnostics: a routes entry with children errors through the compiler', () => {
  const routes = `export const routes = [
  { path: 'admin', children: [{ path: '', component: HomeComponent }] },
];
`;
  const { result } = compileProject({
    'app.component.ts': SHELL,
    'home.component.ts': PAGE('Home'),
    'app.routes.ts': routes,
  }, 'app.component.ts');
  const d = result.diagnostics.find((x) => x.code === 'GEN_ROUTE_UNSUPPORTED');
  assert.ok(d, JSON.stringify(result.diagnostics));
  assert.ok(d.message.includes('children'));
  assert.ok(hasErrors(result.diagnostics));
});

test('routing diagnostics: a redirect to an undeclared path is GEN_ROUTE_UNSUPPORTED', () => {
  const routes = `export const routes = [
  { path: '', redirectTo: 'nowhere' },
];
`;
  const { result } = compileProject({
    'app.component.ts': SHELL,
    'app.routes.ts': routes,
  }, 'app.component.ts');
  assert.ok(result.diagnostics.some((d) => d.code === 'GEN_ROUTE_UNSUPPORTED'));
});

test('routing: --routes specifier compiles a routes file outside the default name', () => {
  const routes = `import { HomeComponent } from './home.component';
export const routes = [
  { path: '', component: HomeComponent },
];
`;
  const { result } = compileProject({
    'app.component.ts': SHELL,
    'home.component.ts': PAGE('Home'),
    'my.routes.ts': routes,
  }, 'app.component.ts', { routesSpecifier: './my.routes.ts' });
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.equal(result.routes.length, 1);
  assert.ok(normalize(result.code).includes('RgOutlet'), 'the outlet renders with explicit routes');
});

test('routing: an unused app.routes.ts changes nothing (no navigator emitted)', () => {
  const plain = `import { Component } from '@angular/core';
@Component({ selector: 'app-root', template: '<p>Hello</p>' })
export class AppComponent {}
`;
  const routes = `import { HomeComponent } from './home.component';
export const routes = [{ path: 'home', component: HomeComponent }];
`;
  const { result } = compileProject({
    'app.component.ts': plain,
    'home.component.ts': PAGE('Home'),
    'app.routes.ts': routes,
  }, 'app.component.ts');
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(!normalize(result.code).includes('RgNavigator'), 'no routing usage, no navigator');
});

// --- CLI --routes -----------------------------------------------------------------------

test('CLI: --routes is honoured by build, and a missing routes file is a clean error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rangular-s9-cli-'));
  fs.writeFileSync(path.join(dir, 'app.component.ts'), SHELL);
  fs.writeFileSync(path.join(dir, 'home.component.ts'), PAGE('Home'));
  fs.writeFileSync(path.join(dir, 'custom.routes.ts'), `import { HomeComponent } from './home.component';
export const routes = [{ path: '', component: HomeComponent }];
`);
  const cliPath = path.join(ROOT, 'dist', 'packages', 'cli', 'src', 'cli.js');
  const build = spawnSync('node', [cliPath, 'build', path.join(dir, 'app.component.ts'),
    '--out', path.join(dir, 'out.tsx'), '--routes', path.join(dir, 'custom.routes.ts'), '--json'], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  assert.deepEqual(JSON.parse(build.stdout).diagnostics, []);
  assert.ok(fs.readFileSync(path.join(dir, 'out.tsx'), 'utf8').includes('RgNavigator'));
  const missing = spawnSync('node', [cliPath, 'build', path.join(dir, 'app.component.ts'),
    '--out', path.join(dir, 'out2.tsx'), '--routes', path.join(dir, 'nope.routes.ts')], { encoding: 'utf8' });
  assert.notEqual(missing.status, 0);
  assert.ok(missing.stderr.includes('routes file not found'));
});

// --- Preview: server paint and interactive behaviour -------------------------------------

function renderMiniMailPreview(): string {
  const { result } = compileExample('mini-mail');
  return renderPreview(result.component!, result.ast!, {
    children: result.children,
    services: result.services,
    routes: result.routes,
  });
}

test('mini-mail preview paint: starts at the inbox through the empty-path redirect', () => {
  const html = renderMiniMailPreview();
  const paint = html.split('<script>')[0];
  assert.ok(paint.includes('Mini Mail'), 'the shell appbar paints');
  assert.ok(paint.includes('Photos from the weekend'), 'the inbox paints through the redirect');
  assert.ok(paint.includes('Archived (old link)'), 'the broken-link row paints');
  assert.ok(!paint.includes('Page not found'), 'the wildcard component does not paint initially');
});

class ShimText {
  constructor(public text: string) {}
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

const rowsOf = (app: ShimElement) => findAll(app, (e) => e.className === 'row');
const backBarsOf = (app: ShimElement) => findAll(app, (e) => e.className === 'preview-nav-back');

test('mini-mail preview behaviour: tap a row, detail by param, back chrome, wildcard, links home', () => {
  const { app } = loadPreview(renderMiniMailPreview());
  assert.equal(rowsOf(app).length, 5, 'four mail rows plus the archived row');
  assert.ok(app.textContent.includes('Security alert'), 'starts at the inbox');
  assert.equal(backBarsOf(app).length, 0, 'no back chrome at depth 1');

  // Tap the third mail row: the detail shows that mail, looked up by the
  // :id param the link carried.
  rowsOf(app)[2].click();
  assert.ok(app.textContent.includes('Your weekly reading list'), 'detail subject for id 3');
  assert.ok(app.textContent.includes('long essay on attention'), 'detail body for id 3');
  assert.ok(!app.textContent.includes('Archived (old link)'), 'the inbox is swapped out');
  assert.equal(backBarsOf(app).length, 1, 'the preview back chrome appears at depth 2');
  assert.ok(app.textContent.includes('Preview navigation: /mail/3'), 'the chrome names the current path');

  // The preview back chrome returns to the inbox.
  const backButton = findAll(app, (e) => e.tagName === 'BUTTON' && e.textContent === 'Back')[0];
  backButton.click();
  assert.ok(app.textContent.includes('Archived (old link)'), 'back returns to the inbox');
  assert.equal(backBarsOf(app).length, 0, 'the chrome is gone at depth 1');

  // The detail's own Back button goes through Router.navigate from code.
  rowsOf(app)[0].click();
  assert.ok(app.textContent.includes('uploaded the photos'), 'detail body for id 1');
  const backToInbox = findAll(app, (e) => e.className === 'btn')[0];
  backToInbox.click();
  assert.ok(app.textContent.includes('Archived (old link)'), 'Router.navigate returns to the inbox');

  // The deliberate broken link lands on the wildcard component.
  const rows = rowsOf(app);
  rows[rows.length - 1].click();
  assert.ok(app.textContent.includes('Page not found'), 'the ** route renders for /archive');

  // And its own link goes home.
  const goHome = findAll(app, (e) => e.className === 'btn')[0];
  goHome.click();
  assert.ok(app.textContent.includes('Security alert'), 'the not-found link returns to the inbox');
});

test('routing parity: the preview matcher and the runtime matcher agree on a path table', () => {
  const html = renderMiniMailPreview();
  const { sandbox } = loadPreview(html);
  const pageMatch = sandbox['__matchRoute'] as (p: string) => { path: string; params: Record<string, string>; routePath: string } | null;
  assert.equal(typeof pageMatch, 'function', 'the page runtime exposes its matcher');
  const defs = [
    { path: '', redirectTo: 'inbox' },
    { path: 'inbox' },
    { path: 'mail/:id' },
    { path: '**' },
  ];
  const cases = ['', '/', 'inbox', '/inbox/', 'mail/1', 'mail/007', 'mail', 'mail/1/2', 'archive', 'a/b/c', 'INBOX'];
  for (const c of cases) {
    // The page runs in a vm realm: compare by value, not by prototype.
    assert.deepEqual(
      JSON.parse(JSON.stringify(pageMatch(c))),
      matchRoute(defs, c),
      `parity for path ${JSON.stringify(c)}`,
    );
  }
  // The loop guard is mirrored too: a self-redirecting table fails
  // closed in both implementations. The page's ROUTES is a lexical
  // const, so the matcher source is lifted from the shipped script and
  // re-run verbatim against the looping table in a fresh realm.
  const script = html.split('<script>')[1].split('</script>')[0];
  const matcherCode = script.slice(
    script.indexOf('function __normalizePath'),
    script.indexOf('if (ROUTES.length)'),
  );
  assert.ok(matcherCode.includes('function __matchRoute'), 'the matcher source was located');
  const loopSandbox: Record<string, unknown> = { console };
  vm.runInNewContext(`var ROUTES = [{ path: '', redirectTo: '' }];\n${matcherCode}`, loopSandbox);
  const loopMatch = loopSandbox['__matchRoute'] as (p: string) => unknown;
  assert.equal(loopMatch(''), null, 'the page matcher fails closed on a redirect loop');
  assert.equal(matchRoute([{ path: '', redirectTo: '' }], ''), null, 'and so does the runtime');
});

// --- Parity guard (Stage 5 pattern, extended to this stage) -----------------------------

test('Stage 9 generated goldens: only known components, no web-only APIs', () => {
  const { result } = compileExample('mini-mail');
  // Same scan shape as the Stage 5 parity guard: JSX tags only (a tag
  // opens after whitespace or a paren and closes on space, slash or
  // bracket, which excludes TypeScript generics like get<MailService>),
  // plus the components generated into this very file.
  const known = new Set(Object.values(TAG_MAP).map((t) => t.component));
  known.add('Text');
  known.add('View');
  for (const m of result.code.matchAll(/export (?:default )?function (\w+)\(/g)) known.add(m[1]);
  for (const m of result.code.matchAll(/(?:^|[\s(])<([A-Z][A-Za-z0-9]*)(?=[\s/>])/gm)) {
    assert.ok(known.has(m[1]), `unknown component ${m[1]}`);
  }
  assert.ok(!/\b(document|window|localStorage)\b/.test(result.code), 'no web-only APIs in generated code');
});
