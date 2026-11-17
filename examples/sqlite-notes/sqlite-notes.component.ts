import { Component } from '@angular/core';
import { DatabaseService } from './database.service';

@Component({
  selector: 'app-sqlite-notes',
  templateUrl: './sqlite-notes.component.html',
})
export class SqliteNotesComponent {
  draft = '';

  constructor(public db: DatabaseService) {}

  addNote() {
    this.db.add(this.draft);
    this.draft = '';
  }
}
