# Recipe: Team form, dynamic rows with FormArray

**Intent**: A reactive form with a list of rows the user can grow and shrink: a `FormArray` of member name controls inside a `FormGroup`, one input per row, an Add member button that pushes a new control, and a Remove button per row.

**Source**

`team-form.component.ts`:

```ts
import { Component } from '@angular/core';
import { FormArray, FormControl, FormGroup, Validators } from '@angular/forms';

@Component({
  selector: 'app-team-form',
  templateUrl: './team-form.component.html',
})
export class TeamFormComponent {
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

  save() {
    this.summary = JSON.stringify(this.teamForm.value);
  }
}
```

`team-form.component.html`:

```html
<screen>
  <appbar title="Team"></appbar>
  <card>
    <form [formGroup]="teamForm" (submit)="save()">
      <input label="Team name" placeholder="Red Tigers" formControlName="team">
      <p *ngIf="teamForm.get('team').invalid && teamForm.get('team').touched">Team name is required.</p>
      <div formArrayName="members">
        <div *ngFor="let m of teamForm.get('members').controls; let i = index">
          <input label="Member" placeholder="Member name" [formControlName]="i">
          <p *ngIf="teamForm.get('members').at(i).invalid && teamForm.get('members').at(i).touched">Member name is required.</p>
          <button (click)="removeMember(i)">Remove</button>
        </div>
      </div>
      <button (click)="addMember()">Add member</button>
      <button type="submit" [disabled]="teamForm.invalid">Save team</button>
    </form>
    <p *ngIf="summary">Saved: {{ summary }}</p>
  </card>
</screen>
```

**What it compiles to**

Key lines of the generated `team-form.component.tsx`:

```tsx
(teamFormRef.current.get('members')).push(new FormControl('', Validators.required));
(teamFormRef.current.get('members')).removeAt(i);
{teamFormRef.current.get('members').controls.map((m, i) => (
  <RgInput label="Member" placeholder="Member name" value={teamFormRef.current.get('members').at(i).value} onChangeText={($event) => teamFormRef.current.get('members').at(i).setValue($event)} onBlur={() => { teamFormRef.current.get('members').at(i).markAsTouched?.(); setFormVersion((v) => v + 1); }} />
))}
```

The array is a child of the group like any other control: the group holds it in its `controls` record, the group's `value` reads the array's value (an array of the row values), and the group's validity is every child valid, rows included. The generated effect subscribes once to each top-level child's `valueChanges`; the array's own `valueChanges` aggregates its rows and also fires on `push`, `insert`, `removeAt` and `clear`, so adding or removing a row re-renders the form without any extra wiring. A row input resolves its control at render time through `.at(i)`, so rows never go stale when the list changes above them. Rows are born in methods: `new FormControl(...)` inside a method body compiles, because the forms classes are real runtime classes in the generated app too.

**Rules used**

- **`formArrayName` scopes the rows.** It is a static attribute on a container inside the `[formGroup]` form, naming a control of the group that must be a `FormArray`. A name that is not a control of the group, or a control that is not an array, is a `GEN_FORM_ARRAY` error, as is `formArrayName` outside a `[formGroup]` form.
- **Row inputs bind the index.** Inside a `formArrayName` container, `[formControlName]="i"` is the one place the binding form is allowed: it binds the row at that index, usually the `*ngFor` loop variable. A static number (`formControlName="0"`) also works for a fixed row. A static name inside the container is a `GEN_FORM_ARRAY` error, because rows are numbered, not named.
- **Reach the array with `.get()`.** `teamForm.get('members')` returns the array; cast it in methods (`as FormArray`) to call `push`, `insert`, `removeAt`, `clear`, `at` and `length`. Class getters are not part of the subset, so do not hide the array behind a `get members()` accessor.
- **The loop source is the controls list.** `*ngFor` over `teamForm.get('members').controls` with `let i = index` is the row pattern; the loop variable itself is only a placeholder, the input binds by index.
- **Array state aggregates like group state.** `value` is the array of row values, `valid` is every row valid, `touched` and `dirty` are any row touched or dirty, and the group's `markAllAsTouched()` on submit reaches every row. There are no array-level validators in this version, so the array's own `errors` is null.
- **The preview builds the same tree.** The preview evaluator covers `new FormArray([...])` inside a group, nested groups, and the row wiring, so the preview adds and removes rows exactly like the app.

**Common mistakes**

- **Binding a row by name.** `formControlName="member"` inside a `formArrayName` container cannot work; rows have indexes, not names. Bind `[formControlName]="i"`.
- **Hiding the array behind a getter.** `get members() { return ... }` is silently not a field or a method to the compiler; the template and methods would read a name that is never generated. Use `.get('members')` at each use site.
- **Mutating a plain list instead.** Keeping a separate `members: string[]` next to the form splits the truth; the array is the list, and the inputs, the validity and the saved value all read it.
- **Rebuilding the array on every change.** Do not assign a new `FormArray` in a method; push and remove controls on the instance the group already holds.
