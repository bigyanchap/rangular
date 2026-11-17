# Recipe: Gmail Light Shell, the plain app frame

**Intent**: One screen that proves the Gmail light round together: a plain white pinned bar whose whole face is a search pill (a leading menu icon wired to (leading), the account initial at its right), a section opened by an icon chip, a plain section with no decoration, lesson rows with pastel number tiles that vary by label, a drawer row with a leading icon, and two switches side by side, one answering its toggle with a haptic and one silent.

**Source**

`gmail-shell.component.ts`:

```ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-gmail-shell',
  templateUrl: './gmail-shell.component.html',
})
export class GmailShellComponent {
  q = '';
  wifi = true;
  savedFirst = true;
  savedSecond = false;

  openNav() {}
  toggleFirst() { this.savedFirst = !this.savedFirst; }
  toggleSecond() { this.savedSecond = !this.savedSecond; }
  flipWifi(v: boolean) { this.wifi = v; }
}
```

**Notes**

- `tone="plain"` makes the pinned bar a white band with a soft shadow; with no title, menu or action of its own it renders no title row, so the pill it carries is the whole face of the bar.
- The search pill's `leadingIcon` replaces the search glyph and its tap reports through `(leading)`; `avatarText` draws the round initial at the pill's right. On a gradient bar, `pillTone="white"` keeps the pill white.
- A section with an `icon` opens with a round solid chip holding the icon; a section with `plain` opens with the bare title; with neither, the gradient bar of the gradient shell round remains the default.
- A row's `avatarTone="varied"` gives its avatar tile a pastel pair chosen by its label, and a row's `icon` puts a leading icon where the avatar would go, the drawer row shape.
- A switch with `haptic` answers a toggle with a light selection haptic (expo-haptics, a required dependency of apps on @rangular/ui); a switch without it stays silent. Both are the same switch: the attribute is the whole difference.
- Every text field also carries the keyboard contract this round added: the screen moves its content up for the keyboard, and each field offers a Done button that dismisses it.
