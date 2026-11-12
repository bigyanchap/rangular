import { Component } from '@angular/core';
import { PanelComponent } from './panel.component';

@Component({
  selector: 'app-projection-demo',
  templateUrl: './projection-demo.component.html',
})
export class ProjectionDemoComponent {
  noted = 0;

  note() {
    this.noted++;
  }
}
