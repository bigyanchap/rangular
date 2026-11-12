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
]);

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
      if (!isClass && !/^[a-z][a-z0-9-]*$/i.test(selector)) {
        diagnostics.push(warning('CSS_SELECTOR', `Unsupported selector '${selector}' — only element and .class selectors are supported`, undefined, undefined, `Rewrite '${selector}' as an element selector (h1) or a single class (.card-note); descendant, id and pseudo selectors are not supported`));
        continue;
      }
      const styleObj: Record<string, string | number> = (styles[key] ??= {});
      for (const decl of declarations) {
        const colon = decl.indexOf(':');
        if (colon === -1) {
          diagnostics.push(warning('CSS_DECL', `Malformed declaration '${decl}'`, undefined, undefined, "Write each declaration as 'property: value' — e.g. 'color: #5f6368;'"));
          continue;
        }
        const rawProp = decl.slice(0, colon).trim();
        const rawValue = decl.slice(colon + 1).trim();
        const prop = camelCase(rawProp);
        if (!SUPPORTED.has(prop)) {
          diagnostics.push(warning('CSS_UNSUPPORTED', `Unsupported CSS property '${rawProp}' in '${selector}' — dropped`, undefined, undefined, `Remove '${rawProp}' or use a supported property (color, background-color, font-size, font-weight, margin/padding, border-radius, border-width/color, opacity, flex, flex-direction, align-items, justify-content, gap, width/height)`));
          continue;
        }
        styleObj[prop] = convertValue(rawValue);
      }
    }
  }
  return { styles, diagnostics };
}
