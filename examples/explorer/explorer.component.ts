import { Component } from '@angular/core';

@Component({
  selector: 'app-explorer',
  templateUrl: './explorer.component.html',
})
export class ExplorerComponent {
  city = 'ktm';
  saved = false;
  people = [
    { name: 'Mina', age: 31 },
    { name: 'Arun', age: 25 },
    { name: 'Sita', age: 40 },
    { name: 'Bikash', age: 25 },
    { name: 'Anita', age: 36 },
  ];

  onCity(v: string) { this.city = v; this.saved = false; }
  save() { this.saved = true; }
}
