/**
 * Rangular Material design tokens — pure TypeScript, no react-native imports.
 * Every visual value in a generated app comes from here; generated code never
 * contains magic numbers. See docs/UI_POLISH.md.
 */

export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32,
} as const;
export const spacingScale: number[] = [4, 8, 12, 16, 20, 24, 32];

export const radius = {
  sm: 8, md: 12, lg: 16, xl: 20, full: 9999,
} as const;
export const radiusScale: number[] = [8, 12, 16, 20, 9999];

export interface TypeStep { fontSize: number; lineHeight: number; fontWeight: string }

export const typeScale: Record<'caption' | 'body' | 'bodyLarge' | 'label' | 'title' | 'heading' | 'display', TypeStep> = {
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  body: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  bodyLarge: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  title: { fontSize: 20, lineHeight: 28, fontWeight: '600' },
  heading: { fontSize: 24, lineHeight: 32, fontWeight: '700' },
  display: { fontSize: 32, lineHeight: 40, fontWeight: '700' },
};

/** Colour roles — the same role names exist in both modes, always. */
export interface ColourRoles {
  primary: string;
  onPrimary: string;
  accent: string;
  background: string;
  surface: string;
  surfaceVariant: string;
  text: string;
  textMuted: string;
  danger: string;
  border: string;
  outline: string;
}

export const colours: Record<'light' | 'dark', ColourRoles> = {
  light: {
    primary: '#0b57d0',
    onPrimary: '#ffffff',
    accent: '#0b57d0',
    background: '#ffffff',
    surface: '#ffffff',
    surfaceVariant: '#f0f4f9',
    text: '#1f1f1f',
    textMuted: '#5f6368',
    danger: '#b3261e',
    border: '#dadce0',
    outline: '#747775',
  },
  dark: {
    primary: '#a8c7fa',
    onPrimary: '#062e6f',
    accent: '#a8c7fa',
    background: '#131314',
    surface: '#1e1f20',
    surfaceVariant: '#282a2c',
    text: '#e3e3e3',
    textMuted: '#9aa0a6',
    danger: '#f2b8b5',
    border: '#444746',
    outline: '#8e918f',
  },
};

export type ThemeMode = 'light' | 'dark';

export interface Theme {
  mode: ThemeMode;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typeScale;
  colors: ColourRoles;
}

export function theme(mode: ThemeMode): Theme {
  return { mode, spacing, radius, typography: typeScale, colors: colours[mode] };
}
