# Recipe: The default dress

**Intent**: One screen wearing the framework's design language exactly as a new app meets it, so the language has a home that can be copied: the blue gradient band, tinted icon circles, count pills, the green check square, chips, the success switch and the primary button, all coloured by the theme tokens and none of them by a local choice.

**The language**

- Primary is the app blue, `#0b57d0`. It paints filled buttons (with `primaryDeep` as the lower stop), links, selected states and the middle stop of the brand gradient.
- The tint is `primaryContainer`, `#e8f0fe` in the light theme. Icon circles, count pills and highlight cards wear it, with primary text on it.
- Success is the Gmail green, `#34a853`. A switch with `color="success"` paints its on state with it, and the check square below borrows it.
- The brand gradient is blue: `#0849ad` to `#0b57d0` to `#4285f4`, the same stops in both themes. It is for brand moments, the band here, the gradient app bar, a section's gradient shell, never for ordinary surfaces.
- Muted text is `#5f6368`. Ordinary surfaces stay white or the surface variant; the dress is in the accents, not in a coloured page.

**The patterns** are plain sections and styles, in the source below: a 44px tint circle holding an icon in the primary role, a pill with 12px bold primary text on the tint, and a 24px green square with a white check. There are no primitives for them on purpose: they are composition, and this example is their recipe card.

**Source**

`dressed.component.ts`:

```ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-dressed',
  templateUrl: './dressed.component.html',
  styles: [`
    .band-title { font-size: 20px; font-weight: 700; color: #ffffff; }
    .band-sub { font-size: 14px; color: #d3e3fd; }
    .row { flex-direction: row; align-items: center; gap: 12px; }
    .ic { width: 44px; height: 44px; border-radius: 9999px; background-color: #e8f0fe; align-items: center; justify-content: center; }
    .grow { flex: 1; }
    .muted { font-size: 14px; color: #5f6368; }
    .pill { background-color: #e8f0fe; border-radius: 9999px; padding: 8px; }
    .pill-text { font-size: 12px; font-weight: 700; color: #0b57d0; }
    .chk { width: 24px; height: 24px; border-radius: 8px; background-color: #34a853; align-items: center; justify-content: center; }
  `],
})
export class DressedComponent {
  lightOn = true;
  taps = 0;

  onLight(value: boolean) {
    this.lightOn = value;
  }

  start() {
    this.taps++;
  }
}
```

`dressed.component.html`:

```html
<screen>
  <appbar title="Dressed"></appbar>
  <gradient>
    <p class="band-title">Living room</p>
    <p class="band-sub">The default dress, from the tokens up.</p>
  </gradient>
  <card>
    <section class="row">
      <section class="ic"><icon name="home" color="primary"></icon></section>
      <section class="grow">
        <h3>Ceiling light</h3>
        <p class="muted">On · Living room</p>
      </section>
      <section class="pill"><p class="pill-text">3 devices</p></section>
    </section>
    <section class="row">
      <section class="chk"><icon name="check" color="onPrimary"></icon></section>
      <p class="grow">Water the plants</p>
      <switch color="success" [checked]="lightOn" (change)="onLight($event)"></switch>
    </section>
    <chips>
      <chip icon="check">Done</chip>
      <chip>Active</chip>
    </chips>
    <button (click)="start()">Get started</button>
    <p *ngIf="taps > 0">Started {{ taps }} times</p>
  </card>
</screen>
```
