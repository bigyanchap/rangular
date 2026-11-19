import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { compileComponent, CompileResult, hasErrors } from '../packages/compiler/src/compile';
import { doctorStyleTexts, runDoctor } from '../packages/compiler/src/doctor';
import { renderPreview } from '../packages/compiler/src/preview/renderPreview';
import { buildStyleSnapshot } from '../packages/compiler/src/preview/styleSnapshot';
import { FormArray, FormBuilder, FormControl, FormGroup, Validators } from '../packages/runtime/src/index';

// Forms completion pass: FormArray and FormBuilder. FormGroup and
// FormArray are tree nodes now (a group or array holds controls,
// groups and arrays), the template surface gains formArrayName plus
// the bound [formControlName] row index, and FormBuilder is a
// built-in injection whose group/control/array calls are recognised
// as form field initializers.

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rangular-ft-'));
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

// --- Runtime: FormArray ---------------------------------------------------------

test('runtime FormArray: value and validity aggregate over rows', () => {
  const arr = new FormArray([
    new FormControl('', Validators.required),
    new FormControl('Ana'),
  ]);
  assert.equal(arr.length, 2);
  assert.deepEqual(arr.value, ['', 'Ana']);
  assert.equal(arr.valid, false);
  assert.equal(arr.invalid, true);
  assert.equal(arr.errors, null);
  (arr.at(0) as FormControl).setValue('Bo');
  assert.equal(arr.valid, true);
  assert.deepEqual(arr.value, ['Bo', 'Ana']);
  assert.equal(arr.at(1).value, 'Ana');
  assert.equal(arr.at(9), undefined);
});

test('runtime FormArray: push, insert, removeAt and clear keep value and validity live', () => {
  const arr = new FormArray([new FormControl('a')]);
  arr.push(new FormControl('', Validators.required));
  assert.equal(arr.length, 2);
  assert.equal(arr.valid, false);
  arr.insert(0, new FormControl('first'));
  assert.deepEqual(arr.value, ['first', 'a', '']);
  arr.removeAt(2);
  assert.deepEqual(arr.value, ['first', 'a']);
  assert.equal(arr.valid, true);
  arr.clear();
  assert.equal(arr.length, 0);
  assert.deepEqual(arr.value, []);
  assert.equal(arr.valid, true);
});

test('runtime FormArray: valueChanges fires on row edits and on structure changes', () => {
  const arr = new FormArray([new FormControl('a')]);
  const seen: unknown[][] = [];
  const sub = arr.valueChanges.subscribe((v) => seen.push(v));
  (arr.at(0) as FormControl).setValue('b');
  arr.push(new FormControl('c'));
  arr.removeAt(0);
  assert.deepEqual(seen, [['b'], ['b', 'c'], ['c']]);
  sub.unsubscribe();
  arr.push(new FormControl('d'));
  assert.equal(seen.length, 3);
});

test('runtime FormArray: touched and dirty derive from rows, markAllAsTouched recurses', () => {
  const row = new FormGroup({ name: new FormControl('') });
  const arr = new FormArray([row, new FormControl('')]);
  assert.equal(arr.touched, false);
  assert.equal(arr.dirty, false);
  arr.markAllAsTouched();
  assert.equal(arr.touched, true);
  assert.equal((row.get('name') as FormControl).touched, true);
  (arr.at(1) as FormControl).setValue('x');
  assert.equal(arr.dirty, true);
});

test('runtime FormArray: setValue needs the full row count, patchValue takes a prefix', () => {
  const arr = new FormArray([new FormControl(''), new FormControl('')]);
  assert.throws(() => arr.setValue(['only']), /expected 2 values, got 1/);
  arr.setValue(['a', 'b']);
  assert.deepEqual(arr.value, ['a', 'b']);
  arr.patchValue(['z']);
  assert.deepEqual(arr.value, ['z', 'b']);
});

// --- Runtime: the tree ----------------------------------------------------------

test('runtime tree: a group with an array and a nested group aggregates as one value', () => {
  const form = new FormGroup({
    team: new FormControl('', Validators.required),
    members: new FormArray([new FormControl('', Validators.required), new FormControl('Ana')]),
    venue: new FormGroup({ city: new FormControl('Salem') }),
  });
  assert.deepEqual(form.value, { team: '', members: ['', 'Ana'], venue: { city: 'Salem' } });
  assert.equal(form.valid, false);
  (form.get('team') as FormControl).setValue('Red');
  ((form.get('members') as FormArray).at(0) as FormControl).setValue('Bo');
  assert.equal(form.valid, true);
  assert.deepEqual(form.value, { team: 'Red', members: ['Bo', 'Ana'], venue: { city: 'Salem' } });
  form.markAllAsTouched();
  assert.equal(form.touched, true);
  assert.equal(((form.get('members') as FormArray).at(1) as FormControl).touched, true);
});

test('runtime tree: group valueChanges fires for row edits and row pushes', () => {
  const members = new FormArray([new FormControl('Ana')]);
  const form = new FormGroup({ members });
  const seen: Record<string, unknown>[] = [];
  const sub = form.valueChanges.subscribe((v) => seen.push(v));
  (members.at(0) as FormControl).setValue('Bo');
  members.push(new FormControl('Cy'));
  assert.deepEqual(seen, [{ members: ['Bo'] }, { members: ['Bo', 'Cy'] }]);
  sub.unsubscribe();
  members.push(new FormControl('Di'));
  assert.equal(seen.length, 2);
});

test('runtime tree: group setValue and patchValue recurse into arrays and groups', () => {
  const form = new FormGroup({
    name: new FormControl(''),
    members: new FormArray([new FormControl(''), new FormControl('')]),
  });
  form.setValue({ name: 'Red', members: ['Ana', 'Bo'] });
  assert.deepEqual(form.value, { name: 'Red', members: ['Ana', 'Bo'] });
  form.patchValue({ members: ['Cy'] });
  assert.deepEqual(form.value, { name: 'Red', members: ['Cy', 'Bo'] });
  assert.throws(() => form.setValue({ name: 'Red' }), /no value given for control 'members'/);
  assert.throws(() => form.setValue({ name: 'Red', members: ['a', 'b'], ghost: 1 }), /no control named 'ghost'/);
});

// --- Runtime: FormBuilder --------------------------------------------------------

test('runtime FormBuilder: tuples, plain values and instances coerce the Angular way', () => {
  const fb = new FormBuilder();
  const ready = new FormControl('ready');
  const form = fb.group({
    name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    city: 'Salem',
    ready,
    aliases: fb.array([['', Validators.required], 'Ana']),
    venue: fb.group({ city: ['Salem'] }),
  });
  assert.deepEqual(form.value, {
    name: '', email: '', city: 'Salem', ready: 'ready',
    aliases: ['', 'Ana'], venue: { city: 'Salem' },
  });
  assert.equal(form.valid, false);
  assert.equal(form.get('ready'), ready);
  (form.get('name') as FormControl).setValue('Bo');
  ((form.get('aliases') as FormArray).at(0) as FormControl).setValue('B');
  assert.equal(form.valid, false);
  (form.get('email') as FormControl).setValue('bo@example.com');
  assert.equal(form.valid, true);
});

test('runtime FormBuilder: control() and array() build the same nodes as the classes', () => {
  const fb = new FormBuilder();
  const control = fb.control('', Validators.required);
  assert.ok(control instanceof FormControl);
  assert.equal(control.valid, false);
  const arr = fb.array(['x', ['', Validators.required], new FormControl('y')]);
  assert.ok(arr instanceof FormArray);
  assert.deepEqual(arr.value, ['x', '', 'y']);
  assert.equal(arr.valid, false);
  // A tuple's third element (async validators in Angular) is ignored.
  const withThird = fb.group({ a: ['v', Validators.required, 'ignored'] });
  assert.equal((withThird.get('a') as FormControl).value, 'v');
  assert.equal(withThird.valid, true);
});

// --- Codegen ----------------------------------------------------------------------

const TEAM_TS = `
  import { Component } from '@angular/core';
  import { FormArray, FormControl, FormGroup, Validators } from '@angular/forms';
  @Component({ selector: 'app-team', templateUrl: './team.component.html' })
  export class TeamComponent {
    teamForm = new FormGroup({
      team: new FormControl('', Validators.required),
      members: new FormArray([
        new FormControl('', Validators.required),
        new FormControl('Ana'),
      ]),
    });
    summary = '';
    addMember() {
      (this.teamForm.get('members') as FormArray).push(new FormControl('', Validators.required));
    }
    removeMember(i: number) {
      (this.teamForm.get('members') as FormArray).removeAt(i);
    }
    save() { this.summary = JSON.stringify(this.teamForm.value); }
  }
`;

const TEAM_HTML = `
  <screen>
    <form [formGroup]="teamForm" (submit)="save()">
      <input formControlName="team" label="Team name">
      <div formArrayName="members">
        <div *ngFor="let m of teamForm.get('members').controls; let i = index">
          <input [formControlName]="i" label="Member">
          <button (click)="removeMember(i)">Remove</button>
        </div>
      </div>
      <button (click)="addMember()">Add member</button>
      <button type="submit">Save</button>
    </form>
    <p>{{ summary }}</p>
  </screen>
`;

test('codegen: formArrayName rows wire through .at(i), and rows are born in methods', () => {
  const { result } = compileProject({
    'team.component.ts': TEAM_TS,
    'team.component.html': TEAM_HTML,
  }, 'team.component.ts');
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  const code = result.code;
  assert.ok(code.includes("import { FormArray, FormControl, FormGroup, Validators } from '@rangular-framework/runtime';"), code);
  assert.ok(code.includes("value={teamFormRef.current.get('members').at(i).value}"), code);
  assert.ok(code.includes("onChangeText={($event) => teamFormRef.current.get('members').at(i).setValue($event)}"), code);
  assert.ok(code.includes("teamFormRef.current.get('members').at(i).markAsTouched?.()"), code);
  assert.ok(code.includes("(teamFormRef.current.get('members')).push(new FormControl('', Validators.required))"), code);
  assert.ok(code.includes("(teamFormRef.current.get('members')).removeAt(i)"), code);
  assert.ok(!code.includes('formArrayName='), code);
  assert.ok(!code.includes('formControlName='), code);
});

test('codegen: a standalone FormArray field is a stable ref-held instance', () => {
  const { result } = compileProject({
    'rows.component.ts': `
      import { Component } from '@angular/core';
      import { FormArray, FormControl } from '@angular/forms';
      @Component({ selector: 'app-rows', templateUrl: './rows.component.html' })
      export class RowsComponent {
        rows = new FormArray([new FormControl('x')]);
      }
    `,
    'rows.component.html': `
      <screen>
        <p>Rows: {{ rows.length }}</p>
        <p>First: {{ rows.at(0).value }}</p>
      </screen>
    `,
  }, 'rows.component.ts');
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(result.code.includes('const rowsRef = useRef(new FormArray([new FormControl(\'x\')]));'), result.code);
  assert.ok(result.code.includes('rowsRef.current.valueChanges.subscribe(() => setFormVersion((v) => v + 1))'), result.code);
  const html = renderPreview(result.component!, result.ast!, {
    children: result.children,
    services: result.services,
  });
  const paint = html.split('<script>')[0];
  assert.ok(paint.includes('Rows: 1'), paint);
  assert.ok(paint.includes('First: x'), paint);
});

const BUILDER_TS = `
  import { Component } from '@angular/core';
  import { FormBuilder, Validators } from '@angular/forms';
  @Component({ selector: 'app-builder', templateUrl: './builder.component.html' })
  export class BuilderComponent {
    signupForm = this.fb.group({
      name: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      city: 'Salem',
      aliases: this.fb.array([
        ['', Validators.required],
      ]),
    });
    summary = '';
    constructor(private fb: FormBuilder) {}
    save() { this.summary = JSON.stringify(this.signupForm.value); }
  }
`;

const BUILDER_HTML = `
  <screen>
    <form [formGroup]="signupForm" (submit)="save()">
      <input formControlName="name" label="Name">
      <input formControlName="email" label="Email">
      <input formControlName="city" label="City">
      <div formArrayName="aliases">
        <div *ngFor="let a of signupForm.get('aliases').controls; let i = index">
          <input [formControlName]="i" label="Alias">
        </div>
      </div>
      <button type="submit">Save</button>
    </form>
    <p>{{ summary }}</p>
  </screen>
`;

test('codegen: FormBuilder is a built-in injection and its initializer is rewritten to the local', () => {
  const { result } = compileProject({
    'builder.component.ts': BUILDER_TS,
    'builder.component.html': BUILDER_HTML,
  }, 'builder.component.ts');
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  const code = result.code;
  assert.ok(code.includes('__container.register(FormBuilder, new FormBuilder());'), code);
  assert.ok(code.includes('const fb = __container.get<FormBuilder>(FormBuilder);'), code);
  assert.ok(code.includes('const signupFormRef = useRef(fb.group({'), code);
  assert.ok(code.includes('aliases: fb.array(['), code);
  assert.ok(!code.includes('this.fb'), code);
  assert.ok(code.includes("value={signupFormRef.current.get('aliases').at(i).value}"), code);
});

test('codegen: a service injecting FormBuilder resolves it from the container too', () => {
  const { result } = compileProject({
    'svc.component.ts': `
      import { Component } from '@angular/core';
      import { FormStore } from './form.store';
      @Component({ selector: 'app-svc', templateUrl: './svc.component.html' })
      export class SvcComponent {
        label = '';
        constructor(private store: FormStore) {}
        ngOnInit() { this.label = this.store.describe(); }
      }
    `,
    'form.store.ts': `
      import { Injectable } from '@angular/core';
      import { FormBuilder } from '@angular/forms';
      @Injectable({ providedIn: 'root' })
      export class FormStore {
        constructor(private fb: FormBuilder) {}
        describe() {
          const form = this.fb.group({ name: ['Ana'] });
          return JSON.stringify(form.value);
        }
      }
    `,
    'svc.component.html': `
      <screen>
        <p>{{ label }}</p>
      </screen>
    `,
  }, 'svc.component.ts');
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(result.code.includes('__container.register(FormBuilder, new FormBuilder());'), result.code);
  assert.ok(result.code.includes('__container.register(FormStore, new FormStore(__container.get<FormBuilder>(FormBuilder)))'), result.code);
});

// --- Diagnostics --------------------------------------------------------------------

test('diagnostics: formArrayName mistakes carry GEN_FORM_ARRAY with fixes', () => {
  const { result } = compileProject({
    'bad.component.ts': `
      import { Component } from '@angular/core';
      import { FormArray, FormControl, FormGroup, Validators } from '@angular/forms';
      @Component({ selector: 'app-bad', templateUrl: './bad.component.html' })
      export class BadComponent {
        form = new FormGroup({
          name: new FormControl('', Validators.required),
          members: new FormArray([new FormControl('')]),
        });
        save() {}
      }
    `,
    'bad.component.html': `
      <screen>
        <form [formGroup]="form" (submit)="save()">
          <div formArrayName="name">
            <input formControlName="0">
          </div>
          <div formArrayName="ghost">
            <input formControlName="0">
          </div>
          <div formArrayName="members">
            <input formControlName="member">
          </div>
        </form>
        <div formArrayName="members">
          <input formControlName="0">
        </div>
      </screen>
    `,
  }, 'bad.component.ts');
  const codes = result.diagnostics.map((d) => d.code);
  assert.equal(codes.filter((c) => c === 'GEN_FORM_ARRAY').length, 4, JSON.stringify(result.diagnostics));
  assert.equal(hasErrors(result.diagnostics), true);
  for (const d of result.diagnostics.filter((d) => d.code === 'GEN_FORM_ARRAY')) {
    assert.ok(d.fix && d.fix.length > 10, JSON.stringify(d));
    assert.ok(d.file?.endsWith('bad.component.html'), d.file);
  }
  const notArray = result.diagnostics.find((d) => d.code === 'GEN_FORM_ARRAY' && d.message.includes('not a FormArray'));
  assert.ok(notArray, JSON.stringify(result.diagnostics));
});

// --- Examples -------------------------------------------------------------------------

for (const name of ['team-form', 'builder-form']) {
  test(`${name} example: zero diagnostics, doctor clean, golden and style snapshot match`, () => {
    const { dir, entry, result } = compileExample(name);
    assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
    const golden = fs.readFileSync(path.join(dir, `${name}.component.tsx`), 'utf8');
    assert.equal(normalize(result.code), normalize(golden));
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
    assert.deepEqual(snap, committed);
  });
}

// --- Preview: server paint --------------------------------------------------------------

test('team-form preview paint: rows paint their values through the array scope', () => {
  const { result } = compileExample('team-form');
  const html = renderPreview(result.component!, result.ast!, {
    children: result.children,
    services: result.services,
  });
  const paint = html.split('<script>')[0];
  assert.equal((paint.match(/<input class="field-input"/g) ?? []).length, 3, paint);
  assert.ok(paint.includes('value="Ana"'), paint);
  assert.ok(!paint.includes('Member name is required.'), paint);
});

test('builder-form preview paint: tuple and plain entries paint as controls', () => {
  const { result } = compileExample('builder-form');
  const html = renderPreview(result.component!, result.ast!, {
    children: result.children,
    services: result.services,
  });
  const paint = html.split('<script>')[0];
  assert.equal((paint.match(/<input class="field-input"/g) ?? []).length, 4, paint);
  assert.ok(paint.includes('value="Salem"'), paint);
  assert.ok(/<button class="btn" disabled>Create account<\/button>/.test(paint), paint);
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

const inputsOf = (app: ShimElement) => findAll(app, (e) => e.tagName === 'INPUT');
const buttonOf = (app: ShimElement, text: string) => findAll(app, (e) => hasClass(e, 'btn') && e.textContent.includes(text))[0];

function typeInto(app: ShimElement, index: number, value: string): void {
  const input = inputsOf(app)[index];
  input.value = value;
  input.dispatch('input');
}

// --- Preview behaviour -----------------------------------------------------------------------

test('team-form preview behaviour: add and remove rows, typing writes rows, submit prints the tree', () => {
  const { result } = compileExample('team-form');
  const html = renderPreview(result.component!, result.ast!, {
    children: result.children,
    services: result.services,
  });
  const app = loadPreview(html);

  assert.equal(inputsOf(app).length, 3);
  assert.equal(inputsOf(app)[2].value, 'Ana');
  assert.equal(buttonOf(app, 'Save team').disabled, true);

  // Add a row: a third member input appears, still invalid and empty.
  buttonOf(app, 'Add member').click();
  assert.equal(inputsOf(app).length, 4);
  assert.equal(inputsOf(app)[3].value, '');

  // Fill the form in: team, the blank first member, the new member.
  typeInto(app, 0, 'Red');
  typeInto(app, 1, 'Bo');
  typeInto(app, 3, 'Cy');
  assert.equal(buttonOf(app, 'Save team').disabled, false);

  buttonOf(app, 'Save team').click();
  assert.ok(
    app.textContent.includes('Saved: {"team":"Red","members":["Bo","Ana","Cy"]}'),
    app.textContent,
  );

  // Remove the first member row: the saved shape follows on re-save.
  buttonOf(app, 'Remove').click();
  assert.equal(inputsOf(app).length, 3);
  buttonOf(app, 'Save team').click();
  assert.ok(
    app.textContent.includes('Saved: {"team":"Red","members":["Ana","Cy"]}'),
    app.textContent,
  );
});

test('builder-form preview behaviour: the builder tree validates and submits like the class form', () => {
  const { result } = compileExample('builder-form');
  const html = renderPreview(result.component!, result.ast!, {
    children: result.children,
    services: result.services,
  });
  const app = loadPreview(html);

  assert.equal(inputsOf(app).length, 4);
  assert.equal(inputsOf(app)[2].value, 'Salem');
  assert.equal(buttonOf(app, 'Create account').disabled, true);

  typeInto(app, 0, 'Bigyan');
  typeInto(app, 1, 'not-an-email');
  inputsOf(app)[1].dispatch('blur');
  assert.ok(app.textContent.includes('Enter a valid email address.'));
  assert.equal(buttonOf(app, 'Create account').disabled, true);

  typeInto(app, 1, 'bigyan@example.com');
  typeInto(app, 3, 'Big');
  assert.equal(buttonOf(app, 'Create account').disabled, false);

  buttonOf(app, 'Create account').click();
  assert.ok(
    app.textContent.includes('Saved: {"name":"Bigyan","email":"bigyan@example.com","city":"Salem","aliases":["Big"]}'),
    app.textContent,
  );
});
