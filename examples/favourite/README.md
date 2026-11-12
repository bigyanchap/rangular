# Recipe: Favourite, child components with @Input / @Output

**Intent**: A parent screen lists three quote rows; each row is a child component (`<quote-card>`) that receives the quote and author as inputs and emits an event when its Save button is tapped. The parent counts the saves in its appbar.

**Source**

`favourite.component.ts`:

```ts
import { Component } from '@angular/core';
import { QuoteCardComponent } from './quote-card.component';

@Component({
  selector: 'app-favourite',
  templateUrl: './favourite.component.html',
})
export class FavouriteComponent {
  savedCount = 0;

  quotes = [
    { id: 1, text: 'The present moment is all you ever have.', author: 'Eckhart Tolle' },
    { id: 2, text: 'Silence is a source of great strength.', author: 'Lao Tzu' },
    { id: 3, text: 'What you seek is seeking you.', author: 'Rumi' },
  ];

  recordFavourite(quote: string) {
    this.savedCount++;
  }
}
```

`favourite.component.html`:

```html
<screen>
  <appbar [title]="'Saved: ' + savedCount"></appbar>
  <h1>Favourite quotes</h1>
  <quote-card *ngFor="let q of quotes; let i = index" [quote]="q.text" [author]="q.author" (favourited)="recordFavourite($event)"></quote-card>
</screen>
```

`quote-card.component.ts`:

```ts
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'quote-card',
  templateUrl: './quote-card.component.html',
})
export class QuoteCardComponent {
  @Input() quote = '';
  @Input() author = '';
  @Output() favourited = new EventEmitter<string>();

  save() {
    this.favourited.emit(this.quote);
  }
}
```

`quote-card.component.html`:

```html
<card>
  <p>{{ quote }}</p>
  <h3>{{ author }}</h3>
  <button (click)="save()">Save</button>
</card>
```

**What it compiles to**

Everything lands in ONE generated file (`favourite.component.tsx`): the child is an exported function above the parent's default export.

```tsx
export function QuoteCard({ quote = '', author = '', onFavourited }: { quote?: any; author?: any; onFavourited?: (value: any) => void }) {
  const save = () => {
    onFavourited?.(quote);              // this.favourited.emit(this.quote)
  };
  return (
    <RgCard>
      <Text variant="body">{quote}</Text>
      <Text variant="title">{author}</Text>
      <RgButton onPress={() => save()}>Save</RgButton>
    </RgCard>
  );
}

export default function Favourite() {
  // ...
  {quotes.map((q, i) => (
    <QuoteCard key={q?.id ?? i} quote={q.text} author={q.author} onFavourited={($event) => recordFavourite($event)} />
  ))}
}
```

**Rules used**

- **Resolution is by import.** The compiler follows the entry component's relative imports (transitively); any imported `@Component` class becomes a known child, keyed by its `selector`. A template tag matching that selector compiles to the child, no registry, no module declaration. An import cycle is a `CMP_IMPORT_CYCLE` warning; the classes on the cycle still resolve.
- **@Input → prop.** `[quote]="q.text"` passes the evaluated expression; a plain attribute (`label="Hi"`) passes the string. When the parent omits a binding, the child's literal initializer is the default, it appears right in the generated signature (`quote = ''`).
- **@Output → callback prop named `on` + Capitalised name.** A field initialised with `new EventEmitter<T>()` and decorated `@Output()` becomes the prop `onFavourited`. Inside the child, `this.favourited.emit(x)` compiles to `onFavourited?.(x)`, the `?.` means an unbound output is a no-op, exactly like an unsubscribed EventEmitter.
- **$event is the emitted value.** `(favourited)="recordFavourite($event)"` compiles to `onFavourited={($event) => recordFavourite($event)}`. A bare handler name also works: `(favourited)="recordFavourite"` passes the method itself.
- Children compose with everything from Stage 2: `*ngFor` over child tags (with the usual `item?.id ?? i` key), `*ngIf`, the child's own state and methods.
- The preview renders children recursively: inputs evaluate in the parent scope, and a child emit runs the parent handler and re-renders, tap Save in `preview.html` and the appbar count goes up.

**Common mistakes**

- **Forgetting the import.** A `<quote-card>` tag whose class is not imported (directly or transitively) from the entry component is not a known child: like any unknown dashed tag it is passed through as-is and will not resolve in the generated app. Import the child class in the component file that uses it.
- **Emitting through the generated prop name.** In source you always write `this.favourited.emit(x)`, never `this.onFavourited(...)`. The `onX` name exists only in generated code.
- **Expecting the parent to re-render from a mutated input object.** Inputs are values passed at render time; the child gets a new prop when the parent re-renders. To tell the parent something changed, emit an @Output, don't mutate the input object and hope.
- **Putting `*ngIf` and `*ngFor` on the child tag together.** Still one structural directive per element (Stage 2 rule), nest: wrap the child in an element carrying the other directive.
