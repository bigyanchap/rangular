import { Component } from '@angular/core';

@Component({
  selector: 'app-shell',
  templateUrl: './app-shell.component.html',
})
export class AppShellComponent {
  navOpen = false;
  menuOpen = false;
  stepIndex = 0;
  lastAction = '';

  openNav() { this.navOpen = true; }
  closeNav() { this.navOpen = false; }
  openMenu() { this.menuOpen = true; }
  closeMenu() { this.menuOpen = false; }
  act(name: string) { this.lastAction = name; }
  onStep(i: number) { this.stepIndex = i; }
  next() { this.stepIndex = this.stepIndex + 1; }
}
