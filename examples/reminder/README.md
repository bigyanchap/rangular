# Recipe: Reminder, iOS wheel picker, sheet, dialog and snackbar

**Intent**: A small reminder form that proves the four Stage 10 overlay pieces together: an iOS style wheel date-time picker, a declarative bottom sheet holding repeat options, a declarative confirm dialog, and a SnackBar service with an Undo action.

**Source**

`reminder.component.ts`:

```ts
import { Component } from '@angular/core';
import { SnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-reminder',
  templateUrl: './reminder.component.html',
})
export class ReminderComponent {
  title = '';
  when = '2026-11-13T09:00:00';
  repeat = 'none';
  sheetOpen = false;
  confirmOpen = false;
  deleted = false;
  restored = false;

  constructor(private snack: SnackBar) {}

  onWhen(value: string) {
    this.when = value;
  }

  onRepeat(value: string) {
    this.repeat = value;
  }

  openSheet() {
    this.sheetOpen = true;
  }

  closeSheet() {
    this.sheetOpen = false;
  }

  openConfirm() {
    this.confirmOpen = true;
  }

  closeConfirm() {
    this.confirmOpen = false;
  }

  save() {
    this.snack.open('Reminder saved');
  }

  deleteReminder() {
    this.confirmOpen = false;
    this.deleted = true;
    this.restored = false;
    const ref = this.snack.open('Reminder deleted', 'Undo');
    ref.onAction(() => {
      this.deleted = false;
      this.restored = true;
    });
  }
}
```

`reminder.component.html`:

```html
<screen>
  <appbar title="Reminder"></appbar>

  <form (submit)="save()">
    <input label="Title" placeholder="What should I remember?" [(ngModel)]="title">
    <datetime-picker label="When" mode="datetime" [value]="when" (change)="onWhen($event)"></datetime-picker>
    <p>When (ISO): {{ when }}</p>
    <p>Repeat: {{ repeat }}</p>
    <button type="submit">Save</button>
  </form>

  <button (click)="openSheet()">Repeat options</button>
  <button (click)="openConfirm()">Delete</button>
  <p *ngIf="deleted">This reminder was deleted.</p>
  <p *ngIf="restored">Delete undone. The reminder is back.</p>

  <sheet [open]="sheetOpen" (close)="closeSheet()">
    <label>Repeat</label>
    <radio-group [value]="repeat" (change)="onRepeat($event)">
      <radio value="none">Never</radio>
      <radio value="daily">Every day</radio>
      <radio value="weekly">Every week</radio>
    </radio-group>
    <button (click)="closeSheet()">Done</button>
  </sheet>

  <dialog [open]="confirmOpen" (close)="closeConfirm()" title="Delete this reminder?">
    <p>This cannot be kept in the list after deletion. You can undo it from the message that follows.</p>
    <actions>
      <button (click)="closeConfirm()">Cancel</button>
      <button (click)="deleteReminder()">Delete</button>
    </actions>
  </dialog>
</screen>
```

The starting value is 9:00 on 13 November 2026, the day after this example was written. It is a literal ISO string on purpose, so the first paint and the first preview are deterministic.

**What it compiles to**

Key lines of the generated `reminder.component.tsx`:

```tsx
const __snackBar = new SnackBar();

export default function Reminder() {
  const snack = __snackBar;
  const [__snack, __setSnack] = useState(__snackBar.current);
  useEffect(() => __snackBar.subscribe(() => __setSnack(__snackBar.current)), []);

  const deleteReminder = () => {
    setConfirmOpen(false);
    setDeleted(true);
    setRestored(false);
    const ref = snack.open('Reminder deleted', 'Undo');
    ref.onAction(() => {
      setDeleted(false);
      setRestored(true);
    });
  };

  return (
    <>
      <RgScreen>
        <RgDateTimePicker mode="datetime" label="When" value={when} onChange={($event) => onWhen($event)} />
        <RgSheet open={sheetOpen} onClose={() => closeSheet()}>
          <RgRadioGroup value={repeat} onChange={($event) => onRepeat($event)}>
            <RgRadio value="daily">Every day</RgRadio>
          </RgRadioGroup>
        </RgSheet>
        <RgDialog title="Delete this reminder?" open={confirmOpen} onClose={() => closeConfirm()}>
          <RgActions>
            <RgButton onPress={() => closeConfirm()} style={styles.dialogBtn}>Cancel</RgButton>
            <RgButton onPress={() => deleteReminder()} style={styles.dialogBtn}>Delete</RgButton>
          </RgActions>
        </RgDialog>
      </RgScreen>
      {__snack && (<RgSnackbar message={__snack.message} actionLabel={__snack.actionLabel} onAction={() => __snackBar.pressAction()} />)}
    </>
  );
}
```

The entry component mirrors the module level SnackBar in state and renders the `RgSnackbar` host only while a bar is open. The service owns the current bar, its timer and its action callbacks.

**Rules used**

- **Product rule: the picker is the iOS wheel picker on every platform.** The field opens a bottom sheet with wheels, never a calendar grid and never an Android style date or time dialog. Date mode has month, day and year wheels. Time mode has hour 1 to 12, minute and AM/PM wheels. Datetime mode has one combined date wheel, then hour, minute and AM/PM wheels. Done and Cancel are accent coloured text buttons in the sheet header. Done commits through `(change)` as an ISO string; Cancel discards the pending value.
- **Picker ranges and steps.** The date mode year wheel runs from the value year minus 25 to the value year plus 25. The datetime date wheel lists 183 days before and after the value, the finite window this version uses in place of the endless iOS list. `minuteInterval` is 1 or 5; another value warns `GEN_PICKER_INTERVAL` and the generated code uses the nearest of the two. An unknown `mode` is a `GEN_PICKER_MODE` error whose fix lists the three modes.
- **Material correspondence, adapted honestly.** `<datetime-picker>` adapts the Angular Material datepicker surface to a phone: Material uses an input, a toggle and a calendar popup, and a phone has no calendar popup culture, so Rangular makes the picker one dedicated block. `<sheet>` adapts MatBottomSheet and `<dialog>` adapts MatDialog. Both Material APIs open components from services; Rangular v1 is declarative instead, because templates here are declarative: `[open]` drives visibility and `(close)` reports a backdrop tap. `SnackBar` keeps the Material service shape: inject it, call `open(message, actionLabel, durationMs)`, with 4000 ms as the default duration.
- **Children inside primitive overlays render like card children.** A sheet or dialog renders its template children inside the panel. Put dialog buttons in an `<actions>` row to get the right aligned Material action layout. Buttons carry no horizontal margins of their own (the screen grid and container padding own every inset), so action buttons sit directly in the row's gap rhythm with no zeroing class needed; earlier versions of this example carried a `dialog-btn` class for that, now removed.
- **Event bindings never hold assignments.** `(close)="sheetOpen = false"` is not supported anywhere in Rangular. The template expression grammar has no assignment operator, and codegen now says so with a `GEN_EVENT_ASSIGNMENT` warning and drops the binding instead of emitting an assignment against a const state value. Write `closeSheet()` and assign inside the method, as this example does. The same rule applies to `(close)` on the dialog and to every other event binding.
- **SnackBar action callbacks use the statement form.** `const ref = this.snack.open('Reminder deleted', 'Undo');` followed by `ref.onAction(() => { ... });` is supported, because the method translator carries a const call result and a block body arrow statement by statement. Pressing the action dismisses the bar first, then runs the callbacks. The chained one line form, `this.snack.open(...).onAction(() => this.restore())`, is not the documented form in this version.
- **A sheet or dialog without `[open]` only renders statically.** It cannot be opened or closed from the component, so the compiler warns `GEN_OVERLAY_OPEN`. Bind it, as here.
- **Preview simplification, stated plainly.** In the preview the wheels are clickable lists: clicking a value selects it, with the same selected value outcome as resting a wheel on it. The generated app uses a snapping scroll wheel. Preview timers are real timers, so behaviour tests dismiss the snackbar through its action instead of waiting.

**Common mistakes**

- **Asking for a calendar or an Android style picker.** There is none, by product rule. Every platform gets the iOS style wheels in a bottom sheet.
- **Writing `(close)="confirmOpen = false"`.** Use a method: `(close)="closeConfirm()"` with `closeConfirm() { this.confirmOpen = false; }`.
- **Expecting Cancel on the picker to emit.** Cancel discards the pending wheels value. Only Done emits `(change)`, once, with the composed ISO string.
- **Chaining `onAction` onto `open(...)`.** Keep the ref in a const first, then subscribe, exactly as `deleteReminder` does.
- **Opening a second snackbar and expecting the first one's Undo to survive.** Opening a bar replaces the current bar, as in Material; the replaced bar's action callbacks do not fire.
- **Putting loose text directly inside `<sheet>` or `<dialog>`.** Doctor treats both as containers. Wrap words in `<p>` or `<label>`, as this example does.
