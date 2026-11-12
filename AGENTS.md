# AGENTS.md: working in the Rangular repo

Rangular is a standalone transpiler: you write Angular-style code
(TypeScript classes with `@Component`, HTML-like templates) and it compiles
to React Native `.tsx`. The target is RN JavaScript/JSX. Hermes makes the
bytecode. Rangular does not fork Angular and does not parse TypeScript by
hand (it uses the TypeScript compiler API).

**Before writing any Rangular source, read the delta tables in
[docs/VIBE_CODING.md](docs/VIBE_CODING.md)**, Rangular looks like Angular
but is a subset of it, and it is not React. The machine-readable list of
everything you may use is [catalog.md](catalog.md) / `catalog.json`.

## Repo map

| Path | What lives there |
|---|---|
| `packages/compiler/src/` | The compiler: template parser (`template/`), `@Component` extractor (`class/`), CSS subset (`style/`), RN code generator (`codegen/`), HTML preview renderer (`preview/`), catalog generator (`catalog.ts`), pipeline (`compile.ts`) |
| `packages/cli/src/cli.ts` | The `rangular` CLI: `build` (with `--json`, `--source-map`), `ast`, `preview`, `catalog`, `watch`, `init` (with `--app` for the Expo scaffold), `doctor` (the polish linter lives in `packages/compiler/src/doctor.ts`) |
| `packages/runtime/src/index.ts` | Pure-TS helpers for generated apps: `EventEmitter`, `signal()`, `Container`, `ReactiveService` (base class generated services extend), `HttpClient` (Observable-lite over fetch), `pipe()`, the forms classes (Stage 8): `Validators`, `validateValue`, `FormControl`, `FormGroup`, the routing classes (Stage 9): `matchRoute`, `RgNavigator`, `Router`, `ActivatedRoute`, and the snackbar service (Stage 10): `SnackBar`, `SnackBarRef` |
| `packages/ui/src/tokens.ts` | Rangular Material design tokens (pure TS, part of the build) |
| `packages/ui/src/icons.ts` | The curated icon set (Stage 7): name to SVG path data (24 by 24 viewBox), the size scale and the default size; the single source the compiler validates against, the catalog generates from, and both renderers draw |
| `packages/ui/src/datetime.ts` | Date and time helpers for the picker (Stage 10): ISO parsing and composition, leap correct month lengths, wheel specifications and display formatting; pure TS, part of the build, mirrored by the preview page runtime and parity-tested against it |
| `packages/ui/src/primitives.tsx` | RN primitives (`RgScreen`, `RgAppbar`, `RgCard`, `RgButton`, `RgText`, `RgList`, `RgRow`, `RgFab`, `RgSwitch`, `RgCheckbox`, `RgSwitcher`, `RgOption`, `RgRadioGroup`, `RgRadio`, `RgIcon`, `RgInput`, `RgOutlet`, `RgSheet`, `RgDialog`, `RgActions`, `RgSnackbar`, `RgDateTimePicker`, and Stage 11: `RgTabs`, `RgTab`, `RgAccordion`, `RgPanel`, `RgTable`, `RgColumn`, `RgSlider`, `RgProgressBar`, `RgSpinner`, `RgChips`, `RgChip`) plus the theme context (`RgThemeProvider`, `useRgTheme`); all colours come from the active theme, shipped source for generated apps, deliberately excluded from this repo's `tsc` build |
| `packages/compiler/src/class/parseRoutes.ts` | The Stage 9 routes file reader: finds the exported `Routes` array literal and turns each entry into a route definition, with `GEN_ROUTE_UNSUPPORTED` for guards, resolvers, lazy loading and child routes |
| `packages/compiler/src/template/pipes.ts` | The Stage 12 canonical built-in pipe implementations (date, number, percent, currency, slice, keyvalue, async snapshot), shared by the template evaluator; the runtime `pipe()` and the preview page mirror them and are parity-tested against this file |
| `packages/compiler/src/class/parseDirective.ts` | The Stage 12 attribute directive extractor: reads a `@Directive` class's `ngOnInit` or setter body and extracts the supported `this.el.nativeElement.style.<prop> = <expr>` assignments, or reports why the body is outside the subset (`DIR_UNSUPPORTED`) |
| `examples/hello/`, `examples/counter/`, `examples/inbox/`, `examples/profile/`, `examples/favourite/`, `examples/shared-inbox/`, `examples/showcase/`, `examples/dinacharya-row/`, `examples/settings/`, `examples/icons/`, `examples/signup-form/`, `examples/profile-form/`, `examples/mini-mail/`, `examples/reminder/`, `examples/mailbox-pro/`, `examples/pipes-demo/`, `examples/directives-demo/`, `examples/projection-demo/` | Tiny single-capability examples, each with a recipe-card `README.md`, golden generated `.tsx`, `preview.html` and a `styles.snapshot.json` style golden (profile is the Stage 2.5 proof-test example: written from these docs alone; favourite = child components, shared-inbox = services/DI/lifecycle, showcase = tokens/theming/snapping, dinacharya-row = the Stage 5 dogfood example: one real Awaken Me row, settings = Stage 6 controls: switch, checkbox, switcher, radio group, icons = Stage 7 icon set: the full set with labels, sizes and colour roles, signup-form = Stage 8 template-driven forms: ngModel, validators, refs, submit, profile-form = Stage 8 reactive forms: FormGroup, formControlName, mini-mail = Stage 9 routing: shell, outlet, routes file, routerLink, ActivatedRoute params, reminder = Stage 10 pickers and overlays: iOS wheel datetime picker, bottom sheet, dialog, SnackBar with Undo, mailbox-pro = Stage 11 data display: tabs, accordion and panels, table, autocomplete, slider, progress bar and spinner, chips, badges, pipes-demo = Stage 12 pipes: built-ins tour plus a custom @Pipe, directives-demo = Stage 12 attribute directives: the highlight directive, static and bound, projection-demo = Stage 12 content projection: a panel child with an ng-content slot) |
| `tests/` | `node:test` suites, parser, expressions, codegen, methods, runtime, tokens, catalog/vibe layer, Stage 3 (children, services, HttpClient, preview behaviour via a DOM shim), Stage 4 (token completeness, primitives hex guard, CSS snapping, preview theme toggle, no-em-dash guard), Stage 5 (per-file diagnostics, source maps, watch, init, doctor, style snapshot goldens, preview parity guard, dogfood behaviour), Stage 6 (controls codegen and nesting, settings example, preview behaviour for switch, checkbox, switcher and radio group, switch motion rule), Stage 7 (icon set and validation, icons example, preview parity of the drawn paths, RgIcon primitive), Stage 8 (runtime Validators and form classes, ngModel and refs codegen, reactive ref-held groups, forms diagnostics, signup-form and profile-form examples, preview text entry behaviour via the DOM shim), Stage 9 (runtime matcher and navigator, array literal expressions, routes file parsing, routing diagnostics, CLI --routes, mini-mail example, preview navigation behaviour via the DOM shim, preview/runtime matcher parity), Stage 10 (runtime SnackBar, date and time helpers, picker and overlay codegen, event assignment guard, reminder example, preview picker, sheet, dialog and snackbar behaviour via the DOM shim, preview/runtime date helper parity), Stage 11 (data display codegen and diagnostics, mailbox-pro example, spinner arc and badge text parity, preview tabs, accordion, autocomplete, slider, chips and badge behaviour via the DOM shim), Stage 12 (built-in pipe parity across the evaluator, the runtime and the preview page, custom pipes, the async pipe in codegen and preview, attribute directives, content projection, the Expo app scaffold, and the Stage 12 security fixtures in tests/security.test.ts) |
| `docs/` | `PINPOINT_MAP.md` (design map), `LEARNING_LIST.md` (the 77 things), `BLOCK_DIAGRAM.md` (architecture), `UI_POLISH.md` (polish system), `VIBE_CODING.md` (AI-facing layer + delta tables), `ROADMAP.md` (the approved Stages 6 to 12 plan) |
| `catalog.json`, `catalog.md` | GENERATED from the code by `rangular catalog`, never hand-edit |
| `llms.txt` | AI-readable index of the whole repo |

## Commands

```sh
npm install
npm test            # tsc build, then node --test over dist/tests/*.test.js

# Compile one component (Angular -> React Native TSX)
node dist/packages/cli/src/cli.js build examples/counter/counter.component.ts --out examples/counter/counter.component.tsx

# Same, machine-readable: one JSON object on stdout ({ ok, outFile?, diagnostics[] })
node dist/packages/cli/src/cli.js build examples/counter/counter.component.ts --out /tmp/counter.tsx --json

# Print a template AST
node dist/packages/cli/src/cli.js ast examples/hello/hello.component.html

# Render the interactive dev preview
node dist/packages/cli/src/cli.js preview examples/counter/counter.component.ts --out examples/counter/preview.html

# Regenerate the catalog after changing tags, primitives, tokens or diagnostics
node dist/packages/cli/src/cli.js catalog --out .

# Compile with a block level source map (writes <out>.map + the sourceMappingURL comment)
node dist/packages/cli/src/cli.js build examples/counter/counter.component.ts --out /tmp/counter.tsx --source-map

# Recompile on every save (component, template and imports; Ctrl+C stops)
node dist/packages/cli/src/cli.js watch examples/counter/counter.component.ts --out /tmp/counter.tsx

# Scaffold a starter project (refuses a non-empty directory)
node dist/packages/cli/src/cli.js init my-app

# Polish linter: hex colours, off-scale values, loose text, tap targets
node dist/packages/cli/src/cli.js doctor examples/showcase/showcase.component.ts
```

## Forms (Stage 8), the short version

- `<input>` is the one text entry block (`RgInput`). `[(ngModel)]`
  works on `<input>` only and binds a plain field; anywhere else it
  is a `GEN_NGMODEL_TARGET` error. Validators are attributes
  (`required`, `minlength`, `maxlength`, `email`, `pattern`);
  `type="email"` does not validate, the `email` attribute does.
- `#name="ngModel"` refs expose `valid` / `invalid` / `touched` /
  `errors` to template expressions only. `<form (submit)>` plus a
  `<button type="submit">` is the whole form element; there is no
  NgForm. Full detail in the Forms section of docs/VIBE_CODING.md.
- Reactive forms: a field initialised with `new FormGroup(...)` or
  `new FormControl(...)` (imported from `@angular/forms` in source)
  is a stable ref-held instance of the runtime classes, bound with
  `[formGroup]` and `formControlName`. Do not assign such a field in
  a method, and do not expect `[formControlName]` (binding form) to
  work; it warns.

## Routing (Stage 9), the short version

- **One discovery rule.** The routes file is `app.routes.ts` next to
  the root component, or the file named by the CLI `--routes` flag
  (build, preview, watch, doctor). It is read whenever it exists;
  using an outlet, a routerLink or a Router/ActivatedRoute injection
  without one is a `GEN_ROUTES_MISSING` error.
- The mirrored Angular form is the modern standalone one:
  `export const routes: Routes = [...]`, the array `provideRouter`
  consumes. There is no `RouterModule.forRoot` form, because there
  are no NgModules. Route components are ordinary components the
  routes file imports; the root component hosts the one
  `<router-outlet>` (the `RgOutlet` primitive).
- `routerLink` (string or `[routerLink]` array form) belongs on
  tappable blocks (`button`, `row`, `fab`), never on component tags.
  `ActivatedRoute` and `Router` are built-in injections like
  `HttpClient`. Same-component parameter changes remount in v1.
  Guards, resolvers, lazy loading, child routes and
  `routerLinkActive` are not supported; full detail in the Routing
  section of docs/VIBE_CODING.md.

## Pickers and overlays (Stage 10), the short version

- **The picker is the iOS wheel picker on both platforms.** This is
  Bigyan's product rule: `<datetime-picker>` opens a bottom sheet
  with wheels, never a calendar grid and never an Android style
  dialog. Modes are `date`, `time` and `datetime` (the default);
  Done emits the ISO string through `(change)`, Cancel discards.
  Unknown modes are `GEN_PICKER_MODE`; a `minuteInterval` other
  than 1 or 5 warns `GEN_PICKER_INTERVAL` and snaps.
- **MatBottomSheet and MatDialog are declarative here.** Write
  `<sheet [open]="x" (close)="closeSheet()">` and
  `<dialog [open]="x" (close)="closeDialog()" title="...">`;
  children render inside the panel, dialog buttons usually sit in
  an `<actions>` row, and a backdrop tap emits `(close)`. No
  `[open]` means statically open plus a `GEN_OVERLAY_OPEN` warning.
- **Event bindings never hold assignments.** `(close)="x = false"`
  is not supported anywhere: the expression grammar has no
  assignment operator. Codegen warns `GEN_EVENT_ASSIGNMENT` and
  drops the binding. Call a method and assign inside it.
- **SnackBar is a component built-in.** Inject `SnackBar` in a
  component and call `open(message, actionLabel?, durationMs?)`
  (default 4000). The statement form is the supported action
  subscription: `const ref = this.snack.open('Deleted', 'Undo');`
  then `ref.onAction(() => { ... });`. A service injecting
  `SnackBar` gets `DI_UNKNOWN_TOKEN`. Full detail in the Pickers
  and overlays section of docs/VIBE_CODING.md.

## Data display (Stage 11), the short version

- **Tabs own content, the switcher does not.** `<tabs [index]
  (change)>` with `<tab label="...">` children follows the Stage 6
  controls contract; each tab's children render only while it is
  selected. Reach for `<switcher>` when the swap is yours to write
  with `*ngIf`. Misplaced declarations warn `GEN_CONTROL_NESTING`.
- **Panels are self-managed; `[expanded]` is a seed.** Tap toggles,
  `(toggle)` emits the next boolean. `<accordion>` around direct
  panels is single-open (the first seeded open panel starts open);
  the coordination is injected by the group primitive, templates
  stay plain panels.
- **Table columns are names, not templates.** `<table [data]>` with
  `<column name="count" header="Messages">`; `name` matches
  matColumnDef and React reserves `key` (accepted as an alias).
  Missing name is `GEN_TABLE_COLUMN`. Empty data shows nothing
  unless the table carries `emptyText`. No sorting or pagination.
- **Autocomplete is `[options]` plus `(optionSelected)` on
  `<input>`.** String options only, filtered by case-insensitive
  substring while focused; a pick writes back through ngModel and
  emits the chosen string. No object options, no `displayWith`.
- **Slider, progress, spinner.** Slider snaps to `step` and clamps
  to `min`/`max`, emitting on release and on tap; static
  `min >= max` errors `GEN_SLIDER_RANGE`, `step <= 0` warns and
  uses 1. Progress values clamp (`GEN_PROGRESS_RANGE` when
  statically out of range); `mode="indeterminate"` is a static 40
  percent bar in the preview. The spinner draws one shared SVG arc
  and its `size` rides the icon scale (`GEN_SPINNER_SIZE`).
- **Chips and badge.** `<chip icon removable (remove)>` in a
  `<chips>` row; remove a chip with a filter assignment in a
  method (`this.filters = this.filters.filter(...)` compiles).
  `badge` is an attribute on `<button>`, `<row>` and `<icon>`
  only; 0 or empty renders nothing, above 99 renders `99+`, other
  hosts warn `GEN_BADGE_HOST`. Full detail in the Data display
  section of docs/VIBE_CODING.md.

## Pipes, directives, projection and the app scaffold (Stage 12), the short version

- **Pipes are three-way identical.** Built-ins live canonically in
  `packages/compiler/src/template/pipes.ts`; the runtime `pipe()` and
  the preview page mirror them, and a parity test runs one table
  through all three. Change one, change all three, or the test fails.
  A custom `@Pipe` class resolves through imports like a child or a
  service; an unregistered name is a `PIPE_UNKNOWN` error. The
  `async` pipe in generated code is a state slot plus an effect per
  distinct streamed expression (captured at mount).
- **Directives are compile time only.** The subset is `@Input`
  fields, an injected `ElementRef`, and `ngOnInit` or setter bodies
  of `this.el.nativeElement.style.<prop> = <expr>` assignments,
  extracted by `class/parseDirective.ts` and folded into the host's
  style. Anything else warns `DIR_UNSUPPORTED`. There is no runtime
  directive object; do not invent one.
- **Projection is one default slot.** `<ng-content>` compiles to the
  React `children` prop; projected content keeps the parent's scope.
  A `select` attribute warns `PROJECTION_SELECT_UNSUPPORTED`.
- **`init --app` scaffolds a real Expo app**: bare names land in
  `<repoRoot>/apps/`, explicit paths are used as given, `file:` deps
  are computed relative to the checkout's packages, the starter is
  compiled into `src/AppRoot.tsx` during init, and the docs state
  plainly that no device run was verified. Plain `init` is unchanged.

## Golden rules

1. **Never edit generated files.** Examples' `.tsx` and `preview.html`, and
   `catalog.json` / `catalog.md`, are compiler output. Change the source
   (`.ts` / `.html` / compiler code) and regenerate with the CLI.
2. **Every new capability ships in the same change with all five:**
   compiler support + tests + a tiny example + its recipe card
   (`examples/<name>/README.md` in the fixed Intent / Source / What it
   compiles to / Rules used / Common mistakes shape) + regenerated catalog.
   A capability missing any of these is not done.
3. **Run `npm test` before declaring done.** All tests must pass, including
   the golden-file tests and the catalog staleness test.
4. **One obvious way.** Follow the tag→primitive mapping (`TAG_MAP` in
   `packages/compiler/src/codegen/generate.ts`, rendered in `catalog.md`).
   Do not invent new tags, props or events. If a block is missing, add it
   to the mapping + primitives + catalog properly instead of working around it.
5. **Unsupported constructs produce coded diagnostics, never broken
   output.** Add the code to `DIAGNOSTIC_CODES` in
   `packages/compiler/src/diagnostics.ts`, give it a concrete `fix:`
   suggestion, and degrade with a warning + TODO comment in generated code,
   following the existing `METHOD_UNSUPPORTED` / `GEN_NGIF_ELSE_TODO` pattern.
6. **No em dashes anywhere in this repo** (they read as machine-written).
   Write plainly, like a person: commas, periods, colons, hyphens. A guard
   test scans the repo and fails if U+2014 appears in any tracked text file.
7. **The preview is a promise.** Any code that is successful as a mobile
   responsive must be successful as an app: if it renders and behaves
   correctly at phone width in the preview, the same generated code must
   work as a real React Native app. The preview never succeeds on
   something the app cannot do; anything the app cannot do surfaces as a
   diagnostic. A parity guard test scans every example's generated `.tsx`
   for web-only APIs, web tags and out-of-subset style properties.
