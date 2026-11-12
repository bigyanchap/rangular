import { Component } from '@angular/core';

@Component({
  selector: 'app-dinacharya-row',
  templateUrl: './dinacharya-row.component.html',
  styles: [`
    /* doctor: allow-hex: the gold and bronze below are the Awaken Me brand
       colours of the real app this row is modelled on, not Material roles. */
    .check-cell { width: 34px; height: 34px; }
    .check-on { width: 34px; height: 34px; border-radius: 12px; background-color: #d9a441; align-items: center; justify-content: center; }
    .check-off { width: 34px; height: 34px; border-radius: 12px; border-width: 2px; border-color: #a06a35; }
    .check-mark { color: #ffffff; font-size: 16px; font-weight: 700; text-align: center; }
  `],
})
export class DinacharyaRowComponent {
  featured = { title: 'Morning Yoga', time: '5:30 to 6:15 am', pieces: '3 pieces, 2 done' };
  yogaDone = false;

  blocks = [
    { id: 1, title: 'Puja', time: '6:30 to 6:50 am', pieces: '', done: true },
    { id: 2, title: 'Deep Work', time: '9:00 to 11:00 am', pieces: '4 pieces, 1 done', done: false },
    { id: 3, title: 'Evening Walk', time: '5:45 to 6:30 pm', pieces: '', done: false },
  ];

  toggleYoga() {
    this.yogaDone = !this.yogaDone;
  }
}
