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

// --- A: tags, codegen and diagnostics --------------------------------------

test('stage 14 tags map to their primitives, and the catalog carries them', () => {
  const expected: Record<string, string> = {
    menu: 'RgMenu', 'menu-item': 'RgMenuItem', drawer: 'RgDrawer',
    select: 'RgSelect', stepper: 'RgStepper', step: 'RgStep',
    'grid-list': 'RgGridList', 'grid-tile': 'RgGridTile',
    tree: 'RgTree', 'tree-node': 'RgTreeNode', divider: 'RgDivider',
  };
  for (const [tag, component] of Object.entries(expected)) {
    assert.equal(TAG_MAP[tag]?.component, component, `${tag} maps to ${component}`);
  }
  const catalog = buildCatalog();
  for (const tag of Object.keys(expected)) {
    assert.ok(catalog.tags.some((t) => t.tag === tag), `catalog lists <${tag}>`);
  }
  for (const component of Object.values(expected)) {
    assert.ok(catalog.primitives.some((p) => p.name === component), `catalog lists ${component}`);
  }
  assert.ok(DIAGNOSTIC_CODES.GEN_TOOLTIP_HOST, 'GEN_TOOLTIP_HOST has a description');
});

test('the stage 14 blocks compile to their primitives with no errors', () => {
  const result = compileInline(
    '<screen>'
    + '<drawer [open]="o" (close)="c()"><p>x</p></drawer>'
    + '<menu [open]="o" (close)="c()"><menu-item (click)="c()">A</menu-item><divider></divider></menu>'
    + '<select [value]="v" (change)="s($event)"><option value="a">A</option></select>'
    + '<stepper><step label="One"><p>1</p></step></stepper>'
    + '<grid-list cols="3"><grid-tile><p>t</p></grid-tile></grid-list>'
    + '<tree><tree-node label="n"></tree-node></tree>'
    + '</screen>',
    'o = false; v = "a"; c() {} s(x: string) { this.v = x; }',
  );
  assert.equal(hasErrors(result.diagnostics), false, JSON.stringify(result.diagnostics));
  for (const prim of ['RgDrawer', 'RgMenu', 'RgMenuItem', 'RgDivider', 'RgSelect', 'RgStepper', 'RgGridList', 'RgGridTile', 'RgTree', 'RgTreeNode']) {
    assert.match(result.code, new RegExp(prim), `${prim} is emitted`);
  }
});

test('(change) on select and stepper receives $event, like every control', () => {
  // Regression: the $event wrapper used to cover only the Stage 6
  // controls and tabs, so select and stepper handlers generated an
  // arrow that referenced $event without ever receiving it.
  const sel = compileInline(
    '<screen><select [value]="v" (change)="pick($event)"><option value="a">A</option></select></screen>',
    'v = "a"; pick(x: string) { this.v = x; }',
  );
  assert.match(sel.code, /onChange=\{\(\$event\) => pick\(\$event\)\}/);
  const stp = compileInline(
    '<screen><stepper [index]="i" (change)="go($event)"><step label="A"><p>a</p></step></stepper></screen>',
    'i = 0; go(n: number) { this.i = n; }',
  );
  assert.match(stp.code, /onChange=\{\(\$event\) => go\(\$event\)\}/);
});

test('stage 14 declarations warn GEN_CONTROL_NESTING in the wrong parent', () => {
  const cases: [string, string][] = [
    ['<screen><menu-item (click)="c()">A</menu-item></screen>', 'menu-item outside menu'],
    ['<screen><step label="A"><p>a</p></step></screen>', 'step outside stepper'],
    ['<screen><grid-tile><p>t</p></grid-tile></screen>', 'grid-tile outside grid-list'],
    ['<screen><tree-node label="n"></tree-node></screen>', 'tree-node outside tree'],
    ['<screen><menu [open]="o" (close)="c()"><p>loose</p></menu></screen>', 'loose element inside menu'],
    ['<screen><stepper><p>loose</p></stepper></screen>', 'loose element inside stepper'],
    ['<screen><select [value]="v" (change)="c()"><p>loose</p></select></screen>', 'loose element inside select'],
  ];
  for (const [template, label] of cases) {
    const result = compileInline(template, 'o = true; v = "a"; c() {}');
    assert.ok(
      result.diagnostics.some((d) => d.code === 'GEN_CONTROL_NESTING'),
      `${label} warns: ${JSON.stringify(result.diagnostics)}`,
    );
  }
  // And the legal placements stay quiet, including option in select.
  const ok = compileInline(
    '<screen><select [value]="v" (change)="c()"><option value="a">A</option></select>'
    + '<tree><tree-node label="a"><tree-node label="b"></tree-node></tree-node></tree></screen>',
    'v = "a"; c() {}',
  );
  assert.ok(!ok.diagnostics.some((d) => d.code === 'GEN_CONTROL_NESTING'), JSON.stringify(ok.diagnostics));
});

test('menu and drawer without [open] warn GEN_OVERLAY_OPEN', () => {
  for (const tag of ['menu', 'drawer']) {
    const inner = tag === 'menu' ? '<menu-item (click)="c()">A</menu-item>' : '<p>x</p>';
    const result = compileInline(`<screen><${tag} (close)="c()">${inner}</${tag}></screen>`, 'c() {}');
    assert.ok(result.diagnostics.some((d) => d.code === 'GEN_OVERLAY_OPEN'), `${tag} warns`);
  }
});

test('tooltip passes through on pressable hosts and is dropped elsewhere', () => {
  const ok = compileInline('<screen><button tooltip="Saves" (click)="c()">Save</button></screen>', 'c() {}');
  assert.match(ok.code, /tooltip="Saves"/);
  assert.ok(!ok.diagnostics.some((d) => d.code === 'GEN_TOOLTIP_HOST'));
  const bad = compileInline('<screen><card tooltip="Nope"><p>x</p></card></screen>');
  assert.ok(bad.diagnostics.some((d) => d.code === 'GEN_TOOLTIP_HOST'));
  assert.ok(!/tooltip/.test(bad.code), 'the dropped tooltip never reaches the output');
});

// --- B: the two examples -----------------------------------------------------

for (const name of ['app-shell', 'explorer']) {
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

test('example snapshots exercise the stage 14 roles', () => {
  const shell = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'app-shell', 'styles.snapshot.json'), 'utf8'));
  for (const role of ['menu', 'menuItem', 'drawer', 'stepper', 'divider']) {
    assert.ok(shell.themes.light.roles[role], `app-shell snapshot has the ${role} role`);
  }
  const explorer = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'explorer', 'styles.snapshot.json'), 'utf8'));
  for (const role of ['select', 'treeNode', 'gridTile']) {
    assert.ok(explorer.themes.light.roles[role], `explorer snapshot has the ${role} role`);
  }
});

// --- C: preview behaviour ----------------------------------------------------

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

function loadPreview(html: string): { app: ShimElement } {
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
  return { app };
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

test('preview behaviour: choosing a menu item runs it and closes the menu', () => {
  const app = previewOf(
    '<screen><button (click)="openMenu()">Options</button>'
    + '<menu [open]="menuOpen" (close)="closeMenu()"><menu-item (click)="act(\'Rename\')">Rename</menu-item></menu>'
    + '<p *ngIf="lastAction">Did: {{ lastAction }}</p></screen>',
    'menuOpen = false; lastAction = \'\'; openMenu() { this.menuOpen = true; } closeMenu() { this.menuOpen = false; } act(n: string) { this.lastAction = n; }',
  );
  assert.ok(!app.textContent.includes('Rename'), 'menu starts closed');
  findAll(app, (e) => e.tagName === 'BUTTON' && e.textContent === 'Options')[0].click();
  assert.ok(app.textContent.includes('Rename'), 'menu opens');
  findAll(app, (e) => hasClass(e, 'menu-item'))[0].click();
  assert.ok(app.textContent.includes('Did: Rename'), 'the item handler ran');
  assert.ok(!findAll(app, (e) => hasClass(e, 'menu')).length, 'the menu closed after the choice');
});

test('preview behaviour: the drawer opens and its backdrop closes it', () => {
  const app = previewOf(
    '<screen><button (click)="openNav()">Nav</button>'
    + '<drawer [open]="navOpen" (close)="closeNav()"><p>Drawer body</p></drawer></screen>',
    'navOpen = false; openNav() { this.navOpen = true; } closeNav() { this.navOpen = false; }',
  );
  assert.ok(!app.textContent.includes('Drawer body'));
  findAll(app, (e) => e.tagName === 'BUTTON' && e.textContent === 'Nav')[0].click();
  assert.ok(app.textContent.includes('Drawer body'), 'drawer opens');
  findAll(app, (e) => hasClass(e, 'overlay-backdrop'))[0].click();
  assert.ok(!app.textContent.includes('Drawer body'), 'backdrop tap closes the drawer');
});

test('preview behaviour: select opens a sheet and the pick writes the value', () => {
  const app = previewOf(
    '<screen><select label="City" [value]="city" (change)="onCity($event)"><option value="ktm">Kathmandu</option><option value="pkr">Pokhara</option></select>'
    + '<p>Code: {{ city }}</p></screen>',
    'city = \'ktm\'; onCity(v: string) { this.city = v; }',
  );
  assert.ok(app.textContent.includes('Kathmandu'), 'the field shows the chosen label');
  findAll(app, (e) => hasClass(e, 'picker-box'))[0].click();
  const option = findAll(app, (e) => hasClass(e, 'select-option') && e.textContent.includes('Pokhara'))[0];
  assert.ok(option, 'the options sheet lists Pokhara');
  option.click();
  assert.ok(app.textContent.includes('Code: pkr'), 'the pick wrote the value back');
  assert.ok(!findAll(app, (e) => hasClass(e, 'select-option')).length, 'the sheet closed');
});

test('preview behaviour: stepper header taps move the page', () => {
  const app = previewOf(
    '<screen><stepper [index]="idx" (change)="go($event)"><step label="One"><p>First page</p></step><step label="Two"><p>Second page</p></step></stepper></screen>',
    'idx = 0; go(n: number) { this.idx = n; }',
  );
  assert.ok(app.textContent.includes('First page'));
  assert.ok(!app.textContent.includes('Second page'));
  findAll(app, (e) => hasClass(e, 'step-head') && e.textContent.includes('Two'))[0].click();
  assert.ok(app.textContent.includes('Second page'), 'the second step page shows');
  assert.ok(!app.textContent.includes('First page'), 'the first step page is replaced');
});

test('preview behaviour: tree branches expand and collapse', () => {
  const app = previewOf(
    '<screen><tree><tree-node label="Inbox" expanded><tree-node label="Work"></tree-node></tree-node>'
    + '<tree-node label="Archive"><tree-node label="2025"></tree-node></tree-node></tree></screen>',
    '',
  );
  assert.ok(app.textContent.includes('Work'), 'the seeded branch starts open');
  assert.ok(!app.textContent.includes('2025'), 'the unseeded branch starts closed');
  findAll(app, (e) => hasClass(e, 'tree-node-header') && e.textContent.includes('Archive'))[0].click();
  assert.ok(app.textContent.includes('2025'), 'tapping the branch opens it');
});

test('preview behaviour: the table sorts by a sortable header and pages', () => {
  const app = previewOf(
    '<screen><table [data]="people" pageSize="2"><column name="name" header="Name" sortable></column><column name="age" header="Age" sortable></column></table></screen>',
    'people = [{ name: \'Mina\', age: 31 }, { name: \'Arun\', age: 25 }, { name: \'Sita\', age: 40 }, { name: \'Bikash\', age: 25 }, { name: \'Anita\', age: 36 }];',
  );
  assert.ok(app.textContent.includes('1-2 of 5'), 'the pager shows the first page range');
  assert.ok(app.textContent.includes('Mina') && !app.textContent.includes('Sita'), 'page one holds the first two rows');
  findAll(app, (e) => hasClass(e, 'table-pager-btn'))[1].click();
  assert.ok(app.textContent.includes('3-4 of 5'), 'next moves to page two');
  assert.ok(app.textContent.includes('Sita'), 'page two shows its rows');
  findAll(app, (e) => hasClass(e, 'sortable') && e.textContent.includes('Name'))[0].click();
  assert.ok(app.textContent.includes('1-2 of 5'), 'sorting returns to the first page');
  assert.ok(app.textContent.includes('Anita') && app.textContent.includes('Arun'), 'rows are sorted by name ascending');
  findAll(app, (e) => hasClass(e, 'sortable') && e.textContent.includes('Name'))[0].click();
  assert.ok(app.textContent.includes('Sita') && app.textContent.includes('Mina'), 'a second tap sorts descending');
});

test('preview: tooltip rides the title attribute, and the divider paints', () => {
  const result = compileInline(
    '<screen><button tooltip="Saves the list" (click)="c()">Save</button><divider></divider></screen>',
    'c() {}',
  );
  const html = renderPreview(result.component!, result.ast!);
  assert.ok(html.split('<script>')[0].includes('title="Saves the list"'), 'server paint carries the tooltip as a title');
  assert.ok(html.split('<script>')[0].includes('class="divider"'), 'the divider paints');
  const { app } = loadPreview(html);
  const button = findAll(app, (e) => e.tagName === 'BUTTON')[0];
  assert.equal(button.title, 'Saves the list', 'the runtime button carries the title');
});
