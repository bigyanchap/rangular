import { Component } from '@angular/core';

@Component({
  selector: 'app-insights',
  templateUrl: './insights.component.html',
})
export class InsightsComponent {
  day = '2026-11-13T00:00:00';
  brand = '#0b57d0';
  notes = 'Saw the **sunrise** again.\n- Walked\n- Meditated';
  photoOpen = false;

  week = [
    { label: 'Mon', value: 12 },
    { label: 'Tue', value: 19 },
    { label: 'Wed', value: 9 },
    { label: 'Thu', value: 15 },
  ];

  trend = [
    { label: 'W1', value: 4 },
    { label: 'W2', value: 7 },
    { label: 'W3', value: 6 },
    { label: 'W4', value: 9 },
  ];

  split = [
    { label: 'Practice', value: 50 },
    { label: 'Study', value: 30 },
    { label: 'Rest', value: 20 },
  ];

  onDay(v: string) { this.day = v; }
  onBrand(v: string) { this.brand = v; }
  onNotes(v: string) { this.notes = v; }
  openPhoto() { this.photoOpen = true; }
  closePhoto() { this.photoOpen = false; }
  goHome() {}
}
