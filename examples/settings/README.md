# Recipe: Settings, Material style controls

**Intent**: A settings screen with four controls that all write back to component state: a switch, a checkbox, a segmented page switcher and a radio group.

**Source**

`settings.component.ts`:

```ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.component.html',
  styles: [`
    .sample-s { font-size: 12px; }
    .sample-m { font-size: 14px; }
    .sample-l { font-size: 20px; }
  `],
})
export class SettingsComponent {
  wifiOn = true;
  notifications = false;
  view = 'list';
  size = 'm';

  onWifi(value: boolean) {
    this.wifiOn = value;
  }

  onNotifications(value: boolean) {
    this.notifications = value;
  }

  onView(value: string) {
    this.view = value;
  }

  onSize(value: string) {
    this.size = value;
  }
}
```

`settings.component.html`:

```html
<screen>
  <appbar title="Settings"></appbar>

  <label>Connection</label>
  <switch [checked]="wifiOn" (change)="onWifi($event)">Wi-Fi</switch>
  <p>Wi-Fi is {{ wifiOn ? 'on' : 'off' }}</p>

  <label>Preferences</label>
  <checkbox [checked]="notifications" (change)="onNotifications($event)">Notifications</checkbox>
  <p>Notifications are {{ notifications ? 'on' : 'off' }}</p>

  <label>Home view</label>
  <switcher [value]="view" (change)="onView($event)">
    <option value="list">List</option>
    <option value="stats">Statistics</option>
  </switcher>
  <div *ngIf="view === 'list'">
    <p>List panel: Morning Yoga, Puja, Deep Work.</p>
  </div>
  <div *ngIf="view === 'stats'">
    <p>Statistics panel: 3 blocks done this week.</p>
  </div>

  <label>Text size</label>
  <radio-group [value]="size" (change)="onSize($event)">
    <radio value="s">Small</radio>
    <radio value="m">Medium</radio>
    <radio value="l">Large</radio>
  </radio-group>
  <p>Chosen size: {{ size }}</p>
  <p class="sample-s" *ngIf="size === 's'">A line of text at the chosen size.</p>
  <p class="sample-m" *ngIf="size === 'm'">A line of text at the chosen size.</p>
  <p class="sample-l" *ngIf="size === 'l'">A line of text at the chosen size.</p>
</screen>
```

**What it compiles to**

Key lines of the generated `settings.component.tsx`:

```tsx
const [wifiOn, setWifiOn] = useState(true);
const onWifi = (value: boolean) => {
  setWifiOn(value);
};

<RgSwitch checked={wifiOn} onChange={($event) => onWifi($event)}>Wi-Fi</RgSwitch>
<RgCheckbox checked={notifications} onChange={($event) => onNotifications($event)}>Notifications</RgCheckbox>
<RgSwitcher value={view} onChange={($event) => onView($event)}>
  <RgOption value="list">List</RgOption>
  <RgOption value="stats">Statistics</RgOption>
</RgSwitcher>
<RgRadioGroup value={size} onChange={($event) => onSize($event)}>
  <RgRadio value="s">Small</RgRadio>
  <RgRadio value="m">Medium</RgRadio>
  <RgRadio value="l">Large</RgRadio>
</RgRadioGroup>
```

The generated `RgOption` and `RgRadio` elements are declarations, not screens. `RgSwitcher` and `RgRadioGroup` read each child element's `value` prop and text label, the same way a browser select element reads its option elements. The group owns the layout, the selected state and the tap handling.

**Rules used**

- **Material correspondence:** `switch` mirrors `mat-slide-toggle`, `checkbox` mirrors `mat-checkbox`, `switcher` mirrors `mat-button-toggle-group` with `mat-button-toggle` style choices, and `radio-group` with `radio` mirrors `mat-radio-group` with `mat-radio-button`. The source stays Angular in shape. Only the rendering target changes.
- **Change events carry the next value:** switch and checkbox emit a boolean. Switcher and radio group emit the chosen declaration's `value`. Templates call a method with `$event`; the method assigns the parameter to the field. Template handlers do not contain assignment expressions.
- **Switch motion:** the knob only ever moves toward its target. The React Native primitive uses a plain linear timing move, never a spring, so it cannot overshoot or bounce back. The preview uses the same rule in CSS: a linear transition between the two end positions.
- **The switcher is view state, not routing.** It changes the `view` field and the panels below use `*ngIf` on that field. It does not change screens, URLs or history. Routing arrives separately in Stage 9.
- **Disabled state:** put `[disabled]` on `switch` or `checkbox` when the control must not respond. The value stays as it is and no change event fires.
- **Text size proof:** the radio group changes `size`, the chosen value is printed, and exactly one sample line renders. Each sample line carries a class whose font size is on the type scale. In the generated app the StyleSheet class applies. In the preview, component class styles are not painted, the same known preview limit already documented for dinacharya-row, so the visible proof in the preview is the chosen value and which sample line is present.

**Common mistakes**

- **Writing an assignment in the template.** `(change)="wifiOn = $event"` is not the Rangular pattern. Write `(change)="onWifi($event)"` and assign `this.wifiOn = value` inside `onWifi`.
- **Putting an option or radio outside its group.** `<option>` belongs inside `<switcher>` and `<radio>` belongs inside `<radio-group>`. Any other nesting earns a `GEN_CONTROL_NESTING` warning with a fix line.
- **Using the switcher as a router.** If the choice should open a different screen, wait for routing in Stage 9. Use the switcher only when the same screen changes its visible panel.
- **Free standing labels inside a group.** A switcher contains only option declarations and a radio group contains only radio declarations. Put headings and help text outside the group.
