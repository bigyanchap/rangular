import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { compileComponent, hasErrors } from '../packages/compiler/src/compile';
import { renderPreview } from '../packages/compiler/src/preview/renderPreview';

const ROOT = path.join(__dirname, '..', '..');

test('hello example compiles with zero error diagnostics', () => {
  const dir = path.join(ROOT, 'examples', 'hello');
  const tsSource = fs.readFileSync(path.join(dir, 'hello.component.ts'), 'utf8');
  const result = compileComponent({
    tsSource,
    fileName: 'hello.component.ts',
    resolveFile: (rel) => fs.readFileSync(path.join(dir, rel), 'utf8'),
  });
  assert.equal(hasErrors(result.diagnostics), false, JSON.stringify(result.diagnostics));
  assert.equal(result.component?.selector, 'app-hello');
  assert.ok(result.ast);
  assert.match(result.code, /export default function Hello\(\)/);
  assert.match(result.code, /RgScreen/);
  assert.match(result.code, /RgAppbar/);
  assert.match(result.code, /RgCard/);
  assert.match(result.code, /RgButton/);
});

test('hello preview renders the interpolated title and the card', () => {
  const dir = path.join(ROOT, 'examples', 'hello');
  const tsSource = fs.readFileSync(path.join(dir, 'hello.component.ts'), 'utf8');
  const result = compileComponent({
    tsSource,
    resolveFile: (rel) => fs.readFileSync(path.join(dir, rel), 'utf8'),
  });
  const html = renderPreview(result.component!, result.ast!);
  assert.match(html, /Welcome to Rangular/);
  assert.match(html, /Simple blocks, polished by default/);
  assert.match(html, /class="card"/);
  assert.match(html, /Get started/);
});

test('unresolvable templateUrl is an error diagnostic, not a throw', () => {
  const result = compileComponent({
    tsSource: `@Component({ selector: 'app-x', templateUrl: './missing.html' }) export class XComponent {}`,
    resolveFile: () => undefined,
  });
  assert.equal(hasErrors(result.diagnostics), true);
  assert.ok(result.diagnostics.some((d) => d.code === 'CMP_TEMPLATE'));
});
