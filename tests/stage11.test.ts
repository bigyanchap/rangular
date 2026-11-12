import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { compileComponent, CompileResult } from '../packages/compiler/src/compile';
import { EVENT_PROPS, TAG_MAP } from '../packages/compiler/src/codegen/generate';
import { DIAGNOSTIC_CODES } from '../packages/compiler/src/diagnostics';
import { doctorStyleTexts, runDoctor } from '../packages/compiler/src/doctor';
import { buildCatalog, parsePrimitives, renderCatalogMarkdown } from '../packages/compiler/src/catalog';
import { badgeTextOf, renderPreview, SPINNER_ARC_PATH } from '../packages/compiler/src/preview/renderPreview';
import { buildStyleSnapshot } from '../packages/compiler/src/preview/styleSnapshot';

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
  entryName = 'app.component.ts',
): { dir: string; entry: string; result: CompileResult } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rangular-s11-'));
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

// --- Registration ------------------------------------------------------------

test('Stage 11: tags, events, diagnostics, primitives and catalog register data display', () => {
  const expected: Record<string, string> = {
    tabs: 'RgTabs', tab: 'RgTab', accordion: 'RgAccordion', panel: 'RgPanel',
    table: 'RgTable', column: 'RgColumn', slider: 'RgSlider',
    'progress-bar': 'RgProgressBar', spinner: 'RgSpinner', chips: 'RgChips', chip: 'RgChip',
  };
  for (const [tag, component] of Object.entries(expected)) {
    assert.equal(TAG_MAP[tag].component, component, `${tag} maps to ${component}`);
    assert.equal(TAG_MAP[tag].fromUi, true, `${tag} comes from @rangular/ui`);
  }
  assert.equal(EVENT_PROPS['focus'], 'onFocus');
  assert.equal(EVENT_PROPS['toggle'], 'onToggle');
  assert.equal(EVENT_PROPS['remove'], 'onRemove');
  assert.equal(EVENT_PROPS['optionSelected'], 'onOptionSelected');
  for (const code of ['GEN_TABLE_COLUMN', 'GEN_SLIDER_RANGE', 'GEN_PROGRESS_RANGE', 'GEN_SPINNER_SIZE', 'GEN_BADGE_HOST']) {
    assert.ok(DIAGNOSTIC_CODES[code], `missing diagnostic code ${code}`);
  }
  const primitives = fs.readFileSync(path.join(ROOT, 'packages', 'ui', 'src', 'primitives.tsx'), 'utf8');
  for (const name of Object.values(expected)) {
    assert.ok(primitives.includes(`export function ${name}`), `missing primitive ${name}`);
  }
  assert.ok(primitives.includes('function BadgeDot('), 'the badge dot is an internal helper');
  assert.ok(!primitives.includes('export function BadgeDot'), 'BadgeDot is internal, not a public primitive');
  assert.ok(primitives.includes('export const SPINNER_ARC'), 'the spinner arc is one exported constant');
  assert.deepEqual(primitives.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], [], 'primitives carry no hex literals');
  const catalogued = parsePrimitives(primitives).map((p) => p.name);
  assert.ok(!catalogued.includes('BadgeDot'), 'the catalog lists exported primitives only');
  const catalog = buildCatalog();
  assert.ok(catalog.tags.some((t) => t.tag === 'tabs' && t.component === 'RgTabs'));
  assert.ok(catalog.tags.some((t) => t.tag === 'progress-bar' && t.component === 'RgProgressBar'));
  assert.ok(catalog.primitives.some((p) => p.name === 'RgTabs'
    && p.props.map((x) => x.name).join(',') === 'index,onChange,children,style'));
  assert.ok(catalog.primitives.some((p) => p.name === 'RgTable'));
  assert.ok(catalog.primitives.some((p) => p.name === 'RgChip'));
  assert.ok(catalog.diagnostics.some((d) => d.code === 'GEN_BADGE_HOST'));
  const md = renderCatalogMarkdown(catalog);
  assert.ok(md.includes('RgSlider'), 'catalog.md names the slider primitive');
});

// --- Codegen -----------------------------------------------------------------

test('Stage 11 codegen: tabs follow the controls contract, panels emit (toggle)', () => {
  const tabs = compileInline(
    '<screen><tabs [index]="tabIndex" (change)="onTab($event)"><tab label="Overview"><p>Hi</p></tab><tab label="Specs"><p>Yo</p></tab></tabs></screen>',
    'tabIndex = 0; onTab(i: number) { this.tabIndex = i; }',
  );
  assert.deepEqual(tabs.diagnostics, [], JSON.stringify(tabs.diagnostics));
  const code = normalize(tabs.code);
  assert.ok(code.includes('<RgTabs index={tabIndex} onChange={($event) => onTab($event)}>'), code);
  assert.ok(code.includes('<RgTab label="Overview">'), code);
  assert.ok(code.includes('<RgTab label="Specs">'), code);

  const panel = compileInline(
    '<screen><panel title="More" subtitle="Extra" (toggle)="onT($event)"><p>x</p></panel></screen>',
    'onT(open: boolean) { }',
  );
  assert.deepEqual(panel.diagnostics, [], JSON.stringify(panel.diagnostics));
  assert.ok(normalize(panel.code).includes('<RgPanel title="More" subtitle="Extra" onToggle={($event) => onT($event)}>'), panel.code);
});

test('Stage 11 codegen: table columns by name, with key as an alias', () => {
  const result = compileInline(
    '<screen><table [data]="rows"><column name="sender" header="From"></column><column key="subject" header="Subject"></column></table></screen>',
    'rows = [{ sender: "a", subject: "b" }];',
  );
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  const code = normalize(result.code);
  assert.ok(code.includes('<RgTable data={rows}>'), code);
  assert.ok(code.includes('<RgColumn name="sender" header="From" />'), code);
  assert.ok(code.includes('<RgColumn name="subject" header="Subject" />'), code);
});

test('Stage 11 codegen: slider, progress and spinner props', () => {
  const slider = compileInline(
    '<screen><slider min="0" max="3" step="1" [value]="lines" (change)="onLines($event)"></slider><slider></slider></screen>',
    'lines = 1; onLines(v: number) { this.lines = v; }',
  );
  assert.deepEqual(slider.diagnostics, [], JSON.stringify(slider.diagnostics));
  const sc = normalize(slider.code);
  assert.ok(sc.includes('<RgSlider min={0} max={3} step={1} value={lines} onChange={($event) => onLines($event)} />'), sc);
  assert.ok(sc.includes('<RgSlider />'), sc);

  const progress = compileInline(
    '<screen><progress-bar [value]="used"></progress-bar><progress-bar mode="indeterminate"></progress-bar></screen>',
    'used = 40;',
  );
  assert.deepEqual(progress.diagnostics, [], JSON.stringify(progress.diagnostics));
  const pc = normalize(progress.code);
  assert.ok(pc.includes('<RgProgressBar value={used} />'), pc);
  assert.ok(pc.includes('<RgProgressBar mode="indeterminate" />'), pc);

  const spinner = compileInline('<screen><spinner></spinner></screen>');
  assert.ok(normalize(spinner.code).includes('<RgSpinner />'), spinner.code);
});

test('Stage 11 codegen: chip icon, removable and (remove); badge on the three hosts', () => {
  const chip = compileInline(
    '<screen><chips><chip icon="star" removable (remove)="gone()">Star</chip></chips></screen>',
    'gone() { }',
  );
  assert.deepEqual(chip.diagnostics, [], JSON.stringify(chip.diagnostics));
  const cc = normalize(chip.code);
  assert.ok(cc.includes('<RgChip icon="star" removable onRemove={() => gone()}>Star</RgChip>'), cc);
  assert.ok(!cc.includes('no standard RN prop'), cc);

  const badge = compileInline(
    '<screen><button badge="3">Inbox</button><row title="Inbox" [badge]="unread"></row><icon name="bell" [badge]="unread"></icon></screen>',
    'unread = 3;',
  );
  assert.deepEqual(badge.diagnostics, [], JSON.stringify(badge.diagnostics));
  const bc = normalize(badge.code);
  assert.ok(bc.includes('<RgButton badge="3">Inbox</RgButton>'), bc);
  assert.ok(bc.includes('<RgRow title="Inbox" badge={unread} />'), bc);
  assert.ok(bc.includes('<RgIcon name="bell" badge={unread} />'), bc);
});

test('Stage 11 codegen: autocomplete wires options and optionSelected through the input', () => {
  const result = compileInline(
    '<screen><input [(ngModel)]="city" [options]="cities" (optionSelected)="onCity($event)"></screen>',
    "city = ''; cities = ['Oslo', 'Omsk']; onCity(name: string) { }",
  );
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  const code = normalize(result.code);
  assert.ok(code.includes('value={city}'), code);
  assert.ok(code.includes('onChangeText={($event) => setCity($event)}'), code);
  assert.ok(code.includes('options={cities}'), code);
  assert.ok(code.includes('onOptionSelected={($event) => onCity($event)}'), code);
});

test('Stage 11 codegen: the chip removal method carries an array filter assignment', () => {
  const result = compileInline(
    '<screen><chips><chip *ngFor="let f of filters" removable (remove)="removeFilter(f)">{{ f }}</chip></chips></screen>',
    "filters = ['Unread', 'Starred']; removeFilter(name: string) { this.filters = this.filters.filter((x: string) => x !== name); }",
  );
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(
    normalize(result.code).includes('setFilters(filters.filter((x: string) => x !== name));'),
    result.code,
  );
});

// --- Diagnostics ---------------------------------------------------------------

test('Stage 11 diagnostics: declaration nesting follows the control nesting pattern', () => {
  const cases: Array<[string, string]> = [
    ['<screen><tab label="X"><p>hi</p></tab></screen>', '<tabs'],
    ['<screen><column name="a"></column></screen>', '<table'],
    ['<screen><tabs><p>hi</p></tabs></screen>', '<tab'],
    ['<screen><table [data]="rows"><p>hi</p></table></screen>', '<column'],
    ['<screen><accordion><p>hi</p></accordion></screen>', '<panel'],
  ];
  for (const [template, fixPart] of cases) {
    const result = compileInline(template, 'rows = [];');
    const diag = result.diagnostics.find((d) => d.code === 'GEN_CONTROL_NESTING');
    assert.ok(diag, `${template} should warn GEN_CONTROL_NESTING: ${JSON.stringify(result.diagnostics)}`);
    assert.equal(diag.severity, 'warning');
    assert.ok(diag.fix?.includes(fixPart), `fix should show ${fixPart}: ${diag.fix}`);
  }
  const standalone = compileInline('<screen><panel title="x"><p>hi</p></panel></screen>');
  assert.ok(
    !standalone.diagnostics.some((d) => d.code === 'GEN_CONTROL_NESTING'),
    'a panel outside an accordion is legal and warns nothing',
  );
});

test('Stage 11 diagnostics: nesting errors name the template file', () => {
  const { result } = compileProject({
    'app.component.ts': `import { Component } from '@angular/core';
@Component({ selector: 'app-test', templateUrl: './app.component.html' })
export class TestComponent {}
`,
    'app.component.html': '<screen><tab label="X"><p>hi</p></tab></screen>',
  });
  const diag = result.diagnostics.find((d) => d.code === 'GEN_CONTROL_NESTING');
  assert.ok(diag, JSON.stringify(result.diagnostics));
  assert.ok(diag.file?.endsWith('app.component.html'), `file should be the template: ${diag.file}`);
});

test('Stage 11 diagnostics: column without a name, slider range, progress range, spinner size, badge host, chip icon', () => {
  const col = compileInline('<screen><table [data]="rows"><column header="From"></column></table></screen>', 'rows = [];');
  const colDiag = col.diagnostics.find((d) => d.code === 'GEN_TABLE_COLUMN');
  assert.ok(colDiag, JSON.stringify(col.diagnostics));
  assert.equal(colDiag.severity, 'error');

  const range = compileInline('<screen><slider min="10" max="5"></slider></screen>');
  const rangeDiag = range.diagnostics.find((d) => d.code === 'GEN_SLIDER_RANGE');
  assert.ok(rangeDiag, JSON.stringify(range.diagnostics));
  assert.equal(rangeDiag.severity, 'error');

  const step = compileInline('<screen><slider min="0" max="10" step="0"></slider></screen>');
  const stepDiag = step.diagnostics.find((d) => d.code === 'GEN_SLIDER_RANGE');
  assert.ok(stepDiag, JSON.stringify(step.diagnostics));
  assert.equal(stepDiag.severity, 'warning');
  assert.ok(normalize(step.code).includes('step={1}'), step.code);

  const prog = compileInline('<screen><progress-bar [value]="120"></progress-bar></screen>');
  const progDiag = prog.diagnostics.find((d) => d.code === 'GEN_PROGRESS_RANGE');
  assert.ok(progDiag, JSON.stringify(prog.diagnostics));
  assert.equal(progDiag.severity, 'warning');
  assert.ok(normalize(prog.code).includes('value={100}'), prog.code);

  const spin = compileInline('<screen><spinner size="26"></spinner></screen>');
  const spinDiag = spin.diagnostics.find((d) => d.code === 'GEN_SPINNER_SIZE');
  assert.ok(spinDiag, JSON.stringify(spin.diagnostics));
  assert.ok(normalize(spin.code).includes('size={24}'), spin.code);

  const host = compileInline('<screen><card badge="3"><p>x</p></card></screen>');
  const hostDiag = host.diagnostics.find((d) => d.code === 'GEN_BADGE_HOST');
  assert.ok(hostDiag, JSON.stringify(host.diagnostics));
  assert.equal(hostDiag.severity, 'warning');
  assert.ok(hostDiag.fix?.includes('button'), 'the fix names the supported hosts');
  assert.ok(!normalize(host.code).includes('badge'), 'the badge is dropped from the output');

  const icon = compileInline('<screen><chip icon="rocket">x</chip></screen>');
  const iconDiag = icon.diagnostics.find((d) => d.code === 'GEN_ICON_UNKNOWN');
  assert.ok(iconDiag, JSON.stringify(icon.diagnostics));
  assert.equal(iconDiag.severity, 'error');
  assert.ok((iconDiag as { validIcons?: string[] }).validIcons?.includes('star'), 'the full valid icon list rides along');
});

// --- Example: mailbox-pro --------------------------------------------------------

test('mailbox-pro example: zero diagnostics, doctor clean, golden and style snapshot match', () => {
  const { dir, entry, result } = compileExample('mailbox-pro');
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  const golden = fs.readFileSync(path.join(dir, 'mailbox-pro.component.tsx'), 'utf8');
  assert.equal(normalize(result.code), normalize(golden));
  const findings = runDoctor({
    result,
    entryFile: entry,
    styleTexts: doctorStyleTexts(result, entry, (abs) => (
      fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : undefined
    )),
  });
  assert.deepEqual(findings, [], JSON.stringify(findings));
  const snap = buildStyleSnapshot('mailbox-pro', result.component!, result.ast!, result.css!, result.children);
  const committed = JSON.parse(fs.readFileSync(path.join(dir, 'styles.snapshot.json'), 'utf8'));
  assert.deepEqual(snap, committed);
  for (const role of ['tabs', 'panel', 'table', 'slider', 'progress', 'spinner', 'chip', 'badgeDot']) {
    assert.ok(snap.themes.light.roles[role], `the snapshot carries the ${role} role`);
    assert.ok(snap.themes.dark.roles[role], `the dark snapshot carries the ${role} role`);
  }
});

test('mailbox-pro codegen: all seven pieces are present in the generated file', () => {
  const { result } = compileExample('mailbox-pro');
  const code = normalize(result.code);
  for (const line of [
    '<RgTabs index={tabIndex} onChange={($event) => onTab($event)}>',
    '<RgPanel title="About this mailbox" onToggle={($event) => onAboutToggle($event)}>',
    '<RgTable data={folders}>',
    '<RgColumn name="count" header="Messages" />',
    'onOptionSelected={($event) => onMove($event)} options={folderNames}',
    '<RgSlider min={0} max={3} step={1} value={previewLines} onChange={($event) => onLines($event)} />',
    '<RgProgressBar value={storageUsed} />',
    '<RgProgressBar mode="indeterminate" />',
    '<RgSpinner />',
    '<RgChip icon="star">Starred only</RgChip>',
    'badge={unread}',
    'setFilters(filters.filter((f: string) => f !== name));',
  ]) {
    assert.ok(code.includes(line), `generated code should include: ${line}`);
  }
});

test('mailbox-pro parity: generated code uses only known primitives and no web APIs', () => {
  const { result } = compileExample('mailbox-pro');
  const known = new Set(Object.values(TAG_MAP).map((m) => m.component));
  const importLine = result.code.split('\n').find((l) => l.includes("from '@rangular/ui'")) ?? '';
  const names = importLine.replace(/.*\{/, '').replace(/\}.*/, '').split(',').map((s) => s.trim()).filter(Boolean);
  assert.ok(names.length > 0, 'the example imports primitives from @rangular/ui');
  for (const name of names) assert.ok(known.has(name), `${name} is a known primitive`);
  for (const banned of ['document.', 'window.', 'localStorage', '<div', '<span', 'dangerouslySetInnerHTML']) {
    assert.ok(!result.code.includes(banned), `generated code must not contain ${banned}`);
  }
});

test('Stage 11 parity: the spinner arc and the badge text rule are single sourced', () => {
  const prim = fs.readFileSync(path.join(ROOT, 'packages', 'ui', 'src', 'primitives.tsx'), 'utf8');
  const uiArc = /SPINNER_ARC = '([^']+)'/.exec(prim)?.[1];
  assert.ok(uiArc, 'primitives export the arc constant');
  assert.equal(SPINNER_ARC_PATH, uiArc, 'the server paint draws the same arc');
  const previewSrc = fs.readFileSync(path.join(ROOT, 'packages', 'compiler', 'src', 'preview', 'renderPreview.ts'), 'utf8');
  const pageArc = /__SPINNER_ARC = '([^']+)'/.exec(previewSrc)?.[1];
  assert.equal(pageArc, uiArc, 'the page runtime draws the same arc');
  assert.equal(badgeTextOf(0), null);
  assert.equal(badgeTextOf(''), null);
  assert.equal(badgeTextOf(undefined), null);
  assert.equal(badgeTextOf(3), '3');
  assert.equal(badgeTextOf(99), '99');
  assert.equal(badgeTextOf(100), '99+');
  assert.equal(badgeTextOf('new'), 'new');
});

// --- Preview: paint and behaviour -------------------------------------------------

function renderMailboxPreview(): string {
  const { result } = compileExample('mailbox-pro');
  return renderPreview(result.component!, result.ast!, {
    children: result.children,
    services: result.services,
    routes: result.routes,
  });
}

test('mailbox-pro preview paint: active tab only, open panel only, badge, table, spinner, ticks', () => {
  const paint = renderMailboxPreview().split('<script>')[0];
  assert.ok(paint.includes('Train tickets for Friday'), 'the Inbox tab paints');
  assert.ok(!paint.includes('Launch checklist'), 'the Starred tab stays unpainted');
  assert.ok(paint.includes('Storage used'), 'the seeded open Storage panel paints its body');
  assert.ok(!paint.includes('Syncing now'), 'the closed Sync panel does not paint');
  assert.equal((paint.match(/class="badge-dot"/g) ?? []).length, 2, 'row and button badges paint');
  assert.ok(paint.includes('<span class="badge-dot">3</span>'), 'the badge count paints');
  assert.ok(paint.includes('Folder') && paint.includes('Messages'), 'the table headers paint');
  assert.ok(paint.includes('>30</span>'), 'the table counts paint');
  assert.ok(!paint.includes(SPINNER_ARC_PATH), 'the spinner stays unpainted inside the closed Sync panel');
  assert.ok(paint.includes('width:82%'), 'the determinate progress paints at 82 percent');
  assert.ok(!paint.includes('width:40%'), 'the indeterminate bar stays unpainted inside the closed Sync panel');
  assert.equal((paint.match(/class="slider-tick"/g) ?? []).length, 4, 'four step ticks paint for 0 to 3 step 1');
  assert.ok(paint.includes('Starred only') && paint.includes('Has attachment'), 'the chips paint');
});

test('Stage 11 preview paint: a standalone spinner and progress bar paint directly', () => {
  const result = compileInline(
    '<screen><spinner size="28"></spinner><progress-bar [value]="30"></progress-bar><progress-bar mode="indeterminate"></progress-bar></screen>',
  );
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  const paint = renderPreview(result.component!, result.ast!, {
    children: result.children,
    services: result.services,
  }).split('<script>')[0];
  assert.ok(paint.includes(SPINNER_ARC_PATH), 'the spinner arc paints');
  assert.ok(paint.includes('width="28"'), 'the spinner paints at its snapped size');
  assert.ok(paint.includes('width:30%'), 'the progress bar paints at its value');
  assert.ok(paint.includes('width:40%'), 'the indeterminate bar paints the static 40 percent width');
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
const buttonsWithText = (app: ShimElement, text: string): ShimElement[] =>
  findAll(app, (e) => e.tagName === 'BUTTON' && e.textContent === text);
const panelHeader = (app: ShimElement, title: string): ShimElement => {
  const header = findAll(app, (e) => hasClass(e, 'panel-header') && e.textContent.includes(title))[0];
  assert.ok(header, `the ${title} panel header is rendered`);
  return header;
};

test('mailbox-pro preview behaviour: switching tabs swaps the row list', () => {
  const { app } = loadPreview(renderMailboxPreview());
  assert.ok(app.textContent.includes('Train tickets for Friday'), 'Inbox rows show first');
  assert.ok(!app.textContent.includes('Launch checklist'), 'Starred rows stay hidden');
  const starred = findAll(app, (e) => hasClass(e, 'tab-header') && e.textContent.includes('Starred'))[0];
  assert.ok(starred, 'the Starred tab header is rendered');
  starred.click();
  assert.ok(app.textContent.includes('Launch checklist'), 'Starred rows show after the switch');
  assert.ok(!app.textContent.includes('Train tickets for Friday'), 'Inbox rows hide after the switch');
});

test('mailbox-pro preview behaviour: the accordion keeps one panel open; a standalone panel toggles itself', () => {
  const { app } = loadPreview(renderMailboxPreview());
  assert.ok(app.textContent.includes('Storage used'), 'Storage starts open');
  assert.ok(!app.textContent.includes('Syncing now'), 'Sync starts closed');
  panelHeader(app, 'Sync').click();
  assert.ok(app.textContent.includes('Syncing now'), 'Sync opens on tap');
  assert.ok(!app.textContent.includes('Storage used'), 'Storage closes when Sync opens (single-open)');
  assert.ok(app.textContent.includes('About open: false'), 'the About state starts false');
  panelHeader(app, 'About this mailbox').click();
  assert.ok(app.textContent.includes('About open: true'), '(toggle) reports the new state as $event');
  assert.ok(app.textContent.includes('One mailbox, every folder in one place.'), 'the About body shows');
  assert.ok(app.textContent.includes('Syncing now'), 'the standalone panel does not disturb the accordion');
});

test('mailbox-pro preview behaviour: autocomplete filters as you type and picks through ngModel', () => {
  const { app } = loadPreview(renderMailboxPreview());
  const input = () => findAll(app, (e) => e.tagName === 'INPUT')[0];
  assert.ok(input(), 'the move-to input is rendered');
  input().dispatch('focus');
  input().value = 'Tr';
  input().dispatch('input');
  const options = findAll(app, (e) => hasClass(e, 'auto-option'));
  assert.deepEqual(options.map((o) => o.textContent), ['Trash', 'Travel'], 'substring matches list in order');
  options[0].click();
  assert.equal(input().value, 'Trash', 'the pick writes back through the ngModel path');
  assert.ok(app.textContent.includes('Moved to Trash'), '(optionSelected) reports the chosen folder');
  assert.equal(findAll(app, (e) => hasClass(e, 'auto-option')).length, 0, 'the panel closes after the pick');
});

test('mailbox-pro preview behaviour: a slider tick sets the value; the badge clears at zero', () => {
  const { app } = loadPreview(renderMailboxPreview());
  assert.ok(app.textContent.includes('Preview lines: 1'), 'the slider value starts at 1');
  const ticks = findAll(app, (e) => hasClass(e, 'slider-tick'));
  assert.equal(ticks.length, 4, 'four ticks render for 0 to 3 step 1');
  ticks[3].click();
  assert.ok(app.textContent.includes('Preview lines: 3'), 'the tick tap emits through (change)');
  const dots = findAll(app, (e) => hasClass(e, 'badge-dot'));
  assert.equal(dots.length, 2, 'row and button badges render');
  assert.ok(dots.every((d) => d.textContent === '3'), 'both badges show the unread count');
  // The button's textContent carries its badge dot ("Mark all read3"),
  // so it is found by inclusion rather than the exact-match helper.
  const markAll = findAll(app, (e) => e.tagName === 'BUTTON' && e.textContent.includes('Mark all read'))[0];
  assert.ok(markAll, 'the Mark all read button is rendered');
  markAll.click();
  assert.equal(findAll(app, (e) => hasClass(e, 'badge-dot')).length, 0, 'a zero badge renders nothing');
});

test('mailbox-pro preview behaviour: removing a chip removes it from the array', () => {
  const { app } = loadPreview(renderMailboxPreview());
  const chipWith = (text: string) => findAll(app, (e) => hasClass(e, 'chip') && e.textContent === text)[0];
  assert.ok(chipWith('Unread'), 'the Unread chip renders');
  assert.ok(chipWith('Starred only'), 'the static chip renders');
  const remove = findAll(chipWith('Unread'), (e) => hasClass(e, 'chip-remove'))[0];
  assert.ok(remove, 'the removable chip has a remove control');
  remove.click();
  assert.ok(!chipWith('Unread'), 'the chip is gone after (remove)');
  assert.ok(chipWith('Has attachment'), 'the other filter chips stay');
  assert.ok(chipWith('Starred only'), 'the static chip stays');
});
