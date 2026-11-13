import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { compileComponent, CompileResult, hasErrors } from '../packages/compiler/src/compile';
import { EVENT_PROPS, isAssignmentExpression, TAG_MAP } from '../packages/compiler/src/codegen/generate';
import { DIAGNOSTIC_CODES } from '../packages/compiler/src/diagnostics';
import { doctorStyleTexts, runDoctor } from '../packages/compiler/src/doctor';
import { parsePrimitives } from '../packages/compiler/src/catalog';
import { renderPreview } from '../packages/compiler/src/preview/renderPreview';
import { buildStyleSnapshot } from '../packages/compiler/src/preview/styleSnapshot';
import { SnackBar, SnackBarRef } from '../packages/runtime/src/index';
import { colours } from '../packages/ui/src/tokens';
import {
  applyWheelValue,
  composeDateTimeIso,
  dateTimeWheels,
  daysInMonth,
  formatDateTimeValue,
  parseDateTimeValue,
  pickerMinutes,
  pickerYears,
} from '../packages/ui/src/datetime';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rangular-s10-'));
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

test('Stage 10: tags, events, diagnostics and primitives register the overlay surface', () => {
  assert.equal(TAG_MAP['sheet'].component, 'RgSheet');
  assert.equal(TAG_MAP['dialog'].component, 'RgDialog');
  assert.equal(TAG_MAP['actions'].component, 'RgActions');
  assert.equal(TAG_MAP['datetime-picker'].component, 'RgDateTimePicker');
  for (const tag of ['sheet', 'dialog', 'actions', 'datetime-picker']) {
    assert.equal(TAG_MAP[tag].fromUi, true, `${tag} comes from @rangular/ui`);
  }
  assert.equal(EVENT_PROPS['close'], 'onClose');
  for (const code of ['GEN_PICKER_MODE', 'GEN_PICKER_INTERVAL', 'GEN_OVERLAY_OPEN', 'GEN_EVENT_ASSIGNMENT']) {
    assert.ok(DIAGNOSTIC_CODES[code], `missing diagnostic code ${code}`);
  }
  const primitives = fs.readFileSync(path.join(ROOT, 'packages', 'ui', 'src', 'primitives.tsx'), 'utf8');
  for (const name of ['RgSheet', 'RgDialog', 'RgActions', 'RgSnackbar', 'RgDateTimePicker']) {
    assert.ok(primitives.includes(`export function ${name}`), `missing primitive ${name}`);
  }
  assert.ok(primitives.includes('function RgWheel'), 'the picker wheel is the internal RgWheel component');
  assert.ok(!primitives.includes('export function RgWheel'), 'RgWheel is internal, not a public primitive');
  const catalogued = parsePrimitives(primitives).map((p) => p.name);
  assert.ok(!catalogued.includes('RgWheel'), 'the catalog lists exported primitives only');
  assert.ok(catalogued.includes('RgDateTimePicker'));
  assert.ok(!primitives.match(/#[0-9a-fA-F]{3,8}\b/), 'primitives keep every colour on theme roles');
});

// --- Runtime SnackBar ----------------------------------------------------------

test('runtime SnackBar: open state, replacement, action callbacks and dismiss', () => {
  const bar = new SnackBar();
  assert.equal(bar.current, null);
  let notices = 0;
  const unsub = bar.subscribe(() => { notices++; });

  const first = bar.open('First', 'Undo');
  assert.ok(first instanceof SnackBarRef);
  assert.deepEqual(bar.current, { message: 'First', actionLabel: 'Undo', durationMs: 4000 });
  let firstFired = 0;
  first.onAction(() => { firstFired++; });

  const second = bar.open('Second', 'Retry', 1200);
  assert.deepEqual(bar.current, { message: 'Second', actionLabel: 'Retry', durationMs: 1200 });
  let secondFired = 0;
  second.onAction(() => { secondFired++; });
  bar.pressAction();
  assert.equal(bar.current, null, 'pressing the action dismisses the bar');
  assert.equal(secondFired, 1, 'the current ref action callbacks fire');
  assert.equal(firstFired, 0, 'a replaced bar action callbacks do not fire');

  const third = bar.open('Third');
  let thirdFired = 0;
  third.onAction(() => { thirdFired++; });
  bar.dismiss();
  assert.equal(bar.current, null);
  assert.equal(thirdFired, 0, 'dismiss does not fire action callbacks');
  assert.ok(notices >= 5, 'subscribers hear opens and dismissals');
  unsub();
});

test('runtime SnackBar: a short duration auto-dismisses', async () => {
  const bar = new SnackBar();
  bar.open('Quick', undefined, 5);
  assert.equal(bar.current?.message, 'Quick');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(bar.current, null);
});

// --- Date and time helpers -----------------------------------------------------

test('datetime helpers: leap years, parsing, composition and formatting', () => {
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2000, 2), 29, '2000 is a leap year');
  assert.equal(daysInMonth(1900, 2), 28, '1900 is not a leap year');
  assert.equal(daysInMonth(2025, 2), 28);
  assert.equal(daysInMonth(2026, 4), 30);

  assert.deepEqual(parseDateTimeValue('2026-11-13T09:05:00'), { year: 2026, month: 11, day: 13, hour: 9, minute: 5 });
  assert.deepEqual(parseDateTimeValue('2026-11-13'), { year: 2026, month: 11, day: 13, hour: 0, minute: 0 });
  assert.deepEqual(parseDateTimeValue(new Date(2026, 0, 2, 3, 4)), { year: 2026, month: 1, day: 2, hour: 3, minute: 4 });
  assert.equal(parseDateTimeValue('2026-02-30T09:00:00'), null, 'February 30 does not parse');
  assert.equal(parseDateTimeValue('2026-13-01T09:00:00'), null, 'month 13 does not parse');
  assert.equal(parseDateTimeValue('tomorrow'), null);
  assert.equal(parseDateTimeValue(42), null);

  assert.equal(composeDateTimeIso({ year: 2026, month: 11, day: 13, hour: 9, minute: 5 }), '2026-11-13T09:05:00');
  assert.equal(composeDateTimeIso(parseDateTimeValue('2024-02-29T23:59:12')!), '2024-02-29T23:59:00');

  const parts = { year: 2026, month: 11, day: 13, hour: 9, minute: 0 };
  assert.equal(formatDateTimeValue(parts, 'date'), 'Nov 13, 2026');
  assert.equal(formatDateTimeValue(parts, 'time'), '9:00 AM');
  assert.equal(formatDateTimeValue(parts, 'datetime'), 'Nov 13, 2026 9:00 AM');
  assert.equal(formatDateTimeValue({ ...parts, hour: 0 }, 'time'), '12:00 AM');
  assert.equal(formatDateTimeValue({ ...parts, hour: 12 }, 'time'), '12:00 PM');
  assert.equal(formatDateTimeValue({ ...parts, hour: 13 }, 'time'), '1:00 PM');
});

test('datetime helpers: wheels, ranges, steps and wheel application', () => {
  const years = pickerYears(2026);
  assert.equal(years.length, 51);
  assert.equal(years[0], 2001);
  assert.equal(years[50], 2051);
  assert.deepEqual(pickerMinutes(5), [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  assert.equal(pickerMinutes(1).length, 60);

  const parts = { year: 2026, month: 11, day: 13, hour: 9, minute: 0 };
  const dateWheels = dateTimeWheels(parts, 'date', 1);
  assert.deepEqual(dateWheels.map((w) => w.name), ['month', 'day', 'year']);
  assert.equal(dateWheels[0].value, '11');
  assert.equal(dateWheels[0].options[10].label, 'Nov');
  assert.equal(dateWheels[2].options.length, 51);

  const timeWheels = dateTimeWheels({ ...parts, hour: 23, minute: 3 }, 'time', 5);
  assert.deepEqual(timeWheels.map((w) => w.name), ['hour', 'minute', 'ampm']);
  assert.equal(timeWheels[0].value, '11');
  assert.equal(timeWheels[1].value, '5', 'an off-step minute selects the nearest step');
  assert.equal(timeWheels[2].value, 'PM');

  const dateTime = dateTimeWheels(parts, 'datetime', 1);
  assert.deepEqual(dateTime.map((w) => w.name), ['date', 'hour', 'minute', 'ampm']);
  assert.equal(dateTime[0].options.length, 367, '183 days either side plus the value day');
  assert.equal(dateTime[0].options[183].label, 'Nov 13 2026');
  assert.equal(dateTime[0].value, '2026-11-13');

  assert.deepEqual(
    applyWheelValue({ year: 2025, month: 1, day: 31, hour: 9, minute: 0 }, 'month', '2'),
    { year: 2025, month: 2, day: 28, hour: 9, minute: 0 },
    'January 31 clamps to February 28 in a common year',
  );
  assert.deepEqual(
    applyWheelValue({ year: 2024, month: 1, day: 31, hour: 9, minute: 0 }, 'month', '2'),
    { year: 2024, month: 2, day: 29, hour: 9, minute: 0 },
    'and to February 29 in a leap year',
  );
  assert.equal(applyWheelValue(parts, 'ampm', 'PM').hour, 21);
  assert.equal(applyWheelValue({ ...parts, hour: 21 }, 'ampm', 'AM').hour, 9);
  assert.equal(applyWheelValue({ ...parts, hour: 12 }, 'hour', '3').hour, 15, 'the hour wheel composes with PM');
  assert.equal(applyWheelValue(parts, 'minute', '45').minute, 45);
});

// --- Codegen: picker -----------------------------------------------------------

test('picker codegen: value, change, mode and interval wiring', () => {
  const result = compileInline(
    '<datetime-picker label="When" mode="datetime" [value]="when" (change)="onWhen($event)"></datetime-picker>',
    `when = '2026-11-13T09:00:00'; onWhen(value: string) { this.when = value; }`,
  );
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  const code = normalize(result.code);
  assert.ok(code.includes('<RgDateTimePicker mode="datetime" label="When" value={when} onChange={($event) => onWhen($event)} />'));
});

test('picker diagnostics: unknown mode errors and intervals snap with a warning', () => {
  const badMode = compileInline('<datetime-picker mode="calendar" [value]="when"></datetime-picker>', `when = '';`);
  const modeDiag = badMode.diagnostics.find((d) => d.code === 'GEN_PICKER_MODE');
  assert.ok(modeDiag, JSON.stringify(badMode.diagnostics));
  assert.equal(modeDiag.severity, 'error');
  assert.ok(hasErrors(badMode.diagnostics));
  assert.ok(modeDiag.fix?.includes('date'));
  assert.ok(modeDiag.fix?.includes('time'));
  assert.ok(modeDiag.fix?.includes('datetime'));
  assert.ok(normalize(badMode.code).includes('mode="calendar"'), 'the bad mode stays visible in the output');

  const snapped = compileInline('<datetime-picker minuteInterval="4" [value]="when"></datetime-picker>', `when = '';`);
  const intervalDiag = snapped.diagnostics.find((d) => d.code === 'GEN_PICKER_INTERVAL');
  assert.ok(intervalDiag, JSON.stringify(snapped.diagnostics));
  assert.equal(intervalDiag.severity, 'warning');
  assert.ok(normalize(snapped.code).includes('minuteInterval={5}'), '4 snaps to the nearest supported interval, 5');
  const snappedDown = compileInline('<datetime-picker minuteInterval="2" [value]="when"></datetime-picker>', `when = '';`);
  assert.ok(normalize(snappedDown.code).includes('minuteInterval={1}'), '2 snaps to the nearest supported interval, 1');

  const notNumber = compileInline('<datetime-picker minuteInterval="abc" [value]="when"></datetime-picker>', `when = '';`);
  assert.ok(notNumber.diagnostics.some((d) => d.code === 'GEN_PICKER_INTERVAL'));
  assert.ok(normalize(notNumber.code).includes('minuteInterval={1}'));

  const boundLiteral = compileInline('<datetime-picker [minuteInterval]="4" [value]="when"></datetime-picker>', `when = '';`);
  assert.ok(boundLiteral.diagnostics.some((d) => d.code === 'GEN_PICKER_INTERVAL'));
  assert.ok(normalize(boundLiteral.code).includes('minuteInterval={5}'));

  const boundField = compileInline('<datetime-picker [minuteInterval]="step" [value]="when"></datetime-picker>', `when = ''; step = 5;`);
  assert.deepEqual(boundField.diagnostics, [], JSON.stringify(boundField.diagnostics));
  assert.ok(normalize(boundField.code).includes('minuteInterval={step}'), 'a field binding passes through unchecked');
});

// --- Codegen: sheet, dialog and the assignment decision ------------------------

test('overlay codegen: sheet, dialog and actions wire open, close and title', () => {
  const result = compileInline(
    '<sheet [open]="sheetOpen" (close)="closeSheet()"><p>Inside</p></sheet>' +
    '<dialog [open]="confirmOpen" (close)="closeConfirm()" title="Sure?"><p>Body</p><actions><button (click)="closeConfirm()">Cancel</button></actions></dialog>',
    `sheetOpen = false; confirmOpen = false;
     closeSheet() { this.sheetOpen = false; }
     closeConfirm() { this.confirmOpen = false; }`,
  );
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  const code = normalize(result.code);
  assert.ok(code.includes('<RgSheet open={sheetOpen} onClose={() => closeSheet()}>'));
  assert.ok(code.includes('<RgDialog title="Sure?" open={confirmOpen} onClose={() => closeConfirm()}>'));
  assert.ok(code.includes('<RgActions>'));
});

test('overlay diagnostics: a sheet or dialog without [open] warns and emits no open prop', () => {
  const result = compileInline('<sheet><p>Static</p></sheet><dialog title="Hi"><p>Static</p></dialog>');
  const warnings = result.diagnostics.filter((d) => d.code === 'GEN_OVERLAY_OPEN');
  assert.equal(warnings.length, 2, JSON.stringify(result.diagnostics));
  assert.ok(warnings.every((d) => d.severity === 'warning'));
  const code = normalize(result.code);
  assert.ok(code.includes('<RgSheet>'));
  assert.ok(!code.includes('open={true}'), 'the static reading is the primitive default, never an emitted prop');
});

test('event assignments: the grammar has no assignment and codegen drops them loudly', () => {
  assert.equal(isAssignmentExpression('sheetOpen = false'), true);
  assert.equal(isAssignmentExpression('count += 1'), true);
  assert.equal(isAssignmentExpression('closeSheet()'), false);
  assert.equal(isAssignmentExpression('a === b'), false, 'a comparison is an expression');
  assert.equal(isAssignmentExpression('a >= b'), false);
  assert.equal(isAssignmentExpression("go('a=b')"), false, 'an equals sign inside a string argument is not an assignment');

  const sheet = compileInline(
    '<sheet [open]="sheetOpen" (close)="sheetOpen = false"><p>Inside</p></sheet>',
    'sheetOpen = false;',
  );
  const diag = sheet.diagnostics.find((d) => d.code === 'GEN_EVENT_ASSIGNMENT');
  assert.ok(diag, JSON.stringify(sheet.diagnostics));
  assert.equal(diag.severity, 'warning');
  assert.ok(diag.fix?.includes('method'), 'the fix points at the method pattern');
  const sheetCode = normalize(sheet.code);
  assert.ok(!sheetCode.includes('onClose={() => sheetOpen = false'), 'no assignment handler reaches the generated code');
  assert.ok(!sheetCode.includes('onClose'), 'the binding is dropped, not half wired');
  assert.ok(sheetCode.includes('GEN_EVENT_ASSIGNMENT'), 'a TODO comment marks the dropped binding');

  const button = compileInline('<button (click)="count += 1">Add</button>', 'count = 0;');
  assert.ok(button.diagnostics.some((d) => d.code === 'GEN_EVENT_ASSIGNMENT'));
  assert.ok(!normalize(button.code).includes('count +='), 'the rule is not overlay specific');
});

// --- Codegen: SnackBar wiring ----------------------------------------------------

const SNACK_COMPONENT = `import { Component } from '@angular/core';
import { SnackBar } from '@angular/material/snack-bar';
@Component({ selector: 'app-test', template: '<button (click)="save()">Save</button>' })
export class TestComponent {
  restored = false;
  constructor(private snack: SnackBar) {}
  save() {
    const ref = this.snack.open('Saved', 'Undo');
    ref.onAction(() => { this.restored = true; });
  }
}
`;

test('snackbar codegen: module instance, dep line, entry host and the statement form', () => {
  const { result } = compileProject({ 'app.component.ts': SNACK_COMPONENT });
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  const code = normalize(result.code);
  assert.ok(code.includes('const __snackBar = new SnackBar();'));
  assert.ok(code.includes('const snack = __snackBar;'));
  assert.ok(code.includes('const [__snack, __setSnack] = useState(__snackBar.current);'));
  assert.ok(code.includes('useEffect(() => __snackBar.subscribe(() => __setSnack(__snackBar.current)), []);'));
  assert.ok(code.includes('{__snack && (<RgSnackbar message={__snack.message} actionLabel={__snack.actionLabel} onAction={() => __snackBar.pressAction()} />)}'));
  assert.ok(code.includes("const ref = snack.open('Saved', 'Undo');"), 'the const call form translates');
  assert.ok(code.includes('ref.onAction(() => {'), 'the block body arrow subscribes');
  assert.ok(code.includes('setRestored(true);'), 'assignments inside the block body arrow become setters');

  const plain = compileInline('<p>Hello</p>');
  const plainCode = normalize(plain.code);
  assert.ok(!plainCode.includes('__snackBar'), 'no SnackBar injection, no module instance');
  assert.ok(!plainCode.includes('RgSnackbar'), 'no SnackBar injection, no host');
});

test('snackbar codegen: a child component injection activates the root host', () => {
  const child = `import { Component } from '@angular/core';
import { SnackBar } from '@angular/material/snack-bar';
@Component({ selector: 'app-child', template: '<button (click)="show()">Show</button>' })
export class ChildComponent {
  constructor(private snack: SnackBar) {}
  show() { this.snack.open('From child'); }
}
`;
  const root = `import { Component } from '@angular/core';
import { ChildComponent } from './child.component';
@Component({ selector: 'app-root', template: '<screen><app-child></app-child></screen>' })
export class AppComponent {}
`;
  const { result } = compileProject({ 'app.component.ts': root, 'child.component.ts': child });
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  const code = normalize(result.code);
  assert.ok(code.includes('const __snackBar = new SnackBar();'));
  assert.ok(code.includes('export function Child() { const snack = __snackBar;'), 'the child receives the shared instance');
  assert.ok(code.includes('RgSnackbar'), 'the root renders the host for a child injection');
});

test('snackbar diagnostics: a service injecting SnackBar is an unknown token', () => {
  const service = `import { Injectable } from '@angular/core';
import { SnackBar } from '@angular/material/snack-bar';
@Injectable({ providedIn: 'root' })
export class SoundService {
  constructor(private snack: SnackBar) {}
}
`;
  const root = `import { Component } from '@angular/core';
import { SoundService } from './sound.service';
@Component({ selector: 'app-root', template: '<p>Hello</p>' })
export class AppComponent {
  constructor(private sound: SoundService) {}
}
`;
  const { result } = compileProject({ 'app.component.ts': root, 'sound.service.ts': service });
  const diag = result.diagnostics.find((d) => d.code === 'DI_UNKNOWN_TOKEN');
  assert.ok(diag, JSON.stringify(result.diagnostics));
  assert.ok(diag.message.includes('SnackBar'), 'the token is named');
});

// --- Example: reminder -----------------------------------------------------------

test('reminder example: zero diagnostics, doctor clean, golden and style snapshot match', () => {
  const { dir, entry, result } = compileExample('reminder');
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  const golden = fs.readFileSync(path.join(dir, 'reminder.component.tsx'), 'utf8');
  assert.equal(normalize(result.code), normalize(golden));
  const findings = runDoctor({
    result,
    entryFile: entry,
    styleTexts: doctorStyleTexts(result, entry, (abs) => (
      fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : undefined
    )),
  });
  assert.deepEqual(findings, [], JSON.stringify(findings));
  const snap = buildStyleSnapshot('reminder', result.component!, result.ast!, result.css!, result.children);
  const committed = JSON.parse(fs.readFileSync(path.join(dir, 'styles.snapshot.json'), 'utf8'));
  assert.deepEqual(snap, committed);
  assert.ok(snap.themes.light.roles.sheet, 'the snapshot carries the sheet role');
  assert.ok(snap.themes.light.roles.dialog, 'the snapshot carries the dialog role');
  assert.ok(snap.themes.light.roles.picker, 'the snapshot carries the picker role');
  assert.ok(snap.themes.light.roles.wheel, 'the snapshot carries the wheel role');
});

test('reminder codegen: all four pieces are present in the generated file', () => {
  const { result } = compileExample('reminder');
  const code = normalize(result.code);
  assert.ok(code.includes('<RgDateTimePicker mode="datetime" label="When" value={when} onChange={($event) => onWhen($event)} />'));
  assert.ok(code.includes('<RgSheet open={sheetOpen} onClose={() => closeSheet()}>'));
  assert.ok(code.includes('<RgDialog title="Delete this reminder?" open={confirmOpen} onClose={() => closeConfirm()}>'));
  assert.ok(code.includes("const ref = snack.open('Reminder deleted', 'Undo');"));
  assert.ok(code.includes('ref.onAction(() => {'));
  assert.ok(code.includes("snack.open('Reminder saved');"));
});

// --- Preview: paint and behaviour -------------------------------------------------

function renderReminderPreview(): string {
  const { result } = compileExample('reminder');
  return renderPreview(result.component!, result.ast!, {
    children: result.children,
    services: result.services,
    routes: result.routes,
  });
}

test('the toast look: translucent black, bottom centre, grain in the preview, tokens in both themes', () => {
  const paint = renderReminderPreview().split('<script>')[0];
  const rule = paint.match(/\.snackbar \{[^}]*\}/);
  assert.ok(rule, 'the snackbar paints');
  assert.ok(rule![0].includes('left: 50%'), 'the toast card sits at bottom centre');
  assert.ok(rule![0].includes('translateX(-50%)'), 'the card centers on its own width');
  assert.ok(rule![0].includes('var(--role-toast-surface)'), 'the surface is the toast token');
  assert.ok(rule![0].includes('feTurbulence'), 'the preview draws a real grain texture');
  assert.ok(!rule![0].includes('right:'), 'the old full width bar is gone');

  assert.equal(colours.light.toastSurface, '#000000d9', 'translucent black at 85 percent');
  assert.equal(colours.dark.toastSurface, colours.light.toastSurface, 'the toast stays dark in dark mode');
  assert.equal(colours.dark.toastText, colours.light.toastText, 'the toast text is the same in both themes');
  assert.equal(colours.dark.codeSurface, colours.light.codeSurface, 'the editor surface is dark in both themes');

  const primitives = fs.readFileSync(path.join(ROOT, 'packages', 'ui', 'src', 'primitives.tsx'), 'utf8');
  assert.match(primitives, /snackbarHost: \{/);
  assert.match(primitives, /alignItems: 'center', zIndex: 20/);
  assert.match(primitives, /snackbarSheen/);
  assert.match(primitives, /backgroundColor: c\.toastSurface/);
});

test('reminder preview paint: picker value shows, closed overlays and snackbar stay hidden', () => {
  const paint = renderReminderPreview().split('<script>')[0];
  assert.ok(paint.includes('Nov 13, 2026 9:00 AM'), 'the picker field paints its formatted value');
  assert.ok(paint.includes('When (ISO): 2026-11-13T09:00:00'), 'the ISO line paints');
  assert.ok(!paint.includes('Every day'), 'the closed sheet does not paint its radio options');
  assert.ok(!paint.includes('Delete this reminder?'), 'the closed dialog does not paint');
  assert.ok(!paint.includes('Reminder saved'), 'no snackbar paints before any tap');
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

const buttonsWithText = (app: ShimElement, text: string): ShimElement[] =>
  findAll(app, (e) => e.tagName === 'BUTTON' && e.textContent === text);
const wheelValue = (app: ShimElement, wheel: string, text: string): ShimElement => {
  const container = findAll(app, (e) => e.getAttribute('data-wheel') === wheel)[0];
  assert.ok(container, `wheel ${wheel} is rendered`);
  const item = findAll(container, (e) => e.className.split(' ').includes('wheel-value') && e.textContent === text)[0];
  assert.ok(item, `wheel ${wheel} has a ${text} value`);
  return item;
};

test('reminder preview behaviour: picker Done commits, Cancel discards', () => {
  const { app } = loadPreview(renderReminderPreview());
  assert.ok(app.textContent.includes('When (ISO): 2026-11-13T09:00:00'));
  const box = findAll(app, (e) => e.className === 'picker-box')[0];
  assert.ok(box, 'the picker field is rendered');
  box.click();
  assert.ok(findAll(app, (e) => e.className === 'wheels').length === 1, 'the wheels open in a sheet');
  wheelValue(app, 'hour', '10').click();
  wheelValue(app, 'minute', '30').click();
  buttonsWithText(app, 'Done')[0].click();
  assert.ok(app.textContent.includes('When (ISO): 2026-11-13T10:30:00'), 'Done commits the composed ISO string');
  assert.ok(app.textContent.includes('10:30 AM'), 'the field shows the new time');
  assert.equal(findAll(app, (e) => e.className === 'wheels').length, 0, 'the picker sheet closed');

  findAll(app, (e) => e.className === 'picker-box')[0].click();
  wheelValue(app, 'hour', '11').click();
  buttonsWithText(app, 'Cancel')[0].click();
  assert.ok(app.textContent.includes('When (ISO): 2026-11-13T10:30:00'), 'Cancel keeps the committed value');
  assert.equal(findAll(app, (e) => e.className === 'wheels').length, 0, 'Cancel closes the sheet');
});

test('picker preview behaviour: a 5 minute interval opens on the nearest step', () => {
  const result = compileInline(
    '<screen><datetime-picker label="When" mode="time" minuteInterval="5" [value]="when" (change)="onWhen($event)"></datetime-picker><p>When: {{ when }}</p></screen>',
    `when = '2026-11-13T09:03:00'; onWhen(value: string) { this.when = value; }`,
  );
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  const html = renderPreview(result.component!, result.ast!, {
    children: result.children,
    services: result.services,
  });
  const { app } = loadPreview(html);
  findAll(app, (e) => e.className === 'picker-box')[0].click();
  const selected = findAll(app, (e) => e.className.split(' ').includes('wheel-value') && e.className.split(' ').includes('selected'));
  assert.ok(selected.some((e) => e.textContent === '05'), 'the minute wheel rests on the nearest step');
  buttonsWithText(app, 'Done')[0].click();
  assert.ok(app.textContent.includes('When: 2026-11-13T09:05:00'), 'Done emits the step the wheel showed');
});

test('reminder preview behaviour: sheet radio pick, backdrop close, dialog Delete and snackbar Undo', () => {
  const { app } = loadPreview(renderReminderPreview());

  buttonsWithText(app, 'Repeat options')[0].click();
  assert.ok(app.textContent.includes('Every day'), 'the sheet opens with its radio group');
  const daily = findAll(app, (e) => e.className.split(' ').includes('radio-option') && e.textContent.includes('Every day'))[0];
  assert.ok(daily, 'the Every day radio is rendered');
  daily.click();
  assert.ok(app.textContent.includes('Repeat: daily'), 'the radio pick writes back through (change)');
  const backdrop = findAll(app, (e) => e.className === 'overlay-backdrop')[0];
  assert.ok(backdrop, 'the sheet backdrop is rendered');
  backdrop.click();
  assert.ok(!app.textContent.includes('Every day'), 'the backdrop tap closes the sheet through (close)');

  buttonsWithText(app, 'Save')[0].click();
  assert.ok(app.textContent.includes('Reminder saved'), 'Save shows its snackbar');

  buttonsWithText(app, 'Delete')[0].click();
  assert.ok(app.textContent.includes('Delete this reminder?'), 'the confirm dialog opens');
  const dialog = findAll(app, (e) => e.className === 'dialog')[0];
  assert.ok(dialog, 'the dialog panel is rendered');
  const dialogDelete = findAll(dialog, (e) => e.tagName === 'BUTTON' && e.textContent === 'Delete')[0];
  assert.ok(dialogDelete, 'the dialog Delete action is rendered');
  dialogDelete.click();
  assert.ok(!app.textContent.includes('Delete this reminder?'), 'Delete closes the dialog');
  assert.ok(app.textContent.includes('This reminder was deleted.'), 'the deleted line shows');
  assert.ok(app.textContent.includes('Reminder deleted'), 'the snackbar replaced the saved bar');
  assert.ok(!app.textContent.includes('Reminder saved'), 'the replaced bar is gone');

  const undo = findAll(app, (e) => e.className === 'snackbar-action')[0];
  assert.ok(undo, 'the snackbar action is rendered');
  assert.equal(undo.textContent, 'UNDO');
  undo.click();
  assert.ok(!app.textContent.includes('Reminder deleted'), 'the action dismisses the snackbar');
  assert.ok(!app.textContent.includes('This reminder was deleted.'), 'the onAction callback cleared the deleted flag');
  assert.ok(app.textContent.includes('Delete undone. The reminder is back.'), 'the onAction callback set the restored flag');
});

// --- Preview parity -----------------------------------------------------------------

test('preview date helpers: the page mirrors agree with the TypeScript helpers', () => {
  const { sandbox } = loadPreview(renderReminderPreview());
  const pageDays = sandbox['__daysInMonth'] as (y: number, m: number) => number;
  const pageParse = sandbox['__parseParts'] as (v: string) => unknown;
  const pageCompose = sandbox['__composeIso'] as (p: unknown) => string;
  const pageFormat = sandbox['__formatParts'] as (p: unknown, mode: string) => string;
  const pageWheels = sandbox['__wheelSpecs'] as (p: unknown, mode: string, interval: number) => unknown;
  const pageApply = sandbox['__applyWheel'] as (p: unknown, wheel: string, value: string) => unknown;
  for (const fn of [pageDays, pageParse, pageCompose, pageFormat, pageWheels, pageApply]) {
    assert.equal(typeof fn, 'function', 'the page runtime exposes its date helpers');
  }
  const cases = [
    { year: 2024, month: 2, day: 29, hour: 23, minute: 59 },
    { year: 2025, month: 1, day: 31, hour: 0, minute: 3 },
    { year: 2026, month: 11, day: 13, hour: 12, minute: 30 },
  ];
  for (const p of cases) {
    assert.equal(pageDays(p.year, p.month), daysInMonth(p.year, p.month));
    assert.deepEqual(JSON.parse(JSON.stringify(pageParse(composeDateTimeIso(p)))), parseDateTimeValue(composeDateTimeIso(p)));
    assert.equal(pageCompose(p), composeDateTimeIso(p));
    for (const mode of ['date', 'time', 'datetime'] as const) {
      assert.equal(pageFormat(p, mode), formatDateTimeValue(p, mode), `format parity for ${mode}`);
      assert.deepEqual(JSON.parse(JSON.stringify(pageWheels(p, mode, 5))), dateTimeWheels(p, mode, 5), `wheel parity for ${mode}`);
    }
    assert.deepEqual(JSON.parse(JSON.stringify(pageApply(p, 'month', '2'))), applyWheelValue(p, 'month', '2'));
    assert.deepEqual(JSON.parse(JSON.stringify(pageApply(p, 'ampm', 'PM'))), applyWheelValue(p, 'ampm', 'PM'));
  }
  assert.equal(pageParse('2026-02-30T09:00:00'), null, 'the page parser rejects February 30 too');
});

// --- Parity guard ----------------------------------------------------------------------

test('Stage 10 generated golden: only known components, no web-only APIs', () => {
  const { result } = compileExample('reminder');
  const known = new Set(Object.values(TAG_MAP).map((t) => t.component));
  known.add('Text');
  known.add('View');
  known.add('RgSnackbar');
  for (const m of result.code.matchAll(/export (?:default )?function (\w+)\(/g)) known.add(m[1]);
  for (const m of result.code.matchAll(/(?:^|[\s(])<([A-Z][A-Za-z0-9]*)(?=[\s/>])/gm)) {
    assert.ok(known.has(m[1]), `unknown component ${m[1]}`);
  }
  assert.ok(!/\b(document|window|localStorage)\b/.test(result.code), 'no web-only APIs in generated code');
});
