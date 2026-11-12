# Recipe: Icons, the curated Material style set

**Intent**: A screen that shows the whole Rangular icon set with a name label under each icon, plus a short usage strip: icons sitting in lines of content, in the sizes and theme colours a real screen uses.

**Source**

`icons.component.ts`:

```ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-icons',
  templateUrl: './icons.component.html',
  styles: [`
    .icon-cell { align-items: center; gap: 4px; padding: 8px; }
    .icon-line { flex-direction: row; align-items: center; gap: 12px; padding: 8px; }
  `],
})
export class IconsComponent {
  names = ['menu', 'search', 'close', 'check', 'chevron-left', 'chevron-right', 'arrow-left', 'arrow-right', 'plus', 'minus', 'bell', 'heart', 'star', 'settings', 'home', 'person', 'calendar', 'alarm', 'play', 'pause', 'edit', 'delete', 'share', 'info', 'warning', 'mail', 'sun'];
}
```

`icons.component.html`:

```html
<screen>
  <appbar title="Icons"></appbar>

  <label>The set</label>
  <div class="icon-cell" *ngFor="let name of names">
    <icon [name]="name"></icon>
    <span>{{ name }}</span>
  </div>

  <label>In use</label>
  <div class="icon-line">
    <icon name="bell" color="primary"></icon>
    <p>Notifications</p>
  </div>
  <div class="icon-line">
    <icon name="search" size="20"></icon>
    <p>Search your library</p>
  </div>
  <div class="icon-line">
    <icon name="heart" size="28" color="error"></icon>
    <p>Favourites</p>
  </div>
  <div class="icon-line">
    <icon name="sun"></icon>
    <p>Good morning</p>
  </div>
</screen>
```

**What it compiles to**

Key lines of the generated `icons.component.tsx`:

```tsx
import { RgAppbar, RgIcon, RgScreen } from '@rangular/ui';

{names.map((name, index) => (
  <View key={name?.id ?? index} style={styles.iconCell}>
    <RgIcon name={name} />
    <Text>{name}</Text>
  </View>
))}

<RgIcon name="bell" color="primary" />
<RgIcon name="search" size={20} />
<RgIcon name="heart" size={28} color="error" />
<RgIcon name="sun" />
```

`RgIcon` draws the icon's SVG path data (stored in `packages/ui/src/icons.ts`, 24 by 24 viewBox) with react-native-svg, filled with a theme colour. The dev preview draws the exact same path data as inline SVG, so the preview and the app show the identical drawing. The appbar menu and the checkbox tick are drawn by the same set now: the appbar uses the `menu` icon and a ticked checkbox uses the `check` icon, instead of the font characters they used before.

**Rules used**

- **The set is fixed and listed.** The valid names are: menu, search, close, check, chevron-left, chevron-right, arrow-left, arrow-right, plus, minus, bell, heart, star, settings, home, person, calendar, alarm, play, pause, edit, delete, share, info, warning, mail, sun. The same list is generated into catalog.md under Icons, from the same file the compiler validates against, so the docs cannot drift from the code.
- **Three props only.** `name` (a static attribute, or `[name]` bound to a field), `size` (20, 24 or 28, default 24), and `color` (the name of a theme colour role such as `primary`, `error` or `textMuted`; with no color, the icon takes the theme text colour, the onSurface role). `[size]` and `[color]` bindings work too.
- **Unknown names are compile errors, not blank spaces.** A static name outside the set is a `GEN_ICON_UNKNOWN` error. Its fix line points at the Icons list in catalog.md, and the JSON form of the diagnostic carries the whole valid list in a `validIcons` field, so an AI or a tool can pick a valid name without parsing prose. A missing name is a `GEN_ICON_NAME` error. A `[name]` binding is not checked, its value is only known when the app runs, and an unmatched value at runtime draws nothing.
- **Sizes snap like styles do.** A size off the scale (20, 24, 28) earns a `GEN_ICON_SIZE` warning and the generated code uses the nearest on-scale size, ties going to the lower value, the same rule the style translator applies. A size that is not a number at all falls back to the default 24, also with the warning.
- **App side requirement.** `RgIcon` renders through react-native-svg. That library ships inside Expo Go and is a standard part of Expo and React Native projects, so a generated app needs nothing unusual, but it is a real dependency of the generated app and it is named here so nobody is surprised by it.
- **Icons are static.** An icon has no events and no state. Put it next to text in a row (a `div` with `flex-direction: row`, as in the usage strip) rather than inside a button: a button's children render as one text label today, so an icon inside a button would not draw as an icon. A tappable icon row is a row with a `(click)` handler.
- **Preview note.** The preview paints component class styles only in the generated app, not in its own stylesheet (the known preview limit documented in the settings recipe), so in the preview the set cells stack in a simple column. The drawings, sizes and colours are the real ones in both.

**Common mistakes**

- **Inventing a name.** `<icon name="rocket">` does not draw a rocket, it fails the build with `GEN_ICON_UNKNOWN`. If the icon is not in the set, the name is wrong.
- **Expecting project icons.** There is no way to register your own path data yet. Custom project icons are planned after Stage 7 as a register-your-own path set; today the curated set is the whole set.
- **Reaching for a font character.** Characters like a drawn tick or a hamburger glyph depend on the device font and are exactly what this stage removed. If a shape exists in the set, use `<icon>`.
- **Free sizes.** `size="22"` compiles, but with a warning, and the app draws 20. Stay on the scale: 20, 24, 28.
