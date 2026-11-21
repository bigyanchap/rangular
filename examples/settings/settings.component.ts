import { Component } from '@angular/core';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.component.html',
  styles: [`
    .sample-s { font-size: 12px; }
    .sample-m { font-size: 14px; }
    .sample-l { font-size: 20px; }
  `],
})
export class SettingsComponent {
  wifiOn = true;
  dataOn = false;
  notifications = false;
  view = 'list';
  size = 'm';

  onWifi(value: boolean) {
    this.wifiOn = value;
  }

  onData(value: boolean) {
    this.dataOn = value;
  }

  onNotifications(value: boolean) {
    this.notifications = value;
  }

  onView(value: string) {
    this.view = value;
  }

  onSize(value: string) {
    this.size = value;
  }
}
