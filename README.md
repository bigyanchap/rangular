# Rangular

**Write Angular code, compile React Native code.**

Rangular is a standalone transpiler: you write Angular-style code — TypeScript
classes with `@Component`, HTML-like templates, dependency injection — and
Rangular compiles it to React Native `.tsx`. The transpiler's target is React
Native JavaScript/JSX; **Hermes compiles that JavaScript to bytecode itself**,
so Rangular never emits bytecode, never forks Angular, and never parses
TypeScript by hand (it uses the official TypeScript compiler API).

Polish is a system, not luck: simple blocks compile to pre-polished
**Rangular Material** primitives driven by design tokens — see
[docs/UI_POLISH.md](docs/UI_POLISH.md). The full architecture is in
[docs/BLOCK_DIAGRAM.md](docs/BLOCK_DIAGRAM.md).

## Install and run

Prerequisites: **Node.js 20+ and npm** (the compiler itself has exactly
two dependencies: `typescript` and `@types/node`).

```sh
git clone https://github.com/bigyanchap/rangular.git
cd rangular
npm install
npm test          # builds with tsc, then runs the whole test suite
```

`npm test` also builds the compiler into `dist/`. Then try the examples:

```sh
# Compile the hello example (Angular -> React Native TSX)
node dist/packages/cli/src/cli.js build examples/hello/hello.component.ts --out examples/hello/hello.component.tsx

# Print a template AST (M0)
node dist/packages/cli/src/cli.js ast examples/hello/hello.component.html

# Render the dev preview used for visual eye-checks
node dist/packages/cli/src/cli.js preview examples/hello/hello.component.ts --out examples/hello/preview.html
```

Open `examples/hello/preview.html` in a browser: it is a working preview
of the compiled screen, and it is interactive — buttons run the
component's real translated methods, `*ngIf` / `*ngFor` respond to state,
child components render and emit, services are shared live. The committed
`examples/hello/hello.component.tsx` and `examples/hello/preview.html`
are the golden outputs of the commands above; the golden-file tests keep
them honest.

## Block diagram

```mermaid
flowchart TB
    subgraph L1["1 · YOU WRITE — src/"]
        A1["Components & classes<br/>.component.ts<br/>@Component · @Input · @Output"]
        A2["Templates<br/>.component.html<br/>{{ }} · [prop] · (event)<br/>*ngIf · *ngFor · pipes · #ref"]
        A3["Services & styles<br/>@Injectable · DI · HttpClient · .css subset"]
    end
    subgraph L2["2 · YOU BUILD — @rangular/compiler + CLI (standalone, NOT an Angular fork)"]
        B1["1 · CLI & Loader"] --> B2["2 · Two parsers<br/>TS AST + Template AST"] --> B3["3 · Analyzer<br/>diagnostics with source line"] --> B4["4 · IR + Transformer"] --> B5["5 · Code Generator<br/>+ source maps"]
    end
    subgraph L3["3 · YOU BUILD — @rangular/runtime"]
        C1["Signal → State bridge"] --- C2["DI container"] --- C3["HttpClient backend"] --- C4["Lifecycle & events shim"]
    end
    subgraph L4["4 · OUTPUT — generated React Native / Expo project"]
        D1["Function components .tsx"] --- D2["Views & lists"] --- D3["StyleSheet objects"]
    end
    subgraph L5["5 · ALREADY EXISTS — do not build"]
        E1["Metro + Expo"] --> E2["Hermes → .hbc bytecode"] --> E3["Fabric + Yoga + JSI → native views"]
    end
    L1 --> L2 --> L3 --> L4 --> L5
```

## Stage status

| Milestone | Scope | Status |
|---|---|---|
| M0 | Template AST + AST printer | ✅ Done (Stage 0+1) |
| M1 | Static component transpiles | ✅ Done (Stage 0+1) |
| M2 | Interpolation `{{ }}` + `[prop]` binding | ✅ Done (Stage 0+1) |
| M3 | Events + state (counter) | ✅ Done (Stage 2) |
| M4 | `*ngIf` / `*ngFor` | ✅ Done (Stage 2) |
| — | **Stage 2.5: Vibe layer** — `AGENTS.md`, `llms.txt`, generated catalog, recipe cards, `--json` diagnostics with `fix:` lines, delta tables | ✅ Done |
| M5 | Child components, `@Input` / `@Output` | ✅ Done (Stage 3) |
| M6 | Injected service + lifecycle + HttpClient | ✅ Done (Stage 3) |
| M7 | CLI, source maps, error messages, Awaken Me dogfood | 🔶 CLI exists (`build` / `ast` / `preview`); source maps + dogfood pending |

## Packages

| Package | What it is |
|---|---|
| `@rangular/compiler` | Template parser + expression (Pratt) parser, `@Component` extractor (TypeScript compiler API), CSS-subset parser, RN code generator, HTML preview renderer |
| `@rangular/runtime` | Pure-TypeScript helpers for generated apps: `EventEmitter`, `signal()`, DI `Container`, `ReactiveService` (service reactivity base), `HttpClient` (Observable-lite over fetch), `pipe()` |
| `@rangular/ui` | Rangular Material: `tokens.ts` (pure TS) + shipped-source RN primitives (`RgScreen`, `RgAppbar`, `RgCard`, `RgButton`, `RgText`, `RgList`, `RgRow`, `RgFab`) |
| `@rangular/cli` | `rangular build`, `rangular ast`, `rangular preview`, `rangular catalog` (build/preview accept `--json`) |

> Note: `@rangular/ui` primitives and other shipped-source files for generated
> apps are **source shipped into generated projects**; they are not typechecked
> by this repo's build, because react-native types are not a dependency here.
> The compiler, CLI, runtime helpers, UI tokens and all tests *are* built and
> tested by the root build.

## Docs

- [docs/PINPOINT_MAP.md](docs/PINPOINT_MAP.md) — the design map: the goal
  stated precisely, the finished thing in blocks, and where the work is.
- [docs/LEARNING_LIST.md](docs/LEARNING_LIST.md) — the exact 77 things to
  learn to build Rangular (groups A–H), and nothing more.
- [docs/BLOCK_DIAGRAM.md](docs/BLOCK_DIAGRAM.md) — the architecture in
  five layers, with the Mermaid diagram (also inline above).
- [docs/UI_POLISH.md](docs/UI_POLISH.md) — how generated UI stays
  polished: tokens only, pre-polished primitives, compiler defaults,
  visual proof.
- [docs/VIBE_CODING.md](docs/VIBE_CODING.md) — the AI-facing layer plus
  the full delta tables (Rangular vs Angular, Rangular vs React).

All documentation is Markdown on purpose: GitHub renders the Mermaid
diagrams natively, diffs and search work, and AI tools read it directly.
Markdown is the canonical format — there are no PDF copies to drift.

## Vibe-coding ready

Rangular is built to be written by AI assistants (and humans working
through them) **without guessing** — see [docs/VIBE_CODING.md](docs/VIBE_CODING.md):

- **[AGENTS.md](AGENTS.md)** — the rules of this repo: never edit generated
  files; every capability ships with compiler support + tests + a tiny
  example + a recipe card + a regenerated catalog.
- **[llms.txt](llms.txt)** — one AI-readable index of every doc, example
  and package, including the 6-step "how to build a screen" loop.
- **[catalog.md](catalog.md) / `catalog.json`** — every tag, event,
  primitive prop, token scale and diagnostic code, **generated from the
  code** by `rangular catalog` (a test fails if the committed catalog is stale):

  ```sh
  node dist/packages/cli/src/cli.js catalog --out .
  ```

- **Recipe cards** — `examples/hello/README.md`,
  `examples/counter/README.md`, `examples/inbox/README.md`,
  `examples/profile/README.md`, `examples/favourite/README.md`,
  `examples/shared-inbox/README.md`: Intent /
  Source / What it compiles to / Rules used / Common mistakes.
- **Proof test (Stage 2.5)** — `examples/profile/` was written by a fresh
  AI agent given only AGENTS.md, llms.txt, the catalog and the recipe
  cards (no compiler source): it compiled with zero diagnostics on the
  first attempt, and every gap it reported was fixed in the docs
  (supported-expression list, avatar/row semantics, composition rules).
- **Machine-readable errors** — `rangular build --json` prints a single
  JSON object (`{ ok, outFile?, diagnostics[] }`) on stdout; every
  diagnostic carries a concrete `fix:` suggestion.
- **Delta tables** — [docs/VIBE_CODING.md](docs/VIBE_CODING.md) states
  exactly how Rangular source differs from Angular (what is the same,
  what is not supported yet, with stages) and from React (no JSX, no
  hooks in source — classes + HTML templates).

## Stage 2: events, state, `*ngIf` / `*ngFor`

Two more examples live beside `hello` — same CLI commands, same golden rule:

- `examples/counter/` — **M3.** A field assigned inside any method becomes
  React state (`count` → `const [count, setCount] = useState(0)`); fields
  never assigned stay plain `const`. Methods become const arrow functions,
  and `(click)` bindings become `onPress` props.
- `examples/inbox/` — **M4.** A `*ngFor` row over a literal `mails` array
  becomes a keyed `.map(...)`, and the `*ngIf` empty state becomes
  `{cond && (...)}`.

**Supported method-translation subset.** Method bodies are translated from
the TypeScript AST: `this.field` reads, assignments (`=`, `+=`, `-=`, `*=`,
`/=`), `this.field++` / `--`, `this.method(...)` calls, `$event` parameters,
expression statements, `return`, `if` / `else`, blocks, and local
`const`/`let` declarations. Anything else (loops, `try`, `switch`, …)
produces a `METHOD_UNSUPPORTED` warning and a `TODO` comment in the
generated code — it is never silently dropped and never emits broken
syntax. Field initializers composed of literals (including nested arrays
and objects) hoist to `const`/`useState`; other initializers keep the
warning + TODO behaviour.

**`else` in `*ngIf`** microsyntax is detected and reported
(`GEN_NGIF_ELSE_TODO`) with the element emitted unconditionally; full
else/then support is a later stage. `*ngFor` supports
`let item of items`, `let i = index`, and `trackBy: fnName`
(key = `fnName(item)`, otherwise `item?.id ?? i`).

**Interactive previews.** `rangular preview` now emits a *working* page for
Stage 2 components: literal fields become a JS `state` object, methods are
translated into functions that mutate it, and a small in-page runtime
(expression evaluator + DOM renderer over the serialized template AST)
re-renders on every `(click)`. `*ngIf` and `*ngFor` behave in the preview
as they will in React Native. The preview uses the compiler's own AST
expression evaluator (`packages/compiler/src/template/evaluate.ts`, with
built-in pipes `uppercase`, `lowercase`, `titlecase`, `json`) — no
`eval`/`Function` on source text anywhere.

## Stage 3: child components, services, lifecycle, HttpClient

Two more examples — same CLI commands, same golden rule:

- `examples/favourite/` — **M5.** A parent screen renders three
  `<quote-card>` children with `*ngFor`; each child takes `@Input() quote`
  / `@Input() author` and has `@Output() favourited`. Tapping a child's
  Save button emits, and the parent's "Saved: N" appbar count goes up.
- `examples/shared-inbox/` — **M6.** A `MailService` holds the inbox;
  the parent screen (list + "Mark all read") and a child `<unread-badge>`
  inject the *same* instance, so one tap updates the list and the badge.
  The badge's `loaded` flag is set by `ngOnInit`.

**Child components (M5).** Resolution follows the entry component's
relative imports, transitively: an imported `@Component` class is a known
child, keyed by its `selector`. `@Input` fields become props — the
literal initializer is the default when the parent omits the binding —
and plain attributes pass strings. An `@Output` field initialised with
`new EventEmitter<T>()` becomes a callback prop named `on` + Capitalised
name; `this.saved.emit(x)` in the child compiles to `onSaved?.(x)`, and
the parent's `(saved)="handler($event)"` receives the emitted value as
`$event`. Import cycles are a `CMP_IMPORT_CYCLE` warning (classes on the
cycle still resolve); a duplicated selector is `CMP_DUP_SELECTOR`.

**Services and DI (M6).** `@Injectable({ providedIn: 'root' })` classes
compile to real classes extending the runtime's `ReactiveService`, in the
same generated file as the components. A module-level `__container`
holds one singleton per service (registrations dependency-ordered;
services may inject services); components resolve constructor parameter
properties from it — `constructor(private mail: MailService)` becomes
`const mail = __container.get<MailService>(MailService)` plus a
`useSyncExternalStore` subscription, so when a service method assigns a
field (the codegen appends `this.__notify()` after each assignment) every
subscribed component re-renders. An unknown token is a
`DI_UNKNOWN_TOKEN` error with a fix; a service dependency cycle is
`DI_CYCLE`. Mutating items in place without assigning a field does not
notify — reassign the field.

**Lifecycle.** `ngOnInit()` is called from `useEffect(..., [])` (once,
after first render) and `ngOnDestroy()` from that effect's cleanup. The
preview runs a component's `ngOnInit` once when its instance is created;
the static first paint shows pre-init state on purpose.

**HttpClient.** The runtime ships an `HttpClient` whose `get(url)`
returns an Observable-lite (`{ subscribe(next?, error?) }`) over `fetch`
(the fetch implementation is injectable, so tests never touch the
network). It is registered in the generated container and injected like
any service. The supported component-side shape is exactly
`this.http.get(url).subscribe((data) => { this.field = data; });` —
block-bodied arrow, assignments inside. An expression-bodied assignment
degrades to `METHOD_UNSUPPORTED` instead of emitting wrong code. In
previews, `HttpClient` is a stub whose `get()` never emits.

**One file out.** Services, child components and the entry component all
compile into the entry's single generated `.tsx` — that is what makes
the container a true singleton, and it keeps generated output trivially
deterministic. A template whose root is a structural directive (or has
several roots) is wrapped in a `<>...</>` fragment so the output stays
valid JSX.
