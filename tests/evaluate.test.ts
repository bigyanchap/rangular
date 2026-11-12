import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExpression } from '../packages/compiler/src/template/evaluate';

test('evaluator honours operator precedence', () => {
  assert.equal(evaluateExpression('a + b * c', { a: 1, b: 2, c: 3 }), 7);
  assert.equal(evaluateExpression('(a + b) * c', { a: 1, b: 2, c: 3 }), 9);
});

test('evaluator: member and index access', () => {
  const scope = { user: { name: 'Bigyan' }, items: [10, 20, 30], mails: [{ id: 1 }, { id: 2 }] };
  assert.equal(evaluateExpression('user.name', scope), 'Bigyan');
  assert.equal(evaluateExpression('items[1]', scope), 20);
  assert.equal(evaluateExpression('mails.length', scope), 2);
  assert.equal(evaluateExpression('missing.deep', scope), undefined);
});

test('evaluator: comparisons and logic', () => {
  assert.equal(evaluateExpression('count >= 5', { count: 5 }), true);
  assert.equal(evaluateExpression('count === 0', { count: 1 }), false);
  assert.equal(evaluateExpression('!ready && count > 1', { ready: false, count: 2 }), true);
});

test('evaluator: ternary', () => {
  assert.equal(evaluateExpression("count > 0 ? 'some' : 'none'", { count: 0 }), 'none');
  assert.equal(evaluateExpression("count > 0 ? 'some' : 'none'", { count: 3 }), 'some');
});

test('evaluator: built-in pipes', () => {
  assert.equal(evaluateExpression('name | uppercase', { name: 'bob' }), 'BOB');
  assert.equal(evaluateExpression('name | lowercase', { name: 'BOB' }), 'bob');
  assert.equal(evaluateExpression('name | titlecase', { name: 'hello world' }), 'Hello World');
  assert.equal(evaluateExpression('value | json', { value: { a: 1 } }), '{"a":1}');
});

test('evaluator: calls resolve functions from scope, with member this-binding', () => {
  const scope = {
    add: (a: number, b: number) => a + b,
    cart: { items: [1, 2, 3], total() { return (this as { items: number[] }).items.length; } },
  };
  assert.equal(evaluateExpression('add(2, 3)', scope), 5);
  assert.equal(evaluateExpression('cart.total()', scope), 3);
});

test('evaluator: unknown pipe throws a clear error', () => {
  assert.throws(() => evaluateExpression('x | nope', { x: 1 }), /Unknown pipe 'nope'/);
});
