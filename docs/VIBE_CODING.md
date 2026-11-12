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

**Not supported yet**: do not use these in Rangular source today:

| Angular feature | Status today | Planned |
|---|---|---|
| `[(ngModel)]` / forms | Not supported. `[(x)]` syntax is *parsed* but degrades to a one-way `[x]` prop binding, no write-back, no forms model | Stage 8 |
| Two-way binding `[(...)]` generally | Same as above: one-way prop binding only, no change event is generated for ordinary elements; Stage 6 controls use the explicit `[value]` plus `(change)` pattern instead | Stage 8 |
| Routing (`@angular/router`, `<router-outlet>`) | Not supported, no router exists; a dashed/unknown tag is passed through or warns. The Stage 6 `switcher` is view state inside one screen, never a router | Stage 9 (map to native navigation) |
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
- Literals: strings (`'Follow'`), numbers, `true` / `false`, arrays/objects in
  field initializers
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
  field. Routing is Stage 9.
- **Switch motion:** the knob only ever moves toward its target. The
  React Native primitive animates it with a plain linear timing move,
  never a spring, so there is no overshoot and no backward bounce.
  The preview uses a linear CSS transition between the same two end
  states. See `examples/settings/` and its recipe card.

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
