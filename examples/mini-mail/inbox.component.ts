import { Component } from '@angular/core';
import { MailService } from './mail.service';

@Component({
  selector: 'app-inbox',
  templateUrl: './inbox.component.html',
})
export class InboxComponent {
  constructor(private mail: MailService) {}
}
