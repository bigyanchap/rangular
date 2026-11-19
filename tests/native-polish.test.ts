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

test('the search pill is one tap target that focuses its field', () => {
  assert.ok(primitivesSrc.includes('pillRef'), 'the pill keeps a field ref');
  assert.ok(
    primitivesSrc.includes('pillRef.current?.focus()'),
    'a tap anywhere on the pill focuses the field');
});

test('the wash tokens exist in both themes and the tint bar wears the wash', () => {
  const tokensSrc = fs.readFileSync(
    path.join(ROOT, 'packages', 'ui', 'src', 'tokens.ts'), 'utf8');
  assert.ok((tokensSrc.match(/washFrom/g) ?? []).length >= 3, 'washFrom in the roles and both themes');
  assert.ok((tokensSrc.match(/primaryDeep/g) ?? []).length >= 3, 'primaryDeep in the roles and both themes');
  assert.ok(primitivesSrc.includes('rgwash'), 'the SoftFill gradient is defined');
  assert.ok(primitivesSrc.includes('slot.register(pinKey, bar, chrome, tint)'), 'the tint bar asks its screen for the wash');
  assert.ok(primitivesSrc.includes('headerWash'), 'the screen draws the wash as one layer');
  assert.ok(primitivesSrc.includes('c.washFrom : plain'), 'the tint bar lends the wash top as its chrome');
});

test('the search pill carries its own clear tap', () => {
  assert.ok(primitivesSrc.includes('accessibilityLabel="Clear search"'), 'the clear tap is labelled');
  assert.ok(primitivesSrc.includes("onChangeText?.('')"), 'tapping it empties the field through the value contract');
});

test('a card with a click is a pressable, a card without one is a surface', () => {
  assert.ok(primitivesSrc.includes('A card with a (click) is a Pressable'), 'the card honours onPress');
});

test('the entry screen persists across routes and resets scroll by key', () => {
  assert.ok(primitivesSrc.includes('scrollKey'), 'the screen takes a scroll key');
  assert.ok(
    primitivesSrc.includes('scrollTo({ y: 0, animated: false })'),
    'a key change scrolls the screen to the top without animation');
  assert.ok(primitivesSrc.includes('ref={scrollRef}'), 'the scroll view carries the ref');
});

test('content melts into a pinned bottom bar instead of being sliced by it', () => {
  assert.ok(primitivesSrc.includes('rgmelt'), 'the bottom melt gradient is defined');
  assert.ok(
    primitivesSrc.includes('(navs.length > 0 || bottomNode) ? (\n            <View pointerEvents="none" style={{ position: \'absolute\', bottom: 0, left: 0, right: 0, height: 24 }}'),
    'the melt rides the bottom of the scroll box when a bar is pinned');
});

test('the picker wheel ticks the selection haptic while rolling', () => {
  assert.ok(primitivesSrc.includes('tickWhileRolling'), 'the wheel tracks the row passing the centre');
  assert.ok(primitivesSrc.includes('tickedIndexRef'), 'the wheel remembers the last ticked row, so one roll ticks once per row');
  assert.ok(primitivesSrc.includes('onScroll={(e: any) => tickWhileRolling(e.nativeEvent.contentOffset.y)}'), 'the wheel scroll feeds the tick tracker');
});

test('the bottom nav answers a tab change with a haptic when asked', () => {
  assert.ok(primitivesSrc.includes('function fireSelectionHaptic()'), 'one shared selection haptic');
  assert.ok(
    primitivesSrc.includes('if (haptic && i !== active) fireSelectionHaptic();'),
    'the nav fires it on a real tab change only');
});

test('the filled button wears the primary gradient', () => {
  assert.ok(primitivesSrc.includes('function ButtonFill('), 'the button fill is defined');
  assert.ok(primitivesSrc.includes('const stopBottom = bottom ?? c.primaryDeep;'), 'the fill lands on primaryDeep by default');
  assert.ok(primitivesSrc.includes('stopColor={stopBottom}'), 'the lower stop is the resolved colour');
});

test('a list drops the hairline under its last row', () => {
  assert.ok(primitivesSrc.includes('lastInList'), 'rows know the last-in-list mark');
  assert.ok(primitivesSrc.includes('React.cloneElement'), 'the list marks its last row');
});

test('the bottom bar carries no shadow and the screen paints under it', () => {
  const navBlock = primitivesSrc.slice(
    primitivesSrc.indexOf('bottomNav: {'),
    primitivesSrc.indexOf('navItem: {'));
  assert.ok(!navBlock.includes('shadowOffset') && !navBlock.includes('shadowOpacity') && !navBlock.includes('shadowRadius'), 'the bottom bar style is shadow free');
  assert.ok(!navBlock.includes('elevation.level'), 'the bottom bar style is elevation free');
  assert.ok(
    primitivesSrc.includes('styles.bottomNav.backgroundColor'),
    'the screen paints the safe area strip in the bar colour');
});
