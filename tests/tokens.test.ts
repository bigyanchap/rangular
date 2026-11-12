import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spacingScale, radiusScale, colours, theme } from '../packages/ui/src/tokens';

test('spacing and radius scales are sorted and unique', () => {
  for (const scale of [spacingScale, radiusScale]) {
    const finite = scale.filter((n) => n < 9000);
    assert.deepEqual([...finite].sort((a, b) => a - b), finite);
    assert.equal(new Set(scale).size, scale.length);
  }
  assert.deepEqual(spacingScale, [4, 8, 12, 16, 20, 24, 32]);
});

test('light and dark define exactly the same colour roles', () => {
  assert.deepEqual(Object.keys(colours.light).sort(), Object.keys(colours.dark).sort());
  for (const role of Object.keys(colours.light) as (keyof typeof colours.light)[]) {
    assert.match(colours.light[role], /^#/);
    assert.match(colours.dark[role], /^#/);
  }
});

test('theme() returns tokens for the requested mode', () => {
  assert.equal(theme('dark').colors.background, colours.dark.background);
  assert.equal(theme('light').spacing.lg, 16);
  assert.equal(theme('light').typography.display.fontSize, 32);
});
