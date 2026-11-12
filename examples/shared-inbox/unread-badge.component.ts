import { Component } from '@angular/core';
import { MailService } from './mail.service';

@Component({
  selector: 'unread-badge',
  templateUrl: './unread-badge.component.html',
})
export class UnreadBadgeComponent {
  loaded = false;

  constructor(private mail: MailService) {}

  ngOnInit() {
    this.loaded = true;
  }
}
