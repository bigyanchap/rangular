import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCss } from '../packages/compiler/src/style/css';

test('converts kebab-case to camelCase and px to numbers', () => {
  const { styles, diagnostics } = parseCss('h1 { font-size: 32px; margin-bottom: 8px; }');
  assert.equal(diagnostics.length, 0);
  assert.deepEqual(styles['h1'], { fontSize: 32, marginBottom: 8 });
});

test('handles element and class selectors', () => {
  const { styles } = parseCss('p { color: #111; } .note { color: #5f6368; font-size: 14px; }');
  assert.deepEqual(styles['p'], { color: '#111' });
  assert.deepEqual(styles['note'], { color: '#5f6368', fontSize: 14 });
});

test('unsupported properties warn and are dropped, not fatal', () => {
  const { styles, diagnostics } = parseCss('.x { cursor: pointer; color: red; }');
  assert.deepEqual(styles['x'], { color: 'red' });
  assert.ok(diagnostics.some((d) => d.code === 'CSS_UNSUPPORTED' && d.severity === 'warning'));
});

test('unitless numbers become numbers, other values stay strings', () => {
  const { styles } = parseCss('.x { opacity: 0.5; font-weight: 600; text-align: center; }');
  assert.deepEqual(styles['x'], { opacity: 0.5, fontWeight: 600, textAlign: 'center' });
});
