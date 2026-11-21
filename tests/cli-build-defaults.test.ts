import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

// `rg build` with no arguments is the app-folder form
// (2026-11-21): the entry defaults to src/app.component.ts
// and --out defaults to AppRoot.tsx beside the entry, so
// the common case needs no arguments at all. These tests
// run the real CLI binary in temp app folders, the same
// spawn pattern as the Stage 5 CLI tests.
const ROOT = path.join(__dirname, '..', '..');
const cliPath = path.join(ROOT, 'dist', 'packages', 'cli', 'src', 'cli.js');

function makeApp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-build-defaults-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'app.component.ts'), [
    "import { Component } from '@angular/core';",
    '',
    '@Component({',
    "  selector: 'app-root',",
    "  templateUrl: './app.component.html',",
    '})',
    'export class AppComponent {',
    "  title = 'Hello';",
    '}',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'src', 'app.component.html'), '<h1>{{ title }}</h1>\n');
  return dir;
}

function runBuild(dir: string, args: string[]) {
  return spawnSync('node', [cliPath, 'build', ...args], { cwd: dir, encoding: 'utf8' });
}

test('build with no arguments compiles src/app.component.ts to src/AppRoot.tsx', () => {
  const dir = makeApp();
  const run = runBuild(dir, []);
  assert.equal(run.status, 0, run.stderr);
  const out = path.join(dir, 'src', 'AppRoot.tsx');
  assert.ok(fs.existsSync(out), 'AppRoot.tsx was written beside the entry');
  const code = fs.readFileSync(out, 'utf8');
  assert.ok(code.includes('Hello') || code.includes('title'), 'the compiled output carries the component');
  // The explicit form produces byte-identical output: the
  // defaults are the same files, not a different code path.
  const explicit = path.join(dir, 'explicit.tsx');
  const run2 = runBuild(dir, [path.join('src', 'app.component.ts'), '--out', explicit]);
  assert.equal(run2.status, 0, run2.stderr);
  assert.equal(fs.readFileSync(explicit, 'utf8'), code);
});

test('build with an entry but no --out still writes AppRoot.tsx beside it', () => {
  const dir = makeApp();
  const run = runBuild(dir, [path.join('src', 'app.component.ts')]);
  assert.equal(run.status, 0, run.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'src', 'AppRoot.tsx')));
});

test('build --json with the flag first resolves the same defaults', () => {
  const dir = makeApp();
  const run = runBuild(dir, ['--json']);
  assert.equal(run.status, 0, run.stderr);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.ok, true);
  assert.ok(String(parsed.outFile).endsWith('AppRoot.tsx'), 'the JSON report names the default output');
});

test('build with no arguments outside an app folder fails with the way out', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-build-empty-'));
  const run = runBuild(dir, []);
  assert.notEqual(run.status, 0);
  assert.ok((run.stderr + run.stdout).includes('src/app.component.ts'), 'the message names the file it looked for');
  assert.ok(!fs.existsSync(path.join(dir, 'src', 'AppRoot.tsx')), 'nothing was written');
});
