# Rangular framework: AI Guide

The standing directive for this guide, set on 2026-11-12: the whole system must be buildable from its own documentation, by a person or an AI, without guessing.

## What this guide is for

This guide exists so that an AI coding assistant (or a human working
through one) can build correct things with the framework **without
guessing**:
every API is discoverable, there is one obvious way to do each thing, examples
are tiny and copyable, errors teach the fix, and the feedback loop is fast
enough that the AI can iterate on its own mistakes.

Building from documentation fails for predictable reasons: the AI invents props that don't
exist, picks between three ways to do one thing, can't tell whether its code
worked, or reads documentation written as prose for humans when it needed a
lookup table. This layer removes each failure mode.

## The pieces (Stage 2.5)

1. **`AGENTS.md`** at repo root: what Rangular is, repo map, build/test
   commands, and the golden rules (edit source, never generated output;
   run `npm test` before done).
2. **`llms.txt`** at repo root: one AI-readable page linking and summarising
   every doc, example and package, the front door for any AI.
3. **Recipe cards:** a `README.md` beside every example with a fixed shape,
   *Intent* · *Source* · *What it compiles to* · *Rules used* ·
   *Common mistakes*.
4. **Generated catalog (`rg catalog`):** emits `catalog.json` +
   `catalog.md` **from the actual code**, the tag mapping from codegen's
   exported `TAG_MAP`, primitive props parsed from
   `packages/ui/src/primitives.tsx` with the TypeScript compiler API
   (the primitives are shipped source typed `any`, so their destructured
   parameter patterns are the reliable source of prop names), token scales
   imported from `@rangular-framework/ui` tokens, and the `DIAGNOSTIC_CODES` list.
   A test regenerates the catalog and fails if the committed files are stale.
5. **JSON diagnostics:** `rg build --json` (and `preview --json`)
   prints a single JSON object, `{ ok, file, outFile?, diagnostics:
   [{ severity, code, message, line, column, file?, fix }] }`, to stdout and
   nothing else, so an AI loop can read an error and fix its own source.
   The per-diagnostic `file` (Stage 5) names the file the diagnostic
   belongs to: the template `.html`, the class `.ts`, or the styles file.
6. **Error messages that teach:** every diagnostic carries a `fix:` line
   with the concrete corrected pattern, in human output and in JSON.

## The delta: what an AI must know

AIs already know Angular and React from training. Rangular source *looks*
like Angular, so the main job of these docs is enumerating the **delta**:
where Rangular is the same, and where it is not (yet). Both tables state
the repo's actual behaviour today (through Stage 12), not aspirations.

### Rangular source vs Angular

**The same**: write it exactly as you would in Angular:

| Angular feature | In Rangular source |
|---|---|
| `@Component` decorator (selector, templateUrl, inline template, styles, styleUrls) | Same; read by the TypeScript compiler API |
| Standalone components (the modern Angular default; no NgModules) | The only form: every component is standalone by construction, importing the children, pipes and services it uses in its own file; there is no module to declare it in. See the NgModules row in the next table |
| `@Input()` / `@Output()` field decorators | Wired (Stage 3): `@Input` fields become props, the literal initializer is the default when unbound; an `@Output` field holding `new EventEmitter<T>()` becomes an `onX` callback prop and `this.x.emit(v)` compiles to `onX?.(v)` |
| Child components (a tag matching another component's selector) | Same, with import-based resolution: the compiler follows the entry file's relative imports and any imported `@Component` class is a usable child, no module/declarations list |
| Templates in separate `.html` files | Same |
| `{{ interpolation }}`, `[prop]` binding, `(event)` binding, `*ngIf`, `*ngFor` syntax | Same syntax, same meaning |
| Pipes in expressions (`expr \| uppercase`) | Wired (Stage 12): the full built-in set (`uppercase`, `lowercase`, `titlecase`, `json`, `date`, `number`, `percent`, `currency`, `slice`, `keyvalue`, `async`) evaluates identically in generated code, the preview and the compiler's evaluator; project pipes come from `@Pipe` classes (next rows). See the Pipes section below |
| Custom pipes (`@Pipe({ name })` classes with a `transform` method) | Wired (Stage 12): the component imports the pipe class like a child or a service; the compiler compiles `transform` (the `this.` of the pipe survives, pipes are plain classes) and registers the name. An unregistered name is a `PIPE_UNKNOWN` error listing every known pipe. See the Pipes section below |
| Attribute directives (`@Directive({ selector: '[name]' })`) | Wired subset (Stage 12): `@Input()` fields, an injected `ElementRef`, and style assignments of the shape `this.el.nativeElement.style.<prop> = <expr>` inside `ngOnInit` or a setter for one input. The compiler folds them into the host element's style. Anything else in the body warns `DIR_UNSUPPORTED`. See the Attribute directives section below |
| Content projection (`<ng-content></ng-content>` in a child template) | Wired (Stage 12) for the single default slot: children written inside a child component's tag render where the child places `<ng-content>`. A `select` attribute warns `PROJECTION_SELECT_UNSUPPORTED` and behaves as the default slot. See the Content projection section below |
| Class fields as state, methods as actions | Same. This is the core model |
| `@Injectable({ providedIn: 'root' })` services + constructor injection | Wired (Stage 3): services are reactive singletons in a generated container; constructor *parameter properties* (`constructor(private mail: MailService)`) are the injection form; services may inject services |
| Third-party module imports (npm packages, in a component, child, root service or `@Pipe` file) | Wired: the import is carried into the generated module, specifier and bindings as written (default, named with aliases, namespace, type-only, side-effect), merged across the contributing files and carried once, so generated code may use the imported names freely. A binding whose local name the generated module already defines is dropped with a `GEN_IMPORT_COLLISION` warning. See the Third-party imports section below |
| Lifecycle hooks (`ngOnInit`, `ngOnDestroy`) | Wired (Stage 3): `ngOnInit` runs once after first render, `ngOnDestroy` on unmount, `useEffect(..., [])` and its cleanup in generated code |
| `HttpClient.get(url)` returning an Observable you `subscribe` to | Wired with a subset (Stage 3): an Observable-lite with `subscribe(next?, error?)` only; the supported component shape is `this.http.get(url).subscribe((data) => { this.field = data; });` |
| Angular Material selection controls | Wired (Stage 6): `switch` mirrors `mat-slide-toggle`, `checkbox` mirrors `mat-checkbox`, `switcher` with `option` mirrors `mat-button-toggle-group`, and `radio-group` with `radio` mirrors `mat-radio-group`; all use `[checked]` or `[value]` in and `(change)` out with the next value as `$event` |
| Template-driven forms (`[(ngModel)]`, validators as attributes, `#name="ngModel"` refs) | Wired (Stage 8) on `<input>` only: `[(ngModel)]` writes back through the field's state setter, the explicit `[ngModel]` plus `(ngModelChange)` pair works, `required` / `minlength` / `maxlength` / `email` / `pattern` attributes validate with Angular's error shapes, and refs expose `valid` / `invalid` / `touched` / `errors` to template expressions. See the Forms section below for the exact limits |
| Reactive forms (`FormGroup`, `FormControl`, `Validators` from `@angular/forms`) | Wired (Stage 8): the classes are runtime classes, a group field is a stable ref-held instance, `[formGroup]` plus `formControlName` binds controls, and `profileForm.get('email')` evaluates in template expressions. See the Forms section below |
| `<form (submit)="save()">` | Wired (Stage 8) as a lightweight form element: a `<button type="submit">` inside calls the handler after marking every ngModel input touched (and `markAllAsTouched()` on a reactive group). There is no NgForm object |
| Routing (`Routes` array, `<router-outlet>`, `routerLink`, `ActivatedRoute`, `Router`) | Wired (Stage 9) in the modern standalone form: the compiler mirrors the `export const routes: Routes = [...]` array that `provideRouter(routes)` consumes, not the historical `RouterModule.forRoot` module form. The root component hosts one `<router-outlet>`; route components are ordinary components imported by the routes file; `routerLink` (string or array form) on a `<button>` or `<row>` compiles to a navigation press; `ActivatedRoute.snapshot.params` and its `paramMap` Observable-lite, and `Router.navigate` / `navigateByUrl`, are runtime classes. See the Routing section below for the exact limits |
| Date picker, bottom sheet, dialog and snack bar (`<datetime-picker>`, `<sheet>`, `<dialog>`, `<actions>`, `SnackBar`) | Wired (Stage 10) as documented native adaptations of the Angular Material surface: the picker is one block with iOS style wheels, opening in a centred modal on every platform; datetime runs as two separate steps, the date modal then the time modal; MatBottomSheet and MatDialog become declarative `[open]` plus `(close)` blocks whose children render inside the panel; MatSnackBar keeps the service form through the built-in `SnackBar` injection, `open(message, actionLabel, durationMs)` and a returned ref with `onAction`. Event bindings never hold assignments. See the Pickers and overlays section below for the exact limits |
| Data display (`<tabs>`, `<accordion>`, `<panel>`, `<table>`, `<slider>`, `<progress-bar>`, `<spinner>`, `<chips>`, `<chip>`, badge) | Wired (Stage 11) as adaptations of the Angular Material surface: mat-tab-group becomes `<tabs [index] (change)>` with `<tab label>` children that own their content; mat-expansion-panel becomes a self-managed `<panel>` and mat-accordion a single-open `<accordion>`; mat-table becomes `<table [data]>` with `<column name header>` declarations (identifier columns only, no templates, sorting or pagination); mat-autocomplete becomes `[options]` plus `(optionSelected)` on `<input>` (string options only, no `displayWith`); mat-slider, mat-progress-bar and mat-progress-spinner keep their shapes with snap, clamp and size rules; mat-chip becomes `<chip>` in a `<chips>` row; matBadge becomes a `badge` attribute on `<button>`, `<row>` and `<icon>` only. See the Data display section below for the exact limits |

**Not supported yet**: do not use these in Rangular source today:

| Angular feature | Status today | Planned |
|---|---|---|
| Two-way binding `[(x)]` beyond ngModel | Only `[(ngModel)]` on `<input>` is a real two-way binding (Stage 8). Any other `[(x)]` is *parsed* but degrades to a one-way `[x]` prop binding with no write-back; Stage 6 controls use the explicit `[value]` plus `(change)` pattern instead | Not planned beyond ngModel |
| NgModules (`@NgModule`, `providers` arrays, module-scoped DI) | Not supported, resolution is import-based instead: `@Component` classes are entry points, and `@Injectable({ providedIn: 'root' })` classes are the injectable services (Stage 3). An `@NgModule` file errors with `CLS_NO_COMPONENT`; an `@Injectable` without `providedIn: 'root'` is not registered, so injecting it is a `DI_UNKNOWN_TOKEN` error | Not planned as modules |
| Component constructor *bodies* | Not translated, only constructor parameter properties are read (they are the DI declarations). Do one-time setup in `ngOnInit` instead | Not planned |
| Animations (`@angular/animations`, `:enter`/`:leave`) | Not supported anywhere in the compiler | Post-v1 |
| SSR / hydration | Not supported, output is a React Native app, there is no server rendering | Not planned |
| Full RxJS surface (operators, Subjects, Observables from other sources) | Not supported. Only the Observable-lite exists (`subscribe(next?, error?)`, no operators). The `async` pipe is wired (Stage 12): generated code subscribes in an effect and renders the latest value; the streamed expression is captured at mount, so stream a stable field or service property, not a fresh method call | Later stage |
| `*ngIf` with `else` / `then` | Detected, warns `GEN_NGIF_ELSE_TODO`, element emitted unconditionally. Workaround: two elements, `*ngIf="cond"` and `*ngIf="!(cond)"` | Later stage |
| Built-in control flow (`@if`, `@for`, `@switch`) and `@defer` | Not supported. Templates use the structural directives `*ngIf` and `*ngFor`; there are no lazy template blocks | Not planned |
| Signals as component state (`signal()`, `computed()`, `input()`, `output()`) | Not supported. State is plain class fields; inputs and outputs are the `@Input()` / `@Output()` decorators. The runtime package's tiny `signal()` helper is a service-side utility, not the component model | Not planned |
| Signal Forms, `resource()` / `httpResource()` | Not supported. Forms are the Stage 8 template-driven and reactive APIs; async data is the HttpClient subscribe form or promises in `.then` form | Not planned |
| Two structural directives on one element (`*ngIf` and `*ngFor` together) | Detected, warns `TPL_STRUCTURAL_MULTIPLE`: the first directive is kept, each later one is dropped and named in a TODO comment in the generated code. Nest one element inside the other instead | Enforced (the keep-first degrade is the v1 behaviour) |
| `[class]` / `[ngClass]` whole-value class bindings | Detected, warns `GEN_CLASS_BINDING`, binding dropped: a dynamic class string cannot be resolved to StyleSheet entries at compile time. Toggle one declared class with `[class.name]="cond"` instead (supported, see the styling notes) | Not planned |
| `[style]` / `[style.prop]` / `[ngStyle]` bindings, and static `style="..."` attributes | Detected, warns `GEN_STYLE_BINDING`, dropped: raw CSS values bypass the token-snapped component styles, and a static style attribute has no StyleSheet entry to attach to. Declare a class in the component styles instead | Not planned |
| `[attr.x]` bindings | Detected, warns `GEN_ATTR_BINDING`, dropped: React Native elements have no arbitrary HTML attributes. Use the plain attribute or the specific `[prop]` binding the block documents | Not planned |
| `import A = require('x')` / `import A = B.C` declarations | Detected, warns `CMP_IMPORT_FORM`, dropped: the generated module is an ES module and cannot carry the form. Write an ES module import instead; third-party ES imports are carried (see the Third-party imports section) | Not planned |
| Full CSS (cascade, inheritance, descendant/id/pseudo selectors, unsupported properties) | Subset only: element and `.class` selectors, a fixed property list; anything else warns (`CSS_SELECTOR` / `CSS_UNSUPPORTED`) and is dropped. Styles apply per element, no cascade | Subset may grow per stage |

### Rangular source vs React

Rangular source is **not React**. Do not write React in it:

| React concept | In Rangular source |
|---|---|
| Components | TypeScript **classes** with `@Component`, never function components |
| Markup | A separate `.html` **template file** (or inline template string). **No JSX anywhere in source** |
| State | Plain **class fields** (`count = 0`). **No hooks, no `useState`, no `useEffect` in source**, the compiler *generates* a function component with hooks underneath |
| Updating state | Mutate the field inside a method: `this.count++`. A field assigned inside any method becomes `useState` in the output; a field never assigned stays a plain constant. Lists change by assigning a new array (`this.items = [...this.items, item]` to add, `this.items = this.items.filter(...)` to remove); `push`, `pop` and `shift` written as plain statements are translated to setter calls, the other array mutation methods warn instead of mutating in place |
| Events | Angular syntax: `(click)="increment()"`, never `onPress`/`onClick` props in source. The compiler maps `click → onPress`, `change → onChange`, `submit → onSubmit`, `input` on `<input> → onChangeText` |
| Conditionals / lists | `*ngIf` / `*ngFor` in templates, never `&&`, ternaries or `.map()` in source (those appear only in generated output) |
| Generated `.tsx` | **Output, never source.** Never edit it; change the `.ts`/`.html` and regenerate. Golden `.tsx`/`preview.html` files in `examples/` are regenerated by the CLI, not hand-edited |
| Styling | Component `styles` in the CSS subset, or design tokens. Never `StyleSheet` in source; `StyleSheet.create` exists only in generated output. Spacing, radius and font-size values snap to the token scales (Stage 4, `STYLE_OFF_SCALE`) |

## Supported template expressions

The expression language inside `{{ }}`, `[prop]="..."`, `*ngIf="..."` and
method bodies is a defined subset: do not assume all of TypeScript:

- Identifiers and member access: `title`, `m.from`, `mails.length`
- Literals: strings (`'Follow'`), numbers, `true` / `false`, objects in
  field initializers, and array literals in any expression (Stage 9:
  `['/mail', m.id]` is what the `[routerLink]` array form is made of)
- Arithmetic `+ - * / %`, comparison `== === != !== < > <= >=`, logic `&& ||`
- Unary `!` and `-`, including on the right-hand side of an assignment:
  `this.following = !this.following` is supported and is the toggle pattern
- Ternary: `following ? 'Following' : 'Follow'`, supported in interpolation
  and bindings; you do not need two `*ngIf` elements for a two-state label
- Method calls: `increment()`, `save($event)`; calls on members of fields
- Pipes: the full built-in set (`uppercase`, `lowercase`, `titlecase`,
  `json`, `date`, `number`, `percent`, `currency`, `slice`, `keyvalue`,
  `async`) plus any `@Pipe` class the component imports; an unknown pipe
  is a `PIPE_UNKNOWN` error, not a silent pass-through

## Block semantics and composition

- Blocks compose freely, like HTML: a `<button>` inside a `<card>`, a
  `<row>` inside a `<card>`, headings and paragraphs anywhere a screen or
  card can hold children. There is no separate permission table per parent.
  Controls compose the same way: a control may nest inside a `<row>`,
  so a habit list row can carry its own `<checkbox>` (the row renders
  its title lines and the control together).
- A block stores **one** structural directive: never put `*ngIf` and
  `*ngFor` on the same element, nest one inside the other instead.
  The compiler enforces the rule: a second structural directive warns
  `TPL_STRUCTURAL_MULTIPLE` and is dropped (the first is kept), with a
  TODO comment at the element in the generated code.
- `<row avatar>`: the bare `avatar` attribute turns on a circle at the row's
  left. The circle shows the **first character of the row's `title`**, on the
  theme's primary colour. Today the avatar exists only as part of `<row>`;
  using `<row avatar [title]="name">` as a profile header inside a `<card>`
  is the current pattern. A dedicated avatar/profile-header block is a known
  gap, noted for a later stage.
- Row text lines, in order: `title` = the headline line, `subtitle` = the
  second line, `detail` = a third, muted line. Choose by how many lines the
  item has: two lines → `title` + `subtitle`; three → add `detail`. (The
  inbox is three: sender / subject / snippet. A post with title + snippet
  is two: `title` + `subtitle`.)
- Long prose (a bio, a description paragraph) belongs in a `<p>`, not in a
  row's `subtitle`, row lines are single-line list text and may truncate;
  `<p>` wraps.

## Controls (Stage 6)

Four selection controls mirror the Angular Material components Angular
applications already use. The source stays in Angular style:

| Rangular source | Angular Material correspondence | Generated primitive | `(change)` emits |
|---|---|---|---|
| `<switch [checked]="wifiOn" (change)="onWifi($event)">Wi-Fi</switch>` | `mat-slide-toggle` | `RgSwitch` | the next boolean |
| `<checkbox [checked]="done" (change)="onDone($event)">Done</checkbox>` | `mat-checkbox` | `RgCheckbox` | the next boolean |
| `<switcher [value]="view" (change)="onView($event)">` with `<option>` children | `mat-button-toggle-group` | `RgSwitcher` with `RgOption` declarations | the chosen option value |
| `<radio-group [value]="size" (change)="onSize($event)">` with `<radio>` children | `mat-radio-group` | `RgRadioGroup` with `RgRadio` declarations | the chosen radio value |

- **The write back pattern is a method.** A control never assigns a
  field from the template. The handler receives the next value as
  `$event` and assigns its parameter inside the method:
  `onWifi(value: boolean) { this.wifiOn = value; }`. Codegen turns the
  control `(change)` binding into an `onChange` prop whose callback
  receives that value, unlike the generic event wrapper used for
  `(click)`.
- **A handler may take extra arguments before `$event`.** Inside a
  `*ngFor`, `(change)="onToggle(h, $event)"` passes the row item first
  and the control's next value second; the handler signature follows
  the same order, `onToggle(habit: Habit, value: boolean) { ... }`.
  The same holds for `(click)` and the other events: arguments written
  before `$event` are evaluated in the row's scope.
- **Declaration children are data.** `option` and `radio` elements are
  declarations inside their group, in the same spirit as option
  elements inside a select. Codegen emits `RgOption` and `RgRadio`
  elements inside the group, and the group primitive reads each
  child's `value` prop and text label to build its segments or rows.
  The preview renderers extract the same value and label pairs from
  the template AST.
- **Nesting is checked.** An `option` outside a `switcher`, a `radio`
  outside a `radio-group`, or any other element inside either group
  earns a `GEN_CONTROL_NESTING` warning with a fix line.
- **Disabled:** `switch` and `checkbox` accept `[disabled]`; a
  disabled control keeps its value and emits nothing.
- **Switch colour:** a switch's `color` names a role, never a
  paint: `primary` is the default blue on state, and `success`
  paints the on state the theme success green. Off is the
  surface variant grey either way. A static colour outside
  the two is a `GEN_SWITCH_COLOR` error.
- **Switcher means view state, not routing.** It changes a field on
  the same screen, and panels below it switch with `*ngIf` on that
  field. Real navigation between screens is routing (Stage 9, see the
  Routing section).
- **Switch motion:** the knob only ever moves toward its target. The
  React Native primitive animates it with a plain linear timing move,
  never a spring, so there is no overshoot and no backward bounce.
  The preview uses a linear CSS transition between the same two end
  states. See `examples/settings/` and its recipe card.

## Icons (Stage 7)

One icon block, in the shape of Angular Material's `mat-icon`, drawing
from one curated set of Material style icons:

```html
<icon name="search"></icon>
<icon name="heart" size="28" color="error"></icon>
<icon [name]="currentIcon"></icon>
```

- **The set.** 27 names: menu, search, close, check, chevron-left,
  chevron-right, arrow-left, arrow-right, plus, minus, bell, heart,
  star, settings, home, person, calendar, alarm, play, pause, edit,
  delete, share, info, warning, mail, sun. The set lives as SVG path
  data (24 by 24 viewBox) in `packages/ui/src/icons.ts`, and the
  catalog's Icons section is generated from that same file.
- **Props.** `name` only, plus optional `size` (20, 24 or 28, default
  24) and `color` (a theme colour role name; default is the theme text
  colour, the onSurface role). `[name]`, `[size]` and `[color]`
  bindings work. There are no other props and no events in v1.
- **Validation.** A static name outside the set is a
  `GEN_ICON_UNKNOWN` error: the message names the bad name, the fix
  points at the Icons list in catalog.md, and the JSON diagnostic
  carries the full valid list in a `validIcons` field. A missing name
  is `GEN_ICON_NAME`. An off-scale size warns with `GEN_ICON_SIZE`
  and the generated code uses the nearest on-scale size, the same
  warn-and-snap rule as styles. A `[name]` binding is passed through
  unchecked.
- **Parity by construction.** The generated app draws the path data
  through `RgIcon` (react-native-svg, which ships inside Expo Go and
  standard Expo and React Native projects); the preview draws the
  exact same path data as inline SVG, coloured by the same theme role
  variables. One drawing, two renderers, no drift. The appbar menu
  and the checkbox tick are set icons now (menu, check), not font
  characters.
- **Not in this stage.** Custom project icons (registering your own
  path data) come later. Today the curated set is the whole set. See
  `examples/icons/` and its recipe card.

## Forms (Stage 8)

Forms work the Angular way, in both flavours, with the boundaries
stated plainly. Text entry is one block: `<input>` compiles to the
`RgInput` primitive, a Material style field (label above the field,
an outlined box from the tokens, an error line under it in the error
colour).

**A. The input block.** Attributes: `value` or `[value]`,
`placeholder`, `label`, `error` (a static message or an `[error]`
binding shown under the field), `[disabled]`. `type` picks the form
of the field: `type="password"` is a secure entry, `type="email"`
an email keyboard, `type="number"` a numeric keyboard. Events:
`(input)` and `(change)` both deliver the text as `$event` to the
`onChangeText` wiring, and `(blur)` maps to `onBlur`. Like HTML's
input element, `<input>` is a void element: it takes no closing
tag. Write `<input ...>` and never `</input>`; a stray closer is a
`TPL_MISMATCH` error whose fix line says exactly that.

**B. Template-driven binding.** On `<input>` only:

- `[(ngModel)]="email"` compiles to `value={email}` plus a write
  back into the field's state setter. The bound field becomes state
  by definition. Bind to a plain field with a literal initial value;
  a member path (`user.name`) warns `GEN_NGMODEL_EXPR` and binds one
  way.
- The explicit pair works too: `[ngModel]="email"` with
  `(ngModelChange)="onEmail($event)"`.
- ngModel anywhere else is a `GEN_NGMODEL_TARGET` error: selection
  controls already have their `[checked]` / `[value]` plus
  `(change)` contract, and this version does not grow a second one.
- `ngModelOptions` is accepted and ignored. There is no form
  registry to opt out of.

**C. The form element and validation.** `<form (submit)="save()">`
is a plain wrapper; a `<button type="submit">` statically inside it
calls the submit handler, and a button with its own `(click)` keeps
that click instead. Validators are attributes on the input:
`required`, `minlength="3"`, `maxlength`, `email`, `pattern="..."`.
Two Angular details hold exactly: `type="email"` does NOT imply the
email validator (write the `email` attribute), and every validator
except `required` passes an empty value. Errors are the runtime
`Validators` results, in Angular's shapes (`{ required: true }`,
`{ minlength: { requiredLength, actualLength } }`,
`{ email: true }`, `{ pattern: { requiredPattern, actualValue } }`).

- **Template references.** `#email="ngModel"` on an ngModel input
  exposes `email.value`, `email.valid`, `email.invalid`,
  `email.touched` and `email.errors` to TEMPLATE expressions only:
  interpolation, `*ngIf`, `[disabled]`. Method bodies do not see
  refs. The generated code materialises each ref as a small model
  object next to the input's state; the preview computes the same
  object.
- **Touched.** An input becomes touched on blur. A submit attempt
  marks every ngModel input in the form touched, so the standard
  error pattern `<p *ngIf="email.invalid && email.touched">` shows
  errors on save even for fields the user never visited, and tracks
  validity live afterwards.
- **Not built:** NgForm machinery. No `form.valid` over a
  template-driven form, no `(ngSubmit)` event object, no control
  registry. Gate the submit button with the refs.

**D. Reactive forms.** `FormControl`, `FormGroup`, `FormArray`,
`FormBuilder` and `Validators` imported from `@angular/forms` in
source are the runtime classes of the same names. A field initialised
with `new FormGroup(...)`, `new FormControl(...)` or
`new FormArray(...)` is a stable instance: the generated component
holds it in a `useRef`, reads it as `profileFormRef.current`, and
re-renders through a version counter subscribed to every top-level
child's `valueChanges`. Groups and arrays are tree nodes: a group or
an array holds controls, groups and arrays, and `value`, `valid`,
`touched` and `dirty` aggregate over the children (a group's value
is the object of child values, an array's the array of row values).
`setValue` writes a complete shape and `patchValue` a partial one,
recursing into containers. The template surface is
`[formGroup]="profileForm"` on the `<form>` and
`formControlName="email"` on inputs (a static attribute; an unknown
control name is a `GEN_FORM_CONTROL` error listing the group's
controls). `profileForm.get('email')` evaluates in template
expressions, generated code and preview alike, because the instance
is real in all three. `(submit)` on a reactive form marks all
controls touched (rows included), then calls the handler; handlers
read `this.profileForm.value` and `.valid` as plain member reads.

- **FormArray.** A dynamic list of rows lives in the group as a
  `FormArray` child. A container inside the form carries
  `formArrayName="members"`, naming a control of the group that must
  be a `FormArray` (anything else is a `GEN_FORM_ARRAY` error, as is
  `formArrayName` outside a `[formGroup]` form). Inside the
  container, rows repeat with `*ngFor` over
  `profileForm.get('members').controls` with `let i = index`, and a
  row input binds `[formControlName]="i"`: the binding form is
  allowed only here, as a row index (a static number also works; a
  static name is a `GEN_FORM_ARRAY` error, rows are numbered, not
  named). Rows are born and removed in methods:
  `(this.profileForm.get('members') as FormArray).push(new FormControl(''))`
  and `.removeAt(i)` compile, as do `insert`, `clear`, `at` and
  `length`. The array's `valueChanges` fires on row edits and on
  structure changes, so one subscription keeps the form live. Reach
  the array with `.get()` at each use site: class getters are not
  part of the subset, so a `get members()` accessor is never
  generated.
- **FormBuilder.** `FormBuilder` is a built-in injection like
  `HttpClient`, in components and in root services:
  `constructor(private fb: FormBuilder)`, then a field such as
  `profileForm = this.fb.group({ email: ['', [Validators.required, Validators.email]], city: 'Salem', aliases: this.fb.array([['', Validators.required]]) })`.
  The generated component holds the builder in a local of the dep's
  name and the initializer is rewritten onto it, nested builder
  calls included. Config entries coerce the Angular way: an instance
  is used as-is, a tuple `[initialValue, validators]` becomes a
  control with those validators, any other value becomes a control
  holding it; a tuple's third element (async validators) is ignored.
  `fb.control(...)` also mints a control inside a method, ready to
  push into an array.
- **Preview initializer subset.** The preview builds the tree by
  evaluating the field initializer with a small hand-written
  evaluator (no eval): literal initial values, `Validators.x`
  references, validator calls like `Validators.minLength(3)`,
  validator arrays, trailing commas, `FormGroup` objects of form
  nodes, `FormArray` lists, nested groups, and `FormBuilder`
  group/control/array calls with literal or tuple entries. Anything
  richer warns `GEN_FORM_INITIALIZER`: the generated app still runs
  the initializer verbatim, only the preview cannot build the
  instance.
- **Not built:** group-level and array-level validators (a
  container's `errors` is null and its validity is
  all-children-valid), async validators, value changes streams
  beyond each node's `valueChanges`, and template binding for a
  standalone `FormControl` field (no `[formControl]` surface yet).

See `examples/signup-form/` (template-driven),
`examples/profile-form/` (reactive), `examples/team-form/`
(FormArray rows) and `examples/builder-form/` (FormBuilder) and
their recipe cards.

## Routing (Stage 9)

Routing mirrors the modern standalone Angular form: a routes file
exporting a `Routes` array, the same array `provideRouter(routes)`
consumes in a current Angular app. The historical
`RouterModule.forRoot(routes)` module form is not used, because
Rangular has no NgModules; everything else about the source (the
outlet, the links, the injected services) is written exactly as in
Angular.

- **One discovery rule.** The routes file is `app.routes.ts` next to
  the root component, or the file named by the CLI flag
  `rg build --routes <file>` (also on preview, watch and
  doctor). It is read whenever it exists. The supported shape is one
  exported variable whose name ends in `routes` (or whose type
  mentions `Routes`) initialised with an array literal of plain
  object entries:

  ```ts
  import { Routes } from '@angular/router';
  import { InboxComponent } from './inbox.component';
  import { MailDetailComponent } from './mail-detail.component';
  import { NotFoundComponent } from './not-found.component';

  export const routes: Routes = [
    { path: '', redirectTo: 'inbox', pathMatch: 'full' },
    { path: 'inbox', component: InboxComponent },
    { path: 'mail/:id', component: MailDetailComponent },
    { path: '**', component: NotFoundComponent },
  ];
  ```

- **Entries.** A `path` (string, required), a `component` (a plain
  class reference to an `@Component` the routes file imports), or a
  `redirectTo` (a plain path, full match only; `pathMatch` is read
  and only `'full'` semantics exist). `data` and `title` keys are
  accepted and ignored. Matching tries entries in declaration order:
  a `:name` segment captures exactly one segment as a string, `**`
  matches anything including nothing, segment counts must otherwise
  be equal, and redirects restart matching at the target (chains
  work, loops fail closed as no-match).
- **The outlet.** The root component's template holds one
  `<router-outlet></router-outlet>`, compiled to the `RgOutlet`
  primitive. The generated root holds a module-level `RgNavigator`
  (a stack of matched entries) in React state and renders the
  component whose pattern matches the current entry, keyed by the
  concrete path. Route components compile exactly like child
  components and receive no props from the shell.
- **Links.** `routerLink="/inbox"` and
  `[routerLink]="['/mail', m.id]"` work on any tappable block
  (`<button>`, `<row>`, `<fab>`); they compile to an `onPress` that
  calls the generated `Router`. The array form goes through
  `Router.navigate` (commands joined with `/`, numbers stringified),
  the string form through `navigateByUrl`. Combined with a `(click)`
  handler, the handler runs first, then the navigation. On a child
  component tag a routerLink warns `GEN_ROUTE_UNSUPPORTED`; navigate
  from inside the component instead.
- **Parameters.** Inject `ActivatedRoute`
  (`constructor(private route: ActivatedRoute)`): the outlet creates
  one instance per mount from the current entry and provides it
  through a context around the routed subtree, so ANY component
  under the routed component can inject it, not only the routed
  component itself (Angular provides it through the outlet's
  injector the same way). A component mounted outside any outlet
  reads an empty route instead of crashing. Before 2026-11-17 the
  instance travelled as a prop to the routed component only, and a
  child injecting it received undefined and crashed on
  `route.snapshot`; the tutorial's ActivatedRoute lesson caught it.
  `route.snapshot.params` is a plain object of strings, and
  `route.paramMap` is an Observable-lite that emits the current
  params on subscribe and again on each navigation while subscribed.
  **Simplification, stated plainly:** in Angular, navigating from
  `/mail/2` to `/mail/3` reuses the component and pushes the new
  value through `paramMap`; in Rangular v1 the outlet remounts the
  component (the key is the concrete path), so `ngOnInit` runs again
  with the new snapshot. Code that reads the snapshot in `ngOnInit`
  behaves identically in both.
- **Navigation from code.** Inject `Router`:
  `this.router.navigate(['/mail', 3])` and
  `this.router.navigateByUrl('/mail/3')` write to the one navigator
  and return whether the path matched. Commands resolve from the
  root in v1; relative-to-current-route navigation is not supported.
  `RgNavigator.back()` pops the stack and returns false at the root.
  Wiring the phone's hardware back button to it belongs to the app
  shell and lands with the Expo scaffold in Stage 12.
- **Preview.** The preview runs the same flow: it starts at the
  empty-path match (redirects applied), rows and buttons with links
  navigate, the outlet swaps components, and at stack depth 2 or
  more a dashed "Preview navigation" bar with a Back button appears
  above the routed content. That bar is preview chrome only, a
  stand-in for the phone's back affordance; it is not part of the
  app UI and never appears in generated code. The preview's matcher
  is a hand mirror of the runtime matcher, parity-tested over a
  table of paths.
- **Diagnostics.** No routes file while routing is used:
  `GEN_ROUTES_MISSING` (error). A component name that is not a
  resolved `@Component` (including the root component itself):
  `GEN_ROUTE_COMPONENT` (error). Two entries with the same path:
  `GEN_ROUTE_DUPLICATE` (warning, the first entry wins). An entry
  using `children`, `canActivate`, `canActivateChild`,
  `canDeactivate`, `canMatch`, `resolve`, `loadComponent` or
  `loadChildren`, an unknown key, a malformed entry, an outlet
  inside a child component, or a redirect to an undeclared path:
  `GEN_ROUTE_UNSUPPORTED`, naming the feature.
- **Not in this version.** Child routes and nested outlets, guards,
  resolvers, lazy loading, `routerLinkActive`, and relative
  navigation. The `switcher` block remains view state inside one
  screen; it is not a tab bar and not routing.

See `examples/mini-mail/` and its recipe card.

## Pickers and overlays (Stage 10)

**Product rule, from Bigyan: the date-time picker looks and behaves
like the iOS wheel picker on every platform.** It never renders a
calendar grid, a clock face or an Android style material date or
time dialog. The field row opens the wheels centred in a dialog
card; the selected value sits in the middle row,
rows above and below are muted, and the header carries accent
coloured text buttons either way. Rolling a wheel ticks one
selection haptic per row that passes the centre.

### The picker

Angular Material's datepicker is an input plus a toggle plus a
calendar popup. A phone has no calendar popup culture, so the
Rangular adaptation is one dedicated block:

```html
<datetime-picker label="When" mode="datetime" [value]="when"
  (change)="onWhen($event)"></datetime-picker>
```

- **Modes.** `mode="date"` shows month, day and year wheels.
  `mode="time"` shows hour 1 to 12, minute and AM/PM wheels, the
  iOS en-US form. `mode="datetime"` is the default and never mixes
  the two in one panel: it opens the date step first (the month,
  day and year wheels, with a Next button), then the time step
  (hour, minute and AM/PM wheels, with Back and Done), two
  separate modals in sequence. The wheels are 40px rows in 20px
  type, in year, month, day order, the Apple Calendar form.
  (Before 2026-11-20 datetime used one combined day list of 367
  rows; it scrolled wildly and is gone.)
- **Gesture rules (iOS, settled 2026-11-20).** A wheel commits
  its value once per gesture, at rest: momentum end always
  commits, because the snap has landed the offset exactly on a
  row and the reading is stable; drag end commits only when the
  wheel is already resting exactly on a row. The wheel never
  repositions itself for its own commits: a ref marks the last
  self-committed index, and the centring effect scrolls only
  for outside changes (the picker opens, a sibling wheel clamps
  the day). The old wheel committed mid-flight on drag end and
  hard-scrolled on every value change, which made the year
  oscillate between two neighbours, 2025-2026-2025-2026, with a
  haptic per flip. Physics: no interval momentum flag (that is
  a paging prop, and it grabbed fast flicks), decelerationRate
  fast, snap to the 40px row. Rows are memoized, so a centre
  change re-renders two rows, not the whole wheel. The haptic
  stays one selection tick per row that crosses the centre,
  fired from the scroll offset, never from a commit.
- **Value contract.** `[value]` accepts an ISO string or a `Date`.
  The picker keeps a pending value while the picker is open. Done
  emits `(change)` once, with the composed local ISO string
  `YYYY-MM-DDTHH:mm:00` as `$event`; Cancel discards the pending
  value and emits nothing. An unparseable value falls back to the
  current local date and time in the primitive. Children of the
  block are ignored.
- **Ranges.** Years run over a fixed range, 150 years either
  side of the current year (301 entries), in date mode and in
  the datetime date step alike, extended only to include the
  value's year when that lies outside it. The list never
  follows the pending value; a value-centred list made the
  year wheel jump and even reverse under the scroll. Day
  selections clamp into their month, so
  January 31 followed by February becomes February 28 or 29, with
  leap years handled correctly.
- **Minute interval.** `minuteInterval` is 1 or 5, default 1. A
  static value or a literal binding outside the two warns
  `GEN_PICKER_INTERVAL` and the generated code uses the nearest of
  the two. A field binding passes through unchecked, and the
  primitive treats any value other than 5 as 1. A minute value
  between steps opens on the nearest step in the wheel, and Done
  emits that step even if the minute wheel is never touched.
- **Mode validation.** A static mode outside `date`, `time` and
  `datetime` is a `GEN_PICKER_MODE` error whose fix lists the
  three modes; the value is still emitted and the primitive treats
  it as `datetime`. A `[mode]` binding passes through unchecked.
- **Container.** The wheels always open centred in a modal
  dialog. The picker takes no presentation: a `presentation`
  attribute or binding is a `GEN_PICKER_PRESENTATION` error. (A
  sheet form existed until 2026-11-20 and was removed as
  superfluous.)
- **Preview.** The wheels are clickable lists in the preview:
  clicking a value selects it, with the same selected value
  outcome as scrolling a wheel to rest on it. The generated app
  uses a snapping scroll column. This is the one stated preview
  simplification for the picker.

### Sheet and dialog

MatBottomSheet and MatDialog are service driven in Angular
Material: code opens a component and receives a ref. Rangular v1
keeps the visual and behavioural contract and makes the surface
declarative, because Rangular templates are declarative:

```html
<sheet [open]="sheetOpen" (close)="closeSheet()">...</sheet>
<dialog [open]="confirmOpen" (close)="closeConfirm()" title="Delete?">
  <p>...</p>
  <actions><button (click)="closeConfirm()">Cancel</button></actions>
</dialog>
```

- `<sheet>` compiles to `RgSheet`: a drag handle, rounded top
  corners and the theme surface, sliding up over a dimmed backdrop
  with a plain timing animation, never a spring. `<dialog>`
  compiles to `RgDialog`: a centred themed card over a dimmed
  backdrop, with a quick fade and settle. Both are Modal-free
  absolute overlays inside the screen. A sheet panel carries an
  extra 24px of bottom padding under its content, so its action
  buttons clear the Android navigation and gesture zone. While
  the keyboard is up, a focused field inside an overlay lifts
  the whole overlay layer by exactly its own overlap, so the
  field's bottom rests 20px above the keyboard; a field already
  at or above that line moves nothing, and a large modal keeps
  its size.
- **Children render inside the panel**, the way card children
  render inside a card. A dialog takes its heading from the
  `title` attribute. Ordinary `<button>` children stay ordinary
  buttons; wrap them in `<actions>` for the right aligned action
  row that compiles to `RgActions`. Buttons close an overlay by
  calling author methods that set the bound field to false.
- **Backdrop taps emit `(close)`.** The handler is a method call,
  never an assignment (see the event rule below). With no `[open]`
  binding, no bare `open` attribute and no `open` attribute, the
  overlay renders statically open and the compiler warns
  `GEN_OVERLAY_OPEN`, because it cannot be opened or closed from
  the component.
- Doctor treats `sheet` and `dialog` as containers: loose text
  directly inside either warns `DOC_RAW_TEXT`. Wrap words in
  `<p>` or `<label>`.

### Event bindings never hold assignments

This rule is repo wide, and Stage 10 settled it from the code:
the template expression grammar has no assignment operator, so a
binding like `(close)="sheetOpen = false"` cannot be translated.
Codegen detects assignment statements in event bindings, warns
`GEN_EVENT_ASSIGNMENT`, drops the binding and leaves a TODO
comment, instead of emitting an assignment against a const state
binding. The pattern is always a method:
`(close)="closeSheet()"` in the template and
`closeSheet() { this.sheetOpen = false; }` in the class.

### SnackBar

MatSnackBar keeps its service shape. Import `SnackBar` from the
Angular Material path and inject the built-in token in a
component, by type name (the token is built in; there is no
module to register):

```ts
import { SnackBar } from '@angular/material/snack-bar';

constructor(private snack: SnackBar) {}
save() { this.snack.open('Reminder saved'); }
```

- `open(message, actionLabel?, durationMs = 4000)` returns a
  `SnackBarRef`. Opening a bar replaces the current bar, as in
  Material, and the replaced bar's action callbacks do not fire.
  A positive duration auto-dismisses; a duration of 0 or less
  leaves the bar up until it is dismissed, replaced or its action
  is pressed.
- The generated module holds one `__snackBar` instance when any
  component in the compilation injects `SnackBar`, including a
  child component. The entry component mirrors its current bar in
  state and renders the `RgSnackbar` host: a translucent black
  toast card at bottom centre (the look is specified in the
  tutorial round section below) with the message and the action
  label uppercased.
  Pressing the action dismisses the bar first, then fires the
  ref's `onAction` callbacks.
- **The supported action form is the statement form**, decided
  from the method translator: a const holding the `open(...)`
  result, then a block body arrow subscription.

  ```ts
  const ref = this.snack.open('Reminder deleted', 'Undo');
  ref.onAction(() => { this.deleted = false; this.restored = true; });
  ```

  The chained one line form
  `this.snack.open(...).onAction(() => this.restore())` is not the
  documented form in this version. `ref.dismiss()` also works.
- `SnackBar` is a component level built-in. A service injecting
  it gets `DI_UNKNOWN_TOKEN`, because a service has no root host
  to render through.
- **Preview.** The page runtime mirrors the service: a bar opened
  by a tap appears in the screen, pressing its action dismisses
  it and fires the callbacks, and timers use the real duration
  from the call when the host provides timers.

See `examples/reminder/` and its recipe card.

## Data display (Stage 11)

Seven components, all declaration driven in the Stage 6 pattern: a
group primitive reads its declaration children, and the children
render nothing on their own. All of it is exercised by
`examples/mailbox-pro/` and its recipe card.

- **Tabs own content panels; the switcher does not.** That is the
  one distinction to keep straight. `<tabs>` follows the Stage 6
  controls contract: `[index]="tabIndex"` in, `(change)` out with
  the new index as `$event`. Each `<tab label="Overview">` carries
  real template children, rendered only while its tab is selected,
  like `*ngIf`. The header is a row of labels with the selected
  label in the primary colour over a 3px indicator bar. Use
  `<switcher>` when the choices are a bare value and the content
  swap is yours to write with `*ngIf`; use `<tabs>` when each
  choice is a page of its own. Without `[index]`, the group holds
  its own selection. A `<tab>` outside `<tabs>` (and anything but a
  `<tab>` inside one) warns `GEN_CONTROL_NESTING`.
- **Panels manage their own state; `[expanded]` is a seed.**
  `<panel title="..." subtitle="...">` toggles when its header is
  tapped; the header chevron rotates down when closed and up when
  open. `[expanded]` sets the state the panel starts in. It is not
  a controlled binding, deliberately: a tap always works even when
  nobody handles `(toggle)`. `(toggle)` emits the next open
  boolean as `$event`, so a handler that writes a field gives you
  observation, and writing the seed field back gives effective
  control. The same no-assignment rule as everywhere applies:
  `(toggle)="open = $event"` warns `GEN_EVENT_ASSIGNMENT`; call a
  method.
- **Accordion is single-open, and it fits the declaration
  pattern.** `<accordion>` groups its direct `<panel>` children so
  only one is open at a time, mat-accordion with `multi` false.
  The coordination lives in the group primitive, which injects
  internal props into its panel children (the `__rgRoute` pattern
  from Stage 9), so templates stay plain panels. The first panel
  whose `[expanded]` seed is open starts open. Anything but a
  `<panel>` inside `<accordion>` warns `GEN_CONTROL_NESTING`;
  panels outside an accordion stand alone.
- **Table columns are names, never templates.** This is a
  deliberate simplification of mat-table, whose real API (column
  definitions, `displayedColumns`, a data source) compresses to:

  ```html
  <table [data]="folders">
    <column name="count" header="Messages"></column>
  </table>
  ```

  `name` reads that property of each row object; the cell text is
  `String(value)`. The attribute is `name`, matching Material's
  matColumnDef name, and not `key`: React reserves `key` and never
  passes it to the component, so a key based column could not work
  in the generated app. `key` is accepted as an alias and compiles
  to the same prop. A column with neither is a `GEN_TABLE_COLUMN`
  error; anything but a `<column>` inside `<table>` warns
  `GEN_CONTROL_NESTING`. The header row is label styled over a
  hairline, rows are hairline separated, there is no zebra
  striping (Material has none by default). Empty data paints just
  the header, plus one muted row carrying the table's `emptyText`
  attribute when that attribute is present; without it, nothing,
  which is what Material shows. Sorting and pagination are not in
  this version; order the array in the component. They are roadmap
  items, not attributes: writing a sort attribute does nothing.
- **Autocomplete is an input with options, strings only.** An
  `<input>` gains `[options]` bound to a string array field and an
  `(optionSelected)` event:

  ```html
  <input [(ngModel)]="city" [options]="cities" (optionSelected)="onCity($event)">
  ```

  While the field is focused and its text is non-empty, a panel
  under the field lists the options containing the text, matched
  case-insensitively by substring (Material's example filter is a
  lowercase `indexOf >= 0`; this follows it exactly). Choosing one
  writes it back through the ngModel write-back path, exactly as
  if typed, and emits `(optionSelected)` with the chosen string.
  It also works on a plain `[ngModel]` input and next to a reactive
  control. Object options with a `displayWith` function are not in
  this version: map objects to display strings in the component.
  `(focus)` maps to `onFocus` for inputs that need it.
- **Slider snaps, clamps and reports once.** `<slider min max step
  [value] (change)>`: in the app the track takes taps and
  PanResponder drags at any position; the thumb follows the finger
  while dragging and `(change)` emits the snapped, clamped value
  once, on release (a tap is a press and a release, so taps emit
  too). A statically known `min` at or above `max` is a
  `GEN_SLIDER_RANGE` error with a fix; a statically known `step`
  at or below zero warns with the same code and generates 1.
  Preview simplification, stated plainly: when the range holds at
  most 20 steps, the preview track also renders one tappable tick
  per step value, because a DOM harness cannot click at an x
  fraction reliably; with more steps the preview slider paints but
  its ticks do not render.
- **Progress clamps; the spinner rides the icon size scale.** A
  determinate `<progress-bar [value]>` paints a fill of value
  percent; a statically known value outside 0 to 100 warns
  `GEN_PROGRESS_RANGE` and the generated value is clamped (a bound
  value clamps inside the primitive and the preview instead).
  `mode="indeterminate"` sweeps a 40 percent bar in the app on a
  looping linear timing; the preview paints that bar statically
  at 40 percent, a stated simplification. `<spinner>` rotates a
  270 degree SVG arc in the app (react-native-svg, the Stage 7
  dependency); the preview draws the identical arc statically, no
  rotation. The arc is one constant shared by the primitive, the
  server paint and the page runtime, pinned by a test. `size`
  takes the icon size scale (20, 24, 28) with warn-and-snap
  (`GEN_SPINNER_SIZE`); `color` names a theme colour role, primary
  by default.
- **Chips are pills; removal is an array rewrite.** `<chip>` is a
  static label pill inside a `<chips>` wrapping row. `icon="..."`
  leads with a Stage 7 icon (an unknown name is the usual
  `GEN_ICON_UNKNOWN` error). `removable` adds a close control;
  tapping it fires `(remove)`. The honest way to remove a chip
  from a list is a filter assignment in a method:

  ```ts
  removeFilter(name: string) {
    this.filters = this.filters.filter((f: string) => f !== name);
  }
  ```

  The method translator carries it: an assignment whose value is a
  call on a member of the same field compiles to the field's state
  setter with the filtered array, in the app and in the preview.
  Adding to a list is the mirror image, also by assignment:

  ```ts
  addFilter(name: string) {
    this.filters = [...this.filters, name];
  }
  ```

  `this.filters = this.filters.concat(name)` compiles to the same
  setter call. The general rule for list state: assign a new array,
  never mutate the field in place. Three mutation methods written
  as plain statements are translated for you, because their outcome
  is unambiguous: `this.filters.push(name)` becomes the concat
  setter call, and `this.filters.pop()` / `this.filters.shift()`
  become slice setter calls. Everything else is not guessed:
  `splice`, `unshift`, `sort`, `reverse` and `fill`, and `pop` or
  `shift` whose return value is used, warn `METHOD_UNSUPPORTED`
  with a fix line teaching the assignment form, and the statement
  degrades to a TODO comment.
- **Badge is an attribute, on three hosts only.** matBadge becomes
  `badge="3"` or `[badge]="unread"` on `<button>`, `<row>` and
  `<icon>`: a small error coloured count dot at the host's top end
  corner. A value of 0 or an empty value renders nothing
  (Material's hide-zero default, kept); a number above 99 renders
  `99+`; a non-numeric string renders as itself. There is no
  `badgeVisible` escape hatch in this version. On any other
  element the compiler warns `GEN_BADGE_HOST`, with a fix naming
  the three hosts, and drops the badge from the output.

See `examples/mailbox-pro/` and its recipe card.

## Pipes (Stage 12)

- **The built-in set is complete**: `uppercase`, `lowercase`,
  `titlecase`, `json`, `date`, `number`, `percent`, `currency`,
  `slice`, `keyvalue`, `async`. All three evaluators agree exactly:
  the compiler's evaluator (server paint and tests), the generated
  code's runtime `pipe()` from `@rangular-framework/runtime`, and the preview
  page. A parity test runs one table through all three.
- **date**: the value may be a `Date`, an ISO string or epoch
  milliseconds; anything else passes through unchanged. Named formats:
  `shortDate` = `M/d/yy`, `mediumDate` = `MMM d, yyyy` (the default),
  `shortTime` = `h:mm a`, `medium` = `MMM d, yyyy, h:mm:ss a`,
  `short` = `M/d/yy, h:mm a`. Any other string is a custom format
  using the tokens `yyyy`, `yy`, `MMM`, `MM`, `M`, `dd`, `d`, `HH`,
  `H`, `hh`, `h`, `mm`, `ss`, `a`. Formatting is local time; there is
  no timezone or locale argument in v1.
- **number / percent**: `number:'1.2-2'` is a digitsInfo: minimum
  integer digits, minimum fraction digits, maximum fraction digits.
  The value rounds to the maximum, pads to the minimums, and groups
  the integer part with commas. `percent` multiplies by 100 first and
  appends `%`. An unreadable digitsInfo falls back to the default
  (`1.0-3` for number and percent, `1.2-2` for currency) instead of
  throwing, the same in all three evaluators.
- **currency**: `currency:'USD'` prefixes the symbol and defaults to
  two fraction digits. Symbol table: USD `$`, EUR `€`, GBP `£`,
  INR `₹`, NPR `Rs`. An unknown code prints the code itself
  (`XYZ 49.50`); the second argument `'code'` forces the code form;
  the third argument is a digitsInfo.
- **slice** works on strings and arrays, with JavaScript slice
  semantics including negative indexes; anything else passes through.
- **keyvalue** turns an object into `{ key, value }` entries sorted
  by key (plain string ordering), which is what makes it usable as a
  `*ngFor` source: `*ngFor="let fact of facts | keyvalue"`.
- **async**: `{{ stream$ | async }}` renders the latest emitted
  value, starting from `null`. Generated code gives each distinct
  streamed expression a state slot plus an effect that subscribes on
  mount and unsubscribes on unmount; the expression is captured at
  mount, so stream a stable field or a service property assigned in
  the service's constructor (the supported shape), not an expression
  that builds a new observable per render. There are no RxJS
  operators; the value must be an Observable-lite (an object with
  `subscribe`), which is what `HttpClient` returns and what a service
  can hold. In the preview the page keeps one subscription per
  observable object and re-renders on emission; the preview's
  HttpClient stub never emits, so an HttpClient stream reads as
  `null` there (the app is where the data arrives). The runtime
  `pipe('async', value)` used outside templates subscribes, captures
  synchronous emissions, unsubscribes and returns the latest, which
  is what the tests pin.
- **Custom pipes**: a `@Pipe({ name: 'exclaim' })` class whose
  `transform(value, ...args)` method is ordinary TypeScript. The
  component file imports the class exactly like a child component or
  a service; the compiler registers the name from the import.
  `transform` compiles with the service-mode translator: `this.`
  survives, literal fields become plain class fields, and unsupported
  constructs degrade with `METHOD_UNSUPPORTED` and a TODO comment
  like any method. A pipe class with constructor dependencies is not
  supported (the instance is created with no arguments and a
  `DI_UNKNOWN_TOKEN` error explains). An unregistered pipe name in a
  template is a `PIPE_UNKNOWN` error listing the built-ins and the
  project's registered pipes.
- **Preview boundary for custom pipes**: the preview's static first
  paint evaluates a custom pipe only when `transform` is a single
  `return` of one expression written in the template expression
  subset (so `||`, not `??`); richer bodies render empty in the
  static paint. The interactive preview page runs the full translated
  body, as does the app. Example: `examples/pipes-demo`.

## Attribute directives (Stage 12)

- **The supported shape is the canonical beginner directive**: an
  `@Directive({ selector: '[appHighlight]' })` class with `@Input()`
  fields and an injected `ElementRef` (`constructor(private el:
  ElementRef)`), whose styling logic lives in `ngOnInit` or in a
  setter for one input (`@Input() set appTint(value) { ... }`).
- **The body subset is exact**: local `const` / `let` declarations
  plus assignments of the shape
  `this.el.nativeElement.style.<prop> = <expr>;`, where the
  expression may use the inputs (as `this.<input>` or, in a setter,
  the parameter), literals, locals, arithmetic, comparisons, logic
  and ternaries, member access and method calls on those values.
  There is no directive instance at runtime: the compiler extracts
  the assignments and folds them into a style object computed at each
  host element, so a directive costs nothing at runtime.
- **Host usage is Angular's**: `<p appHighlight="yellow">` (static),
  `<p [appHighlight]="color" defaultColor="violet">` (bound). Input
  resolution is binding, then static attribute, then boolean
  attribute (`true`), then the declared field initializer, then
  `undefined`. Directive attributes are consumed and never emitted
  as props. When the host has styles of its own, the directive's
  styles merge last and win per property.
- **Outside the subset warns `DIR_UNSUPPORTED`** with the offending
  statement quoted: event listeners (`@HostListener`), `Renderer2`,
  class or attribute writes, reading element properties, and
  directives placed on child component tags or on dedicated elements
  (`<input>`, `<icon>`, `<datetime-picker>`) all warn and apply no
  styles; the host still renders. A directive with no styling logic
  at all warns too. The preview computes the same merged styles in
  the static paint and the interactive page. Example:
  `examples/directives-demo`.

## Content projection (Stage 12)

- **One default slot.** A child template places
  `<ng-content></ng-content>`; everything written between the child
  component's tags in the parent renders there, in order. In
  generated code the child function receives a `children` prop and
  `<ng-content>` compiles to `{children}`.
- **Scope stays with the writer.** Projected content evaluates in the
  parent's fields and methods, not the child's, in generated code and
  in the preview alike: a button inside the projected content calls
  the parent's handler.
- **No slot, no render.** If the child template has no `<ng-content>`,
  children written in the parent go nowhere, the same as Angular.
- **Multi-slot projection is not in v1.** An
  `<ng-content select="...">` warns `PROJECTION_SELECT_UNSUPPORTED`
  and behaves as the default slot. Example:
  `examples/projection-demo`.

## The Expo app scaffold (Stage 12)

- **`rg init <dir>` is unchanged** (a loose starter component).
  **`rg init <name> --app`** scaffolds a real Expo app. A bare
  name (no path separators) creates the app at
  `<repoRoot>/apps/<name>` inside the Rangular checkout the CLI
  belongs to; an explicit path is used as given. Bare names may only
  use letters, digits, dot, underscore and hyphen (`.` and `..` are
  refused with `CLI_INIT_UNSAFE`); a non-empty target is refused.
- **The app resolves the repo's packages** through `file:` dependency
  specifiers in its `package.json`, computed relative from the app
  directory to the checkout's `packages/ui` and `packages/runtime`,
  and its `metro.config.js` is the standard monorepo config
  (`watchFolders` on the repo root, `nodeModulesPaths` for both
  roots), so the app always builds against the checkout it was
  scaffolded from.
- **The pins are the Expo SDK 58 set**: `expo ~58.0.0`,
  `react 19.3.0`, `react-native 0.88.1`, `react-native-svg 15.16.0`,
  `expo-image-picker ~58.0.10`, `expo-document-picker ~58.0.5`,
  `babel-preset-expo ~58.0.0` (dev). The two picker packages are in
  the set because they are required dependencies of any app built
  on `@rangular-framework/ui`: `RgFilePicker` names both in literal requires
  and Metro resolves those at bundle time. They were chosen for mutual
  compatibility from the SDK's published set, not installed or
  device-verified from the build environment. The set moved from
  SDK 54 to SDK 58 on 2026-11-12 because the store build of Expo Go
  supports SDK 58 only and refused an SDK 54 app.
- **The starter is compiled at scaffold time**: `src/app.component.ts`
  and its template are the usual starter source, and `src/AppRoot.tsx`
  is the real compiler output for it, generated during `init`, not a
  stored sample. `App.tsx` renders `AppRoot`. After editing the
  component, recompile it with `rg build` (or `watch`) from the
  app folder, as the app README spells out.
- **Run it**: `cd apps/<name>`, `npm install`, `npx expo start`, scan
  the QR code in Expo Go.
- **Back behaviour, stated plainly**: with routing, in-app navigation
  is complete, but the Android hardware back button is not wired to
  the Rangular navigator in this version: the compiled root module
  keeps its navigator private, so `App.tsx` cannot call `back()` on
  it, and the scaffold does not pretend otherwise. In-app back
  affordances (a button that navigates explicitly) work today.
- **What was verified**: the scaffold's structure and the starter's
  compilation are covered by the test suite, including a rebuild
  inside the scaffolded app. An actual Expo Go launch on a device was
  not run in the environment that built the scaffold; the first
  `npx expo start` on a real machine is the device proof.

## The missing pieces (Stage 14)

An audit against the Angular Material component list found ten
pieces missing; they are built now. See `examples/app-shell/`
(drawer, menu, stepper, divider) and `examples/explorer/` (select,
tree, grid list, table sorting and paging, tooltip) and their
recipe cards.

- **Menu and drawer are overlays.** `<menu [open]="x" (close)="m()">`
  and `<drawer [open]="x" (close)="m()">` follow the Stage 10 sheet
  and dialog contract exactly, including the `GEN_OVERLAY_OPEN`
  warning when `[open]` is not bound. The menu panel hangs at the
  top right and holds only `<menu-item>` rows and `<divider>`s; an
  item takes an optional `icon="..."` and a `(click)`, and choosing
  it runs the handler and then the menu's `(close)`. The drawer is
  a full height panel from the left (MatSidenav's over mode; a
  fixed side column is just a section, not a drawer).
- **Select is a control.** `<select label="City" [value]="city"
  (change)="onCity($event)">` with `<option value="nyc">New York
  </option>` declarations, the switcher's option element. The
  field shows the chosen label or the `placeholder`; a tap opens a
  bottom sheet of options with a check on the current one. Like
  every control, its `(change)` wrapper receives the value as
  `$event`. Options are static declarations; `[(ngModel)]` does
  not bind a select (ngModel is inputs only).
- **Stepper is the tabs contract in a wizard shape.** `[index]`
  in, `(change)` out, each `<step label="...">` owning its page;
  completed steps show a check. No linear mode in this version.
- **Grid list and tree are declaration groups.** `<grid-list
  cols="2">` (default 2) arranges `<grid-tile>` children in equal
  shares. `<tree>` holds `<tree-node label="...">` elements, which
  nest; a node with node children is a branch whose tap toggles
  them, `expanded` is the seed, and indentation is one step per
  depth. Misplaced declarations warn `GEN_CONTROL_NESTING`, as
  with every group since Stage 6.
- **Divider** is `<divider>`: one hairline across its container.
- **Tooltip is an attribute on the pressable hosts.**
  `tooltip="..."` on `<button>`, `<row>` or `<icon-button>` shows
  a bubble above the control on long press; in the preview the
  same text rides the browser title. Any other host warns
  `GEN_TOOLTIP_HOST` and the tooltip is dropped (the badge rule).
- **The table sorts and pages.** `<column name="age" sortable>`
  makes the header cycle ascending, descending, unsorted on tap
  (numbers numerically, text alphabetically, empties last, the
  bound array never mutated); `pageSize="5"` on `<table>` pages
  the rows and draws a pager only while they overflow one page.

## Beyond Angular (Stage 15)

A second audit listed what real apps use constantly that Angular
itself (core, Material, CDK) never shipped. All twenty items are
built, in three tour examples: `examples/feed/` (Tier 1),
`examples/forms-plus/` (Tier 2) and `examples/insights/` (Tier 3).

- **Bottom navigation is a declaration group on the tabs
  contract.** `<bottom-nav [index]="tab" (change)="onTab($event)">`
  holds `<nav-item icon="home" label="Home">` destinations; an
  item takes a `routerLink` or its own `(click)`, and a `badge`
  (the badge's fourth host). The screen lifts the bar out of the
  scrolling content and pins it under the screen. Misplaced
  declarations warn `GEN_CONTROL_NESTING`.
- **Refresh and infinite scroll are scroller events, not tags.**
  `<screen>` and `<list>` take `[refreshing]="busy"`,
  `(refresh)="reload()"` and `(endReached)="loadMore()"`. The app
  wires React Native's RefreshControl and fires end reached once
  per approach (again only after the content grows). The preview
  cannot pull or scroll to an end: a true flag paints the spinner
  row, and small documented cues fire the two events, the slider
  tick pattern.
- **Skeleton is a placeholder with a shape.** `<skeleton
  shape="line">`, `shape="block"` with `height`, `shape="circle"`
  with `size`, pulsing on the surface variant colour; compose it
  where content will sit and swap with `*ngIf`.
- **Swipe actions are declarations inside the row.**
  `<row-action icon="delete" color="error" (click)="remove()">`
  inside `<row>` reveals behind it on a horizontal swipe in the
  app (a plain timing settle, the house motion rule) and from a
  reveal handle in the preview; choosing one runs it and closes
  the row. A `<row-action>` outside a row warns.
- **The picker emits file info.** `<file-picker kind="image"
  (change)="onFiles($event)">` (or `kind="file"`, `multiple`)
  emits an array of `{ name, uri, size, type }`; cancelling emits
  nothing. App side requirement: both Expo picker modules
  (expo-image-picker, expo-document-picker) are required
  dependencies of any app using `@rangular-framework/ui`, because Metro
  resolves the picker's literal requires when the app bundles, so
  an app without either package does not bundle at all. The
  scaffold writes both into the app's `package.json`; a hand
  vendored app adds both itself. Expo Go carries both.
- **The mask is an attribute on input.** `mask="(999) 999-9999"`
  with `9` a digit slot, `A` a letter slot, `*` any character and
  literals that appear only once the next slot is filled. The
  masked string is the model value; there is no raw channel.
- **Rating, OTP and colour picker are plain controls.** Rating:
  a number in and out, `max` default 5, icon set stars, no half
  stars. OTP: one digit string across `length` boxes, 4 to 8
  (a static length outside warns `GEN_OTP_LENGTH`); the class
  checks completeness by length. Colour picker: a hex string in
  and out, a swatch sheet over the shared data palette plus one
  custom hex row.
- **Carousel is the stepper contract as pages.** Projected
  children are pages, `[index]` in, `(change)` out, dots under.
  In the preview, dots and chevrons page it.
- **Calendar is a month view, not a picker.** `<calendar
  [value]="day" (change)="onDay($event)">` renders in the screen
  and carries the selected day as an ISO string. It is a
  different component from the wheel `<datetime-picker>` on
  purpose: browsing days here, choosing a moment there.
- **Timeline, avatars, empty state are display declarations.**
  `<timeline>` of `<timeline-item title time>` on a rail; `<avatar
  text="A B">` draws initials (first letters of two words) or a
  `src` image, and `<avatar-group max="3">` overlaps with a +N
  overflow; `<empty-state icon title text>` projects its action.
- **Charts share one small engine.** `<chart type="bar|line|pie"
  [data]="points">` where points are `{ label, value }` (a point
  may carry `color`); any other static type is `GEN_CHART_TYPE`,
  an error. Scope: one series, no axes, no animation; bar and pie
  read negatives as 0. The app draws with react-native-svg, the
  previews with inline SVG, from the same shape model.
- **The editor's value is marked-up text.** `<editor>` has a
  Bold, Italic and List toolbar acting on the selection; bold is
  double star, italic single star, a list line starts with a dash
  and a space. Scope limit, plainly: a marked-up text field with
  helpers, not a WYSIWYG engine; the stored value is the marked
  text.
- **Image declares its size, and the lightbox is an overlay.**
  `<image src width height resize="cover">`; the doctor enforces
  the declared size (`DOC_IMG_SIZE`). `<lightbox [open] (close)
  src>` follows the sheet contract, children as caption; a photo
  normally opens it from its own `(click)`. Pinch zoom is the iOS
  scroll view's; Android pinch zoom is not in this version.
- **Masonry is a grid-list mode.** `mode="masonry"` keeps the
  tag, tiles and `cols`; tiles deal into column stacks in the
  app and CSS columns in the preview.
- **Breadcrumbs close the list, deliberately last.** `<crumb>`
  declarations join with chevron icons; the last crumb is the
  current page and not a link. On a phone the back chevron does
  most of this job, which is why the audit ranked it last.

## The tutorial round (2026-11-13)

Three pieces the Rangular Tutorial app asked for, built in the
framework first so the app only consumes them.

- **Centered app bar title.** `<appbar titleAlign="center">`
  switches the bar to the standard three zone layout: a fixed
  width left zone (28, the avatar's width), the title in a flex
  middle zone with centered text, and a balancing right zone.
  The title therefore sits at the true centre of the bar even
  when a menu icon sits at the left. Without `titleAlign` (or
  with `"start"`) the bar renders exactly as before; the search
  text centers too when a search string is shown. The catalog
  records the new `titleAlign` prop on `RgAppbar`.

- **The code block.** `<code>` compiles to `RgCode`: projected
  text on the `codeSurface` token in the `codeText` colour, the
  platform monospace face (Menlo on iOS, the system monospace on
  Android), on-scale padding inside a medium radius surface. The
  two tokens are identical in light and dark on purpose: an
  editor surface stays dark. A line is one line: long lines
  scroll horizontally inside the block in the app (a horizontal
  ScrollView) and in the previews (`white-space: pre` with
  overflow-x auto). Like the other text blocks it carries its
  content as projected text and interpolation works inside it,
  so a lesson binds a sample with `{{ lesson.code }}`; a literal
  sample written in a template must avoid a raw `<` or `{{`,
  which are markup and interpolation to the parser. The
  `code-block` example is its recipe card.

- **The toast.** The SnackBar's default look is now the toast
  Bigyan specified: a translucent black card at bottom centre,
  dark in both themes. The `toastSurface` token carries its own
  85 percent alpha (`#000000d9`); `toastText` and `toastAction`
  are chosen to read on near black. The service API did not
  change: `open(message, actionLabel?, durationMs?)`, `onAction`.
  Grain: the HTML previews draw a real subtle noise, an inline
  SVG feTurbulence texture over the surface, plus a hairline
  light border. React Native has no texture asset for that
  grain, so the app approximates it honestly: a white sheen
  layer at five percent over the translucent black, under the
  same hairline border. The two are close, not identical, and
  this note is the record of that.

## The gradient shell round (2026-11-17)

The shell surface the Rangular Tutorial redesign asked for, built
in the framework first so the app only consumes it. The design
reference is the Google app frame: a top bar that stays while the
content scrolls, search inside that bar, and section titles that
stand out from their rows.

- **The brand gradient.** Three new colour roles, `gradientFrom`
  `#3b0764`, `gradientVia` `#7c3aed` and `gradientTo` `#db2777`,
  carry the one brand gradient; the same stops in both themes, a
  brand band does not change with the theme. `<gradient>` compiles
  to `RgGradient`: a rounded surface the gradient fills (one
  shared SVG fill layer, also used by the gradient app bar and
  the section header bar), whose children read as on-primary
  content through a derived theme that swaps the text roles to
  the on-primary colour.

- **The gradient pinned app bar.** `<appbar tone="gradient">`
  turns the pill into a full width gradient band with light
  foreground. `pin` lifts the bar out of the scroll: the bar
  registers itself into the nearest screen's header slot and the
  screen draws it above its ScrollView, so title and search stay
  while content scrolls under them. Registration is keyed by the
  bar's props and its children's scalar values, so a pinned bar
  follows a search field's typed text without re-render loops.
  An app bar with no screen above it, or without `pin`, renders
  in place exactly as before. Children projected into the bar
  render under the title row; before this round bar children were
  dropped silently, which the golden rule forbids. Two new slots:
  `back` puts a chevron at the left wired to `(back)`, and
  `actionIcon` names a trailing icon button wired to `(action)`;
  each takes its slot over the menu and the avatar. `(back)` and
  `(action)` are known events from this round.

- **The search pill.** `<input variant="search">` draws the field
  as a full radius surface with the search icon inside at the
  left and no border of its own, the shape search takes in the
  Google apps. The value contract is unchanged: value in,
  onChangeText out, `[(ngModel)]` as usual.

- **Row avatar text and row action.** `avatarText` overrides the
  row avatar circle's letter with the text the app passes (a
  lesson number, a count; two characters at most). `actionIcon`
  names a trailing icon button on the row, wired to `(action)`,
  beside the row's own press: a bookmark on a lesson row. The
  bookmark and bookmark-outline icons join the curated set (29
  names) as the saved and unsaved states of that action; the app
  binds the name, the icon carries the state.

- **Labelled sections.** A `<section>` with a `label` opens with
  a header row: a short gradient bar, the label in the title
  step at semibold weight, and an optional `meta` line at the
  right (a count, a range). A section without a label renders
  exactly as before.

- **Preview grain.** The browser preview paints a pinned bar
  with `position: sticky` inside its scroll frame; the app pins
  through the header slot above the ScrollView. Close, not
  identical, and this note is the record. The `gradient-shell`
  example is the recipe card for the whole round.

## The Gmail light round (2026-11-17)

Bigyan's phone verdict on the gradient shell: try the Gmail light
design instead, and fix four behaviours he hit on the device. The
gradient shell stays in the catalog; this round adds the light
shell beside it and the behaviour fixes under both.

- App bar `tone="plain"`: a full width white band with a soft
  shadow. A bar with no title, no search text and no slot content
  renders no title row at all, so a bar whose whole face is a
  projected child (the Gmail search pill) has no empty band above
  the child. The pinned bar also registers into the screen's
  header slot in a layout effect, so it is present on the first
  painted frame; with a passive effect the content painted one
  frame without its bar and then jumped, the jitter seen on back
  navigation.
- The search pill grew the Gmail furniture: `leadingIcon` names
  an icon that replaces the search glyph, wired to `(leading)`;
  `avatarText` draws the round initial at the pill's right. The
  pill fill is the surfaceVariant role by default (the Gmail
  grey); `pillTone="white"` keeps it white, the form for a pill
  sitting in a gradient bar.
- Section headers have three faces now: an `icon` opens the
  header with a round solid chip holding the icon; `plain` opens
  with the bare title and meta; with neither, the gradient bar
  from the gradient shell round remains the default.
- A row takes `icon` for a leading icon in the avatar's place
  (the drawer row shape), and `avatarTone="varied"` gives the
  avatar tile a pastel pair from AVATAR_TONES in palette.ts,
  chosen by a stable hash of its label, the Gmail list look.
- The keyboard contract: RgScreen wraps its scroll area in a
  KeyboardAvoidingView (padding on iOS, height on Android) and
  the ScrollView carries keyboardShouldPersistTaps="handled" and
  a platform keyboardDismissMode. When a field takes focus, the
  screen's scroller rests the field's bottom 20px above the
  keyboard's top (the scroll context and useKeyboardLift in
  primitives.tsx; lessons QA round, 2026-11-19). Every text
  field (both input forms and the editor) carries
  returnKeyType="done" and dismisses on submit. Fields carry no
  input accessory: an iOS Done accessory added in the Gmail
  light round was removed at Bigyan's word on 2026-11-19,
  because the stock keyboard's own return key already
  dismisses. The browser preview has no software keyboard and
  draws none of this; that is the stated grain, the behaviour
  is native-only.
- Route scroll: in a routed app the generated root keys the
  entry `<screen>` by the concrete path, so each navigation
  remounts the screen and every route opens at the top. Before
  this, all routes shared one ScrollView and a lesson opened
  from a scrolled list landed mid-page.
- Switch `haptic`: an opt-in attribute on the one switch. With
  it, a toggle answers with a light selection haptic through
  expo-haptics, required lazily inside the press, the file
  picker pattern; without it the switch is silent, exactly as
  before. expo-haptics (~58.0.8) is therefore a required
  dependency of apps on @rangular-framework/ui and the scaffold writes
  it. The preview answers with navigator.vibrate where the
  browser offers it.
- The icon set is 30: `code` joins, the angle brackets mark of
  the tutorial's drawer header.
- Worked example: examples/gmail-shell, one screen proving the
  plain bar with its pill, the chip and plain section headers,
  varied row tiles, an icon row, and the two switches, one with
  `haptic` and one without.

## The spacing rule round (2026-11-17)

One rule for how close components may sit, taken from Material
Design, the system Angular Material implements, and now owned by
the framework so no author separates siblings by hand:

- **Two touch targets never touch.** The floor between any two
  controls is `spacing.sm` (8), Material's minimum distance
  between targets. Related buttons in a row (an `<actions>` row,
  a dialog's buttons) sit exactly at that floor.
- **Stacked blocks and controls sit at the one rhythm gap,**
  `spacing.md` (12), the same gap screens, sections and cards
  have always stacked with.
- **The container owns the gap.** Every container that stacks
  children carries the rhythm gap itself: screen, section, card,
  form, dialog, sheet, drawer, accordion panel, tab panel and
  step page. A block never relies on its children's margins to
  separate them. This round found the holes by measuring a real
  app: `<form>` compiled to a bare `View`, so a form's Save and
  Clear buttons stacked at gap 0; the tab panel, the stepper's
  step page, the dialog, the sheet, the drawer and the accordion
  panel body had the same hole. All six are closed, in the
  primitives, in codegen (form now compiles to `RgSection`) and
  in both preview renderers.
- **One control may touch inside itself.** Composites that read
  as a single control are exempt inside their own bounds: tab
  bars, calendar grids, swipe-action trays, segmented switchers,
  and full-width choice rows (radio, checkbox, switch), whose
  glyphs are separated by the row's own padding. The exemption
  ends at the composite's edge: a switcher or a choice group
  still keeps the rhythm gap from its neighbours.

The audit method is part of the rule: the tutorial app was walked
in a browser in phone mode and the rendered gap between every
pair of neighbouring controls was measured. Anything under 8
that is not a composite above is a framework bug until proved
otherwise.

## The overlay slot round (2026-11-17)

Found on a phone, invisible on the web: a dialog declared inside a screen's scrollable content anchors its absolute root to the tall content box on native, so the backdrop dims the page and the panel centers far below the fold; a bottom sheet lands at the end of the page the same way. The web renderer anchors to the visible box, which is why every web gate passed while the phone showed a dim page with no dialog. The fix follows the pinned header pattern: RgScreen lends an overlay slot above its ScrollView, and RgDialog, RgSheet, RgDrawer and RgLightbox register their tree there while open (keyed on the tree's content, so registration cannot loop) and render nothing in place. The datetime picker rides on the sheet, so its wheels are covered; the snackbar already mounts outside the screen and is untouched. Outside a screen there is no slot and an overlay renders in place, as before. The same day, at his word, the keyboard accessory lost its bar: the iOS Done paints no strip of its own and sits alone at the keyboard's top right.

## The Option A round (2026-11-17, version 0.1.3)

The tutorial redesign round, picked from mockups after a phone critique of the Gmail light build: the title sat below the search bar, a fake account initial sat in the bar for a user who never signed in, a seam ran between the status area and the bar, the drawer started below the bar with no current place marked, and the menu at the pill's left end missed half its taps because its touch box was only the glyph. The framework answers, all in the shell family: an app bar tone `tint` (a flat surfaceVariant band) whose pinned bar lends its background colour to the screen, which paints its safe area strip with it, so the status area and the bar read as one surface; a second right side bar action (`actionIcon2`, `(action2)`); a `[progress]` percent line at the bar's bottom edge; a `fade` attribute on `<screen>` that melts the scrolling content out under the pinned bar as a smooth gradient of the bar's colour (first built as strips; the phone showed banding, and the gradient replaced them in 0.1.5); a bottom slot in RgScreen, so a `<bottom-nav>` declared in a routed page pins under the scroll like a direct child, its selected icon in a primary container pill; a `[selected]` pill on `<row>` for the drawer's current place; the search pill's leading button grown to a full 44px touch box; the app bar's own icon buttons grown to a 40px touch box (the phone gate found them at exactly the 24px glyph); named avatar tones on `<row>` (`avatarTone="green"` and family, beside `varied`); and a `chart` icon (31 in the set). The tutorial rebuild on top of it (entry, path home, saved and progress tabs, about, lesson) is the round's integration test, and `examples/path-shell` is its recipe card. Preview grain: the preview is one static screen, so the fade veil and the two slots are runtime placement only; the tint band, the progress line, the second action and the selected pills paint in both preview renderers.

## The react-native import fix (2026-11-17, version 0.1.4)

Found by the tutorial app acting as the integration test: its progress service needed `Platform` from `react-native` to choose SQLite on device and AsyncStorage on web, and the compiler silently dropped the import while emitting its uses, which would have thrown a ReferenceError at runtime. Imports of `react` and `react-native` in a contributing file (entry component, child component, root service, custom pipe) now carry into the generated module like any other bare specifier. A carried name the module already defines, including one of codegen's own react or react-native imports, drops with a `GEN_IMPORT_COLLISION` warning and a TODO note, so a binding is never duplicated. The `@angular/*` and `@rangular-framework/*` specifiers stay consumed and are never carried. Regression tests live in `tests/imports.test.ts`.

## The phone polish round (2026-11-18, version 0.1.5)

The tutorial app's first SQLite build ran on a real phone and found three native faults no web gate could see. The app bar's two actions travel into the bar's right zone as one array, and both now carry keys from birth (`key="action"`, `key="action2"`); React's unique key warning named the array on device. The scroll fade veil, six hard strips of the bar's colour, banded visibly over saturated content; it is now one SVG linear gradient of the same colour (react-native-svg was already a dependency), with the scroll-driven opacity unchanged. And the bottom bar sat above the safe area strip in the page background with its level2 shadow pointing down onto it, a visible seam: the bar's shadow now points up, and when a bottom bar is pinned the screen paints the strip behind it in the bar's surface colour. Guards live in `tests/native-polish.test.ts`. The same phone run hardened the tutorial's own save pattern (saves serialize, inserts are OR REPLACE, every promise carries a rejection handler); that part is the app's, not the framework's, and lives in the tutorial repo.

## The lessons QA round (2026-11-19, version 0.3.1)

Bigyan walked the tutorial's lessons on his phone and reported; each item landed the same day.

- A field low on the screen stayed under the keyboard when typing started. KeyboardAvoidingView alone resizes the screen but never scrolls the focused field into place. RgScreen now lends its ScrollView ref through a context, and RgInput and RgEditor ask the scroll responder on focus to rest the field's bottom 20px above the keyboard's top (his measure), after a short wait for the keyboard frame to land.
- The iOS Done accessory is gone, at his word: the stock keyboard's own return key dismisses, and every field already carries returnKeyType done with dismiss on submit. The keyboard contract above states the new truth.
- The toast rested 32px above the bottom edge, inside the floating bottom bar's space. The snackbar host now rests at 100px (his measure), and the native grain approximation became a soft white gradient over the card, strongest at the top edge, closer to the noise the previews draw.
- Tutorial side, same round: lesson code cards show the bare minimum complete code with lines broken for visibility (the standing rule, recorded in the tutorial round notes), and a lesson's best practice may now carry real code: an optional tipCode field renders as a code block inside the tip card, in the same format as the lesson's Code block. Lesson 6's best practice is the first user, with the spread add and the fat-arrow filter written out.

## The keyboard lift, calculated (2026-11-19, version 0.3.2)

The 0.3.1 lift failed on Bigyan's phone: a slight scroll, and the field stayed hidden. Its fault was timing, not intent: it waited a fixed 120ms and asked the legacy scroll responder to measure, before the keyboard frame was final, while KeyboardAvoidingView was still resizing the scroll box, and a field near the end of the content could run out of scrollable room entirely. The responder call is gone. RgScreen now owns the whole calculation. It learns the keyboard's final height from the keyboard events (keyboardWillShow and keyboardWillChangeFrame on iOS, keyboardDidShow on Android), keeps the current scroll offset from its own scroll events, and when a field reports focus through the scroll context, it measures that field in the window with measureInWindow. The overlap is the field's bottom minus the resting line (window height minus keyboard height minus the same 20px gap), and the screen scrolls to its current offset plus exactly that overlap. While the keyboard is up, the content container carries a bottom inset equal to the keyboard height, so the scroll always has room to land. The lift runs twice per keyboard frame, once as the layout lands and once after it settles; the second pass measures again and corrects any remainder, so a clamped first scroll cannot leave the field short. Fields that gain focus while the keyboard is already up lift at once from the known frame. The shell test pins the new contract and the absence of the old call.

## The no-silent-drops wave (2026-11-18, version 0.3.0)

Four ways the compiler used to lose source or emit broken code without a word, each closed the same way: a working translation where one exists, a coded error where none does.

- A handler expression using `$event` on a foreign tag (and on the generic event path of framework blocks) was wrapped as `() => save($event)`, leaving `$event` unbound in the generated code. The wrapper now binds it, `($event) => save($event)`, the same shape the control contracts already used. Bare method references are unchanged.
- A TypeScript syntax error in a class file was invisible: the parser recovered and the file read as a smaller valid file, so a malformed field initializer surfaced, if at all, as a misleading GEN_FIELD warning. Parse errors are now `CLS_PARSE` errors carrying the file, line and column TypeScript reported.
- A component method named like a generated state setter (`setMinutes` beside a `minutes` field, the capstone's old wound, renamed by hand at the time) declared the name twice in the generated function. It is now a `GEN_SETTER_COLLISION` error whose fix is the rename. The wave's own gate caught three test fixtures (setCode, setBrand, setNotes) that had been generating exactly this collision unnoticed.
- A relative import of a file holding no classes was dropped while its uses were emitted, the last of the silent import drops. A name imported from such a file and used as a value is now a `GEN_IMPORT_CLASSLESS` error; a name used only as a type stays quiet, so models files keep working.

Regression tests live in `tests/silent-drops.test.ts`. The catalog gained the three new codes (71 in total).

## The logo round (2026-11-18)

The project has a logo: the Split Shield, picked by Bigyan from the mockup page (direction 09, his own idea). One shield split in two: the top half is Angular red with a white R, the bottom half is dark with the cyan React atom. The master artwork is assets/logo.svg in this repo; assets/logo.png is its 512 px render for the README header (npm does not render SVG in READMEs, GitHub does, so the README uses the PNG and both files carry the same drawing).

In code the mark is a brand mark, not an icon: `BRAND_MARKS` in packages/ui/src/icons.ts holds its SVG markup as the single source, next to ICON_PATHS. `<icon name="logo">` validates like any icon name (ICON_NAMES includes brand names, and the catalog lists it), but it draws in its own colours: the `color` attribute does not recolour it, and any size passes through unsnapped and unwarned, because a brand mark is a picture, sized like an image, while the 20/24/28 scale governs glyphs. RgIcon renders it with react-native-svg's SvgXml; the preview's static paint and interactive runtime draw the same markup, so the preview stays a promise. The icons example grid shows it with its label, like every other name.

## The npm packaging round (2026-11-18, version 0.2.0)

The packages are now publish-shaped, proven with real tarballs but not yet published. Each package builds itself: compiler, runtime and CLI each carry a tsconfig.publish.json and a build script (the root test script runs them before the suite), and their package.json main and bin fields point at compiled output under dist. The UI package is the exception by design: it ships its source (main stays src/primitives.tsx) because only Metro and Babel ever consume it, the way React Native libraries normally ship. The CLI tarball bundles the compiler (its relative imports resolve inside the package exactly as in the checkout) and declares typescript as its one runtime dependency; the compiler is also published standalone for programmatic use, with the UI token and icon tables compiled into its own dist the same way. All four packages carry publishConfig access public and a repository field naming the rangular-framework repo.

The scaffold now has two modes, decided by where the CLI itself lives. In the checkout (the resolved root holds the framework's own packages/ui), behaviour is unchanged: bare names land in the repo's apps folder and apps bind to the checkout through file: specifiers. Installed from npm, the same command is published mode: a bare name creates the app in the current directory, package.json depends on @rangular-framework/ui and @rangular-framework/runtime by caret range on the CLI's own version, metro.config.js is the standard Expo config, and the README teaches the rg commands. tests/publish.test.ts simulates the installed layout and pins the published mode; the checkout mode stays pinned by the Stage 12 tests.

## The rename round (2026-11-18, version 0.2.0)

The project is renamed to rangular-framework, everywhere, because the bare name `rangular` was already taken on npm (an abandoned 2014 AngularJS module) and the rangular-* family is owned by someone else. The packages are now `@rangular-framework/cli`, `@rangular-framework/compiler`, `@rangular-framework/runtime` and `@rangular-framework/ui`; generated code imports the new scope, so this is a breaking change and takes the 0.2.0 bump. The CLI package installs two commands: `rangular-framework` (canonical) and `rg` (the short everyday form, so `rg new` works the way `ng new` does; the scaffold subcommand is still `init`, as in `rg init <name> --app`). The GitHub repos move to bigyanchap/rangular-framework and bigyanchap/rangular-framework-tutorial. Prose keeps the standing form: "the Rangular framework". Nothing else about the language, the catalog or the generated shape changes.

## The wash and buttons round (2026-11-18, version 0.1.9)

From the tutorial's button audit and the gradient pick (Option A: the header wash on every page top). (1) The search pill clears itself: when a `variant="search"` field holds text, a close tap inside the pill's right edge empties it through the same value contract (`onChangeText('')`) and keeps focus, labelled "Clear search"; the preview mirrors it. Apps no longer need a separate Clear button under a search field. (2) A `<card>` with a `(click)` is a Pressable now: the whole card is the tap target, the Material behaviour; a card without one stays a plain surface, and the preview wires the click the same way. Both guards live in `tests/native-polish.test.ts`. The same rule reached `<section>` in the device keys round (2026-11-20): the compiler already wired a section `(click)` to `onPress`, but `RgSection` dropped it silently, so the tutorial's device key faces, built as sections, rendered and never pressed. A section with a `(click)` is a Pressable now, exactly like the card; a section without one stays a plain view. Guard in `tests/native-polish.test.ts`.

## The steady shell round (2026-11-18, version 0.1.8)

Two changes from the tutorial's phone use. (1) The entry screen no longer remounts per route. The compiler used to key the root `<screen>` by the concrete path so each route opened at the top; on a phone that rebuilt the whole shell (safe area, scroll view, both slots) on every tab switch, which read as jitter. The screen now persists, the generated root passes the path as `scrollKey`, and `RgScreen` scrolls to the top in a layout effect when the key changes, resetting the fade veil with it. Pages inside the outlet still remount by their own keys. (2) `<bottom-nav>` takes the `haptic` attribute, the same opt-in `<switch>` has: a switch to a different tab fires the shared selection haptic (`fireSelectionHaptic`, expo-haptics, lazily required); re-tapping the current tab stays silent. The browser preview mirrors it with a short vibrate. Guards in `tests/native-polish.test.ts` and `tests/shell.test.ts`. (3) The bottom melt, added the same day from the reference screenshots: when a bottom bar is pinned, `RgScreen` draws the mirror of the top veil at the bottom of the scroll box, a 24px gradient into the bar's surface colour, so scrolling content dissolves into the bar instead of being sliced by its top edge; the scroll box's bottom padding equals the melt's height, so the last block at rest is never washed. The tutorial's lesson pages dropped their boxed cards the same day (the intro is a plain section, the demo cards are transparent and borderless through a class): that part is the app's, not the framework's.

## The seamless round (2026-11-18, version 0.1.7)

Four changes from the tutorial's phone retest, one design language: surfaces melt, they do not end at seams. (1) Hairlines live between rows, never under the last one: `<list>` marks its last row child and the row drops its bottom border, so a list no longer closes with a floating line over the next section. Rows outside a list keep their hairline. (2) The bottom navigation bar carries no shadow and no elevation at all: a shadow blurs past the bar's edges in every direction, and the spill below the bar printed a grey seam on the safe area strip however the offset pointed. The bar's top hairline is its separation, and the screen still paints under it in the bar's surface colour. (3) The theme gained a soft wash, three tokens (`washFrom`, `washVia`, `washTo`): a pinned `tone="tint"` bar asks its screen to draw the wash as one layer behind the status area and the bar, a vertical gradient that starts a breath deeper than the page, lands on it, and fades to nothing, so the whole header zone is one continuous melt with no edge at the bar's bottom. The bar itself turns transparent in the shell and lends `washFrom` as its chrome for the fade veil. (4) The filled `<button>` wears a vertical gradient, `primary` into the new `primaryDeep` token, lit from above. The brand gradient (`gradientFrom` and family) is unchanged and still loud on purpose; the wash is the quiet one. The browser preview mirrors all four (CSS gradients and a last-child rule). Guards in `tests/native-polish.test.ts`. The same retest removed the tutorial Home list's `[selected]` highlight on the next lesson: that part is the app's, not the framework's.

## The search pill round (2026-11-18, version 0.1.6)

One framework fix from the tutorial's phone retest: the search variant of `<input>` drew its pill as a plain row holding the field, so taps on the pill's padding and its icon zone landed on dead views and the bar felt rarely clickable on a phone. The pill row is a Pressable now and focuses the field wherever it is tapped; the field keeps its own taps, and a leading action keeps its own button. Guard in `tests/native-polish.test.ts`. The same retest slimmed the tutorial's Home bar to menu and title only: its search and saved actions duplicated the in-content search field and the Saved tab, and the duplicated search section went with them. That part is the app's, not the framework's.

## Child components (Stage 3, M5)

- **Resolution is by import.** The compiler follows the entry component's
  relative imports, transitively. Every imported `@Component` class is a
  known child component, keyed by its `selector`; a template tag matching
  a selector compiles to that component's generated function. All
  components of a compilation are emitted into ONE generated `.tsx`
  (children as exported functions above the entry's default export).
  Unknown dashed tags keep the old behaviour (passed through untouched).
- **Import cycles** are legal input: classes register before recursing,
  so everything on the cycle still resolves, and the compiler reports
  `CMP_IMPORT_CYCLE` (warning). A duplicated selector across two
  different classes is a `CMP_DUP_SELECTOR` error; an unresolvable
  relative import is a `CMP_IMPORT_UNRESOLVED` error.
- **Inputs:** `[name]="expr"` passes the evaluated expression, a plain
  attribute passes a string, a bare attribute passes `true`. If the
  parent omits an input, the child's literal initializer is the default,
  visible in the generated signature (`{ quote = '' }`). Content
  projection is wired (Stage 12): children written inside a child tag
  render where the child's template places `<ng-content></ng-content>`,
  still evaluated in the parent's scope. See the Content projection
  section below.
- **Outputs:** the field must be initialised with `new EventEmitter<T>()`.
  `this.saved.emit(x)` inside the child → `onSaved?.(x)` in generated
  code (prop name = `on` + Capitalised field name; unbound outputs are
  no-ops). In the parent, `(saved)="handler($event)"` receives the
  emitted value as `$event`; a bare `(saved)="handler"` passes the
  method itself.
- **Preview:** children render recursively, inputs evaluated in the
  parent scope, instances persist across re-renders (keyed by template
  position), emits run the parent handler and re-render.

## Services, dependency injection and lifecycle (Stage 3, M6)

- **Services are real classes.** `@Injectable({ providedIn: 'root' })`
  compiles to a class extending the runtime's `ReactiveService`, emitted
  into the same generated file. Literal fields stay fields; methods are
  translated with the Stage 2 subset, except `this.` survives (a service
  is a class, not a function component).
- **Reactivity contract:** after every assignment to a service field
  inside a service method, the generated code calls `this.__notify()`.
  Mutating an item in place (`this.mails.forEach(m => m.unread = false)`)
  assigns no field, emits no notify, and re-renders nothing, reassign
  the field (`this.mails = this.mails.map(...)`).
- **The singleton:** one module-level container in the generated file
  registers every root service, dependency-ordered (dependencies first;
  a cycle is a `DI_CYCLE` error). Every component that injects a service
  gets the same instance and subscribes to it with
  `useSyncExternalStore` over its version counter, so a notify
  re-renders all of them.
- **Injection form:** constructor *parameter properties* only,
  `constructor(private mail: MailService)`. The token is the declared
  type name; it must be a root service in the compilation or
  `HttpClient`, otherwise `DI_UNKNOWN_TOKEN` (error, with fix). Services
  may inject services the same way. Component constructor bodies are not
  translated.
- **Lifecycle:** `ngOnInit()` → called inside `useEffect(..., [])`;
  `ngOnDestroy()` → that effect's cleanup. A hook that assigns fields
  makes those fields state, as for any method. In the preview, ngOnInit
  runs once when a component instance is created; the static first paint
  shows pre-init state.

## Third-party imports

- **Bare module imports are carried.** An import of a third-party
  module (a specifier that is not relative and not a framework
  specifier) in a file that contributes classes to the generated
  module (the entry component's file, a child component's file, a
  `providedIn: 'root'` service's file, a `@Pipe` file) is carried
  into the generated module's import block, specifier and bindings
  as written: default, named (aliases kept), namespace, type-only
  (as `import type`, or as `type` entries when the same specifier
  also carries values) and side-effect imports all carry. The same
  binding declared by two contributing files is carried once.
  Generated code may then use the imported names freely, e.g. a
  service calling `AsyncStorage.setItem(...)` from
  `@react-native-async-storage/async-storage`. Before this round
  such imports were silently dropped while their uses were emitted,
  which left the generated app throwing a ReferenceError at runtime.
- **Name collisions drop with a warning.** When a carried binding's
  local name is already taken in the generated module (the same
  name imported from a different module, or a name the module
  itself defines: a generated class or component function, a
  module-level value, or one of its framework imports), the later
  binding is dropped with a `GEN_IMPORT_COLLISION` warning and a
  TODO note in the generated file; the first binding of the name
  wins. Give the import a different local name to carry both.
- **`import A = require('x')` cannot be carried.** The generated
  module is an ES module; the declaration is dropped with a
  `CMP_IMPORT_FORM` warning. Write an ES module import instead.
- **Framework and relative imports.** `@angular/*` and
  `@rangular-framework/*` names are consumed semantically and never
  emitted. `react` and `react-native` imports in a contributing
  file carry like any other bare specifier (fix, 2026-11-17,
  version 0.1.4: a `Platform` import in a service used to drop
  silently while its uses were emitted, leaving the name unbound
  at runtime); a carried name the generated module already
  defines, including one of codegen's own react or react-native
  imports, drops with `GEN_IMPORT_COLLISION`, so a binding can
  never be duplicated. Relative imports are followed and their
  classes inlined, as before. One standing limit of that rule:
  only classes resolve through relative imports, so a relative
  import of a file holding no classes (a plain exported const,
  say) is not inlined; since the no-silent-drops wave
  (2026-11-18) a name imported from such a file and used as a
  value is a `GEN_IMPORT_CLASSLESS` error, while a name used
  only as a type stays quiet.

## HttpClient (Stage 3, M6)

- Inject it like a service: `constructor(private http: HttpClient)`
  (import from `@angular/common/http`, as in Angular). It is registered
  in the generated container under its class token.
- The runtime client wraps `fetch` and parses responses as JSON.
  `get(url)` returns an **Observable-lite**: `{ subscribe(next?, error?) }`
  returning `{ unsubscribe() }`. No operators, no `pipe`, no retry,
  anything richer is not supported yet.
- **The one supported component-side shape** is:
  `this.http.get(url).subscribe((data) => { this.field = data; });`,
  a block-bodied arrow whose statements assign component fields (which
  become state as usual). An expression-bodied assignment
  (`subscribe((data) => this.field = data)`) cannot become a setter call
  and degrades to a `METHOD_UNSUPPORTED` warning instead of wrong code.
- In the preview, `HttpClient` is a stub: `get()` returns an Observable
  that never emits. Previews never touch the network.

## Theming, tokens and snapping (Stage 4)

- **One token file, both modes.** `@rangular-framework/ui` tokens are the only
  source of visual values: spacing 4/8/12/16/20/24/32, radius
  8/12/16/20/full, a type scale (caption 12, body 14, bodyLarge 16,
  label 14 w600, title 20, heading 24, display 32, each with a fixed
  line height), three elevation presets, and the full colour role set.
  Every colour role exists in light AND dark (`themes.light` /
  `themes.dark`); the old names are aliases (`text` = `onSurface`,
  `textMuted` = `onSurfaceVariant`, `danger` = `error`).
- **Choosing a theme is one attribute.** `<screen theme="dark">`
  compiles to `<RgScreen theme="dark">` and themes the whole subtree:
  primitives read colours from a React context (`RgThemeProvider`,
  `useRgTheme`), never from hard-coded hex (a test greps
  `primitives.tsx` for hex values and fails). No attribute means
  light. Only `<screen>` takes the attribute in this version.
- **Previews carry both palettes.** A preview starts in the theme the
  screen declares and offers a Light/Dark toggle in its chrome; the
  colours resolve through CSS variables, so the toggle swaps the
  palette with no re-render.
- **CSS values snap to the scales.** In component `styles`, spacing
  properties (margin, padding, gap, top/left/right/bottom),
  `border-radius` and `font-size` resolve to the nearest scale value
  at compile time. Off-scale input still compiles, with the snapped
  value, plus a `STYLE_OFF_SCALE` warning whose fix names the snapped
  value: `margin-bottom: 13px` becomes 12. On-scale values and 0 pass
  silently; ties go to the lower value; colours are never snapped.
- **Toggling a class: `[class.name]="cond"`.** When the component
  styles declare `.name`, the binding compiles to a conditional entry
  in the element's generated style array (`cond ? styles.name :
  undefined`), after the static classes from the plain `class`
  attribute; an attribute directive's folded style still merges last.
  Naming a class the styles do not declare, or putting the toggle on
  a block that takes no style (`<icon>`, `<column>`, `<router-outlet>`,
  `<ng-content>`), warns `GEN_CLASS_BINDING` and drops the binding.
  The whole-value and raw-value forms are not supported and warn
  instead of silently doing nothing: `[class]` and `[ngClass]`
  (`GEN_CLASS_BINDING`), `[style]`, `[style.prop]` (with or without a
  unit) and `[ngStyle]`, and static `style="..."` attributes
  (`GEN_STYLE_BINDING`).
- **Text by meaning, not by number.** `h1`/`h2`/`h3`/`p` compile to
  `RgText` at the display/heading/title/bodyLarge steps, and
  `<label>` (new in Stage 4) maps to the label step. `RgText`
  applies the step's size, line height and weight plus the theme's
  on-surface colour, so the type scale the preview shows is the
  scale the app renders. (Before the default polish pass these
  compiled to plain React Native `Text`, which ignores the variant
  prop: headings reached the phone unstyled while the preview
  showed them styled.) `<span>` stays plain `Text`: it is the
  inline element and inherits from the text block around it. See
  `examples/showcase/` and its recipe card for the whole system on
  one screen.
- **One screen grid, one rhythm (default polish pass).** `RgScreen`
  owns the layout grid: its content carries `spacing.lg` (16)
  horizontal padding, `spacing.md` (12) on top, and stacked blocks
  are separated by a 12 gap; a card stacks its children with the
  same 12 gap inside its 16 padding. Primitives carry no horizontal
  margins of their own, so the appbar pill, a card, a bare heading
  and a button all land on the same left and right edges, and a
  button inside a card spans the card's content column exactly.
  Rows carry no horizontal padding either: a row takes its inset
  from its container (screen, card, tab panel), which puts row
  text on the same grid and the hairline on the grid edges. The
  preview renderer mirrors every one of these values.
- **Containers are stacks, and the app bar is opt-in (2026-11-12,
  found by the Rangular Tutorial app).** `<section>`, `<div>` and
  `<header>` compile to `RgSection`, a column with the same 12
  rhythm gap, so a routed screen rooted in a section spaces its
  blocks exactly like a flat screen. They used to compile to a
  bare View with no gap, and routed screens rendered their cards
  attached edge to edge. The app bar draws a menu button only
  with the boolean `menu` attribute, and an avatar only when
  `avatar` text is passed: `<appbar title="Mail" menu
  avatar="M">`. It used to draw both unconditionally, a dead menu
  and a fake user taken from the title's first letter. A button
  with `variant="text"` is the quiet form, for back links and
  secondary actions: no fill, primary coloured label, left
  aligned, same 48 high target. A button's `color` names a role,
  never a paint: `primary` is the default gradient, `danger` is
  the theme error role for a destructive action, and `neutral` is
  the quiet surface variant grey for a cancelling one, with the
  `text` variant colouring only its label. A static colour outside
  the three is a `GEN_BUTTON_COLOR` error. A button sized
  exactly by a class in the component styles (a width or a
  height, the square action buttons of the tutorial's Pattern
  A demos) gets compact padding and a centred label, so the
  label can use the size it was given instead of the pill's
  wide padding, and the gradient fill follows the corner
  radius the class set: with the full pill curve the fill
  drew a circle inside a square button, and the wide padding
  left so little room that long words broke mid-word.
- **Only meaningful buttons (2026-11-12, same finding).** Back is
  an `<icon-button name="chevron-left" routerLink="/home">`: a
  48 square target, glyph at the left edge, no label, the pattern
  Google apps use. A full width labelled button for going back,
  a menu icon with no menu, an avatar with no user: none of these
  are meaningful controls, and Rangular does not draw them by
  default anymore. If an action needs words, use a button. If it
  is one clear symbol sized action, use an icon button. If it
  does nothing when tapped, do not draw it.

## Tooling (Stage 5)

The CLI is complete in v1. One line per command:

| Command | What it does |
|---|---|
| `rg build [<component.ts>] [--out <file.tsx>] [--json] [--source-map]` | Compile one component to React Native TSX; with no arguments, compile the app in the current folder: `src/app.component.ts` to `src/AppRoot.tsx` |
| `rg ast <template.html>` | Print a template AST |
| `rg preview <component.ts> --out <file.html> [--json]` | Render the interactive dev preview |
| `rg catalog [--out <dir>]` | Regenerate catalog.json and catalog.md from the code |
| `rg watch <component.ts> --out <file.tsx>` | Compile now, then recompile on every change to the component, its template or its imports; the watch set re-resolves after each compile; Ctrl+C stops cleanly |
| `rg init <dir>` | Scaffold a starter project (welcome screen, README, .gitignore); refuses a non-empty directory |
| `rg init <name> --app` | Scaffold a real Expo app (Stage 12): a bare name lands in the checkout's `apps/` folder, an explicit path is used as given; the starter component is compiled into `src/AppRoot.tsx` at scaffold time. See the Expo app scaffold section above |
| `rg doctor <component.ts> [--json]` | The polish linter below |

**Per-file diagnostics.** Every diagnostic may carry a `file`: template
diagnostics name the `.html` file, class diagnostics the `.ts` file,
style diagnostics the file holding the styles. The `--json` payloads
include it per diagnostic (the top level `file` still names the entry
component), and human output prints the file when it differs from the
entry file. For style findings in an inline `styles` array, the line
is counted within the style text itself.

**Source maps.** `build --source-map` writes `<out>.map` (source map
v3) and appends the `//# sourceMappingURL=` comment to the generated
file, only with the flag. Granularity is block level in v1: the
generated component function start maps to the class declaration, and
each top level template element's JSX start maps to the element's
line and column in the template. Per-expression maps are post-v1.

**Doctor rules.** Doctor reports findings as diagnostics with `DOC_`
codes; it never changes anything.

| Code | Severity | Rule |
|---|---|---|
| `DOC_HEX_COLOR` | warning | A hex colour literal in styles; use a colour role instead |
| `DOC_OFF_SCALE` | warning | A spacing, radius or font-size value the compiler would snap (doctor reuses the compiler's snapping logic) |
| `DOC_RAW_TEXT` | warning | Loose text directly inside `screen`, `card` or `list` instead of a text element |
| `DOC_TAP_TARGET` | error | A `(click)` element sized below 44 by 44 in its styles |
| `DOC_IMG_SIZE` | error | Reserved for an image tag; no image tag exists in the v1 tag contract, so the check is inactive |

Exit code is 1 only when an error-severity finding (or a compile
error) exists; warnings alone exit 0. One suppression exists: a CSS
comment containing `doctor: allow-hex` in a style text disables
`DOC_HEX_COLOR` for that file's styles, for deliberate brand colours
that are not Material roles (see the day-plan-row recipe card).

**Style snapshot goldens.** Each example carries a
`styles.snapshot.json`: the preview's resolved key styles per element
role for both themes, plus the example's own parsed component styles,
derived from the same token data the preview renders from. A test
regenerates and compares them; drift fails until the snapshot is
deliberately updated. Structural and style goldens stand in for
screenshot goldens until a device screenshot pipeline exists.

**The preview is a promise.** Any code that is successful as a mobile
responsive must be successful as an app: the preview renderer follows
React Native defaults (column flex, text only inside text elements),
the compiler warns and approximates unsupported CSS instead of letting
the preview silently succeed with web behaviour, and anything the app
cannot do surfaces as a diagnostic. A parity guard test scans every
example's generated `.tsx` for web-only APIs, web tags and
out-of-subset style properties. The full statement is in the README
and docs/UI_POLISH.md.

## The proof test

This is proven by doing, not claiming: a fresh AI session is
given **only** `llms.txt`, the catalog, and the recipe cards, no compiler
source, plus one sentence ("Build a profile card screen: avatar, name, a
follow button that toggles to Following, and a list of three posts"). Its
source must compile with zero errors and its preview must render and toggle.
Anything it had to guess is a docs bug, and the gap is fixed in the docs.

## Standing rule for every later stage

Every new capability ships with, in the same commit: the tiny example, its
recipe card, the catalog regeneration, and its tests. A capability without
its recipe card is not done, the same way a fix without tests is not done.
