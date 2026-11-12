# Rangular: Block Diagram

**Angular code, transpiled to React Native.**
Prepared for Bigyan, 2026-11-12. Companion to `angular-to-react-native-pinpoint-map.md` and `rangular-learning-list.md` (the 77 things).

**The one line to remember:** Rangular's target is React Native JavaScript / JSX, never bytecode. Hermes makes the bytecode itself. You build only the middle; both ends already exist, and you already know both.

## The diagram

```mermaid
flowchart TB
    subgraph L1["1 · YOU WRITE: src/ (Angular skill you already have)"]
        A1["Components & classes<br/>.component.ts<br/>@Component · @Input · @Output<br/>fields = state · methods = actions<br/>ngOnInit / ngOnDestroy"]
        A2["Templates<br/>.component.html<br/>{{ }} · [prop] · (event)<br/>*ngIf · *ngFor · pipes · #ref"]
        A3["Services & styles<br/>.service.ts + providers<br/>@Injectable · constructor DI<br/>HttpClient.get(...) · .css subset"]
    end

    subgraph L2["2 · YOU BUILD: @rangular/compiler + CLI (standalone, NOT an Angular fork)"]
        B1["1 · CLI & Loader<br/>rangular build / watch / init<br/>ts.Program · tsconfig · module resolution<br/>incremental cache"]
        B2["2 · Two parsers<br/>Class parser: TS AST → decorator metadata<br/>Template parser: Lexer → Parser → Template AST<br/>Pratt parser for {{ expressions }}"]
        B3["3 · Analyzer<br/>symbol table & scope · two-pass<br/>type-checker basics · diagnostics<br/>with source file / line / column"]
        B4["4 · IR + Transformer<br/>intermediate tree · desugar *ngIf / *ngFor<br/>pipes → calls · ng-content → children<br/>constant folding"]
        B5["5 · Code Generator<br/>emits readable .tsx + StyleSheet<br/>+ source maps back to source line"]
        B1 --> B2 --> B3 --> B4 --> B5
    end

    subgraph L3["3 · YOU BUILD: @rangular/runtime (small, pure JS)"]
        C1["Signal → State bridge<br/>useSyncExternalStore"]
        C2["DI container<br/>providers → React Context"]
        C3["HttpClient backend<br/>RN fetch → Observable<br/>subscribe / async pipe unchanged"]
        C4["Lifecycle & events shim<br/>ngOnInit → effect · ngOnDestroy → cleanup<br/>@Output → callback props + EventEmitter"]
    end

    subgraph L4["4 · OUTPUT: .generated/ (never hand-written)"]
        D1["Function components .tsx<br/>hooks · state hoisted to<br/>useState / useRef"]
        D2["Views & lists<br/>div → View · span/p → Text<br/>*ngFor → map() with stable keys<br/>*ngIf → ternary / early return"]
        D3["StyleSheet objects<br/>CSS subset → StyleSheet<br/>[ngClass] → style arrays<br/>unsupported CSS: warn & drop"]
    end

    subgraph L5["5 · ALREADY EXISTS: do not build"]
        E1["Metro + Expo<br/>bundle · Fast Refresh<br/>npm start → QR → Expo Go"]
        E2["Hermes<br/>JavaScript → .hbc bytecode<br/>(the bytecode step, not yours)"]
        E3["Fabric + Yoga + JSI<br/>native view tree · flex layout<br/>→ real iOS & Android views"]
        E1 --> E2 --> E3
    end

    L1 --> L2
    B5 -->|"generated code imports"| L3
    B5 --> L4
    L3 --> L4
    L4 --> L5

    W["DEV LOOP<br/>save → watch recompiles changed file only → Metro reloads phone"]
    T["PROOF<br/>golden-file tests · AST unit tests · Expo smoke test<br/>Dogfood: one Awaken Me component (Dinacharya row) = M7"]
    L2 -.-> W
    L2 -.-> T
```

## Reading it, layer by layer

| Layer | What it is | Yours? |
|---|---|---|
| 1 · Source | Angular-style code: components, templates, services/DI, CSS subset | Write it, skill already yours |
| 2 · Compiler | CLI/loader → two parsers → analyzer → IR/transformer → code generator + source maps | **Build it, the whole project lives here** |
| 3 · Runtime | Tiny JS library every generated file imports: signal→state bridge, DI container, HttpClient-on-fetch backend, lifecycle/EventEmitter shims | Build it, small |
| 4 · Output | Generated React Native/Expo project in `.generated/`: function components, hooks, StyleSheet | Never hand-write; debug via source maps |
| 5 · RN toolchain | Metro bundling, Hermes bytecode (`.hbc`), Fabric/Yoga/JSI native rendering | Already exists, understand the picture only |

## Decisions already settled (from the 2026-11-12 discussion)

- **Do NOT fork Angular.** Giant Bazel monorepo; a fork burns effort on navigation and goes stale every release. Standalone transpiler using Angular's public pieces (TypeScript compiler API) instead.
- **Do NOT emit Hermes bytecode directly** and **do NOT write a TypeScript parser**, both are solved problems with zero user-visible gain.
- **HTTP:** Angular code is unchanged. Rangular registers a different HttpClient backend under the same DI token, built on React Native `fetch`, results wrapped as an Observable. No CORS on native; URLs must be absolute; cookies do not come free.
- **Dev loop:** `npm start` = Rangular compiler in watch mode (transpiling `src/` into the generated Expo project) + Metro. Scanning the QR in Expo Go runs it, because the runtime is pure JavaScript. A dev build is needed only if a library requiring custom native code is added.
- **Out of v1 scope:** full Angular compatibility (forms, animations, SSR, full RxJS surface), a routing library (map to React Navigation later).

## Build order (milestones)

M0 AST printer → M1 static component renders on phone → M2 interpolation + property binding → M3 counter (events + state) → M4 `*ngIf` / `*ngFor` → M5 child components, inputs/outputs → M6 injected service + lifecycle → M7 CLI, source maps, real error messages + Awaken Me dogfood demo.
