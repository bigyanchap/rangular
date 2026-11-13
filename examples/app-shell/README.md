# Recipe: App Shell, the frame pieces

**Intent**: One screen that proves the Stage 14 frame pieces together: a drawer (Angular Material's sidenav) opened from the app bar menu button, a menu of actions for one message with a divider before the destructive item, and a three step checkout stepper whose Continue button moves it from the class.

**Source**

`app-shell.component.ts`:

```ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-shell',
  templateUrl: './app-shell.component.html',
})
export class AppShellComponent {
  navOpen = false;
  menuOpen = false;
  stepIndex = 0;
  lastAction = '';

  openNav() { this.navOpen = true; }
  closeNav() { this.navOpen = false; }
  openMenu() { this.menuOpen = true; }
  closeMenu() { this.menuOpen = false; }
  act(name: string) { this.lastAction = name; }
  onStep(i: number) { this.stepIndex = i; }
  next() { this.stepIndex = this.stepIndex + 1; }
}
```

`app-shell.component.html`:

```html
<screen>
  <appbar title="App Shell" menu (menu)="openNav()"></appbar>

  <drawer [open]="navOpen" (close)="closeNav()">
    <h3>App Shell</h3>
    <p>Navigation lives in the drawer. A backdrop tap closes it, like every Rangular overlay.</p>
    <button variant="text" (click)="closeNav()">Close the drawer</button>
  </drawer>

  <p>The app bar menu button opens the drawer. The button below opens a menu: a small panel of actions for one message, with a divider before the destructive one.</p>
  <button (click)="openMenu()">Message actions</button>
  <menu [open]="menuOpen" (close)="closeMenu()">
    <menu-item icon="edit" (click)="act('Rename')">Rename</menu-item>
    <menu-item icon="share" (click)="act('Share')">Share</menu-item>
    <divider></divider>
    <menu-item icon="delete" (click)="act('Delete')">Delete</menu-item>
  </menu>
  <p *ngIf="lastAction">Last action: {{ lastAction }}</p>

  <divider></divider>

  <label>Checkout, in three steps</label>
  <stepper [index]="stepIndex" (change)="onStep($event)">
    <step label="Cart">
      <p>Your cart page. The Continue button moves the stepper from the class, the same [index] the header taps update.</p>
      <button (click)="next()">Continue</button>
    </step>
    <step label="Address">
      <p>Your address page.</p>
    </step>
    <step label="Done">
      <p>All done. Steps before this one carry a check in the header.</p>
    </step>
  </stepper>
</screen>
```

**What it compiles to**

Key lines of the generated `app-shell.component.tsx`:

```tsx
<RgDrawer open={navOpen} onClose={() => closeNav()}>
</RgDrawer>
<RgMenu open={menuOpen} onClose={() => closeMenu()}>
  <RgMenuItem icon="edit" onPress={() => act('Rename')}>Rename</RgMenuItem>
  <RgMenuItem icon="share" onPress={() => act('Share')}>Share</RgMenuItem>
  <RgDivider />
  <RgMenuItem icon="delete" onPress={() => act('Delete')}>Delete</RgMenuItem>
</RgMenu>
<RgStepper index={stepIndex} onChange={($event) => onStep($event)}>
```

**Rules used**

- **Menu and drawer are overlays, with the sheet and dialog contract.** `<menu [open]="..." (close)="...">` and `<drawer [open]="..." (close)="...">` are driven by a boolean field, exactly like Stage 10 overlays; with no `[open]` binding they render statically open and the compiler warns `GEN_OVERLAY_OPEN`. A backdrop tap fires `(close)`. The menu panel hangs at the top right; the drawer is a full height panel from the left.
- **Choosing a menu item closes the menu.** A `<menu-item>` tap runs its own `(click)` handler and then the menu's `(close)`, the way Material menus dismiss on selection; the coordination lives inside RgMenu, so the template stays plain items. An item may lead with an `icon="..."` from the Stage 7 set. Only `<menu-item>` and `<divider>` belong inside `<menu>`; anything else warns `GEN_CONTROL_NESTING`, as does a `<menu-item>` outside a menu.
- **Only meaningful buttons, applied to the app bar.** The `menu` attribute on `<appbar>` draws the menu icon, and the `(menu)` event is what makes it a real control: here it opens the drawer. An app bar with a menu icon and no `(menu)` handler is drawing a dead control; do not ship one.
- **The stepper follows the controls contract.** `[index]` in, `(change)` out with the new index as `$event`, like tabs. Each `<step label="...">` owns its page content, rendered only while selected; steps before the current one show a check in the header. Without `[index]` the stepper holds its own position. A `<step>` outside `<stepper>`, or anything else inside one, warns `GEN_CONTROL_NESTING`. There is no linear mode in this version: any header can be tapped, and the class drives the position when it needs to (the Continue button here).
- **A divider is one hairline.** `<divider>` draws a single border coloured line across its container: between menu items, between screen sections, anywhere a quiet separation is wanted. It takes no content and no events.

**Common mistakes**

- **Writing `(close)="menuOpen = false"`.** Event bindings never hold assignments, anywhere in Rangular. Call a method and assign inside it, as `closeMenu` does.
- **Putting rows or buttons directly in a menu.** Only menu items (and dividers) belong there; the compiler warns and the panel is a menu, not a layout container.
- **Expecting the menu to anchor to its button.** The open state is yours; the panel's place is the top right of the screen, the Material overflow position. Which button opened it is not tracked in this version.
- **Treating the drawer as a layout column.** It is an overlay in the `over` mode only in this version; a permanently visible side column is a plain section beside your content, not a drawer.
