# Recipe: Gradient Shell, the app frame of the tutorial redesign

**Intent**: One screen that proves the gradient shell round together: a gradient app bar pinned above the scroll with a search pill projected into it, a gradient surface, a labelled section whose header carries a gradient bar and a count, and lesson rows with number tiles and bookmark actions whose filled and outline icons show the saved state.

**Source**

`gradient-shell.component.ts`:

```ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-gradient-shell',
  templateUrl: './gradient-shell.component.html',
})
export class GradientShellComponent {
  q = '';
  savedFirst = true;
  savedSecond = false;
  drawerOpen = false;

  openNav() { this.drawerOpen = true; }
  closeNav() { this.drawerOpen = false; }
  toggleFirst() { this.savedFirst = !this.savedFirst; }
  toggleSecond() { this.savedSecond = !this.savedSecond; }
}
```

**Notes**

- `pin` lifts the bar out of the scroll: the screen draws it in its header slot, above the ScrollView, so the title and the search stay while the content scrolls.
- The search input is projected into the bar as a child; `variant="search"` draws the pill.
- A row's `avatarText` overrides the avatar circle's letter, and its `actionIcon` plus `(action)` give the row a trailing button beside its own press.
- A section with a `label` opens with a header row: a short gradient bar, the label, and an optional `meta` line at the right.
- The bookmark and bookmark-outline icons are the saved and unsaved states of the same action; the app binds the name, the icon carries the state.
