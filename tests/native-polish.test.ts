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

test('the menu backdrop fades to the shared scrim opacity, never solid black', () => {
  const menuFn = primitivesSrc.slice(
    primitivesSrc.indexOf('export function RgMenu('),
    primitivesSrc.indexOf('export function RgMenuItem'));
  assert.ok(
    menuFn.includes('outputRange: [0, 0.32]'),
    'the menu backdrop interpolates to the shared 0.32 dim');
  assert.ok(
    menuFn.includes('Animated.View style={[styles.overlayBackdrop, { opacity: backdropOpacity }]}'),
    'the menu backdrop is the animated dimmed backdrop');
  assert.ok(
    !menuFn.includes('<View style={styles.overlayBackdrop}>'),
    'no plain opaque backdrop remains in RgMenu');
});

test('the menu hangs beside the press that opened it', () => {
  assert.ok(primitivesSrc.includes('lastPressPoint'), 'presses leave a point for the menu');
  assert.ok(
    primitivesSrc.includes('notePressPoint(e); onPress(e)'),
    'sections and cards note the point as they fire');
  assert.ok(
    primitivesSrc.includes('notePressPoint(e); onPress?.(e)'),
    'buttons note the point as they fire');
  const menuFn = primitivesSrc.slice(
    primitivesSrc.indexOf('export function RgMenu('),
    primitivesSrc.indexOf('export function RgMenuItem'));
  assert.ok(menuFn.includes('measureInWindow'), 'the menu measures its root to place the panel');
  assert.ok(
    menuFn.includes("position: 'absolute', right: place.right, top: placedTop"),
    'the panel is placed at the noted press point');
  assert.ok(
    menuFn.includes('opacity: reveal ? progress : 0'),
    'the panel stays transparent until its position is final, so it never flashes in the wrong place');
  assert.ok(
    menuFn.includes('setTimeout(() => setReveal(true), 160)'),
    'a menu whose measure never answers is still shown');
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

test('the picker marks its centre row with two full-width lines and the bold follows the centre', () => {
  assert.ok(primitivesSrc.includes('pickerCenterLine'), 'the centre lines are styled in the shell');
  assert.ok(primitivesSrc.includes('pickerCenterLineTop: { top: 80 }'), 'the top line brackets the 40px centre row');
  assert.ok(primitivesSrc.includes('pickerCenterLineBottom: { top: 120 }'), 'the bottom line brackets the 40px centre row');
  assert.ok(!primitivesSrc.includes('wheelBandTop'), 'the stale per-wheel bands are gone');
  assert.ok(primitivesSrc.includes('setCenterIndex(idx)'), 'the bold row follows the row passing the centre while rolling');
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

test('the button fill follows the corner radius the caller set', () => {
  assert.ok(primitivesSrc.includes('function ButtonFill({ top, bottom, radius }: any)'), 'the fill takes a radius');
  assert.ok(primitivesSrc.includes('borderRadius: radius ?? t.radius.full'), 'the fill uses the given radius, the full curve by default');
  assert.ok(primitivesSrc.includes('const fillRadius = styleObj && typeof styleObj.borderRadius === \'number\' ? styleObj.borderRadius : theme.radius.full;'), 'the button resolves the fill radius from its style');
  assert.ok(primitivesSrc.includes('<ButtonFill radius={fillRadius} />'), 'the primary fill receives the resolved radius');
});

test('a button sized exactly by its caller gets compact padding and a centred label', () => {
  assert.ok(primitivesSrc.includes('buttonSized: { paddingHorizontal: t.spacing.sm, paddingVertical: t.spacing.sm }'), 'the compact padding style exists');
  assert.ok(primitivesSrc.includes('sized && !text ? styles.buttonSized : null'), 'sized buttons use the compact padding');
  assert.ok(primitivesSrc.includes("buttonLabelSized: { textAlign: 'center', flexShrink: 1 }"), 'the sized label centres and may shrink');
});

test('a section with a click is a pressable, never a silent drop', () => {
  assert.ok(primitivesSrc.includes('export function RgSection({ children, style, label, meta, icon, plain, onPress }: any)'), 'the section takes onPress');
  assert.ok(primitivesSrc.includes('<Pressable onPress={(e: any) => { notePressPoint(e); onPress(e); }} style={({ pressed }) => [styles.section, style, pressed && styles.buttonPressed]}>'), 'the section renders a pressable when it carries a click');
});

test('the wheel follows iOS gesture rules: rest-only commits, no self-repositioning, fast deceleration', () => {
  assert.ok(primitivesSrc.includes('const committedIndexRef = useRef(-1)'), 'the wheel marks its own commits');
  assert.ok(primitivesSrc.includes('if (selectedIndex === committedIndexRef.current) return;'), 'the centring effect never answers a self-caused change');
  assert.ok(primitivesSrc.includes('decelerationRate="fast"'), 'the wheel decelerates fast, like a native picker');
  assert.ok(!primitivesSrc.includes('disableIntervalMomentum'), 'the paging prop is gone from the wheel');
  assert.ok(primitivesSrc.includes('const WheelRow = React.memo('), 'wheel rows are memoized, so a centre change re-renders two rows, not the whole wheel');
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

test('the drawer panel top padding clears the status bar zone', () => {
  const body = primitivesSrc.split('drawerPanel: {')[1].split('},')[0];
  assert.ok(
    body.includes('paddingTop: t.spacing.xxxl + t.spacing.lg'),
    'the drawer starts below the clock, not at the screen top');
});

test('pickers dismiss the keyboard as they open', () => {
  const selectFn = primitivesSrc.slice(
    primitivesSrc.indexOf('export function RgSelect'),
    primitivesSrc.indexOf('export function RgStep'));
  assert.ok(selectFn.includes('Keyboard.dismiss()'), 'the select dismisses');
  const pickerFn = primitivesSrc.slice(
    primitivesSrc.indexOf('export function RgDateTimePicker'),
    primitivesSrc.indexOf('export function RgTabs'));
  assert.ok(pickerFn.includes('Keyboard.dismiss()'), 'the datetime picker dismisses');
});

test('a masked field caps its length at the pattern length', () => {
  assert.ok(
    primitivesSrc.includes('maxLength={mask ? String(mask).length : undefined}'),
    'the extra character is refused, never flashed and trimmed');
});

test('the list scroller nests and its refresh spinner wears the theme colour', () => {
  const listFn = primitivesSrc.slice(
    primitivesSrc.indexOf('export function RgList'),
    primitivesSrc.indexOf('export function RgRowAction'));
  assert.ok(listFn.includes('nestedScrollEnabled'), 'the list can own its drags inside a screen');
  assert.ok(listFn.includes('tintColor={tint} colors={[tint]}'), 'the spinner is themed');
});

test('the tooltip bubble is measured and clamped on screen, never centred', () => {
  const tipFn = primitivesSrc.slice(
    primitivesSrc.indexOf('function useTooltipBubble'),
    primitivesSrc.indexOf('export function RgButton'));
  assert.ok(tipFn.includes('measureInWindow'), 'the host is measured on show');
  assert.ok(tipFn.includes('screenW - 8 - bubbleW.current'), 'the bubble clamps to the right edge');
  assert.ok(tipFn.includes('opacity: placed ? 1 : 0'), 'the bubble waits for its offset before painting');
  assert.ok(tipFn.includes('width: bubbleWidth'), 'the bubble carries an explicit width, never capped by its host');
  const bubbleStyle = primitivesSrc.split('tooltipBubble: {')[1].split('},')[0];
  assert.ok(!bubbleStyle.includes("alignSelf: 'center'"), 'the bubble no longer centres on its host');
});
