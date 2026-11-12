# Recipe: Profile form, reactive forms with FormGroup

**Intent**: A profile form written the Angular reactive way: a `FormGroup` of `FormControl`s built in the class, bound with `[formGroup]` and `formControlName`, errors read through `profileForm.get('email')`, and a submit handler that reads the group's value.

**Source**

`profile-form.component.ts`:

```ts
import { Component } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';

@Component({
  selector: 'app-profile-form',
  templateUrl: './profile-form.component.html',
})
export class ProfileFormComponent {
  profileForm = new FormGroup({
    name: new FormControl('', Validators.required),
    email: new FormControl('', [Validators.required, Validators.email]),
  });
  summary = '';

  save() {
    this.summary = JSON.stringify(this.profileForm.value);
  }
}
```

`profile-form.component.html`:

```html
<screen>
  <appbar title="Profile"></appbar>
  <card>
    <form [formGroup]="profileForm" (submit)="save()">
      <input label="Name" placeholder="Your name" formControlName="name">
      <p *ngIf="profileForm.get('name').invalid && profileForm.get('name').touched">Name is required.</p>
      <input label="Email" placeholder="you@example.com" formControlName="email">
      <p *ngIf="profileForm.get('email').invalid && profileForm.get('email').touched">Enter a valid email address.</p>
      <button type="submit" [disabled]="profileForm.invalid">Save profile</button>
    </form>
    <p *ngIf="summary">Saved: {{ summary }}</p>
  </card>
</screen>
```

**What it compiles to**

Key lines of the generated `profile-form.component.tsx`:

```tsx
const profileFormRef = useRef(new FormGroup({
  name: new FormControl('', Validators.required),
  email: new FormControl('', [Validators.required, Validators.email]),
}));
const [, setFormVersion] = useState(0);
useEffect(() => {
  const subs = [
    ...Object.values(profileFormRef.current.controls).map((control) => control.valueChanges.subscribe(() => setFormVersion((v) => v + 1))),
  ];
  return () => { subs.forEach((sub) => sub.unsubscribe()); };
}, []);
const save = () => {
  setSummary(JSON.stringify(profileFormRef.current.value));
};

<RgInput label="Email" placeholder="you@example.com" value={profileFormRef.current.get('email').value} onChangeText={($event) => profileFormRef.current.get('email').setValue($event)} onBlur={() => { profileFormRef.current.get('email').markAsTouched(); setFormVersion((v) => v + 1); }} />
<RgButton disabled={profileFormRef.current.invalid} onPress={() => { profileFormRef.current.markAllAsTouched(); setFormVersion((v) => v + 1); save(); }}>Save profile</RgButton>
```

The `FormGroup` field is a stable instance, not state: the generated component holds it in a `useRef` with the initializer verbatim, and the `FormGroup`, `FormControl` and `Validators` names resolve to the `@rangular/runtime` classes. Every read of the field, in template expressions and in method bodies alike, goes through the ref (`profileForm` becomes `profileFormRef.current`). Re-rendering is driven by the controls themselves: the generated effect subscribes to each control's `valueChanges` and bumps a version counter, and an input's blur bumps it directly after `markAsTouched()`. A `formControlName` input reads its value from the control and writes back with `setValue`, so validity, touched and dirty always live on the control, exactly as in Angular. The submit handler reads `this.profileForm.value` in the source, a plain member read on the instance, and `JSON.stringify` turns the value object into the summary line.

**Rules used**

- **The group is built in the class.** Controls, initial values and validators are class code (`new FormGroup({ ... })`), imported from `@angular/forms` in the source. The compiler re-homes those names to the runtime classes; the source never changes.
- **`formControlName` is a static attribute.** It names a control of the enclosing form's group. An unknown name is a `GEN_FORM_CONTROL` error listing the group's controls, and an input with `formControlName` outside a `[formGroup]` form is the same error. Writing it as `[formControlName]` warns with the fix.
- **Validators live on the control, not the template.** In reactive forms the template declares no validator attributes; `formControlName` inputs take their validity from the `FormControl` construction. Attribute validators belong to template-driven ngModel inputs.
- **Error access needs no refs.** `profileForm.get('email').invalid`, `.touched` and `.errors` evaluate in template expressions, in the generated code and in the preview, because the instance is real in all three.
- **The preview builds the same group.** The preview evaluates the field initializer with a small hand-written evaluator covering exactly: literal initial values, `Validators.x` references, `Validators.minLength(n)` style calls, a validator array, and a `FormGroup` object of `FormControl`s. Anything richer warns `GEN_FORM_INITIALIZER`: the generated app still runs the initializer as written, only the preview cannot build the instance.
- **Submit marks all touched.** Pressing the submit button first calls `markAllAsTouched()` on the group, so untouched invalid fields show their error lines on save, then runs the handler.
- **One instance per component instance.** The group is created once and held in a ref; do not reassign the field in a method. Mutate controls instead (`this.profileForm.get('email').setValue(...)`).

**Common mistakes**

- **Making the group state.** Do not expect `profileForm = new FormGroup(...)` inside a method to work; assignment to the field is outside the translation subset. Build the group in the field initializer and change control values afterwards.
- **Adding validator attributes to a reactive input.** `required` on a `formControlName` input does nothing; put `Validators.required` on the `FormControl` in the class.
- **Mismatching a control name.** `formControlName="emial"` is a compile error naming the group's real controls, not a silent unbound input.
- **Reading form state through a template ref.** Reactive forms need no `#ref="ngModel"`; `profileForm.get('email')` is the access path.
- **Expecting group-level validators.** This version has control validators only; the group's own `errors` is null and its validity is all-controls-valid, as in Angular without group validators.
