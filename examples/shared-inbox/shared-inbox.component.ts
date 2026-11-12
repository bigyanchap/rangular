import { Component } from '@angular/core';
import { MailService } from './mail.service';
import { UnreadBadgeComponent } from './unread-badge.component';

@Component({
  selector: 'app-shared-inbox',
  templateUrl: './shared-inbox.component.html',
})
export class SharedInboxComponent {
  constructor(private mail: MailService) {}

  markAllRead() {
    this.mail.markAllRead();
  }
}
