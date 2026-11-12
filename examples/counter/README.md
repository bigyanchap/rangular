# Recipe: Counter, events and state

**Intent**: A counter that goes up, down (never below zero) and resets: the smallest component where user interaction changes state.

**Source**

`counter.component.ts`:

```ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-counter',
  templateUrl: './counter.component.html',
})
export class CounterComponent {
  count = 0;

  increment() {
    this.count++;
  }

  decrement() {
    this.count--;
  }

  reset() {
    this.count = 0;
  }
}
```

`counter.component.html`:

```html
<screen>
  <appbar title="Counter"></appbar>
  <h1>{{ count }}</h1>
  <p *ngIf="count >= 5">Past five, keep going</p>
  <button (click)="increment()">Increment</button>
  <button (click)="decrement()" [disabled]="count === 0">Decrement</button>
  <button (click)="reset()">Reset</button>
</screen>
```

**What it compiles to**

Key lines of the generated `counter.component.tsx`:

```tsx
import { useState } from 'react';

export default function Counter() {
  const [count, setCount] = useState(0);   // count IS assigned in methods -> it becomes state

  const increment = () => {
    setCount(count + 1);                   // this.count++  ->  setCount(count + 1)
  };
  const decrement = () => {
    setCount(count - 1);                   // this.count--  ->  setCount(count - 1)
  };
  const reset = () => {
    setCount(0);                           // this.count = 0 -> setCount(0)
  };
  return (
    <RgScreen>
      <RgAppbar title="Counter" />
      <RgText variant="display">{count}</RgText>
      {(count >= 5) && (                   {/* *ngIf -> {cond && (...)} */}
        <RgText variant="bodyLarge">Past five, keep going</RgText>
      )}
      <RgButton onPress={() => increment()}>Increment</RgButton>                    {/* (click) -> onPress */}
      <RgButton disabled={(count === 0)} onPress={() => decrement()}>Decrement</RgButton>
      <RgButton onPress={() => reset()}>Reset</RgButton>
    </RgScreen>
  );
}
```

**Rules used**

- **State rule:** a field assigned anywhere inside a method (`=`, `+=`, `-=`, `*=`, `/=`, `++`, `--` on `this.field`) becomes `useState`; all its writes in methods are rewritten to the setter. A field never assigned stays `const` (see hello).
- Methods become `const` arrow functions inside the component, in class order. Supported statements: assignments/updates on `this.field`, `this.method(...)` calls, `if`/`else`, `return`, blocks, local `const`/`let`.
- `(click)="handler()"` compiles to `onPress={() => handler()}`. A bare reference also works, `(click)="increment"` compiles to `onPress={increment}`, but only the `()` form can pass arguments, e.g. `(click)="increment(5)"`.
- `[disabled]="count === 0"` is an ordinary `[prop]` binding whose expression is re-evaluated on every render.
- `*ngIf="cond"` wraps the element as `{cond && (...)}`.

**Common mistakes**

- **Giving a state field a non-literal initializer.** `count = computeStart()` cannot be hoisted: you get a `GEN_FIELD_STATE` warning and the field does not become state. Initialise with a literal (`0`, `'text'`, `true`, `[...]`, `{...}`) and compute later.
- **Using an unsupported statement in a method.** Loops, `try`, `switch`, etc. are outside the translation subset: the method compiles with a `METHOD_UNSUPPORTED` warning and a `/* TODO(Rangular) ... */` comment where the statement was, it does not run. Rewrite with assignments, `this.method()` calls and `if`/`else`, or move that logic out of the method.
- **Trying to change state from the template.** Templates only read state (`{{ count }}`, `[disabled]="count === 0"`). All writes belong in methods called from `(click)` bindings; there is no two-way binding yet.
