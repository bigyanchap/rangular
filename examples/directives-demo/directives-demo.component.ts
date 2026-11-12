import { Component } from '@angular/core';
import { HighlightDirective } from './highlight.directive';

@Component({
  selector: 'app-directives-demo',
  templateUrl: './directives-demo.component.html',
})
export class DirectivesDemoComponent {
  color = 'cyan';
}
