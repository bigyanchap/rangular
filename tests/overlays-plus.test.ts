import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { compileComponent, CompileResult } from '../packages/compiler/src/compile';
import { renderPreview } from '../packages/compiler/src/preview/renderPreview';

// Overlays completion pass: button colour roles and the picker
// presentation. A <button> gains color="primary|danger|neutral"
// (danger paints the theme error role, neutral the quiet grey),
// validated at compile time, and <datetime-picker> gains
// presentation="modal|sheet": the same iOS wheels open centred
// in a dialog card by default, or in a bottom sheet when the
// author asks for presentation="sheet".

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

function compileProject(files: Record<string, string>, entryName: string): CompileResult {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rangular-op-'));
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
      for (const cand of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
          return { source: fs.readFileSync(cand, 'utf8'), fileName: cand };
        }
      }
      return undefined;
    },
  });
}

const FIXTURE_TS = `
import { Component } from '@angular/core';

@Component({
  selector: 'app-overlays-plus',
  templateUrl: './op.component.html',
})
export class OpComponent {
  confirmOpen = false;
  when = '2026-11-13T09:00:00';

  openConfirm() {
    this.confirmOpen = true;
  }

  closeConfirm() {
    this.confirmOpen = false;
  }

  deleteItem() {
    this.confirmOpen = false;
  }

  onWhen(value: string) {
    this.when = value;
  }
}
`;

const FIXTURE_HTML = `
<screen>
  <button (click)="openConfirm()">Delete the note</button>
  <dialog [open]="confirmOpen" (close)="closeConfirm()" title="Delete this note?">
    <p>The note leaves the list.</p>
    <actions>
      <button color="neutral" (click)="closeConfirm()">Cancel</button>
      <button color="danger" (click)="deleteItem()">Delete</button>
    </actions>
  </dialog>
  <datetime-picker label="Sheet time" mode="time" presentation="sheet" [value]="when" (change)="onWhen($event)"></datetime-picker>
  <datetime-picker label="Modal time" mode="time" presentation="modal" [value]="when" (change)="onWhen($event)"></datetime-picker>
  <datetime-picker label="Default time" mode="time" [value]="when" (change)="onWhen($event)"></datetime-picker>
  <p>When: {{ when }}</p>
</screen>
`;

function compileFixture(html: string = FIXTURE_HTML, ts: string = FIXTURE_TS): CompileResult {
  return compileProject({ 'op.component.ts': ts, 'op.component.html': html }, 'op.component.ts');
}

// --- Codegen ---------------------------------------------------------------------------

test('button color roles reach RgButton as props', () => {
  const result = compileFixture();
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(result.code!.includes('color="neutral"'), result.code!);
  assert.ok(result.code!.includes('color="danger"'), result.code!);
});

test('a button color outside the three roles is a GEN_BUTTON_COLOR error with the fix', () => {
  const result = compileFixture(FIXTURE_HTML.replace('color="danger"', 'color="red"'));
  const diag = result.diagnostics.find((d) => d.code === 'GEN_BUTTON_COLOR');
  assert.ok(diag, JSON.stringify(result.diagnostics));
  assert.equal(diag.severity, 'error');
  assert.ok(diag.fix?.includes('color="danger"'), diag.fix);
});

test('picker presentation reaches RgDateTimePicker; the default picker carries none', () => {
  const result = compileFixture();
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(result.code!.includes('presentation="modal"'), result.code!);
  assert.ok(result.code!.includes('presentation="sheet"'), result.code!);
  const pickers = result.code!.match(/<RgDateTimePicker[^>]*>/g) ?? [];
  assert.equal(pickers.length, 3, result.code!);
  assert.equal(pickers.filter((p) => p.includes('presentation')).length, 2, result.code!);
});

test('a picker presentation outside the two containers is a GEN_PICKER_PRESENTATION error', () => {
  const result = compileFixture(FIXTURE_HTML.replace('presentation="modal"', 'presentation="popup"'));
  const diag = result.diagnostics.find((d) => d.code === 'GEN_PICKER_PRESENTATION');
  assert.ok(diag, JSON.stringify(result.diagnostics));
  assert.equal(diag.severity, 'error');
  assert.ok(diag.fix?.includes('presentation="modal"'), diag.fix);
});

// --- Reminder example --------------------------------------------------------------------

test('reminder example: the modal picker and the coloured dialog buttons are in the golden', () => {
  const { result } = compileExample('reminder');
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(result.code!.includes('presentation="modal"'), result.code!);
  assert.ok(result.code!.includes('color="danger"'), result.code!);
  assert.ok(result.code!.includes('color="neutral"'), result.code!);
});

// --- Preview DOM shim (Stage 8 pattern) ---------------------------------------------------

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

function previewApp(): ShimElement {
  const result = compileFixture();
  const html = renderPreview(result.component!, result.ast!, {
    children: result.children,
    services: result.services,
  });
  return loadPreview(html);
}

test('preview: the dialog paints Cancel neutral and Delete danger', () => {
  const app = previewApp();
  const opener = findAll(app, (e) => hasClass(e, 'btn') && e.textContent.includes('Delete the note'))[0];
  assert.ok(opener, 'the opener button renders');
  opener.click();
  const cancel = findAll(app, (e) => hasClass(e, 'btn') && e.textContent.trim() === 'Cancel')[0];
  const del = findAll(app, (e) => hasClass(e, 'btn') && e.textContent.trim() === 'Delete')[0];
  assert.ok(cancel && hasClass(cancel, 'btn-neutral'), cancel?.className);
  assert.ok(del && hasClass(del, 'btn-danger'), del?.className);
});

test('preview: the modal and default pickers open centred in a dialog panel, the sheet picker does not', () => {
  const app = previewApp();
  const boxes = findAll(app, (e) => hasClass(e, 'picker-box'));
  assert.equal(boxes.length, 3);
  boxes[1].click();
  let overlays = findAll(app, (e) => hasClass(e, 'overlay'));
  assert.equal(overlays.length, 1);
  assert.ok(hasClass(overlays[0], 'overlay-center'), overlays[0].className);
  assert.equal(findAll(app, (e) => hasClass(e, 'dialog')).length, 1);
  assert.equal(findAll(app, (e) => hasClass(e, 'sheet')).length, 0);
  // Choose hour 11 on the hour wheel, then Done commits the ISO value.
  const hourWheel = findAll(app, (e) => e.getAttribute('data-wheel') === 'hour')[0];
  assert.ok(hourWheel, 'the hour wheel renders');
  const eleven = findAll(hourWheel, (e) => hasClass(e, 'wheel-value') && e.getAttribute('data-value') === '11')[0];
  assert.ok(eleven, 'the 11 option renders');
  eleven.click();
  const done = findAll(app, (e) => hasClass(e, 'picker-head-done'))[0];
  done.click();
  const when = findAll(app, (e) => e.tagName === 'P' && e.textContent.includes('When:'))[0];
  assert.ok(when.textContent.includes('2026-11-13T11:00:00'), when.textContent);
  // The sheet picker still opens as a sheet.
  const boxesAfter = findAll(app, (e) => hasClass(e, 'picker-box'));
  boxesAfter[0].click();
  overlays = findAll(app, (e) => hasClass(e, 'overlay'));
  assert.equal(overlays.length, 1);
  assert.ok(!hasClass(overlays[0], 'overlay-center'), overlays[0].className);
  assert.equal(findAll(app, (e) => hasClass(e, 'sheet')).length, 1);
  // And the picker with no presentation at all opens as a modal:
  // modal is the default container.
  const cancelBtn = findAll(app, (e) => hasClass(e, 'picker-head-btn') && e.textContent.trim() === 'Cancel')[0];
  cancelBtn.click();
  const boxesFinal = findAll(app, (e) => hasClass(e, 'picker-box'));
  boxesFinal[2].click();
  overlays = findAll(app, (e) => hasClass(e, 'overlay'));
  assert.equal(overlays.length, 1);
  assert.ok(hasClass(overlays[0], 'overlay-center'), overlays[0].className);
  assert.equal(findAll(app, (e) => hasClass(e, 'dialog')).length, 1);
});
