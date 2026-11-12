import { Component } from '@angular/core';

@Component({
  selector: 'app-mailbox-pro',
  templateUrl: './mailbox-pro.component.html',
})
export class MailboxProComponent {
  tabIndex = 0;
  unread = 3;
  storageUsed = 82;
  previewLines = 1;
  moveTo = '';
  movedTo = '';
  aboutOpen = false;
  filters = ['Unread', 'Has attachment', 'Starred'];
  folderNames = ['Inbox', 'Starred', 'Sent', 'Drafts', 'Trash', 'Travel', 'Receipts'];
  folders = [
    { name: 'Inbox', count: 12 },
    { name: 'Starred', count: 2 },
    { name: 'Sent', count: 30 },
    { name: 'Trash', count: 4 },
  ];
  inboxMails = [
    { from: 'Sarju', subject: 'Train tickets for Friday' },
    { from: 'Google', subject: 'Your storage is almost full' },
    { from: 'Medium', subject: 'Your weekly reading list' },
  ];
  starredMails = [
    { from: 'Awaken Me', subject: 'Launch checklist' },
    { from: 'Pankaj Shukla', subject: 'New deck on agents' },
  ];

  onTab(index: number) {
    this.tabIndex = index;
  }

  markAllRead() {
    this.unread = 0;
  }

  onLines(value: number) {
    this.previewLines = value;
  }

  onMove(name: string) {
    this.movedTo = name;
  }

  onAboutToggle(open: boolean) {
    this.aboutOpen = open;
  }

  removeFilter(name: string) {
    this.filters = this.filters.filter((f: string) => f !== name);
  }
}
