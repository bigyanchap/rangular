# Rangular roadmap

This roadmap records the plan approved by Bigyan on 12 November 2026. It covers Stage 6 through Stage 12. Each stage is built in order, and each stage lands as one complete change with compiler support, tests, a tiny example, a recipe card and a regenerated catalog.

## Standing rules

1. Source code never deviates from Angular style. Angular syntax and Angular semantics stay faithful. Only the rendering target changes.
2. Every feature is grounded in the official Angular documentation or in the Angular Material component that Angular applications already know.
3. Where Angular Material or a component library of the same class has a loved component for a job, Rangular builds the best version of that component rather than a rough equivalent.
4. The date and time picker in Stage 10 must look like the iOS wheel picker. It must not look like the Android picker.
5. The preview is a promise. A screen that works in the preview must work as a React Native app from the same generated code.
6. No stage is done on compiler support alone. The example, the recipe card, the catalog and the tests ship in the same change.

## Stage 6: Controls

Status: built in this change.

Angular ground: Angular Material form controls and selection controls, mainly `mat-slide-toggle`, `mat-checkbox`, `mat-button-toggle-group` and `mat-radio-group`.

The stage adds `switch`, `checkbox`, `switcher` with `option`, and `radio-group` with `radio`. Each control follows the Material pattern: a bound value goes in, a `(change)` event carries the next value out as `$event`, and a method in the component class writes the value to state. The switcher changes view state inside one screen. It is not routing. The settings example proves all four controls in the compiler output and in the interactive preview.

## Stage 7: Icons

Status: built in this change.

Angular ground: Angular Material `mat-icon` and the Material icon set that Angular applications use through the icon component.

The stage adds an Angular style icon block with a curated set of everyday Material style icons. One icon set serves the generated app and the preview, so the two cannot drift apart. An unknown icon name becomes a diagnostic whose fix lists the valid names, and the catalog lists every available icon.

## Stage 8: Forms

Status: built in this change.

Angular ground: the Angular forms guide, covering template driven forms and reactive forms.

The stage adds `[(ngModel)]` two way binding, template driven forms, reactive forms built from form controls and form groups, and the standard validators. Form state, validity and error display follow Angular semantics. The generated React Native code stays an implementation detail under the Angular source.

As built: an `<input>` block compiles to a Material style `RgInput` field. Template driven forms bind with `[(ngModel)]` on inputs only (the `[ngModel]` plus `(ngModelChange)` pair also works), validate with attributes (`required`, `minlength`, `maxlength`, `email`, `pattern`, with Angular error shapes from the runtime `Validators`), and expose `#name="ngModel"` refs (`valid`, `invalid`, `touched`, `errors`) to template expressions. A lightweight `<form (submit)>` element runs its handler from a `<button type="submit">` after marking inputs touched; there is no NgForm object. Reactive forms use runtime `FormControl`, `FormGroup` and `Validators` classes: a group field is a stable ref-held instance bound through `[formGroup]` and `formControlName`, re-rendering through a version counter subscribed to the controls. The signup-form and profile-form examples prove both flavours in the compiler output and in the interactive preview.

## Stage 9: Routing

Status: built in this change.

Angular ground: the Angular Router guide, covering route configuration, `RouterOutlet`, `RouterLink` and route parameters through `ActivatedRoute`.

The stage adds a `Routes` configuration, a `router-outlet` block, `routerLink` navigation and route parameters. The Angular source keeps the router model. The generated app maps that model to native navigation.

As built: the routes file is the modern standalone form, `export const routes: Routes = [...]` (the array `provideRouter` consumes, not `RouterModule.forRoot`), discovered as a sibling `app.routes.ts` next to the root component or named with the CLI `--routes` flag; it is read whenever it exists and using routing without one is `GEN_ROUTES_MISSING`. A runtime `matchRoute` resolves declaration order, `:param` segment capture (always strings), full match redirects (chains resolve, loops fail closed) and the `**` wildcard; a runtime `RgNavigator` stack, a `Router` service (`navigate` / `navigateByUrl`) and an `ActivatedRoute` (`snapshot.params` plus a `paramMap` Observable-lite) carry the model in generated code and in the preview, whose matcher is a hand mirror parity-tested against the runtime. The root component hosts one `<router-outlet>` (the `RgOutlet` primitive); route components are ordinary imported components, remounted per concrete path, so same-component parameter changes remount in v1 (a stated simplification; Angular reuses the component). `routerLink` in string and array forms compiles to a navigation press on tappable blocks; array literals joined the expression subset for it. Guards, resolvers, lazy loading and child routes are `GEN_ROUTE_UNSUPPORTED` errors naming the feature; unknown components are `GEN_ROUTE_COMPONENT`; duplicate paths warn `GEN_ROUTE_DUPLICATE`. The preview shows a marked preview-only Back bar at depth 2 or more; hardware back wiring belongs to the Stage 12 Expo scaffold. The mini-mail example (shell, inbox, `mail/:id` detail over the shared MailService, wildcard not-found reached through a deliberately stale link) proves the flow in generated code and in the interactive preview.

## Stage 10: Pickers and overlays

Status: built in this change.

Angular ground: Angular Material datepicker, dialog, bottom sheet and snack bar components.

The stage adds a date and time picker with date mode, time mode and combined mode, plus a bottom sheet, a dialog and a snackbar. The picker uses the iOS wheel look in every mode. Overlay behaviour follows the Material patterns Angular developers already know, rendered for a phone screen.

As built: the picker is a dedicated `<datetime-picker>` block, the documented native adaptation of the Material datepicker's input, toggle and calendar popup. It follows Bigyan's product rule on every platform: iOS style wheels inside a bottom sheet, never a calendar grid and never an Android style dialog. Date mode has month, day and year wheels (years from the value year minus 25 to plus 25); time mode has hour 1 to 12, minute and AM/PM wheels; datetime mode has one combined date wheel (183 days either side of the value) plus hour, minute and AM/PM. `[value]` accepts an ISO string or a Date, Done emits the composed ISO string through `(change)`, Cancel discards, `minuteInterval` is 1 or 5 with warn and snap (`GEN_PICKER_INTERVAL`), and an unknown mode is a `GEN_PICKER_MODE` error. The value model lives in `@rangular/ui` `datetime.ts` and is parity-tested against the preview mirrors. MatBottomSheet and MatDialog become declarative blocks, `<sheet>` and `<dialog>`, driven by `[open]` and `(close)` with children rendered inside the panel, dialog buttons grouped in an `<actions>` row, backdrop taps emitting `(close)`, and a `GEN_OVERLAY_OPEN` warning for an unbound overlay. The stage also settled event assignments from the code: the template expression grammar has no assignment operator, so assignment bindings warn `GEN_EVENT_ASSIGNMENT` and are dropped everywhere; authors call a method that assigns inside the class. MatSnackBar keeps its service shape through the built-in `SnackBar` injection (components only): `open(message, actionLabel?, durationMs = 4000)` returns a ref, the generated root renders the `RgSnackbar` host, and the statement form (`const ref = ...; ref.onAction(() => { ... });`) is the supported action subscription. The reminder example (form, picker, repeat sheet, confirm dialog, Undo snackbar) proves the four pieces in generated code and in the interactive preview, where the wheels are clickable lists with the same selected value outcome.

## Stage 11: Data display

Status: built in this change.

Angular ground: Angular Material tabs, expansion panels, table, autocomplete, slider, progress indicators, chips and badge.

The stage adds tabs, an accordion, a table, autocomplete, a slider, progress display, chips and a badge. Each item follows the most loved version of its component class and stays in Angular style at the source level.

As built: tabs are `<tabs [index] (change)>` with `<tab label>` children that own their content (rendered only while selected), which is what separates them from the Stage 6 switcher, a bare control with no panels; both follow the controls contract. Expansion panels are self-managed `<panel title subtitle>` blocks: `[expanded]` is a starting seed, `(toggle)` emits the next boolean, and `<accordion>` coordinates its direct panels single-open by injecting internal props from the group primitive, so templates stay plain panels and the first seeded open panel starts open. The table compresses mat-table to `<table [data]>` with `<column name header>` declarations: `name` is the matColumnDef name (`key` is an accepted alias, since React reserves `key`), cells are `String(value)`, a missing name is `GEN_TABLE_COLUMN`, empty data renders nothing unless the table carries `emptyText`, and column templates, sorting and pagination stay roadmap items. Autocomplete extends `RgInput` and the input renderer: `[options]` binds a string array, options filter by case-insensitive substring while the field is focused, a pick writes back through the ngModel path and emits `(optionSelected)`; object options with `displayWith` are not in this version. The slider snaps to `step` and clamps to `min`/`max` (static `min >= max` is a `GEN_SLIDER_RANGE` error, `step <= 0` warns and uses 1), emitting on release and on tap; the preview renders tappable step ticks when the range holds at most 20 steps. The progress bar clamps into 0 to 100 (`GEN_PROGRESS_RANGE` when statically out of range) and `mode="indeterminate"` sweeps in the app and paints a static 40 percent bar in the preview; the spinner rotates a 270 degree SVG arc shared as one constant by the primitive, the server paint and the page runtime, with its `size` on the icon scale (`GEN_SPINNER_SIZE`). Chips are `<chip icon removable (remove)>` pills in a `<chips>` row, and chip removal from a list works because the method translator carries a filter assignment (`this.filters = this.filters.filter(...)`). The badge is matBadge as an attribute on `<button>`, `<row>` and `<icon>` only: 0 or empty renders nothing, above 99 renders `99+`, other hosts warn `GEN_BADGE_HOST` and drop it. Misplaced declarations warn `GEN_CONTROL_NESTING`. The mailbox-pro example (tabs with two mail lists, a Storage and Sync accordion, a folders table, a move-to-folder autocomplete, a preview lines slider, removable filter chips, unread badges) proves all seven in generated code and in the interactive preview.

## Stage 12: Language completeness and app readiness

Status: built in this change.

Angular ground: the Angular guides for pipes, attribute directives and content projection with `ng-content`.

The stage adds custom pipe classes, attribute directives, the full set of built in pipes and content projection. It also makes app building real: `rangular init` produces a runnable Expo app scaffold, the closing security re-audit runs over the whole system, and a fresh AI proof test builds an app from the docs alone. When this stage lands, a user can make an app using Rangular, and that is the point where Bigyan is notified.

As built: the built-in pipe set is complete (`uppercase`, `lowercase`, `titlecase`, `json`, `date` with named and custom formats, `number` and `percent` with digitsInfo, `currency` with a five-code symbol table, `slice`, `keyvalue` sorted by key, and `async`), and one three-way parity table pins the compiler's evaluator, the generated code's runtime `pipe()` and the preview page to identical results, leap dates and rounding included. Custom `@Pipe` classes resolve through imports exactly like children and services: `transform` compiles in service mode onto a plain class with one shared instance, an unregistered name is a `PIPE_UNKNOWN` error listing every known pipe, and the preview runs single-return transforms in its static paint and the full translated body in the interactive page. The `async` pipe subscribes for real in generated code (one state slot and effect per distinct streamed expression, unsubscribing on unmount, the expression captured at mount) and in the preview page (one subscription per observable, re-render on emission); the runtime `pipe('async', ...)` keeps the synchronous snapshot form for tests and template evaluation. Attribute directives ship as the honest subset of the canonical HighlightDirective shape: `@Input` fields, an injected `ElementRef`, and `ngOnInit` or single-input setter bodies made only of `this.el.nativeElement.style.<prop> = <expr>` assignments, folded into the host's style at compile time in codegen and in both preview layers; anything else warns `DIR_UNSUPPORTED` with the offending statement quoted. Content projection is the single default slot: `<ng-content>` compiles to the React `children` prop, projected content keeps the parent's scope everywhere, and a `select` attribute warns `PROJECTION_SELECT_UNSUPPORTED` and behaves as the default slot. The pipes-demo, directives-demo and projection-demo examples prove the three in generated code and in the interactive preview. For app readiness, `rangular init <name> --app` scaffolds a real Expo app: a bare name lands in the checkout's `apps/` folder (unsafe bare names refused with `CLI_INIT_UNSAFE`), an explicit path is used as given, `package.json` carries the Expo SDK 54 pin set plus `file:` dependencies computed relative to the checkout's packages, `metro.config.js` is the standard monorepo config, and the starter component is compiled into `src/AppRoot.tsx` by the real compiler during init. What was verified is the scaffold's structure and compilation, including a rebuild inside the scaffolded app; an actual Expo Go launch on a device was not run in this environment, and the scaffold README says so plainly. Hardware back is stated just as plainly: in-app navigation is complete, the hardware button is not wired to the navigator in this version because the compiled root module keeps it private. The closing security re-audit re-ran the Stage 5 method over the Stage 6 to 12 surface and found one High: a static `minlength` or `maxlength` attribute was emitted raw into the generated validators call and could inject code; static validator arguments are now digits-only data, with `GEN_VALIDATOR_ARG` for anything else. Icon names, routerLink strings, routes file contents, pattern attributes, datetime values, autocomplete options, badge values, custom pipe names, projection children and scaffold paths were each fixture-tested and are recorded in SECURITY.md as checked with no finding.
