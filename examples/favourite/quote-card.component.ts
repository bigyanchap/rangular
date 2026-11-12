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
