import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExpression, exprToString } from '../packages/compiler/src/template/expr';

test('multiplication binds tighter than addition', () => {
  assert.equal(exprToString(parseExpression('a + b * c')), '(a + (b * c))');
});

test('parentheses override precedence', () => {
  assert.equal(exprToString(parseExpression('(a + b) * c')), '((a + b) * c)');
});

test('member access and calls', () => {
  const e = parseExpression('user.save($event)');
  assert.equal(e.type, 'call');
  assert.equal(exprToString(e), 'user.save($event)');
  assert.equal(exprToString(parseExpression('a.b.c')), 'a.b.c');
});

test('ternary parses', () => {
  const e = parseExpression('ready ? yes : no');
  assert.equal(e.type, 'conditional');
  assert.equal(exprToString(e), '(ready ? yes : no)');
});

test('pipe parses with and without args', () => {
  const e = parseExpression('items | async');
  assert.equal(e.type, 'pipe');
  assert.equal(exprToString(parseExpression("name | uppercase:'x'")), "(name | uppercase:'x')");
});

test('unary and comparison operators', () => {
  assert.equal(exprToString(parseExpression('!ready && count >= 2')), '(!ready && (count >= 2))');
});

test('literals', () => {
  assert.equal(exprToString(parseExpression("'hi'")), "'hi'");
  assert.equal(exprToString(parseExpression('42')), '42');
  assert.equal(exprToString(parseExpression('true')), 'true');
});
