/**
 * @rangular/ui primitives — SHIPPED SOURCE for generated apps.
 *
 * These components are copied/bundled into generated React Native apps; they
 * are NOT typechecked by this repo's root build (react-native types are not a
 * dependency here) and are excluded from tsconfig for that reason. They are
 * written against react-native + the pure-TS tokens in ./tokens.
 *
 * Polish rule: simple template blocks compile to these pre-polished
 * primitives, never to raw equivalents — see docs/UI_POLISH.md.
 */
import React from 'react';
import {
  FlatList,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { theme } from './tokens';

const t = theme('light');
const c = t.colors;

const styles = StyleSheet.create({
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
    backgroundColor: '#c2e7ff', borderRadius: t.radius.lg,
    paddingHorizontal: 18, paddingVertical: 13,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 4, elevation: 3,
  },
  fabLabel: { color: '#001d35', fontSize: t.typography.body.fontSize, fontWeight: '600' },
});

export function RgScreen({ children, style }: any) {
  return (
    <SafeAreaView style={[styles.screen, style]}>
      <ScrollView contentContainerStyle={styles.screenContent}>{children}</ScrollView>
    </SafeAreaView>
  );
}

export function RgAppbar({ title, search }: any) {
  return (
    <View style={styles.appbar}>
      <Text style={{ color: c.textMuted, fontSize: 17 }}>☰</Text>
      {search ? <Text style={styles.searchText}>{search}</Text> : <Text style={styles.appbarTitle}>{title}</Text>}
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#7b1fa2', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{(title || 'R').charAt(0)}</Text>
      </View>
    </View>
  );
}

export function RgCard({ children, style }: any) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function RgText({ children, variant = 'body', style }: any) {
  const step = (t.typography as any)[variant] ?? t.typography.body;
  return (
    <Text style={[{ fontSize: step.fontSize, lineHeight: step.lineHeight, color: c.text }, style]}>
      {children}
    </Text>
  );
}

export function RgButton({ children, disabled, onPress, style }: any) {
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

export function RgList({ data, renderItem, keyExtractor }: any) {
  return (
    <FlatList
      data={data}
      renderItem={renderItem}
      keyExtractor={keyExtractor ?? ((item: any, index: number) => String(item?.id ?? index))}
    />
  );
}

export function RgRow({ title, subtitle, detail, time, children }: any) {
  return (
    <View style={styles.row}>
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
  return (
    <Pressable style={styles.fab} onPress={onPress}>
      <Text style={styles.fabLabel}>{children ?? label ?? 'Compose'}</Text>
    </Pressable>
  );
}
