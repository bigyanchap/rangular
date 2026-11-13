import { Component } from '@angular/core';

@Component({
  selector: 'app-forms-plus',
  templateUrl: './forms-plus.component.html',
})
export class FormsPlusComponent {
  phone = '';
  score = 0;
  code = '';
  page = 0;
  picked = '';

  onPhone(v: string) { this.phone = v; }
  onScore(n: number) { this.score = n; }
  onCode(v: string) { this.code = v; }
  onPage(i: number) { this.page = i; }
  onFiles(files: { name: string }[]) {
    this.picked = files.length ? files[0].name : '';
  }
}
