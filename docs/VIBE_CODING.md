# Rangular: Vibe-Coding Layer

Bigyan's directive, 2026-11-12: *"We want our whole system to be vibe coding conducive."*

## What "vibe coding conducive" means, precisely

A system is vibe-coding conducive when an AI coding assistant (or a human
working through one) can build correct things with it **without guessing**:
every API is discoverable, there is one obvious way to do each thing, examples
are tiny and copyable, errors teach the fix, and the feedback loop is fast
enough that the AI can iterate on its own mistakes.

Vibe coding fails for predictable reasons: the AI invents props that don't
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
4. **Generated catalog (`rangular catalog`):** emits `catalog.json` +
   `catalog.md` **from the actual code**, the tag mapping from codegen's
   exported `TAG_MAP`, primitive props parsed from
   `packages/ui/src/primitives.tsx` with the TypeScript compiler API
   (the primitives are shipped source typed `any`, so their destructured
   parameter patterns are the reliable source of prop names), token scales
   imported from `@rangular/ui` tokens, and the `DIAGNOSTIC_CODES` list.
   A test regenerates the catalog and fails if the committed files are stale.
5. **JSON diagnostics:** `rangular build --json` (and `preview --json`)
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
| Lifecycle hooks (`ngOnInit`, `ngOnDestroy`) | Wired (Stage 3): `ngOnInit` runs once after first render, `ngOnDestroy` on unmount, `useEffect(..., [])` and its cleanup in generated code |
| `HttpClient.get(url)` returning an Observable you `subscribe` to | Wired with a subset (Stage 3): an Observable-lite with `subscribe(next?, error?)` only; the supported component shape is `this.http.get(url).subscribe((data) => { this.field = data; });` |
| Angular Material selection controls | Wired (Stage 6): `switch` mirrors `mat-slide-toggle`, `checkbox` mirrors `mat-checkbox`, `switcher` with `option` mirrors `mat-button-toggle-group`, and `radio-group` with `radio` mirrors `mat-radio-group`; all use `[checked]` or `[value]` in and `(change)` out with the next value as `$event` |
| Template-driven forms (`[(ngModel)]`, validators as attributes, `#name="ngModel"` refs) | Wired (Stage 8) on `<input>` only: `[(ngModel)]` writes back through the field's state setter, the explicit `[ngModel]` plus `(ngModelChange)` pair works, `required` / `minlength` / `maxlength` / `email` / `pattern` attributes validate with Angular's error shapes, and refs expose `valid` / `invalid` / `touched` / `errors` to template expressions. See the Forms section below for the exact limits |
| Reactive forms (`FormGroup`, `FormControl`, `Validators` from `@angular/forms`) | Wired (Stage 8): the classes are runtime classes, a group field is a stable ref-held instance, `[formGroup]` plus `formControlName` binds controls, and `profileForm.get('email')` evaluates in template expressions. See the Forms section below |
| `<form (submit)="save()">` | Wired (Stage 8) as a lightweight form element: a `<button type="submit">` inside calls the handler after marking every ngModel input touched (and `markAllAsTouched()` on a reactive group). There is no NgForm object |
| Routing (`Routes` array, `<router-outlet>`, `routerLink`, `ActivatedRoute`, `Router`) | Wired (Stage 9) in the modern standalone form: the compiler mirrors the `export const routes: Routes = [...]` array that `provideRouter(routes)` consumes, not the historical `RouterModule.forRoot` module form. The root component hosts one `<router-outlet>`; route components are ordinary components imported by the routes file; `routerLink` (string or array form) on a `<button>` or `<row>` compiles to a navigation press; `ActivatedRoute.snapshot.params` and its `paramMap` Observable-lite, and `Router.navigate` / `navigateByUrl`, are runtime classes. See the Routing section below for the exact limits |
| Date picker, bottom sheet, dialog and snack bar (`<datetime-picker>`, `<sheet>`, `<dialog>`, `<actions>`, `SnackBar`) | Wired (Stage 10) as documented native adaptations of the Angular Material surface: the picker is one block with iOS style wheels in a bottom sheet on every platform; MatBottomSheet and MatDialog become declarative `[open]` plus `(close)` blocks whose children render inside the panel; MatSnackBar keeps the service form through the built-in `SnackBar` injection, `open(message, actionLabel, durationMs)` and a returned ref with `onAction`. Event bindings never hold assignments. See the Pickers and overlays section below for the exact limits |
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

**D. Reactive forms.** `FormControl`, `FormGroup` and `Validators`
imported from `@angular/forms` in source are the runtime classes of
the same names. A field initialised with `new FormGroup(...)` or
`new FormControl(...)` is a stable instance: the generated component
holds it in a `useRef`, reads it as `profileFormRef.current`, and
re-renders through a version counter subscribed to every control's
`valueChanges`. The template surface is `[formGroup]="profileForm"`
on the `<form>` and `formControlName="email"` on inputs (a static
attribute; an unknown control name is a `GEN_FORM_CONTROL` error
listing the group's controls). `profileForm.get('email')` evaluates
in template expressions, generated code and preview alike, because
the instance is real in all three. `(submit)` on a reactive form
marks all controls touched, then calls the handler; handlers read
`this.profileForm.value` and `.valid` as plain member reads.

- **Preview initializer subset.** The preview builds the group by
  evaluating the field initializer with a small hand-written
  evaluator (no eval): literal initial values, `Validators.x`
  references, validator calls like `Validators.minLength(3)`,
  validator arrays, trailing commas, and a `FormGroup` object of
  `FormControl`s. Anything richer warns `GEN_FORM_INITIALIZER`: the
  generated app still runs the initializer verbatim, only the
  preview cannot build the instance.
- **Not built:** group-level validators (a group's `errors` is null
  and its validity is all-controls-valid), `FormArray`, async
  validators, `FormBuilder`, value changes streams beyond each
  control's `valueChanges`, and template binding for a standalone
  `FormControl` field (no `[formControl]` surface yet).

See `examples/signup-form/` (template-driven) and
`examples/profile-form/` (reactive) and their recipe cards.

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
  `rangular build --routes <file>` (also on preview, watch and
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
  one instance per mount from the current entry.
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
time dialog. The field row opens a bottom sheet of wheels, the
selected value sits in the middle row, rows above and below are
muted, and Done and Cancel are accent coloured text buttons in the
sheet header.

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
  iOS en-US form. `mode="datetime"` is the default and shows one
  combined date wheel plus hour, minute and AM/PM wheels. The date
  wheel labels days like `Nov 13 2026`, the way the iOS combined
  date and time picker lists them.
- **Value contract.** `[value]` accepts an ISO string or a `Date`.
  The picker keeps a pending value while the sheet is open. Done
  emits `(change)` once, with the composed local ISO string
  `YYYY-MM-DDTHH:mm:00` as `$event`; Cancel discards the pending
  value and emits nothing. An unparseable value falls back to the
  current local date and time in the primitive. Children of the
  block are ignored.
- **Ranges.** Date mode years run from the value year minus 25 to
  the value year plus 25. The datetime date wheel is a finite
  window of 183 days before and after the value, standing in for
  the endless iOS list. Day selections clamp into their month, so
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
  absolute overlays inside the screen.
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
  state and renders the `RgSnackbar` host: a dark floating pill at
  the bottom with the message and the action label uppercased.
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
  code's runtime `pipe()` from `@rangular/runtime`, and the preview
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

- **`rangular init <dir>` is unchanged** (a loose starter component).
  **`rangular init <name> --app`** scaffolds a real Expo app. A bare
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
  `babel-preset-expo ~58.0.0` (dev). They were chosen for mutual
  compatibility from the SDK's published set, not installed or
  device-verified from the build environment. The set moved from
  SDK 54 to SDK 58 on 2026-11-12 because the store build of Expo Go
  supports SDK 58 only and refused an SDK 54 app.
- **The starter is compiled at scaffold time**: `src/app.component.ts`
  and its template are the usual starter source, and `src/AppRoot.tsx`
  is the real compiler output for it, generated during `init`, not a
  stored sample. `App.tsx` renders `AppRoot`. After editing the
  component, recompile it with `rangular build` (or `watch`) from the
  repo root, pointed at the app's `src/AppRoot.tsx`, as the app
  README spells out.
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
  (change)="onCity($event)">` with `<option value="ktm">Kathmandu
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
  nothing. App side requirement: the Expo picker modules
  (expo-image-picker, expo-document-picker) are loaded lazily, so
  the app must carry the one its kind uses; Expo Go carries both.
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

- **One token file, both modes.** `@rangular/ui` tokens are the only
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
  aligned, same 48 high target.
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
| `rangular build <component.ts> --out <file.tsx> [--json] [--source-map]` | Compile one component to React Native TSX |
| `rangular ast <template.html>` | Print a template AST |
| `rangular preview <component.ts> --out <file.html> [--json]` | Render the interactive dev preview |
| `rangular catalog [--out <dir>]` | Regenerate catalog.json and catalog.md from the code |
| `rangular watch <component.ts> --out <file.tsx>` | Compile now, then recompile on every change to the component, its template or its imports; the watch set re-resolves after each compile; Ctrl+C stops cleanly |
| `rangular init <dir>` | Scaffold a starter project (welcome screen, README, .gitignore); refuses a non-empty directory |
| `rangular init <name> --app` | Scaffold a real Expo app (Stage 12): a bare name lands in the checkout's `apps/` folder, an explicit path is used as given; the starter component is compiled into `src/AppRoot.tsx` at scaffold time. See the Expo app scaffold section above |
| `rangular doctor <component.ts> [--json]` | The polish linter below |

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
that are not Material roles (see the dinacharya-row recipe card).

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

Vibe-conduciveness is proven by doing, not claiming: a fresh AI session is
given **only** `llms.txt`, the catalog, and the recipe cards, no compiler
source, plus one sentence ("Build a profile card screen: avatar, name, a
follow button that toggles to Following, and a list of three posts"). Its
source must compile with zero errors and its preview must render and toggle.
Anything it had to guess is a docs bug, and the gap is fixed in the docs.

## Standing rule for every later stage

Every new capability ships with, in the same commit: the tiny example, its
recipe card, the catalog regeneration, and its tests. A capability without
its recipe card is not done, the same way a fix without tests is not done.
