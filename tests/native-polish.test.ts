import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Phone round (2026-11-18): three faults the tutorial app found
 * on a real phone that no web gate could see. The app bar's two
 * actions travel into the bar as one array and drew React's
 * unique key warning; the scroll fade veil was six hard strips
 * and banded visibly over saturated content; the bottom bar sat
 * above a pale safe area strip with its own downward shadow on
 * it, which read as a seam. These guards pin the fixed shapes
 * in the primitives source.
 */

const ROOT = path.join(__dirname, '..', '..');
const primitivesSrc = fs.readFileSync(
  path.join(ROOT, 'packages', 'ui', 'src', 'primitives.tsx'), 'utf8');

test('app bar actions carry keys for the right zone array', () => {
  assert.ok(primitivesSrc.includes('key="action"'), 'first action is keyed');
  assert.ok(primitivesSrc.includes('key="action2"'), 'second action is keyed');
});

test('the scroll fade veil is one SVG gradient, never strips', () => {
  assert.ok(!primitivesSrc.includes('VEIL_STEPS'), 'no strip table remains');
  assert.ok(primitivesSrc.includes('rgveil'), 'the veil gradient has its own id');
  assert.ok(primitivesSrc.includes('stopOpacity={0.96}'), 'the veil fades from near solid');
});

test('the bottom bar shadows upward and the screen paints under it', () => {
  assert.ok(
    primitivesSrc.includes('shadowOffset: { width: 0, height: -2 }'),
    'the bottom bar shadow points up');
  assert.ok(
    primitivesSrc.includes('styles.bottomNav.backgroundColor'),
    'the screen paints the safe area strip in the bar colour');
});
