# Recipe: Pipes, built-in and custom

**Intent**: Format values in the template with the full built-in pipe set (date, number, percent, currency, slice, keyvalue, plus uppercase, lowercase, titlecase and json), and add one project pipe of your own with `@Pipe`.

**Source**

`exclaim.pipe.ts`:

```ts
import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'exclaim' })
export class ExclaimPipe implements PipeTransform {
  transform(value: string, times?: number): string {
    return value + '!'.repeat(times || 1);
  }
}
```

`pipes-demo.component.ts`:

```ts
import { Component } from '@angular/core';
import { ExclaimPipe } from './exclaim.pipe';

@Component({
  selector: 'app-pipes-demo',
  templateUrl: './pipes-demo.component.html',
})
export class PipesDemoComponent {
  name = 'rangular';
  day = '2024-02-29T15:04:05';
  amount = 1234567.891;
  ratio = 0.756;
  price = 49.5;
  phrase = 'Angular in, React Native out';
  facts = { lang: 'TypeScript', target: 'React Native', since: 2026 };
}
```

`pipes-demo.component.html`:

```html
<screen>
  <appbar title="Pipes"></appbar>
  <h1>{{ name | uppercase }}</h1>
  <card>
    <h3>Dates</h3>
    <p>Short: {{ day | date:'shortDate' }}</p>
    <p>Custom: {{ day | date:'yyyy-MM-dd HH:mm' }}</p>
    <h3>Numbers</h3>
    <p>Amount: {{ amount | number:'1.2-2' }}</p>
    <p>Done: {{ ratio | percent:'1.0-1' }}</p>
    <p>Price: {{ price | currency:'USD' }}</p>
    <p>Rupees: {{ price | currency:'NPR' }}</p>
    <h3>Text and objects</h3>
    <p>{{ phrase | slice:0:5 }}</p>
    <p>{{ name | exclaim:3 }}</p>
    <div *ngFor="let fact of facts | keyvalue">
      <p>{{ fact.key }}: {{ fact.value }}</p>
    </div>
  </card>
</screen>
```

**What it compiles to**

Key lines of the generated `pipes-demo.component.tsx`:

```tsx
import { pipe } from '@rangular/runtime';

export class ExclaimPipe {
  transform(value: string, times?: number) {
    return value + '!'.repeat(times || 1);
  }
}
const __pipeExclaimPipe = new ExclaimPipe();

<Text variant="body">Short: {pipe('date', day, 'shortDate')}</Text>
<Text variant="body">Amount: {pipe('number', amount, '1.2-2')}</Text>
<Text variant="body">{__pipeExclaimPipe.transform(name, 3)}</Text>
{pipe('keyvalue', facts).map((fact, index) => (
  <View key={fact?.id ?? index}>
    <Text variant="body">{fact.key}: {fact.value}</Text>
  </View>
))}
```

Built-in pipes become calls to the runtime `pipe()` helper, so the app, the compiler's evaluator and the preview all format identically. A custom pipe compiles to a plain class plus one shared instance; a template use becomes a `transform` call on that instance.

**Rules used**

- **Dates**: `date` accepts a Date, an ISO string or epoch milliseconds. Named formats are `shortDate` (M/d/yy), `mediumDate` (MMM d, yyyy, the default), `shortTime` (h:mm a), `medium` and `short`. A custom format string uses the tokens yyyy, yy, MMM, MM, M, dd, d, HH, H, hh, h, mm, ss and a. Formatting uses local time.
- **Numbers**: `number:'1.2-2'` is a digitsInfo: minimum integer digits, then minimum and maximum fraction digits. The value is rounded to the maximum, padded to the minimum, and the integer part is grouped with commas. `percent` multiplies by 100 and appends `%`. An unreadable digitsInfo falls back to the pipe's default instead of throwing.
- **Currency**: `currency:'USD'` prefixes the symbol and formats with two fraction digits by default. Known symbols: USD $, EUR €, GBP £, INR ₹, NPR Rs. An unknown code prints the code itself, like `XYZ 49.50`. Pass `'code'` as the second argument to force the code, and a digitsInfo as the third to change the digits.
- **keyvalue** turns an object into `{ key, value }` entries sorted by key, which is what makes it usable in `*ngFor`. The loop variable has no `id`, so the generated key falls back to the index.
- **A custom pipe is an import.** The component file imports the pipe class the same way it imports a child component or a service; the compiler registers the `@Pipe` name from that import. An unregistered name is a `PIPE_UNKNOWN` error that lists every known pipe.
- **Preview boundary**: the preview's static first paint evaluates a custom pipe only when `transform` is a single `return` of one expression written in the template expression subset (so `||`, not `??`). The interactive preview page and the app run the full translated body, so a richer transform still works there and in the app; in the static paint it renders empty.
- **The async pipe** subscribes for you: `{{ stream$ | async }}` shows the latest emitted value, starting at null. In generated code each distinct streamed expression gets a state slot and an effect that subscribes on mount and unsubscribes on unmount; the streamed expression is captured at mount, so bind async to a stable field or service stream, not to an expression that builds a new observable per render.

**Common mistakes**

- **Forgetting the import.** Defining the pipe class is not enough; the component must import it, exactly like a child component.
- **Inventing a pipe name.** `| shout` when no pipe is registered under that name stops the build with `PIPE_UNKNOWN`; the error lists the names that do exist.
- **Expecting locale magic.** There is no locale input in v1: grouping is commas, months are English abbreviations, and the currency symbol table is the five codes above.
- **Slicing a number.** `slice` works on strings and arrays and passes anything else through unchanged.
