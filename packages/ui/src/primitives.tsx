/**
 * @rangular-framework/ui primitives, SHIPPED SOURCE for generated apps.
 *
 * These components are copied/bundled into generated React Native apps; they
 * are NOT typechecked by this repo's root build (react-native types are not a
 * dependency here) and are excluded from tsconfig for that reason. They are
 * written against react-native + the pure-TS tokens in ./tokens.
 *
 * Polish rule: simple template blocks compile to these pre-polished
 * primitives, never to raw equivalents, see docs/UI_POLISH.md.
 *
 * Theming rule (Stage 4): EVERY colour in this file comes from the active
 * theme, there is not one hard-coded hex value here. The active theme is
 * delivered by React context: `RgScreen` accepts a `theme` prop
 * ('light' | 'dark') and provides that theme to its whole subtree;
 * `RgThemeProvider` does the same job standalone. With no provider and no
 * prop, the default theme is light, the original Rangular Material look.
 */
import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Svg, Path, Rect, Circle, Defs, LinearGradient, Stop, Text as SvgText, SvgXml } from 'react-native-svg';
import { theme as makeTheme } from './tokens';
import type { Theme } from './tokens';
import { ICON_PATHS, BRAND_MARKS, BRAND_MARK_VIEWBOX } from './icons';
import { applyMask } from './mask';
import { chartModel } from './chart';
import type { ChartShape } from './chart';
import { AVATAR_TONES, AVATAR_TONE_NAMES, COLOR_SWATCHES } from './palette';
import {
  MONTH_SHORT,
  applyWheelValue,
  composeDateTimeIso,
  dateTimeWheels,
  daysInMonth,
  formatDateTimeValue,
  nowParts,
  parseDateTimeValue,
} from './datetime';
import type { DateTimeParts, PickerMode, WheelSpec } from './datetime';

const RgThemeContext = createContext<Theme>(makeTheme('light'));

/** The active Rangular Material theme for the calling component's subtree. */
export function useRgTheme(): Theme {
  return useContext(RgThemeContext);
}

/** Provide a theme ('light' | 'dark') to a subtree without a screen. */
export function RgThemeProvider({ mode = 'light', children }: any) {
  return (
    <RgThemeContext.Provider value={makeTheme(mode)}>{children}</RgThemeContext.Provider>
  );
}

/**
 * One icon from the curated set in ./icons (Stage 7). The drawing is the
 * SVG path data itself, rendered here with react-native-svg, which
 * ships inside Expo Go and is a standard part of Expo and React Native
 * projects. The dev preview draws the same path data as inline SVG, so
 * the two renderings cannot drift apart.
 *
 * `color` names a theme colour role (e.g. color="primary"); the role is
 * resolved against the active theme, and any other string is passed
 * through as a colour value. With no color, the icon takes the theme
 * text colour (the onSurface role). An unknown name draws nothing: the
 * compiler reports it as an error long before an app runs.
 */
export function RgIcon({ name, size = 24, color, badge, style }: any) {
  const t = useRgTheme();
  const styles = stylesFor(t);
  // Brand marks (icons.ts) carry their own colours and ignore the
  // colour role; they render from the same markup the preview uses.
  const brand = BRAND_MARKS[name as string];
  if (brand) {
    const mark = (
      <SvgXml
        xml={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${BRAND_MARK_VIEWBOX}">${brand}</svg>`}
        width={size}
        height={size}
        style={badge === undefined ? style : undefined}
      />
    );
    if (badgeTextOf(badge) === null) return mark;
    return (
      <View style={[{ width: size, height: size }, style]}>
        {mark}
        <BadgeDot value={badge} styles={styles} offset={{ top: -4, right: -4 }} />
      </View>
    );
  }
  const paths = ICON_PATHS[name as string] ?? [];
  const fill = color
    ? ((t.colors as unknown as Record<string, string>)[color as string] ?? color)
    : t.colors.text;
  const svg = (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={badge === undefined ? style : undefined}>
      {paths.map((d: string, i: number) => (
        <Path key={i} d={d} fill={fill} />
      ))}
    </Svg>
  );
  // Badge (Stage 11): with no badge the icon is the bare SVG, exactly
  // as before; with one, a relative wrapper carries the count dot.
  if (badgeTextOf(badge) === null) return svg;
  return (
    <View style={[{ width: size, height: size }, style]}>
      {svg}
      <BadgeDot value={badge} styles={styles} offset={{ top: -4, right: -4 }} />
    </View>
  );
}

/**
 * The display text of a badge value (Stage 11), or null when the
 * badge renders nothing. The Material rule Rangular keeps: a value
 * of 0 or an empty value hides the badge; a number above 99 shows
 * as 99+. A non-numeric string shows as itself.
 */
export function badgeTextOf(badge: unknown): string | null {
  if (badge === undefined || badge === null || badge === '') return null;
  const n = Number(badge);
  if (Number.isFinite(n)) {
    if (n <= 0) return null;
    return n > 99 ? '99+' : String(Math.trunc(n));
  }
  return String(badge);
}

/**
 * The badge count dot itself (Stage 11), internal: an error coloured
 * pill at the host's top end corner. Hosts pass their own offset,
 * because a full width row wants the dot on its grid edge while a
 * button or icon lets it overlap the corner.
 */
function BadgeDot({ value, styles, offset }: any) {
  const text = badgeTextOf(value);
  if (text === null) return null;
  return (
    <View style={[styles.badgeDot, offset]} pointerEvents="none">
      <Text style={styles.badgeDotText}>{text}</Text>
    </View>
  );
}

/** True when an open state seed (a static attribute or a binding) reads as open. */
function seedOpen(value: unknown): boolean {
  return value === true || value === 'true';
}

/** StyleSheet objects are built per theme and cached by mode. */
const styleCache = new Map<string, ReturnType<typeof buildStyles>>();

function stylesFor(t: Theme) {
  let styles = styleCache.get(t.mode);
  if (!styles) {
    styles = buildStyles(t);
    styleCache.set(t.mode, styles);
  }
  return styles;
}

function buildStyles(t: Theme) {
  const c = t.colors;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    // The screen owns the layout grid (default polish pass): one
    // horizontal margin (spacing.lg) applied here as content padding,
    // and one vertical rhythm (spacing.md) applied as the gap between
    // stacked blocks. Primitives carry no horizontal margins of their
    // own, so every top level block, the appbar pill, a card, a bare
    // heading, lands on the same left and right edges, and a block
    // nested in a card or panel takes its inset from that container's
    // padding instead. The preview renderer mirrors these values.
    screenContent: {
      paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.md,
      paddingBottom: t.spacing.xxl, gap: t.spacing.md,
    },
    appbar: {
      flexDirection: 'row', alignItems: 'center', gap: t.spacing.md,
      paddingHorizontal: t.spacing.lg, paddingVertical: 10,
      backgroundColor: c.surfaceVariant, borderRadius: t.radius.full,
    },
    // Gradient app bar (gradient shell round, 2026-11-17): the bar
    // becomes a full width band, square corners, the brand gradient
    // drawn behind it by a GradientFill layer, so the surface colour
    // and the pill radius of the default bar do not apply.
    appbarGradient: {
      borderRadius: 0, backgroundColor: 'transparent',
      paddingVertical: t.spacing.md,
    },
    // Plain app bar (Gmail light round, 2026-11-17): tone="plain"
    // makes the bar a full width white band with a soft shadow, the
    // Gmail shell: the visible chrome is the search pill the bar
    // carries as a child, not the bar itself. The shadow colour is
    // the platform default, so no hex lives here.
    appbarPlain: {
      borderRadius: 0, backgroundColor: c.surface,
      paddingVertical: 12,
      shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.14,
      shadowRadius: 4, elevation: 3,
    },
    // Tint app bar (Option A round, 2026-11-17): tone="tint" makes
    // the bar a flat surfaceVariant band with no shadow, and the
    // screen paints its safe area strip the same colour, so the
    // clock and battery sit on the header's own surface and no
    // seam shows between the status area and the bar.
    appbarTint: {
      // The flat fallback is the wash's own top stop (seamless
      // round, 2026-11-18): in a shell the screen draws the wash
      // and the pinned bar turns transparent over it; standing
      // alone, the bar paints the wash's first step flat.
      borderRadius: 0, backgroundColor: c.washFrom,
      paddingVertical: 12,
    },
    // The app bar icon button touch box (Option A round,
    // 2026-11-17): the bar's menu, back and action buttons get a
    // 40px box around the 24px glyph, so the tap lands on the
    // button, not on the glyph alone. Found by the phone gate:
    // the boxes were exactly the glyph, 24 by 24.
    appbarButton: {
      width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
    },
    // The app bar progress line (Option A round, 2026-11-17): a
    // 3px track at the bar's bottom edge with a primary fill, the
    // lesson position line the learning apps draw under the bar.
    appbarProgressTrack: { height: 3, backgroundColor: c.border },
    appbarProgressFill: { height: 3, backgroundColor: c.primary },
    // The bottom nav selected pill (Option A round, 2026-11-17):
    // the selected tab's icon sits in a primary container pill,
    // the Material 3 navigation bar indicator.
    navItemIconWrapSelected: {
      backgroundColor: c.primaryContainer, borderRadius: t.radius.full,
      paddingHorizontal: 14, paddingVertical: 3,
    },
    // A selected row (Option A round, 2026-11-17): the drawer's
    // current place reads as a filled pill, not a plain row.
    rowSelected: {
      backgroundColor: c.primaryContainer, borderRadius: t.radius.lg,
    },
    // The search pill's leading button (Option A round,
    // 2026-11-17): a full 44px touch box, not just the glyph, so
    // the menu at the pill's left end takes the tap every time.
    inputPillLeading: {
      width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
    },
    // Section chip (Gmail light round, 2026-11-17): a labelled
    // section may open with a round solid chip holding an icon
    // instead of the gradient bar, the Gmail section marker.
    sectionChip: {
      width: 28, height: 28, borderRadius: 14, flexShrink: 0,
      backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center',
    },
    appbarChildren: { marginTop: t.spacing.sm },
    // The gradient surface (gradient shell round, 2026-11-17): a
    // rounded container the brand gradient fills; children sit in a
    // column with the rhythm gap and read as on-primary content.
    gradient: {
      borderRadius: t.radius.lg, overflow: 'hidden',
      padding: t.spacing.md, gap: t.spacing.sm, flexDirection: 'column',
    },
    // A plain container (section, div, header) is a stack: it stacks
    // its children in a column with the one rhythm gap, the same gap
    // the screen and the card use. Before this fix containers compiled
    // to a bare View with no gap, so every routed screen (whose root
    // is a section inside the screen) stacked its cards and blocks
    // with zero space between them, attached edge to edge. Only flat
    // screens whose blocks were direct children of the screen got the
    // rhythm. Found by the Rangular Tutorial app, 2026-11-12.
    section: { flexDirection: 'column', gap: t.spacing.md },
    // Section header (gradient shell round, 2026-11-17): a labelled
    // section opens with a header row, a short brand gradient bar,
    // the title in the title step, and an optional muted meta line
    // at the right (a count, a range). The header makes a section
    // title stand out from the rows under it, which plain stacked
    // text never did.
    sectionHead: {
      flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm,
    },
    sectionBar: {
      width: 4, height: 20, borderRadius: 2, overflow: 'hidden',
      position: 'relative', flexShrink: 0,
    },
    sectionTitle: {
      flex: 1, fontSize: t.typography.title.fontSize,
      fontWeight: '700', color: c.text,
    },
    sectionMeta: {
      fontSize: t.typography.caption.fontSize, color: c.textMuted,
    },
    // An icon button: the Google pattern for actions like Back. A
    // 48 square touch target that hugs the left edge (alignSelf
    // flex-start, glyph left aligned) so the chevron lines up with
    // the headings below it, instead of a full width labelled
    // button doing a small job.
    iconButton: {
      alignSelf: 'flex-start', width: 48, height: 48,
      alignItems: 'flex-start', justifyContent: 'center',
    },
    appbarTitle: { flex: 1, fontSize: t.typography.title.fontSize, fontWeight: '600', color: c.text },
    searchText: { flex: 1, fontSize: t.typography.body.fontSize, color: c.textMuted },
    // Centered title (tutorial round, 2026-11-13): the three zone
    // layout. The side zones are fixed at the avatar's width so the
    // title zone is the true centre of the bar even when a menu
    // icon sits at the left; the title centers inside its zone.
    appbarSide: { width: 28, alignItems: 'flex-start', justifyContent: 'center' },
    appbarSideEnd: { width: 28, alignItems: 'flex-end', justifyContent: 'center' },
    appbarTitleCenter: { textAlign: 'center' },
    card: {
      backgroundColor: c.surfaceVariant, borderColor: c.border, borderWidth: 1,
      borderRadius: t.radius.lg, padding: t.spacing.lg,
      // Children stack with the one rhythm gap, so a heading, a
      // paragraph, a button and a counter line inside a card are
      // separated by the same space, the button spanning the card's
      // content column exactly (no margins of its own).
      gap: t.spacing.md,
    },
    button: {
      backgroundColor: c.primary, borderRadius: t.radius.full,
      minHeight: 48, paddingHorizontal: t.spacing.xxl,
      alignItems: 'center', justifyContent: 'center',
    },
    buttonPressed: { opacity: 0.85 },
    buttonDisabled: { opacity: 0.38 },
    // A button the caller sized exactly (a width or a height in
    // its style) trades the pill's wide padding for compact
    // padding, so the label can use the size it was given: with
    // the pill padding, an 84 wide square leaves 36 for the
    // label and long words break mid-word. The sized label
    // centres its lines and may shrink to fit its box.
    buttonSized: { paddingHorizontal: t.spacing.sm, paddingVertical: t.spacing.sm },
    buttonLabelSized: { textAlign: 'center', flexShrink: 1 },
    buttonLabel: { color: c.onPrimary, fontSize: t.typography.label.fontSize, fontWeight: '600' },
    // The text variant (variant="text"): a quiet action, for back
    // links and secondary choices that should not shout like a
    // primary button. No fill, primary coloured label, left aligned,
    // same 48 high touch target.
    buttonText: {
      backgroundColor: 'transparent', borderRadius: t.radius.full,
      minHeight: 48, paddingHorizontal: t.spacing.sm,
      alignItems: 'flex-start', justifyContent: 'center',
    },
    buttonTextLabel: { color: c.primary, fontSize: t.typography.label.fontSize, fontWeight: '600' },
    // The colour roles (color="danger" / color="neutral"): danger is
    // the theme error role as a flat fill with the on-error label,
    // neutral is the surface-variant fill with its own label role, so
    // a destructive action reads red and a cancelling one reads grey
    // while both keep the pill shape, height and label face.
    buttonNeutral: { backgroundColor: c.surfaceVariant },
    buttonLabelNeutral: { color: c.onSurfaceVariant, fontSize: t.typography.label.fontSize, fontWeight: '600' },
    buttonTextDanger: { color: c.danger, fontSize: t.typography.label.fontSize, fontWeight: '600' },
    buttonTextNeutral: { color: c.textMuted, fontSize: t.typography.label.fontSize, fontWeight: '600' },
    inputWrap: { marginBottom: t.spacing.md },
    inputLabel: {
      fontSize: t.typography.label.fontSize, fontWeight: '600',
      color: c.textMuted, marginBottom: t.spacing.xs,
    },
    inputField: {
      borderWidth: 1, borderColor: c.outline, borderRadius: t.radius.sm,
      backgroundColor: c.surface, paddingHorizontal: t.spacing.md, paddingVertical: 10,
      fontSize: t.typography.bodyLarge.fontSize, color: c.text,
    },
    inputFieldError: { borderColor: c.error },
    // Search pill (gradient shell round, 2026-11-17): the search
    // variant of the input, a full radius surface with the search
    // icon inside at the left, the shape search takes in the Google
    // apps. The field inside carries no border of its own.
    inputPill: {
      flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm,
      backgroundColor: c.surfaceVariant, borderRadius: t.radius.full,
      paddingHorizontal: t.spacing.md, minHeight: 48,
      borderWidth: 1, borderColor: c.border,
    },
    inputPillField: {
      flex: 1, fontSize: t.typography.bodyLarge.fontSize,
      color: c.text, paddingVertical: 10,
    },
    inputError: {
      color: c.error, fontSize: t.typography.caption.fontSize, marginTop: t.spacing.xs,
    },
    inputDisabled: { opacity: 0.38 },
    controlRow: {
      minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: t.spacing.md,
      paddingVertical: t.spacing.sm,
    },
    controlLabel: { flex: 1, fontSize: t.typography.body.fontSize, color: c.text },
    controlDisabled: { opacity: 0.38 },
    switchTrack: {
      width: 52, height: 32, borderRadius: t.radius.full, borderWidth: 2,
      justifyContent: 'center', flexShrink: 0,
    },
    switchTrackOff: { backgroundColor: c.surfaceVariant, borderColor: c.outline },
    switchKnob: {
      width: 24, height: 24, borderRadius: t.radius.full,
      backgroundColor: c.onPrimary,
    },
    switchKnobOff: { backgroundColor: c.onSurfaceVariant },
    checkboxBox: {
      width: 24, height: 24, borderRadius: t.radius.sm, borderWidth: 2,
      borderColor: c.outline, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    },
    checkboxBoxOn: { backgroundColor: c.primary, borderColor: c.primary },
    switcher: {
      flexDirection: 'row', gap: t.spacing.xs, padding: t.spacing.xs,
      marginTop: t.spacing.sm,
      backgroundColor: c.surfaceVariant, borderColor: c.border, borderWidth: 1,
      borderRadius: t.radius.full,
    },
    switcherSegment: {
      flex: 1, minHeight: 40, borderRadius: t.radius.full,
      paddingHorizontal: t.spacing.md, alignItems: 'center', justifyContent: 'center',
    },
    switcherSegmentSelected: { backgroundColor: c.primaryContainer },
    switcherLabel: { color: c.text, fontSize: t.typography.label.fontSize },
    switcherLabelSelected: { color: c.onPrimaryContainer, fontWeight: '600' },
    radioOuter: {
      width: 24, height: 24, borderRadius: t.radius.full, borderWidth: 2,
      borderColor: c.outline, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    },
    radioOuterSelected: { borderColor: c.primary },
    radioDot: { width: 12, height: 12, borderRadius: t.radius.full, backgroundColor: c.primary },
    row: {
      // No horizontal padding of its own: a row takes its inset from
      // the container grid (screen padding, a card's padding, a tab
      // panel), so row text aligns with every other block and the
      // hairline sits on the grid edges.
      flexDirection: 'row', gap: t.spacing.md, alignItems: 'flex-start',
      paddingVertical: 11,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border,
    },
    rowTitle: { fontSize: t.typography.body.fontSize, fontWeight: '600', color: c.text },
    rowSub: { fontSize: 13, color: c.text },
    rowDetail: { fontSize: 12.5, color: c.textMuted },
    // Row action (gradient shell round, 2026-11-17): the trailing
    // icon button a row carries when it declares actionIcon, a
    // compact press target at the row's right edge.
    rowAction: { padding: t.spacing.xs, flexShrink: 0 },
    fab: {
      position: 'absolute', right: t.spacing.lg, bottom: t.spacing.xxl,
      backgroundColor: c.primaryContainer, borderRadius: t.radius.lg,
      paddingHorizontal: 18, paddingVertical: 13,
      ...t.elevation.level2,
    },
    fabLabel: { color: c.onPrimaryContainer, fontSize: t.typography.body.fontSize, fontWeight: '600' },
    // Overlays (Stage 10). The backdrop is the theme scrim role at a
    // fixed opacity; panels are theme surface with the large radius.
    overlayRoot: {
      position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
      justifyContent: 'flex-end', zIndex: 10,
    },
    overlayRootCenter: {
      position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
      justifyContent: 'center', paddingHorizontal: t.spacing.lg, zIndex: 10,
    },
    overlayBackdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: c.scrim },
    overlayFill: { flex: 1 },
    sheetPanel: {
      backgroundColor: c.surface,
      borderTopLeftRadius: t.radius.xl, borderTopRightRadius: t.radius.xl,
      // The extra 24 under the xxl padding is deliberate (his
      // measure, 2026-11-20): on Android the sheet rests on the
      // screen edge, inside the navigation and gesture zone, and
      // the action buttons must clear what lives there.
      paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.sm, paddingBottom: t.spacing.xxl + 24,
      ...t.elevation.level2,
      flexDirection: 'column', gap: t.spacing.md,
    },
    sheetHandle: {
      alignSelf: 'center', width: 36, height: 4, borderRadius: t.radius.full,
      backgroundColor: c.outline, marginBottom: t.spacing.md,
    },
    dialogPanel: {
      backgroundColor: c.surface, borderRadius: t.radius.xl,
      padding: t.spacing.xl, ...t.elevation.level2,
      flexDirection: 'column', gap: t.spacing.md,
    },
    dialogTitle: {
      fontSize: t.typography.title.fontSize, lineHeight: t.typography.title.lineHeight,
      fontWeight: '600', color: c.text, marginBottom: t.spacing.md,
    },
    actions: {
      flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center',
      gap: t.spacing.sm, marginTop: t.spacing.lg,
    },
    // The toast (Stage 10, restyled in the tutorial round,
    // 2026-11-13, at Bigyan's order): a translucent black card at
    // bottom centre, dark in both themes, resting 100px above
    // the bottom edge (lessons QA round, 2026-11-19, his
    // measure: clear of the floating bottom bar, in open space).
    // The host spans the bar and centers the card; the card's
    // surface token already carries 85 percent alpha. React
    // Native has no texture asset for the grain the previews
    // draw, so the grain is approximated honestly: a soft white
    // gradient over the black, strongest at the top edge, and a
    // hairline border catch the light the way grain does.
    // See docs/AI_GUIDE.md, the tutorial round section.
    snackbarHost: {
      position: 'absolute', left: 0, right: 0, bottom: 100,
      alignItems: 'center', zIndex: 20,
    },
    snackbar: {
      backgroundColor: c.toastSurface, borderRadius: t.radius.md,
      borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.16)',
      paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.md,
      flexDirection: 'row', alignItems: 'center', gap: t.spacing.md,
      maxWidth: '92%', overflow: 'hidden',
      ...t.elevation.level2,
    },
    snackbarSheen: {
      position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    },
    snackbarText: { flexShrink: 1, color: c.toastText, fontSize: t.typography.body.fontSize },
    snackbarAction: { color: c.toastAction, fontSize: t.typography.label.fontSize, fontWeight: '600' },
    // Code block (tutorial round, 2026-11-13): a dark editor
    // surface and a monospace face in both themes; long lines
    // scroll horizontally inside the block, the way an editor
    // treats a line as one line.
    code: {
      backgroundColor: c.codeSurface, borderRadius: t.radius.md,
    },
    codeText: {
      color: c.codeText,
      fontSize: t.typography.body.fontSize, lineHeight: t.typography.body.lineHeight,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.md,
    },
    // Date-time picker (Stage 10): the field row mirrors RgInput's box;
    // the wheels sit in a sheet, five rows tall, the selected row
    // centred between two hairlines, the iOS arrangement.
    pickerBox: {
      flexDirection: 'row', alignItems: 'center', gap: t.spacing.md,
      borderWidth: 1, borderColor: c.outline, borderRadius: t.radius.sm,
      backgroundColor: c.surface, paddingHorizontal: t.spacing.md, paddingVertical: 10,
    },
    pickerValue: { flex: 1, fontSize: t.typography.bodyLarge.fontSize, color: c.text },
    pickerHead: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: t.spacing.sm, minHeight: 32,
    },
    pickerHeadBtn: { color: c.primary, fontSize: t.typography.bodyLarge.fontSize, paddingVertical: t.spacing.xs },
    pickerHeadDone: { fontWeight: '600' },
    pickerHeadTitle: { fontSize: t.typography.label.fontSize, fontWeight: '600', color: c.text },
    wheelsRow: { flexDirection: 'row', gap: t.spacing.xs },
    wheel: { height: 200, overflow: 'hidden' },
    wheelItem: { height: 40, alignItems: 'center', justifyContent: 'center', paddingHorizontal: t.spacing.xs },
    wheelText: { fontSize: t.typography.title.fontSize, lineHeight: 26, color: c.textMuted },
    wheelTextSelected: { color: c.text, fontWeight: '600' },
    // Two thin lines bracket the centre row across the WHOLE
    // picker (his ask, 2026-11-20), so the current row reads at
    // a glance. They sit on the wheels wrap, not on each wheel:
    // per-wheel bands were segmented, faint, and still pointed
    // at the old 32px rows (top 64/96) after the 40px overhaul.
    wheelsWrap: { position: 'relative' },
    pickerCenterLine: {
      position: 'absolute', left: 0, right: 0, height: 1,
      backgroundColor: c.textMuted, opacity: 0.4, zIndex: 2,
    },
    pickerCenterLineTop: { top: 80 },
    pickerCenterLineBottom: { top: 120 },
    // Badge (Stage 11): one count dot shared by the three hosts
    // (button, row, icon); each host adjusts the offset in place.
    badgeDot: {
      position: 'absolute', minWidth: 18, height: 18, borderRadius: t.radius.full,
      backgroundColor: c.error, alignItems: 'center', justifyContent: 'center',
      paddingHorizontal: t.spacing.xs, zIndex: 2,
    },
    badgeDotText: { color: c.onError, fontSize: t.typography.caption.fontSize, fontWeight: '700' },
    // Autocomplete (Stage 11): the options panel hangs under the
    // input's anchor box, the Material autocomplete arrangement.
    inputAnchor: { position: 'relative' },
    autoPanel: {
      position: 'absolute', left: 0, right: 0, top: '100%', marginTop: t.spacing.xs,
      backgroundColor: c.surface, borderWidth: 1, borderColor: c.border,
      borderRadius: t.radius.sm, zIndex: 10, ...t.elevation.level2,
    },
    autoOption: { paddingHorizontal: t.spacing.md, paddingVertical: 10 },
    autoOptionText: { fontSize: t.typography.body.fontSize, color: c.text },
    // Tabs (Stage 11): a label bar with a hairline under it, the
    // selected label in the primary colour with a 3px indicator bar.
    tabPanel: { flexDirection: 'column', gap: t.spacing.md },
    tabsHeader: {
      flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    tabHeader: {
      flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center',
      paddingHorizontal: t.spacing.sm, position: 'relative',
    },
    tabLabel: { fontSize: t.typography.label.fontSize, color: c.textMuted },
    tabLabelSelected: { color: c.primary, fontWeight: '600' },
    tabIndicator: {
      position: 'absolute', left: t.spacing.md, right: t.spacing.md, bottom: 0,
      height: 3, borderTopLeftRadius: t.radius.sm, borderTopRightRadius: t.radius.sm,
      backgroundColor: c.primary,
    },
    // Expansion panel (Stage 11): a hairline separated header row and
    // a body that appears under it, the Material panel arrangement.
    panel: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    panelHeader: {
      flexDirection: 'row', alignItems: 'center', gap: t.spacing.md,
      minHeight: 48, paddingVertical: t.spacing.sm,
    },
    panelTitles: { flex: 1 },
    panelTitle: { fontSize: t.typography.body.fontSize, fontWeight: '600', color: c.text },
    panelSubtitle: { fontSize: t.typography.caption.fontSize, color: c.textMuted },
    panelBody: { paddingBottom: t.spacing.lg, gap: t.spacing.md },
    // Table (Stage 11): header labels over hairline separated rows,
    // every column an equal share, the plain Material table look.
    table: {},
    tableRow: {
      flexDirection: 'row', gap: t.spacing.md,
      paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    tableHeadCell: {
      flex: 1, fontSize: t.typography.label.fontSize, fontWeight: '600', color: c.textMuted,
    },
    tableCell: { flex: 1, fontSize: t.typography.body.fontSize, color: c.text },
    tableEmpty: { fontSize: t.typography.body.fontSize, color: c.textMuted, paddingVertical: 11 },
    // Slider (Stage 11): a 4px track, a filled portion and a round
    // thumb, Material slider proportions.
    slider: { paddingVertical: t.spacing.md },
    sliderTrackArea: { height: 24, justifyContent: 'center' },
    sliderTrack: { height: 4, borderRadius: t.radius.full, backgroundColor: c.surfaceVariant },
    sliderFill: { position: 'absolute', left: 0, top: 10, height: 4, borderRadius: t.radius.full, backgroundColor: c.primary },
    sliderThumb: {
      position: 'absolute', top: 2, width: 20, height: 20, borderRadius: t.radius.full,
      backgroundColor: c.primary, marginLeft: -10, ...t.elevation.level1,
    },
    sliderDisabled: { opacity: 0.38 },
    // Progress (Stage 11): a 4px determinate bar; the spinner is an
    // SVG arc, sized on the icon scale.
    progressTrack: {
      height: 4, borderRadius: t.radius.full, backgroundColor: c.surfaceVariant,
      marginTop: t.spacing.sm, overflow: 'hidden',
    },
    progressFill: { height: 4, borderRadius: t.radius.full, backgroundColor: c.primary },
    // Chips (Stage 11): pills in a wrapping row.
    chips: {
      flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm,
      marginTop: t.spacing.sm,
    },
    chip: {
      flexDirection: 'row', alignItems: 'center', gap: t.spacing.xs,
      backgroundColor: c.surfaceVariant, borderWidth: 1, borderColor: c.border,
      borderRadius: t.radius.full, paddingHorizontal: t.spacing.md, paddingVertical: 6,
    },
    chipLabel: { fontSize: t.typography.label.fontSize, color: c.text },
    // Stage 14: the components Angular Material ships that Rangular
    // was missing. Divider is one hairline; the menu panel hangs at
    // the top right over the scrim; the drawer panel is a full
    // height sheet from the left; the select list reuses the sheet.
    divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    overlayRootTop: {
      position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
      alignItems: 'flex-end', paddingTop: 64, paddingRight: t.spacing.lg, zIndex: 10,
    },
    menuPanel: {
      backgroundColor: c.surface, borderRadius: t.radius.md,
      paddingVertical: t.spacing.sm, minWidth: 200, ...t.elevation.level2,
    },
    menuItem: {
      flexDirection: 'row', alignItems: 'center', gap: t.spacing.md,
      paddingHorizontal: t.spacing.lg, minHeight: 48,
    },
    menuItemLabel: { fontSize: t.typography.body.fontSize, color: c.text },
    overlayRootLeft: {
      position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
      flexDirection: 'row', zIndex: 10,
    },
    drawerPanel: {
      width: 280, maxWidth: '85%', height: '100%', backgroundColor: c.surface,
      paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.xxl, paddingBottom: t.spacing.lg,
      ...t.elevation.level2,
      flexDirection: 'column', gap: t.spacing.md,
    },
    selectOption: {
      flexDirection: 'row', alignItems: 'center', gap: t.spacing.md,
      paddingHorizontal: t.spacing.sm, minHeight: 48,
    },
    selectOptionText: { flex: 1, fontSize: t.typography.bodyLarge.fontSize, color: c.text },
    selectPlaceholder: { color: c.textMuted },
    // Stepper (Stage 14): a header row of numbered circles joined
    // by hairlines, the selected step in the primary colour, a
    // completed step carrying a check.
    stepPanel: { flexDirection: 'column', gap: t.spacing.md },
    stepperHeader: { flexDirection: 'row', alignItems: 'flex-start' },
    stepHead: { alignItems: 'center', width: 72 },
    stepCircle: {
      width: 32, height: 32, borderRadius: t.radius.full,
      borderWidth: 1, borderColor: c.outline,
      alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface,
    },
    stepCircleActive: { backgroundColor: c.primary, borderColor: c.primary },
    stepCircleDone: { backgroundColor: c.primaryContainer, borderColor: c.primaryContainer },
    stepNumber: { fontSize: t.typography.label.fontSize, color: c.textMuted, fontWeight: '600' },
    stepNumberActive: { color: c.onPrimary },
    stepLabel: { fontSize: t.typography.caption.fontSize, color: c.textMuted, marginTop: t.spacing.xs, textAlign: 'center' },
    stepLabelActive: { color: c.text, fontWeight: '600' },
    stepConnector: {
      flex: 1, height: 1, backgroundColor: c.border, marginTop: 16, marginHorizontal: -8,
    },
    // Grid list (Stage 14): tiles in a wrapping row, each tile a
    // padded cell holding a surface card.
    gridList: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
    gridTileCell: { padding: 4 },
    gridTile: {
      backgroundColor: c.surfaceVariant, borderRadius: t.radius.lg,
      padding: t.spacing.md, flex: 1,
    },
    // Tree (Stage 14): node headers in the row rhythm, children
    // indented one step per depth.
    treeNodeHeader: {
      flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, minHeight: 40,
    },
    treeNodeLabel: { fontSize: t.typography.body.fontSize, color: c.text },
    treeChildren: { paddingLeft: t.spacing.xl },
    treeChevronSpacer: { width: 24 },
    // Tooltip (Stage 14): a small dark bubble above its host, shown
    // on long press; the wrap makes the host a positioning parent.
    tooltipWrap: { position: 'relative' },
    tooltipBubble: {
      position: 'absolute', bottom: '100%', alignSelf: 'center', marginBottom: t.spacing.xs,
      backgroundColor: c.onSurface, borderRadius: t.radius.sm,
      paddingHorizontal: t.spacing.md, paddingVertical: t.spacing.xs, zIndex: 20,
    },
    tooltipText: { color: c.background, fontSize: t.typography.caption.fontSize },
    // Table pager (Stage 14): a right aligned row under the table
    // with the page range and two chevron buttons.
    tablePager: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end',
      gap: t.spacing.sm, paddingTop: t.spacing.sm,
    },
    tablePagerText: { fontSize: t.typography.caption.fontSize, color: c.textMuted },
    // Stage 15: the pieces real apps use that Angular never
    // shipped. Bottom navigation is a surface bar with a hairline
    // on top; the refresh row is just the spinner centred; the
    // skeleton is a surface variant shape (its pulse is animated
    // in the primitive, a plain timing loop, no spring).
    bottomNav: {
      flexDirection: 'row', backgroundColor: c.surface,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border,
      paddingVertical: t.spacing.xs,
      // No shadow at all (seamless round, 2026-11-18): a shadow
      // blurs past the bar's own edges in every direction, and
      // the part that spilled below the bar printed a soft grey
      // seam on the safe area strip under it, however the offset
      // pointed. The bar's top hairline is its separation; the
      // screen paints under it in the same surface colour, so
      // bar and phone edge read as one piece.
    },
    navItem: {
      flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center',
      gap: t.spacing.xs, paddingVertical: t.spacing.xs,
    },
    navItemIconWrap: { position: 'relative' },
    navItemLabel: { fontSize: t.typography.caption.fontSize, color: c.textMuted },
    navItemLabelSelected: { color: c.primary, fontWeight: '600' },
    refreshRow: { alignItems: 'center', paddingVertical: t.spacing.sm },
    skeleton: { backgroundColor: c.surfaceVariant },
    // Swipe actions (Stage 15): the tray sits behind the row at
    // its end edge; each action is a 72 wide coloured block.
    rowWrap: { position: 'relative', overflow: 'hidden' },
    swipeTray: { position: 'absolute', right: 0, top: 0, bottom: 0, flexDirection: 'row' },
    swipeAction: {
      width: 72, alignItems: 'center', justifyContent: 'center', gap: t.spacing.xs,
      backgroundColor: c.primary,
    },
    swipeActionLabel: { color: c.onPrimary, fontSize: t.typography.caption.fontSize, fontWeight: '600' },
    // Rating and OTP (Stage 15): stars are icon buttons in a row;
    // OTP boxes are input boxes in a row with one hidden field
    // over them taking the actual typing.
    rating: { flexDirection: 'row', gap: t.spacing.xs, paddingVertical: t.spacing.xs },
    ratingStar: { padding: t.spacing.xs },
    otpRow: { flexDirection: 'row', gap: t.spacing.sm },
    otpBox: {
      width: 44, height: 52, borderWidth: 1, borderColor: c.outline,
      borderRadius: t.radius.sm, backgroundColor: c.surface,
      alignItems: 'center', justifyContent: 'center',
    },
    otpBoxActive: { borderColor: c.primary, borderWidth: 2 },
    otpDigit: { fontSize: t.typography.heading.fontSize, color: c.text, fontWeight: '600' },
    otpHiddenInput: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: 0 },
    // Carousel (Stage 15): pages plus a dots row.
    carouselDots: {
      flexDirection: 'row', justifyContent: 'center', gap: t.spacing.xs,
      paddingTop: t.spacing.sm,
    },
    carouselDot: { width: 8, height: 8, borderRadius: t.radius.full, backgroundColor: c.outline },
    carouselDotActive: { backgroundColor: c.primary },
    // Timeline (Stage 15): a rail column (dot plus connecting
    // line) beside the item body, in the row rhythm.
    timelineItem: { flexDirection: 'row', gap: t.spacing.md },
    timelineRail: { alignItems: 'center', width: 24 },
    timelineDot: {
      width: 12, height: 12, borderRadius: t.radius.full,
      backgroundColor: c.primary, marginTop: 5,
    },
    timelineLine: { flex: 1, width: 2, backgroundColor: c.border, marginTop: t.spacing.xs },
    timelineBody: { flex: 1, paddingBottom: t.spacing.lg },
    timelineHead: { flexDirection: 'row', alignItems: 'baseline', gap: t.spacing.md },
    timelineTitle: { flex: 1, fontSize: t.typography.body.fontSize, fontWeight: '600', color: c.text },
    timelineTime: { fontSize: t.typography.caption.fontSize, color: c.textMuted },
    // Calendar (Stage 15): a month grid of seventh-width cells;
    // the selected day is a filled circle, today is primary text.
    calendarHead: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: t.spacing.sm,
    },
    calendarTitle: { fontSize: t.typography.title.fontSize, fontWeight: '600', color: c.text },
    calendarWeek: { flexDirection: 'row' },
    calendarWeekCell: {
      width: '14.2857%', textAlign: 'center', fontSize: t.typography.caption.fontSize,
      fontWeight: '600', color: c.textMuted, paddingVertical: t.spacing.xs,
    },
    calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    calendarCell: { width: '14.2857%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
    calendarDay: { fontSize: t.typography.body.fontSize, color: c.text },
    calendarDayToday: { color: c.primary, fontWeight: '700' },
    calendarDaySelected: {
      width: 36, height: 36, borderRadius: t.radius.full, backgroundColor: c.primary,
      alignItems: 'center', justifyContent: 'center',
    },
    calendarDaySelectedText: { color: c.onPrimary, fontWeight: '600' },
    // Avatar group (Stage 15): overlapping circles with a ring
    // in the screen background colour.
    avatarGroup: { flexDirection: 'row', alignItems: 'center' },
    avatarRing: {
      borderWidth: 2, borderColor: c.background, borderRadius: t.radius.full,
    },
    // Empty state (Stage 15): a centred column, the icon in a
    // soft circle, one title, one line, then the action.
    emptyState: { alignItems: 'center', gap: t.spacing.md, paddingVertical: t.spacing.xxxl },
    emptyIconCircle: {
      width: 72, height: 72, borderRadius: t.radius.full, backgroundColor: c.surfaceVariant,
      alignItems: 'center', justifyContent: 'center',
    },
    emptyTitle: {
      fontSize: t.typography.title.fontSize, fontWeight: '600', color: c.text, textAlign: 'center',
    },
    emptyText: { fontSize: t.typography.body.fontSize, color: c.textMuted, textAlign: 'center' },
    // Editor (Stage 15): a toolbar row over a tall input field.
    editorToolbar: { flexDirection: 'row', gap: t.spacing.sm, marginBottom: t.spacing.sm },
    editorTool: {
      paddingHorizontal: t.spacing.md, minHeight: 36, borderRadius: t.radius.full,
      borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center',
    },
    editorToolLabel: { fontSize: t.typography.label.fontSize, color: c.primary, fontWeight: '600' },
    editorArea: { minHeight: 120, textAlignVertical: 'top' },
    // Lightbox (Stage 15): the photo centred over the scrim,
    // the close button a surface chip at the top end corner.
    lightboxImage: { width: '100%', height: '72%' },
    lightboxClose: {
      position: 'absolute', top: t.spacing.xxl, right: t.spacing.lg, zIndex: 2,
      backgroundColor: c.surface, borderRadius: t.radius.full, padding: t.spacing.sm,
    },
    lightboxCaption: { paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.md, alignItems: 'center' },
    // Colour picker (Stage 15): a swatch chip in the field and a
    // grid of swatches in the sheet.
    colorSwatchChip: {
      width: 24, height: 24, borderRadius: t.radius.sm,
      borderWidth: 1, borderColor: c.border,
    },
    swatchGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm, paddingVertical: t.spacing.sm },
    swatch: { width: 44, height: 44, borderRadius: t.radius.md, borderWidth: 1, borderColor: c.border },
    swatchSelected: { borderColor: c.primary, borderWidth: 3 },
    // Breadcrumbs (Stage 15): a wrapping row of links joined by
    // chevrons; the last crumb is the current page, plain text.
    breadcrumbs: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: t.spacing.xs },
    crumbLabel: { fontSize: t.typography.body.fontSize, color: c.primary },
    crumbCurrent: { fontSize: t.typography.body.fontSize, color: c.text, fontWeight: '600' },
    // Masonry (Stage 15): columns of stacked tiles, the grid
    // list's uneven mode.
    masonry: { flexDirection: 'row', gap: t.spacing.sm },
    masonryCol: { flex: 1, flexDirection: 'column', gap: t.spacing.sm },
  });
}

/**
 * An end-reached scroll handler (Stage 15, infinite scroll): the
 * callback fires when the scroll comes within 48 of the end, once
 * per content size; when the content grows (the next page landed)
 * it may fire again. Shared by RgScreen and RgList, the two
 * scrollers. This is the contract ngx-infinite-scroll sells as an
 * add-on in Angular; here it is one prop on the scroller.
 */
function endReachedScrollHandler(onEndReached?: () => void) {
  let firedFor = -1;
  return (e: any): void => {
    if (!onEndReached) return;
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent ?? {};
    if (!layoutMeasurement || !contentOffset || !contentSize) return;
    const near = layoutMeasurement.height + contentOffset.y >= contentSize.height - 48;
    if (near && firedFor !== contentSize.height) {
      firedFor = contentSize.height;
      onEndReached();
    }
  };
}

/**
 * The brand gradient as an absolute fill layer (gradient shell
 * round, 2026-11-17): an SVG linear gradient through the theme's
 * three brand stops, drawn behind the content of the surface that
 * hosts it. The host clips it with its own radius and overflow.
 * One shared definition: RgGradient, the gradient app bar and the
 * section header bar all draw this same fill.
 */
function GradientFill() {
  const t = useRgTheme();
  const c = t.colors;
  const rawId = React.useId();
  const id = 'rggrad' + rawId.replace(/[^a-zA-Z0-9]/g, '');
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={c.gradientFrom} />
            <Stop offset="0.52" stopColor={c.gradientVia} />
            <Stop offset="1" stopColor={c.gradientTo} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

/**
 * The soft wash as an absolute fill layer (seamless round,
 * 2026-11-18): a vertical gradient through the theme's three
 * wash stops, drawn by the screen as one layer behind the
 * status area and a tint bar, so the gradient is continuous
 * from the top of the phone down. It lands on the page colour
 * at 70 percent of the layer and fades to nothing by the
 * bottom, so content scrolling under the melt is never hidden
 * behind a hard edge. The host clips it.
 */
function SoftFill() {
  const t = useRgTheme();
  const c = t.colors;
  const rawId = React.useId();
  const id = 'rgwash' + rawId.replace(/[^a-zA-Z0-9]/g, '');
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={c.washFrom} />
            <Stop offset="0.45" stopColor={c.washVia} />
            <Stop offset="0.7" stopColor={c.washTo} />
            <Stop offset="1" stopColor={c.washTo} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

/**
 * The filled button's gradient as an absolute fill layer
 * (seamless round, 2026-11-18): primary at the top, primaryDeep
 * at the bottom, so the button reads as lit from above. The
 * host clips it with the pill radius and overflow.
 */
function ButtonFill({ top, bottom, radius }: any) {
  const t = useRgTheme();
  const c = t.colors;
  const stopTop = top ?? c.primary;
  const stopBottom = bottom ?? c.primaryDeep;
  const rawId = React.useId();
  const id = 'rgbtn' + rawId.replace(/[^a-zA-Z0-9]/g, '');
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius ?? t.radius.full, overflow: 'hidden' }}>
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={stopTop} />
            <Stop offset="1" stopColor={stopBottom} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

/**
 * A gradient surface: a rounded container the brand gradient
 * fills, with its children stacked inside in the rhythm gap.
 * Children read as on-primary content: the surface provides a
 * derived theme whose text roles are the on-primary colour, so
 * headings, paragraphs and icons drawn with the text roles come
 * out light on the gradient, the way content on a coloured band
 * must. This is the banner an app shell opens with, the header
 * band of a drawer, a highlighted card.
 */
export function RgGradient({ children, style }: any) {
  const t = useRgTheme();
  const styles = stylesFor(t);
  const onGradient: Theme = {
    ...t,
    colors: {
      ...t.colors,
      text: t.colors.onPrimary,
      onSurface: t.colors.onPrimary,
      textMuted: t.colors.onPrimary,
      onSurfaceVariant: t.colors.onPrimary,
    },
  };
  return (
    <View style={[styles.gradient, style]}>
      <GradientFill />
      <RgThemeContext.Provider value={onGradient}>
        {children}
      </RgThemeContext.Provider>
    </View>
  );
}

/**
 * The current route's ActivatedRoute, provided by the generated
 * outlet around the routed component. Angular provides
 * ActivatedRoute through the outlet's injector, so any component
 * in the routed subtree can inject it, not only the routed
 * component itself; this context is the same idea. The value is
 * the runtime's ActivatedRoute instance for the active route.
 */
export const ActivatedRouteContext = createContext<any>(null);

/**
 * The header slot a screen offers its pinned app bar (gradient
 * shell round, 2026-11-17). An app bar written with `pin` inside a
 * screen registers its rendered bar here instead of rendering in
 * place, and the screen draws the registered bar above its
 * ScrollView, so the bar stays fixed while the content scrolls
 * under it, the way the top bar of the Google apps stays. The
 * registration is keyed: the bar re-registers only when its key
 * (its props and its children's values) changes, so a re-render
 * with the same key cannot loop. An app bar with no screen above
 * it, or without `pin`, renders in place exactly as before.
 */
// The screen's keyboard lift control, lent to the fields
// inside the screen: a field reports its node on focus, and
// the screen owns the keyboard frame, the scroll offset and
// the lift calculation itself (lessons QA round 2, 2026-11-19).
const RgScrollContext = createContext<any>(null);

// The overlay layer's own keyboard lift control (his rule,
// 2026-11-20): a field inside a dialog or a sheet reports its
// node here, and the screen translates the whole overlay layer
// up by exactly that field's overlap, so the field's bottom
// rests 20px above the keyboard. A field already at or above
// that line moves nothing. This replaces the earlier approach
// of shrinking the overlay layer to the keyboard's top edge,
// which could not serve a large modal.
const RgOverlayLiftContext = createContext<any>(null);

const RgHeaderSlotContext = createContext<{
  register: (key: string, node: React.ReactNode, chrome?: string, wash?: boolean) => void;
  clear: (key: string) => void;
} | null>(null);

/** A stable key for a pinned bar's children: element types plus
 * their scalar prop values, so a search field's typed text (a
 * value prop) changes the key and the pinned bar follows it. */
function childrenKeyOf(children: unknown): string {
  return React.Children.toArray(children as any)
    .map((child) => {
      if (!React.isValidElement(child)) return String(child);
      const el = child as React.ReactElement<any>;
      const typeName = typeof el.type === 'function'
        ? ((el.type as any).name ?? 'el')
        : String(el.type);
      const scalars = Object.entries(el.props ?? {})
        .filter(([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v))
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(',');
      return `${typeName}(${scalars})`;
    })
    .join(';');
}

/**
 * The overlay slot: the screen lends its overlays (dialog, sheet,
 * drawer, lightbox) a place above the ScrollView. Inside the
 * scrollable content an absolutely positioned overlay anchors to
 * the tall content box on native, so a centered dialog lands far
 * below the fold and a bottom sheet lands at the end of the page
 * (the web renderer anchors to the visible box, which hid this).
 * While open, an overlay registers its tree here and renders
 * nothing in place; the screen draws the tree over its whole
 * box. Outside a screen there is no slot and the overlay renders
 * in place, as before. Registration is keyed on the tree's
 * content, so a re-render with the same content cannot loop.
 */
const RgOverlaySlotContext = createContext<{
  register: (id: string, key: string, node: React.ReactNode) => void;
  clear: (id: string) => void;
} | null>(null);

/** A content key for an overlay tree: element types and scalar
 * props, walked recursively, so any visible change inside the
 * overlay changes the key and the slotted copy follows it. */
function overlayKeyOf(node: unknown, depth = 0): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((n) => overlayKeyOf(n, depth)).join(';');
  if (!React.isValidElement(node) || depth > 6) return '';
  const el = node as React.ReactElement<any>;
  const typeName = typeof el.type === 'function'
    ? ((el.type as any).name ?? 'el')
    : String(el.type);
  const scalars = Object.entries(el.props ?? {})
    .filter(([k, v]) => k !== 'children' && (v === null || ['string', 'number', 'boolean'].includes(typeof v)))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(',');
  return `${typeName}(${scalars})[${overlayKeyOf(el.props?.children, depth + 1)}]`;
}

let rgOverlaySeq = 0;
function useRgOverlay(tree: React.ReactNode, active: boolean): boolean {
  const slot = useContext(RgOverlaySlotContext);
  const ref = useRef<string | null>(null);
  if (ref.current === null) {
    rgOverlaySeq += 1;
    ref.current = 'rg-overlay-' + rgOverlaySeq;
  }
  const id = ref.current;
  useLayoutEffect(() => {
    if (!slot) return;
    if (active) slot.register(id, overlayKeyOf(tree), tree);
    else slot.clear(id);
  });
  useEffect(() => () => {
    if (slot) slot.clear(id);
  }, [slot, id]);
  return slot !== null;
}

/**
 * The bottom slot (Option A round, 2026-11-17): the screen lends
 * a bottom navigation bar declared anywhere inside it (a routed
 * tab page, not just a direct child) a place under the
 * ScrollView, the same pattern as the header slot. Before this,
 * RgScreen lifted only direct children, so a tab bar inside a
 * routed page rendered in flow at the end of the scroll.
 * Registration is keyed on the bar's content, like the overlays.
 */
const RgBottomSlotContext = createContext<{
  register: (key: string, node: React.ReactNode) => void;
  clear: (key: string) => void;
} | null>(null);

function useRgBottom(tree: React.ReactNode): boolean {
  const slot = useContext(RgBottomSlotContext);
  const key = overlayKeyOf(tree);
  useLayoutEffect(() => {
    if (!slot) return;
    slot.register(key, tree);
    return () => slot.clear(key);
  });
  return slot !== null;
}

// The scroll fade (Option A round, 2026-11-17; gradient form,
// phone round, 2026-11-18): content melts out under a pinned bar
// through one SVG linear gradient of the header's colour. The
// first form was six 4px strips at falling opacity, and on a
// phone, over saturated content, the steps read as hard stripes
// (banding), where the browser's flat colours had hidden them.
// react-native-svg is already a dependency (the icon set), so
// the smooth form costs nothing.

export function RgScreen({ children, style, theme: mode, refreshing, onRefresh, onEndReached, fade, scrollKey }: any) {
  const veilRawId = React.useId();
  const veilId = 'rgveil' + veilRawId.replace(/[^a-zA-Z0-9]/g, '');
  const meltRawId = React.useId();
  const meltId = 'rgmelt' + meltRawId.replace(/[^a-zA-Z0-9]/g, '');
  const inherited = useRgTheme();
  const active = mode === 'dark' || mode === 'light' ? makeTheme(mode) : inherited;
  const styles = stylesFor(active);
  const onScroll = useRef(endReachedScrollHandler(onEndReached)).current;
  // The pinned header slot: a pinned app bar anywhere in this
  // screen registers its bar, and the screen draws it above the
  // ScrollView. Registration is keyed so a repeat registration
  // with the same key is a no-op.
  const [headerNode, setHeaderNode] = useState<React.ReactNode>(null);
  const headerKeyRef = useRef<string | null>(null);
  // The chrome colour (Option A round, 2026-11-17): a pinned bar
  // may lend the screen its background colour, and the screen
  // paints its safe area strip with it, so the status area and
  // the bar read as one surface with no seam.
  const [chrome, setChrome] = useState<string | undefined>(undefined);
  // The wash flag (seamless round, 2026-11-18): a tint bar asks
  // the screen to draw the soft wash as one layer behind the
  // status area and the bar, so the gradient is continuous
  // from the top of the phone to the bar's melt into the page.
  const [headerWash, setHeaderWash] = useState(false);
  const headerSlot = useRef({
    register: (key: string, node: React.ReactNode, chromeColor?: string, wash?: boolean) => {
      if (headerKeyRef.current !== key) {
        headerKeyRef.current = key;
        setHeaderNode(node);
        setChrome(chromeColor);
        setHeaderWash(!!wash);
      }
    },
    clear: (key: string) => {
      if (headerKeyRef.current === key) {
        headerKeyRef.current = null;
        setHeaderNode(null);
        setChrome(undefined);
        setHeaderWash(false);
      }
    },
  }).current;
  // The bottom slot state, mirroring the header slot.
  const [bottomNode, setBottomNode] = useState<React.ReactNode>(null);
  const bottomKeyRef = useRef<string | null>(null);
  const bottomSlot = useRef({
    register: (key: string, node: React.ReactNode) => {
      if (bottomKeyRef.current !== key) {
        bottomKeyRef.current = key;
        setBottomNode(node);
      }
    },
    clear: (key: string) => {
      if (bottomKeyRef.current === key) {
        bottomKeyRef.current = null;
        setBottomNode(null);
      }
    },
  }).current;
  // The scroll fade (Option A round, 2026-11-17): with `fade`,
  // the screen tracks the scroll offset and draws the veil under
  // the pinned bar, deepening as the content scrolls under it.
  const [scrollY, setScrollY] = useState(0);
  // Scroll reset on route change (seamless round follow-up,
  // 2026-11-18): the entry screen persists across routes now
  // (the remount per navigation was the tab switch jitter), so
  // the generated root passes the concrete path as scrollKey
  // and the screen scrolls itself to the top, in a layout
  // effect so the new page paints already at the top, whenever
  // the key changes. The fade veil's offset resets with it.
  const scrollRef = useRef<any>(null);
  const lastScrollKey = useRef(scrollKey);
  useLayoutEffect(() => {
    if (scrollKey === undefined || scrollKey === null) return;
    if (lastScrollKey.current !== scrollKey) {
      lastScrollKey.current = scrollKey;
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      setScrollY(0);
    }
  });
  const handleScroll = (e: any) => {
    offsetRef.current = e?.nativeEvent?.contentOffset?.y ?? offsetRef.current;
    if (onEndReached) onScroll(e);
    if (fade) setScrollY(e?.nativeEvent?.contentOffset?.y ?? 0);
  };
  const veilFactor = fade ? Math.min(1, Math.max(0, scrollY / 24)) : 0;
  // Keyboard lift (lessons QA round 2, 2026-11-19): the screen
  // does the calculation itself, from measured facts, never
  // from a guessed timer. The keyboard events hand over the
  // keyboard's final height. The focused field is measured in
  // the window. The overlap is the distance from the field's
  // bottom to the line where it must rest, the window height
  // minus the keyboard height minus a 20px gap (his measure).
  // The screen then scrolls by its current offset plus exactly
  // that overlap. While the keyboard is up the content carries
  // a bottom inset equal to the keyboard height, so a field
  // near the end of the page always has room to be scrolled
  // to. The lift runs twice per keyboard frame, once as the
  // layout lands and once after it settles, and the second
  // pass measures again and corrects whatever the first pass
  // could not yet reach. The first round's version asked the
  // legacy scroll responder to do this after a fixed 120ms
  // wait; on a real phone it measured before the keyboard
  // frame was final and the field stayed hidden.
  const offsetRef = useRef(0);
  const focusedNodeRef = useRef<any>(null);
  const keyboardHeightRef = useRef(0);
  const liftTimers = useRef<any[]>([]);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const liftFocusedField = () => {
    const node = focusedNodeRef.current;
    const kb = keyboardHeightRef.current;
    const sv = scrollRef.current;
    if (!node || !sv || kb <= 0 || Platform.OS === 'web') return;
    try {
      node.measureInWindow?.((_x: number, y: number, _w: number, h: number) => {
        const restLine = Dimensions.get('window').height - kb - 20;
        const overlap = y + h - restLine;
        if (overlap <= 0) return;
        sv.scrollTo({ y: offsetRef.current + overlap, animated: true });
      });
    } catch { /* the field left the tree before the keyboard settled */ }
  };
  // The passes run at 60, 320 and 700ms: the keyboard frame can
  // grow after the first event, when the iCloud Keychain strip
  // (two lines: the site, then the user name) expands over a
  // password field, and the last pass still catches it.
  const scheduleLift = () => {
    liftTimers.current.forEach((t) => clearTimeout(t));
    liftTimers.current = [
      setTimeout(liftFocusedField, 60),
      setTimeout(liftFocusedField, 320),
      setTimeout(liftFocusedField, 700),
    ];
  };
  const scrollControl = useRef({
    requestLift: (node: any) => {
      focusedNodeRef.current = node;
      if (keyboardHeightRef.current > 0) scheduleLift();
    },
    releaseLift: (node: any) => {
      if (focusedNodeRef.current === node) focusedNodeRef.current = null;
    },
  }).current;
  // The overlay twin of the lift above: same measured facts,
  // same 20px rest line, but the overlay layer cannot scroll,
  // so it translates. The lift is recomputed on every focus and
  // every keyboard frame, and it is exactly the focused field's
  // overlap: zero when the field already rests at or above the
  // line, so a small modal whose field is clear does not move.
  const overlayNodeRef = useRef<any>(null);
  const overlayTimers = useRef<any[]>([]);
  const overlayLiftRef = useRef(0);
  const [overlayLift, setOverlayLift] = useState(0);
  const applyOverlayLift = (next: number) => {
    overlayLiftRef.current = next;
    setOverlayLift(next);
  };
  const liftOverlayField = () => {
    const node = overlayNodeRef.current;
    const kb = keyboardHeightRef.current;
    if (!node || kb <= 0 || Platform.OS === 'web') return;
    try {
      node.measureInWindow?.((_x: number, y: number, _w: number, h: number) => {
        // The measure reads the field where it sits NOW, already
        // translated by the current lift, so the lift is added
        // back before the overlap is judged. Without this the
        // second pass saw a clear field and dropped the layer
        // back under the keyboard (his phone report, 2026-11-20:
        // pushed momentarily and came back).
        const restLine = Dimensions.get('window').height - kb - 20;
        const overlap = y + h + overlayLiftRef.current - restLine;
        applyOverlayLift(overlap > 0 ? overlap : 0);
      });
    } catch { /* the field left the tree before the keyboard settled */ }
  };
  const scheduleOverlayLift = () => {
    overlayTimers.current.forEach((t) => clearTimeout(t));
    overlayTimers.current = [
      setTimeout(liftOverlayField, 60),
      setTimeout(liftOverlayField, 320),
      setTimeout(liftOverlayField, 700),
    ];
  };
  const overlayLiftControl = useRef({
    requestLift: (node: any) => {
      overlayNodeRef.current = node;
      if (keyboardHeightRef.current > 0) scheduleOverlayLift();
    },
    releaseLift: (node: any) => {
      if (overlayNodeRef.current === node) overlayNodeRef.current = null;
    },
  }).current;
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const showName = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideName = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const frameName = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const onFrame = (e: any) => {
      const h = e?.endCoordinates?.height ?? 0;
      if (h <= 0) return;
      keyboardHeightRef.current = h;
      setKeyboardHeight(h);
      scheduleLift();
      scheduleOverlayLift();
    };
    const onHide = () => {
      keyboardHeightRef.current = 0;
      setKeyboardHeight(0);
      applyOverlayLift(0);
    };
    const subs = [
      Keyboard.addListener(showName as any, onFrame),
      Keyboard.addListener(frameName as any, onFrame),
      Keyboard.addListener(hideName as any, onHide),
    ];
    return () => {
      subs.forEach((s) => s.remove());
      liftTimers.current.forEach((t) => clearTimeout(t));
      overlayTimers.current.forEach((t) => clearTimeout(t));
    };
  }, []);
  // The overlay slot: overlays inside the scrollable content
  // register here while open, and the screen draws them above
  // everything, anchored to the screen box.
  const [overlayMap, setOverlayMap] = useState(
    () => new Map<string, { key: string; node: React.ReactNode }>(),
  );
  const overlaySlot = useRef({
    register: (id: string, key: string, node: React.ReactNode) => {
      setOverlayMap((prev) => {
        const cur = prev.get(id);
        if (cur && cur.key === key) return prev;
        const next = new Map(prev);
        next.set(id, { key, node });
        return next;
      });
    },
    clear: (id: string) => {
      setOverlayMap((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    },
  }).current;
  const overlayNodes = [...overlayMap.entries()].map(([id, entry]) => (
    <React.Fragment key={id}>{entry.node}</React.Fragment>
  ));
  // A bottom navigation bar is a screen child in the template but
  // not a scrolling one: the screen lifts it out of the ScrollView
  // and pins it under the content, the way a real app shell does.
  const kids = React.Children.toArray(children);
  const navs = kids.filter(
    (k) => React.isValidElement(k) && (k as React.ReactElement<any>).type === RgBottomNav,
  );
  const body = kids.filter(
    (k) => !(React.isValidElement(k) && (k as React.ReactElement<any>).type === RgBottomNav),
  );
  return (
    <RgThemeContext.Provider value={active}>
      <SafeAreaView style={[styles.screen, chrome && !headerWash ? { backgroundColor: chrome } : null, style]}>
        <RgOverlaySlotContext.Provider value={overlaySlot}>
        <RgBottomSlotContext.Provider value={bottomSlot}>
        <RgHeaderSlotContext.Provider value={headerSlot}>
          {headerWash ? (
            <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 170 }}>
              <SoftFill />
            </View>
          ) : null}
          {headerNode}
          <View style={{ flex: 1, position: 'relative' }}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            contentContainerStyle={[styles.screenContent, keyboardHeight > 0
              ? { paddingBottom: active.spacing.xxl + keyboardHeight }
              : null]}
            refreshControl={onRefresh
              ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} />
              : undefined}
            onScroll={handleScroll}
            scrollEventThrottle={16}
          >
            <RgScrollContext.Provider value={scrollControl}>{body}</RgScrollContext.Provider>
          </ScrollView>
          </KeyboardAvoidingView>
          {fade && veilFactor > 0 ? (
            <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 24, opacity: veilFactor }}>
              <Svg width="100%" height={24}>
                <Defs>
                  <LinearGradient id={veilId} x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={chrome ?? styles.screen.backgroundColor} stopOpacity={0.96} />
                    <Stop offset="1" stopColor={chrome ?? styles.screen.backgroundColor} stopOpacity={0} />
                  </LinearGradient>
                </Defs>
                <Rect x="0" y="0" width="100%" height={24} fill={`url(#${veilId})`} />
              </Svg>
            </View>
          ) : null}
          {/* The bottom melt (seamless round follow-up,
              2026-11-18): when a bottom bar is pinned, content
              reaching the bottom of the scroll box dissolves
              into the bar's surface colour through the mirror
              gradient, instead of being sliced by the bar's top
              edge. The scroll box's bottom padding is exactly
              the melt's height, so at rest the last block sits
              above the melt and is never washed. */}
          {(navs.length > 0 || bottomNode) ? (
            <View pointerEvents="none" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 24 }}>
              <Svg width="100%" height={24}>
                <Defs>
                  <LinearGradient id={meltId} x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={styles.bottomNav.backgroundColor} stopOpacity={0} />
                    <Stop offset="1" stopColor={styles.bottomNav.backgroundColor} stopOpacity={0.96} />
                  </LinearGradient>
                </Defs>
                <Rect x="0" y="0" width="100%" height={24} fill={`url(#${meltId})`} />
              </Svg>
            </View>
          ) : null}
          </View>
          {/* The bottom paint (phone round, 2026-11-18): when a
              bottom bar is pinned, the safe area strip under it
              (the home indicator zone) otherwise shows the page
              background through, a paler band with the bar's own
              downward shadow on it, which read as a seam under
              the bar. This strip paints the zone in the bar's
              surface colour, behind the bar: 48 covers the
              largest phone inset in use, and the overlap hides
              behind the bar itself, same colour on same colour. */}
          {(navs.length > 0 || bottomNode) ? (
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 48, backgroundColor: styles.bottomNav.backgroundColor }} />
          ) : null}
          {navs}
          {bottomNode}
          {/* The overlay layer's keyboard lift (his rule,
              2026-11-20): the layer stays the full screen box and
              translates up by exactly the focused field's overlap,
              so that field's bottom rests 20px above the keyboard
              and a field already clear of it moves nothing, the
              same measure the scroll body uses. A large modal
              keeps its size; only the overlap is travelled. */}
          {overlayNodes.length > 0 ? (
            <RgOverlayLiftContext.Provider value={overlayLiftControl}>
              <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, transform: [{ translateY: -overlayLift }] }}>
                {overlayNodes}
              </View>
            </RgOverlayLiftContext.Provider>
          ) : null}
        </RgHeaderSlotContext.Provider>
        </RgBottomSlotContext.Provider>
        </RgOverlaySlotContext.Provider>
      </SafeAreaView>
    </RgThemeContext.Provider>
  );
}

export function RgAppbar({ title, search, menu, avatar, onMenu, titleAlign, tone, pin, back, onBack, actionIcon, onAction, actionIcon2, onAction2, progress, children }: any) {
  const t = useRgTheme();
  const c = t.colors;
  const styles = stylesFor(t);
  const slot = useContext(RgHeaderSlotContext);
  const gradient = tone === 'gradient';
  const plain = tone === 'plain';
  const tint = tone === 'tint';
  const iconRole = gradient ? 'onPrimary' : 'textMuted';
  // Menu and avatar are opt-in. An app bar shows a menu button only
  // when the app asks for one (the boolean `menu` attribute), and an
  // avatar only when the app passes `avatar` text. Before this fix the
  // bar always drew both: a dead menu icon, and a user avatar built
  // from the title's first letter in apps with no users and no sign
  // in at all (found by the Rangular Tutorial app, 2026-11-12).
  const menuNode = menu ? (onMenu ? (
    <Pressable onPress={onMenu} hitSlop={4} style={({ pressed }) => [styles.appbarButton, pressed && styles.buttonPressed]}>
      <RgIcon name="menu" size={24} color={iconRole} />
    </Pressable>
  ) : <RgIcon name="menu" size={24} color={iconRole} />) : null;
  // Back (gradient shell round, 2026-11-17): the boolean `back`
  // attribute puts a chevron at the left, wired to (back); it takes
  // the left slot over the menu, a screen shows one or the other.
  const backNode = back ? (onBack ? (
    <Pressable onPress={onBack} hitSlop={4} style={({ pressed }) => [styles.appbarButton, pressed && styles.buttonPressed]}>
      <RgIcon name="chevron-left" size={24} color={iconRole} />
    </Pressable>
  ) : <RgIcon name="chevron-left" size={24} color={iconRole} />) : null;
  const avatarNode = avatar ? (
    <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c.avatar, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: c.onAvatar, fontSize: 12, fontWeight: '600' }}>{String(avatar).charAt(0)}</Text>
    </View>
  ) : null;
  // Action (gradient shell round, 2026-11-17): `actionIcon` names
  // an icon button at the right of the bar, wired to (action); it
  // takes the right slot over the avatar. A lesson bar carries its
  // bookmark here, filled or outline by the icon name the app
  // binds, so the state reads at a glance.
  const actionNode = actionIcon ? (onAction ? (
    <Pressable key="action" onPress={onAction} hitSlop={4} style={({ pressed }) => [styles.appbarButton, pressed && styles.buttonPressed]}>
      <RgIcon name={actionIcon} size={24} color={gradient ? 'onPrimary' : 'primary'} />
    </Pressable>
  ) : <RgIcon key="action" name={actionIcon} size={24} color={gradient ? 'onPrimary' : 'primary'} />) : null;
  // Second action (Option A round, 2026-11-17): `actionIcon2`
  // names a second icon button at the right, wired to (action2),
  // so a bar can carry search and a shortcut side by side. With
  // any action present the avatar steps aside, as before.
  const action2Node = actionIcon2 ? (onAction2 ? (
    <Pressable key="action2" onPress={onAction2} hitSlop={4} style={({ pressed }) => [styles.appbarButton, pressed && styles.buttonPressed]}>
      <RgIcon name={actionIcon2} size={24} color={gradient ? 'onPrimary' : 'primary'} />
    </Pressable>
  ) : <RgIcon key="action2" name={actionIcon2} size={24} color={gradient ? 'onPrimary' : 'primary'} />) : null;
  const leftNode = back ? backNode : menuNode;
  // The two actions travel as one array into the bar's right
  // zone, so both carry keys from birth (phone round,
  // 2026-11-18: React's unique key warning named this array).
  const rightBits = [actionNode, action2Node].filter(Boolean);
  const rightNode = rightBits.length ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>{rightBits}</View>
  ) : avatarNode;
  const titleNode = search
    ? <Text style={[styles.searchText, gradient ? { color: c.onPrimary } : null, titleAlign === 'center' ? styles.appbarTitleCenter : null]}>{search}</Text>
    : <Text style={[styles.appbarTitle, gradient ? { color: c.onPrimary } : null, titleAlign === 'center' ? styles.appbarTitleCenter : null]}>{title}</Text>;
  // Centered title (tutorial round, 2026-11-13): `titleAlign="center"`
  // switches the bar to the standard three zone layout, a fixed
  // width left zone, the title centered in a flex middle zone, and
  // a balancing right zone, so the title sits at the true centre of
  // the bar even with a menu icon at the left. The default (no
  // titleAlign, or "start") renders the plain row.
  // Children (gradient shell round, 2026-11-17): content projected
  // into the bar renders under the title row, inside the bar: a
  // search pill under the title of a gradient shell bar is the
  // shape this exists for. Before this, bar children were dropped.
  // Empty title row (Gmail light round, 2026-11-17): a bar whose
  // whole face is a child (the Gmail shell, a search pill in a
  // plain bar) renders no title row at all, so no empty band sits
  // above the child.
  const hasRow = !!(title || search || leftNode || rightNode);
  const bar = (
    <>
    <View style={[styles.appbar, { flexDirection: 'column', alignItems: 'stretch' }, gradient ? styles.appbarGradient : null, plain ? styles.appbarPlain : null, tint ? styles.appbarTint : null, tint && pin ? { backgroundColor: 'transparent' } : null]}>
      {gradient ? <GradientFill /> : null}
      {hasRow ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
          {titleAlign === 'center' ? (
            <>
              <View style={styles.appbarSide}>{leftNode}</View>
              {titleNode}
              <View style={styles.appbarSideEnd}>{rightNode}</View>
            </>
          ) : (
            <>
              {leftNode}
              {titleNode}
              {rightNode}
            </>
          )}
        </View>
      ) : null}
      {children ? <View style={[styles.appbarChildren, hasRow ? null : { marginTop: 0 }]}>{children}</View> : null}
    </View>
    {progress !== undefined && progress !== null ? (
      <View style={styles.appbarProgressTrack}>
        <View style={[styles.appbarProgressFill, { width: `${Math.min(100, Math.max(0, Number(progress) || 0))}%` }]} />
      </View>
    ) : null}
    </>
  );
  // Pin (gradient shell round, 2026-11-17): with `pin` and a screen
  // above it, the bar registers into the screen's header slot and
  // renders nothing in place; the screen draws it above the scroll.
  // The key carries every prop that changes the bar's face, plus
  // its children's scalar values, so the pinned bar follows a
  // search field's typed text but never loops on a plain re-render.
  const pinKey = pin
    ? [title ?? '', search ?? '', back ? 'back' : '', menu ? 'menu' : '', avatar ?? '', actionIcon ?? '', actionIcon2 ?? '', progress === undefined || progress === null ? '' : String(Math.round(Number(progress) || 0)), titleAlign ?? '', tone ?? '', childrenKeyOf(children)].join('|')
    : '';
  // The chrome colour this bar lends the screen (Option A round,
  // 2026-11-17): the flat bands (tint, plain) lend their
  // background, so the safe area strip above the bar paints the
  // same colour and no seam shows. Other tones lend nothing.
  // A tint bar lends the wash's top stop (seamless round,
  // 2026-11-18), so the status area continues the bar's own
  // gradient from its first step.
  const chrome = tint ? c.washFrom : plain ? c.background : undefined;
  // Registration uses a layout effect (Gmail light round,
  // 2026-11-17): the pinned bar must be in the screen's header
  // slot before the frame paints, or the content paints one frame
  // without its bar and then jumps when the bar lands, the jitter
  // seen on back navigation. A passive effect runs after paint.
  useLayoutEffect(() => {
    if (!pin || !slot) return;
    slot.register(pinKey, bar, chrome, tint);
    return () => slot.clear(pinKey);
  }, [pinKey]);
  if (pin && slot) return null;
  return bar;
}

export function RgIconButton({ name, size = 28, color, onPress, style, tooltip }: any) {
  const styles = stylesFor(useRgTheme());
  const tip = useTooltipBubble(tooltip, styles);
  return (
    <View style={[styles.tooltipWrap, { alignSelf: 'flex-start' }, style]}>
      <Pressable
        onPress={onPress}
        onLongPress={tip.show}
        style={({ pressed }) => [
          styles.iconButton,
          pressed && styles.buttonPressed,
        ]}
      >
        <RgIcon name={name} size={size} color={color} />
      </Pressable>
      {tip.bubble}
    </View>
  );
}

export function RgSection({ children, style, label, meta, icon, plain, onPress }: any) {
  const styles = stylesFor(useRgTheme());
  // Labelled section (gradient shell round, 2026-11-17): a section
  // with a `label` opens with a header row, a short brand gradient
  // bar, the label in the title step, and an optional muted `meta`
  // line at the right (a count, a range). The header is what makes
  // a section title stand out from the rows under it. A section
  // without a label renders exactly as before.
  const head = label ? (
    <View style={styles.sectionHead}>
      {icon ? (
        <View style={styles.sectionChip}>
          <RgIcon name={icon} size={16} color="onPrimary" />
        </View>
      ) : plain ? null : (
        <View style={styles.sectionBar}>
          <GradientFill />
        </View>
      )}
      <Text style={styles.sectionTitle}>{label}</Text>
      {meta ? <Text style={styles.sectionMeta}>{meta}</Text> : null}
    </View>
  ) : null;
  // A section with a (click) is a Pressable, the way a card is
  // (button audit round, 2026-11-18; section round, 2026-11-20):
  // the compiler wires a section (click) to onPress, and the
  // primitive honours it, never drops it silently. The device
  // keys of the tutorial's Pattern A demos are section faces
  // that press, built on this.
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.section, style, pressed && styles.buttonPressed]}>
        {head}
        {children}
      </Pressable>
    );
  }
  return (
    <View style={[styles.section, style]}>
      {head}
      {children}
    </View>
  );
}

export function RgCard({ children, style, onPress }: any) {
  const styles = stylesFor(useRgTheme());
  // A card with a (click) is a Pressable (button audit round,
  // 2026-11-18): the whole card is the tap target, the way a
  // Material card behaves; without one it stays a plain surface.
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.card, style, pressed && styles.buttonPressed]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

export function RgText({ children, variant = 'body', style }: any) {
  const t = useRgTheme();
  const step = (t.typography as any)[variant] ?? t.typography.body;
  return (
    <Text style={[{
      fontSize: step.fontSize, lineHeight: step.lineHeight,
      fontWeight: step.fontWeight, color: t.colors.text,
    }, style]}>
      {children}
    </Text>
  );
}

/**
 * The code block (tutorial round, 2026-11-13): projected text on a
 * dark editor surface in a monospace face, dark in both themes the
 * way editors are. Long lines scroll horizontally inside the
 * block; the preview page mirrors the same choice.
 */
export function RgCode({ children, style }: any) {
  const styles = stylesFor(useRgTheme());
  return (
    <View style={[styles.code, style]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text style={styles.codeText}>{children}</Text>
      </ScrollView>
    </View>
  );
}

/**
 * Tooltip state for the hosts that carry one (Stage 14): a long
 * press shows the bubble, which dismisses itself after a moment.
 * Angular Material's matTooltip, in the mobile form: there is no
 * hover on a phone, so long press is the honest gesture.
 */
function useTooltipBubble(tooltip: unknown, styles: any) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<any>(null);
  const text = tooltip === undefined || tooltip === null ? '' : String(tooltip);
  const show = text
    ? () => {
      setVisible(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setVisible(false), 1800);
    }
    : undefined;
  const bubble = visible && text ? (
    <View style={styles.tooltipBubble} pointerEvents="none">
      <Text style={styles.tooltipText}>{text}</Text>
    </View>
  ) : null;
  return { show, bubble };
}

export function RgButton({ children, disabled, onPress, badge, style, variant, tooltip, color }: any) {
  const theme = useRgTheme();
  const styles = stylesFor(theme);
  const text = variant === 'text';
  // color (the compiler validates it): 'danger' paints the error
  // role, 'neutral' the quiet grey fill; anything else is the
  // primary gradient. The text variant keeps no fill and colours
  // only its label.
  const danger = color === 'danger';
  const neutral = color === 'neutral';
  const labelStyle = text
    ? (danger ? styles.buttonTextDanger : neutral ? styles.buttonTextNeutral : styles.buttonTextLabel)
    : (neutral ? styles.buttonLabelNeutral : styles.buttonLabel);
  // A button the caller sized exactly (a width or a height in
  // its style) gets compact padding and a centred label, so
  // the label can use the size it was given, and the gradient
  // fill follows the caller's corner radius: with the full
  // pill curve the fill draws a circle inside a square button.
  const styleObj = (style && typeof style === 'object' && !Array.isArray(style)) ? style : null;
  const sized = !!styleObj && (typeof styleObj.width === 'number' || typeof styleObj.height === 'number');
  const fillRadius = styleObj && typeof styleObj.borderRadius === 'number' ? styleObj.borderRadius : theme.radius.full;
  const tip = useTooltipBubble(tooltip, styles);
  return (
    <View style={styles.tooltipWrap}>
      <Pressable
        disabled={disabled}
        onPress={onPress}
        onLongPress={tip.show}
        style={({ pressed }) => [
          text ? styles.buttonText : styles.button,
          neutral && !text ? styles.buttonNeutral : null,
          sized && !text ? styles.buttonSized : null,
          pressed && styles.buttonPressed,
          disabled && styles.buttonDisabled,
          style,
        ]}
      >
        {text || neutral ? null : danger ? <ButtonFill top={theme.colors.danger} bottom={theme.colors.danger} radius={fillRadius} /> : <ButtonFill radius={fillRadius} />}
        <Text style={[labelStyle, sized && !text ? styles.buttonLabelSized : null]}>{children}</Text>
        <BadgeDot value={badge} styles={styles} offset={{ top: -6, right: -6 }} />
      </Pressable>
      {tip.bubble}
    </View>
  );
}

/**
 * One text field with the Material form field look (Stage 8): a label
 * above the field, an outlined box from the tokens, and an error line
 * under the field in the error colour. This is what template <input>
 * elements compile to, template-driven (ngModel) and reactive
 * (formControlName) alike. The value is controlled: the owner passes
 * `value` in and receives the next text through onChangeText, exactly
 * the contract the compiler wires for [(ngModel)] and FormControls.
 * `secure` is the password form of the template's type attribute;
 * keyboardType passes the template's email/number choice through.
 */
// Keyboard dismissal (lessons QA round, 2026-11-19): fields
// carry no input accessory. An earlier round added an iOS Done
// accessory, first as a bar, then as a bare Done at the
// keyboard's top right; Bigyan removed it at his word, because
// the stock keyboard's own return key already dismisses. Every
// field here uses returnKeyType="done" and dismisses on submit.

// Keyboard lift (lessons QA round 2, 2026-11-19): a field
// does not scroll itself. On focus it hands its node to the
// screen through RgScrollContext, and the screen performs the
// calculated lift: keyboard height from the keyboard events,
// the field measured in the window, a scroll of exactly the
// overlap. If the keyboard is already up, the screen lifts at
// once; if it is still rising, its show event triggers the
// lift. On web there is no keyboard and the call does nothing.
function useKeyboardLift(): (node: any) => void {
  const control = useContext(RgScrollContext);
  const overlayControl = useContext(RgOverlayLiftContext);
  return (node: any): void => {
    if (!node || Platform.OS === 'web') return;
    // A field lives in the scroll body or in an overlay, never
    // both; each control is null outside its own home.
    control?.requestLift?.(node);
    overlayControl?.requestLift?.(node);
  };
}

export function RgInput({ value, onChangeText, onBlur, onFocus, placeholder, label, error, disabled, secure, keyboardType, options, onOptionSelected, mask, variant, leadingIcon, onLeading, avatarText, pillTone, style }: any) {
  const t = useRgTheme();
  const styles = stylesFor(t);
  // Autocomplete (Stage 11): while the field is focused and its text
  // is non-empty, a panel under the field lists the options whose
  // text contains the typed text (case-insensitive substring match,
  // the filter Angular Material's own autocomplete example uses).
  // Choosing one writes it back through onChangeText, so an
  // [(ngModel)] binding updates exactly as if it were typed, and
  // reports the choice through onOptionSelected.
  const [focused, setFocused] = useState(false);
  const pillRef = useRef<any>(null);
  const fieldRef = useRef<any>(null);
  const liftAboveKeyboard = useKeyboardLift();
  const text = value === undefined || value === null ? '' : String(value);
  const matches = focused && Array.isArray(options) && text !== ''
    ? options.filter((o: unknown) => typeof o === 'string' && o.toLowerCase().includes(text.toLowerCase()))
    : [];
  const choose = (option: string): void => {
    // Selection happens on press-in: it fires before the field's
    // blur, so the panel cannot close under the tap.
    onChangeText?.(option);
    onOptionSelected?.(option);
    setFocused(false);
  };
  // Search pill (gradient shell round, 2026-11-17): variant="search"
  // draws the field as a full radius surface with the search icon
  // inside at the left and no border of its own, the shape search
  // takes in the Google apps and in a gradient shell bar. The value
  // contract is the same field contract: value in, onChangeText out.
  if (variant === 'search') {
    return (
      <View style={style}>
        {label ? <Text style={styles.inputLabel}>{label}</Text> : null}
        {/* The whole pill is the tap target (phone round,
            2026-11-18): the pill used to be a plain row holding
            the field, so taps on its padding and its icon zone
            landed on dead views and the bar felt rarely
            clickable. The row is a Pressable now and focuses the
            field wherever it is tapped; the field keeps its own
            taps, and a leading action keeps its own button. */}
        <Pressable
          onPress={() => { if (!disabled) pillRef.current?.focus(); }}
          style={({ pressed }) => [styles.inputPill, pillTone === 'white' ? { backgroundColor: t.colors.surface } : null, pressed && styles.buttonPressed]}
        >
          {leadingIcon ? (
            <Pressable onPress={onLeading} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }} style={({ pressed }) => [styles.inputPillLeading, pressed && styles.buttonPressed]}>
              <RgIcon name={leadingIcon} size={20} color="textMuted" />
            </Pressable>
          ) : (
            <RgIcon name="search" size={20} color="textMuted" />
          )}
          <TextInput
            ref={pillRef}
            style={styles.inputPillField}
            value={value}
            onChangeText={onChangeText}
            onFocus={() => { setFocused(true); liftAboveKeyboard(pillRef.current); onFocus?.(); }}
            onBlur={() => { setFocused(false); onBlur?.(); }}
            onSubmitEditing={() => Keyboard.dismiss()}
            returnKeyType="done"
            placeholder={placeholder}
            placeholderTextColor={t.colors.textMuted}
            editable={!disabled}
          />
          {text !== '' && !disabled ? (
            <Pressable
              onPress={() => { onChangeText?.(''); pillRef.current?.focus(); }}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityLabel="Clear search"
              style={({ pressed }) => [styles.inputPillLeading, pressed && styles.buttonPressed]}
            >
              <RgIcon name="close" size={18} color="textMuted" />
            </Pressable>
          ) : null}
          {avatarText ? (
            <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: t.colors.primary, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: t.colors.onPrimary, fontSize: 14, fontWeight: '700' }}>{String(avatarText).charAt(0)}</Text>
            </View>
          ) : null}
        </Pressable>
        {error ? <Text style={styles.inputError}>{error}</Text> : null}
      </View>
    );
  }
  return (
    <View style={[styles.inputWrap, style]}>
      {label ? <Text style={styles.inputLabel}>{label}</Text> : null}
      <View style={styles.inputAnchor}>
        <TextInput
          ref={fieldRef}
          style={[styles.inputField, error ? styles.inputFieldError : null, disabled ? styles.inputDisabled : null]}
          value={mask ? applyMask(text, String(mask)) : value}
          onChangeText={mask
            ? (next: string) => onChangeText?.(applyMask(next, String(mask)))
            : onChangeText}
          onFocus={() => { setFocused(true); liftAboveKeyboard(fieldRef.current); onFocus?.(); }}
          onBlur={() => { setFocused(false); onBlur?.(); }}
          placeholder={placeholder}
          placeholderTextColor={t.colors.textMuted}
          editable={!disabled}
          secureTextEntry={!!secure}
          keyboardType={keyboardType}
          onSubmitEditing={() => Keyboard.dismiss()}
          returnKeyType="done"
        />
        {matches.length ? (
          <View style={styles.autoPanel}>
            {matches.map((option: string) => (
              <Pressable key={option} onPressIn={() => choose(option)} style={styles.autoOption}>
                <Text style={styles.autoOptionText}>{option}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
      {error ? <Text style={styles.inputError}>{error}</Text> : null}
    </View>
  );
}

// Selection haptic (Gmail light round, 2026-11-17; shared with
// the bottom nav, 2026-11-18): a control with the `haptic`
// attribute answers a selection with a light selection haptic,
// the native feel: a switch on toggle, a bottom nav on a tab
// change. The module is required lazily inside the press, the
// file picker pattern, which makes expo-haptics a required
// dependency of apps on @rangular-framework/ui (the scaffold writes it);
// an app that somehow lacks it simply stays silent.
function fireSelectionHaptic(): void {
  try {
    const Haptics = require('expo-haptics');
    if (Haptics && typeof Haptics.selectionAsync === 'function') {
      void Haptics.selectionAsync();
    }
  } catch {
    // No haptics module in this app: the switch stays silent.
  }
}

export function RgSwitch({ checked, disabled, haptic, color, onChange, children, style }: any) {
  const t = useRgTheme();
  const c = t.colors;
  const styles = stylesFor(t);
  const isOn = !!checked;
  // The colour role names the on colour, never a paint: primary
  // is the theme primary, success the theme success green. Off
  // is the surface variant grey either way.
  const onColor = color === 'success' ? c.success : c.primary;
  const progress = useRef(new Animated.Value(isOn ? 1 : 0)).current;

  // Motion rule: the knob only ever moves toward its target. A plain
  // linear timing move is used, never a spring, so the knob cannot
  // overshoot its target or bounce back past it.
  useEffect(() => {
    progress.stopAnimation();
    Animated.timing(progress, {
      toValue: isOn ? 1 : 0,
      duration: 160,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
  }, [isOn, progress]);

  const trackColor = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [c.surfaceVariant, onColor],
  });
  const knobShift = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [2, 22],
  });

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: isOn, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => { if (haptic) fireSelectionHaptic(); onChange?.(!isOn); }}
      style={[styles.controlRow, disabled && styles.controlDisabled, style]}
    >
      <Animated.View
        style={[
          styles.switchTrack,
          { backgroundColor: trackColor, borderColor: isOn ? onColor : c.outline },
        ]}
      >
        <Animated.View
          style={[
            styles.switchKnob,
            isOn ? undefined : styles.switchKnobOff,
            { transform: [{ translateX: knobShift }] },
          ]}
        />
      </Animated.View>
      {children ? <Text style={styles.controlLabel}>{children}</Text> : null}
    </Pressable>
  );
}

export function RgCheckbox({ checked, disabled, onChange, children, style }: any) {
  const styles = stylesFor(useRgTheme());
  const isOn = !!checked;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: isOn, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => onChange?.(!isOn)}
      style={[styles.controlRow, disabled && styles.controlDisabled, style]}
    >
      <View style={[styles.checkboxBox, isOn && styles.checkboxBoxOn]}>
        {isOn ? <RgIcon name="check" size={20} color="onPrimary" /> : null}
      </View>
      {children ? <Text style={styles.controlLabel}>{children}</Text> : null}
    </Pressable>
  );
}

/** Marker for one segment of RgSwitcher. The parent reads its props. */
export function RgOption({ value, children }: any) {
  void value;
  void children;
  return null;
}

export function RgSwitcher({ value, disabled, onChange, children, style }: any) {
  const styles = stylesFor(useRgTheme());
  const options = React.Children.toArray(children)
    .filter((child) => React.isValidElement(child))
    .map((child) => {
      const el = child as React.ReactElement<any>;
      return { value: el.props.value, label: el.props.children };
    });
  return (
    <View style={[styles.switcher, disabled && styles.controlDisabled, style]}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={`${String(option.value)}-${index}`}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled: !!disabled }}
            disabled={disabled}
            onPress={() => onChange?.(option.value)}
            style={[styles.switcherSegment, selected && styles.switcherSegmentSelected]}
          >
            <Text style={[styles.switcherLabel, selected && styles.switcherLabelSelected]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Marker for one choice in RgRadioGroup. The parent reads its props. */
export function RgRadio({ value, children }: any) {
  void value;
  void children;
  return null;
}

export function RgRadioGroup({ value, disabled, onChange, children, style }: any) {
  const styles = stylesFor(useRgTheme());
  const options = React.Children.toArray(children)
    .filter((child) => React.isValidElement(child))
    .map((child) => {
      const el = child as React.ReactElement<any>;
      return { value: el.props.value, label: el.props.children };
    });
  return (
    <View style={style}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={`${String(option.value)}-${index}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, disabled: !!disabled }}
            disabled={disabled}
            onPress={() => onChange?.(option.value)}
            style={[styles.controlRow, disabled && styles.controlDisabled]}
          >
            <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
              {selected ? <View style={styles.radioDot} /> : null}
            </View>
            <Text style={styles.controlLabel}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function RgList({ data, renderItem, keyExtractor, children, refreshing, onRefresh, onEndReached }: any) {
  const onScroll = useRef(endReachedScrollHandler(onEndReached)).current;
  // Generated code (Stage 2) renders rows as children, e.g. a *ngFor map,
  // rather than via FlatList's data/renderItem. Support both shapes.
  // Stage 15: a list that refreshes or pages becomes its own
  // scroller (RefreshControl plus the shared end-reached handler);
  // a plain list stays a plain View inside the screen's scroll.
  if (children) {
    // Hairlines live between rows, never under the last one
    // (seamless round, 2026-11-18): a closing hairline under a
    // list's final row floats over whatever follows (a section
    // gap, a card edge) and reads as a seam, so the list marks
    // its last row child and the row drops its bottom border.
    const kids = React.Children.toArray(children);
    const lastIdx = kids.length - 1;
    const marked = kids.map((k, i) => (
      i === lastIdx && React.isValidElement(k) && (k as React.ReactElement<any>).type === RgRow
        ? React.cloneElement(k as React.ReactElement<any>, { lastInList: true })
        : k
    ));
    if (onRefresh || onEndReached) {
      return (
        <ScrollView
          refreshControl={onRefresh
            ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} />
            : undefined}
          onScroll={onEndReached ? onScroll : undefined}
          scrollEventThrottle={64}
        >
          {marked}
        </ScrollView>
      );
    }
    return <View>{marked}</View>;
  }
  return (
    <FlatList
      data={data}
      renderItem={renderItem}
      keyExtractor={keyExtractor ?? ((item: any, index: number) => String(item?.id ?? index))}
      refreshControl={onRefresh
        ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} />
        : undefined}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.4}
    />
  );
}

/** Marker for one swipe action of an RgRow. The row reads its props. */
export function RgRowAction({ label, icon, color, children }: any) {
  void label;
  void icon;
  void color;
  void children;
  return null;
}

/** The swipe actions a row's children declare (Stage 15), in order. */
function rowActionsOf(children: unknown): { label: string; icon?: string; color?: string; onPress?: () => void }[] {
  return React.Children.toArray(children as any)
    .filter((child) => React.isValidElement(child))
    .filter((child) => (child as React.ReactElement<any>).type === RgRowAction)
    .map((child) => {
      const el = child as React.ReactElement<any>;
      return {
        label: el.props.label !== undefined ? String(el.props.label) : declarationText(el.props.children),
        icon: el.props.icon,
        color: el.props.color,
        onPress: el.props.onPress,
      };
    });
}

/**
 * A row with swipe actions (Stage 15), internal: the actions sit in
 * a tray behind the row's end edge, and a horizontal pan slides the
 * row over them (a plain timing settle, the house motion rule, no
 * spring, so the row cannot overshoot the tray). A tap still works:
 * the responder only claims a gesture that is clearly more
 * horizontal than vertical. Choosing an action runs it and closes
 * the row. The sliding content carries the screen background, the
 * surface lists sit on; a row with actions belongs in a list, not
 * inside a card.
 */
function SwipeRow({ actions, children }: any) {
  const t = useRgTheme();
  const styles = stylesFor(t);
  const trayWidth = actions.length * 72;
  const shift = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);
  const settle = (open: boolean): void => {
    openRef.current = open;
    Animated.timing(shift, {
      toValue: open ? -trayWidth : 0, duration: 160,
      easing: Easing.linear, useNativeDriver: false,
    }).start();
  };
  const responder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_e: any, g: any) =>
      Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderMove: (_e: any, g: any) => {
      const base = openRef.current ? -trayWidth : 0;
      shift.setValue(Math.min(0, Math.max(-trayWidth, base + g.dx)));
    },
    onPanResponderRelease: (_e: any, g: any) => {
      const base = openRef.current ? -trayWidth : 0;
      settle(base + g.dx < -trayWidth / 2);
    },
    onPanResponderTerminate: () => settle(openRef.current),
  })).current;
  return (
    <View style={styles.rowWrap}>
      <View style={styles.swipeTray}>
        {actions.map((a, i) => {
          const bg = a.color
            ? ((t.colors as unknown as Record<string, string>)[a.color] ?? a.color)
            : undefined;
          return (
            <Pressable
              key={i}
              style={[styles.swipeAction, bg ? { backgroundColor: bg } : null]}
              onPress={() => { settle(false); a.onPress?.(); }}
              accessibilityRole="button"
            >
              {a.icon ? <RgIcon name={a.icon} size={24} color="onPrimary" /> : null}
              {a.label ? <Text style={styles.swipeActionLabel}>{a.label}</Text> : null}
            </Pressable>
          );
        })}
      </View>
      <Animated.View
        style={{ transform: [{ translateX: shift }], backgroundColor: t.colors.background }}
        {...responder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}

export function RgRow({ title, subtitle, detail, time, avatar, avatarText, avatarTone, icon, actionIcon, onAction, onPress, badge, tooltip, selected, children, lastInList }: any) {
  const t = useRgTheme();
  const c = t.colors;
  const styles = stylesFor(t);
  const tip = useTooltipBubble(tooltip, styles);
  // Avatar text and row action (gradient shell round, 2026-11-17):
  // `avatarText` overrides the avatar circle's letter with the text
  // the app passes (a lesson number, a count), and `actionIcon`
  // names a trailing icon button wired to (action), the row's own
  // button beside its navigation press: a bookmark on a lesson row,
  // filled or outline by the icon name the app binds.
  const avatarLabel = avatarText !== undefined && avatarText !== null && String(avatarText) !== ''
    ? String(avatarText).slice(0, 2)
    : (title || '\u2022').charAt(0);
  // Varied avatar tones (Gmail light round, 2026-11-17): with
  // avatarTone="varied" the avatar circle takes a pastel pair from
  // the shared palette, chosen by a stable hash of its label, the
  // Gmail list look where each row's tile carries its own tint.
  const tonePair = avatarTone === 'varied'
    ? AVATAR_TONES[[...avatarLabel].reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % AVATAR_TONES.length]
    : avatarTone ? AVATAR_TONE_NAMES[avatarTone] ?? null : null;
  const content = (
    <>
            {icon ? (
        <RgIcon name={icon} size={22} color="textMuted" />
      ) : avatar ? (
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: tonePair ? tonePair.bg : c.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: tonePair ? tonePair.fg : c.onPrimary, fontSize: avatarLabel.length > 1 ? 13 : 16, fontWeight: '600' }}>{avatarLabel}</Text>
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        {title ? <Text style={styles.rowTitle}>{title}</Text> : null}
        {subtitle ? <Text style={styles.rowSub}>{subtitle}</Text> : null}
        {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
        {children}
      </View>
      {time ? <Text style={{ fontSize: 11, color: c.textMuted }}>{time}</Text> : null}
      <BadgeDot value={badge} styles={styles} offset={{ top: 8, right: 0 }} />
      {actionIcon ? (
        <Pressable onPress={onAction} style={({ pressed }) => [styles.rowAction, pressed && { opacity: 0.6 }]}>
          <RgIcon name={actionIcon} size={20} color="primary" />
        </Pressable>
      ) : null}
    </>
  );
  // A row with an onPress (a (click) handler or a routerLink in the
  // template) is a Pressable; a row without one stays a plain View, so
  // static lists pay nothing for the affordance. A tooltip makes the
  // row a Pressable too, for the long press that shows the bubble.
  let inner: React.ReactNode;
  if (onPress || tip.show) {
    inner = (
      <View style={styles.tooltipWrap}>
        <Pressable onPress={onPress} onLongPress={tip.show} style={({ pressed }: any) => [styles.row, selected && styles.rowSelected, lastInList && { borderBottomWidth: 0 }, pressed && { opacity: 0.7 }]}>
          {content}
        </Pressable>
        {tip.bubble}
      </View>
    );
  } else {
    inner = <View style={[styles.row, selected && styles.rowSelected, lastInList && { borderBottomWidth: 0 }]}>{content}</View>;
  }
  // Swipe actions (Stage 15): <row-action> declarations among the
  // row's children turn the row into a SwipeRow; the declarations
  // themselves render nothing in the content (the marker is null).
  const actions = rowActionsOf(children);
  if (!actions.length) return inner;
  return <SwipeRow actions={actions}>{inner}</SwipeRow>;
}

/**
 * The router outlet (Stage 9). The generated root component renders the
 * matched route component inside it; the outlet itself is a transparent
 * wrapper (a fragment), because the navigation state and the route
 * matching live in the generated component and the runtime navigator,
 * not in a visual primitive. It exists as a named primitive so the
 * tag-to-primitive contract stays complete in the catalog.
 */
export function RgOutlet({ children }: any) {
  return <>{children}</>;
}

export function RgFab({ children, label, onPress }: any) {
  const styles = stylesFor(useRgTheme());
  return (
    <Pressable style={styles.fab} onPress={onPress}>
      <Text style={styles.fabLabel}>{children ?? label ?? 'Compose'}</Text>
    </Pressable>
  );
}

/**
 * The bottom sheet (Stage 10), the declarative twin of Angular
 * Material's MatBottomSheet: the template writes
 * `<sheet [open]="sheetOpen" (close)="closeSheet()">` and the sheet
 * renders its children in a panel that slides up over a dimmed
 * backdrop. A backdrop tap calls onClose; the author closes the sheet
 * from a method (or opens it) by changing the bound field. With no
 * `open` prop at all the sheet is simply shown, the static form; the
 * compiler warns (GEN_OVERLAY_OPEN) so the choice is never silent.
 *
 * The implementation is Modal-free: an absolute overlay inside the
 * screen, so it composes with the screen's own layout and theme. The
 * motion is a plain timing slide and fade, never a spring, so the
 * panel cannot overshoot its resting place.
 */
export function RgSheet({ open, onClose, children, style }: any) {
  const t = useRgTheme();
  const styles = stylesFor(t);
  const isOpen = open === undefined ? true : open === 'false' ? false : !!open;
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isOpen) {
      progress.setValue(0);
      Animated.timing(progress, {
        toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true,
      }).start();
    }
  }, [isOpen, progress]);

  const backdropOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.32] });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [260, 0] });
  const tree = (
    <View style={styles.overlayRoot}>
      <Animated.View style={[styles.overlayBackdrop, { opacity: backdropOpacity }]}>
        <Pressable style={styles.overlayFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View style={[styles.sheetPanel, { transform: [{ translateY }] }, style]}>
        <View style={styles.sheetHandle} />
        {children}
      </Animated.View>
    </View>
  );
  const slotted = useRgOverlay(tree, isOpen);
  if (!isOpen) return null;
  return slotted ? null : tree;
}

/**
 * The dialog (Stage 10), the declarative twin of Angular Material's
 * MatDialog: `<dialog [open]="confirmOpen" (close)="closeConfirm()"
 * title="Delete this reminder?">` renders a centred card over a
 * dimmed backdrop, the title as its heading and the children as its
 * content (buttons usually grouped in an <actions> row). A backdrop
 * tap calls onClose; the buttons call author methods, which close
 * the dialog by changing the bound field. With no `open` prop the
 * dialog is simply shown, as with RgSheet, and the compiler warns.
 * The entrance is a quick fade and settle, never a spring.
 */
export function RgDialog({ open, onClose, title, children, style }: any) {
  const t = useRgTheme();
  const styles = stylesFor(t);
  const isOpen = open === undefined ? true : open === 'false' ? false : !!open;
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isOpen) {
      progress.setValue(0);
      Animated.timing(progress, {
        toValue: 1, duration: 150, easing: Easing.out(Easing.quad), useNativeDriver: true,
      }).start();
    }
  }, [isOpen, progress]);

  const backdropOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.32] });
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] });
  const tree = (
    <View style={styles.overlayRootCenter}>
      <Animated.View style={[styles.overlayBackdrop, { opacity: backdropOpacity }]}>
        <Pressable style={styles.overlayFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View style={[styles.dialogPanel, { opacity: progress, transform: [{ scale }] }, style]}>
        {title ? <Text style={styles.dialogTitle}>{title}</Text> : null}
        {children}
      </Animated.View>
    </View>
  );
  const slotted = useRgOverlay(tree, isOpen);
  if (!isOpen) return null;
  return slotted ? null : tree;
}

/**
 * A right-aligned row of action buttons (Stage 10), the layout
 * Angular Material dialogs and sheets put their buttons in. It only
 * arranges its children; the buttons keep their own behaviour.
 * Buttons carry no horizontal margins of their own (the screen grid
 * and container padding own every inset), so they sit directly in
 * the row's gap rhythm.
 */
export function RgActions({ children, style }: any) {
  const styles = stylesFor(useRgTheme());
  return <View style={[styles.actions, style]}>{children}</View>;
}

/**
 * The snackbar (Stage 10): a dark floating pill at the bottom of the
 * screen with a message and an optional action, the rendering of
 * Angular Material's MatSnackBar. It is not written in templates;
 * the generated root renders it while the runtime SnackBar service
 * has a bar open, and pressing the action calls onAction, which the
 * host wires to the service (the service dismisses the bar and fires
 * the ref's callbacks). Auto-dismiss after the bar's duration is the
 * service's job, not the primitive's.
 */
export function RgSnackbar({ message, actionLabel, onAction, style }: any) {
  const styles = stylesFor(useRgTheme());
  // The toast card (see the snackbarHost style): a full width host
  // centers the card at the bottom; the sheen layer is the React
  // Native approximation of the grain the HTML previews draw.
  return (
    <View style={styles.snackbarHost} pointerEvents="box-none">
      <View style={[styles.snackbar, style]}>
        <View style={styles.snackbarSheen} pointerEvents="none">
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id="rgtoastgrain" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="rgba(255, 255, 255, 1)" stopOpacity={0.14} />
                <Stop offset="0.55" stopColor="rgba(255, 255, 255, 1)" stopOpacity={0.05} />
                <Stop offset="1" stopColor="rgba(255, 255, 255, 1)" stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#rgtoastgrain)" />
          </Svg>
        </View>
        <Text style={styles.snackbarText}>{message}</Text>
        {actionLabel ? (
          <Pressable onPress={onAction} accessibilityRole="button">
            <Text style={styles.snackbarAction}>{String(actionLabel).toUpperCase()}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const WHEEL_ITEM_HEIGHT = 40;

/**
 * One iOS style wheel column (Stage 10), internal to the date-time
 * picker: a snapping scroll column, five rows tall, whose selected
 * value sits centred between two hairlines while the rows above and
 * below are muted. Scrolling to rest selects the centred value;
 * tapping a row selects it directly. Rolling ticks one selection
 * haptic per row that passes the centre, and a tap that changes the
 * value ticks once. The wheel's values and the selection math come
 * from ./datetime, shared with the preview.
 */
// One wheel row, memoized (iOS gesture rules round, 2026-11-20):
// a centre change re-renders only the row that left the centre
// and the row that entered it, never the whole wheel. The year
// wheel carries 301 rows; re-rendering all of them on every row
// crossed saturated the JS thread at speed, the bold lagged the
// real centre and the roll felt crazy on a fast flick (his
// phone report). Rows receive only their own label, their
// selected flag and a stable press callback, so memo holds.
const WheelRow = React.memo(function WheelRow({ label, selected, onPressRow, styles }: any) {
  return (
    <Pressable onPress={onPressRow} style={styles.wheelItem}>
      <Text style={[styles.wheelText, selected ? styles.wheelTextSelected : null]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
});

function RgWheel({ options, value, onSelect, wide }: any) {
  const styles = stylesFor(useRgTheme());
  const selectedIndex = Math.max(0, options.findIndex((o: WheelSpec['options'][number]) => o.value === value));
  const scrollRef = useRef<any>(null);
  // The last row the roll ticked for (his rule, 2026-11-19: rolling
  // through the picker ticks a selection haptic, one per row that
  // passes the centre, the iOS wheel feel). Programmatic centring
  // updates the mark without ticking.
  const tickedIndexRef = useRef(selectedIndex);
  // The last index this wheel committed itself (iOS gesture
  // rules round, 2026-11-20, from his 2025-2026-2025-2026 phone
  // report). The old wheel committed on drag end, mid-flight,
  // and an effect then hard-scrolled to the committed row on
  // EVERY value change, including its own commits: the wheel
  // teleported mid-momentum, the snap settled a hair across the
  // boundary, the next commit flipped the value back, and each
  // flip ticked. A native picker never repositions the wheel
  // for its own selection. So: commits mark this ref first, and
  // the centring effect scrolls only when the value changed
  // from outside (the picker opened, a sibling wheel clamped
  // the day), which is exactly when the two disagree. It starts
  // at -1 so the first run still centres the wheel on open.
  const committedIndexRef = useRef(-1);
  // True while a tapped row animates to the centre: the roll
  // still moves the bold, but rows the animation merely passes
  // never tick and never commit; the tapped row already did.
  const animatingRef = useRef(false);

  useEffect(() => {
    if (selectedIndex === committedIndexRef.current) return;
    committedIndexRef.current = selectedIndex;
    tickedIndexRef.current = selectedIndex;
    setCenterIndex(selectedIndex);
    scrollRef.current?.scrollTo({ y: selectedIndex * WHEEL_ITEM_HEIGHT, animated: false });
  }, [selectedIndex]);

  // The bold row follows the CENTRE while the wheel rolls, not
  // the committed value: on a long wheel (the year wheel, 301
  // rows) a value-bound bold row visibly rode away toward the
  // top or bottom during a flick (his phone report, 2026-11-20).
  // Short wheels travelled too little to show it.
  const [centerIndex, setCenterIndex] = useState(selectedIndex);
  const tickWhileRolling = (offsetY: number): void => {
    const idx = Math.min(options.length - 1, Math.max(0, Math.round(offsetY / WHEEL_ITEM_HEIGHT)));
    if (animatingRef.current) {
      setCenterIndex(idx);
      return;
    }
    if (idx !== tickedIndexRef.current) {
      tickedIndexRef.current = idx;
      setCenterIndex(idx);
      fireSelectionHaptic();
    }
  };

  // Commit once per gesture, at rest (iOS gesture rules round,
  // 2026-11-20). Momentum end is the rest that matters: the
  // snap has landed the offset exactly on a row multiple, so
  // the rounded index is stable and can never alternate. Drag
  // end commits only when the wheel is already resting exactly
  // on a row (a slow drag released without momentum); a
  // mid-flight release commits nothing and waits for momentum
  // end. Every commit marks committedIndexRef before reporting,
  // so the centring effect never answers a self-caused change.
  const commitAt = (idx: number): void => {
    committedIndexRef.current = idx;
    const opt = options[idx];
    if (opt && opt.value !== value) onSelect?.(opt.value);
  };
  const selectAtRest = (offsetY: number): void => {
    animatingRef.current = false;
    const idx = Math.min(options.length - 1, Math.max(0, Math.round(offsetY / WHEEL_ITEM_HEIGHT)));
    tickedIndexRef.current = idx;
    commitAt(idx);
  };
  const selectAtDragEnd = (offsetY: number): void => {
    if (Math.abs(offsetY - Math.round(offsetY / WHEEL_ITEM_HEIGHT) * WHEEL_ITEM_HEIGHT) < 1) selectAtRest(offsetY);
  };
  // A tapped row is a deliberate selection outside any scroll
  // gesture: commit it, tick once if it changed the value, and
  // centre it smoothly, the way a native picker does.
  const tapRow = (idx: number): void => {
    committedIndexRef.current = idx;
    tickedIndexRef.current = idx;
    setCenterIndex(idx);
    animatingRef.current = true;
    scrollRef.current?.scrollTo({ y: idx * WHEEL_ITEM_HEIGHT, animated: true });
    const opt = options[idx];
    if (opt && opt.value !== value) {
      fireSelectionHaptic();
      onSelect?.(opt.value);
    }
  };

  return (
    <View style={[styles.wheel, wide ? { flex: 1.6 } : { flex: 1 }]}>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ITEM_HEIGHT}
        decelerationRate="fast"
        onScroll={(e: any) => tickWhileRolling(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
        onScrollBeginDrag={() => { animatingRef.current = false; }}
        onScrollEndDrag={(e: any) => selectAtDragEnd(e.nativeEvent.contentOffset.y)}
        onMomentumScrollEnd={(e: any) => selectAtRest(e.nativeEvent.contentOffset.y)}
        contentContainerStyle={{ paddingVertical: WHEEL_ITEM_HEIGHT * 2 }}
      >
        {options.map((o: WheelSpec['options'][number], i: number) => (
          <WheelRow key={o.value} label={o.label} selected={i === Math.min(centerIndex, options.length - 1)} onPressRow={() => tapRow(i)} styles={styles} />
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * The date-time picker (Stage 10), Rangular's adaptation of the
 * Angular Material datepicker. Material's datepicker is an input
 * with a calendar popup; a phone has no calendar popup culture, so
 * the picker is its own block:
 *
 *   <datetime-picker label="When" mode="datetime" [value]="when"
 *     (change)="onWhen($event)"></datetime-picker>
 *
 * PRODUCT RULE (Bigyan's standing order): the picker looks and
 * behaves like the iOS wheel picker on every platform. Never a
 * calendar grid, never an Android style dialog. The field row shows
 * the formatted value; tapping it opens the wheels centred in a
 * modal dialog (date mode: year, month, day; time mode: hour 1 to
 * 12, minute, AM/PM; datetime mode: the date wheels, then the
 * time wheels, in two steps). Done commits the pending value through
 * onChange as an ISO string; Cancel discards it. `value` accepts
 * an ISO string or a Date; an unparseable value falls back to the
 * current time. minuteInterval is 1 or 5 (the compiler snaps
 * anything else). The wheels always open centred in a modal
 * dialog; the picker takes no presentation (the sheet form was
 * removed on 2026-11-20 at Bigyan's word: superfluous). Datetime
 * mode never mixes the two in one panel: it opens the date step
 * first (the year, month and day wheels, with a Next button),
 * then the time step (hour, minute and AM/PM wheels, with Back
 * and Done), two separate modals in sequence.
 */
export function RgDateTimePicker({ value, mode = 'datetime', label, minuteInterval = 1, onChange, style }: any) {
  const t = useRgTheme();
  const styles = stylesFor(t);
  const pickerMode: PickerMode = mode === 'date' || mode === 'time' ? mode : 'datetime';
  const interval = minuteInterval === 5 ? 5 : 1;
  const current: DateTimeParts = parseDateTimeValue(value) ?? nowParts();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<DateTimeParts>(current);
  // Datetime opens in two separate steps (his rule, 2026-11-19):
  // the date modal first, then the time modal, never all the
  // wheels in one panel. Date and time modes are a single step.
  const [step, setStep] = useState<'date' | 'time'>('date');

  const start = (): void => {
    // The wheel cannot rest between steps: with a 5 minute interval
    // a value like 9:03 opens on the nearest step, and Done emits
    // that step even if the minute wheel itself is never touched.
    const snap = interval === 5 ? 5 : 1;
    const minute = Math.min(60 - snap, Math.round(current.minute / snap) * snap);
    setPending({ ...current, minute });
    setStep('date');
    setOpen(true);
  };
  const done = (): void => {
    setOpen(false);
    onChange?.(composeDateTimeIso(pending));
  };
  const cancel = (): void => setOpen(false);
  const wheels: WheelSpec[] = dateTimeWheels(pending, pickerMode, interval);
  const twoStep = pickerMode === 'datetime';
  const shownWheels = twoStep
    ? wheels.filter((w) => (step === 'date'
      ? w.name === 'month' || w.name === 'day' || w.name === 'year'
      : w.name === 'hour' || w.name === 'minute' || w.name === 'ampm'))
    : wheels;
  const pickerBody = (
    <>
      <View style={styles.pickerHead}>
        {twoStep && step === 'time' ? (
          <Pressable onPress={() => setStep('date')} accessibilityRole="button">
            <Text style={styles.pickerHeadBtn}>Back</Text>
          </Pressable>
        ) : (
          <Pressable onPress={cancel} accessibilityRole="button">
            <Text style={styles.pickerHeadBtn}>Cancel</Text>
          </Pressable>
        )}
        <Text style={styles.pickerHeadTitle}>{label ?? 'Choose'}</Text>
        {twoStep && step === 'date' ? (
          <Pressable onPress={() => setStep('time')} accessibilityRole="button">
            <Text style={[styles.pickerHeadBtn, styles.pickerHeadDone]}>Next</Text>
          </Pressable>
        ) : (
          <Pressable onPress={done} accessibilityRole="button">
            <Text style={[styles.pickerHeadBtn, styles.pickerHeadDone]}>Done</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.wheelsWrap}>
        <View style={styles.wheelsRow}>
          {shownWheels.map((wheel) => (
            <RgWheel
              key={wheel.name}
              options={wheel.options}
              value={wheel.value}
              wide={false}
              onSelect={(v: string) => setPending((p: DateTimeParts) => applyWheelValue(p, wheel.name, v))}
            />
          ))}
        </View>
        <View pointerEvents="none" style={[styles.pickerCenterLine, styles.pickerCenterLineTop]} />
        <View pointerEvents="none" style={[styles.pickerCenterLine, styles.pickerCenterLineBottom]} />
      </View>
    </>
  );

  return (
    <View style={[styles.inputWrap, style]}>
      {label ? <Text style={styles.inputLabel}>{label}</Text> : null}
      <Pressable onPress={start} style={styles.pickerBox} accessibilityRole="button">
        <Text style={styles.pickerValue}>{formatDateTimeValue(current, pickerMode)}</Text>
        <RgIcon name="calendar" size={20} color="textMuted" />
      </Pressable>
      <RgDialog open={open} onClose={cancel}>{pickerBody}</RgDialog>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Stage 11: data display.
//
// Tabs, expansion panels with single-open accordion coordination, a
// declarative table, a slider, progress bar and spinner, chips, and
// the badge dot (badgeTextOf and BadgeDot live near RgIcon above,
// where the first badge host is). Like the Stage 6 controls, the
// group primitives read their declaration children: a tab, column or
// panel renders nothing on its own. (The autocomplete half of this
// stage lives in RgInput above.)

export function RgTab({ label, children }: any) {
  // One tab page of an RgTabs group. RgTabs reads `label` for the
  // header and `children` as the page content, which renders only
  // while this tab is selected; the marker itself renders nothing,
  // the same declaration pattern as RgOption and RgRadio.
  void label;
  void children;
  return null;
}

export function RgTabs({ index, onChange, children, style }: any) {
  const styles = stylesFor(useRgTheme());
  const items = React.Children.toArray(children)
    .filter((child) => React.isValidElement(child))
    .filter((child) => (child as React.ReactElement<any>).type === RgTab)
    .map((child) => {
      const el = child as React.ReactElement<any>;
      return { label: el.props.label, content: el.props.children };
    });
  // Controlled when the author binds [index] (the Stage 6 controls
  // contract); otherwise the group holds its own selection. Either
  // way (change) emits the newly selected index.
  const [internal, setInternal] = useState(0);
  const controlled = typeof index === 'number';
  const active = controlled
    ? Math.min(Math.max(index, 0), Math.max(items.length - 1, 0))
    : Math.min(internal, Math.max(items.length - 1, 0));
  const select = (i: number): void => {
    if (!controlled) setInternal(i);
    onChange?.(i);
  };
  return (
    <View style={style}>
      <View style={styles.tabsHeader}>
        {items.map((item, i) => {
          const selected = i === active;
          return (
            <Pressable
              key={i}
              onPress={() => select(i)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              style={styles.tabHeader}
            >
              <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>{item.label}</Text>
              {selected ? <View style={styles.tabIndicator} /> : null}
            </Pressable>
          );
        })}
      </View>
      {items[active] ? <View style={styles.tabPanel}>{items[active].content}</View> : null}
    </View>
  );
}

export function RgAccordion({ children, style }: any) {
  // Single-open coordination, mat-accordion with multi=false: the
  // group holds which direct panel child is open and injects it as
  // the internal __groupExpanded and __groupToggle props (a
  // compiler-internal prop pattern, invisible to authors), so the
  // author writes plain panels and the coordination stays here. The
  // first panel child whose [expanded] seed is open starts open.
  const items = React.Children.toArray(children)
    .filter((child) => React.isValidElement(child));
  const [openIndex, setOpenIndex] = useState(() => {
    for (let i = 0; i < items.length; i++) {
      const el = items[i] as React.ReactElement<any>;
      if (el.type === RgPanel && seedOpen(el.props.expanded)) return i;
    }
    return -1;
  });
  return (
    <View style={style}>
      {items.map((child, i) => {
        const el = child as React.ReactElement<any>;
        if (el.type !== RgPanel) return child;
        return React.cloneElement(el, {
          __groupExpanded: openIndex === i,
          __groupToggle: () => setOpenIndex(openIndex === i ? -1 : i),
        });
      })}
    </View>
  );
}

export function RgPanel({ title, subtitle, expanded, onToggle, __groupExpanded, __groupToggle, children, style }: any) {
  const styles = stylesFor(useRgTheme());
  // Two modes. Inside an RgAccordion the group decides the open
  // state through the internal __group props. Standalone, the panel
  // manages its own state, seeded by [expanded]. In both modes a tap
  // toggles, and (toggle) emits the next open boolean.
  const grouped = __groupExpanded !== undefined;
  const [internalOpen, setInternalOpen] = useState(() => seedOpen(expanded));
  const open = grouped ? !!__groupExpanded : internalOpen;
  // The header chevron rotates with the open state: chevron-right
  // turned down when closed, up when open, animated linearly (the
  // house motion rule: plain timing, no spring or bounce).
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    progress.stopAnimation();
    Animated.timing(progress, {
      toValue: open ? 1 : 0, duration: 160, easing: Easing.linear, useNativeDriver: false,
    }).start();
  }, [open, progress]);
  const chevron = progress.interpolate({ inputRange: [0, 1], outputRange: ['90deg', '-90deg'] });
  const toggle = (): void => {
    const next = !open;
    if (grouped) __groupToggle?.();
    else setInternalOpen(next);
    onToggle?.(next);
  };
  return (
    <View style={[styles.panel, style]}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.panelHeader}
      >
        <View style={styles.panelTitles}>
          {title ? <Text style={styles.panelTitle}>{title}</Text> : null}
          {subtitle ? <Text style={styles.panelSubtitle}>{subtitle}</Text> : null}
        </View>
        <Animated.View style={{ transform: [{ rotate: chevron }] }}>
          <RgIcon name="chevron-right" size={24} color="textMuted" />
        </Animated.View>
      </Pressable>
      {open ? <View style={styles.panelBody}>{children}</View> : null}
    </View>
  );
}

export function RgColumn({ name, header, sortable }: any) {
  // One column definition of an RgTable: `name` is the row property
  // the column displays (Angular Material's matColumnDef name) and
  // `header` its header text. `sortable` (Stage 14, the mat-sort
  // header) makes the table sort its rows by this column when the
  // header is tapped. The table reads all three; the marker renders
  // nothing, like RgTab.
  void name;
  void header;
  void sortable;
  return null;
}

/** Compare two cell values for a table sort: numbers numerically,
 * everything else as text, empty values last in ascending order. */
function compareCells(a: unknown, b: unknown): number {
  const aEmpty = a === undefined || a === null || a === '';
  const bEmpty = b === undefined || b === null || b === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

export function RgTable({ data, emptyText, pageSize, children, style }: any) {
  const styles = stylesFor(useRgTheme());
  const columns = React.Children.toArray(children)
    .filter((child) => React.isValidElement(child))
    .map((child) => {
      const el = child as React.ReactElement<any>;
      return { name: el.props.name, header: el.props.header, sortable: !!el.props.sortable && el.props.sortable !== 'false' };
    })
    .filter((col) => typeof col.name === 'string');
  const allRows = Array.isArray(data) ? data : [];
  // Sorting and paging (Stage 14, MatPaginator and matSort in one
  // primitive): both are the table's own view state. Tapping a
  // sortable header cycles ascending, descending, unsorted; the
  // pager appears only when a pageSize is set and the rows overflow
  // one page. The author's data array is never mutated.
  const [sort, setSort] = useState<{ name: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  const sorted = sort
    ? [...allRows].sort((ra: any, rb: any) => sort.dir * compareCells(ra?.[sort.name], rb?.[sort.name]))
    : allRows;
  const size = Number.isFinite(Number(pageSize)) && Number(pageSize) > 0 ? Math.floor(Number(pageSize)) : 0;
  const pageCount = size ? Math.max(1, Math.ceil(sorted.length / size)) : 1;
  const safePage = Math.min(page, pageCount - 1);
  const rows = size ? sorted.slice(safePage * size, safePage * size + size) : sorted;
  const tapHeader = (col: { name: string; sortable: boolean }): void => {
    if (!col.sortable) return;
    setPage(0);
    setSort((prev) => {
      if (!prev || prev.name !== col.name) return { name: col.name, dir: 1 };
      if (prev.dir === 1) return { name: col.name, dir: -1 };
      return null;
    });
  };
  return (
    <View style={[styles.table, style]}>
      <View style={styles.tableRow}>
        {columns.map((col) => {
          const active = sort?.name === col.name;
          if (!col.sortable) {
            return <Text key={col.name} style={styles.tableHeadCell}>{col.header ?? col.name}</Text>;
          }
          // The sort arrow is the set's arrow-right icon rotated:
          // up for ascending, down for descending, faint up while
          // unsorted. No font glyphs; the icon set is the only
          // source of shapes.
          const rotate = active && sort!.dir === -1 ? '90deg' : '-90deg';
          return (
            <Pressable key={col.name} style={{ flex: 1 }} onPress={() => tapHeader(col)} accessibilityRole="button">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={styles.tableHeadCell}>{col.header ?? col.name}</Text>
                <View style={{ transform: [{ rotate }], opacity: active ? 1 : 0.35 }}>
                  <RgIcon name="arrow-right" size={20} color="textMuted" />
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>
      {rows.map((row: any, i: number) => (
        <View key={i} style={styles.tableRow}>
          {columns.map((col) => (
            <Text key={col.name} style={styles.tableCell}>{String(row?.[col.name] ?? '')}</Text>
          ))}
        </View>
      ))}
      {!allRows.length && emptyText ? <Text style={styles.tableEmpty}>{emptyText}</Text> : null}
      {size && pageCount > 1 ? (
        <View style={styles.tablePager}>
          <Text style={styles.tablePagerText}>
            {`${sorted.length === 0 ? 0 : safePage * size + 1}-${Math.min(sorted.length, safePage * size + size)} of ${sorted.length}`}
          </Text>
          <RgIconButton name="chevron-left" size={24} onPress={() => setPage(Math.max(0, safePage - 1))} />
          <RgIconButton name="chevron-right" size={24} onPress={() => setPage(Math.min(pageCount - 1, safePage + 1))} />
        </View>
      ) : null}
    </View>
  );
}

/** Snap a value to the slider's step grid and clamp it into range. */
function sliderSnap(value: number, lo: number, hi: number, step: number): number {
  const snapped = lo + Math.round((value - lo) / step) * step;
  return Math.min(hi, Math.max(lo, snapped));
}

export function RgSlider({ value, min, max, step, disabled, onChange, style }: any) {
  const styles = stylesFor(useRgTheme());
  const lo = Number.isFinite(Number(min)) ? Number(min) : 0;
  const hi = Number.isFinite(Number(max)) ? Number(max) : 100;
  const st = Number(step) > 0 ? Number(step) : 1;
  const base = Number.isFinite(Number(value)) ? Number(value) : lo;
  // While dragging, the thumb follows the finger locally; (change)
  // fires once, on release, with the snapped value (and a tap is a
  // grant followed by a release, so taps emit too).
  const [dragValue, setDragValue] = useState<number | null>(null);
  const shown = dragValue ?? base;
  const fraction = hi > lo ? Math.min(1, Math.max(0, (shown - lo) / (hi - lo))) : 0;
  const trackBox = useRef({ x: 0, width: 0 });
  const trackRef = useRef<any>(null);
  const live = useRef({ lo, hi, st, disabled, onChange });
  live.current = { lo, hi, st, disabled, onChange };
  const fromPageX = (pageX: number): number => {
    const { x, width } = trackBox.current;
    const L = live.current;
    if (width <= 0) return L.lo;
    const ratio = Math.min(1, Math.max(0, (pageX - x) / width));
    return sliderSnap(L.lo + ratio * (L.hi - L.lo), L.lo, L.hi, L.st);
  };
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !live.current.disabled,
    onMoveShouldSetPanResponder: () => !live.current.disabled,
    onPanResponderGrant: (e) => { setDragValue(fromPageX(e.nativeEvent.pageX)); },
    onPanResponderMove: (e) => { setDragValue(fromPageX(e.nativeEvent.pageX)); },
    onPanResponderRelease: (e) => {
      const next = fromPageX(e.nativeEvent.pageX);
      setDragValue(null);
      live.current.onChange?.(next);
    },
    onPanResponderTerminate: () => { setDragValue(null); },
  })).current;
  return (
    <View style={[styles.slider, disabled && styles.sliderDisabled, style]}>
      <View
        ref={trackRef}
        {...responder.panHandlers}
        onLayout={() => {
          trackRef.current?.measureInWindow?.((x: number, _y: number, w: number) => {
            trackBox.current = { x, width: w };
          });
        }}
        style={styles.sliderTrackArea}
        accessibilityRole="adjustable"
        accessibilityValue={{ min: lo, max: hi, now: shown }}
      >
        <View style={styles.sliderTrack} />
        <View style={[styles.sliderFill, { width: `${fraction * 100}%` }]} />
        <View style={[styles.sliderThumb, { left: `${fraction * 100}%` }]} />
      </View>
    </View>
  );
}

export function RgProgressBar({ value, mode, style }: any) {
  const styles = stylesFor(useRgTheme());
  const indeterminate = mode === 'indeterminate';
  const [width, setWidth] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!indeterminate) return;
    progress.setValue(0);
    // The Material indeterminate sweep: a 40 percent bar travelling
    // the track, looping on a linear timing.
    const loop = Animated.loop(Animated.timing(progress, {
      toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: false,
    }));
    loop.start();
    return () => { loop.stop(); };
  }, [indeterminate, progress]);
  const raw = Number(value);
  const clamped = Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) : 0;
  const slide = progress.interpolate({ inputRange: [0, 1], outputRange: [-0.4 * width, width] });
  return (
    <View
      style={[styles.progressTrack, style]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="progressbar"
    >
      {indeterminate
        ? <Animated.View style={[styles.progressFill, { width: '40%', transform: [{ translateX: slide }] }]} />
        : <View style={[styles.progressFill, { width: `${clamped}%` }]} />}
    </View>
  );
}

/**
 * The spinner's arc: a 270 degree SVG path in the 24 by 24 icon box,
 * shared by the primitive here and both preview renderers, so the
 * preview draws exactly what the app rotates.
 */
export const SPINNER_ARC = 'M 12 3 A 9 9 0 1 1 3 12';

export function RgSpinner({ size = 24, color, style }: any) {
  const t = useRgTheme();
  const stroke = color
    ? ((t.colors as unknown as Record<string, string>)[color as string] ?? color)
    : t.colors.primary;
  const rotation = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    rotation.setValue(0);
    const loop = Animated.loop(Animated.timing(rotation, {
      toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true,
    }));
    loop.start();
    return () => { loop.stop(); };
  }, [rotation]);
  const spin = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={[{ width: size, height: size, transform: [{ rotate: spin }] }, style]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d={SPINNER_ARC} stroke={stroke} strokeWidth={2.5} strokeLinecap="round" fill="none" />
      </Svg>
    </Animated.View>
  );
}

export function RgChips({ children, style }: any) {
  const styles = stylesFor(useRgTheme());
  return <View style={[styles.chips, style]}>{children}</View>;
}

export function RgChip({ icon, removable, onRemove, children, style }: any) {
  const styles = stylesFor(useRgTheme());
  return (
    <View style={[styles.chip, style]}>
      {icon ? <RgIcon name={icon} size={20} color="textMuted" /> : null}
      <Text style={styles.chipLabel}>{children}</Text>
      {removable ? (
        <Pressable onPress={onRemove} accessibilityRole="button" accessibilityLabel="Remove" hitSlop={8}>
          <RgIcon name="close" size={20} color="textMuted" />
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Stage 14: the components Angular Material ships that Rangular was
// missing (found by the 2026-11-13 audit against the Material list):
// menu, select, drawer (sidenav), stepper, grid list, tree, divider,
// and the tooltip hosts above. The declaration pattern is the Stage
// 6 and 11 one throughout: group primitives read their declaration
// children, and a declaration element renders nothing on its own.

/** A divider (MatDivider): one hairline across its container. */
export function RgDivider({ style }: any) {
  const styles = stylesFor(useRgTheme());
  return <View style={[styles.divider, style]} />;
}

const RgMenuContext = createContext<{ close?: () => void }>({});

/**
 * The menu (MatMenu): `<menu [open]="menuOpen" (close)="closeMenu()">`
 * renders a floating panel of <menu-item> rows at the top right over
 * a dimmed backdrop, the sheet and dialog contract with a menu's
 * shape. A backdrop tap calls onClose; choosing an item runs the
 * item's own handler and then closes the menu through the context,
 * the way Material menus dismiss on selection. With no `open` prop
 * the menu is simply shown, and the compiler warns.
 */
export function RgMenu({ open, onClose, children, style }: any) {
  const styles = stylesFor(useRgTheme());
  const isOpen = open === undefined ? true : open === 'false' ? false : !!open;
  // The backdrop is the shared dimmed scrim, fading to the same
  // 0.32 the sheet, dialog and drawer use. This menu once drew
  // the backdrop as a plain view with no opacity at all, the
  // full black scrim role, so on a phone the page behind the
  // menu vanished into solid black (his report, 2026-11-21);
  // the preview had promised 0.32 all along.
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (isOpen) {
      progress.setValue(0);
      Animated.timing(progress, {
        toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true,
      }).start();
    }
  }, [isOpen, progress]);
  const backdropOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.32] });
  if (!isOpen) return null;
  return (
    <View style={styles.overlayRootTop}>
      <Animated.View style={[styles.overlayBackdrop, { opacity: backdropOpacity }]}>
        <Pressable style={styles.overlayFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View style={[styles.menuPanel, { opacity: progress }, style]}>
        <RgMenuContext.Provider value={{ close: onClose }}>{children}</RgMenuContext.Provider>
      </Animated.View>
    </View>
  );
}

export function RgMenuItem({ icon, disabled, onPress, children, style }: any) {
  const styles = stylesFor(useRgTheme());
  const menu = useContext(RgMenuContext);
  const press = (): void => {
    onPress?.();
    menu.close?.();
  };
  return (
    <Pressable
      disabled={disabled}
      onPress={press}
      style={({ pressed }) => [styles.menuItem, pressed && styles.buttonPressed, disabled && styles.buttonDisabled, style]}
    >
      {icon ? <RgIcon name={icon} size={24} color="textMuted" /> : null}
      <Text style={styles.menuItemLabel}>{children}</Text>
    </Pressable>
  );
}

/**
 * The drawer (MatSidenav in its over mode): `<drawer [open]="navOpen"
 * (close)="closeNav()">` renders a full height panel from the left
 * over a dimmed backdrop. A backdrop tap calls onClose. The entrance
 * is a plain slide, timed like the sheet, never a spring.
 */
export function RgDrawer({ open, onClose, children, style }: any) {
  const t = useRgTheme();
  const styles = stylesFor(t);
  const isOpen = open === undefined ? true : open === 'false' ? false : !!open;
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (isOpen) {
      progress.setValue(0);
      Animated.timing(progress, {
        toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true,
      }).start();
    }
  }, [isOpen, progress]);
  const backdropOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.32] });
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-280, 0] });
  const tree = (
    <View style={styles.overlayRootLeft}>
      <Animated.View style={[styles.overlayBackdrop, { opacity: backdropOpacity }]}>
        <Pressable style={styles.overlayFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View style={[styles.drawerPanel, { transform: [{ translateX }] }, style]}>
        {children}
      </Animated.View>
    </View>
  );
  const slotted = useRgOverlay(tree, isOpen);
  if (!isOpen) return null;
  return slotted ? null : tree;
}

/** The text of a declaration's children, for select option labels. */
function declarationText(children: unknown): string {
  if (children === undefined || children === null) return '';
  if (Array.isArray(children)) return children.map(declarationText).join('');
  return String(children);
}

/**
 * The select (MatSelect): a field showing the chosen option's label;
 * tapping it opens a bottom sheet listing the <option> declarations,
 * the picker's arrangement. Choosing one writes the option's value
 * through onChange (the Stage 6 controls contract, [value] in and
 * (change) out) and closes the sheet; the current option carries a
 * check. With no value yet, the placeholder shows.
 */
export function RgSelect({ value, label, placeholder, disabled, onChange, children, style }: any) {
  const styles = stylesFor(useRgTheme());
  const [open, setOpen] = useState(false);
  const options = React.Children.toArray(children)
    .filter((child) => React.isValidElement(child))
    .filter((child) => (child as React.ReactElement<any>).type === RgOption)
    .map((child) => {
      const el = child as React.ReactElement<any>;
      return { value: el.props.value, label: declarationText(el.props.children) };
    });
  const selected = options.find((o) => String(o.value ?? '') === String(value ?? ''));
  const pick = (next: unknown): void => {
    setOpen(false);
    onChange?.(next);
  };
  return (
    <View style={[styles.inputWrap, style]}>
      {label ? <Text style={styles.inputLabel}>{label}</Text> : null}
      <Pressable
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[styles.pickerBox, disabled ? styles.inputDisabled : null]}
        accessibilityRole="button"
      >
        <Text style={[styles.pickerValue, !selected && styles.selectPlaceholder]}>
          {selected ? selected.label : (placeholder ?? 'Choose')}
        </Text>
        <View style={{ transform: [{ rotate: '90deg' }] }}>
          <RgIcon name="chevron-right" size={24} color="textMuted" />
        </View>
      </Pressable>
      <RgSheet open={open} onClose={() => setOpen(false)}>
        {options.map((option, i) => {
          const isSelected = String(option.value ?? '') === String(value ?? '');
          return (
            <Pressable
              key={i}
              onPress={() => pick(option.value)}
              style={({ pressed }) => [styles.selectOption, pressed && styles.buttonPressed]}
            >
              <Text style={styles.selectOptionText}>{option.label}</Text>
              {isSelected ? <RgIcon name="check" size={24} color="primary" /> : null}
            </Pressable>
          );
        })}
      </RgSheet>
    </View>
  );
}

export function RgStep({ label, children }: any) {
  // One step page of an RgStepper, read by the group like RgTab.
  void label;
  void children;
  return null;
}

/**
 * The stepper (MatStepper, horizontal): a header of numbered
 * circles and labels joined by hairlines; the content under it is
 * the selected <step>'s children. Controlled by [index] and
 * (change) when bound, self managed otherwise, the tabs contract.
 * A completed step's circle carries a check.
 */
export function RgStepper({ index, onChange, children, style }: any) {
  const styles = stylesFor(useRgTheme());
  const items = React.Children.toArray(children)
    .filter((child) => React.isValidElement(child))
    .filter((child) => (child as React.ReactElement<any>).type === RgStep)
    .map((child) => {
      const el = child as React.ReactElement<any>;
      return { label: el.props.label, content: el.props.children };
    });
  const [internal, setInternal] = useState(0);
  const controlled = typeof index === 'number';
  const active = controlled
    ? Math.min(Math.max(index, 0), Math.max(items.length - 1, 0))
    : Math.min(internal, Math.max(items.length - 1, 0));
  const select = (i: number): void => {
    if (!controlled) setInternal(i);
    onChange?.(i);
  };
  return (
    <View style={style}>
      <View style={styles.stepperHeader}>
        {items.map((item, i) => {
          const done = i < active;
          const current = i === active;
          return (
            <React.Fragment key={i}>
              {i > 0 ? <View style={styles.stepConnector} /> : null}
              <Pressable onPress={() => select(i)} style={styles.stepHead} accessibilityRole="button">
                <View style={[styles.stepCircle, current && styles.stepCircleActive, done && styles.stepCircleDone]}>
                  {done ? (
                    <RgIcon name="check" size={20} color="primary" />
                  ) : (
                    <Text style={[styles.stepNumber, current && styles.stepNumberActive]}>{i + 1}</Text>
                  )}
                </View>
                {item.label ? (
                  <Text style={[styles.stepLabel, current && styles.stepLabelActive]}>{item.label}</Text>
                ) : null}
              </Pressable>
            </React.Fragment>
          );
        })}
      </View>
      {items[active] ? <View style={styles.stepPanel}>{items[active].content}</View> : null}
    </View>
  );
}

export function RgGridTile({ __widthPct, children, style }: any) {
  // One tile of an RgGridList. The list injects the cell width as
  // __widthPct (the accordion's internal prop pattern); the tile
  // itself is the padded cell and its surface card.
  const styles = stylesFor(useRgTheme());
  const pct = typeof __widthPct === 'number' ? __widthPct : 50;
  return (
    <View style={[{ width: `${pct}%` }, styles.gridTileCell, style]}>
      <View style={styles.gridTile}>{children}</View>
    </View>
  );
}

/**
 * The grid list (MatGridList): <grid-tile> children laid out in
 * `cols` columns (default 2), each tile taking an equal share of
 * the row. Tiles hold any content; the list only arranges them.
 */
export function RgGridList({ cols, mode, children, style }: any) {
  const styles = stylesFor(useRgTheme());
  const n = Number.isFinite(Number(cols)) && Number(cols) > 0 ? Math.floor(Number(cols)) : 2;
  // Masonry (Stage 15): mode="masonry" is the same tag and the same
  // tiles with uneven heights: the tiles are dealt into `cols`
  // columns in order and each column stacks its own tiles, so a
  // tall tile pushes only its own column down (the Pinterest
  // pattern). It is a mode of grid-list, not a sibling tag, because
  // the vocabulary (cols, tiles) is identical; only the arrangement
  // changes.
  if (mode === 'masonry') {
    const tiles = React.Children.toArray(children)
      .filter((child) => React.isValidElement(child));
    const columns: React.ReactElement<any>[][] = Array.from({ length: n }, () => []);
    tiles.forEach((tile, i) => { columns[i % n].push(tile as React.ReactElement<any>); });
    return (
      <View style={[styles.masonry, style]}>
        {columns.map((colTiles, ci) => (
          <View key={ci} style={styles.masonryCol}>
            {colTiles.map((tile, ti) => (
              <View key={ti} style={styles.gridTile}>
                {tile.type === RgGridTile ? tile.props.children : tile}
              </View>
            ))}
          </View>
        ))}
      </View>
    );
  }
  const pct = 100 / n;
  return (
    <View style={[styles.gridList, style]}>
      {React.Children.map(children, (child) => {
        if (!React.isValidElement(child)) return child;
        if ((child as React.ReactElement<any>).type !== RgGridTile) return child;
        return React.cloneElement(child as React.ReactElement<any>, { __widthPct: pct });
      })}
    </View>
  );
}

export function RgTree({ children, style }: any) {
  // The tree's root (MatTree): it only holds its <tree-node>
  // children; each node manages its own expansion.
  return <View style={style}>{children}</View>;
}

export function RgTreeNode({ label, expanded, children, style }: any) {
  const styles = stylesFor(useRgTheme());
  const hasKids = React.Children.count(children) > 0;
  const [open, setOpen] = useState(() => expanded === true || expanded === 'true');
  return (
    <View style={style}>
      <Pressable
        onPress={hasKids ? () => setOpen(!open) : undefined}
        style={styles.treeNodeHeader}
        accessibilityRole={hasKids ? 'button' : undefined}
      >
        {hasKids ? (
          <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
            <RgIcon name="chevron-right" size={24} color="textMuted" />
          </View>
        ) : (
          <View style={styles.treeChevronSpacer} />
        )}
        <Text style={styles.treeNodeLabel}>{label}</Text>
      </Pressable>
      {hasKids && open ? <View style={styles.treeChildren}>{children}</View> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Stage 15: beyond Angular. The pieces real apps use constantly that
// Angular itself never shipped (the 2026-11-13 beyond-Angular
// audit): bottom navigation, pull to refresh and infinite scroll
// (on RgScreen and RgList above), skeletons, swipe row actions
// (RgRow above), the picker, rating, OTP, carousel, timeline,
// calendar, avatars, empty state, charts, a small editor, image
// and lightbox, colour picker and breadcrumbs. The declaration
// pattern is the house one throughout: group primitives read their
// declaration children, and a declaration renders nothing alone.

/** Marker for one destination of RgBottomNav. The bar reads its props. */
export function RgNavItem({ icon, label, badge, children }: any) {
  void icon;
  void label;
  void badge;
  void children;
  return null;
}

/**
 * The bottom navigation bar: three to five destinations at the
 * bottom of the screen, in thumb reach, the primary navigation of
 * nearly every phone app and a component Angular Material never
 * shipped. `<bottom-nav [index] (change)>` follows the tabs
 * contract; each `<nav-item icon="home" label="Home">` may carry a
 * routerLink or a (click) (composed by the compiler into the item's
 * onPress, as on rows and buttons), and tapping it selects it,
 * runs its own press, and reports the index through (change).
 * RgScreen lifts the bar out of the scrolling content and pins it
 * under the screen. An item may carry a badge count.
 */
export function RgBottomNav({ index, onChange, children, style, haptic }: any) {
  const styles = stylesFor(useRgTheme());
  const items = React.Children.toArray(children)
    .filter((child) => React.isValidElement(child))
    .filter((child) => (child as React.ReactElement<any>).type === RgNavItem)
    .map((child) => {
      const el = child as React.ReactElement<any>;
      return { icon: el.props.icon, label: el.props.label, badge: el.props.badge, onPress: el.props.onPress };
    });
  const [internal, setInternal] = useState(0);
  const controlled = typeof index === 'number';
  const active = controlled
    ? Math.min(Math.max(index, 0), Math.max(items.length - 1, 0))
    : Math.min(internal, Math.max(items.length - 1, 0));
  const select = (i: number): void => {
    // Tab haptic (2026-11-18): with the `haptic` attribute, a
    // switch to a different tab answers with the selection
    // haptic, the native tab feel; re-tapping the current tab
    // stays silent.
    if (haptic && i !== active) fireSelectionHaptic();
    if (!controlled) setInternal(i);
    items[i]?.onPress?.();
    onChange?.(i);
  };
  const tree = (
    <View style={[styles.bottomNav, style]}>
      {items.map((item, i) => {
        const selected = i === active;
        return (
          <Pressable
            key={i}
            onPress={() => select(i)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={styles.navItem}
          >
            <View style={[styles.navItemIconWrap, selected && styles.navItemIconWrapSelected]}>
              {item.icon ? (
                <RgIcon name={item.icon} size={24} color={selected ? 'primary' : 'textMuted'} />
              ) : null}
              <BadgeDot value={item.badge} styles={styles} offset={{ top: -6, right: -10 }} />
            </View>
            {item.label ? (
              <Text style={[styles.navItemLabel, selected && styles.navItemLabelSelected]}>
                {String(item.label)}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
  const slotted = useRgBottom(tree);
  return slotted ? null : tree;
}

/**
 * A skeleton placeholder (Stage 15): a surface variant shape that
 * pulses while content loads, in the layout the content will take.
 * `shape` is line (the default, a text line), block (a rectangle,
 * `height` tall) or circle (`size` across). The pulse is a plain
 * timing loop between two opacities, the house motion rule.
 * Compose skeletons inside cards and rows where real content goes;
 * when the data lands, swap them out with *ngIf.
 */
export function RgSkeleton({ shape = 'line', width, height, size, style }: any) {
  const t = useRgTheme();
  const styles = stylesFor(t);
  const pulse = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.linear, useNativeDriver: false }),
      Animated.timing(pulse, { toValue: 0.55, duration: 700, easing: Easing.linear, useNativeDriver: false }),
    ]));
    loop.start();
    return () => { loop.stop(); };
  }, [pulse]);
  const w = Number(width);
  const h = Number(height);
  const d = Number(size);
  let dims: Record<string, unknown>;
  if (shape === 'circle') {
    const diameter = Number.isFinite(d) && d > 0 ? d : 40;
    dims = { width: diameter, height: diameter, borderRadius: t.radius.full };
  } else if (shape === 'block') {
    dims = {
      width: Number.isFinite(w) && w > 0 ? w : '100%',
      height: Number.isFinite(h) && h > 0 ? h : 96,
      borderRadius: t.radius.lg,
    };
  } else {
    dims = {
      width: Number.isFinite(w) && w > 0 ? w : '100%',
      height: Number.isFinite(h) && h > 0 ? h : 14,
      borderRadius: t.radius.sm,
    };
  }
  return <Animated.View style={[styles.skeleton, dims, { opacity: pulse }, style]} />;
}

/**
 * The star rating control (Stage 15): `[value]` in, `(change)` out
 * with the tapped star's number, the Stage 6 controls contract.
 * Stars are the icon set's star, filled in the primary colour up
 * to the value and muted beyond it; there are no half stars in
 * this version. `max` defaults to 5.
 */
export function RgRating({ value, max, disabled, onChange, style }: any) {
  const styles = stylesFor(useRgTheme());
  const n = Number.isFinite(Number(max)) && Number(max) > 0
    ? Math.min(10, Math.floor(Number(max))) : 5;
  const current = Number.isFinite(Number(value)) ? Number(value) : 0;
  return (
    <View style={[styles.rating, style]} accessibilityRole="adjustable"
      accessibilityValue={{ min: 0, max: n, now: current }}>
      {Array.from({ length: n }, (_, i) => i + 1).map((star) => (
        <Pressable
          key={star}
          disabled={disabled}
          onPress={() => onChange?.(star)}
          style={styles.ratingStar}
          accessibilityRole="button"
          accessibilityLabel={`${star} star${star === 1 ? '' : 's'}`}
        >
          {star <= current
            ? <RgIcon name="star" size={28} color="primary" />
            : (
              <View style={{ opacity: 0.35 }}>
                <RgIcon name="star" size={28} color="textMuted" />
              </View>
            )}
        </Pressable>
      ))}
    </View>
  );
}

/**
 * The OTP and PIN input (Stage 15): one control holding one string
 * of digits across `length` boxes (4 to 8, default 6). A hidden
 * text field over the boxes takes the typing (the pattern OTP
 * inputs use on both platforms), so the keyboard, autofill and
 * paste all behave; the boxes only display. `(change)` emits the
 * digit string as it grows; the class decides when it is complete
 * (its length is the control's length). Digits only in this
 * version: it is a code and PIN control, not a general segmented
 * input.
 */
export function RgOtp({ value, length, disabled, onChange, style }: any) {
  const styles = stylesFor(useRgTheme());
  const rawLen = Number.isFinite(Number(length)) ? Math.floor(Number(length)) : 6;
  const len = Math.min(8, Math.max(4, rawLen));
  const text = String(value ?? '').replace(/\D/g, '').slice(0, len);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<any>(null);
  const activeBox = Math.min(text.length, len - 1);
  return (
    <View style={[styles.otpRow, style]}>
      {Array.from({ length: len }, (_, i) => (
        <Pressable
          key={i}
          disabled={disabled}
          onPress={() => inputRef.current?.focus()}
          style={[styles.otpBox, focused && i === activeBox && styles.otpBoxActive]}
        >
          <Text style={styles.otpDigit}>{text[i] ?? ''}</Text>
        </Pressable>
      ))}
      <TextInput
        ref={inputRef}
        style={styles.otpHiddenInput}
        value={text}
        onChangeText={(next: string) => onChange?.(next.replace(/\D/g, '').slice(0, len))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        maxLength={len}
        editable={!disabled}
        caretHidden
        accessibilityLabel="One time code"
      />
    </View>
  );
}

/**
 * The carousel (Stage 15): a paging container whose children are
 * pages, one screen wide each, with a dots row under them. Follows
 * the stepper's index contract: `[index]` in, `(change)` out with
 * the page the swipe settled on. Pages are plain content; for a
 * photo gallery, put an <image> in each page.
 */
export function RgCarousel({ index, onChange, children, style }: any) {
  const styles = stylesFor(useRgTheme());
  const pages = React.Children.toArray(children)
    .filter((child) => React.isValidElement(child) || typeof child === 'string');
  const [pageWidth, setPageWidth] = useState(0);
  const [internal, setInternal] = useState(0);
  const controlled = typeof index === 'number';
  const active = controlled
    ? Math.min(Math.max(index, 0), Math.max(pages.length - 1, 0))
    : Math.min(internal, Math.max(pages.length - 1, 0));
  const scrollRef = useRef<any>(null);
  useEffect(() => {
    if (controlled && pageWidth > 0) {
      scrollRef.current?.scrollTo({ x: active * pageWidth, animated: false });
    }
  }, [controlled, active, pageWidth]);
  const settled = (e: any): void => {
    if (pageWidth <= 0) return;
    const i = Math.min(pages.length - 1, Math.max(0, Math.round(e.nativeEvent.contentOffset.x / pageWidth)));
    if (i === active) return;
    if (!controlled) setInternal(i);
    onChange?.(i);
  };
  return (
    <View style={style}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onLayout={(e: any) => setPageWidth(e.nativeEvent.layout.width)}
        onMomentumScrollEnd={settled}
      >
        {pages.map((page, i) => (
          <View key={i} style={{ width: pageWidth > 0 ? pageWidth : '100%' }}>{page}</View>
        ))}
      </ScrollView>
      {pages.length > 1 ? (
        <View style={styles.carouselDots}>
          {pages.map((_, i) => (
            <View key={i} style={[styles.carouselDot, i === active && styles.carouselDotActive]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** One file the picker hands back (Stage 15), the documented shape. */
export interface RgPickedFile {
  name: string;
  uri: string;
  size?: number;
  type?: string;
}

/**
 * The file and image picker (Stage 15): a field in the select's
 * shape; tapping it opens the platform picker and `(change)` emits
 * an array of picked files, each `{ name, uri, size, type }`.
 * `kind="image"` (the default) picks from the photo library;
 * `kind="file"` picks a document. `multiple` allows several at
 * once. Cancelling emits nothing.
 *
 * App side requirement, stated plainly: both picker modules are
 * required dependencies of any app that uses @rangular-framework/ui,
 * expo-image-picker and expo-document-picker alike. The requires
 * below sit inside the tap handler, so the native call happens at
 * tap time, but Metro resolves every literal require when the app
 * bundles: an app without either package does not bundle at all,
 * and the warning below covers only runtimes where a require can
 * fail after bundling. The scaffold writes both into the app's
 * package.json; an app that vendors @rangular-framework/ui by hand must add
 * both itself. Expo Go carries both for SDK 58, so Expo Go runs
 * work with no setup.
 */
export function RgFilePicker({ label, kind = 'image', multiple, placeholder, disabled, onChange, children, style }: any) {
  const styles = stylesFor(useRgTheme());
  const pick = async (): Promise<void> => {
    const emit = (files: RgPickedFile[]): void => { if (files.length) onChange?.(files); };
    try {
      if (kind === 'file') {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const docs = require('expo-document-picker');
        const result = await docs.getDocumentAsync({ multiple: !!multiple, copyToCacheDirectory: true });
        if (result.canceled) return;
        emit((result.assets ?? []).map((a: any) => ({
          name: a.name ?? 'file', uri: a.uri, size: a.size, type: a.mimeType,
        })));
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const images = require('expo-image-picker');
      const permission = await images.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return;
      const result = await images.launchImageLibraryAsync({
        allowsMultipleSelection: !!multiple,
        mediaTypes: 'images',
        quality: 1,
      });
      if (result.canceled) return;
      emit((result.assets ?? []).map((a: any) => ({
        name: a.fileName ?? String(a.uri).split('/').pop() ?? 'photo',
        uri: a.uri, size: a.fileSize, type: a.mimeType,
      })));
    } catch {
      console.warn(
        'RgFilePicker: a picker module is not available in this app. '
        + 'Both expo-image-picker and expo-document-picker are required dependencies of @rangular-framework/ui; add both to the app.',
      );
    }
  };
  const buttonText = declarationText(children) || (placeholder ?? (kind === 'file' ? 'Choose a file' : 'Choose a photo'));
  return (
    <View style={[styles.inputWrap, style]}>
      {label ? <Text style={styles.inputLabel}>{label}</Text> : null}
      <Pressable
        disabled={disabled}
        onPress={pick}
        style={[styles.pickerBox, disabled ? styles.inputDisabled : null]}
        accessibilityRole="button"
      >
        <Text style={[styles.pickerValue, styles.selectPlaceholder]}>{buttonText}</Text>
        <RgIcon name={kind === 'file' ? 'edit' : 'plus'} size={24} color="textMuted" />
      </Pressable>
    </View>
  );
}

export function RgTimeline({ children, style }: any) {
  // The timeline's root: it only holds its <timeline-item>
  // children and tells the last one it is last, so its rail line
  // stops at its dot (the internal prop pattern, as the accordion
  // uses for its panels).
  const items = React.Children.toArray(children)
    .filter((child) => React.isValidElement(child));
  return (
    <View style={style}>
      {items.map((child, i) => {
        const el = child as React.ReactElement<any>;
        if (el.type !== RgTimelineItem) return child;
        return React.cloneElement(el, { __last: i === items.length - 1 });
      })}
    </View>
  );
}

export function RgTimelineItem({ title, time, __last, children, style }: any) {
  const styles = stylesFor(useRgTheme());
  return (
    <View style={[styles.timelineItem, style]}>
      <View style={styles.timelineRail}>
        <View style={styles.timelineDot} />
        {__last ? null : <View style={styles.timelineLine} />}
      </View>
      <View style={styles.timelineBody}>
        <View style={styles.timelineHead}>
          {title ? <Text style={styles.timelineTitle}>{String(title)}</Text> : <View style={{ flex: 1 }} />}
          {time ? <Text style={styles.timelineTime}>{String(time)}</Text> : null}
        </View>
        {children}
      </View>
    </View>
  );
}

/**
 * The calendar month view (Stage 15): a tappable month grid shown
 * as a screen element, not a picker popup. This is a different
 * component from <datetime-picker> on purpose: the picker is the
 * iOS wheel form for choosing a moment (Bigyan's product rule);
 * the calendar is for looking at a month and tapping a day.
 * `[value]` holds the selected day as an ISO string and `(change)`
 * emits the tapped day's ISO string, the picker's value language.
 * Weeks start on Sunday. The displayed month is the control's own
 * state, seeded from the value; the header chevrons move it.
 */
export function RgCalendar({ value, onChange, style }: any) {
  const styles = stylesFor(useRgTheme());
  const selected = parseDateTimeValue(value);
  const seed = selected ?? nowParts();
  const [shown, setShown] = useState({ year: seed.year, month: seed.month });
  const today = nowParts();
  const firstWeekday = new Date(shown.year, shown.month - 1, 1).getDay();
  const count = daysInMonth(shown.year, shown.month);
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: count }, (_, i) => i + 1),
  ];
  const move = (delta: number): void => {
    setShown((s) => {
      const total = s.year * 12 + (s.month - 1) + delta;
      return { year: Math.floor(total / 12), month: (total % 12) + 1 };
    });
  };
  const pick = (day: number): void => {
    onChange?.(composeDateTimeIso({
      year: shown.year, month: shown.month, day,
      hour: selected?.hour ?? 0, minute: selected?.minute ?? 0,
    }));
  };
  const isSelected = (day: number): boolean =>
    !!selected && selected.year === shown.year && selected.month === shown.month && selected.day === day;
  const isToday = (day: number): boolean =>
    today.year === shown.year && today.month === shown.month && today.day === day;
  return (
    <View style={style}>
      <View style={styles.calendarHead}>
        <RgIconButton name="chevron-left" size={24} onPress={() => move(-1)} />
        <Text style={styles.calendarTitle}>
          {`${MONTH_SHORT[shown.month - 1]} ${shown.year}`}
        </Text>
        <RgIconButton name="chevron-right" size={24} onPress={() => move(1)} />
      </View>
      <View style={styles.calendarWeek}>
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
          <Text key={d} style={styles.calendarWeekCell}>{d}</Text>
        ))}
      </View>
      <View style={styles.calendarGrid}>
        {cells.map((day, i) => {
          if (day === null) return <View key={i} style={styles.calendarCell} />;
          const sel = isSelected(day);
          return (
            <Pressable key={i} style={styles.calendarCell} onPress={() => pick(day)} accessibilityRole="button">
              {sel ? (
                <View style={styles.calendarDaySelected}>
                  <Text style={[styles.calendarDay, styles.calendarDaySelectedText]}>{day}</Text>
                </View>
              ) : (
                <Text style={[styles.calendarDay, isToday(day) && styles.calendarDayToday]}>{day}</Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** The initials an avatar shows for a name: first letters of the first two words. */
function avatarInitials(text: unknown): string {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}

/**
 * An avatar (Stage 15): a circle holding either an image (`src`,
 * a URI) or the initials of `text` (a name) on the theme's avatar
 * colour. `size` is the diameter in px, default 40. An avatar in
 * an <avatar-group> overlaps its neighbours.
 */
export function RgAvatar({ text, src, size, style }: any) {
  const t = useRgTheme();
  const c = t.colors;
  const d = Number.isFinite(Number(size)) && Number(size) > 0 ? Number(size) : 40;
  if (src) {
    return (
      <Image
        source={{ uri: String(src) }}
        style={[{ width: d, height: d, borderRadius: t.radius.full }, style]}
      />
    );
  }
  return (
    <View
      style={[{
        width: d, height: d, borderRadius: t.radius.full, backgroundColor: c.avatar,
        alignItems: 'center', justifyContent: 'center',
      }, style]}
    >
      <Text style={{ color: c.onAvatar, fontSize: Math.round(d * 0.4), fontWeight: '600' }}>
        {avatarInitials(text)}
      </Text>
    </View>
  );
}

/**
 * An avatar group (Stage 15): <avatar> children overlapping in a
 * row. `max` caps how many faces show; the rest collapse into one
 * more circle reading +N. Without `max` every avatar shows.
 */
export function RgAvatarGroup({ max, children, style }: any) {
  const t = useRgTheme();
  const c = t.colors;
  const styles = stylesFor(t);
  const items = React.Children.toArray(children)
    .filter((child) => React.isValidElement(child))
    .filter((child) => (child as React.ReactElement<any>).type === RgAvatar);
  const limit = Number.isFinite(Number(max)) && Number(max) > 0
    ? Math.floor(Number(max)) : items.length;
  const shown = items.slice(0, limit);
  const overflow = items.length - shown.length;
  const d = 40;
  return (
    <View style={[styles.avatarGroup, style]}>
      {shown.map((child, i) => (
        <View key={i} style={[styles.avatarRing, i > 0 && { marginLeft: -10 }]}>
          {child}
        </View>
      ))}
      {overflow > 0 ? (
        <View
          style={[styles.avatarRing, shown.length > 0 && { marginLeft: -10 }, {
            width: d, height: d, borderRadius: t.radius.full, backgroundColor: c.surfaceVariant,
            alignItems: 'center', justifyContent: 'center',
          }]}
        >
          <Text style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>{`+${overflow}`}</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The empty state (Stage 15): the designed answer to "nothing
 * here yet": an icon in a soft circle, one title line, one body
 * line, and the projected children as its action (usually one
 * button: an empty state's action always does something, the
 * only-meaningful-buttons rule). Every app designs this by hand
 * today; here it is one named block.
 */
export function RgEmptyState({ icon, title, text, children, style }: any) {
  const styles = stylesFor(useRgTheme());
  return (
    <View style={[styles.emptyState, style]}>
      {icon ? (
        <View style={styles.emptyIconCircle}>
          <RgIcon name={icon} size={28} color="textMuted" />
        </View>
      ) : null}
      {title ? <Text style={styles.emptyTitle}>{String(title)}</Text> : null}
      {text ? <Text style={styles.emptyText}>{String(text)}</Text> : null}
      {children}
    </View>
  );
}

/** Serialize one chart shape through react-native-svg (Stage 15). */
function chartShapeElement(shape: ChartShape, key: number): React.ReactNode {
  switch (shape.kind) {
    case 'rect':
      return <Rect key={key} x={shape.x} y={shape.y} width={shape.width} height={shape.height} fill={shape.fill} />;
    case 'path':
      return (
        <Path
          key={key} d={shape.d}
          fill={shape.fill ?? 'none'}
          stroke={shape.stroke}
          strokeWidth={shape.strokeWidth}
        />
      );
    case 'circle':
      return <Circle key={key} cx={shape.cx} cy={shape.cy} r={shape.r} fill={shape.fill} />;
    case 'text':
      return (
        <SvgText
          key={key} x={shape.x} y={shape.y} fill={shape.fill}
          fontSize={shape.size}
          textAnchor={shape.anchor === 'middle' ? 'middle' : 'start'}
        >
          {shape.text}
        </SvgText>
      );
  }
}

/**
 * A chart (Stage 15): `<chart type="bar|line|pie" [data]="points">`
 * where points are `{ label, value }` pairs (a point may carry its
 * own `color` hex). The geometry comes from the shared engine in
 * ./chart and is drawn with react-native-svg, like the icons; the
 * preview draws the identical model as inline SVG. `height` is the
 * plotting height (default 160); `width` defaults to the measured
 * layout width. Scope: one series, no axes, no animation, no
 * interaction; see ./chart for the honest list.
 */
export function RgChart({ type = 'bar', data, width, height, style }: any) {
  const t = useRgTheme();
  const [layoutWidth, setLayoutWidth] = useState(0);
  const w = Number.isFinite(Number(width)) && Number(width) > 0
    ? Number(width) : (layoutWidth > 0 ? layoutWidth : 320);
  const h = Number.isFinite(Number(height)) && Number(height) > 0 ? Number(height) : 160;
  const kind = type === 'line' || type === 'pie' ? type : 'bar';
  const model = chartModel(kind, data, w, h, COLOR_SWATCHES, t.colors.textMuted);
  return (
    <View
      style={style}
      onLayout={(e: any) => setLayoutWidth(e.nativeEvent.layout.width)}
    >
      <Svg width={model.width} height={model.height} viewBox={`0 0 ${model.width} ${model.height}`}>
        {model.shapes.map((shape, i) => chartShapeElement(shape, i))}
      </Svg>
    </View>
  );
}

/**
 * The editor (Stage 15): a lightweight rich text control whose
 * value is the text itself, marked up with markdown style markers
 * (double star for bold, single star for italic, a dash and space
 * to start a list line). The toolbar's three buttons act on the
 * current selection: Bold and Italic wrap it in their markers,
 * List starts its line with the list marker. Scope limit, stated
 * plainly: this is a marked-up text field with helpers, not a
 * WYSIWYG engine; the stored value is the marked text, and
 * rendering that markup is the reading side's job (a <p> shows it
 * raw today). What it gives an app is one control with the
 * contract every other control has: [value] in, (change) out.
 */
export function RgEditor({ value, label, placeholder, disabled, onChange, style }: any) {
  const t = useRgTheme();
  const styles = stylesFor(t);
  const editorRef = useRef<any>(null);
  const liftAboveKeyboard = useKeyboardLift();
  const text = value === undefined || value === null ? '' : String(value);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const clampSel = (): { start: number; end: number } => {
    const start = Math.min(Math.max(selection.start || 0, 0), text.length);
    const end = Math.min(Math.max(selection.end || 0, start), text.length);
    return { start, end };
  };
  const wrap = (marker: string): void => {
    const { start, end } = clampSel();
    onChange?.(text.slice(0, start) + marker + text.slice(start, end) + marker + text.slice(end));
  };
  const listLine = (): void => {
    const { start } = clampSel();
    const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    onChange?.(text.slice(0, lineStart) + '- ' + text.slice(lineStart));
  };
  const tool = (labelText: string, act: () => void): React.ReactNode => (
    <Pressable key={labelText} disabled={disabled} onPress={act} style={styles.editorTool} accessibilityRole="button">
      <Text style={styles.editorToolLabel}>{labelText}</Text>
    </Pressable>
  );
  return (
    <View style={[styles.inputWrap, style]}>
      {label ? <Text style={styles.inputLabel}>{label}</Text> : null}
      <View style={styles.editorToolbar}>
        {tool('Bold', () => wrap('**'))}
        {tool('Italic', () => wrap('*'))}
        {tool('List', listLine)}
      </View>
      <TextInput
        ref={editorRef}
        style={[styles.inputField, styles.editorArea, disabled ? styles.inputDisabled : null]}
        value={text}
        onChangeText={(next: string) => onChange?.(next)}
        onSelectionChange={(e: any) => setSelection(e.nativeEvent.selection)}
        onFocus={() => liftAboveKeyboard(editorRef.current)}
        placeholder={placeholder}
        placeholderTextColor={t.colors.textMuted}
        editable={!disabled}
        multiline
      />
    </View>
  );
}

/**
 * An image (Stage 15): `<image src="..." width="320" height="180">`
 * shows a remote or bundled picture at a declared size. Declaring
 * width and height is the contract (the doctor enforces it,
 * DOC_IMG_SIZE): the layout is known before the picture loads, so
 * the screen does not jump. `resize` is cover (the default, fill
 * and crop), contain (fit whole) or stretch. This is also the
 * enabling piece for the lightbox and for image carousel pages.
 */
export function RgImage({ src, width, height, resize, style }: any) {
  const w = Number(width);
  const h = Number(height);
  const dims = {
    width: Number.isFinite(w) && w > 0 ? w : '100%',
    height: Number.isFinite(h) && h > 0 ? h : 160,
  };
  const mode = resize === 'contain' ? 'contain' : resize === 'stretch' ? 'stretch' : 'cover';
  return (
    <Image
      source={{ uri: String(src ?? '') }}
      style={[dims as any, style]}
      resizeMode={mode}
    />
  );
}

/**
 * The lightbox (Stage 15): a full screen photo viewer on the
 * overlay contract, `<lightbox [open]="photoOpen"
 * (close)="closePhoto()" src="...">`. The photo fits the screen
 * over the dimmed backdrop; a backdrop tap, or the close chip at
 * the top end corner, calls onClose. Children render under the
 * photo as its caption. Pinch zoom comes from the scroll view's
 * zoom on iOS; Android pinch zoom is not part of this version,
 * stated plainly.
 */
export function RgLightbox({ open, onClose, src, children, style }: any) {
  const styles = stylesFor(useRgTheme());
  const isOpen = open === undefined ? true : open === 'false' ? false : !!open;
  const tree = (
    <View style={styles.overlayRootCenter}>
      <View style={[styles.overlayBackdrop, { opacity: 0.92 }]}>
        <Pressable style={styles.overlayFill} onPress={onClose} accessibilityLabel="Close" />
      </View>
      <Pressable style={styles.lightboxClose} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
        <RgIcon name="close" size={24} color="text" />
      </Pressable>
      <ScrollView
        maximumZoomScale={3}
        minimumZoomScale={1}
        centerContent
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
      >
        <Image
          source={{ uri: String(src ?? '') }}
          style={[styles.lightboxImage, style]}
          resizeMode="contain"
        />
      </ScrollView>
      {children ? <View style={styles.lightboxCaption}>{children}</View> : null}
    </View>
  );
  const slotted = useRgOverlay(tree, isOpen);
  if (!isOpen) return null;
  return slotted ? null : tree;
}

/**
 * The colour picker (Stage 15): `[value]` holds a hex string
 * from the shared palette (or any six digit hex) and `(change)`
 * emits the picked hex, the controls contract. The field shows a
 * swatch of the current colour; a tap
 * opens a bottom sheet with the shared data palette as a swatch
 * grid, plus one custom row where any six digit hex can be typed
 * and applied. The palette is data (./palette), the same in both
 * themes.
 */
export function RgColorPicker({ value, label, placeholder, disabled, onChange, style }: any) {
  const styles = stylesFor(useRgTheme());
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const current = value === undefined || value === null ? '' : String(value);
  const pick = (hex: string): void => {
    setOpen(false);
    onChange?.(hex);
  };
  const applyCustom = (): void => {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(custom.trim());
    if (m) pick(`#${m[1].toLowerCase()}`);
  };
  return (
    <View style={[styles.inputWrap, style]}>
      {label ? <Text style={styles.inputLabel}>{label}</Text> : null}
      <Pressable
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[styles.pickerBox, disabled ? styles.inputDisabled : null]}
        accessibilityRole="button"
      >
        <View style={[styles.colorSwatchChip, current ? { backgroundColor: current } : null]} />
        <Text style={[styles.pickerValue, !current && styles.selectPlaceholder]}>
          {current || (placeholder ?? 'Pick a colour')}
        </Text>
        <View style={{ transform: [{ rotate: '90deg' }] }}>
          <RgIcon name="chevron-right" size={24} color="textMuted" />
        </View>
      </Pressable>
      <RgSheet open={open} onClose={() => setOpen(false)}>
        <View style={styles.swatchGrid}>
          {COLOR_SWATCHES.map((hex) => {
            const selected = hex.toLowerCase() === current.toLowerCase();
            return (
              <Pressable
                key={hex}
                onPress={() => pick(hex)}
                style={[styles.swatch, { backgroundColor: hex }, selected && styles.swatchSelected]}
                accessibilityRole="button"
                accessibilityLabel={hex}
              />
            );
          })}
        </View>
        <RgInput
          label="Custom hex"
          placeholder="d93025"
          value={custom}
          onChangeText={setCustom}
        />
        <RgButton variant="text" onPress={applyCustom}>Use this colour</RgButton>
      </RgSheet>
    </View>
  );
}

/** Marker for one crumb of RgBreadcrumbs. The bar reads its props. */
export function RgCrumb({ children }: any) {
  void children;
  return null;
}

/**
 * Breadcrumbs (Stage 15): `<crumb>` declarations in a wrapping
 * row, joined by chevron icons (the icon set, never a font
 * glyph). Every crumb but the last is a link (a routerLink or
 * (click), composed into its onPress by the compiler); the last
 * crumb is the current page and renders as plain semibold text.
 * On a phone the back chevron does most of this job; breadcrumbs
 * earn their place in deep settings and content hierarchies,
 * which is why the audit ranked them last of the twenty.
 */
export function RgBreadcrumbs({ children, style }: any) {
  const styles = stylesFor(useRgTheme());
  const items = React.Children.toArray(children)
    .filter((child) => React.isValidElement(child))
    .filter((child) => (child as React.ReactElement<any>).type === RgCrumb)
    .map((child) => {
      const el = child as React.ReactElement<any>;
      return { label: declarationText(el.props.children), onPress: el.props.onPress };
    });
  return (
    <View style={[styles.breadcrumbs, style]}>
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <React.Fragment key={i}>
            {i > 0 ? <RgIcon name="chevron-right" size={20} color="textMuted" /> : null}
            {last || !item.onPress
              ? <Text style={styles.crumbCurrent}>{item.label}</Text>
              : (
                <Pressable onPress={item.onPress} accessibilityRole="link">
                  <Text style={styles.crumbLabel}>{item.label}</Text>
                </Pressable>
              )}
          </React.Fragment>
        );
      })}
    </View>
  );
}
