import { radiusScale, spacingScale, typeScale } from '../../../ui/src/tokens';
import { Diagnostic, warning } from '../diagnostics';

/** RN style properties Rangular's CSS subset supports in Stage 0+1. */
const SUPPORTED = new Set([
  'color', 'backgroundColor', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight',
  'letterSpacing', 'textAlign', 'margin', 'marginTop', 'marginBottom', 'marginLeft',
  'marginRight', 'marginHorizontal', 'marginVertical', 'padding', 'paddingTop',
  'paddingBottom', 'paddingLeft', 'paddingRight', 'paddingHorizontal',
  'paddingVertical', 'borderRadius', 'borderWidth', 'borderColor', 'opacity',
  'flex', 'flexDirection', 'alignItems', 'justifyContent', 'gap', 'width', 'height',
  'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
  'top', 'left', 'right', 'bottom',
]);

/**
 * Token snapping (Stage 4, docs/UI_POLISH.md part 1): spacing-like values,
 * border-radius and font sizes resolve to the NEAREST design-token scale
 * value at compile time. An off-scale value still compiles, with the
 * snapped value in the generated StyleSheet, but earns a STYLE_OFF_SCALE
 * warning whose fix names the snapped value. On-scale values (and 0,
 * "no spacing") pass silently. Colours are never snapped.
 */
const SPACING_PROPS = new Set([
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
  'marginHorizontal', 'marginVertical', 'padding', 'paddingTop',
  'paddingBottom', 'paddingLeft', 'paddingRight', 'paddingHorizontal',
  'paddingVertical', 'gap', 'top', 'left', 'right', 'bottom',
]);
const RADIUS_PROPS = new Set(['borderRadius']);
const TYPE_SCALE_SIZES: number[] = [...new Set(Object.values(typeScale).map((s) => s.fontSize))].sort((a, b) => a - b);
const TYPE_STEP_BY_SIZE = new Map<number, string>(
  Object.entries(typeScale).map(([name, step]) => [step.fontSize, name]),
);

/** Nearest value in an ascending scale; ties resolve to the LOWER value. */
export function nearestOnScale(scale: number[], value: number): number {
  let best = scale[0];
  for (const candidate of scale) {
    if (Math.abs(candidate - value) < Math.abs(best - value)) best = candidate;
  }
  return best;
}

/** The supported CSS property set, exported for doctor and the parity guard. */
export const SUPPORTED_STYLE_PROPERTIES: ReadonlySet<string> = SUPPORTED;

/**
 * The value the snapper would produce for a property, or undefined when
 * the property is not snapped at all (colours, width, height and friends
 * never snap) or the value is exempt (spacing 0, radius full). Doctor
 * reuses this so its DOC_OFF_SCALE check can never drift from the
 * compiler's own snapping behaviour.
 */
export function snapForProp(prop: string, value: number): number | undefined {
  if (SPACING_PROPS.has(prop)) {
    if (value === 0) return undefined;
    return value < 0 ? -nearestOnScale(spacingScale, -value) : nearestOnScale(spacingScale, value);
  }
  if (RADIUS_PROPS.has(prop)) {
    if (value === 9999) return undefined;
    return nearestOnScale(radiusScale.filter((n) => n < 9000), value);
  }
  if (prop === 'fontSize') return nearestOnScale(TYPE_SCALE_SIZES, value);
  return undefined;
}

function snapValue(
  prop: string,
  rawProp: string,
  value: string | number,
  diagnostics: Diagnostic[],
): string | number {
  if (typeof value !== 'number') return value;
  let scale: number[];
  let scaleName: string;
  let scaleList: string;
  if (SPACING_PROPS.has(prop)) {
    if (value === 0) return value;
    scale = spacingScale; scaleName = 'spacing scale';
    scaleList = spacingScale.join(', ');
  } else if (RADIUS_PROPS.has(prop)) {
    if (value === 9999) return value; // radius.full, on-scale by definition
    scale = radiusScale.filter((n) => n < 9000); scaleName = 'radius scale';
    scaleList = `${scale.join(', ')}, full`;
  } else if (prop === 'fontSize') {
    scale = TYPE_SCALE_SIZES; scaleName = 'type scale';
    scaleList = TYPE_SCALE_SIZES.map((n) => `${n} (${TYPE_STEP_BY_SIZE.get(n)})`).join(', ');
  } else {
    return value;
  }
  const snapped = value < 0 ? -nearestOnScale(scale, -value) : nearestOnScale(scale, value);
  if (snapped === value) return value;
  diagnostics.push(warning(
    'STYLE_OFF_SCALE',
    `${rawProp}: ${value}px is off the ${scaleName}, snapped to ${snapped}`,
    undefined, undefined,
    `Use an on-scale value from the ${scaleName} (${scaleList}), e.g. ${rawProp}: ${snapped}px`,
  ));
  return snapped;
}

export interface ParsedCss {
  /** selector (element tag or class name without '.') -> RN style object */
  styles: Record<string, Record<string, string | number>>;
  diagnostics: Diagnostic[];
}

function camelCase(prop: string): string {
  return prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function convertValue(raw: string): string | number {
  const px = raw.match(/^(-?\d+(?:\.\d+)?)px$/);
  if (px) return Number(px[1]);
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

/**
 * Tiny CSS-subset parser: `selector { prop: value; }` rules for element and
 * .class selectors only. Unsupported properties become warnings, not crashes.
 */
export function parseCss(cssText: string): ParsedCss {
  const styles: Record<string, Record<string, string | number>> = {};
  const diagnostics: Diagnostic[] = [];
  const text = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = ruleRe.exec(text)) !== null) {
    const selectors = match[1].split(',').map((s) => s.trim()).filter(Boolean);
    const declarations = match[2].split(';').map((d) => d.trim()).filter(Boolean);
    for (const selector of selectors) {
      const isClass = selector.startsWith('.');
      const key = isClass ? selector.slice(1) : selector;
      // Class keys are emitted as StyleSheet property names and object
      // keys in generated code, so they must be plain identifiers, the
      // same discipline element selectors already get below.
      if (isClass && !/^[A-Za-z_-][A-Za-z0-9_-]*$/.test(key)) {
        diagnostics.push(warning('CSS_SELECTOR', `Unsupported selector '${selector}', only element and .class selectors are supported`, undefined, undefined, `Rewrite '${selector}' as an element selector (h1) or a single class (.card-note); descendant, id and pseudo selectors are not supported`));
        continue;
      }
      if (!isClass && !/^[a-z][a-z0-9-]*$/i.test(selector)) {
        diagnostics.push(warning('CSS_SELECTOR', `Unsupported selector '${selector}', only element and .class selectors are supported`, undefined, undefined, `Rewrite '${selector}' as an element selector (h1) or a single class (.card-note); descendant, id and pseudo selectors are not supported`));
        continue;
      }
      const styleObj: Record<string, string | number> = (styles[key] ??= {});
      for (const decl of declarations) {
        const colon = decl.indexOf(':');
        if (colon === -1) {
          diagnostics.push(warning('CSS_DECL', `Malformed declaration '${decl}'`, undefined, undefined, "Write each declaration as 'property: value', e.g. 'color: #5f6368;'"));
          continue;
        }
        const rawProp = decl.slice(0, colon).trim();
        const rawValue = decl.slice(colon + 1).trim();
        const prop = camelCase(rawProp);
        if (!SUPPORTED.has(prop)) {
          diagnostics.push(warning('CSS_UNSUPPORTED', `Unsupported CSS property '${rawProp}' in '${selector}', dropped`, undefined, undefined, `Remove '${rawProp}' or use a supported property (color, background-color, font-size, font-weight, margin/padding, border-radius, border-width/color, opacity, flex, flex-direction, align-items, justify-content, gap, width/height)`));
          continue;
        }
        styleObj[prop] = snapValue(prop, rawProp, convertValue(rawValue), diagnostics);
      }
    }
  }
  return { styles, diagnostics };
}
