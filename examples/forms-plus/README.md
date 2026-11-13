# Recipe: Forms Plus, the Tier 2 controls

**Intent**: One form screen that proves the Stage 15 Tier 2 controls together: a masked phone input, a star rating, an OTP code input, a three page carousel, and a photo picker, each reporting back to the class through the controls contract.

**Source**

`forms-plus.component.ts`:

```ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-forms-plus',
  templateUrl: './forms-plus.component.html',
})
export class FormsPlusComponent {
  phone = '';
  score = 0;
  code = '';
  page = 0;
  picked = '';

  onPhone(v: string) { this.phone = v; }
  onScore(n: number) { this.score = n; }
  onCode(v: string) { this.code = v; }
  onPage(i: number) { this.page = i; }
  onFiles(files: { name: string }[]) {
    this.picked = files.length ? files[0].name : '';
  }
}
```

`forms-plus.component.html`:

```html
<screen>
  <appbar title="Forms Plus"></appbar>

  <p>The Tier 2 controls, each on the Stage 6 contract: a value in, a (change) out. The phone field is an ordinary input carrying a mask; the rating, the code input and the carousel hold their own values; the picker hands back the files it chose.</p>

  <input label="Phone" mask="(999) 999-9999" placeholder="(555) 123-4567" [value]="phone" (change)="onPhone($event)">
  <p>Phone so far: {{ phone }}</p>

  <label>How was the session?</label>
  <rating [value]="score" (change)="onScore($event)"></rating>
  <p *ngIf="score">You rated it {{ score }} of 5.</p>

  <label>Enter the six digit code</label>
  <otp length="6" [value]="code" (change)="onCode($event)"></otp>
  <p *ngIf="code.length === 6">Code complete: {{ code }}</p>

  <carousel [index]="page" (change)="onPage($event)">
    <card>
      <h3>One</h3>
      <p>The first page of the carousel. Pages are plain projected content; swipe, or tap the dots in the preview.</p>
    </card>
    <card>
      <h3>Two</h3>
      <p>The second page. The index is yours when you bind it, as here.</p>
    </card>
    <card>
      <h3>Three</h3>
      <p>The third page. Page {{ page + 1 }} of 3 is showing.</p>
    </card>
  </carousel>

  <file-picker label="Attach a photo" kind="image" (change)="onFiles($event)">Choose a photo</file-picker>
  <p *ngIf="picked">Picked: {{ picked }}</p>
</screen>
```

**What it compiles to**

Key lines of the generated `forms-plus.component.tsx`:

```tsx
<RgInput label="Phone" mask="(999) 999-9999" placeholder="(555) 123-4567" onChangeText={($event) => onPhone($event)} value={phone} />
<RgRating value={score} onChange={($event) => onScore($event)} />
<RgOtp length="6" value={code} onChange={($event) => onCode($event)} />
<RgCarousel index={page} onChange={($event) => onPage($event)}>
<RgFilePicker label="Attach a photo" kind="image" onChange={($event) => onFiles($event)}>Choose a photo</RgFilePicker>
```

**Rules used**

- **A mask is an attribute on an ordinary input.** `mask="(999) 999-9999"` formats the value with a three character pattern language: `9` is a digit slot, `A` a letter slot, `*` any character, and every other pattern character is a literal that appears only once the slot after it is filled, so a half typed number never trails a dangling bracket. The masked string is the model value: the class field reads `(555) 123-4567`, formatted. There is no separate raw value channel in this version.
- **The rating is one number.** `[value]` in, `(change)` out with the tapped star's number (1 to `max`, default 5). The stars are the icon set's star icon, filled in the primary colour up to the value; there are no half stars in this version.
- **The OTP input is one control, one string.** `<otp length="6" [value] (change)>` renders digit boxes over one hidden text field, so keyboard, autofill and paste behave; `(change)` emits the digit string as it grows, and the class decides when it is complete. Length clamps to 4 to 8, and a static length outside that range warns `GEN_OTP_LENGTH` at compile time.
- **The carousel reuses the stepper's index contract.** Projected children are pages; `[index]` in, `(change)` out with the settled page. In the preview, dots and chevrons page it (a DOM preview cannot swipe), documented like the slider ticks.
- **The picker emits file information, not files.** `(change)` receives an array of `{ name, uri, size, type }`, one entry per pick; `kind="image"` (the default) opens the photo library, `kind="file"` opens the document picker, and `multiple` allows several at once. Cancelling emits nothing. App side requirement, stated plainly: the picker modules are Expo modules the app must carry, expo-image-picker for images and expo-document-picker for files; they are loaded lazily, so an app without them still runs and the tap only logs a warning naming the missing module. Expo Go carries both for SDK 58. In the preview, the browser's own file picker stands in and emits the same shape, with the file name as the uri.

**Common mistakes**

- **Expecting the raw digits from a masked field.** The field holds the formatted string by design; strip the literals in the class if a backend wants digits only.
- **Reading the OTP value before it is complete.** `(change)` fires per keystroke with the partial string; check its length against the control's length, as the `code.length === 6` line here does.
- **Giving the carousel page declarations.** There is no page tag; children are pages, in order.
- **Handling a cancelled pick as an error.** A cancel is silent by design; only an actual pick emits.
