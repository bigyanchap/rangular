import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTemplate, printAst } from '../packages/compiler/src/index';
import { ElementNode } from '../packages/compiler/src/template/ast';

function firstElement(html: string): ElementNode {
  const { root } = parseTemplate(html);
  return root.children[0] as ElementNode;
}

test('parses nested elements', () => {
  const { root, diagnostics } = parseTemplate('<div><p>Hello</p><span>World</span></div>');
  assert.equal(diagnostics.filter((d) => d.severity === 'error').length, 0);
  const div = root.children[0] as ElementNode;
  assert.equal(div.tag, 'div');
  assert.equal(div.children.length, 2);
  assert.equal((div.children[0] as ElementNode).tag, 'p');
});

test('splits interpolation in text', () => {
  const p = firstElement('<p>Hello {{ name }}, you have {{ count }} mails</p>');
  const text = p.children[0];
  assert.equal(text.type, 'text');
  if (text.type === 'text') {
    assert.deepEqual(
      text.parts.map((x) => x.type),
      ['static', 'expr', 'static', 'expr', 'static'],
    );
    assert.equal(text.parts[1].type === 'expr' && text.parts[1].expression, 'name');
  }
});

test('stores [prop] bindings', () => {
  const btn = firstElement('<button [disabled]="isOff">Go</button>');
  assert.deepEqual(btn.propBindings, [{ name: 'disabled', expression: 'isOff' }]);
});

test('stores (event) bindings', () => {
  const btn = firstElement('<button (click)="save($event)">Go</button>');
  assert.deepEqual(btn.eventBindings, [{ name: 'click', expression: 'save($event)' }]);
});

test('stores *ngIf and *ngFor as structural directives', () => {
  const div = firstElement('<div *ngIf="ready">x</div>');
  assert.deepEqual(div.structural, { name: 'ngIf', expression: 'ready' });
  const li = firstElement('<li *ngFor="let item of items">x</li>');
  assert.equal(li.structural?.name, 'ngFor');
  assert.match(li.structural?.expression ?? '', /let item of items/);
});

test('handles self-closing tags and comments', () => {
  const { root, diagnostics } = parseTemplate('<div><!-- note --><br/><img src="a.png"/></div>');
  assert.equal(diagnostics.filter((d) => d.severity === 'error').length, 0);
  const div = root.children[0] as ElementNode;
  assert.deepEqual(div.children.map((c) => (c as ElementNode).tag), ['br', 'img']);
});

test('mismatched closing tag produces a diagnostic with line/column', () => {
  const { diagnostics } = parseTemplate('<div>\n  <p>hi</div>');
  const mismatch = diagnostics.find((d) => d.code === 'TPL_MISMATCH');
  assert.ok(mismatch, 'expected a TPL_MISMATCH diagnostic');
  assert.equal(mismatch?.line, 2);
  assert.ok((mismatch?.column ?? 0) >= 1);
});

test('printAst renders an indented tree (M0)', () => {
  const { root } = parseTemplate('<screen><h1>{{ title }}</h1></screen>');
  const out = printAst(root);
  assert.match(out, /<screen>/);
  assert.match(out, /\n {2}<h1>/);
  assert.match(out, /text "\{\{ title \}\}"/);
});
