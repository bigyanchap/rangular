import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileComponent, hasErrors } from '../packages/compiler/src/compile';
import { parseTemplate } from '../packages/compiler/src/template/parser';

/**
 * Gap fix tests: class, style and attribute bindings, and multiple
 * structural directives on one element. Before this round every one
 * of these forms compiled with zero diagnostics into output that
 * silently did nothing (inert props the primitives ignore, a style
 * attribute that could duplicate the generated style prop, a second
 * structural directive overwriting the first in the parser). The rule
 * now: a form either works ([class.name] over a declared class) or
 * warns with a coded diagnostic and is dropped.
 */

function compileSnippet(template: string, classBody = '', styles = '') {
  const stylesProp = styles ? `, styles: [${JSON.stringify(styles)}]` : '';
  const tsSource = `
    @Component({ selector: 'app-t', template: ${JSON.stringify(template)}${stylesProp} })
    export class TComponent { ${classBody} }
  `;
  return compileComponent({ tsSource });
}

const HOT_CSS = '.hot { color: #b3261e; }';

// --- [class.name]: the wired form -------------------------------------------

test('[class.name] over a declared class wires a conditional style entry', () => {
  const { code, diagnostics } = compileSnippet(
    '<p [class.hot]="hot">x</p>', 'hot = true;', HOT_CSS,
  );
  assert.equal(hasErrors(diagnostics), false, JSON.stringify(diagnostics));
  assert.ok(!diagnostics.some((d) => d.code === 'GEN_CLASS_BINDING'), JSON.stringify(diagnostics));
  assert.match(code, /style=\{hot \? styles\.hot : undefined\}/);
  assert.ok(!code.includes('class.hot'), code);
});

test('[class.name] joins the static classes in the style array, static first', () => {
  const { code, diagnostics } = compileSnippet(
    '<p class="big" [class.hot]="hot">x</p>', 'hot = true;',
    '.big { font-size: 20px; } .hot { color: #b3261e; }',
  );
  assert.ok(!diagnostics.some((d) => d.code === 'GEN_CLASS_BINDING'), JSON.stringify(diagnostics));
  assert.match(code, /style=\{\[styles\.big, hot \? styles\.hot : undefined\]\}/);
});

test('[class.name] wires on dedicated renderers too (input, slider)', () => {
  const input = compileSnippet('<input [class.hot]="hot">', 'hot = true;', HOT_CSS);
  assert.match(input.code, /<RgInput[^>]*style=\{hot \? styles\.hot : undefined\}/);
  assert.ok(!input.code.includes('class.hot'), input.code);
  const slider = compileSnippet(
    '<slider [class.hot]="hot" min="0" max="10"></slider>', 'hot = true;', HOT_CSS,
  );
  assert.match(slider.code, /<RgSlider[^>]*style=\{hot \? styles\.hot : undefined\}/);
  assert.ok(!slider.diagnostics.some((d) => d.code === 'GEN_CLASS_BINDING'), JSON.stringify(slider.diagnostics));
});

// --- [class.name]: the diagnosed forms --------------------------------------

test('[class.name] naming an undeclared class warns GEN_CLASS_BINDING and drops', () => {
  const { code, diagnostics } = compileSnippet(
    '<p [class.hot]="hot">x</p>', 'hot = true;',
  );
  const d = diagnostics.find((x) => x.code === 'GEN_CLASS_BINDING');
  assert.ok(d, JSON.stringify(diagnostics));
  assert.equal(d.severity, 'warning');
  assert.equal(hasErrors(diagnostics), false);
  assert.ok(d.fix && d.fix.includes('.hot'), d.fix);
  assert.ok(!code.includes('class.hot'), code);
  assert.ok(!code.includes('styles.hot'), code);
  assert.match(code, /<RgText variant="bodyLarge">x<\/RgText>/);
});

test('[class.name] on a styleless block (icon) warns GEN_CLASS_BINDING', () => {
  const { code, diagnostics } = compileSnippet(
    '<icon name="search" [class.hot]="hot"></icon>', 'hot = true;', HOT_CSS,
  );
  assert.ok(diagnostics.some((d) => d.code === 'GEN_CLASS_BINDING'), JSON.stringify(diagnostics));
  assert.ok(!code.includes('class.hot'), code);
});

test('[class] and [ngClass] warn GEN_CLASS_BINDING and are never emitted', () => {
  for (const tpl of ['<p [class]="cls">x</p>', '<p [ngClass]="cls">x</p>']) {
    const { code, diagnostics } = compileSnippet(tpl, "cls = 'hot';", HOT_CSS);
    const d = diagnostics.find((x) => x.code === 'GEN_CLASS_BINDING');
    assert.ok(d, tpl);
    assert.ok(d.fix && d.fix.includes('[class.name]'), d.fix);
    assert.ok(!code.includes('ngClass'), code);
    assert.ok(!/class=\{/.test(code), code);
  }
});

// --- Style bindings and the static style attribute --------------------------

test('[style.prop], [style], [ngStyle] and unit forms warn GEN_STYLE_BINDING', () => {
  const templates = [
    '<p [style.color]="colour">x</p>',
    '<p [style.width.px]="w">x</p>',
    '<p [style]="sty">x</p>',
    '<p [ngStyle]="sty">x</p>',
  ];
  for (const tpl of templates) {
    const { code, diagnostics } = compileSnippet(tpl, "colour = 'red'; w = 3; sty = {};", HOT_CSS);
    assert.ok(diagnostics.some((d) => d.code === 'GEN_STYLE_BINDING'), tpl);
    assert.ok(!code.includes('style.color'), tpl);
    assert.ok(!code.includes('ngStyle'), tpl);
    assert.ok(!code.includes('style={{'), tpl);
  }
});

test('a static style attribute warns GEN_STYLE_BINDING and cannot duplicate the style prop', () => {
  const { code, diagnostics } = compileSnippet(
    '<p class="big" style="color: red">x</p>', '', '.big { font-size: 20px; }',
  );
  assert.ok(diagnostics.some((d) => d.code === 'GEN_STYLE_BINDING'), JSON.stringify(diagnostics));
  assert.ok(!code.includes('style="color: red"'), code);
  assert.match(code, /style=\{styles\.big\}/);
  assert.equal(code.match(/<RgText[^>]*style=/g)?.length, 1, code);
});

test('[style.prop] on a dedicated renderer (slider) warns and is stripped', () => {
  const { code, diagnostics } = compileSnippet(
    '<slider [style.color]="colour" min="0" max="10"></slider>', "colour = 'red';",
  );
  assert.ok(diagnostics.some((d) => d.code === 'GEN_STYLE_BINDING'), JSON.stringify(diagnostics));
  assert.ok(!code.includes('style.color'), code);
});

// --- [attr.x] ----------------------------------------------------------------

test('[attr.x] warns GEN_ATTR_BINDING and is never emitted', () => {
  const { code, diagnostics } = compileSnippet(
    '<p [attr.class]="cls">x</p>', "cls = 'hot';", HOT_CSS,
  );
  const d = diagnostics.find((x) => x.code === 'GEN_ATTR_BINDING');
  assert.ok(d, JSON.stringify(diagnostics));
  assert.equal(d.severity, 'warning');
  assert.ok(!code.includes('attr.class'), code);
});

// --- Two structural directives on one element --------------------------------

test('parser keeps the first structural directive and records the dropped one', () => {
  const { root, diagnostics } = parseTemplate('<div *ngIf="a" *ngFor="let m of ms"></div>');
  const el = root.children[0];
  assert.equal(el.type, 'element');
  if (el.type !== 'element') return;
  assert.equal(el.structural?.name, 'ngIf');
  assert.equal(el.droppedStructural?.length, 1);
  assert.equal(el.droppedStructural?.[0].name, 'ngFor');
  const d = diagnostics.find((x) => x.code === 'TPL_STRUCTURAL_MULTIPLE');
  assert.ok(d, JSON.stringify(diagnostics));
  assert.ok(d.message.includes('*ngIf') && d.message.includes('*ngFor'), d.message);
  assert.ok(d.fix && d.fix.includes('nest'), d.fix);
});

test('*ngFor first: the loop is kept, the *ngIf drops with a warning and a TODO', () => {
  const { code, diagnostics } = compileSnippet(
    '<div *ngFor="let m of mails" *ngIf="ready"><p>{{ m }}</p></div>',
    'mails = []; ready = true;',
  );
  assert.ok(diagnostics.some((d) => d.code === 'TPL_STRUCTURAL_MULTIPLE'), JSON.stringify(diagnostics));
  assert.match(code, /\{mails\.map\(\(m, index\) => \(/);
  assert.match(code, /TODO: \*ngIf="ready" dropped, one structural directive per element, see TPL_STRUCTURAL_MULTIPLE/);
  assert.ok(!code.includes('{ready && ('), code);
});

test('*ngIf first: the condition is kept, the *ngFor drops with a warning and a TODO', () => {
  const { code, diagnostics } = compileSnippet(
    '<div *ngIf="ready" *ngFor="let m of mails"><p>x</p></div>',
    'mails = []; ready = true;',
  );
  assert.ok(diagnostics.some((d) => d.code === 'TPL_STRUCTURAL_MULTIPLE'), JSON.stringify(diagnostics));
  assert.match(code, /\{ready && \(/);
  assert.match(code, /TODO: \*ngFor="let m of mails" dropped, one structural directive per element, see TPL_STRUCTURAL_MULTIPLE/);
  assert.ok(!code.includes('.map('), code);
});

// --- No false positives -------------------------------------------------------

test('a plain static class still compiles clean, with no new diagnostics', () => {
  const { code, diagnostics } = compileSnippet('<p class="hot">x</p>', '', HOT_CSS);
  assert.deepEqual(diagnostics, [], JSON.stringify(diagnostics));
  assert.match(code, /style=\{styles\.hot\}/);
});
