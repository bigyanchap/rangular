import { Component } from '@angular/core';

@Component({
  selector: 'app-feed',
  templateUrl: './feed.component.html',
})
export class FeedComponent {
  tab = 0;
  refreshing = false;
  loading = false;
  lastAction = '';

  posts = [
    { id: 1, from: 'Sarju', subject: 'Photos from the weekend', snippet: 'Sharing the album with you', time: '9:12 am' },
    { id: 2, from: 'Awaken Me', subject: 'Build finished successfully', snippet: 'Your latest build is ready to test', time: '8:03 am' },
    { id: 3, from: 'Medium', subject: 'Your weekly reading list', snippet: 'Stories picked for you', time: 'Yesterday' },
    { id: 4, from: 'Field Notes', subject: 'Transformer testing, day one', snippet: 'Megger readings from the yard', time: 'Tue' },
  ];

  freshPost = { id: 5, from: 'Field Notes', subject: 'Fresh off the wire', snippet: 'Pulled in by your refresh', time: 'Now' };

  olderPosts = [
    { id: 6, from: 'Google', subject: 'Security alert', snippet: 'A new sign-in on your device', time: 'Mon' },
    { id: 7, from: 'Medium', subject: 'Draft published', snippet: 'Part 23 of the series is live', time: 'Sun' },
  ];

  onTab(i: number) { this.tab = i; }
  reload() {
    this.refreshing = true;
    this.posts = [this.freshPost].concat(this.posts);
    this.refreshing = false;
  }
  loadMore() { this.posts = this.posts.concat(this.olderPosts); }
  toggleLoading() { this.loading = !this.loading; }
  star(subject: string) { this.lastAction = 'Starred: ' + subject; }
  remove(subject: string) { this.lastAction = 'Deleted: ' + subject; }
}
