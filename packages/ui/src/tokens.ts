/**
 * Rangular Material design tokens, pure TypeScript, no react-native imports.
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

/**
 * Colour roles, the same role names exist in both modes, always.
 *
 * Stage 4 completed the set to the full Material 3 role list the polish
 * system needs. Two naming families coexist on purpose:
 *  - the Material names (onSurface, onSurfaceVariant, error, ...) and
 *  - the original Rangular aliases (text === onSurface,
 *    textMuted === onSurfaceVariant, danger === error, border is the
 *    hairline colour next to outline).
 * Aliases always carry the SAME value as their Material counterpart in
 * each mode, existing code referencing the old names keeps working and
 * keeps meaning the same thing.
 */
export interface ColourRoles {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  accent: string;
  background: string;
  surface: string;
  surfaceVariant: string;
  onSurface: string;
  onSurfaceVariant: string;
  text: string;
  textMuted: string;
  error: string;
  onError: string;
  danger: string;
  border: string;
  outline: string;
  scrim: string;
  avatar: string;
  onAvatar: string;
  // Code block (tutorial round, 2026-11-13): an editor surface that
  // is dark on purpose in BOTH themes, the way editors look, so a
  // code sample never reads as body text.
  codeSurface: string;
  codeText: string;
  // Toast (tutorial round, 2026-11-13): the SnackBar toast card is
  // a translucent black surface, dark in both themes. The surface
  // carries its own 85 percent alpha (eight digit hex); the text
  // and action colours are chosen to read on near black.
  toastSurface: string;
  toastText: string;
  toastAction: string;
}

export const colours: Record<'light' | 'dark', ColourRoles> = {
  light: {
    primary: '#0b57d0',
    onPrimary: '#ffffff',
    primaryContainer: '#d3e3fd',
    onPrimaryContainer: '#041e49',
    secondary: '#00639b',
    secondaryContainer: '#cde6ff',
    onSecondaryContainer: '#001d32',
    accent: '#0b57d0',
    background: '#ffffff',
    surface: '#ffffff',
    surfaceVariant: '#f0f4f9',
    onSurface: '#1f1f1f',
    onSurfaceVariant: '#5f6368',
    text: '#1f1f1f',
    textMuted: '#5f6368',
    error: '#b3261e',
    onError: '#ffffff',
    danger: '#b3261e',
    border: '#dadce0',
    outline: '#747775',
    scrim: '#000000',
    avatar: '#7b1fa2',
    onAvatar: '#ffffff',
    codeSurface: '#1e1e1e',
    codeText: '#d4d4d4',
    toastSurface: '#000000d9',
    toastText: '#f1f3f4',
    toastAction: '#a8c7fa',
  },
  dark: {
    primary: '#a8c7fa',
    onPrimary: '#062e6f',
    primaryContainer: '#004a77',
    onPrimaryContainer: '#d3e3fd',
    secondary: '#8ecbf2',
    secondaryContainer: '#004b70',
    onSecondaryContainer: '#cde6ff',
    accent: '#a8c7fa',
    background: '#131314',
    surface: '#1e1f20',
    surfaceVariant: '#282a2c',
    onSurface: '#e3e3e3',
    onSurfaceVariant: '#9aa0a6',
    text: '#e3e3e3',
    textMuted: '#9aa0a6',
    error: '#f2b8b5',
    onError: '#601410',
    danger: '#f2b8b5',
    border: '#444746',
    outline: '#8e918f',
    scrim: '#000000',
    avatar: '#d0bcff',
    onAvatar: '#381e72',
    codeSurface: '#1e1e1e',
    codeText: '#d4d4d4',
    toastSurface: '#000000d9',
    toastText: '#f1f3f4',
    toastAction: '#a8c7fa',
  },
};

/** One elevation preset: an RN shadow style object, never free-hand values. */
export interface ElevationPreset {
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: { width: number; height: number };
  elevation: number;
}

/** Elevation presets, 3 named levels (docs/UI_POLISH.md part 1). */
export const elevation: Record<'level0' | 'level1' | 'level2', ElevationPreset> = {
  level0: {
    shadowColor: '#000000', shadowOpacity: 0, shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 }, elevation: 0,
  },
  level1: {
    shadowColor: '#000000', shadowOpacity: 0.15, shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  level2: {
    shadowColor: '#000000', shadowOpacity: 0.25, shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
};

export type ThemeMode = 'light' | 'dark';

export interface Theme {
  mode: ThemeMode;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typeScale;
  colors: ColourRoles;
  elevation: typeof elevation;
}

export function theme(mode: ThemeMode): Theme {
  return { mode, spacing, radius, typography: typeScale, colors: colours[mode], elevation };
}

/** Both themes as ready-made objects: `themes.light` / `themes.dark`. */
export const themes: Record<ThemeMode, Theme> = {
  light: theme('light'),
  dark: theme('dark'),
};
