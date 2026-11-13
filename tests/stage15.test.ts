import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { compileComponent, CompileResult, hasErrors } from '../packages/compiler/src/compile';
import { TAG_MAP } from '../packages/compiler/src/codegen/generate';
import { DIAGNOSTIC_CODES } from '../packages/compiler/src/diagnostics';
import { doctorStyleTexts, runDoctor } from '../packages/compiler/src/doctor';
import { buildCatalog } from '../packages/compiler/src/catalog';
import { renderPreview } from '../packages/compiler/src/preview/renderPreview';
import { buildStyleSnapshot } from '../packages/compiler/src/preview/styleSnapshot';
import { applyMask, maskLength } from '../packages/ui/src/mask';
import { chartModel, normalizeChartData } from '../packages/ui/src/chart';
import { COLOR_SWATCHES } from '../packages/ui/src/palette';

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

function compileInline(template: string, classBody = '') {
  const tsSource = [
    `import { Component } from '@angular/core';`,
    `@Component({ selector: 'app-t', template: \`${template.replace(/`/g, '')}\` })`,
    `export class TComponent { ${classBody} }`,
  ].join('\n');
  return compileComponent({ tsSource, resolveFile: () => undefined });
}

// --- A: tags, catalog and diagnostics --------------------------------------

const EXPECTED: Record<string, string> = {
  'bottom-nav': 'RgBottomNav', 'nav-item': 'RgNavItem',
  skeleton: 'RgSkeleton', 'row-action': 'RgRowAction',
  rating: 'RgRating', otp: 'RgOtp', 'file-picker': 'RgFilePicker',
  'color-picker': 'RgColorPicker', editor: 'RgEditor',
  carousel: 'RgCarousel', timeline: 'RgTimeline', 'timeline-item': 'RgTimelineItem',
  calendar: 'RgCalendar', avatar: 'RgAvatar', 'avatar-group': 'RgAvatarGroup',
  'empty-state': 'RgEmptyState', chart: 'RgChart', image: 'RgImage',
  lightbox: 'RgLightbox', breadcrumbs: 'RgBreadcrumbs', crumb: 'RgCrumb',
};

test('stage 15 tags map to their primitives, and the catalog carries them', () => {
  for (const [tag, component] of Object.entries(EXPECTED)) {
    assert.equal(TAG_MAP[tag]?.component, component, `${tag} maps to ${component}`);
  }
  const catalog = buildCatalog();
  for (const tag of Object.keys(EXPECTED)) {
    assert.ok(catalog.tags.some((t) => t.tag === tag), `catalog lists <${tag}>`);
  }
  for (const component of Object.values(EXPECTED)) {
    assert.ok(catalog.primitives.some((p) => p.name === component), `catalog lists ${component}`);
  }
  assert.ok(DIAGNOSTIC_CODES.GEN_CHART_TYPE, 'GEN_CHART_TYPE has a description');
  assert.ok(DIAGNOSTIC_CODES.GEN_OTP_LENGTH, 'GEN_OTP_LENGTH has a description');
});

test('the stage 15 blocks compile to their primitives with no errors', () => {
  const result = compileInline(
    '<screen [refreshing]="busy" (refresh)="c()" (endReached)="c()">'
    + '<bottom-nav><nav-item icon="home" label="Home"></nav-item></bottom-nav>'
    + '<skeleton shape="circle" size="40"></skeleton>'
    + '<rating [value]="n" (change)="s($event)"></rating>'
    + '<otp [value]="v" (change)="s($event)"></otp>'
    + '<carousel><card><p>a</p></card></carousel>'
    + '<file-picker (change)="s($event)">Pick</file-picker>'
    + '<timeline><timeline-item title="T"><p>x</p></timeline-item></timeline>'
    + '<calendar [value]="v" (change)="s($event)"></calendar>'
    + '<avatar-group><avatar text="A B"></avatar></avatar-group>'
    + '<empty-state title="None"></empty-state>'
    + '<chart type="pie" [data]="pts"></chart>'
    + '<editor [value]="v" (change)="s($event)"></editor>'
    + '<image src="a.jpg" width="10" height="10"></image>'
    + '<lightbox [open]="busy" (close)="c()" src="a.jpg"></lightbox>'
    + '<color-picker [value]="v" (change)="s($event)"></color-picker>'
    + '<breadcrumbs><crumb>One</crumb><crumb>Two</crumb></breadcrumbs>'
    + '<row title="R"><row-action (click)="c()">Act</row-action></row>'
    + '</screen>',
    'busy = false; n = 0; v = "x"; pts = [{ label: "a", value: 1 }]; c() {} s(x: unknown) {}',
  );
  assert.equal(hasErrors(result.diagnostics), false, JSON.stringify(result.diagnostics));
  for (const prim of Object.values(EXPECTED)) {
    assert.match(result.code, new RegExp(prim), `${prim} is emitted`);
  }
});

test('(change) on every stage 15 control receives $event (the stage 14 lesson)', () => {
  const cases: [string, string][] = [
    ['<bottom-nav (change)="h($event)"><nav-item icon="home" label="H"></nav-item></bottom-nav>', 'bottom-nav'],
    ['<rating (change)="h($event)"></rating>', 'rating'],
    ['<otp (change)="h($event)"></otp>', 'otp'],
    ['<carousel (change)="h($event)"><p>a</p></carousel>', 'carousel'],
    ['<calendar (change)="h($event)"></calendar>', 'calendar'],
    ['<color-picker (change)="h($event)"></color-picker>', 'color-picker'],
    ['<file-picker (change)="h($event)">Pick</file-picker>', 'file-picker'],
    ['<editor (change)="h($event)"></editor>', 'editor'],
  ];
  for (const [inner, label] of cases) {
    const result = compileInline(`<screen>${inner}</screen>`, 'h(x: unknown) {}');
    assert.equal(hasErrors(result.diagnostics), false, `${label}: ${JSON.stringify(result.diagnostics)}`);
    assert.match(result.code, /onChange=\{\(\$event\) => h\(\$event\)\}/, `${label} handler receives $event`);
  }
});

test('(refresh) and (endReached) compile to the screen and list props', () => {
  const scr = compileInline(
    '<screen [refreshing]="busy" (refresh)="reload()" (endReached)="more()"><p>x</p></screen>',
    'busy = false; reload() {} more() {}',
  );
  assert.match(scr.code, /refreshing={busy}/);
  assert.match(scr.code, /onRefresh={\(\) => reload\(\)}/);
  assert.match(scr.code, /onEndReached={\(\) => more\(\)}/);
  const lst = compileInline(
    '<screen><list [refreshing]="busy" (refresh)="reload()" (endReached)="more()"><row title="a"></row></list></screen>',
    'busy = false; reload() {} more() {}',
  );
  assert.match(lst.code, /onRefresh={\(\) => reload\(\)}/);
  assert.match(lst.code, /onEndReached={\(\) => more\(\)}/);
});

test('stage 15 declarations warn GEN_CONTROL_NESTING in the wrong parent', () => {
  const cases: [string, string][] = [
    ['<screen><nav-item icon="home" label="H"></nav-item></screen>', 'nav-item outside bottom-nav'],
    ['<screen><bottom-nav><p>loose</p></bottom-nav></screen>', 'loose element inside bottom-nav'],
    ['<screen><row-action (click)="c()">A</row-action></screen>', 'row-action outside row'],
    ['<screen><timeline-item title="T"><p>x</p></timeline-item></screen>', 'timeline-item outside timeline'],
    ['<screen><timeline><p>loose</p></timeline></screen>', 'loose element inside timeline'],
    ['<screen><avatar-group><p>loose</p></avatar-group></screen>', 'non-avatar inside avatar-group'],
    ['<screen><crumb>One</crumb></screen>', 'crumb outside breadcrumbs'],
    ['<screen><breadcrumbs><p>loose</p></breadcrumbs></screen>', 'loose element inside breadcrumbs'],
  ];
  for (const [template, label] of cases) {
    const result = compileInline(template, 'c() {}');
    assert.ok(
      result.diagnostics.some((d) => d.code === 'GEN_CONTROL_NESTING'),
      `${label} warns: ${JSON.stringify(result.diagnostics)}`,
    );
  }
  const ok = compileInline(
    '<screen><bottom-nav><nav-item icon="home" label="H"></nav-item></bottom-nav>'
    + '<row title="R"><row-action (click)="c()">A</row-action></row>'
    + '<timeline><timeline-item title="T"><p>x</p></timeline-item></timeline>'
    + '<avatar-group><avatar text="A B"></avatar></avatar-group>'
    + '<avatar text="Solo Act"></avatar>'
    + '<breadcrumbs><crumb>One</crumb></breadcrumbs></screen>',
    'c() {}',
  );
  assert.ok(!ok.diagnostics.some((d) => d.code === 'GEN_CONTROL_NESTING'), JSON.stringify(ok.diagnostics));
});

test('lightbox without [open] warns GEN_OVERLAY_OPEN; chart type and otp length are checked', () => {
  const lb = compileInline('<screen><lightbox (close)="c()" src="a.jpg"></lightbox></screen>', 'c() {}');
  assert.ok(lb.diagnostics.some((d) => d.code === 'GEN_OVERLAY_OPEN'), 'lightbox warns');
  const chart = compileInline('<screen><chart type="area" [data]="pts"></chart></screen>', 'pts = [];');
  const chartDiag = chart.diagnostics.find((d) => d.code === 'GEN_CHART_TYPE');
  assert.ok(chartDiag, 'an unknown chart type is diagnosed');
  assert.equal(chartDiag?.severity, 'error');
  assert.equal(hasErrors(chart.diagnostics), true);
  for (const len of ['3', '9', 'six']) {
    const otp = compileInline(`<screen><otp length="${len}"></otp></screen>`);
    assert.ok(otp.diagnostics.some((d) => d.code === 'GEN_OTP_LENGTH'), `length ${len} warns`);
    assert.equal(hasErrors(otp.diagnostics), false, 'the otp length check is a warning, not an error');
  }
  const okOtp = compileInline('<screen><otp length="6"></otp></screen>');
  assert.ok(!okOtp.diagnostics.some((d) => d.code === 'GEN_OTP_LENGTH'), 'length 6 is quiet');
  const okChart = compileInline('<screen><chart type="line" [data]="pts"></chart></screen>', 'pts = [];');
  assert.ok(!okChart.diagnostics.some((d) => d.code === 'GEN_CHART_TYPE'), 'line is quiet');
});

test('the mask attribute lands on RgInput and a badge sits on a nav item', () => {
  const masked = compileInline(
    '<screen><input label="Phone" mask="999-999" [value]="v" (change)="s($event)"></screen>',
    'v = ""; s(x: string) { this.v = x; }',
  );
  assert.equal(hasErrors(masked.diagnostics), false, JSON.stringify(masked.diagnostics));
  assert.match(masked.code, /mask="999-999"/);
  const nav = compileInline(
    '<screen><bottom-nav><nav-item icon="mail" label="Mail" badge="3"></nav-item></bottom-nav></screen>',
  );
  assert.ok(!nav.diagnostics.some((d) => d.code === 'GEN_BADGE_HOST'), JSON.stringify(nav.diagnostics));
  assert.match(nav.code, /badge="3"/);
});

test('masonry is a mode of grid-list in codegen and the doctor guards image size', () => {
  const grid = compileInline(
    '<screen><grid-list cols="2" mode="masonry"><grid-tile><p>a</p></grid-tile></grid-list></screen>',
  );
  assert.match(grid.code, /<RgGridList cols="2" mode="masonry">/);
  const bare = compileInline('<screen><image src="a.jpg"></image></screen>');
  const { result, entry } = { result: bare, entry: 'inline.component.ts' };
  const findings = runDoctor({ result, entryFile: entry, styleTexts: [] });
  assert.ok(findings.some((f) => f.code === 'DOC_IMG_SIZE'), 'an image without size is a doctor finding');
});

// --- B: the three examples ---------------------------------------------------

for (const name of ['feed', 'forms-plus', 'insights']) {
  test(`${name} example: zero diagnostics, doctor clean, goldens and snapshot match`, () => {
    const { dir, entry, result } = compileExample(name);
    assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
    const golden = fs.readFileSync(path.join(dir, `${name}.component.tsx`), 'utf8');
    assert.equal(normalize(result.code), normalize(golden), `${name} tsx golden drifted`);
    const previewGolden = fs.readFileSync(path.join(dir, 'preview.html'), 'utf8');
    const preview = renderPreview(result.component!, result.ast!, {
      children: result.children,
      services: result.services,
    });
    assert.equal(normalize(preview), normalize(previewGolden), `${name} preview drifted; regenerate it with the CLI if intended`);
    const findings = runDoctor({
      result,
      entryFile: entry,
      styleTexts: doctorStyleTexts(result, entry, (abs) => (
        fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : undefined
      )),
    });
    assert.deepEqual(findings, [], JSON.stringify(findings));
    const snap = buildStyleSnapshot(name, result.component!, result.ast!, result.css!, result.children);
    const committed = JSON.parse(fs.readFileSync(path.join(dir, 'styles.snapshot.json'), 'utf8'));
    assert.deepEqual(snap, committed, `${name} style snapshot drifted`);
  });
}

test('example snapshots exercise the stage 15 roles', () => {
  const feed = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'feed', 'styles.snapshot.json'), 'utf8'));
  for (const role of ['bottomNav', 'navItem', 'skeleton', 'swipeAction']) {
    assert.ok(feed.themes.light.roles[role], `feed snapshot has the ${role} role`);
  }
  const forms = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'forms-plus', 'styles.snapshot.json'), 'utf8'));
  for (const role of ['rating', 'otp', 'carousel', 'picker']) {
    assert.ok(forms.themes.light.roles[role], `forms-plus snapshot has the ${role} role`);
  }
  const insights = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'insights', 'styles.snapshot.json'), 'utf8'));
  for (const role of ['timeline', 'calendar', 'avatarGroup', 'emptyState', 'chart', 'editor', 'image', 'lightbox', 'colorPicker', 'breadcrumbs', 'masonry']) {
    assert.ok(insights.themes.light.roles[role], `insights snapshot has the ${role} role`);
  }
});

// --- C: mask and chart parity ------------------------------------------------

const MASK_CASES: [string, string, string][] = [
  // [raw, pattern, expected]
  ['5551234567', '(999) 999-9999', '(555) 123-4567'],
  ['555', '(999) 999-9999', '(555'],
  ['5551', '(999) 999-9999', '(555) 1'],
  ['(555) 123-4567', '(999) 999-9999', '(555) 123-4567'],
  ['1a2', '99/99', '12'],
  ['ab12', 'AA-99', 'ab-12'],
  ['123456', '99/99/99', '12/34/56'],
  ['abcd', '999', ''],
  ['98', '99', '98'],
  ['x1y2', '**', 'x1'],
  ['', '(999)', ''],
  ['555-1234', '999-9999', '555-1234'],
];

test('applyMask formats through the pattern language', () => {
  for (const [raw, pattern, expected] of MASK_CASES) {
    assert.equal(applyMask(raw, pattern), expected, `mask ${pattern} over ${raw}`);
  }
  assert.equal(maskLength('(999) 999-9999'), 10);
  assert.equal(maskLength('AA-99'), 4);
});

const CHART_CASES: { type: string; data: unknown; w: number; h: number }[] = [
  { type: 'bar', data: [{ label: 'Mon', value: 12 }, { label: 'Tue', value: 19 }], w: 320, h: 160 },
  { type: 'bar', data: [{ label: 'Neg', value: -5 }, { label: 'Pos', value: 5, color: '#123456' }], w: 200, h: 100 },
  { type: 'bar', data: [], w: 320, h: 160 },
  { type: 'line', data: [{ label: 'A', value: 3 }], w: 320, h: 160 },
  { type: 'line', data: [{ label: 'A', value: 5 }, { label: 'B', value: 5 }, { label: 'C', value: 5 }], w: 300, h: 120 },
  { type: 'line', data: [{ label: 'A', value: 1 }, { label: 'B', value: 9 }, { label: 'C', value: 4 }], w: 300, h: 120 },
  { type: 'pie', data: [{ label: 'Only', value: 7 }], w: 240, h: 160 },
  { type: 'pie', data: [{ label: 'A', value: 1 }, { label: 'B', value: 3 }], w: 240, h: 160 },
  { type: 'pie', data: [{ label: 'A', value: 0 }, { label: 'B', value: 0 }], w: 240, h: 160 },
];

test('normalizeChartData drops unusable points and keeps colours', () => {
  assert.deepEqual(normalizeChartData('nope'), []);
  assert.deepEqual(normalizeChartData([{ label: 'a', value: 'x' }, null, { value: 2 }]), [
    { label: '', value: 2 },
  ]);
  assert.deepEqual(normalizeChartData([{ label: 'a', value: 1, color: '#fff' }]), [
    { label: 'a', value: 1, color: '#fff' },
  ]);
});

// --- D: preview DOM harness ----------------------------------------------------

class ShimText {
  constructor(public text: string) {}
  get textContent(): string { return this.text; }
}

class ShimElement {
  className = '';
  disabled = false;
  value = '';
  type = '';
  title = '';
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

const hasClass = (e: ShimElement, cls: string): boolean => e.className.split(' ').includes(cls);

function previewOf(template: string, classBody: string): ShimElement {
  const result = compileInline(template, classBody);
  assert.equal(hasErrors(result.diagnostics), false, JSON.stringify(result.diagnostics));
  const html = renderPreview(result.component!, result.ast!);
  return loadPreview(html).app;
}

function previewSandboxOf(template: string, classBody: string): Record<string, unknown> {
  const result = compileInline(template, classBody);
  const html = renderPreview(result.component!, result.ast!);
  return loadPreview(html).sandbox;
}

test('mask and chart parity: the page runtime mirrors the TypeScript engines', () => {
  const sandbox = previewSandboxOf('<screen><p>x</p></screen>', '');
  const pageMask = sandbox['__applyMask'] as (raw: string, pattern: string) => string;
  assert.equal(typeof pageMask, 'function');
  for (const [raw, pattern, expected] of MASK_CASES) {
    assert.equal(pageMask(raw, pattern), expected, `page mask ${pattern} over ${raw}`);
    assert.equal(pageMask(raw, pattern), applyMask(raw, pattern), 'page and TS masks agree');
  }
  const pageModel = sandbox['__chartModel'] as (
    type: string, data: unknown, w: number, h: number, palette: string[], labelColor: string,
  ) => unknown;
  assert.equal(typeof pageModel, 'function');
  for (const c of CHART_CASES) {
    const ts = chartModel(c.type, c.data, c.w, c.h, COLOR_SWATCHES, 'var(--role-text-muted)');
    const page = pageModel(c.type, c.data, c.w, c.h, COLOR_SWATCHES, 'var(--role-text-muted)');
    assert.deepEqual(JSON.parse(JSON.stringify(page)), JSON.parse(JSON.stringify(ts)), `chart parity for ${c.type}`);
  }
});

// --- E: preview behaviour ------------------------------------------------------

test('preview behaviour: bottom nav selects, runs the item press and reports the index', () => {
  const app = previewOf(
    '<screen><bottom-nav [index]="tab" (change)="go($event)"><nav-item icon="home" label="Home"></nav-item>'
    + '<nav-item icon="mail" label="Mail" (click)="ping()"></nav-item></bottom-nav>'
    + '<p>Tab {{ tab }} pinged {{ pings }}</p></screen>',
    'tab = 0; pings = 0; go(n: number) { this.tab = n; } ping() { this.pings = this.pings + 1; }',
  );
  const items = findAll(app, (e) => hasClass(e, 'nav-item'));
  assert.equal(items.length, 2);
  assert.ok(hasClass(items[0], 'selected'), 'the first item starts selected');
  items[1].click();
  assert.ok(app.textContent.includes('Tab 1 pinged 1'), 'the index and the item press both landed');
  const after = findAll(app, (e) => hasClass(e, 'nav-item'));
  assert.ok(hasClass(after[1], 'selected'), 'the second item is selected after the tap');
});

test('preview behaviour: refresh and end cues fire their screen events, and refreshing paints a spinner', () => {
  const app = previewOf(
    '<screen [refreshing]="busy" (refresh)="reload()" (endReached)="more()"><p>Count {{ count }}</p></screen>',
    'busy = false; count = 0; reload() { this.count = this.count + 1; } more() { this.count = this.count + 10; }',
  );
  findAll(app, (e) => hasClass(e, 'refresh-cue'))[0].click();
  assert.ok(app.textContent.includes('Count 1'), 'the refresh cue ran (refresh)');
  findAll(app, (e) => hasClass(e, 'end-cue'))[0].click();
  assert.ok(app.textContent.includes('Count 11'), 'the end cue ran (endReached)');
  const busy = previewOf(
    '<screen [refreshing]="busy" (refresh)="reload()"><p>x</p></screen>',
    'busy = true; reload() {}',
  );
  assert.ok(findAll(busy, (e) => hasClass(e, 'refresh-row')).length, 'a true refreshing flag paints the spinner row');
  assert.ok(!findAll(busy, (e) => hasClass(e, 'refresh-cue')).length, 'the cue hides while refreshing');
});

test('preview behaviour: a swipe row reveals its actions and choosing one runs it', () => {
  const app = previewOf(
    '<screen><list><row title="Mail"><row-action icon="delete" (click)="act()">Delete</row-action></row></list>'
    + '<p *ngIf="done">Acted</p></screen>',
    'done = false; act() { this.done = true; }',
  );
  assert.ok(!findAll(app, (e) => hasClass(e, 'row-swipe')).some((e) => hasClass(e, 'revealed')), 'the tray starts closed');
  findAll(app, (e) => hasClass(e, 'swipe-reveal'))[0].click();
  assert.ok(findAll(app, (e) => hasClass(e, 'row-swipe')).some((e) => hasClass(e, 'revealed')), 'the handle reveals the tray');
  findAll(app, (e) => hasClass(e, 'swipe-action'))[0].click();
  assert.ok(app.textContent.includes('Acted'), 'the action handler ran');
});

test('preview behaviour: rating stars, otp typing and carousel paging report through (change)', () => {
  const rated = previewOf(
    '<screen><rating [value]="score" (change)="rate($event)"></rating><p>Score {{ score }}</p></screen>',
    'score = 0; rate(n: number) { this.score = n; }',
  );
  const stars = findAll(rated, (e) => hasClass(e, 'rating-star'));
  assert.equal(stars.length, 5, 'five stars paint by default');
  stars[3].click();
  assert.ok(rated.textContent.includes('Score 4'), 'the fourth star wrote 4');

  const otpApp = previewOf(
    '<screen><otp length="4" [value]="code" (change)="setCode($event)"></otp><p>Code {{ code }}</p></screen>',
    'code = ""; setCode(v: string) { this.code = v; }',
  );
  const otpInput = findAll(otpApp, (e) => hasClass(e, 'otp-input'))[0];
  assert.ok(otpInput, 'the otp renders its hidden input');
  otpInput.value = 'a1b2';
  otpInput.dispatch('input');
  assert.ok(otpApp.textContent.includes('Code 12'), 'typing sanitizes to digits and emits the string');

  const car = previewOf(
    '<screen><carousel [index]="page" (change)="go($event)"><card><p>First</p></card><card><p>Second</p></card></carousel>'
    + '<p>Page {{ page }}</p></screen>',
    'page = 0; go(n: number) { this.page = n; }',
  );
  assert.ok(car.textContent.includes('First') && !car.textContent.includes('Second'), 'page one shows');
  findAll(car, (e) => hasClass(e, 'carousel-next'))[0].click();
  assert.ok(car.textContent.includes('Second'), 'the next chevron pages forward');
  assert.ok(car.textContent.includes('Page 1'), 'the index was reported');
});

test('preview behaviour: the file picker emits picked file info through (change)', () => {
  const app = previewOf(
    '<screen><file-picker kind="file" (change)="got($event)">Pick</file-picker><p *ngIf="name">Got {{ name }}</p></screen>',
    'name = ""; got(files: { name: string }[]) { this.name = files.length ? files[0].name : ""; }',
  );
  const input = findAll(app, (e) => hasClass(e, 'file-input'))[0] as unknown as { files?: unknown; dispatch: (t: string) => void };
  assert.ok(input, 'the picker renders a real file input');
  input.files = [{ name: 'notes.txt', size: 42, type: 'text/plain' }];
  input.dispatch('change');
  assert.ok(app.textContent.includes('Got notes.txt'), 'the pick wrote the file name back');
});

test('preview behaviour: a masked input stores the masked value', () => {
  const app = previewOf(
    '<screen><input label="Phone" mask="(999) 999-9999" [(ngModel)]="phone"><p>Phone {{ phone }}</p></screen>',
    'phone = "";',
  );
  const input = findAll(app, (e) => hasClass(e, 'field-input'))[0];
  input.value = '5551234567';
  input.dispatch('input');
  assert.ok(app.textContent.includes('Phone (555) 123-4567'), 'the model holds the masked string');
});

test('preview behaviour: the calendar moves months and a day tap reports the ISO date', () => {
  const app = previewOf(
    '<screen><calendar [value]="day" (change)="pick($event)"></calendar><p>Day {{ day }}</p></screen>',
    'day = "2026-11-13T00:00:00"; pick(v: string) { this.day = v; }',
  );
  assert.ok(app.textContent.includes('Nov 2026'), 'the value month shows');
  assert.ok(findAll(app, (e) => hasClass(e, 'calendar-day') && hasClass(e, 'selected')).length, 'the value day is selected');
  findAll(app, (e) => hasClass(e, 'calendar-next'))[0].click();
  assert.ok(app.textContent.includes('Dec 2026'), 'the chevron moves the shown month');
  const dayBtn = findAll(app, (e) => hasClass(e, 'calendar-day') && e.textContent === '25')[0];
  dayBtn.click();
  assert.ok(app.textContent.includes('Day 2026-12-25'), 'the tap reported the tapped day as ISO');
});

test('preview behaviour: colour swatches, editor toolbar, lightbox close and crumb clicks', () => {
  const colour = previewOf(
    '<screen><color-picker [value]="brand" (change)="setBrand($event)"></color-picker><p>Brand {{ brand }}</p></screen>',
    'brand = "#0b57d0"; setBrand(v: string) { this.brand = v; }',
  );
  findAll(colour, (e) => hasClass(e, 'picker-box'))[0].click();
  const swatches = findAll(colour, (e) => hasClass(e, 'swatch'));
  assert.ok(swatches.length >= 12, 'the sheet opens with the palette');
  const red = swatches.find((e) => e.getAttribute('data-hex') === '#d93025');
  assert.ok(red, 'the palette carries the data colours');
  red!.click();
  assert.ok(colour.textContent.includes('Brand #d93025'), 'the swatch wrote its hex back');

  const editor = previewOf(
    '<screen><editor [value]="notes" (change)="setNotes($event)"></editor><p>Notes: {{ notes }}</p></screen>',
    'notes = "hello"; setNotes(v: string) { this.notes = v; }',
  );
  const area = findAll(editor, (e) => hasClass(e, 'editor-area'))[0] as unknown as {
    value: string; selectionStart?: number; selectionEnd?: number;
  };
  area.selectionStart = 0;
  area.selectionEnd = 5;
  findAll(editor, (e) => hasClass(e, 'editor-tool') && e.textContent === 'Bold')[0].click();
  assert.ok(editor.textContent.includes('Notes: **hello**'), 'the Bold tool wrapped the selection in markers');

  const light = previewOf(
    '<screen><lightbox [open]="open" (close)="shut()" src="a.jpg"><p>Cap</p></lightbox><p *ngIf="!open">Closed</p></screen>',
    'open = true; shut() { this.open = false; }',
  );
  assert.ok(light.textContent.includes('Cap'), 'the lightbox paints open with its caption');
  findAll(light, (e) => hasClass(e, 'lightbox-close'))[0].click();
  assert.ok(light.textContent.includes('Closed'), 'the close chip ran (close)');

  const crumbs = previewOf(
    '<screen><breadcrumbs><crumb (click)="go()">Home</crumb><crumb>Here</crumb></breadcrumbs><p *ngIf="went">Went</p></screen>',
    'went = false; go() { this.went = true; }',
  );
  findAll(crumbs, (e) => hasClass(e, 'crumb') && e.textContent === 'Home')[0].click();
  assert.ok(crumbs.textContent.includes('Went'), 'the crumb click ran');
});

test('preview behaviour: masonry carries its class, and the server paint covers the display pieces', () => {
  const mason = previewOf(
    '<screen><grid-list cols="2" mode="masonry"><grid-tile><p>a</p></grid-tile></grid-list></screen>',
    '',
  );
  assert.ok(findAll(mason, (e) => hasClass(e, 'masonry')).length, 'the masonry class is on the grid');

  const result = compileInline(
    '<screen><skeleton shape="circle" size="40"></skeleton>'
    + '<otp length="4" [value]="code"></otp>'
    + '<calendar [value]="day"></calendar>'
    + '<chart type="bar" [data]="pts"></chart>'
    + '<avatar text="Sarju Chapagain"></avatar>'
    + '<empty-state icon="mail" title="No mail"></empty-state>'
    + '<image src="a.jpg" width="100" height="50"></image>'
    + '<breadcrumbs><crumb>Home</crumb><crumb>Here</crumb></breadcrumbs></screen>',
    'code = "12"; day = "2026-11-13T00:00:00"; pts = [{ label: "Mon", value: 3 }];',
  );
  const paint = renderPreview(result.component!, result.ast!).split('<script>')[0];
  assert.ok(paint.includes('class="skeleton circle"'), 'the skeleton paints');
  assert.equal((paint.match(/class="otp-box/g) ?? []).length, 4, 'four otp boxes paint');
  assert.ok(paint.includes('calendar-day selected'), 'the calendar paints its selected day');
  assert.ok(paint.includes('<svg') && paint.includes('<rect'), 'the chart paints real SVG shapes');
  assert.ok(paint.includes('>SC</span>'), 'the avatar paints initials');
  assert.ok(paint.includes('No mail'), 'the empty state paints its title');
  assert.ok(paint.includes('<img class="rg-image"'), 'the image paints');
  assert.ok(paint.includes('class="crumb current"'), 'the last crumb paints as current');
});
