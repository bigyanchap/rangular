import { Component } from '@angular/core';

@Component({
  selector: 'app-gradient-shell',
  templateUrl: './gradient-shell.component.html',
})
export class GradientShellComponent {
  q = '';
  savedFirst = true;
  savedSecond = false;
  drawerOpen = false;

  openNav() { this.drawerOpen = true; }
  closeNav() { this.drawerOpen = false; }
  toggleFirst() { this.savedFirst = !this.savedFirst; }
  toggleSecond() { this.savedSecond = !this.savedSecond; }
}
