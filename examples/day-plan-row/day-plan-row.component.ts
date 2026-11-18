import { Component } from '@angular/core';

@Component({
  selector: 'app-day-plan-row',
  templateUrl: './day-plan-row.component.html',
  styles: [`
    /* doctor: allow-hex: the green and grey below are the brand
       colours of the day planner app this row is modelled on, not Material roles. */
    .check-cell { width: 34px; height: 34px; }
    .check-on { width: 34px; height: 34px; border-radius: 12px; background-color: #2f9e44; align-items: center; justify-content: center; }
    .check-off { width: 34px; height: 34px; border-radius: 12px; border-width: 2px; border-color: #868e96; }
    .check-mark { color: #ffffff; font-size: 16px; font-weight: 700; text-align: center; }
  `],
})
export class DayPlanRowComponent {
  featured = { title: 'Morning Run', time: '6:30 to 7:15 am', pieces: '3 pieces, 2 done' };
  runDone = false;

  blocks = [
    { id: 1, title: 'Team Standup', time: '9:00 to 9:15 am', pieces: '', done: true },
    { id: 2, title: 'Deep Work', time: '9:30 to 11:30 am', pieces: '4 pieces, 1 done', done: false },
    { id: 3, title: 'Evening Walk', time: '5:45 to 6:30 pm', pieces: '', done: false },
  ];

  toggleRun() {
    this.runDone = !this.runDone;
  }
}
