/**
 * Data colours (Stage 15), pure TypeScript with no imports.
 *
 * These are not theme colours and they are not design tokens: they
 * are the fixed categorical palette that charts colour their series
 * with and the colour picker offers as its swatch grid. Data colours
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
