# Recipe: Builder form, form trees with FormBuilder

**Intent**: The same reactive form, built with Angular's `FormBuilder` shorthand instead of `new FormGroup` and `new FormControl`: tuples for controls with validators, a plain value for a control without any, and a nested `fb.array` for a dynamic list, all from one injected builder.

**Source**

`builder-form.component.ts`:

```ts
import { Component } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';

@Component({
  selector: 'app-builder-form',
  templateUrl: './builder-form.component.html',
})
export class BuilderFormComponent {
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

  save() {
    this.summary = JSON.stringify(this.signupForm.value);
  }
}
```

`builder-form.component.html`:

```html
<screen>
  <appbar title="Sign up"></appbar>
  <card>
    <form [formGroup]="signupForm" (submit)="save()">
      <input label="Name" placeholder="Your name" formControlName="name">
      <p *ngIf="signupForm.get('name').invalid && signupForm.get('name').touched">Name is required.</p>
      <input label="Email" placeholder="you@example.com" formControlName="email">
      <p *ngIf="signupForm.get('email').invalid && signupForm.get('email').touched">Enter a valid email address.</p>
      <input label="City" placeholder="Your city" formControlName="city">
      <div formArrayName="aliases">
        <div *ngFor="let a of signupForm.get('aliases').controls; let i = index">
          <input label="Alias" placeholder="Another name" [formControlName]="i">
        </div>
      </div>
      <button type="submit" [disabled]="signupForm.invalid">Create account</button>
    </form>
    <p *ngIf="summary">Saved: {{ summary }}</p>
  </card>
</screen>
```

**What it compiles to**

Key lines of the generated `builder-form.component.tsx`:

```tsx
const __container = new Container();
__container.register(FormBuilder, new FormBuilder());

const fb = __container.get<FormBuilder>(FormBuilder);
const signupFormRef = useRef(fb.group({
  name: ['', Validators.required],
  email: ['', [Validators.required, Validators.email]],
  city: 'Salem',
  aliases: fb.array([
    ['', Validators.required],
  ]),
}));
```

`FormBuilder` is a built-in injection, like `HttpClient`: the generated module registers one instance in the container, the component reads it into a local named after the constructor property, and the field initializer is rewritten from `this.fb.group(...)` to `fb.group(...)` so it runs against that local, nested builder calls included. What the builder returns is the same runtime `FormGroup` the class form builds, held in the same kind of ref, so everything downstream (the `[formGroup]` binding, `formControlName`, the `formArrayName` rows, submit, the preview) is identical to the class-built form. The builder is also the convenient way to mint a control inside a method: `this.fb.control('', Validators.required)` compiles like any other method call, ready to push into a `FormArray`.

**Rules used**

- **Inject it in the constructor.** `constructor(private fb: FormBuilder)` is the one supported way to get a builder; the property may be named anything (`private builder: FormBuilder` works the same, and the initializer then reads `this.builder.group(...)`). Declaring the field before the constructor is fine: constructor parameter properties are assigned before field initializers run.
- **Config entries coerce the Angular way.** An entry that is a `FormControl`, `FormGroup` or `FormArray` instance is used as-is; a tuple `[initialValue, validators]` becomes a control with those validators (the validators element is one validator or an array of them); any other value becomes a control holding it. A tuple's third element would be async validators in Angular; there are no async validators in this version, so it is ignored.
- **Builder calls nest.** `fb.group` inside a group config builds a nested group, `fb.array` a nested array, and plain `new FormGroup(...)` or `new FormArray(...)` entries mix freely with builder entries in the same config.
- **The preview subset covers builder shapes.** The preview evaluator builds groups, controls and arrays from builder calls with literal and tuple entries, exactly like the `new` shapes. A richer initializer (a value read from another field, a computed validator) warns `GEN_FORM_INITIALIZER`: the app still runs it, only the preview cannot build the instance.
- **The result is the runtime tree.** `fb.group` returns a real `FormGroup`, `fb.array` a real `FormArray`, `fb.control` a real `FormControl`; `.get()`, `.value`, `.valid`, `valueChanges` and the rest behave exactly as in the class-built form.

**Common mistakes**

- **Skipping the injection.** `new FormBuilder().group(...)` in a field initializer is not the pattern here; inject the built-in so the generated code and the preview agree on the instance.
- **Reading the builder before it exists.** The form field must call the injected property (`this.fb.group(...)`); a builder stored in a plain field assigned later in `ngOnInit` is too late, the form field is built first.
- **Putting validators beside the tuple.** `name: '', Validators.required` is not a config entry; the validators belong inside the tuple: `name: ['', Validators.required]`.
- **Expecting two ways to differ.** The builder is shorthand, not a second forms system; if a shape matters, both spellings build the same tree and the same generated wiring.
