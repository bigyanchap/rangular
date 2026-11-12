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
