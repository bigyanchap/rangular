# Recipe: Explorer, the data pieces

**Intent**: One screen that proves the Stage 14 data pieces together: a select dropdown for the city, a folder tree with expandable nodes, a two column grid list of places, a table that sorts by its Name and Age columns and pages two rows at a time, and a tooltip on the save button.

**Source**

`explorer.component.ts`:

```ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-explorer',
  templateUrl: './explorer.component.html',
})
export class ExplorerComponent {
  city = 'ktm';
  saved = false;
  people = [
    { name: 'Mina', age: 31 },
    { name: 'Arun', age: 25 },
    { name: 'Sita', age: 40 },
    { name: 'Bikash', age: 25 },
    { name: 'Anita', age: 36 },
  ];

  onCity(v: string) { this.city = v; this.saved = false; }
  save() { this.saved = true; }
}
```

`explorer.component.html`:

```html
<screen>
  <appbar title="Explorer"></appbar>

  <select label="City" [value]="city" (change)="onCity($event)" placeholder="Pick a city">
    <option value="ktm">Kathmandu</option>
    <option value="pkr">Pokhara</option>
    <option value="bkt">Bhaktapur</option>
  </select>
  <p>Selected city code: {{ city }}</p>

  <label>Folders</label>
  <tree>
    <tree-node label="Inbox" expanded>
      <tree-node label="Work"></tree-node>
      <tree-node label="Personal"></tree-node>
    </tree-node>
    <tree-node label="Archive">
      <tree-node label="2025"></tree-node>
    </tree-node>
  </tree>

  <label>Places</label>
  <grid-list cols="2">
    <grid-tile>
      <h3>Swayambhu</h3>
      <p>The monkey temple hill</p>
    </grid-tile>
    <grid-tile>
      <h3>Boudha</h3>
      <p>The great stupa</p>
    </grid-tile>
    <grid-tile>
      <h3>Patan</h3>
      <p>Durbar square and workshops</p>
    </grid-tile>
    <grid-tile>
      <h3>Thamel</h3>
      <p>Bookshops and cafes</p>
    </grid-tile>
  </grid-list>

  <label>People, two to a page, sortable</label>
  <table [data]="people" pageSize="2">
    <column name="name" header="Name" sortable></column>
    <column name="age" header="Age" sortable></column>
  </table>

  <button (click)="save()" tooltip="Saves the current list">Save the list</button>
  <p *ngIf="saved">Saved.</p>
</screen>
```

**What it compiles to**

Key lines of the generated `explorer.component.tsx`:

```tsx
<RgSelect label="City" placeholder="Pick a city" value={city} onChange={($event) => onCity($event)}>
  <RgOption value="ktm">Kathmandu</RgOption>
  <RgOption value="pkr">Pokhara</RgOption>
</RgSelect>
<RgTree>
  <RgTreeNode label="Inbox" expanded>
    <RgTreeNode label="Work" />
    <RgTreeNode label="Personal" />
  </RgTreeNode>
</RgTree>
<RgGridList cols="2">
  <RgGridTile>
</RgGridList>
<RgTable data={people} pageSize="2">
  <RgColumn name="name" header="Name" sortable />
  <RgColumn name="age" header="Age" sortable />
</RgTable>
<RgButton onPress={() => save()} tooltip="Saves the current list">Save the list</RgButton>
```

**Rules used**

- **Select is a control, with the Stage 6 contract.** `[value]` in, `(change)` out with the chosen option's value as `$event`. The `<option value="...">Label</option>` declarations are the same ones the switcher uses; inside a select they name the dropdown choices. The field shows the chosen option's label (or the `placeholder` before any choice); tapping it opens a bottom sheet listing the options with a check on the current one, the picker's arrangement. Options are static declarations in this version. `[(ngModel)]` does not bind a select; ngModel binds text inputs only, as in Stage 8.
- **Tree nodes manage their own expansion.** A `<tree-node label="...">` with `<tree-node>` children is a branch: tap its header and the children show or hide, indented one step per depth. `expanded` is a seed, the panel rule: the node starts open, and taps still work without any handler. A node with no node children is a leaf and carries no chevron. Nodes belong in `<tree>` or in another node; anything else in a tree warns `GEN_CONTROL_NESTING`.
- **Grid list tiles take an equal share.** `<grid-list cols="2">` lays its `<grid-tile>` children out in that many columns; `cols` defaults to 2. A tile is a padded surface cell and holds any content; the list only arranges. Only tiles belong inside; anything else warns `GEN_CONTROL_NESTING`.
- **Table sorting and paging are the table's own view state.** A `<column>` with `sortable` makes its header tappable: tap cycles ascending, descending, unsorted, with the set's arrow icon showing the direction (never a font glyph). Numbers sort numerically, text alphabetically, empty cells last. `pageSize="2"` on the table pages the rows and draws a pager (range text and chevron buttons) only while the rows overflow one page. Sorting and paging never mutate the bound array, and changing the sort returns to the first page. This replaces the Stage 11 note that the table does not sort: since Stage 14 it does, when a column asks for it.
- **Tooltip is an attribute on the pressable hosts.** `tooltip="..."` on `<button>`, `<row>` or `<icon-button>` shows a small bubble above the control on long press, the mobile form of matTooltip (there is no hover on a phone). In the preview the same text rides the browser's own title tooltip. On any other element the compiler warns `GEN_TOOLTIP_HOST` and drops it, the badge rule.

**Common mistakes**

- **Binding objects as select options.** Options are value plus label text in this version, like the switcher's; map your objects in the component.
- **Expecting `(change)` on a select to behave like the generic event path.** A select is a control: its wrapper receives the chosen value as `$event`. The same holds for the stepper, switcher, radio group, switch, checkbox and tabs.
- **Nesting content directly in a tree.** Text and other blocks live inside a node's page only in the sense that nodes nest; a tree holds nodes, full stop.
- **Sorting the bound array in the component to help the table.** Do not: the table sorts a copy for display and leaves your array in its own order.
- **Putting a tooltip on a card.** Cards are not pressable hosts; the compiler warns and drops it. Put the tooltip on the button or row that does the work.
