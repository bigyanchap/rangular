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
import React, { createContext, useContext, useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  FlatList,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Svg, Path } from 'react-native-svg';
import { theme as makeTheme } from './tokens';
import type { Theme } from './tokens';
import { ICON_PATHS } from './icons';

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
export function RgIcon({ name, size = 24, color, style }: any) {
  const t = useRgTheme();
  const paths = ICON_PATHS[name as string] ?? [];
  const fill = color
    ? ((t.colors as unknown as Record<string, string>)[color as string] ?? color)
    : t.colors.text;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={style}>
      {paths.map((d: string, i: number) => (
        <Path key={i} d={d} fill={fill} />
      ))}
    </Svg>
  );
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
    screenContent: { paddingBottom: t.spacing.xxl },
    appbar: {
      flexDirection: 'row', alignItems: 'center', gap: t.spacing.md,
      margin: t.spacing.md, paddingHorizontal: t.spacing.lg, paddingVertical: 10,
      backgroundColor: c.surfaceVariant, borderRadius: t.radius.full,
    },
    appbarTitle: { flex: 1, fontSize: t.typography.title.fontSize, fontWeight: '600', color: c.text },
    searchText: { flex: 1, fontSize: t.typography.body.fontSize, color: c.textMuted },
    card: {
      backgroundColor: c.surfaceVariant, borderColor: c.border, borderWidth: 1,
      borderRadius: t.radius.lg, padding: t.spacing.lg,
      marginHorizontal: t.spacing.lg, marginBottom: t.spacing.lg,
    },
    button: {
      backgroundColor: c.primary, borderRadius: t.radius.full,
      minHeight: 48, paddingHorizontal: t.spacing.xxl,
      alignItems: 'center', justifyContent: 'center',
      marginHorizontal: t.spacing.lg,
    },
    buttonPressed: { opacity: 0.85 },
    buttonDisabled: { opacity: 0.38 },
    buttonLabel: { color: c.onPrimary, fontSize: t.typography.label.fontSize, fontWeight: '600' },
    controlRow: {
      minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: t.spacing.md,
      paddingVertical: t.spacing.sm, paddingHorizontal: t.spacing.lg,
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
      marginHorizontal: t.spacing.lg, marginVertical: t.spacing.sm,
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
      flexDirection: 'row', gap: t.spacing.md, alignItems: 'flex-start',
      paddingVertical: 11, paddingHorizontal: t.spacing.lg,
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

export function RgAppbar({ title, search }: any) {
  const t = useRgTheme();
  const c = t.colors;
  const styles = stylesFor(t);
  return (
    <View style={styles.appbar}>
      <RgIcon name="menu" size={24} color="textMuted" />
      {search ? <Text style={styles.searchText}>{search}</Text> : <Text style={styles.appbarTitle}>{title}</Text>}
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c.avatar, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: c.onAvatar, fontSize: 12, fontWeight: '600' }}>{(title || 'R').charAt(0)}</Text>
      </View>
    </View>
  );
}

export function RgCard({ children, style }: any) {
  const styles = stylesFor(useRgTheme());
  return <View style={[styles.card, style]}>{children}</View>;
}

export function RgText({ children, variant = 'body', style }: any) {
  const t = useRgTheme();
  const step = (t.typography as any)[variant] ?? t.typography.body;
  return (
    <Text style={[{ fontSize: step.fontSize, lineHeight: step.lineHeight, color: t.colors.text }, style]}>
      {children}
    </Text>
  );
}

export function RgButton({ children, disabled, onPress, style }: any) {
  const styles = stylesFor(useRgTheme());
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        pressed && styles.buttonPressed,
        disabled && styles.buttonDisabled,
        style,
      ]}
    >
      <Text style={styles.buttonLabel}>{children}</Text>
    </Pressable>
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

export function RgRow({ title, subtitle, detail, time, avatar, children }: any) {
  const t = useRgTheme();
  const c = t.colors;
  const styles = stylesFor(t);
  return (
    <View style={styles.row}>
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
    </View>
  );
}

export function RgFab({ children, label, onPress }: any) {
  const styles = stylesFor(useRgTheme());
  return (
    <Pressable style={styles.fab} onPress={onPress}>
      <Text style={styles.fabLabel}>{children ?? label ?? 'Compose'}</Text>
    </Pressable>
  );
}
