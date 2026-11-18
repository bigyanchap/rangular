# Recipe: Path Shell, the Option A app frame

**Intent**: One screen that proves the Option A round together: a screen that fades its content out under the pinned bar (`fade`), a flat tint app bar with no seam against the status area, carrying a menu, two actions (search and a saved shortcut) and a thin progress line at its bottom edge, a drawer whose current place is a selected pill row, lesson rows that read as a path (a green check tile for a done lesson, a blue tile for the current one), and a bottom tab bar whose selected icon sits in a pill, pinned by the screen even though it is declared inside the page.

**Source**

`path-shell.component.ts`:

```ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-path-shell',
  templateUrl: './path-shell.component.html',
})
export class PathShellComponent {
  pct = 30;
  tab = 0;
  navOpen = false;

  openNav() { this.navOpen = true; }
  closeNav() { this.navOpen = false; }
  goSearch() {}
  goSaved() {}
  pick(i: number) { this.tab = i; }
}
```

**What it compiles to**

- `<screen fade>` compiles to `RgScreen` with the `fade` prop: the screen tracks the scroll offset and melts the content out under the pinned bar, as a smooth gradient of the bar's own colour.
- `tone="tint"` compiles to `RgAppbar` with the tint tone: a flat surfaceVariant band. A pinned tint or plain bar lends its background colour to the screen, which paints its safe area strip with it, so the status area and the bar read as one surface.
- `actionIcon` and `actionIcon2` compile to the two right side icon buttons, wired to `(action)` and `(action2)`.
- `[progress]` compiles to the 3px line at the bar's bottom edge, filled to the bound percent.
- `[selected]` on a row compiles to the filled pill that marks the current place in a drawer.
- A named `avatarTone` (`blue`, `purple`, `red`, `green`, `amber`) paints the row's tile in that pair; `varied` keeps the hash pick.
- `<bottom-nav>` compiles to `RgBottomNav`; inside a screen it registers into the screen's bottom slot and pins under the scroll, wherever in the page it is declared.

**Rules used**

- One bar per screen, pinned with `pin`, so it stays while the content scrolls.
- The tab bar is controlled: `[index]` in, `(change)` out, the same contract as tabs and the switcher.
- A row is selected by state, never by styling by hand.

**Common mistakes**

- Putting the bottom nav outside the screen: it then renders in place at the end of the page instead of pinning.
- Binding `[progress]` to a fraction: the value is a percent, 0 to 100, like `<progress-bar>`.
- Expecting the fade under an unpinned bar: the veil melts content under the pinned bar only.
