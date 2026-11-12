# Recipe: Hello, a static screen with binding and styles

**Intent**: The smallest useful Rangular component: a polished welcome screen built only from simple blocks, with `{{ interpolation }}`, one `[prop]` binding and component styles.

**Source**

`hello.component.ts`:

```ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-hello',
  templateUrl: './hello.component.html',
  styles: [`
    h1 { color: #0b57d0; margin-bottom: 8px; }
    .card-note { font-size: 14px; color: #5f6368; }
  `],
})
export class HelloComponent {
  title = 'Welcome to Rangular';
  subtitle = 'You wrote Angular. This screen is React Native.';
  actionDisabled = false;
}
```

`hello.component.html`:

```html
<screen>
  <appbar title="Rangular" search="Search"></appbar>
  <h1>{{ title }}</h1>
  <p>{{ subtitle }}</p>
  <card>
    <h2>Simple blocks, polished by default</h2>
    <p class="card-note">Every block on this screen compiled to a pre-polished Rangular Material primitive.</p>
  </card>
  <button [disabled]="actionDisabled">Get started</button>
</screen>
```

**What it compiles to**

Key lines of the generated `hello.component.tsx` (full file beside this card; regenerate, never hand-edit):

```tsx
export default function Hello() {
  const title = 'Welcome to Rangular';            // fields stay const, nothing mutates them
  const subtitle = 'You wrote Angular. This screen is React Native.';
  const actionDisabled = false;
  return (
    <RgScreen>
      <RgAppbar title="Rangular" search="Search" />
      <Text variant="display" style={styles.h1}>{title}</Text>   {/* {{ title }} -> {title} */}
      <Text variant="body">{subtitle}</Text>
      <RgCard>...</RgCard>                                       {/* <card> -> RgCard */}
      <RgButton disabled={actionDisabled}>Get started</RgButton> {/* [disabled] -> disabled={...} */}
    </RgScreen>
  );
}

const styles = StyleSheet.create({
  h1: {"color":"#0b57d0","marginBottom":8},       // CSS subset -> RN style object, px -> number
  cardNote: {"fontSize":14,"color":"#5f6368"},    // .card-note -> styles.cardNote (camelCased key)
});
```

**Rules used**

- Every template tag resolves through the one tag→component mapping (`catalog.md`): `screen → RgScreen`, `card → RgCard`, `h1 → Text variant="display"`, `p → Text variant="body"`.
- Fields with literal initializers are hoisted as `const`, they only become `useState` if a method assigns them (see the counter recipe).
- `{{ expr }}` inside text becomes `{expr}`; `[prop]="expr"` becomes `prop={expr}`.
- Component `styles` are parsed by the CSS subset: element selectors (`h1`) and single `.class` selectors only, kebab-case properties camelCased, `8px` → `8`.
- Static attributes (`title="Rangular"`) pass through as string props.

**Common mistakes**

- **Putting bare text inside a layout block.** Text must live in a text block (`p`, `span`, `h1`-`h3`). Text placed directly inside `<div>`/`<section>` is emitted verbatim inside a `View`, which React Native cannot render, put it in `<p>` instead.
- **Expecting CSS to cascade or inherit.** It doesn't: a rule matches only elements with that tag or class, and parent styles never flow to children. Style each text block itself (or use a `.class` on it, like `.card-note` here).
- **Hand-editing `hello.component.tsx` or `preview.html`.** They are generated golden files. Change the `.ts`/`.html` and regenerate with the CLI `build` / `preview` commands, or the golden test will fail.
