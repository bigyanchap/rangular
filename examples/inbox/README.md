# Recipe: Inbox, lists with *ngFor and an empty state

**Intent**: A Gmail-style mail list rendered from a data array: one `<row>` in the template becomes one row per mail, with an empty-state message when the list is empty.

**Source**

`inbox.component.ts`:

```ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-inbox',
  templateUrl: './inbox.component.html',
})
export class InboxComponent {
  title = 'Inbox';

  mails = [
    { id: 1, from: 'Sarju', subject: 'Photos from the weekend', snippet: 'Sharing the album with you…', time: '9:12 am', unread: true },
    { id: 2, from: 'Google', subject: 'Security alert', snippet: 'A new sign-in on your device', time: '8:03 am', unread: true },
    { id: 3, from: 'Medium', subject: 'Your weekly reading list', snippet: 'Stories picked for you', time: 'Yesterday', unread: false },
    { id: 4, from: 'Awaken Me', subject: 'Build finished successfully', snippet: 'Your latest build is ready to test', time: 'Tue', unread: false },
  ];
}
```

`inbox.component.html`:

```html
<screen>
  <appbar title="Mail" search="Search in mail"></appbar>
  <h1>{{ title }}</h1>
  <list>
    <row avatar *ngFor="let m of mails; let i = index" [title]="m.from" [subtitle]="m.subject" [detail]="m.snippet" [time]="m.time"></row>
  </list>
  <p *ngIf="mails.length === 0">No mail. Enjoy the quiet.</p>
</screen>
```

**What it compiles to**

Key lines of the generated `inbox.component.tsx`:

```tsx
export default function Inbox() {
  const title = 'Inbox';
  const mails = [ /* the same literal array, hoisted as-is */ ];
  return (
    <RgScreen>
      <RgAppbar title="Mail" search="Search in mail" />
      <RgText variant="display">{title}</RgText>
      <RgList>
        {mails.map((m, i) => (           {/* *ngFor -> keyed .map(...) */}
          <RgRow key={m?.id ?? i} avatar title={m.from} subtitle={m.subject} detail={m.snippet} time={m.time} />
        ))}
      </RgList>
      {(mails.length === 0) && (          {/* *ngIf empty state */}
        <RgText variant="bodyLarge">No mail. Enjoy the quiet.</RgText>
      )}
    </RgScreen>
  );
}
```

**Rules used**

- `*ngFor="let m of mails; let i = index"` compiles to `mails.map((m, i) => (...))`. Loop variables (`m`, `i`) are plain identifiers inside bindings, `[title]="m.from"` needs no prefix.
- **Keys:** every repeated element gets `key={item?.id ?? index}` automatically, the item's `id` when it has one, otherwise its position. With `trackBy: fnName` in the microsyntax the key becomes `key={fnName(item)}` instead.
- A field holding an array/object **of literals** hoists like any other literal (as a `const` here, or `useState` if a method assigns it).
- `<row>` maps to `RgRow`; its props are `title`, `subtitle`, `detail`, `time`, `avatar`, `children` (full list in `catalog.md`). The bare `avatar` attribute is a boolean attribute, presence is what turns the avatar circle on. The circle shows the first character of the row's `title` on the primary colour. Lines run `title` (headline) → `subtitle` (second line) → `detail` (third, muted line): use only as many as the item has.
- `*ngIf` on a sibling element gives the empty state; it is not part of the loop.

**Common mistakes**

- **Putting `*ngIf` and `*ngFor` on the same element.** An element carries only **one** structural directive, with both present, the last one parsed wins and the other is silently dropped. Nest them instead: `<list *ngIf="mails.length"> <row *ngFor="..."> </list>`, or wrap the repeated element in a parent that holds the `*ngIf`.
- **Items with no `id` and no `trackBy`.** Keys then fall back to the row's position (`?? i`), so if the array is reordered or refetched, React Native can reuse the wrong row for a mail. Give items a stable `id` field (as here) or add `trackBy: trackById` to the microsyntax.
- **Writing `*ngIf="mails.length === 0; else hasMail"`.** `else`/`then` microsyntax is detected but not generated yet, you get a `GEN_NGIF_ELSE_TODO` warning and the element is emitted *unconditionally*. Use two elements with opposite conditions: `*ngIf="mails.length === 0"` and `*ngIf="mails.length > 0"`.
