import { theme, ThemeMode } from '../../../ui/src/tokens';
import { ComponentInfo } from '../class/parseComponent';
import { ChildUnitInput } from '../codegen/generate';
import { ParsedCss } from '../style/css';
import { ElementNode, TemplateNode, TemplateRoot } from '../template/ast';

/**
 * Style snapshot goldens (Stage 5, docs/UI_POLISH.md part 4, adapted).
 *
 * This repo has no device screenshot pipeline, so the visual golden is a
 * style snapshot instead: for one example, the resolved key styles per
 * element role for BOTH themes, plus the example's own parsed component
 * styles (already snapped by the CSS translator). Values come from the
 * same token objects the preview renderer builds its CSS from, so a
 * token value change, a role change, or an example style change makes
 * the snapshot test fail until the committed snapshot is deliberately
 * regenerated. Structural and style goldens stand in for screenshot
 * goldens until a device screenshot pipeline exists.
 */

export type StyleRecord = Record<string, string | number>;

export interface ThemeSnapshot {
  /** Element role (screen, card, button, row, text roles, ...) to key styles. */
  roles: Record<string, StyleRecord>;
  /** The example's own component styles, by selector, as parsed and snapped. */
  styles: Record<string, StyleRecord>;
}

export interface StyleSnapshot {
  example: string;
  themes: Record<ThemeMode, ThemeSnapshot>;
}

/** Resolved styles for every role the preview knows, for one theme mode. */
function allRoles(mode: ThemeMode): Record<string, StyleRecord> {
  const t = theme(mode);
  const c = t.colors;
  const ty = t.typography;
  return {
    screen: { background: c.background, color: c.text },
    appbar: { background: c.surfaceVariant, borderRadius: t.radius.full, gap: t.spacing.md },
    avatar: { background: c.avatar, color: c.onAvatar },
    rowAvatar: { background: c.primary, color: c.onPrimary },
    card: {
      background: c.surfaceVariant, borderColor: c.border,
      borderRadius: t.radius.lg, padding: t.spacing.lg,
    },
    button: { background: c.primary, color: c.onPrimary, borderRadius: t.radius.full, minHeight: 48 },
    list: { borderColor: c.border },
    row: {
      borderColor: c.border, gap: t.spacing.md,
      paddingLeft: t.spacing.lg, paddingRight: t.spacing.lg,
    },
    badge: {
      background: c.primaryContainer, color: c.onPrimaryContainer,
      borderRadius: t.radius.full, fontSize: ty.caption.fontSize, fontWeight: 700,
    },
    fab: { background: c.primaryContainer, color: c.onPrimaryContainer, borderRadius: t.radius.lg },
    switch: {
      background: c.surfaceVariant, borderColor: c.outline, knobBackground: c.onSurfaceVariant,
      checkedBackground: c.primary, checkedKnobBackground: c.onPrimary,
      borderRadius: t.radius.full, width: 52, height: 32,
    },
    checkbox: {
      background: c.primary, borderColor: c.primary, color: c.onPrimary,
      borderRadius: t.radius.sm, width: 24, height: 24,
    },
    switcher: {
      background: c.surfaceVariant, borderColor: c.border, borderRadius: t.radius.full,
      selectedBackground: c.primaryContainer, selectedColor: c.onPrimaryContainer,
      padding: t.spacing.xs, minHeight: 40,
    },
    radio: {
      borderColor: c.outline, selectedBorderColor: c.primary, dotBackground: c.primary,
      borderRadius: t.radius.full, width: 24, height: 24, dotWidth: 12, dotHeight: 12,
    },
    textDisplay: { fontSize: ty.display.fontSize, lineHeight: ty.display.lineHeight, fontWeight: 700 },
    textHeading: { fontSize: ty.heading.fontSize, lineHeight: ty.heading.lineHeight, fontWeight: 700 },
    textTitle: { fontSize: ty.title.fontSize, lineHeight: ty.title.lineHeight, fontWeight: 600 },
    textBody: { fontSize: ty.bodyLarge.fontSize, lineHeight: ty.bodyLarge.lineHeight, color: c.textMuted },
    textLabel: { fontSize: ty.label.fontSize, lineHeight: ty.label.lineHeight, fontWeight: 600 },
  };
}

/** Element tag to the roles it exercises in the preview. */
function rolesForElement(el: ElementNode): string[] {
  switch (el.tag) {
    case 'screen': return ['screen'];
    case 'appbar': return ['appbar', 'avatar'];
    case 'card': return ['card'];
    case 'button': return ['button'];
    case 'list': return ['list'];
    case 'row': return el.booleanAttrs.includes('avatar') ? ['row', 'rowAvatar'] : ['row'];
    case 'h1': return ['textDisplay'];
    case 'h2': return ['textHeading'];
    case 'h3': return ['textTitle'];
    case 'p': return ['textBody'];
    case 'label': return ['textLabel'];
    case 'fab': return ['fab'];
    case 'switch': return ['switch'];
    case 'checkbox': return ['checkbox'];
    case 'switcher': return ['switcher'];
    case 'radio-group': return ['radio'];
    case 'span': return el.attrs['class'] === 'badge' ? ['badge'] : [];
    default: return [];
  }
}

function collectRoles(nodes: TemplateNode[], into: Set<string>): void {
  for (const node of nodes) {
    if (node.type !== 'element') continue;
    for (const role of rolesForElement(node)) into.add(role);
    collectRoles(node.children, into);
  }
}

function sortedRecord<V>(entries: [string, V][]): Record<string, V> {
  const out: Record<string, V> = {};
  for (const [k, v] of entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) out[k] = v;
  return out;
}

/**
 * Build the style snapshot for one compiled example. Deterministic: role
 * and style keys are sorted, so the JSON file is stable byte for byte.
 */
export function buildStyleSnapshot(
  example: string,
  component: ComponentInfo,
  ast: TemplateRoot,
  css: ParsedCss,
  children: ChildUnitInput[] = [],
): StyleSnapshot {
  void component;
  const used = new Set<string>();
  collectRoles(ast.children, used);
  const allStyles: Record<string, StyleRecord> = {};
  const mergeStyles = (parsed: ParsedCss) => {
    for (const [selector, style] of Object.entries(parsed.styles)) {
      allStyles[selector] = { ...(allStyles[selector] ?? {}), ...style };
    }
  };
  mergeStyles(css);
  for (const child of children) {
    collectRoles(child.ast.children, used);
    mergeStyles(child.css);
  }
  const themes = {} as Record<ThemeMode, ThemeSnapshot>;
  for (const mode of ['light', 'dark'] as ThemeMode[]) {
    const all = allRoles(mode);
    themes[mode] = {
      roles: sortedRecord([...used].filter((r) => all[r]).map((r) => [r, all[r]] as [string, StyleRecord])),
      styles: sortedRecord(Object.entries(allStyles)),
    };
  }
  return { example, themes };
}

/** Render a snapshot as the committed JSON file content. */
export function renderStyleSnapshot(snapshot: StyleSnapshot): string {
  return JSON.stringify(snapshot, null, 2) + '\n';
}
