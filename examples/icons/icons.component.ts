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
  names = ['alarm', 'arrow-down', 'arrow-left', 'arrow-right', 'arrow-up', 'bell', 'bookmark', 'bookmark-outline', 'calendar', 'camera', 'chart', 'chat', 'check', 'check-circle', 'chevron-down', 'chevron-left', 'chevron-right', 'chevron-up', 'close', 'code', 'copy', 'dark-mode', 'delete', 'download', 'edit', 'error', 'file', 'filter', 'folder', 'group', 'heart', 'heart-outline', 'help', 'history', 'home', 'image', 'info', 'language', 'link', 'location', 'lock', 'login', 'logo', 'logout', 'mail', 'menu', 'mic', 'minus', 'more-horiz', 'more-vert', 'pause', 'person', 'play', 'plus', 'print', 'redo', 'refresh', 'save', 'schedule', 'school', 'search', 'send', 'settings', 'share', 'sort', 'star', 'star-outline', 'sun', 'thumb-up', 'timer', 'tune', 'undo', 'upload', 'visibility', 'visibility-off', 'volume', 'warning', 'wifi', 'work'];
  lastTap = '';

  tapIcon(name: string) {
    this.lastTap = name;
  }
}
