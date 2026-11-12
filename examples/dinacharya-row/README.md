# Recipe: Dinacharya row, the dogfood example

**Intent**: Model one real Awaken Me Dinacharya block row in Rangular: the 34 by 34 check square, the block title, its time range, and the quiet pieces line. This is the Stage 5 dogfood test: a real screen from a real app, written the Rangular way. Tapping the featured row (Morning Yoga) toggles its done state.

**Source**

`dinacharya-row.component.ts`:

```ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-dinacharya-row',
  templateUrl: './dinacharya-row.component.html',
  styles: [`
    /* doctor: allow-hex: the gold and bronze below are the Awaken Me brand
       colours of the real app this row is modelled on, not Material roles. */
    .check-cell { width: 34px; height: 34px; }
    .check-on { width: 34px; height: 34px; border-radius: 12px; background-color: #d9a441; align-items: center; justify-content: center; }
    .check-off { width: 34px; height: 34px; border-radius: 12px; border-width: 2px; border-color: #a06a35; }
    .check-mark { color: #ffffff; font-size: 16px; font-weight: 700; text-align: center; }
  `],
})
export class DinacharyaRowComponent {
  featured = { title: 'Morning Yoga', time: '5:30 to 6:15 am', pieces: '3 pieces, 2 done' };
  yogaDone = false;

  blocks = [
    { id: 1, title: 'Puja', time: '6:30 to 6:50 am', pieces: '', done: true },
    { id: 2, title: 'Deep Work', time: '9:00 to 11:00 am', pieces: '4 pieces, 1 done', done: false },
    { id: 3, title: 'Evening Walk', time: '5:45 to 6:30 pm', pieces: '', done: false },
  ];

  toggleYoga() {
    this.yogaDone = !this.yogaDone;
  }
}
```

`dinacharya-row.component.html`:

```html
<screen>
  <appbar title="Dinacharya"></appbar>
  <label>Today</label>
  <list>
    <row (click)="toggleYoga()" [title]="featured.title" [subtitle]="featured.time" [detail]="featured.pieces">
      <div class="check-cell">
        <div class="check-on" *ngIf="yogaDone"><span class="check-mark">✓</span></div>
        <div class="check-off" *ngIf="!yogaDone"></div>
      </div>
    </row>
    <row *ngFor="let b of blocks; let i = index" [title]="b.title" [subtitle]="b.time" [detail]="b.pieces">
      <div class="check-cell">
        <div class="check-on" *ngIf="b.done"><span class="check-mark">✓</span></div>
        <div class="check-off" *ngIf="!b.done"></div>
      </div>
    </row>
  </list>
  <p *ngIf="yogaDone">Morning Yoga is done. The day is already won.</p>
</screen>
```

**What it compiles to**

The featured row becomes an `RgRow` whose `onPress` flips a `useState`, with the two square states as conditional `View`s carrying the component styles:

```tsx
const [yogaDone, setYogaDone] = useState(false);
const toggleYoga = () => {
  setYogaDone(!yogaDone);
};
// ...
<RgRow title={featured.title} subtitle={featured.time} detail={featured.pieces} onPress={() => toggleYoga()}>
  <View style={styles.checkCell}>
    {yogaDone && (
      <View style={styles.checkOn}>
        <Text style={styles.checkMark}>✓</Text>
      </View>
    )}
    {!yogaDone && (
      <View style={styles.checkOff} />
    )}
  </View>
</RgRow>
```

and the styles land in the generated `StyleSheet.create` exactly as written: `checkOn: { width: 34, height: 34, borderRadius: 12, backgroundColor: '#d9a441', ... }`. Width and height are not spacing properties, so the Stage 4 snapper leaves 34 alone; it is the real app's size, not a scale step.

**Rules used**

- **The row carries the tap.** `(click)` on `<row>` compiles to `onPress` on `RgRow`, and the whole row is the tap target, like the real app. The 34 by 34 square is visual state, not the target itself, which is why doctor's 44 by 44 tap target rule does not fire on it: the rule measures the element carrying the `(click)`.
- **Done and not-done are a `*ngIf` pair.** One square shows the filled gold state with the check mark, the other the bronze outline. This is the documented workaround for `*ngIf` else, used here on purpose.
- **Title, time and pieces are the row's three lines.** `[title]`, `[subtitle]` and `[detail]` map to the row's headline, second and third lines (see the block semantics section in docs/VIBE_CODING.md). An empty `pieces` string renders no third line.
- **Brand colours need a doctor hall pass.** The gold `#d9a441` and bronze `#a06a35` are Awaken Me brand colours, not Rangular Material roles, and they do not go into the shared token set. The styles carry a CSS comment containing `doctor: allow-hex`, which disables doctor's hex check for this file's styles only, with the reason written next to it. Doctor passes on this example with zero findings.

**How this compares to the real Awaken Me row**

What matches: the closed row's shape (34 by 34 rounded square at the left, flat gold fill `#d9a441` with a check mark when done, outline square when not), the title with its time range, the one quiet pieces line under the title in the form "3 pieces, 2 done", and row tap to toggle.

What is simplified, honestly:

- The real app persists checks per day and keeps lifetime statistics; this model holds one boolean in memory.
- The real app opens editing on long press and lets each piece (sub-item) be checked on its own; here the pieces line is summary text and only the featured block toggles.
- The real row sits inside Awaken Me's full dinacharya screen with its gradient and glass surfaces; here it renders with the stock Rangular Material screen and list.
- In the preview, the check square shows the check mark text; the exact square styling is carried by the generated StyleSheet (and pinned by `styles.snapshot.json`), the preview's row renderer does not paint component class styles into its fixed CSS.

**Common mistakes**

- **Snapping the 34.** Rewriting the square as 32 to please the spacing scale changes the real app's size. Width and height are not spacing properties and are never snapped; leave real sizes alone.
- **Putting the tap on the square.** A `(click)` on the 34 by 34 square itself would fail doctor's tap target rule and feel cramped in the app. The row takes the tap; the square only shows state.
- **Adding the gold to the shared tokens.** The Material token set is shared by every Rangular app; one app's brand colour belongs in that app's component styles, with the doctor suppression comment explaining it.
