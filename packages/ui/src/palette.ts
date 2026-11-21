/**
 * Data colours (Stage 15), pure TypeScript with no imports.
 *
 * These are not theme colours and they are not design tokens: they
 * are the fixed categorical palette that charts colour their series
 * with and the colour picker offers as preset swatches. Data colours
 * behave like brand colours (the dinacharya gold is the in-repo
 * precedent): they stay the same in light and dark themes, because a
 * chart series or a picked colour must not change identity when the
 * theme flips. A chart point may override its colour with its own
 * `color` field; the colour picker's value is a hex string from (or
 * beyond) this list.
 *
 * The list lives here, not in primitives.tsx, because primitives
 * hold no hard-coded hex values at all (a guard test enforces it):
 * theme colours come from tokens, data colours come from here.
 */
export const COLOR_SWATCHES: string[] = [
  '#0b57d0', '#1e8e3e', '#f9ab00', '#d93025',
  '#9334e6', '#e37400', '#12a5af', '#c2185b',
  '#5f6368', '#80868b', '#202124', '#ffffff',
];

/**
 * Avatar tones (Gmail light round, 2026-11-17): pastel background
 * and foreground pairs for row avatar tiles that vary by label,
 * the Gmail list look. Data colours, like the swatches above:
 * they do not change with the theme.
 */
export const AVATAR_TONES: { bg: string; fg: string }[] = [
  { bg: '#e8f0fe', fg: '#0b57d0' },
  { bg: '#f3e8fd', fg: '#9334e6' },
  { bg: '#fce8e6', fg: '#c5221f' },
  { bg: '#e6f4ea', fg: '#137333' },
  { bg: '#fef7e0', fg: '#b06000' },
];

/**
 * The same five pairs under names (Option A round, 2026-11-17),
 * so a row can ask for a tone by meaning: a done lesson's tile is
 * `green`, the current lesson's is `blue`. `varied` keeps the
 * hash pick from the array above.
 */
export const AVATAR_TONE_NAMES: Record<string, { bg: string; fg: string }> = {
  blue: AVATAR_TONES[0],
  purple: AVATAR_TONES[1],
  red: AVATAR_TONES[2],
  green: AVATAR_TONES[3],
  amber: AVATAR_TONES[4],
};

/**
 * Hue stops for the colour picker's rainbow bar: the pure hues
 * at full saturation and value, in wheel order, returning to
 * red at the bottom so the bar loops seamlessly.
 */
export const HUE_STOPS: string[] = [
  '#ff0000', '#ffff00', '#00ff00', '#00ffff',
  '#0000ff', '#ff00ff', '#ff0000',
];

/**
 * The saturation and value square's two anchors: true white at
 * the top left corner and true black along the bottom edge, in
 * every theme, because they are points in the colour space,
 * not theme roles.
 */
export const SV_WHITE = '#ffffff';
export const SV_BLACK = '#000000';

/**
 * A six digit hex string as hue (0 to 360), saturation and
 * value (0 to 1), or null when the text is not a hex colour.
 * The colour picker drafts in hsv: the hue bar sets h, the
 * square sets s and v, and hsvToHex commits the result.
 */
export function hexToHsv(hex: string): { h: number; s: number; v: number } | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/** Hue, saturation and value back to a lowercase hex string. */
export function hsvToHex(h: number, s: number, v: number): string {
  const hh = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) { r = c; g = x; }
  else if (hh < 120) { r = x; g = c; }
  else if (hh < 180) { g = c; b = x; }
  else if (hh < 240) { g = x; b = c; }
  else if (hh < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const part = (n: number): string => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return '#' + part(r) + part(g) + part(b);
}
