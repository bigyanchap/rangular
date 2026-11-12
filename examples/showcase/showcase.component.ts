import { Component } from '@angular/core';

@Component({
  selector: 'app-showcase',
  templateUrl: './showcase.component.html',
  styles: [`
    h1 { color: #0b57d0; margin-bottom: 8px; }
    .card-note { font-size: 14px; color: #5f6368; }
    .badge { background-color: #c2e7ff; color: #001d35; border-radius: 9999px; padding-top: 4px; padding-bottom: 4px; padding-left: 12px; padding-right: 12px; font-size: 12px; font-weight: 700; }
  `],
})
export class ShowcaseComponent {
  taps = 0;
  unread = 2;

  items = [
    { id: 1, title: 'Tokens', subtitle: 'Colour roles in light and dark', time: '9:00' },
    { id: 2, title: 'Type scale', subtitle: 'Display down to caption', time: '9:05' },
    { id: 3, title: 'Spacing', subtitle: 'Snapped to the scale', time: '9:10' },
  ];

  primaryTap() {
    this.taps++;
  }
}
