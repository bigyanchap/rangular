import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class MailService {
  mails = [
    { id: 1, from: 'Sarju', subject: 'Photos from the weekend', snippet: 'Sharing the album with you', time: '9:12 am', body: 'Hi, I uploaded the photos from the weekend trip. The lake ones came out beautifully. Tell me which ones to print.' },
    { id: 2, from: 'Google', subject: 'Security alert', snippet: 'A new sign-in on your device', time: '8:03 am', body: 'A new device signed in to your account. If this was not you, review your account activity right away.' },
    { id: 3, from: 'Medium', subject: 'Your weekly reading list', snippet: 'Stories picked for you', time: 'Yesterday', body: 'Here are the stories your reading list picked this week, led by a long essay on attention and deep work.' },
    { id: 4, from: 'Awaken Me', subject: 'Build finished successfully', snippet: 'Your latest build is ready to test', time: 'Tue', body: 'The latest build finished successfully and is ready to test on your device.' },
  ];

  getById(id: string) {
    const found = this.mails.find((m: any) => m.id === Number(id));
    return found === undefined ? null : found;
  }
}
