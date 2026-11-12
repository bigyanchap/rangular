# Rangular: the exact learning list

Angular code, transpiled to React Native. Prepared for Bigyan, 2026-11-12, following the pinpoint map (`angular-to-react-native-pinpoint-map.md`).

**77 things. Total.** Everything else this project needs, you already have: Angular itself, the TypeScript language, HTML/CSS, and React Native components/hooks/styling from Awaken Me. Depths: **Build** = construct it · **Use** = work through its API · **See** = understand the picture only.

## A. Compiler core (1-14): all Build

1. **Tokens and lexical analysis**, how source text becomes a stream of tokens.
2. **Recursive-descent parsing**, turning tokens into a tree by grammar rules.
3. **AST design**, node types for elements, text, bindings, directives.
4. **The visitor pattern**, walking a tree and acting on each node type.
5. **Symbol tables and scope**, tracking names: where declared, where visible.
6. **Two-pass compilation**, analyze everything first, generate second.
7. **Intermediate representation (IR)**, your simplified tree between template and output.
8. **Code generation patterns**, emitting code text from a tree, output shapes.
9. **Tree transformation**, rewriting one tree into another (desugaring).
10. **Parser error recovery**, reporting a bad template without crashing.
11. **Grammar design (EBNF)**, writing your template dialect's rules on paper first.
12. **Pratt parsing for expressions**, precedence in `{{ a + b * c }}`.
13. **Evaluation vs emission**, what to compute at build time vs emit as runtime code.
14. **Constant folding**, resolving static values during compilation.

## B. TypeScript compiler API (15-24): Build, except 24 Use

15. **ts.Program and ts.SourceFile**, loading files the way tsc does.
16. **Node kinds and type guards**, telling identifiers, literals, classes apart.
17. **Walking the TS AST**, forEachChild and visitor functions.
18. **Reading decorator metadata**, extracting `@Component` arguments as data.
19. **Type checker basics**, asking "what type is this expression?"
20. **Custom transformers**, TransformerFactory, modifying nodes before emit.
21. **The printer/emitter**, turning modified nodes back into code text.
22. **tsconfig and module resolution**, how tsc finds imports.
23. **Diagnostics API**, errors carrying file, line, column.
24. **Incremental compilation basics**, only recompiling what changed.

## C. Angular internals (25-36): See first, then Build what you imitate

25. **Ivy rendering instructions**, templates compiled into create/update instruction calls.
26. **AOT vs JIT**, why ahead-of-time output is the model to copy.
27. **Angular's template parser**, how it tokenizes templates and bindings.
28. **Binding syntax semantics**, property, attribute, class, style bindings, precisely.
29. **Structural directive desugaring**, `*ngIf` / `*ngFor` are templates in disguise.
30. **Change detection order**, how Angular walks the tree checking bindings.
31. **Signals**, signal / computed / effect, Angular's reactivity primitives.
32. **Zone.js**, what it patches, and why Rangular avoids it.
33. **DI internals**, injector hierarchy, providers, injection tokens.
34. **Lifecycle order**, the exact hook sequence, constructor to ngOnDestroy.
35. **Content projection**, ng-content, and how slots map to RN children.
36. **Pipes**, pure vs impure, emitted as function calls.

## D. React Native as a target: only the gaps (37-46)

37. **JSX as data** (See), elements are function calls: React.createElement.
38. **Rules of hooks** (Build), generated code must call hooks unconditionally, same order.
39. **useSyncExternalStore** (Build), React's official bridge for external stores; your signals plug in here.
40. **Reconciliation and keys** (Build), why `*ngFor` output must carry stable keys.
41. **Fabric, the new architecture** (See), what emitted components run on.
42. **JSI** (See), what sits below your JavaScript.
43. **Metro resolution** (Use), how the bundler finds generated files and the runtime package.
44. **Hermes bytecode** (See), when JS becomes bytecode; what you actually ship.
45. **RN event system** (Build), mapping template `(event)` bindings to RN props.
46. **Yoga layout** (See), RN's flexbox engine; column-first defaults.

## E. Code generation and the runtime library (47-57): all Build

47. **Runtime library design**, the small helper package every generated file imports.
48. **Component factory emission**, class + template in, RN function component out.
49. **State hoisting**, where class fields live in a hooks world (useState / useRef split).
50. **Signal-to-state bridge**, your signal store driving React re-render.
51. **Event handler emission**, methods bound correctly; the `this` context problem.
52. **List emission**, `*ngFor` → map with keys, empty states.
53. **Conditional emission**, `*ngIf` → ternary and early-return patterns.
54. **Inputs and outputs**, `@Input` → props; `@Output` → callback props plus an EventEmitter shim.
55. **Service container runtime**, a tiny registry, emitted as context providers.
56. **Lifecycle emission**, ngOnInit → one-time effect; ngOnDestroy → cleanup.
57. **Template reference variables**, `#ref` becoming RN refs.

## F. Styling translation (58-63)

58. **Choosing the CSS subset** (Build), deciding, on paper, what Rangular supports.
59. **The StyleSheet model** (Build), styles as registered objects; no cascade.
60. **Unsupported CSS** (Build), warn-and-drop vs approximate: shadows, transforms, positioning.
61. **RN text inheritance** (See), only nested Text inherits styling.
62. **RN units** (See), unitless numbers and percentages; no em/rem.
63. **Class bindings → style arrays** (Build), `[class]` / `[ngClass]` as conditional style merging.

## G. Tooling and developer experience (64-71)

64. **CLI design** (Build), `rangular build`, `watch`, `init`.
65. **Watch mode** (Build), file change → recompile → Metro reload.
66. **Source maps** (Use), mappings and VLQ at picture level; use a library, don't hand-roll.
67. **Diagnostic formatting** (Build), errors with a code frame pointing at the template line.
68. **Readable generated code** (Build), emitting code a human can debug.
69. **Build caching** (Use), content hashing; skip unchanged files.
70. **Package layout** (Use), compiler, runtime, and CLI as three packages.
71. **Version compatibility** (See), thinking in Angular × RN version matrices.

## H. Testing and shipping (72-77)

72. **Golden-file testing** (Use), source in, expected output compared exactly.
73. **AST unit tests** (Build), asserting tree shapes for tricky templates.
74. **Integration smoke tests** (Use), generated apps running in Expo.
75. **Dogfooding** (Build), one Awaken Me component ported as the acceptance test.
76. **npm publishing** (Use), package exports, peerDependencies on react / react-native.
77. **Documentation by example** (Build), a one-page "Angular vs Rangular" cheat sheet.

---

Learned in the group order A → H, this list *is* the path from where you stand to a working Rangular v1: A-C give you the compiler, D the target's fine print, E the product itself, F-H make it usable and shippable.
