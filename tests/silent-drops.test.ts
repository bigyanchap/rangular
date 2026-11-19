import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { compileComponent, hasErrors } from '../packages/compiler/src/compile';
import { DIAGNOSTIC_CODES } from '../packages/compiler/src/diagnostics';

/**
 * The no-silent-drops wave (2026-11-18): four ways the compiler used
 * to produce broken output, or lose source, without saying a word.
 * Each test pins the behaviour that replaced the silence: a working
 * translation where one exists, a coded error where none does.
 */

function project(files: Record<string, string>, entryName = 'app.component.ts') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-drops-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  const entry = path.join(dir, entryName);
  return compileComponent({
    tsSource: fs.readFileSync(entry, 'utf8'),
    fileName: entry,
    resolveFile: (rel) => {
      const p = path.join(dir, rel);
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined;
    },
    resolveImport: (spec) => {
      if (!spec.startsWith('.')) return undefined;
      const p = path.join(dir, `${spec}.ts`);
      return fs.existsSync(p) ? { fileName: p, source: fs.readFileSync(p, 'utf8') } : undefined;
    },
    rootDir: dir,
  });
}

const comp = (cls: string, tpl: string): Record<string, string> => ({
  'app.component.ts': `import { Component } from '@angular/core';\n@Component({ selector: 'app-root', templateUrl: './app.component.html' })\nexport class AppComponent { ${cls} }`,
  'app.component.html': tpl,
});

test('foreign tag handler receives $event instead of referencing it unbound', () => {
  const result = project(comp(
    `saved = ''; save(v: any) { this.saved = v; }`,
    `<screen><video-view (ready)="save($event)"></video-view></screen>`,
  ));
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(result.code.includes('onReady={($event) => save($event)}'), result.code);
  assert.ok(!result.code.includes('() => save($event)'), result.code);
});

test('foreign tag handler without $event keeps the plain wrapper', () => {
  const result = project(comp(
    `count = 0; bump() { this.count = this.count + 1; }`,
    `<screen><video-view (ready)="bump()"></video-view></screen>`,
  ));
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(result.code.includes('onReady={() => bump()}'), result.code);
});

test('a syntax error in a service file is a CLS_PARSE error, not a quiet drop', () => {
  const result = project({
    'app.component.ts': `import { Component } from '@angular/core';\nimport { DataService } from './data.service';\n@Component({ selector: 'app-root', templateUrl: './app.component.html' })\nexport class AppComponent { constructor(public data: DataService) {} }`,
    'app.component.html': `<screen><p>{{ data.title }}</p></screen>`,
    'data.service.ts': `import { Injectable } from '@angular/core';\n@Injectable({ providedIn: 'root' })\nexport class DataService { title = 'Hello'; broken = compute( ; count = 3; }`,
  });
  const errs = result.diagnostics.filter((d) => d.code === 'CLS_PARSE');
  assert.equal(errs.length, 1, JSON.stringify(result.diagnostics));
  assert.equal(errs[0].severity, 'error');
  assert.ok(errs[0].file?.endsWith('data.service.ts'), errs[0].file);
  assert.ok(DIAGNOSTIC_CODES['CLS_PARSE']);
});

test('a method named like a generated setter is a GEN_SETTER_COLLISION error', () => {
  const result = project(comp(
    `minutes = 5; setMinutes(v: number) { this.minutes = v; }`,
    `<screen><p>{{ minutes }}</p></screen>`,
  ));
  const errs = result.diagnostics.filter((d) => d.code === 'GEN_SETTER_COLLISION');
  assert.equal(errs.length, 1, JSON.stringify(result.diagnostics));
  assert.equal(errs[0].severity, 'error');
  assert.ok(errs[0].message.includes("'setMinutes'"), errs[0].message);
  assert.equal(hasErrors(result.diagnostics), true);
  assert.ok(DIAGNOSTIC_CODES['GEN_SETTER_COLLISION']);
});

test('a differently named method next to the same field stays clean', () => {
  const result = project(comp(
    `minutes = 5; pickMinutes(v: number) { this.minutes = v; }`,
    `<screen><p>{{ minutes }}</p></screen>`,
  ));
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
});

test('a value used from a classless relative import is a GEN_IMPORT_CLASSLESS error', () => {
  const result = project({
    'app.component.ts': `import { Component } from '@angular/core';\nimport { APP_TITLE } from './constants';\n@Component({ selector: 'app-root', templateUrl: './app.component.html' })\nexport class AppComponent { title = APP_TITLE; }`,
    'app.component.html': `<screen><p>{{ title }}</p></screen>`,
    'constants.ts': `export const APP_TITLE = 'My App';`,
  });
  const errs = result.diagnostics.filter((d) => d.code === 'GEN_IMPORT_CLASSLESS');
  assert.equal(errs.length, 1, JSON.stringify(result.diagnostics));
  assert.equal(errs[0].severity, 'error');
  assert.ok(errs[0].message.includes("'APP_TITLE'"), errs[0].message);
  assert.ok(DIAGNOSTIC_CODES['GEN_IMPORT_CLASSLESS']);
});

test('a type-only use of a classless file stays quiet', () => {
  const result = project({
    'app.component.ts': `import { Component } from '@angular/core';\nimport { Lesson } from './models';\n@Component({ selector: 'app-root', templateUrl: './app.component.html' })\nexport class AppComponent { current: Lesson | null = null; }`,
    'app.component.html': `<screen><p>Hi</p></screen>`,
    'models.ts': `export interface Lesson { id: number; title: string; }`,
  });
  const errs = result.diagnostics.filter((d) => d.code === 'GEN_IMPORT_CLASSLESS');
  assert.equal(errs.length, 0, JSON.stringify(result.diagnostics));
});
