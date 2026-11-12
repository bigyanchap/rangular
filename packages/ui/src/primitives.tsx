/**
 * @rangular/ui primitives, SHIPPED SOURCE for generated apps.
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
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  FlatList,
  PanResponder,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Svg, Path } from 'react-native-svg';
import { theme as makeTheme } from './tokens';
import type { Theme } from './tokens';
import { ICON_PATHS } from './icons';
import {
  applyWheelValue,
  composeDateTimeIso,
  dateTimeWheels,
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
    // A plain container (section, div, header) is a stack: it stacks
    // its children in a column with the one rhythm gap, the same gap
    // the screen and the card use. Before this fix containers compiled
    // to a bare View with no gap, so every routed screen (whose root
    // is a section inside the screen) stacked its cards and blocks
    // with zero space between them, attached edge to edge. Only flat
    // screens whose blocks were direct children of the screen got the
    // rhythm. Found by the Rangular Tutorial app, 2026-11-12.
    section: { flexDirection: 'column', gap: t.spacing.md },
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
      paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.sm, paddingBottom: t.spacing.xxl,
      ...t.elevation.level2,
    },
    sheetHandle: {
      alignSelf: 'center', width: 36, height: 4, borderRadius: t.radius.full,
      backgroundColor: c.outline, marginBottom: t.spacing.md,
    },
    dialogPanel: {
      backgroundColor: c.surface, borderRadius: t.radius.xl,
      padding: t.spacing.xl, ...t.elevation.level2,
    },
    dialogTitle: {
      fontSize: t.typography.title.fontSize, lineHeight: t.typography.title.lineHeight,
      fontWeight: '600', color: c.text, marginBottom: t.spacing.md,
    },
    actions: {
      flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center',
      gap: t.spacing.sm, marginTop: t.spacing.lg,
    },
    snackbar: {
      position: 'absolute', left: t.spacing.lg, right: t.spacing.lg, bottom: t.spacing.xxxl,
      backgroundColor: c.onSurface, borderRadius: t.radius.sm,
      paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.md,
      flexDirection: 'row', alignItems: 'center', gap: t.spacing.md,
      ...t.elevation.level2,
    },
    snackbarText: { flex: 1, color: c.background, fontSize: t.typography.body.fontSize },
    snackbarAction: { color: c.primaryContainer, fontSize: t.typography.label.fontSize, fontWeight: '600' },
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
    wheel: { height: 160, overflow: 'hidden' },
    wheelItem: { height: 32, alignItems: 'center', justifyContent: 'center', paddingHorizontal: t.spacing.xs },
    wheelText: { fontSize: t.typography.body.fontSize, color: c.textMuted },
    wheelTextSelected: { color: c.text, fontWeight: '600' },
    wheelBandTop: {
      position: 'absolute', left: 0, right: 0, top: 64,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border,
    },
    wheelBandBottom: {
      position: 'absolute', left: 0, right: 0, top: 96,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border,
    },
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
    panelBody: { paddingBottom: t.spacing.lg },
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
  });
}

export function RgScreen({ children, style, theme: mode }: any) {
  const inherited = useRgTheme();
  const active = mode === 'dark' || mode === 'light' ? makeTheme(mode) : inherited;
  const styles = stylesFor(active);
  return (
    <RgThemeContext.Provider value={active}>
      <SafeAreaView style={[styles.screen, style]}>
        <ScrollView contentContainerStyle={styles.screenContent}>{children}</ScrollView>
      </SafeAreaView>
    </RgThemeContext.Provider>
  );
}

export function RgAppbar({ title, search, menu, avatar, onMenu }: any) {
  const t = useRgTheme();
  const c = t.colors;
  const styles = stylesFor(t);
  // Menu and avatar are opt-in. An app bar shows a menu button only
  // when the app asks for one (the boolean `menu` attribute), and an
  // avatar only when the app passes `avatar` text. Before this fix the
  // bar always drew both: a dead menu icon, and a user avatar built
  // from the title's first letter in apps with no users and no sign
  // in at all (found by the Rangular Tutorial app, 2026-11-12).
  return (
    <View style={styles.appbar}>
      {menu ? (onMenu ? (
        <Pressable onPress={onMenu} style={({ pressed }) => [pressed && styles.buttonPressed]}>
          <RgIcon name="menu" size={24} color="textMuted" />
        </Pressable>
      ) : <RgIcon name="menu" size={24} color="textMuted" />) : null}
      {search ? <Text style={styles.searchText}>{search}</Text> : <Text style={styles.appbarTitle}>{title}</Text>}
      {avatar ? (
        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c.avatar, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: c.onAvatar, fontSize: 12, fontWeight: '600' }}>{String(avatar).charAt(0)}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function RgIconButton({ name, size = 28, color, onPress, style }: any) {
  const styles = stylesFor(useRgTheme());
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        pressed && styles.buttonPressed,
        style,
      ]}
    >
      <RgIcon name={name} size={size} color={color} />
    </Pressable>
  );
}

export function RgSection({ children, style }: any) {
  const styles = stylesFor(useRgTheme());
  return <View style={[styles.section, style]}>{children}</View>;
}

export function RgCard({ children, style }: any) {
  const styles = stylesFor(useRgTheme());
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

export function RgButton({ children, disabled, onPress, badge, style, variant }: any) {
  const styles = stylesFor(useRgTheme());
  const text = variant === 'text';
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        text ? styles.buttonText : styles.button,
        pressed && styles.buttonPressed,
        disabled && styles.buttonDisabled,
        style,
      ]}
    >
      <Text style={text ? styles.buttonTextLabel : styles.buttonLabel}>{children}</Text>
      <BadgeDot value={badge} styles={styles} offset={{ top: -6, right: -6 }} />
    </Pressable>
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
export function RgInput({ value, onChangeText, onBlur, onFocus, placeholder, label, error, disabled, secure, keyboardType, options, onOptionSelected, style }: any) {
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
  return (
    <View style={[styles.inputWrap, style]}>
      {label ? <Text style={styles.inputLabel}>{label}</Text> : null}
      <View style={styles.inputAnchor}>
        <TextInput
          style={[styles.inputField, error ? styles.inputFieldError : null, disabled ? styles.inputDisabled : null]}
          value={value}
          onChangeText={onChangeText}
          onFocus={() => { setFocused(true); onFocus?.(); }}
          onBlur={() => { setFocused(false); onBlur?.(); }}
          placeholder={placeholder}
          placeholderTextColor={t.colors.textMuted}
          editable={!disabled}
          secureTextEntry={!!secure}
          keyboardType={keyboardType}
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

export function RgSwitch({ checked, disabled, onChange, children, style }: any) {
  const t = useRgTheme();
  const c = t.colors;
  const styles = stylesFor(t);
  const isOn = !!checked;
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
    outputRange: [c.surfaceVariant, c.primary],
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
      onPress={() => onChange?.(!isOn)}
      style={[styles.controlRow, disabled && styles.controlDisabled, style]}
    >
      <Animated.View
        style={[
          styles.switchTrack,
          { backgroundColor: trackColor, borderColor: isOn ? c.primary : c.outline },
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

export function RgList({ data, renderItem, keyExtractor, children }: any) {
  // Generated code (Stage 2) renders rows as children, e.g. a *ngFor map,
  // rather than via FlatList's data/renderItem. Support both shapes.
  if (children) return <View>{children}</View>;
  return (
    <FlatList
      data={data}
      renderItem={renderItem}
      keyExtractor={keyExtractor ?? ((item: any, index: number) => String(item?.id ?? index))}
    />
  );
}

export function RgRow({ title, subtitle, detail, time, avatar, onPress, badge, children }: any) {
  const t = useRgTheme();
  const c = t.colors;
  const styles = stylesFor(t);
  const content = (
    <>
      {avatar ? (
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: c.onPrimary, fontSize: 16, fontWeight: '600' }}>{(title || '•').charAt(0)}</Text>
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
    </>
  );
  // A row with an onPress (a (click) handler or a routerLink in the
  // template) is a Pressable; a row without one stays a plain View, so
  // static lists pay nothing for the affordance.
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }: any) => [styles.row, pressed && { opacity: 0.7 }]}>
        {content}
      </Pressable>
    );
  }
  return <View style={styles.row}>{content}</View>;
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

  if (!isOpen) return null;
  const backdropOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.32] });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [260, 0] });
  return (
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

  if (!isOpen) return null;
  const backdropOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.32] });
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] });
  return (
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
  return (
    <View style={[styles.snackbar, style]}>
      <Text style={styles.snackbarText}>{message}</Text>
      {actionLabel ? (
        <Pressable onPress={onAction} accessibilityRole="button">
          <Text style={styles.snackbarAction}>{String(actionLabel).toUpperCase()}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const WHEEL_ITEM_HEIGHT = 32;

/**
 * One iOS style wheel column (Stage 10), internal to the date-time
 * picker: a snapping scroll column, five rows tall, whose selected
 * value sits centred between two hairlines while the rows above and
 * below are muted. Scrolling to rest selects the centred value;
 * tapping a row selects it directly. The wheel's values and the
 * selection math come from ./datetime, shared with the preview.
 */
function RgWheel({ options, value, onSelect, wide }: any) {
  const styles = stylesFor(useRgTheme());
  const selectedIndex = Math.max(0, options.findIndex((o: WheelSpec['options'][number]) => o.value === value));
  const scrollRef = useRef<any>(null);

  // Centre the selected value whenever the wheel opens or a sibling
  // wheel moves the selection (a day clamped by a month change).
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: selectedIndex * WHEEL_ITEM_HEIGHT, animated: false });
  }, [selectedIndex]);

  const selectAtRest = (offsetY: number): void => {
    const idx = Math.min(options.length - 1, Math.max(0, Math.round(offsetY / WHEEL_ITEM_HEIGHT)));
    const opt = options[idx];
    if (opt && opt.value !== value) onSelect?.(opt.value);
  };

  return (
    <View style={[styles.wheel, wide ? { flex: 1.6 } : { flex: 1 }]}>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ITEM_HEIGHT}
        decelerationRate="fast"
        onScrollEndDrag={(e: any) => selectAtRest(e.nativeEvent.contentOffset.y)}
        onMomentumScrollEnd={(e: any) => selectAtRest(e.nativeEvent.contentOffset.y)}
        contentContainerStyle={{ paddingVertical: WHEEL_ITEM_HEIGHT * 2 }}
      >
        {options.map((o: WheelSpec['options'][number]) => (
          <Pressable key={o.value} onPress={() => onSelect?.(o.value)} style={styles.wheelItem}>
            <Text style={[styles.wheelText, o.value === value ? styles.wheelTextSelected : null]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <View pointerEvents="none" style={styles.wheelBandTop} />
      <View pointerEvents="none" style={styles.wheelBandBottom} />
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
 * the formatted value; tapping it opens a bottom sheet of wheels
 * (date mode: month, day, year; time mode: hour 1 to 12, minute,
 * AM/PM; datetime mode: one combined date wheel plus hour, minute
 * and AM/PM). Done commits the pending value through onChange as
 * an ISO string; Cancel discards it. `value` accepts an ISO string
 * or a Date; an unparseable value falls back to the current time.
 * minuteInterval is 1 or 5 (the compiler snaps anything else).
 */
export function RgDateTimePicker({ value, mode = 'datetime', label, minuteInterval = 1, onChange, style }: any) {
  const t = useRgTheme();
  const styles = stylesFor(t);
  const pickerMode: PickerMode = mode === 'date' || mode === 'time' ? mode : 'datetime';
  const interval = minuteInterval === 5 ? 5 : 1;
  const current: DateTimeParts = parseDateTimeValue(value) ?? nowParts();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<DateTimeParts>(current);

  const start = (): void => {
    // The wheel cannot rest between steps: with a 5 minute interval
    // a value like 9:03 opens on the nearest step, and Done emits
    // that step even if the minute wheel itself is never touched.
    const step = interval === 5 ? 5 : 1;
    const minute = Math.min(60 - step, Math.round(current.minute / step) * step);
    setPending({ ...current, minute });
    setOpen(true);
  };
  const done = (): void => {
    setOpen(false);
    onChange?.(composeDateTimeIso(pending));
  };
  const cancel = (): void => setOpen(false);
  const wheels: WheelSpec[] = dateTimeWheels(pending, pickerMode, interval);

  return (
    <View style={[styles.inputWrap, style]}>
      {label ? <Text style={styles.inputLabel}>{label}</Text> : null}
      <Pressable onPress={start} style={styles.pickerBox} accessibilityRole="button">
        <Text style={styles.pickerValue}>{formatDateTimeValue(current, pickerMode)}</Text>
        <RgIcon name="calendar" size={20} color="textMuted" />
      </Pressable>
      <RgSheet open={open} onClose={cancel}>
        <View style={styles.pickerHead}>
          <Pressable onPress={cancel} accessibilityRole="button">
            <Text style={styles.pickerHeadBtn}>Cancel</Text>
          </Pressable>
          <Text style={styles.pickerHeadTitle}>{label ?? 'Choose'}</Text>
          <Pressable onPress={done} accessibilityRole="button">
            <Text style={[styles.pickerHeadBtn, styles.pickerHeadDone]}>Done</Text>
          </Pressable>
        </View>
        <View style={styles.wheelsRow}>
          {wheels.map((wheel) => (
            <RgWheel
              key={wheel.name}
              options={wheel.options}
              value={wheel.value}
              wide={wheel.name === 'date'}
              onSelect={(v: string) => setPending((p: DateTimeParts) => applyWheelValue(p, wheel.name, v))}
            />
          ))}
        </View>
      </RgSheet>
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
      {items[active] ? <View>{items[active].content}</View> : null}
    </View>
  );
}

export function RgAccordion({ children, style }: any) {
  // Single-open coordination, mat-accordion with multi=false: the
  // group holds which direct panel child is open and injects it as
  // the internal __groupExpanded and __groupToggle props (the same
  // compiler-internal prop pattern as __rgRoute in routing), so the
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

export function RgColumn({ name, header }: any) {
  // One column definition of an RgTable: `name` is the row property
  // the column displays (Angular Material's matColumnDef name) and
  // `header` its header text. The table reads both; the marker
  // renders nothing, like RgTab.
  void name;
  void header;
  return null;
}

export function RgTable({ data, emptyText, children, style }: any) {
  const styles = stylesFor(useRgTheme());
  const columns = React.Children.toArray(children)
    .filter((child) => React.isValidElement(child))
    .map((child) => {
      const el = child as React.ReactElement<any>;
      return { name: el.props.name, header: el.props.header };
    })
    .filter((col) => typeof col.name === 'string');
  const rows = Array.isArray(data) ? data : [];
  return (
    <View style={[styles.table, style]}>
      <View style={styles.tableRow}>
        {columns.map((col) => (
          <Text key={col.name} style={styles.tableHeadCell}>{col.header ?? col.name}</Text>
        ))}
      </View>
      {rows.map((row: any, i: number) => (
        <View key={i} style={styles.tableRow}>
          {columns.map((col) => (
            <Text key={col.name} style={styles.tableCell}>{String(row?.[col.name] ?? '')}</Text>
          ))}
        </View>
      ))}
      {!rows.length && emptyText ? <Text style={styles.tableEmpty}>{emptyText}</Text> : null}
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
