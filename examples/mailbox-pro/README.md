# Recipe: Mailbox Pro, data display

**Intent**: One mailbox screen that proves the seven Stage 11 data display pieces together: tabs with their own content panels, an accordion with single-open expansion panels plus one standalone panel, a declarative table, an autocomplete input, a slider, a progress bar and spinner, chips with removal, and badges on a row and a button.

**Source**

`mailbox-pro.component.ts`:

```ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-mailbox-pro',
  templateUrl: './mailbox-pro.component.html',
})
export class MailboxProComponent {
  tabIndex = 0;
  unread = 3;
  storageUsed = 82;
  previewLines = 1;
  moveTo = '';
  movedTo = '';
  aboutOpen = false;
  filters = ['Unread', 'Has attachment', 'Starred'];
  folderNames = ['Inbox', 'Starred', 'Sent', 'Drafts', 'Trash', 'Travel', 'Receipts'];
  folders = [
    { name: 'Inbox', count: 12 },
    { name: 'Starred', count: 2 },
    { name: 'Sent', count: 30 },
    { name: 'Trash', count: 4 },
  ];
  inboxMails = [
    { from: 'Sarju', subject: 'Train tickets for Friday' },
    { from: 'Google', subject: 'Your storage is almost full' },
    { from: 'Medium', subject: 'Your weekly reading list' },
  ];
  starredMails = [
    { from: 'Awaken Me', subject: 'Launch checklist' },
    { from: 'Pankaj Shukla', subject: 'New deck on agents' },
  ];

  onTab(index: number) {
    this.tabIndex = index;
  }

  markAllRead() {
    this.unread = 0;
  }

  onLines(value: number) {
    this.previewLines = value;
  }

  onMove(name: string) {
    this.movedTo = name;
  }

  onAboutToggle(open: boolean) {
    this.aboutOpen = open;
  }

  removeFilter(name: string) {
    this.filters = this.filters.filter((f: string) => f !== name);
  }
}
```

`mailbox-pro.component.html`:

```html
<screen>
  <appbar title="Mailbox Pro"></appbar>

  <row title="Inbox" subtitle="Your mail at a glance" [badge]="unread"></row>
  <button [badge]="unread" (click)="markAllRead()">Mark all read</button>

  <tabs [index]="tabIndex" (change)="onTab($event)">
    <tab label="Inbox">
      <list>
        <row *ngFor="let m of inboxMails" [title]="m.from" [subtitle]="m.subject"></row>
      </list>
    </tab>
    <tab label="Starred">
      <list>
        <row *ngFor="let m of starredMails" [title]="m.from" [subtitle]="m.subject"></row>
      </list>
    </tab>
  </tabs>

  <label>Filters</label>
  <chips>
    <chip icon="star">Starred only</chip>
    <chip *ngFor="let f of filters" removable (remove)="removeFilter(f)">{{ f }}</chip>
  </chips>

  <label>Move to folder</label>
  <input [(ngModel)]="moveTo" [options]="folderNames" (optionSelected)="onMove($event)" placeholder="Type a folder name">
  <p *ngIf="movedTo">Moved to {{ movedTo }}</p>

  <label>Reading</label>
  <p>Preview lines: {{ previewLines }}</p>
  <slider min="0" max="3" step="1" [value]="previewLines" (change)="onLines($event)"></slider>

  <label>Folders</label>
  <table [data]="folders">
    <column name="name" header="Folder"></column>
    <column name="count" header="Messages"></column>
  </table>

  <accordion>
    <panel title="Storage" subtitle="82% of 15 GB used" [expanded]="true">
      <p>Storage used</p>
      <progress-bar [value]="storageUsed"></progress-bar>
    </panel>
    <panel title="Sync">
      <spinner></spinner>
      <p>Syncing now</p>
      <progress-bar mode="indeterminate"></progress-bar>
    </panel>
  </accordion>

  <panel title="About this mailbox" (toggle)="onAboutToggle($event)">
    <p>One mailbox, every folder in one place.</p>
  </panel>
  <p>About open: {{ aboutOpen }}</p>
</screen>
```

The two tab lists are two literal arrays on purpose: each tab owns a plain list, so switching tabs is a pure selection change with nothing to recompute.

**What it compiles to**

Key lines of the generated `mailbox-pro.component.tsx`:

```tsx
const removeFilter = (name: string) => {
  setFilters(filters.filter((f: string) => f !== name));
};

<RgRow title="Inbox" subtitle="Your mail at a glance" badge={unread} />
<RgButton badge={unread} onPress={() => markAllRead()}>Mark all read</RgButton>
<RgTabs index={tabIndex} onChange={($event) => onTab($event)}>
  <RgTab label="Inbox">
    <RgList>
      {inboxMails.map((m, index) => (
        <RgRow key={m?.id ?? index} title={m.from} subtitle={m.subject} />
      ))}
    </RgList>
  </RgTab>
</RgTabs>
<RgChip icon="star">Starred only</RgChip>
<RgChip key={f?.id ?? index} removable onRemove={() => removeFilter(f)}>{f}</RgChip>
<RgInput placeholder="Type a folder name" value={moveTo} onChangeText={($event) => setMoveTo($event)} onOptionSelected={($event) => onMove($event)} options={folderNames} />
<RgSlider min={0} max={3} step={1} value={previewLines} onChange={($event) => onLines($event)} />
<RgTable data={folders}>
  <RgColumn name="name" header="Folder" />
  <RgColumn name="count" header="Messages" />
</RgTable>
<RgAccordion>
  <RgPanel title="Storage" subtitle="82% of 15 GB used" expanded={true}>
    <RgProgressBar value={storageUsed} />
  </RgPanel>
</RgAccordion>
<RgPanel title="About this mailbox" onToggle={($event) => onAboutToggle($event)}>
```

**Rules used**

- **Tabs own content; the switcher does not.** `<tabs>` follows the Stage 6 controls contract: `[index]` in, `(change)` out with the new index as `$event`. Each `<tab label="...">` carries its own template children, rendered only while that tab is selected, like `*ngIf`. That is the difference from `<switcher>`, which is a bare control that emits a value and owns no panels: reach for the switcher when the content swap is yours to write with `*ngIf`, and for tabs when each choice is a page of its own. Without `[index]`, the group holds its own selection. A `<tab>` outside `<tabs>`, or anything else inside `<tabs>`, warns `GEN_CONTROL_NESTING`.
- **Panels manage their own open state.** Tap the header and the panel toggles; the chevron rotates down when closed and up when open. `[expanded]` is a seed: it sets the state the panel starts in, it is not a controlled binding, so a tap always works even when you do not handle `(toggle)`. `(toggle)` emits the next open boolean as `$event`, and a handler that writes it back to the field you seeded from gives you effective control, as the About panel shows.
- **Accordion is single-open.** Inside `<accordion>`, opening one direct `<panel>` child closes the others, which is mat-accordion with `multi` false. The first panel whose `[expanded]` seed is open starts open; the Storage panel here. Panels outside an accordion stand alone. The coordination lives inside the group primitive: the group injects internal props into its panel children, so the template stays plain panels.
- **Table columns are names, not templates.** `<column name="count" header="Messages">` reads the `count` property of each row object and prints `String(value)`. The attribute is `name`, matching the matColumnDef name in Angular Material, and not `key`: React reserves `key` as its own prop and never passes it to the component, so a column keyed by `key` could not work in the generated app. `key` is still accepted as an alias for authors coming from the early sketches. A column with neither name nor key is a `GEN_TABLE_COLUMN` error. An empty data array paints just the header row, plus one muted line with the table's `emptyText` attribute when that attribute is present; without it, nothing, which is what Material does. Column templates, sorting and pagination are not in this version.
- **Autocomplete is an input with options.** `[options]` binds a string array, and while the field is focused and its text is non-empty, a panel under the field lists the options containing the text, matched case-insensitively by substring, the filter Angular Material's own example uses. Choosing one writes it back through the ngModel path, exactly as if typed, and emits `(optionSelected)` with the chosen string. Options that are objects, with a `displayWith` function, are not in this version: strings only.
- **Slider values snap and clamp.** `(change)` emits the value snapped to `step` and clamped into `min` to `max`, once on release and once on a tap. A statically known `min` at or above `max` is a `GEN_SLIDER_RANGE` error; a `step` at or below zero warns and generates 1. In the app the slider takes taps and drags at any position. Preview simplification, stated plainly: when the range holds at most 20 steps, the preview also renders one tappable tick per step value, because a DOM test cannot click at an x fraction reliably.
- **Progress clamps, spinner sizes snap.** A determinate `<progress-bar>` value outside 0 to 100 warns `GEN_PROGRESS_RANGE` and the generated code clamps it. `mode="indeterminate"` sweeps a 40 percent bar in the app; the preview paints that bar statically at 40 percent, a stated simplification. `<spinner>` rotates its arc in the app and paints the same arc statically in the preview. Its `size` rides the icon size scale (20, 24, 28) with the usual warn-and-snap.
- **Chips are labels with an optional way out.** A chip is a static pill; `icon="..."` leads with a Stage 7 icon, and `removable` adds a close control whose tap fires `(remove)`. Removing a filter here works because the method translator carries an assignment of a member call: `this.filters = this.filters.filter(...)` becomes a state setter call with the filtered array. Adding is the mirror image, also an assignment: `this.filters = [...this.filters, name]`, or `this.filters = this.filters.concat(name)`. List state always changes by assigning a new array; `push`, `pop` and `shift` written as plain statements are translated to the same setter calls, while `splice`, `sort` and the other mutation methods warn `METHOD_UNSUPPORTED` and teach the assignment form. `<chips>` is only a wrapping row.
- **Badge is an attribute on three hosts.** `badge="3"` or `[badge]="unread"` on `<button>`, `<row>` or `<icon>` draws a small error coloured count at the top end corner. A value of 0 or an empty value draws nothing, which is why Mark all read makes both badges here disappear; a number above 99 draws 99+. Any other host warns `GEN_BADGE_HOST` and the badge is dropped.

**Common mistakes**

- **Using the switcher for tabbed pages.** If each choice has its own content, that is `<tabs>`. The switcher emits a value and stops there.
- **Treating `[expanded]` as controlled.** It is a seed. The panel still toggles on tap when your handler ignores `(toggle)`; bind the handler and write the field if you need to observe or drive it.
- **Writing `<column key="from">` and stopping there.** It works, `key` is an accepted alias, but write `name`: it is the documented attribute, it matches matColumnDef, and `key` means something else to React.
- **Expecting the table to sort.** It does not, in this version. Order the array in the component.
- **Binding object options to autocomplete.** Strings only in this version; map objects to their display strings in the component.
- **Putting a badge on a card or a fab.** Only button, row and icon host badges in this version; the compiler warns and drops it everywhere else.
- **Writing `(toggle)="aboutOpen = $event"`.** Event bindings never hold assignments, anywhere in Rangular. Call a method and assign inside it, as `onAboutToggle` does.
