# AGENTS.md — working in the Rangular repo

Rangular is a standalone transpiler: you write Angular-style code
(TypeScript classes with `@Component`, HTML-like templates) and it compiles
to React Native `.tsx`. The target is RN JavaScript/JSX — Hermes makes the
bytecode. Rangular does not fork Angular and does not parse TypeScript by
hand (it uses the TypeScript compiler API).

**Before writing any Rangular source, read the delta tables in
[docs/VIBE_CODING.md](docs/VIBE_CODING.md)** — Rangular looks like Angular
but is a subset of it, and it is not React. The machine-readable list of
everything you may use is [catalog.md](catalog.md) / `catalog.json`.

## Repo map

| Path | What lives there |
|---|---|
| `packages/compiler/src/` | The compiler: template parser (`template/`), `@Component` extractor (`class/`), CSS subset (`style/`), RN code generator (`codegen/`), HTML preview renderer (`preview/`), catalog generator (`catalog.ts`), pipeline (`compile.ts`) |
| `packages/cli/src/cli.ts` | The `rangular` CLI: `build`, `ast`, `preview`, `catalog` |
| `packages/runtime/src/index.ts` | Pure-TS helpers for generated apps: `EventEmitter`, `signal()`, `Container`, `ReactiveService` (base class generated services extend), `HttpClient` (Observable-lite over fetch), `pipe()` |
| `packages/ui/src/tokens.ts` | Rangular Material design tokens (pure TS, part of the build) |
| `packages/ui/src/primitives.tsx` | RN primitives (`RgScreen`, `RgAppbar`, `RgCard`, `RgButton`, `RgText`, `RgList`, `RgRow`, `RgFab`) — shipped source for generated apps, deliberately excluded from this repo's `tsc` build |
| `examples/hello/`, `examples/counter/`, `examples/inbox/`, `examples/profile/`, `examples/favourite/`, `examples/shared-inbox/` | Tiny single-capability examples, each with a recipe-card `README.md`, golden generated `.tsx` and `preview.html` (profile is the Stage 2.5 proof-test example: written from these docs alone; favourite = child components, shared-inbox = services/DI/lifecycle) |
| `tests/` | `node:test` suites — parser, expressions, codegen, methods, runtime, tokens, catalog/vibe layer, Stage 3 (children, services, HttpClient, preview behaviour via a DOM shim) |
| `docs/` | `PINPOINT_MAP.md` (design map), `LEARNING_LIST.md` (the 77 things), `BLOCK_DIAGRAM.md` (architecture), `UI_POLISH.md` (polish system), `VIBE_CODING.md` (AI-facing layer + delta tables) |
| `catalog.json`, `catalog.md` | GENERATED from the code by `rangular catalog` — never hand-edit |
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
```

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
   Do not invent new tags, props or events — if a block is missing, add it
   to the mapping + primitives + catalog properly instead of working around it.
5. **Unsupported constructs produce coded diagnostics, never broken
   output.** Add the code to `DIAGNOSTIC_CODES` in
   `packages/compiler/src/diagnostics.ts`, give it a concrete `fix:`
   suggestion, and degrade with a warning + TODO comment in generated code —
   following the existing `METHOD_UNSUPPORTED` / `GEN_NGIF_ELSE_TODO` pattern.
