import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { compileComponent, CompileResult, hasErrors } from '../packages/compiler/src/compile';
import { EVENT_PROPS, TAG_MAP } from '../packages/compiler/src/codegen/generate';
import { DIAGNOSTIC_CODES } from '../packages/compiler/src/diagnostics';
import { doctorStyleTexts, runDoctor } from '../packages/compiler/src/doctor';
import { renderPreview } from '../packages/compiler/src/preview/renderPreview';
import { buildStyleSnapshot } from '../packages/compiler/src/preview/styleSnapshot';
import { FormControl, FormGroup, validateValue, Validators } from '../packages/runtime/src/index';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rangular-s8-'));
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

// --- Registration ------------------------------------------------------------

test('Stage 8: TAG_MAP, events and diagnostics register the forms surface', () => {
  assert.equal(TAG_MAP['input'].component, 'RgInput');
  assert.equal(TAG_MAP['input'].fromUi, true);
  assert.equal(TAG_MAP['form'].component, 'View');
  assert.equal(EVENT_PROPS['blur'], 'onBlur');
  for (const code of ['GEN_NGMODEL_TARGET', 'GEN_NGMODEL_EXPR', 'GEN_FORM_CONTROL', 'GEN_FORMGROUP_TYPE', 'GEN_FORM_INITIALIZER']) {
    assert.ok(DIAGNOSTIC_CODES[code], `missing diagnostic code ${code}`);
  }
});

// --- Runtime: Validators ------------------------------------------------------

test('runtime Validators: Angular error shapes, and empty values pass non-required validators', () => {
  assert.deepEqual(Validators.required(''), { required: true });
  assert.deepEqual(Validators.required(null), { required: true });
  assert.equal(Validators.required('x'), null);
  assert.deepEqual(Validators.minLength(3)('ab'), { minlength: { requiredLength: 3, actualLength: 2 } });
  assert.equal(Validators.minLength(3)('abc'), null);
  assert.equal(Validators.minLength(3)(''), null);
  assert.deepEqual(Validators.maxLength(2)('abc'), { maxlength: { requiredLength: 2, actualLength: 3 } });
  assert.equal(Validators.maxLength(2)('ab'), null);
  assert.deepEqual(Validators.email('not-an-email'), { email: true });
  assert.equal(Validators.email('a@b.com'), null);
  assert.equal(Validators.email(''), null);
  assert.deepEqual(Validators.pattern('[0-9]+')('abc'), {
    pattern: { requiredPattern: '^[0-9]+$', actualValue: 'abc' },
  });
  assert.equal(Validators.pattern('[0-9]+')('123'), null);
  assert.deepEqual(
    validateValue('', [Validators.required, Validators.minLength(3)]),
    { required: true },
  );
  assert.deepEqual(
    validateValue('ab', [Validators.required, Validators.minLength(3)]),
    { minlength: { requiredLength: 3, actualLength: 2 } },
  );
  assert.equal(validateValue('abc', [Validators.required, Validators.minLength(3)]), null);
});

// --- Runtime: FormControl / FormGroup -----------------------------------------

test('runtime FormControl: validity, touched, dirty and valueChanges', () => {
  const control = new FormControl('', [Validators.required, Validators.minLength(3)]);
  assert.equal(control.value, '');
  assert.equal(control.valid, false);
  assert.equal(control.invalid, true);
  assert.deepEqual(control.errors, { required: true });
  assert.equal(control.touched, false);
  assert.equal(control.dirty, false);
  assert.equal(control.pristine, true);

  const seen: unknown[] = [];
  const sub = control.valueChanges.subscribe((v) => seen.push(v));
  control.setValue('ab');
  assert.equal(control.dirty, true);
  assert.deepEqual(control.errors, { minlength: { requiredLength: 3, actualLength: 2 } });
  control.setValue('abc');
  assert.equal(control.valid, true);
  assert.equal(control.errors, null);
  assert.deepEqual(seen, ['ab', 'abc']);
  sub.unsubscribe();
  control.setValue('abcd');
  assert.deepEqual(seen, ['ab', 'abc']);

  control.markAsTouched();
  assert.equal(control.touched, true);
  assert.equal(control.untouched, false);

  const single = new FormControl('a@b.com', Validators.email);
  assert.equal(single.valid, true);
});

test('runtime FormGroup: value object, validity aggregation, get and markAllAsTouched', () => {
  const group = new FormGroup({
    name: new FormControl('', Validators.required),
    email: new FormControl('a@b.com', [Validators.required, Validators.email]),
  });
  assert.deepEqual(group.value, { name: '', email: 'a@b.com' });
  assert.equal(group.valid, false);
  assert.equal(group.invalid, true);
  assert.equal(group.errors, null);
  assert.equal(group.get('email').valid, true);
  assert.equal(group.get('missing'), undefined);
  group.get('name').setValue('Bigyan');
  assert.equal(group.valid, true);
  assert.deepEqual(group.value, { name: 'Bigyan', email: 'a@b.com' });
  assert.equal(group.touched, false);
  group.markAllAsTouched();
  assert.equal(group.touched, true);
  assert.equal(group.get('name').touched, true);
  assert.equal(group.get('email').touched, true);
});

// --- Examples: goldens, doctor, snapshots --------------------------------------

test('signup-form example: zero diagnostics, doctor clean, golden and style snapshot match', () => {
  const { dir, entry, result } = compileExample('signup-form');
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  const golden = fs.readFileSync(path.join(dir, 'signup-form.component.tsx'), 'utf8');
  assert.equal(normalize(result.code), normalize(golden));
  const findings = runDoctor({
    result,
    entryFile: entry,
    styleTexts: doctorStyleTexts(result, entry, (abs) => (
      fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : undefined
    )),
  });
  assert.deepEqual(findings, [], JSON.stringify(findings));
  const snap = buildStyleSnapshot('signup-form', result.component!, result.ast!, result.css!, result.children);
  const committed = JSON.parse(fs.readFileSync(path.join(dir, 'styles.snapshot.json'), 'utf8'));
  assert.deepEqual(snap, committed);
  for (const role of ['input', 'inputError']) {
    assert.ok(snap.themes.light.roles[role], `missing light role ${role}`);
    assert.ok(snap.themes.dark.roles[role], `missing dark role ${role}`);
  }
});

test('signup-form codegen: ngModel write-back, validation models, refs and the submit composition', () => {
  const { result } = compileExample('signup-form');
  const code = result.code;
  assert.ok(code.includes('value={name} onChangeText={($event) => setName($event)}'), code);
  assert.ok(code.includes('value={email} onChangeText={($event) => setEmail($event)}'), code);
  assert.ok(code.includes("const nameErrors = validateValue(name, [Validators.required, Validators.minLength(3)]);"), code);
  assert.ok(code.includes('const emailErrors = validateValue(email, [Validators.required, Validators.email]);'), code);
  assert.ok(code.includes('const passwordErrors = validateValue(password, [Validators.required, Validators.minLength(6)]);'), code);
  assert.ok(code.includes('onBlur={() => setEmailTouched(true)}'), code);
  assert.ok(code.includes('secure label="Password"'), code);
  assert.ok(code.includes('keyboardType="email-address"'), code);
  // Refs read the model in template expressions; the disabled gate uses them.
  assert.ok(code.includes('nameModel.invalid && nameModel.touched'), code);
  assert.ok(code.includes('disabled={(((nameModel.invalid || emailModel.invalid) || passwordModel.invalid) || !terms)}'), code);
  // Submit: mark all touched, then the handler.
  assert.ok(code.includes('onPress={() => { setNameTouched(true); setEmailTouched(true); setPasswordTouched(true); save(); }}'), code);
  // Forms machinery never leaks into props.
  assert.ok(!code.includes('ngModel'), code);
  assert.ok(!code.includes('formControlName'), code);
  for (const line of code.split('\n')) {
    if (!line.includes('<RgInput')) continue;
    assert.ok(!/\s(required|minlength|maxlength|email|pattern)=/.test(line), line);
    assert.ok(!/\sngModel/.test(line), line);
  }
});

test('profile-form example: zero diagnostics, doctor clean, golden and style snapshot match', () => {
  const { dir, entry, result } = compileExample('profile-form');
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  const golden = fs.readFileSync(path.join(dir, 'profile-form.component.tsx'), 'utf8');
  assert.equal(normalize(result.code), normalize(golden));
  const findings = runDoctor({
    result,
    entryFile: entry,
    styleTexts: doctorStyleTexts(result, entry, (abs) => (
      fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : undefined
    )),
  });
  assert.deepEqual(findings, [], JSON.stringify(findings));
  const snap = buildStyleSnapshot('profile-form', result.component!, result.ast!, result.css!, result.children);
  const committed = JSON.parse(fs.readFileSync(path.join(dir, 'styles.snapshot.json'), 'utf8'));
  assert.deepEqual(snap, committed);
});

test('profile-form codegen: ref-held group, control wiring, version bump and the JSON summary', () => {
  const { result } = compileExample('profile-form');
  const code = result.code;
  assert.ok(code.includes('const profileFormRef = useRef(new FormGroup({'), code);
  assert.ok(code.includes("import { FormControl, FormGroup, Validators } from '@rangular/runtime';"), code);
  assert.ok(code.includes('control.valueChanges.subscribe(() => setFormVersion((v) => v + 1))'), code);
  assert.ok(code.includes("value={profileFormRef.current.get('email').value}"), code);
  assert.ok(code.includes("onChangeText={($event) => profileFormRef.current.get('email').setValue($event)}"), code);
  assert.ok(code.includes("profileFormRef.current.get('email').markAsTouched()"), code);
  assert.ok(code.includes('disabled={profileFormRef.current.invalid}'), code);
  assert.ok(code.includes('setSummary(JSON.stringify(profileFormRef.current.value));'), code);
  assert.ok(code.includes('profileFormRef.current.markAllAsTouched(); setFormVersion((v) => v + 1); save();'), code);
  assert.ok(!code.includes('formControlName='), code);
  assert.ok(!code.includes('formGroup='), code);
});

// --- Codegen: pair form, plain events, ngModelOptions ---------------------------

test('codegen: the explicit [ngModel] + (ngModelChange) pair, (input) and (blur) on inputs', () => {
  const { result } = compileProject({
    'pair.component.ts': `
      import { Component } from '@angular/core';
      @Component({ selector: 'app-pair', templateUrl: './pair.component.html' })
      export class PairComponent {
        email = '';
        query = '';
        blurred = false;
        onEmail(value: string) { this.email = value; }
        onQuery(value: string) { this.query = value; }
        onBlur() { this.blurred = true; }
      }
    `,
    'pair.component.html': `
      <screen>
        <input [ngModel]="email" (ngModelChange)="onEmail($event)" (blur)="onBlur()">
        <input [value]="query" (input)="onQuery($event)">
        <input [(ngModel)]="email" ngModelOptions="{standalone: true}">
      </screen>
    `,
  }, 'pair.component.ts');
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(result.code.includes('value={email} onChangeText={($event) => onEmail($event)} onBlur={() => onBlur()}'), result.code);
  assert.ok(result.code.includes('onChangeText={($event) => onQuery($event)} value={query}'), result.code);
  assert.ok(result.code.includes('value={email} onChangeText={($event) => setEmail($event)}'), result.code);
  assert.ok(!result.code.includes('ngModelOptions'), result.code);
  assert.ok(!result.code.includes('standalone'), result.code);
});

// --- Diagnostics -----------------------------------------------------------------

test('diagnostics: ngModel on a control is GEN_NGMODEL_TARGET, filed to the template', () => {
  const { result } = compileProject({
    'bad.component.ts': `
      import { Component } from '@angular/core';
      @Component({ selector: 'app-bad', templateUrl: './bad.component.html' })
      export class BadComponent {
        wifiOn = true;
        onWifi(value: boolean) { this.wifiOn = value; }
      }
    `,
    'bad.component.html': `
      <screen>
        <switch [(ngModel)]="wifiOn">Wi-Fi</switch>
      </screen>
    `,
  }, 'bad.component.ts');
  const found = result.diagnostics.filter((d) => d.code === 'GEN_NGMODEL_TARGET');
  assert.equal(found.length, 1, JSON.stringify(result.diagnostics));
  assert.equal(found[0].severity, 'error');
  assert.ok(found[0].file?.endsWith('bad.component.html'), found[0].file);
  assert.ok(found[0].fix && found[0].fix.length > 10);
});

test('diagnostics: ngModel bound to a member path degrades to one way with GEN_NGMODEL_EXPR', () => {
  const { result } = compileProject({
    'path.component.ts': `
      import { Component } from '@angular/core';
      @Component({ selector: 'app-path', templateUrl: './path.component.html' })
      export class PathComponent {
        user = { name: 'Bigyan' };
      }
    `,
    'path.component.html': `
      <screen>
        <input [(ngModel)]="user.name">
      </screen>
    `,
  }, 'path.component.ts');
  const found = result.diagnostics.filter((d) => d.code === 'GEN_NGMODEL_EXPR');
  assert.equal(found.length, 1, JSON.stringify(result.diagnostics));
  assert.equal(found[0].severity, 'warning');
  assert.ok(result.code.includes('value={user.name}'), result.code);
  assert.ok(!result.code.includes('onChangeText'), result.code);
});

test('diagnostics: reactive binding mistakes carry their codes', () => {
  const { result } = compileProject({
    'forms.component.ts': `
      import { Component } from '@angular/core';
      import { FormControl, FormGroup, Validators } from '@angular/forms';
      @Component({ selector: 'app-forms', templateUrl: './forms.component.html' })
      export class FormsComponent {
        title = 'Profile';
        profileForm = new FormGroup({
          email: new FormControl('', Validators.required),
        });
        save() {}
      }
    `,
    'forms.component.html': `
      <screen>
        <form [formGroup]="profileForm" (submit)="save()">
          <input formControlName="emial">
          <input [formControlName]="'email'">
        </form>
        <form [formGroup]="title" (submit)="save()">
          <input formControlName="email">
        </form>
        <input formControlName="email">
      </screen>
    `,
  }, 'forms.component.ts');
  const codes = result.diagnostics.map((d) => d.code);
  // Unknown control name, the [formControlName] binding form (whose input
  // then has no group either), the non-group [formGroup], and the orphan.
  assert.equal(codes.filter((c) => c === 'GEN_FORM_CONTROL').length, 4, JSON.stringify(result.diagnostics));
  assert.equal(codes.filter((c) => c === 'GEN_FORMGROUP_TYPE').length, 1, JSON.stringify(result.diagnostics));
  const unknown = result.diagnostics.find((d) => d.code === 'GEN_FORM_CONTROL' && d.message.includes('emial'));
  assert.ok(unknown && unknown.message.includes('email'), JSON.stringify(result.diagnostics));
  for (const d of result.diagnostics) {
    assert.ok(d.fix && d.fix.length > 10, JSON.stringify(d));
    assert.ok(d.file?.endsWith('forms.component.html'), d.file);
  }
});

test('diagnostics: a form initializer outside the preview subset warns GEN_FORM_INITIALIZER but still compiles', () => {
  const { result } = compileProject({
    'rich.component.ts': `
      import { Component } from '@angular/core';
      import { FormControl, FormGroup, Validators } from '@angular/forms';
      @Component({ selector: 'app-rich', templateUrl: './rich.component.html' })
      export class RichComponent {
        seed = 'x';
        profileForm = new FormGroup({
          email: new FormControl(this.seed, Validators.required),
        });
        save() {}
      }
    `,
    'rich.component.html': `
      <screen>
        <form [formGroup]="profileForm" (submit)="save()">
          <input formControlName="email">
        </form>
      </screen>
    `,
  }, 'rich.component.ts');
  const found = result.diagnostics.filter((d) => d.code === 'GEN_FORM_INITIALIZER');
  assert.equal(found.length, 1, JSON.stringify(result.diagnostics));
  assert.equal(found[0].severity, 'warning');
  assert.ok(found[0].file?.endsWith('rich.component.ts'), found[0].file);
  assert.equal(hasErrors(result.diagnostics), false);
  assert.ok(result.code.includes('useRef(new FormGroup({'), result.code);
  assert.ok(result.code.includes('new FormControl(this.seed, Validators.required)'), result.code);
});

// --- Preview: server paint --------------------------------------------------------

test('signup-form preview: server paint renders real inputs with labels and no premature errors', () => {
  const { result } = compileExample('signup-form');
  const html = renderPreview(result.component!, result.ast!, {
    children: result.children,
    services: result.services,
  });
  const paint = html.split('<script>')[0];
  assert.equal((paint.match(/<input class="field-input"/g) ?? []).length, 3);
  assert.ok(paint.includes('field-label">Full name'));
  assert.ok(paint.includes('type="password"'));
  assert.ok(paint.includes('placeholder="you@example.com"'));
  assert.ok(!paint.includes('Enter a valid email address.'));
  assert.ok(!paint.includes('Welcome aboard'));
  // The submit button starts disabled: every ref is invalid.
  assert.ok(/<button class="btn" disabled>Create account<\/button>/.test(paint), paint);
});

test('profile-form preview: server paint renders the group inputs and a disabled save', () => {
  const { result } = compileExample('profile-form');
  const html = renderPreview(result.component!, result.ast!, {
    children: result.children,
    services: result.services,
  });
  const paint = html.split('<script>')[0];
  assert.equal((paint.match(/<input class="field-input"/g) ?? []).length, 2);
  assert.ok(paint.includes('field-label">Email'));
  assert.ok(!paint.includes('Enter a valid email address.'));
  assert.ok(!paint.includes('Saved:'));
  assert.ok(/<button class="btn" disabled>Save profile<\/button>/.test(paint), paint);
});

// --- Preview DOM shim (Stage 6 pattern, extended for text entry) ------------------

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
const submitOf = (app: ShimElement) => findAll(app, (e) => hasClass(e, 'btn'))[0];

function typeInto(app: ShimElement, index: number, value: string): void {
  const input = inputsOf(app)[index];
  input.value = value;
  input.dispatch('input');
}

function blur(app: ShimElement, index: number): void {
  inputsOf(app)[index].dispatch('blur');
}

// --- Preview behaviour -------------------------------------------------------------

test('signup-form preview behaviour: errors on blur, submit enables when valid, success on submit', () => {
  const { result } = compileExample('signup-form');
  const html = renderPreview(result.component!, result.ast!, {
    children: result.children,
    services: result.services,
  });
  const app = loadPreview(html);

  assert.equal(inputsOf(app).length, 3);
  assert.ok(!app.textContent.includes('Enter a valid email address.'));
  assert.equal(submitOf(app).disabled, true);

  // Type an invalid email and leave the field: the error line appears.
  typeInto(app, 1, 'not-an-email');
  assert.ok(!app.textContent.includes('Enter a valid email address.'));
  blur(app, 1);
  assert.ok(app.textContent.includes('Enter a valid email address.'));

  // A too short name errors on blur too.
  typeInto(app, 0, 'Bo');
  blur(app, 0);
  assert.ok(app.textContent.includes('Name is required and needs at least 3 characters.'));

  // Fix everything; the button stays disabled until the terms box is on.
  typeInto(app, 0, 'Bigyan');
  typeInto(app, 1, 'bigyan@example.com');
  typeInto(app, 2, 'secret1');
  assert.ok(!app.textContent.includes('Enter a valid email address.'));
  assert.equal(submitOf(app).disabled, true);
  findAll(app, (e) => hasClass(e, 'checkbox'))[0].click();
  assert.equal(submitOf(app).disabled, false);

  submitOf(app).click();
  assert.ok(app.textContent.includes('Welcome aboard. Your account was created.'));
});

test('preview behaviour: a submit attempt marks every ngModel input touched', () => {
  const { result } = compileProject({
    'send.component.ts': `
      import { Component } from '@angular/core';
      @Component({ selector: 'app-send', templateUrl: './send.component.html' })
      export class SendComponent {
        code = '';
        saved = false;
        save() { this.saved = true; }
      }
    `,
    'send.component.html': `
      <screen>
        <form (submit)="save()">
          <input label="Code" [(ngModel)]="code" #code="ngModel" required>
          <p *ngIf="code.invalid && code.touched">Code is required.</p>
          <button type="submit">Send</button>
        </form>
        <p *ngIf="saved">Sent</p>
      </screen>
    `,
  }, 'send.component.ts');
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  const html = renderPreview(result.component!, result.ast!, {
    children: result.children,
    services: result.services,
  });
  const app = loadPreview(html);
  assert.ok(!app.textContent.includes('Code is required.'));
  submitOf(app).click();
  assert.ok(app.textContent.includes('Code is required.'));
  assert.ok(app.textContent.includes('Sent'));
});

test('profile-form preview behaviour: control errors via get(), submit prints the value as JSON', () => {
  const { result } = compileExample('profile-form');
  const html = renderPreview(result.component!, result.ast!, {
    children: result.children,
    services: result.services,
  });
  const app = loadPreview(html);

  assert.equal(inputsOf(app).length, 2);
  assert.equal(submitOf(app).disabled, true);
  assert.ok(!app.textContent.includes('Enter a valid email address.'));

  typeInto(app, 1, 'nope');
  blur(app, 1);
  assert.ok(app.textContent.includes('Enter a valid email address.'));
  assert.equal(submitOf(app).disabled, true);

  typeInto(app, 0, 'Bigyan');
  typeInto(app, 1, 'bigyan@example.com');
  assert.ok(!app.textContent.includes('Enter a valid email address.'));
  assert.equal(submitOf(app).disabled, false);

  submitOf(app).click();
  assert.ok(
    app.textContent.includes('Saved: {"name":"Bigyan","email":"bigyan@example.com"}'),
    app.textContent,
  );
});

// --- Generated output hygiene -------------------------------------------------------

test('Stage 8 generated goldens: only known components, no web-only APIs', () => {
  const allowed = new Set(Object.values(TAG_MAP).map((m) => m.component));
  for (const name of ['signup-form', 'profile-form']) {
    const code = fs.readFileSync(path.join(ROOT, 'examples', name, `${name}.component.tsx`), 'utf8');
    for (const m of code.matchAll(/export (?:default )?function (\w+)\(/g)) allowed.add(m[1]);
    for (const m of code.matchAll(/(?:^|[\s(])<([A-Z][A-Za-z0-9]*)(?=[\s/>])/gm)) {
      assert.ok(allowed.has(m[1]), `${name}: generated JSX element ${m[1]} is not a known primitive`);
    }
    assert.ok(!/\bdocument\.|\bwindow\.|localStorage|sessionStorage|react-dom/.test(code), name);
  }
  const primitives = fs.readFileSync(path.join(ROOT, 'packages', 'ui', 'src', 'primitives.tsx'), 'utf8');
  assert.ok(primitives.includes('export function RgInput('));
  assert.ok(primitives.includes('secureTextEntry'));
});
