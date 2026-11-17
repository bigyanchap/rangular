# By design: what the Rangular framework does not do

The Rangular framework compiles Angular-style code into a real
React Native app. Some Angular things have an honest native
translation, and those are the framework. Some have none, and
there the framework says so, in the open, with a coded
diagnostic or a note in this file, instead of faking it. This
page is the whole list, with what to do instead in each case.

## There is no DOM

A Rangular template compiles to native views, not HTML. There
is no `document`, no `window`, no `innerHTML`, and no reaching
into a rendered element to change it by hand. Habits that end
at the DOM end here. In their place: bind data in the template,
let the binding move the view, and keep element references for
the few native handles the primitives hand back.

## Angular component libraries do not run

Libraries built for Angular on the web, ag-grid, Angular
Material, PrimeNG and their kin, need two things a phone does
not have: a browser DOM to render into, and the Angular
runtime to create and update their components. A Rangular app
has neither at run time, so these libraries cannot be used,
in whole or in part. This is not a Rangular limit alone: no
framework that produces true native UI can run them, and the
ones that appear to run them are showing a WebView.

What carries over instead:

- Your Angular skills and architecture: components, templates,
  dependency injection, services, pipes, routing.
- Pure-logic TypeScript libraries, used inside a service.
- React Native libraries, wrapped in a child component or
  driven from a service. `docs/THIRD_PARTY.md` walks the three
  paths, with maps, video, camera and WebView as worked cases.

## The language is a subset, on purpose

The compiler translates a defined subset of Angular and
TypeScript, and everything outside it produces a coded
diagnostic, never silent broken output. The edges an Angular
developer meets first:

- Methods: no `await` (use `.then`), no `new` expressions, no
  `for` loops (iterate with array methods like `map` and
  `forEach`).
- `*ngIf` with an `else` template warns and renders
  unconditionally. Write the opposite pair instead.
- Content projection has one slot. Route guards, resolvers,
  lazy loading and child routes are not in the routing subset.
- Dependency injection is constructor parameter properties on
  root services and components.

The full delta tables live in `docs/VIBE_CODING.md`. They are
the contract: if a construct is not listed as supported, the
compiler will tell you, by code.

## Styling is a CSS subset, snapped to tokens

Component `styles` and `styleUrls` are read, in a CSS subset:
element and `.class` selectors only, and a fixed property list
(the flexbox, box, text and color properties React Native
itself supports). There is no cascade, no inheritance between
elements, and no descendant, id or pseudo selectors. Anything
outside the subset warns (`CSS_SELECTOR`, `CSS_UNSUPPORTED`)
and is dropped. Spacing, radius and font sizes snap to the
design token scales, so an app keeps one rhythm.

Three habits to leave behind:

- No SCSS. Sass variables and nesting are not compiled; write
  the subset CSS directly, and let tokens do the sharing
  variables used to do.
- No Tailwind. Utility class frameworks assume a browser CSS
  engine. Class names here select rules from your component
  styles, nothing more.
- No `[style]`, `[ngStyle]` or static `style="..."` attributes.
  They warn (`GEN_STYLE_BINDING`) and are dropped. Declare a
  class in the component styles instead.

## Heavy widgets are not built in

Maps, video players, cameras and rich editors are not
framework primitives, by decision: a built-in would force the
library, its config plugin and its keys onto every generated
app, including the apps that never use it. The blessed route
is a wrapper component or a service, per `docs/THIRD_PARTY.md`,
so each app carries only what it uses.

## The browser preview is a simulation

The preview renders your app in a browser to make development
fast. It is not the phone. Native-only behaviour, overlays,
keyboards, native modules like SQLite, can differ or be absent
there, and a green preview never proves the native app. The
phone is the proof. The tutorial app in the companion repo is
run through a full gate (framework tests, compile, doctor,
Android and web bundles, a browser pass in phone mode) for
exactly this reason.

## Hand-written React components stay outside

The compiler resolves Angular-style classes, not `.tsx` files;
importing one reports `CMP_IMPORT_UNRESOLVED`. A hand-written
React screen can sit beside the generated root in your app's
own entry file, but it lives outside Rangular routing and
outside the framework.
