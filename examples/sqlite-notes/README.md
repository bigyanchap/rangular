# Recipe: SQLite notes, a database in a service

**Intent**: A notes screen backed by a real SQLite database on the device, with no database code in the component at all. One root service opens the database file, creates the table, and answers every query; the screen binds to the service's fields and calls its methods. This is the blessed pattern for a database in the Rangular framework: the framework does not ship SQLite, the app installs expo-sqlite, and a service drives it (Path 3 of the third-party guide).

**Source**

`database.service.ts`:

```ts
import { Injectable } from '@angular/core';
import * as SQLite from 'expo-sqlite';

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
```

`sqlite-notes.component.ts`:

```ts
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
```

**What it compiles to**

- The service is inlined into the generated module as a root service, and the `expo-sqlite` import is carried into the generated module's import block as written, like every third-party import in a contributing file.
- The component reads the service through the generated subscription, so when a query assigns `notes` or `ready`, the screen repaints on its own.
- The browser preview renders the service's starting state (not ready, no rows). The database itself opens on a device; the preview never runs native modules.

**Rules used**

- Install belongs to the app: `npx expo install expo-sqlite`. The framework scaffold does not preinstall it, so an app with no database carries nothing.
- One service owns the file, the tables and the queries. Components bind fields and call methods; SQL lives in exactly one place.
- The `.then` form everywhere: `await` inside a method is outside the subset and warns `METHOD_UNSUPPORTED`.
- State propagates by assignment, not mutation: after a write, reload and assign the fresh rows.
- `CREATE TABLE IF NOT EXISTS` in the constructor makes the first run and every later run take the same path. Schema changes after release are the app's own migration job.

**Common mistakes**

- Writing SQL in a component, or opening the database in more than one service: two owners, two connections, no single place to migrate.
- Pushing into the rows array after an insert instead of reloading: the screen does not repaint on mutation, and the array drifts from the table.
- Expecting the preview to show live rows: it paints the starting state by design. Run the app on a device to see the database work.
