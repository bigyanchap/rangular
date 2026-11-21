import { Component } from '@angular/core';

/**
 * The framework's default dress, composed on one screen: the
 * blue gradient band, a card whose rows lead with tinted icon
 * circles and count pills, the green check square, chips, a
 * success switch and the primary button. The colours are not
 * chosen here; they are the theme tokens (the app blue, the
 * light tint container, the Gmail green success, the blue
 * gradient stops), so the screen restyles itself if the
 * tokens ever move. The patterns are plain sections and
 * styles: copy them from this example into any app.
 */
@Component({
  selector: 'app-dressed',
  templateUrl: './dressed.component.html',
  styles: [`
    .band-title { font-size: 20px; font-weight: 700; color: #ffffff; }
    .band-sub { font-size: 14px; color: #d3e3fd; }
    .row { flex-direction: row; align-items: center; gap: 12px; }
    .ic { width: 44px; height: 44px; border-radius: 9999px; background-color: #e8f0fe; align-items: center; justify-content: center; }
    .grow { flex: 1; }
    .muted { font-size: 14px; color: #5f6368; }
    .pill { background-color: #e8f0fe; border-radius: 9999px; padding: 8px; }
    .pill-text { font-size: 12px; font-weight: 700; color: #0b57d0; }
    .chk { width: 24px; height: 24px; border-radius: 8px; background-color: #34a853; align-items: center; justify-content: center; }
  `],
})
export class DressedComponent {
  lightOn = true;
  taps = 0;

  onLight(value: boolean) {
    this.lightOn = value;
  }

  start() {
    this.taps++;
  }
}
