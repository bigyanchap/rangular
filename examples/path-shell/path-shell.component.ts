import { Component } from '@angular/core';

@Component({
  selector: 'app-path-shell',
  templateUrl: './path-shell.component.html',
})
export class PathShellComponent {
  pct = 30;
  tab = 0;
  navOpen = false;

  openNav() { this.navOpen = true; }
  closeNav() { this.navOpen = false; }
  goSearch() {}
  goSaved() {}
  pick(i: number) { this.tab = i; }
}
