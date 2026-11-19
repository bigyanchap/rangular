# Frequently asked questions

Straight answers about the Rangular framework: what it is, what it
does not do, and why. The long forms live in BY_DESIGN.md (the
limits) and THIRD_PARTY.md (libraries and the borderline).

## What it is

**1. What is Rangular, in one line?**
A transpiler: you write Angular-style code, TypeScript classes with
@Component and HTML templates, and it compiles to React Native TSX.
Hermes makes the bytecode. It never forks Angular and never parses
TypeScript by hand; it uses the official TypeScript compiler API.

**2. Does it run Angular on the phone?**
No. Nothing of Angular, and nothing of Rangular, ships in the app.
Compilation happens ahead of time on your machine. At run time the
app is plain React Native.

**3. Is the output a WebView app?**
No. Templates compile to native views through React Native
primitives. There is no WebView and no DOM anywhere in the output.

**4. Is it a fork of Angular, or a port?**
Neither. It reads Angular-style source with the TypeScript compiler
API and generates React Native code. The subset is deliberate and
documented in BY_DESIGN.md.

**5. Why not just use React Native?**
If your team thinks in React, React Native is the right choice.
Rangular is for the large pool of developers and enterprise teams
whose skill is Angular: templates apart from logic, dependency
injection, services, pipes, forms, routing conventions. It lets
them ship true native apps with the habits they already have, and
it hands them a coherent Material-style design system instead of
primitives to assemble. The exit is also built in: the output is
ordinary React Native code.

**6. Why not NativeScript? It runs real Angular.**
It does, and that is its strength and its cost. NativeScript
carries the full Angular runtime onto the phone plus its own native
runtime: a heavier app, a second platform to debug, and an Angular
flavor that follows Angular's own releases as a separate package.
It is maintained by nStudio and the community as an OpenJS
Foundation incubating project, with a smaller ecosystem than React
Native's. Rangular compiles Angular away instead: no runtime, no
second platform, and the generated code stays yours as a React
Native app if the framework ever disappears. The other side, stated
plainly: NativeScript offers full Angular fidelity and direct
native API access from JavaScript, and Rangular offers neither. A
team that needs full Angular should choose NativeScript.

**7. Why not Ionic or Capacitor?**
Those render your app in a WebView. For many apps that is fine.
Rangular exists for the cases where you want real native UI, native
gestures and native performance characteristics, without leaving
Angular habits.

**8. Why not Flutter?**
Flutter is excellent and asks you to learn Dart and a new
ecosystem. Rangular's bet is the opposite: your existing Angular
and TypeScript skill is the asset, and it should carry to mobile
unchanged in shape.

## The subset and its limits

**9. Can I run my existing Angular web app as-is?**
No, and no framework that produces true native UI can. A web app
leans on the DOM and on browser libraries. What carries over is
your architecture, your services' logic, and your skills.
BY_DESIGN.md states this in the open, because a framework that
promises otherwise is selling something false.

**10. Can I use Angular Material, PrimeNG or ag-grid?**
No. They need a browser DOM and the Angular runtime, and a native
app has neither. This is not a Rangular-only limit; it is true of
every true-native route. What you get instead is a built-in
Material-style block set, and your pure-logic libraries still work
inside services.

**11. How much of Angular is supported?**
The everyday surface: components, templates with interpolation,
property and event bindings, ngIf and ngFor, child components with
inputs and outputs, constructor dependency injection, lifecycle
hooks, pipes including custom pipes, template-driven and reactive
forms, routing with an outlet and routerLink, and an HttpClient.
The machine-readable list is the catalog. Anything outside it
produces a coded diagnostic, not silent failure.

**12. What happens when I use something unsupported?**
You get a diagnostic code and a concrete fix suggestion, at compile
time. The standing rule is that unsupported constructs are
diagnosed, never silently dropped into broken output. That rule has
teeth: when a real silent drop was found (React Native imports in a
service being discarded), it was fixed in the framework and guarded
by tests, not documented away.

**13. Is SCSS or Tailwind supported?**
No. Component styles are a CSS subset: element and class selectors,
the properties React Native can actually honour. Values snap to the
design token scales, and anything off the subset warns instead of
pretending. Native style properties are not browser CSS, so the
framework translates what has a true translation and says so about
the rest.

**14. What about NgModules, signals and RxJS?**
NgModules are out by design; the mirrored form is the modern
standalone one. State is plain class fields. RxJS is not bundled;
HTTP offers a small subscribe form, and services use promises in
.then form. Pure-logic TypeScript libraries work inside services,
which is where most business logic lives anyway.

**15. Which template features are missing that I will hit first?**
Three, all documented and taught with their workarounds: ngIf else
branches warn and render unconditionally, so lessons teach the
opposite-pair form; content projection is a single default slot;
routes have no guards, resolvers, lazy loading or child routes in
this version.

## Blessed patterns

**16. What is a blessed pattern?**
The framework's official answer for a capability it deliberately
does not build in. Instead of shipping the feature, the framework
blesses one way of doing it: a named pattern, written down, backed
by a working example and a recipe card, and tested the way built-in
features are tested. The developer follows a supported path instead
of improvising, and the framework does not take on the dependency,
its releases, its native setup or its API keys. The tiers: Tier 1
is built in (the catalog), Tier 2 is a blessed pattern, Tier 3 is a
documented escape hatch.

## Third-party libraries and the borderline

**17. How do I add a third-party library?**
Three paths, documented in THIRD_PARTY.md. One: use its tag
directly in a template, with the import carried into the generated
code. Two: wrap it in a child component of your own, the
recommended path for visual libraries. Three: drive a non-visual
library from a service, in .then form.

**18. Where is the borderline between framework and developer?**
The framework provides the Angular-shaped surface: the compiler and
subset, the catalog of built-in blocks, routing, forms, services,
HTTP, theming and the preview. Everything heavy or
platform-specific is the developer's own React Native or Expo
install, integrated through the three paths. THIRD_PARTY.md states
it in a section called "The borderline", including the required
installs below.

**19. What do I have to install myself?**
Any heavy capability: maps, video, camera, WebView, rich text
editors, a database. Plus two packages every app using the UI
package needs, expo-image-picker and expo-document-picker, because
Metro resolves them at bundle time. Blessed patterns name their own
installs on top, expo-sqlite for database work being the example.

**20. Maps, video, camera, WebView: do they actually work?**
Yes, through the wrapper path: install the React Native library,
wrap it in a child component, bind its props and events in the
template. The guide's flagship table walks react-native-maps,
expo-video, react-native-webview, expo-camera and WebView-based
rich text editors, with the limits of each stated.

**21. What about a database? Is SQLite supported?**
Through the blessed pattern, yes. The app installs expo-sqlite, one
root service owns the file, the tables and the queries, and screens
bind to its fields. The tutorial app stores bookmarks, completions
and settings this way on the phone, and examples/sqlite-notes is
the worked example with a recipe card.

**22. Why is the database a pattern and not a built-in?**
Because a database is a dependency with its own releases, native
setup and per-app choices. The decision was deliberate: bless the
pattern, do not build a database into the framework. The pattern
gives developers a supported, tested path without the framework
owning SQLite. The same logic makes maps and video Tier 2: React
Native, Flutter and Capacitor all ship those as separate packages
too.

**23. What are the known limits of the third-party paths?**
Stated in the guide, not hidden: a handler on a foreign tag does
not receive $event today, so you write it as a bare method
reference, which does receive the value; and the browser preview
draws foreign tags as a plain stand-in, so third-party visuals are
verified on device, not in the preview.

## Output, performance and proof

**24. What does the generated code look like?**
Readable React Native TSX. Every example in this repo carries its
generated file next to its source, so you can judge before you
commit. It is your code: if you stop using the framework, the app
keeps building as a React Native app.

**25. What if the framework is abandoned?**
Then your app survives it, which is the honest answer to the
bus-factor question. The output is plain React Native with no
Rangular runtime inside, the license is Apache 2.0, and the docs
are written so another developer, or an AI agent, can maintain the
compiler itself.

**26. Is it fast?**
The framework adds no runtime of its own, so the app's performance
is React Native's performance, and compilation is ahead of time.
This project does not publish benchmark numbers it has not
measured; treat framework benchmarks quoted without a reproducible
harness as marketing, whoever quotes them.

**27. How is the framework itself tested?**
A unit suite (460 tests at version 0.3.0) plus one rule held hard:
the tutorial app is the integration test. Every release must
compile the 95-lesson app with zero diagnostics, pass the doctor,
produce Android and web bundles, and pass a phone-mode browser gate
that clicks through the real flows. Most real bugs, including an
import that was silently dropped and overlays that anchored wrong
on native, were caught by that app, not by unit tests.

**28. Does the browser preview match the real app?**
That is the framework's core promise: the preview is a promise. If
code works at phone width in the preview, the same generated code
must work as an app, and parity tests guard the claim. The honest
boundary: some failure classes are only visible on a real device,
like overlay anchoring and safe-area seams, which is why releases
are also checked on a phone.

**29. Is anything real built with it?**
Yes: the tutorial app itself, 95 lessons each with a live demo,
built entirely in Rangular and being prepared for the App Store and
Play Store. The framework's examples also dogfood real shapes, like
the day-plan row example modelled on a real app's list row.

## Tooling and the AI angle

**30. What tooling ships with it?**
A CLI with build, preview, watch, doctor and scaffold commands, a
catalog generated from the code, and per-file diagnostics with
source maps. The scaffold produces a real Expo app pinned to the
current SDK, with the required packages already in place.

**31. Why is there an AI layer: llms.txt, a catalog, coded errors?**
Because more code is now drafted by AI agents, and agents write
reliable code inside a constrained, fully documented subset with
diagnostics that carry fixes. Rangular was designed for that from
the start: the catalog is machine-readable, every diagnostic code
has a fix suggestion, and every capability ships with a recipe
card. Neither React Native nor NativeScript was designed for AI
authorship; both predate the need.

**32. Why is the CLI not on npm yet?**
It was the name, and that is now fixed. The bare name rangular
was already taken on npm by an abandoned 2014 AngularJS module,
and the rangular-* package family belongs to someone else. At
version 0.2.0 the project renamed itself to rangular-framework
everywhere: the repo, the @rangular-framework package scope,
and the CLI, which installs two commands, rangular-framework
and the short rg. Publishing to npm is the next step; today you
install the CLI from this repo.

**33. Why the name rangular-framework?**
Because the collision was real and renaming early was cheap.
When the rename happened the framework had exactly one user,
its author, and one app built with it, this repo's tutorial.
Renaming after other people build on it would break their
imports; renaming then broke nothing outside these repos.
Generated code imports the @rangular-framework scope, so the
rename took a breaking-change version, 0.2.0, rather than
pretending otherwise.

## Adoption and trust

**34. Who is this for?**
Angular-leaning solo developers, small enterprise teams whose skill
is Angular, and AI-assisted builders. It is not aimed at teams
already fluent in React; React Native serves them well.

**35. Who maintains it? What is the bus factor?**
One maintainer today, stated plainly. The mitigations are
structural, not promises: Apache 2.0, readable generated output
with a clean exit to plain React Native, an honesty document that
lists what the framework does not do, and docs written for agents
as well as people, so maintenance knowledge lives in the repo.

**36. Is it production ready?**
It is at 0.2.0, pre-1.0, and labelled that way. It is ready for new
small and medium apps whose needs fit the catalog, and the tutorial
app is the standing proof. Known gaps are tracked openly; the
current first gap is StatusBar control, and the planned work after
it is more Tier 2 recipe cards for heavy integrations.

**37. How do gaps get closed? What counts as done?**
A capability is done only when it ships with all five: compiler
support, tests, a tiny example, a recipe card in the fixed shape
(Intent, Source, What it compiles to, Rules used, Common mistakes),
and a regenerated catalog. Anything less is a prototype, and the
repo rules say so.

## The sharp questions

**38. Why does it warn instead of just working like Angular?**
Because the alternative is pretending. Where a construct has an
honest native translation, the framework compiles it. Where it has
none, a warning with a fix beats silent wrong behaviour. That is
the philosophy in one answer, and BY_DESIGN.md is its long form.

**39. Why do my style values snap to scales?**
Design coherence is a feature: values snap to the token scales so
apps built by different people, or by an agent, come out with one
rhythm. Off-scale values warn with the code STYLE_OFF_SCALE.
Deliberate exceptions exist in the examples, with the reason
written next to them.

**40. How do I start, and where do I read first?**
Scaffold an app with the CLI, then read in this order: the README
for the shape, the catalog for what you may use, THIRD_PARTY.md for
libraries and the borderline, and BY_DESIGN.md for the limits. The
tutorial app teaches the framework in 95 short lessons, each with a
live demo, and it is itself the best evidence the framework works.

## The road ahead

**41. How are bugs found, and how does the framework improve from
version to version?**
Two ways, both deliberate. The first is real client work: the plan
is to build company projects in Rangular, because nothing finds a
framework's faults like a production app with real users, real data
and real deadlines. Every fault a project surfaces is fixed in the
framework itself, guarded by tests, and released in the next
version, so every user inherits what one project paid to learn. The
second is open use: the framework is Apache 2.0, and developers are
encouraged to use it, fork it, make it their own, and send
improvements back as pull requests. A fault reported from outside
gets the same treatment as one found by the tutorial gate: fixed at
the root, never patched around.
