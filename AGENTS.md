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
| `packages/cli/src/cli.ts` | The `rangular` CLI: `build` (with `--json`, `--source-map`), `ast`, `preview`, `catalog`, `watch`, `init`, `doctor` (the polish linter lives in `packages/compiler/src/doctor.ts`) |
| `packages/runtime/src/index.ts` | Pure-TS helpers for generated apps: `EventEmitter`, `signal()`, `Container`, `ReactiveService` (base class generated services extend), `HttpClient` (Observable-lite over fetch), `pipe()` |
| `packages/ui/src/tokens.ts` | Rangular Material design tokens (pure TS, part of the build) |
| `packages/ui/src/primitives.tsx` | RN primitives (`RgScreen`, `RgAppbar`, `RgCard`, `RgButton`, `RgText`, `RgList`, `RgRow`, `RgFab`) plus the theme context (`RgThemeProvider`, `useRgTheme`); all colours come from the active theme, shipped source for generated apps, deliberately excluded from this repo's `tsc` build |
| `examples/hello/`, `examples/counter/`, `examples/inbox/`, `examples/profile/`, `examples/favourite/`, `examples/shared-inbox/`, `examples/showcase/`, `examples/dinacharya-row/` | Tiny single-capability examples, each with a recipe-card `README.md`, golden generated `.tsx`, `preview.html` and a `styles.snapshot.json` style golden (profile is the Stage 2.5 proof-test example: written from these docs alone; favourite = child components, shared-inbox = services/DI/lifecycle, showcase = tokens/theming/snapping, dinacharya-row = the Stage 5 dogfood example: one real Awaken Me row) |
| `tests/` | `node:test` suites, parser, expressions, codegen, methods, runtime, tokens, catalog/vibe layer, Stage 3 (children, services, HttpClient, preview behaviour via a DOM shim), Stage 4 (token completeness, primitives hex guard, CSS snapping, preview theme toggle, no-em-dash guard), Stage 5 (per-file diagnostics, source maps, watch, init, doctor, style snapshot goldens, preview parity guard, dogfood behaviour) |
| `docs/` | `PINPOINT_MAP.md` (design map), `LEARNING_LIST.md` (the 77 things), `BLOCK_DIAGRAM.md` (architecture), `UI_POLISH.md` (polish system), `VIBE_CODING.md` (AI-facing layer + delta tables) |
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
