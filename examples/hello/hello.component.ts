import { Component } from '@angular/core';

@Component({
  selector: 'app-hello',
  templateUrl: './hello.component.html',
  styles: [`
    h1 { color: #0b57d0; margin-bottom: 8px; }
    .card-note { font-size: 14px; color: #5f6368; }
  `],
})
export class HelloComponent {
  title = 'Welcome to Rangular';
  subtitle = 'You wrote Angular. This screen is React Native.';
  actionDisabled = false;
}
