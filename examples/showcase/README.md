# Recipe: Showcase, the token system and theming

**Intent**: One screen that exercises the whole Rangular Material token system: every text variant, a card, primary and disabled buttons, an avatar list with times, a badge, and a FAB. It is the Stage 4 eye-check screen: open its preview, flip the Light/Dark toggle, and the same screen renders from the dark token set.

**Source**

`showcase.component.ts`:

```ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-showcase',
  templateUrl: './showcase.component.html',
  styles: [`
    h1 { color: #0b57d0; margin-bottom: 8px; }
    .card-note { font-size: 14px; color: #5f6368; }
    .badge { background-color: #c2e7ff; color: #001d35; border-radius: 9999px; padding-top: 4px; padding-bottom: 4px; padding-left: 12px; padding-right: 12px; font-size: 12px; font-weight: 700; }
  `],
})
export class ShowcaseComponent {
  taps = 0;
  unread = 2;

  items = [
    { id: 1, title: 'Tokens', subtitle: 'Colour roles in light and dark', time: '9:00' },
    { id: 2, title: 'Type scale', subtitle: 'Display down to caption', time: '9:05' },
    { id: 3, title: 'Spacing', subtitle: 'Snapped to the scale', time: '9:10' },
  ];

  primaryTap() {
    this.taps++;
  }
}
```

`showcase.component.html`:

```html
<screen>
  <appbar title="Showcase" search="Search the showcase"></appbar>
  <h1>Design tokens, live</h1>
  <p>Every colour, space and type size on this screen comes from the Rangular Material token scales. Flip the preview to dark and only the token values change.</p>
  <label>Text variants</label>
  <h2>Heading, at the heading step</h2>
  <h3>Title, at the title step</h3>
  <p>Body text at the body-large step, in the on-surface colour role, never by a hand-picked grey.</p>
  <card>
    <h3>Inside a card</h3>
    <p class="card-note">A card note: body step, muted colour, from a .class rule in the component styles.</p>
    <button (click)="primaryTap()">Primary action</button>
    <button [disabled]="true">Disabled action</button>
    <p *ngIf="taps > 0">Primary tapped {{ taps }} times</p>
  </card>
  <label>List and badge</label>
  <list>
    <row avatar *ngFor="let item of items; let i = index" [title]="item.title" [subtitle]="item.subtitle" [time]="item.time"></row>
    <row title="System" subtitle="Theme tokens" time="Now"><span class="badge">{{ unread }} unread</span></row>
  </list>
  <fab (click)="primaryTap()">Compose</fab>
</screen>
```

**What it compiles to**

Key lines of the generated `showcase.component.tsx`:

```tsx
<RgText variant="label">Text variants</RgText>          // <label> = RgText with the label variant
<RgText variant="bodyLarge" style={styles.cardNote}>…</RgText>
<RgRow title="System" subtitle="Theme tokens" time="Now">
  <Text style={styles.badge}>{unread} unread</Text> // badge = a styled span inside a row
</RgRow>
// styles.badge: backgroundColor #c2e7ff, borderRadius 9999, padding 4/12, fontSize 12
// Every one of those values sits exactly on a token scale, so no warnings.
```

**Rules used**

- **Tokens are the only values.** Spacing scale: 4, 8, 12, 16, 20, 24, 32. Radius scale: 8, 12, 16, 20, full (9999). Type scale: caption 12, body 14, bodyLarge 16, label 14 (weight 600), title 20, heading 24, display 32, each with a fixed line height. Colour is picked by role (primary, surface, surfaceVariant, onSurface, onSurfaceVariant, primaryContainer, error, outline, and the rest), never by taste per screen.
- **Every colour role exists in light AND dark.** `themes.light` and `themes.dark` carry the same role names with mode values. The old names still work as aliases: `text` is `onSurface`, `textMuted` is `onSurfaceVariant`, `danger` is `error`.
- **Theme choice, the one obvious way.** Put `theme="dark"` on `<screen>` and the whole subtree renders dark: it compiles to `<RgScreen theme="dark">`, and RgScreen provides the theme through context to every primitive under it. No attribute means light. Any subtree can also be wrapped in `RgThemeProvider` in generated-app code.
- **The preview has a Light/Dark toggle.** It sits in the chrome above the phone frame and flips the preview between the two token sets. The component keeps its declared theme as the starting point; the toggle is a preview affordance, not an app feature.
- **CSS values snap to the scales.** In component `styles`, spacing properties (margin, padding, gap, top/left/right/bottom), `border-radius` and `font-size` resolve to the nearest scale value at compile time. Off-scale example: `margin-bottom: 13px` warns with `STYLE_OFF_SCALE` and the generated style uses 12. On-scale values pass silently, 0 always passes, and colours are never snapped.
- **Primitives never hard-code colour.** Every primitive reads its colours from the active theme through `useRgTheme()`. A test greps `primitives.tsx` and fails if a hex colour ever appears there.

**Common mistakes**

- **Writing an off-scale value and ignoring the warning.** `padding: 10px` compiles, but as 8, with a `STYLE_OFF_SCALE` warning naming the snapped value. If you wanted 12, write 12. The warning is the compiler telling you the rhythm broke.
- **Hard-coding a hex colour in a component style to fake dark mode.** Do not. Pick the colour role; the dark value comes with it. A hex in `styles` stays that hex in both themes.
- **Expecting `theme` on any element to work.** In this version only `<screen theme="...">` is wired. A theme attribute anywhere else is just an attribute.
- **Reaching for a font size between steps.** `font-size: 15px` snaps to 14 (body). If the text is a label, use the `<label>` block and get the label step (14, weight 600) by meaning, not by number.
