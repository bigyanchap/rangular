# Rangular: How to make sure it creates a polished UI

Prepared for Bigyan, 2026-11-12. Companion to `rangular-block-diagram.md`.

## The hard truth first

A transpiler by itself guarantees a **correct** UI, not a **polished** one.
Literal translation, `div → View`, CSS value → same StyleSheet value, produces
apps that work and look amateur: wrong spacing rhythm, web layout habits on a
phone, no press feedback, text that clips under Display Zoom.

Polish has to be **built into Rangular as a system**, in four places.
Remove any one and polish leaks away.

## 1. Design tokens: the compiler only speaks in tokens

> **Status: delivered in Stage 4.** The token set is complete in
> `@rangular/ui` tokens (every colour role in light and dark, the
> spacing/radius/type scales, three elevation presets), the primitives
> read only tokens (a test fails if a hex value appears in
> `primitives.tsx`), and the style translator snaps spacing, radius
> and font-size values to the scales with a `STYLE_OFF_SCALE` warning.
> One honest difference from the sketch below: generated StyleSheet
> code carries the snapped numeric values rather than token
> references, because component styles are author CSS. The values are
> guaranteed on-scale either way.

One theme file is the single source of every visual value in the generated app:

- **Spacing scale:** 4 / 8 / 12 / 16 / 20 / 24 / 32, nothing in between.
- **Radius scale:** 8 / 12 / 16 / 20 / full.
- **Type scale:** fixed steps with fixed line-heights (e.g. 12 / 14 / 16 / 20 / 24 / 32); a named title font separate from body font.
- **Colour tokens, not colours:** `surface`, `text`, `textMuted`, `accent`, `danger`, `border`, each with a light and a dark value, so dark mode is a token swap, never a rewrite.
- **Elevation / shadow presets:** 3 named levels, not free-hand shadow values.

Compiler rule: raw CSS values are resolved **to the nearest token** at compile
time, and anything far from every token produces a diagnostic
(`12px padding → snapped to spacing.md (16)? or did you mean spacing.sm (12)?`).
The generated code contains token references, never magic numbers.

## 2. A polished primitive kit: translate intent, not tags

Developers don't get raw `View`/`Text` for common jobs. Rangular ships
`@rangular/ui` primitives, each pre-polished once, used everywhere:

| Angular-style tag | Generated RN | Polish baked in |
|---|---|---|
| `<rg-screen>` | SafeAreaView + scroll veil + background gradient | Safe-area insets, keyboard avoidance |
| `<rg-card>` | View on token surface | Token radius/padding/shadow, hairline border |
| `<rg-button>` | Pressable | Min 44pt touch target, pressed state, disabled state, loading spinner, label never wraps |
| `<rg-input>` | TextInput wrapper | Label, error line, focus ring, return-key behaviour |
| `<rg-list>` / `<rg-row>` | FlatList + row | Separators as row borders, stable keys from `*ngFor` trackBy |
| `<rg-sheet>` / `<rg-dialog>` | Bottom sheet / centre dialog | One shared gradient, handle, accent language |
| `<rg-text variant="title\|body\|caption">` | Text | Type-scale step, font scaling respected |

This is your own Awaken Me rule applied to a framework: **consistency is the
only way to win hearts**, one button component used 100 times beats 100
hand-styled buttons, every time. A new app looks polished on day one because
it is assembled from parts that already are.

## 3. Compiler defaults & normalisation: fix web habits automatically

The transformer inserts the things a web developer would forget on native:

- **Layout:** RN defaults to `flexDirection: column`; compiler emits explicit direction, `flexShrink: 1` on text containers, and `minWidth: 0` equivalents so long words wrap instead of overflowing.
- **Text:** all strings are wrapped in `<Text>` (RN crashes / silently drops raw text in a View); nested-Text inheritance is made explicit, since only nested Text inherits in RN.
- **Touch:** any element with an `(event)` binding gets a Pressable with pressed feedback and a minimum 44×44 target, expanded hit area if the visual is smaller.
- **States:** interactive primitives must define `disabled` and `loading`; lists must define an empty state; images must declare size/aspect so layouts don't jump while loading.
- **Motion:** one default press/selection animation curve for the whole app, emitted by the runtime, never per-component improvisation, and no spring overshoot on toggles.
- **Unsupported CSS** (cascade, hover, most shadows/transforms): warn-and-approximate with a diagnostic naming the source line, never silently drop, never silently distort.

## 4. Visual proof: screenshot tests, not hope

Same discipline as golden-file tests, one level up:

- **Showcase app:** a generated gallery rendering every primitive and token in light + dark, on the smallest phone width and at the largest Display Zoom / font scale. If it looks right there, it looks right everywhere.

> **Status: the showcase half is delivered in Stage 4.**
> `examples/showcase/` renders the variants, card, buttons, list,
> badge and FAB on one screen, in light and dark through the preview
> Light/Dark toggle, at the preview's fixed phone width.
>
> **Status update, Stage 5:** the `rangular doctor` linter below is
> delivered, and the golden idea is delivered in snapshot form: each
> example carries a `styles.snapshot.json` with the preview's resolved
> key styles per element role for both themes, regenerated and
> compared by a test. True screenshot goldens (a device or emulator
> pipeline) and Display Zoom proofing remain future work; the snapshot
> form stands in for them until that pipeline exists.
- **Screenshot golden tests:** each showcase screen (and each dogfood component) is screenshotted in CI/emulator and diffed against the approved image. A visual change fails the test until a human approves the new screenshot, exactly like approving a golden file.
- **Polish linter (`rangular doctor`):** static checks on the generated app: magic numbers outside tokens, touch targets under 44, text outside Text, contrast below 4.5:1, radius/spacing values off-scale, images without dimensions. Reported like compiler errors, with the original Angular source line.

> **Delivered as:** `rangular doctor` with four honestly computable
> rules (hex colour literals, off-scale values, loose text in
> containers, tap targets under 44), each a coded diagnostic with the
> Angular source file, line and a fix. Contrast checking is not
> implemented (it needs rendered colour pairs, not source text), and
> the image dimension rule waits for an image tag to exist in the tag
> contract; there is none in v1.
- **The acceptance test stays the same one:** the Awaken Me Dinacharya row, rewritten in Rangular, screenshotted side-by-side with the real one at true phone size. Polish is proven when you can't tell which is which at a glance.

## What this adds to the 77 things

Nothing new to *learn*: it reuses items 58-63 (styling translation) and 72-75
(testing/dogfooding). It does add three build items inside those groups:

1. The token resolver + snapping diagnostics in the style translator.
2. The `@rangular/ui` primitive kit (a third small package beside compiler + runtime).
3. The screenshot-golden harness + `rangular doctor` linter.

## Addendum (Bigyan's clarification, 2026-11-12): even the simple blocks must be polished by default

Requirement in his words: the basic UI built from simple blocks itself should
look polished, like Angular's own website or Gmail.

**Yes, and the proof is that this is exactly how Gmail / Angular sites get
their polish.** It does not come from HTML or Angular itself (raw browser
defaults are ugly). It comes from **Material Design** sitting underneath:
Angular Material components + Google's design tokens. Gmail is Material
applied with discipline.

So Rangular ships its equivalent, call it **Rangular Material**, as the
*default layer under every simple block*, not as an optional kit:

- A plain block is never a raw RN component. `<button>` compiles to the
  Material button (pill/filled, state layer on press, disabled at reduced
  opacity, 48dp target); `<row>` compiles to the Material list row (leading
  avatar/icon slot, headline/supporting-text hierarchy, hairline, ripple);
  `<screen>` supplies the app bar, 16dp margins and background surface.
- The default theme *is* Material 3's token set: colour roles
  (primary / surface / surface-variant / on-surface / outline), the type
  scale (headline / title / body / label), shape scale, elevation levels,
  and the standard motion curves, with light + dark values.
- Semantic blocks give the system its cues: heading levels, section, list,
  row, label. The more semantic the block, the more polish the system can
  apply automatically.
- Existence proof on the target platform: **React Native Paper** already
  implements Material 3 in React Native and ships in production apps.
  Rangular's simple blocks can compile onto its own equivalent layer
  (or Paper itself underneath), this is engineering, not research.

**Boundary, stated plainly:** this guarantees Gmail-grade polish for
standard screens, inbox/list, forms, settings, detail, dashboard, compose.
It does not invent a bespoke brand art direction, custom illustration, or
content hierarchy the developer never expressed; a theme override layer sits
on top of the defaults for that (which is also what Google does, angular.dev
is Material tokens with a custom theme, not raw Material).

## The preview is a promise (Bigyan's principle, 2026-11-12)

In his words: any code that is successful as a mobile responsive must
be successful as an app.

Meaning, as a design rule for Rangular: if compiled code renders and
behaves correctly at phone width in the preview, the same generated
code must work as a real React Native app. The preview is a promise,
not a demo that can drift from the target.

What parity means in practice today:

- The compiler warns and approximates unsupported CSS (`CSS_UNSUPPORTED`,
  `STYLE_OFF_SCALE`) instead of letting the preview silently succeed
  with web behaviour the app does not have.
- The preview renderer follows React Native layout defaults, not web
  defaults: column flex direction, and text only inside text elements
  (doctor's `DOC_RAW_TEXT` rule exists because raw text in a container
  is a web habit the app cannot honour).
- Anything the app cannot do must surface as a diagnostic, never as a
  preview-only success. Unsupported constructs degrade with a warning
  and a TODO in the generated code, in the open.
- A parity guard test enforces the checkable half: every example's
  generated `.tsx` is scanned, and the suite fails if a web-only API
  (`document.`, `window.`, `localStorage`), a web tag rendered as a
  JSX element, or a style property outside the supported CSS subset
  leaks into generated code.

## Addendum (default polish pass, 2026-11-12)

Bigyan ran the scaffolded starter app on his phone and judged it
unpolished. He was right, and the diagnosis found real system gaps,
not taste issues:

- The preview applied the type scale to headings and paragraphs,
  but generated code compiled them to plain React Native `Text`
  with a `variant` prop RN ignores, so the phone rendered them at
  the default size and weight. The preview was promising a polish
  the app did not have, exactly what the parity principle forbids.
- Every block carried its own horizontal margin (appbar 12, card
  16, bare text 0), so a screen had three different left edges.
- Card children had no spacing rhythm in generated code at all:
  gaps the preview showed through CSS margins did not exist in the
  app, and the button inside a card was inset from the card's text
  column by its own margin.

The defaults now, all values from the existing token scales, in the
primitives and mirrored in the preview renderer:

- **One screen grid.** `RgScreen` content carries the `spacing.lg`
  (16) horizontal padding and a `spacing.md` (12) gap between
  stacked blocks. Primitives carry no horizontal margins, so every
  top level block shares the same edges. A card stacks its
  children with the same 12 gap inside its 16 padding, and a
  button inside a card spans the card's content column exactly.
- **The type scale is real in generated code.** `h1`/`h2`/`h3`/`p`
  and `<label>` compile to `RgText` at the display (32/700),
  heading (24/700), title (20/600), bodyLarge (16) and label steps,
  in the theme's on-surface colour. `<span>` stays plain `Text`
  and inherits inline.
- **Rows take their inset from their container** (no private
  horizontal padding), so row text sits on the grid and dividers
  align to the grid edges in screens, cards and tab panels alike.
- **The starter itself was redesigned** to the composed form: a
  title appbar (no search box by default), the display headline,
  and one card whose heading, paragraph, button and counter line
  are separated by the single rhythm. The starter component
  carries no custom styles; the look is entirely the defaults.

## One-line version

**Don't translate CSS, translate intent, onto tokens and pre-polished
primitives, then prove it with screenshots.**

## Addendum, 2026-11-12, late: containers are stacks, the app bar is opt-in

Found by the first real routed app built on Rangular, the Rangular
Tutorial app, from screenshots on a real phone:

- The grid above only applied to direct children of the screen.
  A routed screen roots in a `<section>`, which compiled to a bare
  View with no gap, so its cards and blocks rendered attached edge
  to edge. Now `<section>`, `<div>` and `<header>` compile to
  `RgSection`, a column with the same 12 rhythm gap, in the app
  and in the preview.
- The app bar always drew a menu icon and an avatar built from the
  title's first letter, in every app, even apps with no menu and
  no signed in user. Both are now opt-in: the boolean `menu`
  attribute and the `avatar` text attribute.
- Buttons gained a quiet form, `variant="text"`, for back links
  and secondary actions, so not every action has to shout like a
  primary button.
- Stage 14 (2026-11-13) added the Material pieces the audit found
  missing, all in the same polish language: the menu panel and the
  drawer reuse the overlay scrim and surface, the select reuses the
  picker field and the bottom sheet, the stepper header reuses the
  tabs rhythm with numbered circles, grid tiles are surface cards
  on the spacing scale, tree rows ride the row rhythm, the divider
  is the same hairline the panels and tables use, and tooltips are
  small dark bubbles in the snackbar's colours. No new colours, no
  new radii, no springs.
