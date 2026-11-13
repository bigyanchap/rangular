# Recipe: Insights, the Tier 3 display pieces

**Intent**: One dashboard screen that proves the Stage 15 Tier 3 pieces together: breadcrumbs, an avatar group, three charts, a calendar month view, a timeline, a photo with a lightbox, a small marked-up text editor, a colour picker, and a masonry grid, closing with an empty state.

**Source**

`insights.component.ts`:

```ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-insights',
  templateUrl: './insights.component.html',
})
export class InsightsComponent {
  day = '2026-11-13T00:00:00';
  brand = '#0b57d0';
  notes = 'Saw the **sunrise** again.\n- Walked\n- Meditated';
  photoOpen = false;

  week = [
    { label: 'Mon', value: 12 },
    { label: 'Tue', value: 19 },
    { label: 'Wed', value: 9 },
    { label: 'Thu', value: 15 },
  ];

  trend = [
    { label: 'W1', value: 4 },
    { label: 'W2', value: 7 },
    { label: 'W3', value: 6 },
    { label: 'W4', value: 9 },
  ];

  split = [
    { label: 'Practice', value: 50 },
    { label: 'Study', value: 30 },
    { label: 'Rest', value: 20 },
  ];

  onDay(v: string) { this.day = v; }
  onBrand(v: string) { this.brand = v; }
  onNotes(v: string) { this.notes = v; }
  openPhoto() { this.photoOpen = true; }
  closePhoto() { this.photoOpen = false; }
  goHome() {}
}
```

`insights.component.html`:

```html
<screen>
  <appbar title="Insights"></appbar>

  <breadcrumbs>
    <crumb (click)="goHome()">Home</crumb>
    <crumb (click)="goHome()">Insights</crumb>
    <crumb>This week</crumb>
  </breadcrumbs>

  <label>Your people</label>
  <avatar-group max="3">
    <avatar text="Sarju Chapagain"></avatar>
    <avatar text="Bigyan Chapagain"></avatar>
    <avatar text="Monika Sogam"></avatar>
    <avatar text="Acharya Rajan"></avatar>
    <avatar text="Maya Dev"></avatar>
  </avatar-group>

  <label>Sessions this week</label>
  <chart type="bar" [data]="week"></chart>
  <chart type="line" [data]="trend"></chart>
  <chart type="pie" [data]="split"></chart>

  <label>Pick a day</label>
  <calendar [value]="day" (change)="onDay($event)"></calendar>
  <p>Selected: {{ day }}</p>

  <label>Journey</label>
  <timeline>
    <timeline-item title="Started" time="Mon">
      <p>The week began with a sunrise session.</p>
    </timeline-item>
    <timeline-item title="Deep work" time="Wed">
      <p>Two long sittings, notes below.</p>
    </timeline-item>
    <timeline-item title="Review" time="Today">
      <p>Looking back over the week.</p>
    </timeline-item>
  </timeline>

  <label>Field photo</label>
  <image src="https://example.com/yard.jpg" width="320" height="180" (click)="openPhoto()"></image>
  <lightbox [open]="photoOpen" (close)="closePhoto()" src="https://example.com/yard.jpg">
    <p>The yard at sunrise.</p>
  </lightbox>

  <label>Notes</label>
  <editor [value]="notes" (change)="onNotes($event)"></editor>

  <color-picker label="Chart colour" [value]="brand" (change)="onBrand($event)"></color-picker>
  <p>Colour: {{ brand }}</p>

  <label>Uneven tiles</label>
  <grid-list cols="2" mode="masonry">
    <grid-tile><p>A short tile.</p></grid-tile>
    <grid-tile><p>A taller tile, with a second line of text under the first, so the two columns end at different heights.</p></grid-tile>
    <grid-tile><p>Third tile.</p></grid-tile>
    <grid-tile><p>Fourth.</p></grid-tile>
  </grid-list>

  <empty-state icon="mail" title="No messages" text="When someone writes, it will land here.">
    <button (click)="goHome()">Back to Home</button>
  </empty-state>
</screen>
```

**What it compiles to**

Key lines of the generated `insights.component.tsx`:

```tsx
<RgBreadcrumbs>
  <RgCrumb onPress={() => goHome()}>Home</RgCrumb>
  <RgCrumb>This week</RgCrumb>
</RgBreadcrumbs>
<RgAvatarGroup max="3">
<RgChart type="bar" data={week} />
<RgCalendar value={day} onChange={($event) => onDay($event)} />
<RgImage src="https://example.com/yard.jpg" width="320" height="180" onPress={() => openPhoto()} />
<RgLightbox src="https://example.com/yard.jpg" open={photoOpen} onClose={() => closePhoto()}>
```

**Rules used**

- **Breadcrumbs are declarations, and the last crumb is not a link.** `<crumb>` items join with chevron icons (the icon set, never a font glyph); every crumb but the last takes a `routerLink` or `(click)`, and the last renders as the current page in plain semibold text. A crumb outside `<breadcrumbs>`, or anything else inside, warns `GEN_CONTROL_NESTING`.
- **An avatar is initials or a photo.** `<avatar text="Sarju Chapagain">` draws the first letters of the first two words on the theme's avatar colour; `src` draws the image instead, and `size` sets the diameter. An `<avatar-group max="3">` overlaps its avatars and folds the rest into a +N circle; anything but an avatar inside the group warns.
- **Charts take one data shape.** `[data]` is an array of `{ label, value }` pairs; a point may carry its own `color`. `type` is `bar` (the default), `line` or `pie`, and anything else is a compile error, `GEN_CHART_TYPE`. The same small geometry engine draws in the app (react-native-svg) and in both previews (inline SVG), so the three agree. Scope, stated plainly: one series, no axes, no gridlines, no animation, no interaction; bar and pie treat a negative value as 0.
- **The calendar is a month view, not a picker.** It renders as a screen element for looking at a month and tapping a day; `[value]` and `(change)` carry the selected day as an ISO string, the picker's language. Choosing a moment inside a form stays the wheel `<datetime-picker>`'s job, a different component on purpose.
- **A timeline is a rail of items.** `<timeline-item title time>` declarations stack on a dotted rail; the last item's line stops at its dot. Anything else inside `<timeline>` warns `GEN_CONTROL_NESTING`.
- **Images declare their size.** `<image src width height>` is the contract, and the doctor enforces it (`DOC_IMG_SIZE`): the layout is known before the picture loads. `resize` is `cover` (default), `contain` or `stretch`. The photo's `(click)` opens the lightbox, an overlay on the sheet and dialog contract: `[open]` in, `(close)` out, its children as the caption. Pinch zoom comes from the scroll view on iOS; Android pinch zoom is not part of this version.
- **The editor's value is marked-up text.** Bold is double star, italic single star, a list line starts with a dash and a space; the toolbar acts on the current selection. Scope limit, stated plainly: this is a marked-up text field with helpers, not a WYSIWYG engine, and the stored value is the marked text.
- **The colour picker's value is a hex string.** The field shows a swatch of the current colour; the sheet offers the shared data palette plus one custom hex row. The palette is data, the same in both themes, like chart colours.
- **Masonry is a mode of grid-list.** `mode="masonry"` keeps the same tag, tiles and `cols`, and deals the tiles into column stacks so uneven heights stagger; the preview uses CSS columns for the same arrangement.
- **An empty state is one named block.** Icon, title, body line, and the projected action. Its button does something real, the only meaningful buttons rule; here it goes Home.

**Common mistakes**

- **Reaching for the calendar in a form.** A form wants a moment, which is the wheel picker's job; the calendar is for browsing days.
- **Feeding a chart objects with other keys.** The shape is `label` and `value` (plus an optional `color`); rows from a table need mapping first.
- **Omitting the image size to "let it size itself".** The doctor fails the build on purpose; declare the size the layout should reserve.
- **Writing `(close)="photoOpen = false"`.** Event bindings never hold assignments; call a method, as `closePhoto` does.
