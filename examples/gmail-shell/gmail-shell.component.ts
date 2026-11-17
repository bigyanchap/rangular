import { Component } from '@angular/core';

@Component({
  selector: 'app-gmail-shell',
  templateUrl: './gmail-shell.component.html',
})
export class GmailShellComponent {
  q = '';
  wifi = true;
  savedFirst = true;
  savedSecond = false;

  openNav() {}
  toggleFirst() { this.savedFirst = !this.savedFirst; }
  toggleSecond() { this.savedSecond = !this.savedSecond; }
  flipWifi(v: boolean) { this.wifi = v; }
}
