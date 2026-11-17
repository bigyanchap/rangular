import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { compileComponent, hasErrors } from '../packages/compiler/src/compile';
import { renderPreview } from '../packages/compiler/src/preview/renderPreview';
import { ICON_PATHS } from '../packages/ui/src/icons';

/**
 * Gradient shell round (2026-11-17): the shell surface the
 * Rangular Tutorial redesign asked for. A pinned gradient app bar
 * with projected children (the search pill), a gradient surface, a
 * labelled section, a row with avatar text and a trailing action,
 * and the bookmark icons. Each construct must compile to a visible
 * effect in the generated code, the primitives and both preview
 * renderers; nothing in this round may drop silently.
 */

const ROOT = path.join(__dirname, '..', '..');
const primitivesSrc = fs.readFileSync(
  path.join(ROOT, 'packages', 'ui', 'src', 'primitives.tsx'), 'utf8');
const tokensSrc = fs.readFileSync(
  path.join(ROOT, 'packages', 'ui', 'src', 'tokens.ts'), 'utf8');

function compileSnippet(template: string, classBody = '') {
  const tsSource = `
    @Component({ selector: 'app-t', template: ${JSON.stringify(template)} })
    export class TComponent { ${classBody} }
  `;
  return compileComponent({ tsSource });
}

function previewOf(template: string, classBody = '') {
  const result = compileSnippet(template, classBody);
  assert.equal(hasErrors(result.diagnostics), false, JSON.stringify(result.diagnostics));
  return renderPreview(result.component!, result.ast!);
}

test('bookmark icons ship filled and outline paths', () => {
  assert.ok(ICON_PATHS['bookmark'], 'filled bookmark');
  assert.ok(ICON_PATHS['bookmark-outline'], 'outline bookmark');
  assert.ok(ICON_PATHS['bookmark'][0].includes('M17 3H7'));
});

test('brand gradient tokens carry the three stops in both themes', () => {
  const froms = tokensSrc.match(/gradientFrom: '#3b0764'/g) ?? [];
  assert.equal(froms.length, 2);
  assert.ok(tokensSrc.includes("gradientVia: '#7c3aed'"));
  assert.ok(tokensSrc.includes("gradientTo: '#db2777'"));
});

test('<gradient> compiles to RgGradient with its children', () => {
  const { code, diagnostics } = compileSnippet('<gradient><h2>Hi</h2></gradient>');
  assert.equal(hasErrors(diagnostics), false, JSON.stringify(diagnostics));
  assert.match(code, /<RgGradient>/);
  assert.match(code, /<\/RgGradient>/);
});

test('RgGradient fills with the shared gradient and lightens text roles', () => {
  assert.match(primitivesSrc, /export function RgGradient/);
  assert.match(primitivesSrc, /function GradientFill/);
  assert.match(primitivesSrc, /text: t\.colors\.onPrimary/);
});

test('preview paints the gradient surface and its CSS', () => {
  const html = previewOf('<gradient><h2>Hi</h2></gradient>');
  assert.match(html, /class="gradient"/);
  assert.ok(html.includes('linear-gradient(115deg, #3b0764, #7c3aed 52%, #db2777)'));
});

test('gradient pinned app bar compiles tone, pin and the projected search input', () => {
  const tpl = '<appbar title="Lessons" tone="gradient" pin menu (menu)="open()" titleAlign="center">'
    + '<input variant="search" placeholder="Search" [(ngModel)]="q"></appbar>';
  const { code, diagnostics } = compileSnippet(tpl, "q = ''; open() {}");
  assert.equal(hasErrors(diagnostics), false, JSON.stringify(diagnostics));
  assert.match(code, /tone="gradient"/);
  assert.match(code, /\bpin\b/);
  assert.match(code, /<RgInput/);
  assert.match(code, /variant="search"/);
});

test('RgAppbar registers a pinned bar into the screen header slot', () => {
  assert.match(primitivesSrc, /RgHeaderSlotContext/);
  assert.match(primitivesSrc, /slot\.register\(pinKey, bar\)/);
  assert.match(primitivesSrc, /headerNode/);
});

test('preview paints the gradient pin bar with children under the row', () => {
  const tpl = '<appbar title="Lessons" tone="gradient" pin menu (menu)="open()">'
    + '<input variant="search" placeholder="Search" [(ngModel)]="q"></appbar>';
  const html = previewOf(tpl, "q = ''; open() {}");
  assert.match(html, /appbar gradient pin has-children/);
  assert.match(html, /appbar-children/);
  assert.match(html, /input-search/);
});

test('app bar back and action compile to known event props', () => {
  const tpl = '<appbar title="Lesson 4" back (back)="go()" '
    + '[actionIcon]="saved ? \'bookmark\' : \'bookmark-outline\'" (action)="toggle()"></appbar>';
  const { code, diagnostics } = compileSnippet(tpl, 'saved = false; go() {} toggle() {}');
  assert.equal(hasErrors(diagnostics), false, JSON.stringify(diagnostics));
  assert.match(code, /onBack=/);
  assert.match(code, /onAction=/);
  assert.ok(!code.includes('has no standard RN prop'), code);
});

test('preview paints the app bar back chevron and action icon', () => {
  const html = previewOf('<appbar title="Lesson 4" back actionIcon="bookmark-outline"></appbar>');
  assert.match(html, /appbar-action/);
  assert.ok(html.includes('M17 3H7'), 'bookmark path paints');
});

test('search pill input paints in the preview with the search icon', () => {
  const html = previewOf(
    '<input variant="search" placeholder="Search lessons" [(ngModel)]="q">', "q = '';");
  assert.match(html, /input-search/);
  assert.match(primitivesSrc, /variant === 'search'/);
  assert.match(primitivesSrc, /styles\.inputPill/);
});

test('row compiles avatarText and the action event', () => {
  const tpl = '<row avatar avatarText="41" title="Forms" '
    + '[actionIcon]="saved ? \'bookmark\' : \'bookmark-outline\'" (action)="toggle()" (click)="open()"></row>';
  const { code, diagnostics } = compileSnippet(tpl, 'saved = false; toggle() {} open() {}');
  assert.equal(hasErrors(diagnostics), false, JSON.stringify(diagnostics));
  assert.match(code, /avatarText="41"/);
  assert.match(code, /onAction=/);
  assert.ok(!code.includes('has no standard RN prop'), code);
});

test('preview paints the row number tile and bookmark button', () => {
  const tpl = '<row avatar avatarText="41" title="Forms" actionIcon="bookmark-outline" (action)="toggle()"></row>';
  const html = previewOf(tpl, 'toggle() {}');
  assert.match(html, />41<\/span>/);
  assert.match(html, /row-action/);
  assert.ok(html.includes('M17 3H7'), 'bookmark path paints');
  assert.match(primitivesSrc, /styles\.rowAction/);
  assert.match(primitivesSrc, /avatarLabel/);
});

test('labelled section compiles label and meta onto RgSection', () => {
  const { code, diagnostics } = compileSnippet(
    '<section label="Your bookmarks" meta="2 saved"><p>Body</p></section>');
  assert.equal(hasErrors(diagnostics), false, JSON.stringify(diagnostics));
  assert.match(code, /<RgSection/);
  assert.match(code, /label="Your bookmarks"/);
  assert.match(code, /meta="2 saved"/);
});

test('preview paints the labelled section gradient bar header', () => {
  const html = previewOf('<section label="Your bookmarks" meta="2 saved"><p>Body</p></section>');
  assert.match(html, /section-head/);
  assert.match(html, /section-bar/);
  assert.ok(html.includes('Your bookmarks'));
  assert.ok(html.includes('2 saved'));
});

test('an unlabelled section paints no header', () => {
  const html = previewOf('<section><p>Body</p></section>');
  assert.ok(!html.includes('<div class="section-head">'));
});
