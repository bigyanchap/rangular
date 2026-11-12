# Recipe: Content projection with ng-content

**Intent**: Write content in the parent, have it appear inside the child component exactly where the child places `<ng-content></ng-content>`: the panel pattern (a card with a frame, the caller supplies the body).

**Source**

`panel.component.ts`:

```ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-panel',
  templateUrl: './panel.component.html',
})
export class PanelComponent {}
```

`panel.component.html`:

```html
<card>
  <ng-content></ng-content>
</card>
```

`projection-demo.component.ts`:

```ts
import { Component } from '@angular/core';
import { PanelComponent } from './panel.component';

@Component({
  selector: 'app-projection-demo',
  templateUrl: './projection-demo.component.html',
})
export class ProjectionDemoComponent {
  noted = 0;

  note() {
    this.noted++;
  }
}
```

`projection-demo.component.html`:

```html
<screen>
  <appbar title="Projection"></appbar>
  <h1>Panels</h1>
  <app-panel>
    <h3>Inside the panel</h3>
    <p>This content was written in the parent and projected into the child's card.</p>
    <button (click)="note()">Note it</button>
  </app-panel>
  <p *ngIf="noted > 0">Noted {{ noted }} times</p>
</screen>
```

**What it compiles to**

Key lines of the generated `projection-demo.component.tsx`:

```tsx
export function Panel({ children }: { children?: any }) {
  return (
    <RgCard>
      {children}
    </RgCard>
  );
}

<Panel>
  <Text variant="title">Inside the panel</Text>
  <Text variant="body">This content was written in the parent and projected into the child's card.</Text>
  <RgButton onPress={() => note()}>Note it</RgButton>
</Panel>
```

Projection is React's children prop, which is the same idea Angular expresses with `<ng-content>`: the child decides where the slot sits, the parent's content renders there, and the content still belongs to the parent: its bindings and event handlers run in the parent's scope, as the Note it button shows (it increments the parent's `noted`).

**Rules used**

- **One default slot in v1.** A child template may place a single `<ng-content></ng-content>`; everything written inside the component's tag in the parent lands there, in order.
- **Multi-slot projection is not in v1.** An `<ng-content select="...">` earns a `PROJECTION_SELECT_UNSUPPORTED` warning and behaves as the default slot: all children land there regardless of the select.
- **Content with no slot is not rendered.** If the child template has no `<ng-content>`, children written inside its tag in the parent go nowhere, the same as Angular.
- **Scope stays with the writer.** Projected content evaluates in the parent's fields and methods, not the child's, in the app and in the preview alike.
- **Preview parity**: the preview composes the same way, writing the parent's nodes into the child's tree at the `<ng-content>` position.

**Common mistakes**

- **Expecting named slots.** `select` is parsed and warned about, not honoured; split into two child components if you need two regions today.
- **Binding to the child's fields from projected content.** The content is the parent's; a field that lives only on the child is not visible there.
- **Self-closing the component tag with content elsewhere.** Content must be written between the open and close tags of the component element.
