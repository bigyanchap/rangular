import { Component } from '@angular/core';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.component.html',
})
export class ProfileComponent {
  name = 'Bigyan Chapagain';
  bio = 'Engineer, inventor and seeker of ultimate truth.';
  following = false;

  posts = [
    { id: 1, title: 'Building Awaken Me, one morning at a time', snippet: 'A conscious alarm that wakes you into meditation, not noise.', time: 'Today' },
    { id: 2, title: 'Meditation is not an escape', snippet: 'Sitting still until the mind stops negotiating.', time: 'Yesterday' },
    { id: 3, title: 'Notes on reverse aging, the yogic way', snippet: 'Growing younger is a discipline, not a product.', time: 'Tue' },
  ];

  toggleFollow() {
    this.following = !this.following;
  }
}
