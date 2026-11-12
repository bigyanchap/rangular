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
import React, { createContext, useContext } from 'react';
import {
  FlatList,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { theme as makeTheme } from './tokens';
import type { Theme } from './tokens';

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
      <Text style={{ color: c.textMuted, fontSize: 17 }}>☰</Text>
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
