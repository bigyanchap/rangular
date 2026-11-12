# Recipe: Profile — composition, a toggle, and a list of posts

**Intent** — A profile card screen: avatar, name and bio, a follow button that toggles between Follow and Following, and a list of three posts. This example is also the Stage 2.5 proof test: it was written by a fresh AI agent using only the vibe-layer docs (AGENTS.md, llms.txt, catalog, recipe cards) — no compiler source — and compiled with zero diagnostics on the first attempt.

**Source**

`profile.component.ts`:

```ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.component.html',
})
export class ProfileComponent {
  name = 'Bigyan Chapagain';
  bio = 'Engineer, inventor and seeker of ultimate truth.';
  following = false;

  posts = [
    { id: 1, title: 'Building Awaken Me, one morning at a time', snippet: 'A conscious alarm that wakes you into meditation, not noise.', time: 'Today' },
    { id: 2, title: 'Meditation is not an escape', snippet: 'Sitting still until the mind stops negotiating.', time: 'Yesterday' },
    { id: 3, title: 'Notes on reverse aging, the yogic way', snippet: 'Growing younger is a discipline, not a product.', time: 'Tue' },
  ];

  toggleFollow() {
    this.following = !this.following;
  }
}
```

`profile.component.html`:

```html
<screen>
  <appbar title="Profile"></appbar>
  <card>
    <row avatar [title]="name"></row>
    <p>{{ bio }}</p>
    <button (click)="toggleFollow()">{{ following ? 'Following' : 'Follow' }}</button>
  </card>
  <h2>Posts</h2>
  <list>
    <row *ngFor="let post of posts; let i = index" [title]="post.title" [subtitle]="post.snippet" [time]="post.time"></row>
  </list>
</screen>
```

**What it compiles to**

Key lines of the generated `profile.component.tsx`:

```tsx
const [following, setFollowing] = useState(false);  // following IS assigned in a method -> state
const toggleFollow = () => {
  setFollowing(!following);                          // this.following = !this.following
};
...
<RgButton onPress={() => toggleFollow()}>{(following ? 'Following' : 'Follow')}</RgButton>
```

**Rules used**

- **Toggle pattern:** a boolean field flipped with `this.following = !this.following` inside a method becomes state; the button label is a ternary interpolation — both forms are in the supported expression subset (see "Supported template expressions" in `docs/VIBE_CODING.md`).
- **Composition is free, like HTML:** a `<row>` and a `<button>` inside a `<card>` need no special permission.
- **Avatar today is a row feature:** `<row avatar>` draws a circle showing the first character of `[title]`. Using it as the profile header is the current pattern; there is no standalone avatar block yet.
- **Row lines by count:** a post has two text lines, so they map to `[title]` + `[subtitle]`. The inbox's three-line item (sender / subject / snippet) is the one that also uses `[detail]`.
- **Prose goes in `<p>`:** the bio is a wrapping paragraph, not a row subtitle (row lines are single-line list text and may truncate).
- Posts are an array of literal objects with `id`s, so `*ngFor` keys are stable (`post.id`), exactly as in the inbox recipe.

**Common mistakes**

- **Putting the bio in the header row's `[subtitle]`.** Row subtitles are single-line list text; a bio belongs in a `<p>` under the row.
- **Two buttons with `*ngIf` to fake a toggle label.** The ternary `{{ following ? 'Following' : 'Follow' }}` is supported — one button, one handler, one state field.
- **Flipping state in the template.** `following` changes only inside `toggleFollow()`; a template expression like `[disabled]="!following"` reads state but never writes it — writes belong in methods.
