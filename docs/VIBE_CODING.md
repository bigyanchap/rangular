# Rangular — Vibe-Coding Layer

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
   every doc, example and package — the front door for any AI.
3. **Recipe cards:** a `README.md` beside every example with a fixed shape —
   *Intent* · *Source* · *What it compiles to* · *Rules used* ·
   *Common mistakes*.
4. **Generated catalog (`rangular catalog`):** emits `catalog.json` +
   `catalog.md` **from the actual code** — the tag mapping from codegen's
   exported `TAG_MAP`, primitive props parsed from
   `packages/ui/src/primitives.tsx` with the TypeScript compiler API
   (the primitives are shipped source typed `any`, so their destructured
   parameter patterns are the reliable source of prop names), token scales
   imported from `@rangular/ui` tokens, and the `DIAGNOSTIC_CODES` list.
   A test regenerates the catalog and fails if the committed files are stale.
5. **JSON diagnostics:** `rangular build --json` (and `preview --json`)
   prints a single JSON object — `{ ok, file, outFile?, diagnostics:
   [{ severity, code, message, line, column, fix }] }` — to stdout and
   nothing else, so an AI loop can read an error and fix its own source.
6. **Error messages that teach:** every diagnostic carries a `fix:` line
   with the concrete corrected pattern, in human output and in JSON.

## The delta — what an AI must know

AIs already know Angular and React from training. Rangular source *looks*
like Angular, so the main job of these docs is enumerating the **delta**:
where Rangular is the same, and where it is not (yet). Both tables state
the repo's actual behaviour today (Stage 2.5), not aspirations.

### Rangular source vs Angular

**The same** — write it exactly as you would in Angular:

| Angular feature | In Rangular source |
|---|---|
| `@Component` decorator (selector, templateUrl, inline template, styles, styleUrls) | Same; read by the TypeScript compiler API |
| `@Input()` / `@Output()` field decorators | Extracted; `@Input` fields become generated-component props |
| Templates in separate `.html` files | Same |
| `{{ interpolation }}`, `[prop]` binding, `(event)` binding, `*ngIf`, `*ngFor` syntax | Same syntax, same meaning |
| Pipes in expressions (`expr \| uppercase`) | Parsed; built-ins `uppercase`, `lowercase`, `titlecase`, `json` evaluate in preview/runtime |
| Class fields as state, methods as actions | Same — this is the core model |
| Lifecycle *names* (`ngOnInit`, …) | You may write them — see "not wired" below before relying on them |

**Not supported yet** — do not use these in Rangular source today:

| Angular feature | Status today | Planned |
|---|---|---|
| `[(ngModel)]` / forms | Not supported. `[(x)]` syntax is *parsed* but degrades to a one-way `[x]` prop binding — no write-back, no forms model | Later stage (post-v1 scope) |
| Two-way binding `[(...)]` generally | Same as above: one-way prop binding only, no change event is generated | Later stage |
| Routing (`@angular/router`, `<router-outlet>`) | Not supported — no router exists; a dashed/unknown tag is passed through or warns | Later (map to React Navigation) |
| NgModules (`@NgModule`) | Not supported. Only `@Component` classes are entry points; an `@NgModule`/`@Injectable` file errors with `CLS_NO_COMPONENT` | Not planned as modules; DI bridging is Stage 3 |
| Dependency injection (constructor injection, `providers`, `@Injectable` services) | Not wired. Constructors are not read; the runtime `Container` class exists but generated code does not use it yet | Stage 3 (M6) |
| Lifecycle hooks (`ngOnInit` / `ngOnDestroy` actually being *called*) | Not wired. A hook is translated as an ordinary method and is never invoked by the generated component | Stage 3 (M6) |
| Animations (`@angular/animations`, `:enter`/`:leave`) | Not supported anywhere in the compiler | Post-v1 |
| SSR / hydration | Not supported — output is a React Native app, there is no server rendering | Not planned |
| Full RxJS surface (Observables, `subscribe`, operators) | Not supported in source. The runtime `async` pipe is currently a pass-through stub; generated code does not bridge Observables to state | Stage 3 will bridge Observables for HttpClient |
| Custom pipes (`@Pipe` classes) | Not read. Only the built-in pipes above exist | Later stage |
| `*ngIf` with `else` / `then` | Detected, warns `GEN_NGIF_ELSE_TODO`, element emitted unconditionally. Workaround: two elements, `*ngIf="cond"` and `*ngIf="!(cond)"` | Later stage |
| Full CSS (cascade, inheritance, descendant/id/pseudo selectors, unsupported properties) | Subset only: element and `.class` selectors, a fixed property list; anything else warns (`CSS_SELECTOR` / `CSS_UNSUPPORTED`) and is dropped. Styles apply per element — no cascade | Subset may grow per stage |

### Rangular source vs React

Rangular source is **not React**. Do not write React in it:

| React concept | In Rangular source |
|---|---|
| Components | TypeScript **classes** with `@Component`, never function components |
| Markup | A separate `.html` **template file** (or inline template string). **No JSX anywhere in source** |
| State | Plain **class fields** (`count = 0`). **No hooks, no `useState`, no `useEffect` in source** — the compiler *generates* a function component with hooks underneath |
| Updating state | Mutate the field inside a method: `this.count++`. A field assigned inside any method becomes `useState` in the output; a field never assigned stays a plain constant |
| Events | Angular syntax: `(click)="increment()"` — never `onPress`/`onClick` props in source. The compiler maps `click → onPress`, `change → onChange`, `submit → onSubmit`, `input` on `<input> → onChangeText` |
| Conditionals / lists | `*ngIf` / `*ngFor` in templates — never `&&`, ternaries or `.map()` in source (those appear only in generated output) |
| Generated `.tsx` | **Output, never source.** Never edit it; change the `.ts`/`.html` and regenerate. Golden `.tsx`/`preview.html` files in `examples/` are regenerated by the CLI, not hand-edited |
| Styling | Component `styles` in the CSS subset, or design tokens — never `StyleSheet` in source; `StyleSheet.create` exists only in generated output |

## Supported template expressions

The expression language inside `{{ }}`, `[prop]="..."`, `*ngIf="..."` and
method bodies is a defined subset — do not assume all of TypeScript:

- Identifiers and member access: `title`, `m.from`, `mails.length`
- Literals: strings (`'Follow'`), numbers, `true` / `false`, arrays/objects in
  field initializers
- Arithmetic `+ - * / %`, comparison `== === != !== < > <= >=`, logic `&& ||`
- Unary `!` and `-` — including on the right-hand side of an assignment:
  `this.following = !this.following` is supported and is the toggle pattern
- Ternary: `following ? 'Following' : 'Follow'` — supported in interpolation
  and bindings; you do not need two `*ngIf` elements for a two-state label
- Method calls: `increment()`, `save($event)`; calls on members of fields
- Pipes: `uppercase`, `lowercase`, `titlecase`, `json` — an unknown pipe is
  an error, not a silent pass-through

## Block semantics and composition

- Blocks compose freely, like HTML: a `<button>` inside a `<card>`, a
  `<row>` inside a `<card>`, headings and paragraphs anywhere a screen or
  card can hold children. There is no separate permission table per parent.
- A block stores **one** structural directive: never put `*ngIf` and
  `*ngFor` on the same element — nest one inside the other instead.
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
  row's `subtitle` — row lines are single-line list text and may truncate;
  `<p>` wraps.

## The proof test

Vibe-conduciveness is proven by doing, not claiming: a fresh AI session is
given **only** `llms.txt`, the catalog, and the recipe cards — no compiler
source — plus one sentence ("Build a profile card screen: avatar, name, a
follow button that toggles to Following, and a list of three posts"). Its
source must compile with zero errors and its preview must render and toggle.
Anything it had to guess is a docs bug, and the gap is fixed in the docs.

## Standing rule for every later stage

Every new capability ships with, in the same commit: the tiny example, its
recipe card, the catalog regeneration, and its tests. A capability without
its recipe card is not done — the same way a fix without tests is not done.
