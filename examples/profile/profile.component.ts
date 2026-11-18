import { Component } from '@angular/core';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.component.html',
})
export class ProfileComponent {
  name = 'Alex Carter';
  bio = 'Product designer and weekend photographer.';
  following = false;

  posts = [
    { id: 1, title: 'Building a photo app, one feature at a time', snippet: 'A simple gallery that keeps your photos organised.', time: 'Today' },
    { id: 2, title: 'Why I switched to a paper notebook', snippet: 'Planning the week on paper, one page at a time.', time: 'Yesterday' },
    { id: 3, title: 'A beginner guide to film photography', snippet: 'What I learned from my first three rolls of film.', time: 'Tue' },
  ];

  toggleFollow() {
    this.following = !this.following;
  }
}
