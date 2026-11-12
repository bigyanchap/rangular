import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseComponent } from '../packages/compiler/src/class/parseComponent';

const SRC = `
import { Component, Input, Output, EventEmitter } from '@angular/core';

@Component({
  selector: 'app-user-card',
  templateUrl: './user-card.component.html',
  styleUrls: ['./user-card.component.css'],
})
export class UserCardComponent {
  @Input() name: string = '';
  @Output() selected = new EventEmitter<void>();
  title = 'Profile';
  private count: number = 0;

  ngOnInit() {}
  refresh() {}
}
`;

test('extracts selector and templateUrl', () => {
  const { component, diagnostics } = parseComponent(SRC);
  assert.equal(diagnostics.filter((d) => d.severity === 'error').length, 0);
  assert.equal(component?.selector, 'app-user-card');
  assert.equal(component?.templateUrl, './user-card.component.html');
  assert.deepEqual(component?.styleUrls, ['./user-card.component.css']);
  assert.equal(component?.className, 'UserCardComponent');
});

test('extracts fields with initializer and type text', () => {
  const { component } = parseComponent(SRC);
  const title = component?.fields.find((f) => f.name === 'title');
  assert.equal(title?.initializer, `'Profile'`);
  const count = component?.fields.find((f) => f.name === 'count');
  assert.equal(count?.type, 'number');
  assert.equal(count?.initializer, '0');
});

test('detects @Input and @Output fields', () => {
  const { component } = parseComponent(SRC);
  assert.equal(component?.fields.find((f) => f.name === 'name')?.isInput, true);
  assert.equal(component?.fields.find((f) => f.name === 'selected')?.isOutput, true);
  assert.equal(component?.fields.find((f) => f.name === 'title')?.isInput, false);
});

test('lists methods', () => {
  const { component } = parseComponent(SRC);
  assert.deepEqual(component?.methods, ['ngOnInit', 'refresh']);
});

test('missing @Component yields an error diagnostic, not a throw', () => {
  const { component, diagnostics } = parseComponent('export class Plain {}');
  assert.equal(component, undefined);
  assert.equal(diagnostics[0]?.code, 'CLS_NO_COMPONENT');
});

test('extracts inline template and styles', () => {
  const { component } = parseComponent(`
    @Component({ selector: 'app-x', template: '<p>hi</p>', styles: ['p { color: red; }'] })
    export class XComponent {}
  `);
  assert.equal(component?.template, '<p>hi</p>');
  assert.match(component?.styles ?? '', /color: red/);
});
