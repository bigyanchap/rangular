# Recipe: Sign up form, template-driven forms with validation

**Intent**: A create account form written the Angular template-driven way: `[(ngModel)]` two-way binding, validators as attributes, `#name="ngModel"` template references driving the error lines and the submit button, and a `(submit)` handler on the form.

**Source**

`signup-form.component.ts`:

```ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-signup-form',
  templateUrl: './signup-form.component.html',
})
export class SignupFormComponent {
  name = '';
  email = '';
  password = '';
  terms = false;
  submitted = false;

  onTerms(value: boolean) {
    this.terms = value;
  }

  save() {
    this.submitted = true;
  }
}
```

`signup-form.component.html`:

```html
<screen>
  <appbar title="Create account"></appbar>
  <card>
    <form (submit)="save()">
      <input label="Full name" placeholder="e.g. Bigyan Chapagain" [(ngModel)]="name" #name="ngModel" required minlength="3">
      <p *ngIf="name.invalid && name.touched">Name is required and needs at least 3 characters.</p>
      <input label="Email" placeholder="you@example.com" type="email" [(ngModel)]="email" #email="ngModel" required email>
      <p *ngIf="email.invalid && email.touched">Enter a valid email address.</p>
      <input label="Password" placeholder="At least 6 characters" type="password" [(ngModel)]="password" #password="ngModel" required minlength="6">
      <p *ngIf="password.invalid && password.touched">Password is required and needs at least 6 characters.</p>
      <checkbox [checked]="terms" (change)="onTerms($event)">I accept the terms</checkbox>
      <button type="submit" [disabled]="name.invalid || email.invalid || password.invalid || !terms">Create account</button>
    </form>
    <p *ngIf="submitted">Welcome aboard. Your account was created.</p>
  </card>
</screen>
```

**What it compiles to**

Key lines of the generated `signup-form.component.tsx`:

```tsx
const [name, setName] = useState('');
const [nameTouched, setNameTouched] = useState(false);
const nameErrors = validateValue(name, [Validators.required, Validators.minLength(3)]);
const nameModel = { value: name, errors: nameErrors, valid: nameErrors === null, invalid: nameErrors !== null, touched: nameTouched };

<RgInput label="Full name" placeholder="e.g. Bigyan Chapagain" value={name} onChangeText={($event) => setName($event)} onBlur={() => setNameTouched(true)} />
{(nameModel.invalid && nameModel.touched) && (
  <RgText variant="bodyLarge">Name is required and needs at least 3 characters.</RgText>
)}
<RgButton disabled={(((nameModel.invalid || emailModel.invalid) || passwordModel.invalid) || !terms)} onPress={() => { setNameTouched(true); setEmailTouched(true); setPasswordTouched(true); save(); }}>Create account</RgButton>
```

`[(ngModel)]` compiles to `value` plus a write-back `onChangeText` into the field's state setter; the field becomes state because the binding writes it. Each input with validators or a ref gets a small validation model next to it: a `touched` state (set by the input's `onBlur`), and an `errors` object recomputed from the current value on every render by the runtime `Validators`, in Angular's error shapes (`{ required: true }`, `{ minlength: { requiredLength, actualLength } }`). Template expressions rooted at a ref name read the model: `name.invalid` in the source is `nameModel.invalid` in the output, while a bare `name` still means the field itself. The submit button's `onPress` is the form's `(submit)` handler, prefixed with marking every ngModel input touched, so pressing save with untouched fields shows their errors, the standard Angular UX. The checkbox keeps the Stage 6 control contract (`[checked]` in, `(change)` out); ngModel targets `<input>` only in this version, and a checkbox is not a text input.

**Rules used**

- **Two-way binding is input only.** `[(ngModel)]` works on `<input>`. On any other element it is a `GEN_NGMODEL_TARGET` error. The explicit pair form works too: `[ngModel]="email"` plus `(ngModelChange)="onEmail($event)"`.
- **`<input>` is a void element.** Like HTML's input, it takes no closing tag: the Source above writes `<input ...>` with no `</input>`, and a stray closing tag is a `TPL_MISMATCH` error whose fix line says input takes no closing tag.
- **Validators are attributes.** `required`, `minlength="3"`, `maxlength`, `email` and `pattern="..."` on the input. `type="email"` only chooses the keyboard; it does not validate, exactly as in Angular. Write the separate `email` attribute when you want the email validator.
- **`type` picks the field form.** `type="password"` compiles to the `secure` prop, `type="email"` to `keyboardType="email-address"`, `type="number"` to `keyboardType="numeric"`.
- **Refs are template only.** `#email="ngModel"` exposes `email.valid`, `email.invalid`, `email.touched`, `email.errors` and `email.value` to template expressions (interpolation, `*ngIf`, `[disabled]`). Method bodies do not see refs; read the fields there.
- **Touched means blurred, or a submit attempt.** An error line written as `*ngIf="email.invalid && email.touched"` stays hidden until the user leaves the field, then tracks validity live as they type.
- **No form-level tracking.** There is no NgForm object in this version: no `form.valid` over the whole template-driven form, no `(ngSubmit)` event object. Gate the submit button with the refs, as this card does. `ngModelOptions` is accepted and ignored; there is no standalone requirement because there is no form registry to opt out of.
- **The terms checkbox is not ngModel.** Selection controls already have a checked-plus-change contract from Stage 6, so the card uses it and the recipe says so instead of pretending ngModel covers every control.

**Common mistakes**

- **Expecting `type="email"` to validate.** It does not, in Angular or here. Add the `email` attribute for the validator.
- **Putting ngModel on a switch or checkbox.** That is a `GEN_NGMODEL_TARGET` error. Use `[checked]` with `(change)` for controls.
- **Reading a ref inside a method.** `this.email.invalid` in a method body reads the field, not the ref; refs live in template expressions only. Validate in the template, or call the runtime `Validators` from the method.
- **Binding ngModel to a path.** `[(ngModel)]="user.name"` cannot write back in this version; it warns `GEN_NGMODEL_EXPR` and binds the value one way. Bind to a plain field.
- **Forgetting the submit button type.** A plain `<button>` inside a form is just a button. Only `<button type="submit">` triggers the form's `(submit)` handler; a button with its own `(click)` keeps that click instead.
