import { Injectable } from '@angular/core';
import * as SQLite from 'expo-sqlite';

/**
 * One root service owns the database: the file, the tables and
 * every query. Screens inject it and read its fields; they never
 * write SQL. The package is the app's own install
 * (npx expo install expo-sqlite); the framework does not ship it.
 */
@Injectable({ providedIn: 'root' })
export class DatabaseService {
  db: any = null;
  ready = false;
  notes: { id: number; text: string }[] = [];

  constructor() {
    SQLite.openDatabaseAsync('notes.db').then((db) => {
      this.db = db;
      this.db.execAsync(
        'CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL)',
      ).then(() => {
        this.ready = true;
        this.loadAll();
      });
    });
  }

  loadAll() {
    if (this.db) {
      this.db.getAllAsync('SELECT id, text FROM notes ORDER BY id DESC').then((rows: any) => {
        this.notes = rows;
      });
    }
  }

  add(text: string) {
    if (this.db) {
      this.db.runAsync('INSERT INTO notes (text) VALUES (?)', text).then(() => {
        this.loadAll();
      });
    }
  }

  remove(id: number) {
    if (this.db) {
      this.db.runAsync('DELETE FROM notes WHERE id = ?', id).then(() => {
        this.loadAll();
      });
    }
  }
}
