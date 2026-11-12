# Pinpoint Map: An Angular-like language that transpiles to React Native

Prepared for Bigyan, 2026-11-12. This is the learning-engine exercise run by hand: goal in, exact map out.

## The goal, stated precisely

Build a small framework (call it the working name only) where a developer writes **Angular-style code**, TypeScript classes with decorators, HTML-like templates, dependency injection, and a transpiler turns it into **React Native** code. One clarification that shapes everything: React Native apps run JavaScript on the Hermes engine, and Hermes compiles that JavaScript to bytecode ahead of time. So the transpiler's target is React Native JavaScript/JSX plus its component model. Hermes does the bytecode step by itself. Emitting Hermes bytecode directly is a different, much larger project with no practical benefit.

## The finished thing, in blocks

1. **Source surface**, components (`@Component`), templates (`{{ }}`, `[prop]`, `(event)`, `*ngIf`, `*ngFor`), services and DI, lifecycle hooks.
2. **Template compiler**, template text → syntax tree → render instructions.
3. **Class compiler path**, reuses the TypeScript compiler; transforms decorator metadata into runtime configuration.
4. **Code generator**, emits React Native components: function components, hooks, props, StyleSheet styles.
5. **Reactivity bridge**, Angular's change detection has to become React state and re-rendering (signals map most cleanly).
6. **DI and lifecycle mapping**, providers → React context; `ngOnInit` / `ngOnDestroy` → `useEffect`.
7. **Style translation**, a CSS subset → React Native StyleSheet (no cascade; flex behaves differently).
8. **Tooling**, a small CLI, Metro bundling, source maps, and error messages that point back to the source template line, not to generated code.

## Your current position (diagnosis from your real work)

Already yours, no learning needed:

- **Angular from the inside as a user**, components, templates, DI, services, RxJS, change detection (Corteva Angular 15, LogicLync). This is the source language of the project; you already speak it.
- **TypeScript**, daily working depth.
- **The target platform**, React Native / Expo is your daily work in Awaken Me: components, hooks, styling, navigation, native builds. You know exactly what the output must look like.
- **HTML/CSS**, long-standing.

The interesting fact about this goal: **both ends of the bridge are already yours. The entire gap is the middle, the compiler.**

## The gap, in the exact order to learn it

Depths: **Use** = work with it through its API · **Build** = understand it well enough to construct it · **Edge** = settled mastery.

### A. How a compiler front end works: Build
Lexing, parsing, and the abstract syntax tree (AST). Everything else in this project is tree walking and tree writing.
*Proof task:* parse one tiny template (`<view><text>{{name}}</text></view>`) into an AST and print the tree.

### B. The TypeScript compiler API: Build
Do not write a TypeScript parser. The TS compiler already turns classes and decorators into an AST you can visit and transform.
*Proof task:* a script that reads one `@Component` class and prints its decorator metadata as a plain object.

### C. How Angular itself compiles templates (Ivy / AOT): Understand, then Build
Angular's own ahead-of-time compiler is the reference design: it turns templates into instruction code instead of interpreting them at runtime. Study what the compiler emits for one binding and one `*ngIf`, then imitate the shape at your scale.
*Proof task:* write down, in plain words, what Angular emits for `*ngIf`, then design your equivalent.

### D. Code generation to React Native: Build (the heart of the project)
Template AST → JSX/RN elements; interpolation → values; `[prop]` → props; `(event)` → handlers.
*Proof task:* a component whose template says `Hello {{name}}` transpiles and renders on a phone in Expo.

### E. The reactivity bridge: Build
Angular change detection (zones, or signals) versus React's render model. Signals → state is the cleanest mapping and the modern Angular direction anyway.
*Proof task:* a counter component that updates on tap, written in the new language.

### F. DI and lifecycle mapping: Build (small)
Constructor injection resolved from a provider registry → React context under the hood; lifecycle hooks → effects.
*Proof task:* a service injected into two components, sharing one counter.

### G. Style translation: Use, then Build
CSS subset → StyleSheet objects; where RN layout differs (flex direction defaults, no cascade, no inheritance beyond text).
*Proof task:* one styled card that looks the same in a browser mock and on the phone.

### H. Source maps and error messages: Build (small, decisive)
Without this, every error points into generated code and the language feels broken. With it, errors name the source file and line.
*Proof task:* break a template on purpose; the error names the template line.

### I. Hermes and Metro: Understand only
What Hermes bytecode is, when it is produced, how Metro bundles. You need the picture, not the machinery.

### J. Testing the transpiler: Use
Golden-file tests: source in, expected output out, compared exactly, the same unit-test-first discipline you already use.

## Skip or postpone (the engine is also a "do not learn" list)

- Writing a TypeScript/JavaScript parser from scratch, solved problem, reuse the TS compiler.
- Emitting Hermes bytecode directly, enormous effort, zero user-visible gain.
- Full Angular compatibility (forms, animations, SSR, the whole RxJS surface), v2 at the earliest, if ever.
- A routing library, map to React Navigation later; navigation is not the language.

## Milestone ladder

- **M0**, AST printer for templates (Block A proof).
- **M1**, A static component transpiles and renders on a phone.
- **M2**, Interpolation and property binding work.
- **M3**, Events and state: the counter.
- **M4**, `*ngIf` and `*ngFor`.
- **M5**, Child components with inputs and outputs.
- **M6**, An injected service and lifecycle hooks.
- **M7**, CLI, source maps, real error messages, and one demo: rewrite one small Awaken Me component (a Dinacharya row, say) in the new language and run it.

Rough estimate, labelled as an estimate: a working v1 (M0-M7) is a 6-10 week part-time project for you, precisely because the two ends are already yours and only the middle is new. Of the three example goals, this one has the smallest true gap and almost no research frontier, the design choices (how much of Angular to clone, how much to simplify) are the only real invention, maybe 5% of the work.
