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
| M5 | Child components, `@Input` / `@Output` | ⏳ `@Input`/`@Output` are extracted; wiring is Stage 3 |
| M6 | Injected service + lifecycle | ⏳ Runtime `Container` exists; bridging is Stage 3 |
| M7 | CLI, source maps, error messages, Awaken Me dogfood | 🔶 CLI exists (`build` / `ast` / `preview`); source maps + dogfood pending |

## Packages

| Package | What it is |
|---|---|
| `@rangular/compiler` | Template parser + expression (Pratt) parser, `@Component` extractor (TypeScript compiler API), CSS-subset parser, RN code generator, HTML preview renderer |
| `@rangular/runtime` | Pure-TypeScript helpers for generated apps: `EventEmitter`, `signal()`, DI `Container`, `pipe()` |
| `@rangular/ui` | Rangular Material: `tokens.ts` (pure TS) + shipped-source RN primitives (`RgScreen`, `RgAppbar`, `RgCard`, `RgButton`, `RgText`, `RgList`, `RgRow`, `RgFab`) |
| `@rangular/cli` | `rangular build`, `rangular ast`, `rangular preview` |

> Note: `@rangular/ui` primitives and other shipped-source files for generated
> apps are **source shipped into generated projects**; they are not typechecked
> by this repo's build, because react-native types are not a dependency here.
> The compiler, CLI, runtime helpers, UI tokens and all tests *are* built and
> tested by the root build.

## Build, test, run the example

```sh
npm install
npm test          # builds with tsc, then runs node --test over dist/tests

# Compile the hello example (Angular -> React Native TSX)
node dist/packages/cli/src/cli.js build examples/hello/hello.component.ts --out examples/hello/hello.component.tsx

# Print a template AST (M0)
node dist/packages/cli/src/cli.js ast examples/hello/hello.component.html

# Render the dev preview used for visual eye-checks
node dist/packages/cli/src/cli.js preview examples/hello/hello.component.ts --out examples/hello/preview.html
```

The committed `examples/hello/hello.component.tsx` and
`examples/hello/preview.html` are the golden outputs of the two commands
above; the golden-file test keeps them honest.

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
