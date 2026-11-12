import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { compileComponent, hasErrors } from '../packages/compiler/src/compile';
import { renderPreview } from '../packages/compiler/src/preview/renderPreview';

const ROOT = path.join(__dirname, '..', '..');

function compileInline(template: string) {
  const tsSource = [
    `import { Component } from '@angular/core';`,
    `@Component({ selector: 'app-t', template: \`${template.replace(/`/g, '')}\` })`,
    `export class TComponent {}`,
  ].join('\n');
  return compileComponent({ tsSource, resolveFile: () => undefined });
}

test('section, div and header compile to RgSection, the stack primitive', () => {
  const result = compileInline('<screen><section><p>One</p><p>Two</p></section></screen>');
  assert.equal(hasErrors(result.diagnostics), false, JSON.stringify(result.diagnostics));
  assert.match(result.code, /RgSection/);
  assert.ok(!/<View>/.test(result.code), 'a bare View container carries no rhythm gap');
  const primitives = fs.readFileSync(path.join(ROOT, 'packages', 'ui', 'src', 'primitives.tsx'), 'utf8');
  assert.match(primitives, /section: \{ flexDirection: 'column', gap: t\.spacing\.md \}/);
  assert.match(primitives, /export function RgSection/);
});

test('preview stacks sections with the stack class, matching the app gap', () => {
  const result = compileInline('<screen><section><p>One</p></section></screen>');
  const html = renderPreview(result.component!, result.ast!);
  assert.match(html, /<section class="stack">/);
  assert.match(html, /\.stack \{ display: flex; flex-direction: column; gap: 12px; \}/);
});

test('appbar draws no menu and no avatar unless the app asks for them', () => {
  const plain = compileInline('<screen><appbar title="Plain"></appbar></screen>');
  const plainHtml = renderPreview(plain.component!, plain.ast!);
  const bar = plainHtml.match(/<header class="appbar">.*?<\/header>/);
  assert.ok(bar, 'appbar paints');
  assert.ok(!bar![0].includes('class="avatar"'), 'no avatar without the avatar attribute');
  assert.ok(!bar![0].includes('<svg'), 'no menu icon without the menu attribute');

  const opted = compileInline('<screen><appbar title="Mail" menu avatar="M"></appbar></screen>');
  const optedHtml = renderPreview(opted.component!, opted.ast!);
  const optedBar = optedHtml.match(/<header class="appbar">.*?<\/header>/);
  assert.ok(optedBar![0].includes('class="avatar"'), 'avatar appears when asked');
  assert.ok(optedBar![0].includes('>M</span>'), 'avatar shows the passed text, not the title letter');
  assert.ok(optedBar![0].includes('<svg'), 'menu icon appears when asked');

  const primitives = fs.readFileSync(path.join(ROOT, 'packages', 'ui', 'src', 'primitives.tsx'), 'utf8');
  assert.match(primitives, /menu \? <RgIcon name="menu"/);
  assert.match(primitives, /avatar \? \(/);
});

test('button variant text renders the quiet form in preview and primitives', () => {
  const result = compileInline('<screen><button variant="text">Back</button><button>Go</button></screen>');
  assert.equal(hasErrors(result.diagnostics), false, JSON.stringify(result.diagnostics));
  assert.match(result.code, /variant="text"/);
  const html = renderPreview(result.component!, result.ast!);
  assert.match(html, /class="btn btn-text"/);
  const primitives = fs.readFileSync(path.join(ROOT, 'packages', 'ui', 'src', 'primitives.tsx'), 'utf8');
  assert.match(primitives, /variant === 'text'/);
  assert.match(primitives, /buttonTextLabel/);
});
