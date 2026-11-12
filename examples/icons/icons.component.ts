import { Component } from '@angular/core';

@Component({
  selector: 'app-icons',
  templateUrl: './icons.component.html',
  styles: [`
    .icon-cell { align-items: center; gap: 4px; padding: 8px; }
    .icon-line { flex-direction: row; align-items: center; gap: 12px; padding: 8px; }
  `],
})
export class IconsComponent {
  names = ['menu', 'search', 'close', 'check', 'chevron-left', 'chevron-right', 'arrow-left', 'arrow-right', 'plus', 'minus', 'bell', 'heart', 'star', 'settings', 'home', 'person', 'calendar', 'alarm', 'play', 'pause', 'edit', 'delete', 'share', 'info', 'warning', 'mail', 'sun'];
  lastTap = '';

  tapIcon(name: string) {
    this.lastTap = name;
  }
}
