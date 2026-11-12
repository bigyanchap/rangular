import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';
import { DIAGNOSTIC_CODES } from './diagnostics';
import { EVENT_PROPS, TAG_MAP } from './codegen/generate';
import {
  colours,
  elevation,
  radius,
  radiusScale,
  spacing,
  spacingScale,
  themes,
  typeScale,
} from '../../ui/src/tokens';
import { ICON_NAMES } from '../../ui/src/icons';

/**
 * The machine-readable catalog of everything an author (human or AI) can
 * use in Rangular source, generated FROM the code, never hand-maintained:
 *
 *  - tags:        TAG_MAP in codegen/generate.ts (the same table codegen renders from)
 *  - primitives:  prop names parsed from packages/ui/src/primitives.tsx with
 *                 the TypeScript compiler API. The primitives are deliberately
 *                 typed `any` (shipped source), so the destructured parameter
 *                 pattern of each exported Rg* function is the reliable,
 *                 drift-free source of prop names.
 *  - tokens:      imported from @rangular/ui tokens and serialised.
 *  - icons:       ICON_NAMES from @rangular/ui icons.ts, the same set the
 *                 compiler validates <icon> names against.
 *  - diagnostics: DIAGNOSTIC_CODES in diagnostics.ts.
 */

export interface CatalogTag {
  tag: string;
  component: string;
  from: '@rangular/ui' | 'react-native';
  variant?: string;
}

export interface CatalogPrimitive {
  name: string;
  props: { name: string; type: string }[];
}

export interface Catalog {
  name: string;
  version: string;
  tags: CatalogTag[];
  events: { event: string; rnProp: string; note?: string }[];
  primitives: CatalogPrimitive[];
  icons: string[];
  tokens: {
    spacing: typeof spacing;
    spacingScale: number[];
    radius: typeof radius;
    radiusScale: number[];
    typeScale: typeof typeScale;
    colours: typeof colours;
    elevation: typeof elevation;
    themes: typeof themes;
  };
  diagnostics: { code: string; meaning: string }[];
}

/** Walk up from a start directory until packages/ui/src/primitives.tsx is found. */
export function findRepoRoot(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'packages', 'ui', 'src', 'primitives.tsx'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

export function parsePrimitives(source: string, fileName = 'primitives.tsx'): CatalogPrimitive[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const primitives: CatalogPrimitive[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && /^Rg[A-Z]/.test(node.name.text)) {
      const param = node.parameters[0];
      const props: { name: string; type: string }[] = [];
      if (param) {
        const typeText = param.type ? param.type.getText(sf) : 'any';
        if (ts.isObjectBindingPattern(param.name)) {
          for (const el of param.name.elements) {
            props.push({ name: el.name.getText(sf), type: typeText });
          }
        }
      }
      primitives.push({ name: node.name.text, props });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return primitives;
}

export function buildCatalog(options: { primitivesPath?: string; fromDir?: string } = {}): Catalog {
  let primitives: CatalogPrimitive[] = [];
  let version = '0.0.0';
  const primPath = options.primitivesPath
    ?? (() => {
      const root = findRepoRoot(options.fromDir ?? __dirname);
      return root ? path.join(root, 'packages', 'ui', 'src', 'primitives.tsx') : undefined;
    })();
  if (primPath && fs.existsSync(primPath)) {
    primitives = parsePrimitives(fs.readFileSync(primPath, 'utf8'), path.basename(primPath));
    const root = findRepoRoot(path.dirname(primPath));
    if (root) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
        if (typeof pkg.version === 'string') version = pkg.version;
      } catch { /* version stays 0.0.0 */ }
    }
  }

  const tags: CatalogTag[] = Object.entries(TAG_MAP).map(([tag, m]) => ({
    tag,
    component: m.component,
    from: m.fromUi ? '@rangular/ui' : 'react-native',
    ...(m.variant ? { variant: m.variant } : {}),
  }));

  const events = Object.entries(EVENT_PROPS).map(([event, rnProp]) => ({ event, rnProp }));
  events.push({
    event: 'input',
    rnProp: 'onChangeText',
    note: 'On <input> only; on any other tag (input) maps to onInput and the compiler notes it has no standard RN prop.',
  } as { event: string; rnProp: string; note?: string });

  return {
    name: 'rangular',
    version,
    tags,
    events,
    primitives,
    icons: [...ICON_NAMES],
    tokens: { spacing, spacingScale, radius, radiusScale, typeScale, colours, elevation, themes },
    diagnostics: Object.entries(DIAGNOSTIC_CODES).map(([code, meaning]) => ({ code, meaning })),
  };
}

export function renderCatalogMarkdown(catalog: Catalog): string {
  const lines: string[] = [];
  lines.push('# Rangular catalog');
  lines.push('');
  lines.push(`Generated by \`rangular catalog\` from the compiler, UI primitives and tokens, do not edit by hand. Version ${catalog.version}.`);
  lines.push('');
  lines.push('## Template tags');
  lines.push('');
  lines.push('| Tag | Generates | From | Text variant |');
  lines.push('|---|---|---|---|');
  for (const t of catalog.tags) {
    lines.push(`| \`<${t.tag}>\` | \`${t.component}\` | ${t.from} | ${t.variant ?? '-'} |`);
  }
  lines.push('');
  lines.push('Any other Capitalised or dashed tag is treated as an app component and passed through; any other lowercase tag warns (GEN_UNKNOWN_TAG) and becomes <View>.');
  lines.push('');
  lines.push('## Events');
  lines.push('');
  lines.push('| Template event | React Native prop |');
  lines.push('|---|---|');
  for (const e of catalog.events) {
    lines.push(`| \`(${e.event})\` | \`${e.rnProp}\`${e.note ? `, ${e.note}` : ''} |`);
  }
  lines.push('');
  lines.push('Any other (event) maps to on<Event> with a compiler comment that it has no standard RN prop.');
  lines.push('');
  lines.push('## Primitives and their props');
  lines.push('');
  lines.push('Props are parsed from `packages/ui/src/primitives.tsx`; the primitives are shipped source typed `any`, so every prop type is `any` today.');
  lines.push('');
  for (const p of catalog.primitives) {
    lines.push(`### ${p.name}`);
    lines.push('');
    if (!p.props.length) lines.push('No props.');
    for (const prop of p.props) lines.push(`- \`${prop.name}\`: ${prop.type}`);
    lines.push('');
  }
  lines.push('## Icons');
  lines.push('');
  lines.push(`Icons live in \`packages/ui/src/icons.ts\` as SVG path data (24 by 24 viewBox). \`<icon name="...">\` draws one of these ${catalog.icons.length} names; any other name is a GEN_ICON_UNKNOWN error whose JSON form carries this same list in \`validIcons\`.`);
  lines.push('');
  for (const name of catalog.icons) lines.push(`- \`${name}\``);
  lines.push('');
  lines.push('## Design tokens');
  lines.push('');
  lines.push(`- Spacing scale: ${catalog.tokens.spacingScale.join(', ')} (keys: ${Object.keys(catalog.tokens.spacing).join(', ')})`);
  lines.push(`- Radius scale: ${catalog.tokens.radiusScale.join(', ')} (keys: ${Object.keys(catalog.tokens.radius).join(', ')}; full = 9999)`);
  lines.push(`- Type scale: ${Object.entries(catalog.tokens.typeScale).map(([k, v]) => `${k} ${v.fontSize}/${v.lineHeight} w${v.fontWeight}`).join(' · ')}`);
  lines.push(`- Colour roles (same roles in light and dark): ${Object.keys(catalog.tokens.colours.light).join(', ')}`);
  lines.push(`- Elevation presets: ${Object.entries(catalog.tokens.elevation).map(([k, v]) => `${k} (elevation ${v.elevation})`).join(', ')}`);
  lines.push(`- Theming: \`<screen theme="dark">\` compiles to \`<RgScreen theme="dark">\`; primitives read the active theme from context (RgThemeProvider / useRgTheme in @rangular/ui) and default to light. CSS spacing/radius/font-size values snap to the scales above (STYLE_OFF_SCALE).`);
  lines.push('');
  lines.push('Full token values (both colour modes, the light and dark theme objects, elevation presets) are in catalog.json.');
  lines.push('');
  lines.push('## Diagnostic codes');
  lines.push('');
  lines.push('| Code | Meaning |');
  lines.push('|---|---|');
  for (const d of catalog.diagnostics) lines.push(`| ${d.code} | ${d.meaning} |`);
  lines.push('');
  lines.push('Diagnostics also carry a `fix:` suggestion in human output and in `rangular build --json`.');
  lines.push('');
  return lines.join('\n');
}
