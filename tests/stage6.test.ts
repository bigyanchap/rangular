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

function compileProject(files: Record<string, string>, entryName: string): { dir: string; entry: string; result: CompileResult } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rangular-s6-'));
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

const CONTROL_FILES = {
  'controls.component.ts': `
    import { Component } from '@angular/core';
    @Component({ selector: 'app-controls', templateUrl: './controls.component.html' })
    export class ControlsComponent {
      wifiOn = true;
      wifiLocked = false;
      done = false;
      view = 'list';
      size = 'm';
      onWifi(value: boolean) { this.wifiOn = value; }
      onDone(value: boolean) { this.done = value; }
      onView(value: string) { this.view = value; }
      onSize(value: string) { this.size = value; }
    }
  `,
  'controls.component.html': `
    <screen>
      <switch [checked]="wifiOn" [disabled]="wifiLocked" (change)="onWifi($event)">Wi-Fi</switch>
      <checkbox [checked]="done" (change)="onDone">Done</checkbox>
      <switcher [value]="view" (change)="onView($event)">
        <option value="list">List</option>
        <option value="stats">Statistics</option>
      </switcher>
      <radio-group [value]="size" (change)="onSize($event)">
        <radio value="s">Small</radio>
        <radio value="m">Medium</radio>
      </radio-group>
    </screen>
  `,
};

test('Stage 6: TAG_MAP and diagnostics register the full controls set', () => {
  assert.equal(TAG_MAP['switch'].component, 'RgSwitch');
  assert.equal(TAG_MAP['checkbox'].component, 'RgCheckbox');
  assert.equal(TAG_MAP['switcher'].component, 'RgSwitcher');
  assert.equal(TAG_MAP['option'].component, 'RgOption');
  assert.equal(TAG_MAP['radio-group'].component, 'RgRadioGroup');
  assert.equal(TAG_MAP['radio'].component, 'RgRadio');
  assert.ok(DIAGNOSTIC_CODES['GEN_CONTROL_NESTING']);
});

test('Stage 6 codegen: change handlers receive the emitted value as $event', () => {
  const { result } = compileProject(CONTROL_FILES, 'controls.component.ts');
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(result.code.includes('<RgSwitch checked={wifiOn} disabled={wifiLocked} onChange={($event) => onWifi($event)}>Wi-Fi</RgSwitch>'), result.code);
  assert.ok(result.code.includes('<RgCheckbox checked={done} onChange={onDone}>Done</RgCheckbox>'), result.code);
  assert.ok(result.code.includes('<RgSwitcher value={view} onChange={($event) => onView($event)}>'), result.code);
  assert.ok(result.code.includes('<RgOption value="list">List</RgOption>'), result.code);
  assert.ok(result.code.includes('<RgOption value="stats">Statistics</RgOption>'), result.code);
  assert.ok(result.code.includes('<RgRadioGroup value={size} onChange={($event) => onSize($event)}>'), result.code);
  assert.ok(result.code.includes('<RgRadio value="s">Small</RgRadio>'), result.code);
  assert.ok(result.code.includes('<RgRadio value="m">Medium</RgRadio>'), result.code);
});

test('Stage 6 nesting: declarations outside their group get a coded warning, a template file and a fix', () => {
  const { result } = compileProject({
    'bad.component.ts': `
      import { Component } from '@angular/core';
      @Component({ selector: 'app-bad', templateUrl: './bad.component.html' })
      export class BadComponent {
        view = 'list';
        size = 'm';
        onView(value: string) { this.view = value; }
        onSize(value: string) { this.size = value; }
      }
    `,
    'bad.component.html': `
      <screen>
        <option value="list">List</option>
        <radio value="m">Medium</radio>
        <switcher [value]="view" (change)="onView($event)"><p>List</p></switcher>
        <radio-group [value]="size" (change)="onSize($event)"><option value="m">Medium</option></radio-group>
      </screen>
    `,
  }, 'bad.component.ts');
  const nesting = result.diagnostics.filter((d) => d.code === 'GEN_CONTROL_NESTING');
  assert.equal(nesting.length, 4, JSON.stringify(result.diagnostics));
  assert.equal(hasErrors(nesting), false);
  for (const d of nesting) {
    assert.ok(d.file?.endsWith('bad.component.html'), d.file);
    assert.ok(d.fix && d.fix.length > 10, JSON.stringify(d));
  }
});

test('settings example: zero diagnostics, doctor clean, golden and style snapshot match', () => {
  const { dir, entry, result } = compileExample('settings');
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  const golden = fs.readFileSync(path.join(dir, 'settings.component.tsx'), 'utf8');
  assert.equal(normalize(result.code), normalize(golden));
  const findings = runDoctor({
    result,
    entryFile: entry,
    styleTexts: doctorStyleTexts(result, entry, (abs) => (
      fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : undefined
    )),
  });
  assert.deepEqual(findings, [], JSON.stringify(findings));
  const snap = buildStyleSnapshot('settings', result.component!, result.ast!, result.css!, result.children);
  const committed = JSON.parse(fs.readFileSync(path.join(dir, 'styles.snapshot.json'), 'utf8'));
  assert.deepEqual(snap, committed);
  for (const role of ['switch', 'checkbox', 'switcher', 'radio']) {
    assert.ok(snap.themes.light.roles[role], `missing light role ${role}`);
    assert.ok(snap.themes.dark.roles[role], `missing dark role ${role}`);
  }
});

test('settings generated code: only Rangular and React Native components appear as JSX tags', () => {
  const code = fs.readFileSync(path.join(ROOT, 'examples', 'settings', 'settings.component.tsx'), 'utf8');
  const allowed = new Set(Object.values(TAG_MAP).map((m) => m.component));
  for (const m of code.matchAll(/export (?:default )?function (\w+)\(/g)) allowed.add(m[1]);
  for (const m of code.matchAll(/(?:^|[\s(])<([A-Z][A-Za-z0-9]*)(?=[\s/>])/gm)) {
    assert.ok(allowed.has(m[1]), `generated JSX element ${m[1]} is not a known primitive`);
  }
  assert.ok(!/\bdocument\.|\bwindow\.|localStorage|sessionStorage|react-dom/.test(code));
});

test('switch primitive: the knob uses a linear timing move and never a spring', () => {
  const source = fs.readFileSync(path.join(ROOT, 'packages', 'ui', 'src', 'primitives.tsx'), 'utf8');
  assert.ok(source.includes('Animated.timing'));
  assert.ok(source.includes('Easing.linear'));
  assert.ok(source.includes('the knob only ever moves toward its target'));
  assert.ok(!source.includes('Animated.spring'));
});

test('settings preview: server paint shows the selected states and a linear switch transition', () => {
  const { result } = compileExample('settings');
  const html = renderPreview(result.component!, result.ast!, {
    children: result.children,
    services: result.services,
  });
  assert.ok(html.includes('class="switch on"'));
  assert.ok(html.includes('class="checkbox"'));
  assert.ok(html.includes('class="switcher-option selected"'));
  assert.ok(html.includes('class="radio-option selected"'));
  assert.ok(html.includes('transition: left .16s linear'));
  assert.ok(!html.includes('cubic-bezier('));
});

// --- Preview DOM shim (same pattern as Stage 5) ----------------------------------------------

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

function hasClass(el: ShimElement, name: string): boolean {
  return el.className.split(/\s+/).includes(name);
}

test('settings preview behaviour: every control changes the state driven content', () => {
  const { result } = compileExample('settings');
  const html = renderPreview(result.component!, result.ast!, {
    children: result.children,
    services: result.services,
  });
  const app = loadPreview(html);

  assert.ok(app.textContent.includes('Wi-Fi is on'));
  assert.ok(app.textContent.includes('Notifications are off'));
  assert.ok(app.textContent.includes('List panel'));
  assert.ok(!app.textContent.includes('Statistics panel'));
  assert.ok(app.textContent.includes('Chosen size: m'));

  const switches = findAll(app, (e) => hasClass(e, 'switch'));
  assert.equal(switches.length, 1);
  assert.ok(hasClass(switches[0], 'on'));
  switches[0].click();
  assert.ok(app.textContent.includes('Wi-Fi is off'));
  assert.ok(!hasClass(findAll(app, (e) => hasClass(e, 'switch'))[0], 'on'));

  const checkboxes = findAll(app, (e) => hasClass(e, 'checkbox'));
  assert.equal(checkboxes.length, 1);
  checkboxes[0].click();
  assert.ok(app.textContent.includes('Notifications are on'));
  assert.ok(hasClass(findAll(app, (e) => hasClass(e, 'checkbox'))[0], 'on'));

  const segments = findAll(app, (e) => hasClass(e, 'switcher-option'));
  assert.equal(segments.length, 2);
  assert.ok(hasClass(segments[0], 'selected'));
  segments[1].click();
  assert.ok(app.textContent.includes('Statistics panel'));
  assert.ok(!app.textContent.includes('List panel'));
  const segmentsAfter = findAll(app, (e) => hasClass(e, 'switcher-option'));
  assert.ok(hasClass(segmentsAfter[1], 'selected'));

  const radios = findAll(app, (e) => hasClass(e, 'radio-option'));
  assert.equal(radios.length, 3);
  assert.ok(hasClass(radios[1], 'selected'));
  radios[2].click();
  assert.ok(app.textContent.includes('Chosen size: l'));
  const radiosAfter = findAll(app, (e) => hasClass(e, 'radio-option'));
  assert.ok(hasClass(radiosAfter[2], 'selected'));
  assert.ok(!hasClass(radiosAfter[1], 'selected'));
});
