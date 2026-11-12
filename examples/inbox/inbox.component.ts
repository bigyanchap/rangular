import { Component } from '@angular/core';

@Component({
  selector: 'app-inbox',
  templateUrl: './inbox.component.html',
})
export class InboxComponent {
  title = 'Inbox';

  mails = [
    { id: 1, from: 'Sarju', subject: 'Photos from the weekend', snippet: 'Sharing the album with you…', time: '9:12 am', unread: true },
    { id: 2, from: 'Google', subject: 'Security alert', snippet: 'A new sign-in on your device', time: '8:03 am', unread: true },
    { id: 3, from: 'Medium', subject: 'Your weekly reading list', snippet: 'Stories picked for you', time: 'Yesterday', unread: false },
    { id: 4, from: 'Awaken Me', subject: 'Build finished successfully', snippet: 'Your latest build is ready to test', time: 'Tue', unread: false },
  ];
}
