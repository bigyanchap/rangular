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
  assert.match(primitives, /menu \? \(onMenu \? \(/);
  assert.match(primitives, /avatar \? \(/);
});

test('appbar titleAlign="center" centers the title in three zones, default unchanged', () => {
  const centered = compileInline('<screen><appbar title="Rangular Tutorial" titleAlign="center" menu (menu)="go()"></appbar></screen>');
  assert.equal(hasErrors(centered.diagnostics), false, JSON.stringify(centered.diagnostics));
  assert.match(centered.code, /titleAlign="center"/);
  assert.match(centered.code, /onMenu=/);

  const plain = compileInline('<screen><appbar title="Plain"></appbar></screen>');
  assert.ok(!plain.code.includes('titleAlign'), 'no titleAlign, no centered layout');
  const plainHtml = renderPreview(plain.component!, plain.ast!);
  const plainBar = plainHtml.match(/<header class="appbar">.*?<\/header>/);
  assert.ok(plainBar && !plainBar[0].includes('appbar-side'), 'the default bar has no side zones');

  const html = renderPreview(centered.component!, centered.ast!);
  const bar = html.match(/<header class="appbar">.*?<\/header>/);
  assert.ok(bar, 'the centered appbar paints');
  assert.equal((bar![0].match(/appbar-side/g) ?? []).length, 2, 'two balancing side zones');
  assert.ok(bar![0].includes('<span class="appbar-title center">Rangular Tutorial</span>'), 'the title carries the center class');
  assert.ok(bar![0].indexOf('appbar-side') < bar![0].indexOf('appbar-title'), 'the left zone comes before the title');
  assert.match(html, /\.appbar-side \{ width: 28px;/);
  assert.match(html, /\.appbar-title\.center[^{]*\{ text-align: center; \}/);

  const primitives = fs.readFileSync(path.join(ROOT, 'packages', 'ui', 'src', 'primitives.tsx'), 'utf8');
  assert.match(primitives, /titleAlign === 'center'/);
  assert.match(primitives, /appbarSide: \{ width: 28/);
  assert.match(primitives, /appbarTitleCenter: \{ textAlign: 'center' \}/);
});

test('icon-button compiles to RgIconButton and paints a real button in preview', () => {
  const result = compileInline('<screen><icon-button name="chevron-left" (click)="go()"></icon-button></screen>');
  assert.equal(hasErrors(result.diagnostics), false, JSON.stringify(result.diagnostics));
  assert.match(result.code, /RgIconButton/);
  assert.match(result.code, /name="chevron-left"/);
  const html = renderPreview(result.component!, result.ast!);
  assert.match(html, /class="icon-btn"/);
  const primitives = fs.readFileSync(path.join(ROOT, 'packages', 'ui', 'src', 'primitives.tsx'), 'utf8');
  assert.match(primitives, /export function RgIconButton/);
});

test('icon-button with an unknown icon name is a GEN_ICON_UNKNOWN error', () => {
  const result = compileInline('<screen><icon-button name="rocket"></icon-button></screen>');
  assert.ok(result.diagnostics.some((d) => d.code === 'GEN_ICON_UNKNOWN'), JSON.stringify(result.diagnostics));
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
