import { Component } from '@angular/core';
import { ExclaimPipe } from './exclaim.pipe';

@Component({
  selector: 'app-pipes-demo',
  templateUrl: './pipes-demo.component.html',
})
export class PipesDemoComponent {
  name = 'rangular';
  day = '2024-02-29T15:04:05';
  amount = 1234567.891;
  ratio = 0.756;
  price = 49.5;
  phrase = 'Angular in, React Native out';
  facts = { lang: 'TypeScript', target: 'React Native', since: 2026 };
}
