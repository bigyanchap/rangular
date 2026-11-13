# Recipe: Feed, the screen and list patterns

**Intent**: One feed screen that proves the Stage 15 Tier 1 pieces together: pull to refresh and infinite scroll on the screen itself, a skeleton card standing in for content while it loads, mail rows with swipe actions, and a bottom navigation bar pinned under the screen.

**Source**

`feed.component.ts`:

```ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-feed',
  templateUrl: './feed.component.html',
})
export class FeedComponent {
  tab = 0;
  refreshing = false;
  loading = false;
  lastAction = '';

  posts = [
    { id: 1, from: 'Sarju', subject: 'Photos from the weekend', snippet: 'Sharing the album with you', time: '9:12 am' },
    { id: 2, from: 'Awaken Me', subject: 'Build finished successfully', snippet: 'Your latest build is ready to test', time: '8:03 am' },
    { id: 3, from: 'Medium', subject: 'Your weekly reading list', snippet: 'Stories picked for you', time: 'Yesterday' },
    { id: 4, from: 'Field Notes', subject: 'Transformer testing, day one', snippet: 'Megger readings from the yard', time: 'Tue' },
  ];

  freshPost = { id: 5, from: 'Field Notes', subject: 'Fresh off the wire', snippet: 'Pulled in by your refresh', time: 'Now' };

  olderPosts = [
    { id: 6, from: 'Google', subject: 'Security alert', snippet: 'A new sign-in on your device', time: 'Mon' },
    { id: 7, from: 'Medium', subject: 'Draft published', snippet: 'Part 23 of the series is live', time: 'Sun' },
  ];

  onTab(i: number) { this.tab = i; }
  reload() {
    this.refreshing = true;
    this.posts = [this.freshPost].concat(this.posts);
    this.refreshing = false;
  }
  loadMore() { this.posts = this.posts.concat(this.olderPosts); }
  toggleLoading() { this.loading = !this.loading; }
  star(subject: string) { this.lastAction = 'Starred: ' + subject; }
  remove(subject: string) { this.lastAction = 'Deleted: ' + subject; }
}
```

`feed.component.html`:

```html
<screen [refreshing]="refreshing" (refresh)="reload()" (endReached)="loadMore()">
  <appbar title="Feed"></appbar>

  <p>Pull to refresh and infinite scroll live on the screen here: (refresh) reloads, (endReached) appends the older posts, and [refreshing] drives the native spinner while the class works. In this demo the data is local, so the reload lands at once; in a real app the flag stays up while the fetch runs.</p>

  <button variant="text" (click)="toggleLoading()">Preview the loading skeleton</button>
  <card *ngIf="loading">
    <skeleton shape="line" width="180"></skeleton>
    <skeleton shape="line"></skeleton>
    <skeleton shape="block" height="72"></skeleton>
  </card>

  <list *ngIf="!loading">
    <row avatar *ngFor="let m of posts" [title]="m.from" [subtitle]="m.subject" [detail]="m.snippet" [time]="m.time">
      <row-action icon="star" (click)="star(m.subject)">Star</row-action>
      <row-action icon="delete" color="error" (click)="remove(m.subject)">Delete</row-action>
    </row>
  </list>
  <p *ngIf="lastAction">{{ lastAction }}</p>

  <bottom-nav [index]="tab" (change)="onTab($event)">
    <nav-item icon="home" label="Home"></nav-item>
    <nav-item icon="mail" label="Mail" badge="3"></nav-item>
    <nav-item icon="bell" label="Alerts"></nav-item>
    <nav-item icon="person" label="Profile"></nav-item>
  </bottom-nav>
</screen>
```

**What it compiles to**

Key lines of the generated `feed.component.tsx`:

```tsx
<RgScreen refreshing={refreshing} onRefresh={() => reload()} onEndReached={() => loadMore()}>
<RgRow key={m?.id ?? index} avatar title={m.from} subtitle={m.subject} detail={m.snippet} time={m.time}>
  <RgRowAction icon="star" onPress={() => star(m.subject)}>Star</RgRowAction>
  <RgRowAction icon="delete" color="error" onPress={() => remove(m.subject)}>Delete</RgRowAction>
</RgRow>
<RgSkeleton shape="line" width="180" />
<RgBottomNav index={tab} onChange={($event) => onTab($event)}>
  <RgNavItem icon="mail" label="Mail" badge="3" />
</RgBottomNav>
```

**Rules used**

- **Refresh and end-reached are events on the scrollers, not new tags.** `<screen>` and `<list>` both take `[refreshing]`, `(refresh)` and `(endReached)`. In the app the screen wires React Native's RefreshControl and the list does the same over its FlatList; `(endReached)` fires once per approach to the end, and again only after the content grows. In the preview, which cannot pull or scroll to an end, the top cue fires `(refresh)`, the bottom cue fires `(endReached)`, and a true refreshing flag paints the spinner row. That simulation is documented here, as with the slider ticks.
- **The refreshing flag is the class's job.** Set it when the reload starts and clear it when the data lands, exactly like the local reload in this demo; the spinner follows the flag, never the event.
- **A skeleton is a placeholder with a shape.** `<skeleton shape="line">`, `shape="block"` (with `height`), and `shape="circle"` (with `size`) pulse on the surface variant colour, with the design system's plain timing loop. Compose them where the real content will sit and swap them out with `*ngIf` when the data lands, as the card here does.
- **Swipe actions are declarations inside the row.** `<row-action icon="..." color="...">` inside a `<row>` reveals behind it on swipe (a tap on the action runs its `(click)` and closes the row). `color` names a theme colour role, or a hex. In the preview the tray opens from a small reveal handle, the swipe gesture's stand-in. A `<row-action>` anywhere else warns `GEN_CONTROL_NESTING`.
- **Bottom navigation follows the tabs contract.** `<bottom-nav [index] (change)>` holds `<nav-item icon label>` declarations; the screen lifts the bar out of the scrolling content and pins it under the screen. An item may carry a `routerLink` or a `(click)` of its own, and a `badge`, like the Mail item here. Anything but a `<nav-item>` inside the bar warns `GEN_CONTROL_NESTING`.

**Common mistakes**

- **Binding `(refresh)` and never clearing the flag.** The spinner is the flag; a stuck flag is a stuck spinner.
- **Rebuilding the array on every `(endReached)`.** The event means "the end is near", not "render again"; append the next page, and expect it once per approach.
- **Putting navigation destinations in the app bar.** Top destinations on a phone live at the bottom, in thumb reach; the app bar is for the screen's title and its own actions.
- **Writing swipe actions as buttons next to the row.** They belong inside the row as declarations; loose buttons stay visible and break the row's layout.
