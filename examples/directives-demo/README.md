# Recipe: An attribute directive that styles its host

**Intent**: The canonical beginner directive from the Angular docs, the highlight directive, working in Rangular: an `@Input()` colour, a default colour fallback, and the host element's background set from them.

**Source**

`highlight.directive.ts`:

```ts
import { Directive, ElementRef, Input } from '@angular/core';

@Directive({ selector: '[appHighlight]' })
export class HighlightDirective {
  @Input() appHighlight = '';
  @Input() defaultColor = '';

  constructor(private el: ElementRef) {}

  ngOnInit() {
    this.el.nativeElement.style.backgroundColor = this.appHighlight || this.defaultColor || 'transparent';
  }
}
```

`directives-demo.component.ts`:

```ts
import { Component } from '@angular/core';
import { HighlightDirective } from './highlight.directive';

@Component({
  selector: 'app-directives-demo',
  templateUrl: './directives-demo.component.html',
})
export class DirectivesDemoComponent {
  color = 'cyan';
}
```

`directives-demo.component.html`:

```html
<screen>
  <appbar title="Directive"></appbar>
  <h1>Highlight</h1>
  <p appHighlight="yellow">A static highlight, straight from the attribute.</p>
  <p [appHighlight]="color" defaultColor="violet">A bound highlight with a fallback colour.</p>
  <p>No directive here.</p>
</screen>
```

**What it compiles to**

Key lines of the generated `directives-demo.component.tsx`:

```tsx
<Text variant="body" style={{ backgroundColor: (("yellow" || '') || 'transparent') }}>A static highlight, straight from the attribute.</Text>
<Text variant="body" style={{ backgroundColor: ((color || "violet") || 'transparent') }}>A bound highlight with a fallback colour.</Text>
<Text variant="body">No directive here.</Text>
```

There is no directive object at runtime. The compiler reads the directive class, extracts the style assignments from `ngOnInit` (or from a setter for one input), and folds them into a style object computed at the host element, with each input replaced by the value the host gives it: a binding first, then a static attribute, then a declared field initializer. The directive's attributes are consumed by the directive and never reach the generated component as props.

**Rules used**

- **The supported subset is style only.** A directive class with `@Input()` fields, an injected `ElementRef`, and logic in `ngOnInit` or in a setter for one input, whose body is local declarations plus assignments of the exact shape `this.el.nativeElement.style.<prop> = <expr>;`. The expression may use the inputs, the setter's parameter, literals, local constants, arithmetic, comparisons and ternaries.
- **Anything outside the subset is a `DIR_UNSUPPORTED` warning**, not a silent drop: event listeners, Renderer2 calls, reading the element, class or attribute writes, and directives on child component tags or on dedicated elements (input, icon, datetime-picker) are all reported with the reason. The host still renders, without the directive's styles.
- **The host usage is Angular's**: the attribute name is the selector's bracket name. `<p appHighlight="yellow">` uses the static value; `<p [appHighlight]="color">` binds it; other inputs (here `defaultColor`) bind or set by their own names.
- **Style merge order**: when the host also has styles of its own (a class or a `[style]`), the directive's styles merge last and win per property.
- **Preview parity**: the preview computes the same merged style, in the server paint and in the interactive page, from the same extracted assignments.

**Common mistakes**

- **Putting behaviour in the directive.** A directive that listens for taps or changes text is outside the v1 subset and earns `DIR_UNSUPPORTED`. Put behaviour in the component for now.
- **Naming the attribute after the class.** The attribute is the selector's bracket name (`appHighlight`), not the class name (`HighlightDirective`).
- **Expecting the directive on a child component.** `<app-panel appHighlight="yellow">` warns and applies nothing; style the child's own elements inside the child, or wrap the child in a `<div>` and direct the wrapper.
