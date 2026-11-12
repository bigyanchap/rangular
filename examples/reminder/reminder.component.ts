import { Component } from '@angular/core';
import { SnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-reminder',
  templateUrl: './reminder.component.html',
})
export class ReminderComponent {
  title = '';
  when = '2026-11-13T09:00:00';
  repeat = 'none';
  sheetOpen = false;
  confirmOpen = false;
  deleted = false;
  restored = false;

  constructor(private snack: SnackBar) {}

  onWhen(value: string) {
    this.when = value;
  }

  onRepeat(value: string) {
    this.repeat = value;
  }

  openSheet() {
    this.sheetOpen = true;
  }

  closeSheet() {
    this.sheetOpen = false;
  }

  openConfirm() {
    this.confirmOpen = true;
  }

  closeConfirm() {
    this.confirmOpen = false;
  }

  save() {
    this.snack.open('Reminder saved');
  }

  deleteReminder() {
    this.confirmOpen = false;
    this.deleted = true;
    this.restored = false;
    const ref = this.snack.open('Reminder deleted', 'Undo');
    ref.onAction(() => {
      this.deleted = false;
      this.restored = true;
    });
  }
}
