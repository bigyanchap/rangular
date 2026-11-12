import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildCatalog,
  compileComponent,
  DIAGNOSTIC_CODES,
  formatDiagnostic,
  renderCatalogMarkdown,
  TAG_MAP,
} from '../packages/compiler/src/index';

const repoRoot = path.resolve(__dirname, '../..');
const cliPath = path.join(repoRoot, 'dist', 'packages', 'cli', 'src', 'cli.js');

test('TAG_MAP is the exported single source of truth for codegen and catalog', () => {
  assert.equal(TAG_MAP['row'].component, 'RgRow');
  assert.equal(TAG_MAP['button'].component, 'RgButton');
  assert.equal(TAG_MAP['button'].fromUi, true);
  assert.equal(TAG_MAP['h1'].variant, 'display');
});

test('committed catalog.json / catalog.md are not stale', () => {
  const fresh = buildCatalog();
  const committedJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalog.json'), 'utf8'));
  assert.deepEqual(committedJson, fresh);
  const committedMd = fs.readFileSync(path.join(repoRoot, 'catalog.md'), 'utf8');
  assert.equal(committedMd, renderCatalogMarkdown(fresh));
});

test('catalog covers tags, primitive props, tokens and every diagnostic code', () => {
  const catalog = buildCatalog();
  assert.equal(catalog.tags.length, Object.keys(TAG_MAP).length);
  const row = catalog.primitives.find((p) => p.name === 'RgRow');
  assert.ok(row, 'RgRow in catalog');
  for (const prop of ['title', 'subtitle', 'detail', 'time', 'avatar']) {
    assert.ok(row!.props.some((pr) => pr.name === prop), `RgRow prop ${prop}`);
  }
  const button = catalog.primitives.find((p) => p.name === 'RgButton');
  assert.ok(button!.props.some((pr) => pr.name === 'onPress'));
  assert.deepEqual(catalog.tokens.spacingScale, [4, 8, 12, 16, 20, 24, 32]);
  assert.deepEqual(
    catalog.diagnostics.map((d) => d.code).sort(),
    Object.keys(DIAGNOSTIC_CODES).sort(),
  );
});

test('diagnostics carry fix suggestions and human output prints them', () => {
  const result = compileComponent({
    tsSource: `
      import { Component } from '@angular/core';
      @Component({
        selector: 'app-x',
        template: '<p>Hi</p>',
        styles: ['p { text-shadow: 1px 1px #000; }'],
      })
      export class XComponent {
        total() { for (let i = 0; i < 3; i++) { } }
      }
    `,
    fileName: 'x.component.ts',
  });
  const cssDiag = result.diagnostics.find((d) => d.code === 'CSS_UNSUPPORTED');
  assert.ok(cssDiag?.fix && cssDiag.fix.length > 10, 'CSS_UNSUPPORTED has a fix');
  const methodDiag = result.diagnostics.find((d) => d.code === 'METHOD_UNSUPPORTED');
  assert.ok(methodDiag?.fix && methodDiag.fix.includes('supported subset'), 'METHOD_UNSUPPORTED has a fix');
  assert.match(formatDiagnostic(cssDiag!), /\n {2}fix: /);
});

function writeTempComponent(templateHtml: string, tsBody: string): { dir: string; tsFile: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rangular-vibe-'));
  const tsFile = path.join(dir, 'x.component.ts');
  fs.writeFileSync(path.join(dir, 'x.component.html'), templateHtml);
  fs.writeFileSync(tsFile, `
    import { Component } from '@angular/core';
    @Component({ selector: 'app-x', templateUrl: './x.component.html' })
    export class XComponent { ${tsBody} }
  `);
  return { dir, tsFile };
}

test('CLI build --json prints one parseable JSON object with code + fix on error', () => {
  const { dir, tsFile } = writeTempComponent('<screen><h1>{{ title </h1></screen>', "title = 'Hi';");
  const run = spawnSync('node', [cliPath, 'build', tsFile, '--out', path.join(dir, 'x.tsx'), '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, false);
  const diag = payload.diagnostics.find((d: { code: string }) => d.code === 'TPL_INTERPOLATION');
  assert.ok(diag, 'TPL_INTERPOLATION present');
  assert.equal(typeof diag.fix, 'string');
  assert.ok(diag.fix.includes('}}'));
  assert.equal(diag.line, 1);
});

test('CLI build --json succeeds for a good component', () => {
  const { dir, tsFile } = writeTempComponent('<screen><p>{{ title }}</p></screen>', "title = 'Hi';");
  const out = path.join(dir, 'x.tsx');
  const run = spawnSync('node', [cliPath, 'build', tsFile, '--out', out, '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.outFile, out);
  assert.deepEqual(payload.diagnostics, []);
  assert.ok(fs.existsSync(out));
});
