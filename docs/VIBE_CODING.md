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
the repo's actual behaviour today (Stage 3), not aspirations.

### Rangular source vs Angular

**The same**: write it exactly as you would in Angular:

| Angular feature | In Rangular source |
|---|---|
| `@Component` decorator (selector, templateUrl, inline template, styles, styleUrls) | Same; read by the TypeScript compiler API |
| `@Input()` / `@Output()` field decorators | Wired (Stage 3): `@Input` fields become props, the literal initializer is the default when unbound; an `@Output` field holding `new EventEmitter<T>()` becomes an `onX` callback prop and `this.x.emit(v)` compiles to `onX?.(v)` |
| Child components (a tag matching another component's selector) | Same, with import-based resolution: the compiler follows the entry file's relative imports and any imported `@Component` class is a usable child, no module/declarations list |
| Templates in separate `.html` files | Same |
| `{{ interpolation }}`, `[prop]` binding, `(event)` binding, `*ngIf`, `*ngFor` syntax | Same syntax, same meaning |
| Pipes in expressions (`expr \| uppercase`) | Parsed; built-ins `uppercase`, `lowercase`, `titlecase`, `json` evaluate in preview/runtime |
| Class fields as state, methods as actions | Same. This is the core model |
| `@Injectable({ providedIn: 'root' })` services + constructor injection | Wired (Stage 3): services are reactive singletons in a generated container; constructor *parameter properties* (`constructor(private mail: MailService)`) are the injection form; services may inject services |
| Lifecycle hooks (`ngOnInit`, `ngOnDestroy`) | Wired (Stage 3): `ngOnInit` runs once after first render, `ngOnDestroy` on unmount, `useEffect(..., [])` and its cleanup in generated code |
| `HttpClient.get(url)` returning an Observable you `subscribe` to | Wired with a subset (Stage 3): an Observable-lite with `subscribe(next?, error?)` only; the supported component shape is `this.http.get(url).subscribe((data) => { this.field = data; });` |
| Angular Material selection controls | Wired (Stage 6): `switch` mirrors `mat-slide-toggle`, `checkbox` mirrors `mat-checkbox`, `switcher` with `option` mirrors `mat-button-toggle-group`, and `radio-group` with `radio` mirrors `mat-radio-group`; all use `[checked]` or `[value]` in and `(change)` out with the next value as `$event` |
| Template-driven forms (`[(ngModel)]`, validators as attributes, `#name="ngModel"` refs) | Wired (Stage 8) on `<input>` only: `[(ngModel)]` writes back through the field's state setter, the explicit `[ngModel]` plus `(ngModelChange)` pair works, `required` / `minlength` / `maxlength` / `email` / `pattern` attributes validate with Angular's error shapes, and refs expose `valid` / `invalid` / `touched` / `errors` to template expressions. See the Forms section below for the exact limits |
| Reactive forms (`FormGroup`, `FormControl`, `Validators` from `@angular/forms`) | Wired (Stage 8): the classes are runtime classes, a group field is a stable ref-held instance, `[formGroup]` plus `formControlName` binds controls, and `profileForm.get('email')` evaluates in template expressions. See the Forms section below |
| `<form (submit)="save()">` | Wired (Stage 8) as a lightweight form element: a `<button type="submit">` inside calls the handler after marking every ngModel input touched (and `markAllAsTouched()` on a reactive group). There is no NgForm object |
| Routing (`Routes` array, `<router-outlet>`, `routerLink`, `ActivatedRoute`, `Router`) | Wired (Stage 9) in the modern standalone form: the compiler mirrors the `export const routes: Routes = [...]` array that `provideRouter(routes)` consumes, not the historical `RouterModule.forRoot` module form. The root component hosts one `<router-outlet>`; route components are ordinary components imported by the routes file; `routerLink` (string or array form) on a `<button>` or `<row>` compiles to a navigation press; `ActivatedRoute.snapshot.params` and its `paramMap` Observable-lite, and `Router.navigate` / `navigateByUrl`, are runtime classes. See the Routing section below for the exact limits |

**Not supported yet**: do not use these in Rangular source today:

| Angular feature | Status today | Planned |
|---|---|---|
| Two-way binding `[(x)]` beyond ngModel | Only `[(ngModel)]` on `<input>` is a real two-way binding (Stage 8). Any other `[(x)]` is *parsed* but degrades to a one-way `[x]` prop binding with no write-back; Stage 6 controls use the explicit `[value]` plus `(change)` pattern instead | Not planned beyond ngModel |
| NgModules (`@NgModule`, `providers` arrays, module-scoped DI) | Not supported, resolution is import-based instead: `@Component` classes are entry points, and `@Injectable({ providedIn: 'root' })` classes are the injectable services (Stage 3). An `@NgModule` file errors with `CLS_NO_COMPONENT`; an `@Injectable` without `providedIn: 'root'` is not registered, so injecting it is a `DI_UNKNOWN_TOKEN` error | Not planned as modules |
| Component constructor *bodies* | Not translated, only constructor parameter properties are read (they are the DI declarations). Do one-time setup in `ngOnInit` instead | Not planned |
| Animations (`@angular/animations`, `:enter`/`:leave`) | Not supported anywhere in the compiler | Post-v1 |
| SSR / hydration | Not supported, output is a React Native app, there is no server rendering | Not planned |
| Full RxJS surface (operators, Subjects, Observables from other sources) | Not supported. Only HttpClient's Observable-lite exists (`subscribe(next?, error?)`, no operators, no unsubscribe-driven teardown beyond a cancellation flag); the runtime `async` pipe is still a pass-through stub | Later stage |
| Custom pipes (`@Pipe` classes) | Not read. Only the built-in pipes above exist | Stage 12 |
| `*ngIf` with `else` / `then` | Detected, warns `GEN_NGIF_ELSE_TODO`, element emitted unconditionally. Workaround: two elements, `*ngIf="cond"` and `*ngIf="!(cond)"` | Later stage |
| Full CSS (cascade, inheritance, descendant/id/pseudo selectors, unsupported properties) | Subset only: element and `.class` selectors, a fixed property list; anything else warns (`CSS_SELECTOR` / `CSS_UNSUPPORTED`) and is dropped. Styles apply per element, no cascade | Subset may grow per stage |

### Rangular source vs React

Rangular source is **not React**. Do not write React in it:

| React concept | In Rangular source |
|---|---|
| Components | TypeScript **classes** with `@Component`, never function components |
| Markup | A separate `.html` **template file** (or inline template string). **No JSX anywhere in source** |
| State | Plain **class fields** (`count = 0`). **No hooks, no `useState`, no `useEffect` in source**, the compiler *generates* a function component with hooks underneath |
| Updating state | Mutate the field inside a method: `this.count++`. A field assigned inside any method becomes `useState` in the output; a field never assigned stays a plain constant |
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
- Pipes: `uppercase`, `lowercase`, `titlecase`, `json`, an unknown pipe is
  an error, not a silent pass-through

## Block semantics and composition

- Blocks compose freely, like HTML: a `<button>` inside a `<card>`, a
  `<row>` inside a `<card>`, headings and paragraphs anywhere a screen or
  card can hold children. There is no separate permission table per parent.
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
`onChangeText` wiring, and `(blur)` maps to `onBlur`.

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
  visible in the generated signature (`{ quote = '' }`). There is no
  content projection: children written inside a child tag are ignored.
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
- **Text by meaning, not by number.** `h1`/`h2`/`h3`/`p` map to the
  display/heading/title/body steps, and `<label>` (new in Stage 4)
  maps to the label step. See `examples/showcase/` and its recipe
  card for the whole system on one screen.

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
