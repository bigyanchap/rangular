import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * The npm publishing shape (2026-11-18): each package builds into
 * its own dist, the CLI's bin points at compiled output, and a CLI
 * installed outside the checkout scaffolds apps that depend on the
 * released packages by version range instead of file: specifiers.
 * These tests simulate the installed layout on disk and run the
 * packed CLI from it, the same shape the publish proof uses.
 */

const ROOT = path.join(__dirname, '..', '..');
const cliPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'cli', 'package.json'), 'utf8'));

function installCli(): { cliJs: string; work: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-publish-'));
  const pkgDir = path.join(tmp, 'lib', 'node_modules', '@rangular-framework', 'cli');
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.cpSync(path.join(ROOT, 'packages', 'cli', 'dist'), path.join(pkgDir, 'dist'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'packages', 'cli', 'package.json'), path.join(pkgDir, 'package.json'));
  // A real npm install hoists the CLI's declared typescript
  // dependency into the same node_modules; mirror that here.
  fs.symlinkSync(
    path.join(ROOT, 'node_modules', 'typescript'),
    path.join(tmp, 'lib', 'node_modules', 'typescript'),
    'dir',
  );
  const work = path.join(tmp, 'work');
  fs.mkdirSync(work, { recursive: true });
  return { cliJs: path.join(pkgDir, 'dist', 'cli', 'src', 'cli.js'), work };
}

function run(cliJs: string, args: string[], cwd: string) {
  return spawnSync(process.execPath, [cliJs, ...args], { cwd, encoding: 'utf8' });
}

test('published CLI: bin target is compiled output with a shebang', () => {
  const binPath = path.join(ROOT, 'packages', 'cli', cliPkg.bin.rg);
  assert.ok(fs.existsSync(binPath), 'the rg bin target exists after the package build');
  assert.ok(fs.readFileSync(binPath, 'utf8').startsWith('#!/usr/bin/env node'), 'the bin keeps its shebang');
  assert.equal(cliPkg.bin['rangular-framework'], cliPkg.bin.rg, 'both commands point at the same entry');
  assert.equal(cliPkg.dependencies.typescript, '^5.9.0', 'the CLI carries the compiler runtime dependency');
});

test('published CLI: init --app writes version-range deps and the standard metro config', () => {
  const { cliJs, work } = installCli();
  const res = run(cliJs, ['init', 'proof-app', '--app'], work);
  assert.equal(res.status, 0, res.stderr);
  const appDir = path.join(work, 'proof-app');
  assert.ok(fs.existsSync(appDir), 'a bare name lands in the current directory in published mode');
  const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies['@rangular-framework/ui'], `^${cliPkg.version}`);
  assert.equal(pkg.dependencies['@rangular-framework/runtime'], `^${cliPkg.version}`);
  const metro = fs.readFileSync(path.join(appDir, 'metro.config.js'), 'utf8');
  assert.ok(!metro.includes('watchFolders'), 'no monorepo watch folders in published mode');
  const readme = fs.readFileSync(path.join(appDir, 'README.md'), 'utf8');
  assert.ok(readme.includes('rg build src/app.component.ts'), 'the README teaches the rg command');
  const root = fs.readFileSync(path.join(appDir, 'src', 'AppRoot.tsx'), 'utf8');
  assert.ok(root.includes("from '@rangular-framework/ui'"), 'the starter compiles against the new scope');
});

test('published CLI: build compiles a component outside any checkout', () => {
  const { cliJs, work } = installCli();
  fs.writeFileSync(path.join(work, 'app.component.ts'), `import { Component } from '@angular/core';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
})
export class AppComponent {
  title = 'Proof';
}
`);
  fs.writeFileSync(path.join(work, 'app.component.html'), `<screen>
  <h1>{{ title }}</h1>
</screen>
`);
  const out = path.join(work, 'AppRoot.tsx');
  const res = run(cliJs, ['build', path.join(work, 'app.component.ts'), '--out', out, '--json'], work);
  assert.equal(res.status, 0, res.stderr);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.ok, true);
  assert.ok(fs.readFileSync(out, 'utf8').includes('RgScreen'), 'the compiled output uses the primitives');
});
