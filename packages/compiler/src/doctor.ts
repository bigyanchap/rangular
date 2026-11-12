import { CompileResult, resolveSiblingPath } from './compile';
import { TAG_MAP } from './codegen/generate';
import { Diagnostic, error, warning } from './diagnostics';
import { snapForProp } from './style/css';
import { ElementNode, TemplateNode } from './template/ast';

/**
 * `rangular doctor` (Stage 5): the polish linter from docs/UI_POLISH.md
 * part 4. It reads the same compiled artefacts the compiler produced
 * (template ASTs, parsed styles) plus the raw style texts (for line
 * numbers and the suppression comment), and reports findings as ordinary
 * diagnostics with DOC_ codes. Doctor never changes anything.
 *
 * Severities: DOC_TAP_TARGET is an error (a too-small target is a real
 * usability defect); the rest are warnings.
 *
 * Suppression: a CSS comment containing `doctor: allow-hex` anywhere in
 * a style text disables DOC_HEX_COLOR for that file's styles. It exists
 * for app-specific brand colours that are deliberately not Material
 * roles (the Awaken Me gold in examples/dinacharya-row is the case in
 * point). The suppression is per file and covers hex only.
 */

export interface DoctorStyleText {
  /** File the style text came from (the .ts for inline styles, else the .css). */
  file: string;
  text: string;
}

export interface DoctorInput {
  /** The finished compilation to inspect. */
  result: CompileResult;
  /** Absolute or display path of the entry component file. */
  entryFile: string;
  /** Raw style texts: inline styles plus each resolved styleUrl file. */
  styleTexts: DoctorStyleText[];
}

const CONTAINER_TAGS = new Set(['screen', 'card', 'list', 'sheet', 'dialog', 'tab', 'panel']);
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const DECL_RE = /([a-zA-Z-]+)\s*:\s*(-?\d+(?:\.\d+)?)px/g;
export const ALLOW_HEX_MARKER = 'doctor: allow-hex';

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === '\n') line++;
  return line;
}

function camelCase(prop: string): string {
  return prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Style texts for a compilation: inline styles live in the .ts file. */
export function doctorStyleTexts(
  result: CompileResult,
  entryFile: string,
  readFile: (absPath: string) => string | undefined,
): DoctorStyleText[] {
  const texts: DoctorStyleText[] = [];
  const component = result.component;
  if (!component) return texts;
  if (component.styles) texts.push({ file: entryFile, text: component.styles });
  for (const url of component.styleUrls) {
    const file = resolveSiblingPath(entryFile, url);
    const text = readFile(file);
    if (text !== undefined) texts.push({ file, text });
  }
  return texts;
}

export function runDoctor(input: DoctorInput): Diagnostic[] {
  const { result, entryFile } = input;
  const findings: Diagnostic[] = [];
  const component = result.component;
  if (!component || !result.ast) return findings;
  const entryTemplateFile = component.templateUrl
    ? resolveSiblingPath(entryFile, component.templateUrl)
    : entryFile;

  // --- Style text checks: DOC_HEX_COLOR + DOC_OFF_SCALE --------------------
  for (const { file, text } of input.styleTexts) {
    const allowHex = text.includes(ALLOW_HEX_MARKER);
    if (!allowHex) {
      for (const m of text.matchAll(HEX_RE)) {
        findings.push({
          ...warning(
            'DOC_HEX_COLOR',
            `Hex colour ${m[0]} in styles; raw hex values do not follow the theme`,
            lineAt(text, m.index ?? 0), undefined,
            `Use a colour role instead (primary, surface, onSurface, error, and the other roles in @rangular/ui tokens), or, for a deliberate brand colour, add a CSS comment containing "${ALLOW_HEX_MARKER}" to this style text`,
          ),
          file,
        });
      }
    }
    for (const m of text.matchAll(DECL_RE)) {
      const rawProp = m[1];
      const value = Number(m[2]);
      const snapped = snapForProp(camelCase(rawProp), value);
      if (snapped !== undefined && snapped !== value) {
        findings.push({
          ...warning(
            'DOC_OFF_SCALE',
            `${rawProp}: ${value}px is off its design-token scale; the compiler snaps it to ${snapped}`,
            lineAt(text, m.index ?? 0), undefined,
            `Change ${rawProp} to ${snapped}px so the source says what the generated style will be`,
          ),
          file,
        });
      }
    }
  }

  // --- Template checks -------------------------------------------------------
  const styleFor = (el: ElementNode, styles: Record<string, Record<string, string | number>>): Record<string, string | number> => {
    const merged: Record<string, string | number> = { ...(styles[el.tag] ?? {}) };
    for (const cls of (el.attrs['class'] ?? '').split(/\s+/).filter(Boolean)) {
      Object.assign(merged, styles[cls] ?? {});
    }
    return merged;
  };

  const walk = (
    nodes: TemplateNode[],
    templateFile: string,
    styles: Record<string, Record<string, string | number>>,
  ): void => {
    for (const node of nodes) {
      if (node.type !== 'element') continue;
      const el = node;
      // DOC_RAW_TEXT: loose text directly inside a container.
      if (CONTAINER_TAGS.has(el.tag)) {
        for (const child of el.children) {
          if (child.type !== 'text') continue;
          const loose = child.parts.some(
            (p) => (p.type === 'static' && p.value.trim() !== '') || p.type === 'expr',
          );
          if (loose) {
            findings.push({
              ...warning(
                'DOC_RAW_TEXT',
                `Loose text sits directly inside <${el.tag}>; on React Native all text must live inside a text element`,
                child.pos.line, child.pos.column,
                `Wrap the text in <p>, <span>, <h1> to <h3> or <label> (whichever fits) instead of placing it directly inside <${el.tag}>`,
              ),
              file: templateFile,
            });
          }
        }
      }
      // DOC_TAP_TARGET: a (click) element sized below 44 in either dimension.
      if (el.eventBindings.some((ev) => ev.name === 'click')) {
        const style = styleFor(el, styles);
        const width = typeof style.width === 'number' ? style.width : undefined;
        const height = typeof style.height === 'number' ? style.height : undefined;
        const attrWidth = el.attrs['width'] !== undefined ? Number(el.attrs['width']) : undefined;
        const attrHeight = el.attrs['height'] !== undefined ? Number(el.attrs['height']) : undefined;
        const w = width ?? (Number.isFinite(attrWidth) ? attrWidth : undefined);
        const h = height ?? (Number.isFinite(attrHeight) ? attrHeight : undefined);
        if ((w !== undefined && w < 44) || (h !== undefined && h < 44)) {
          findings.push({
            ...error(
              'DOC_TAP_TARGET',
              `<${el.tag}> has a (click) binding but is sized ${w !== undefined ? `${w}` : '?'} by ${h !== undefined ? `${h}` : '?'}; below the 44 by 44 minimum tap target`,
              el.pos.line, el.pos.column,
              'Give the element width and height of at least 44 (44px or more in its styles) so the tap target is comfortably tappable',
            ),
            file: templateFile,
          });
        }
      }
      walk(el.children, templateFile, styles);
    }
  };

  walk(result.ast.children, entryTemplateFile, result.css?.styles ?? {});
  for (const child of result.children) {
    walk(child.ast.children, child.templateFile ?? entryFile, child.css.styles);
  }

  // DOC_IMG_SIZE: only when an image tag is part of the tag contract.
  // TAG_MAP has no img or image entry today, so this check is skipped
  // entirely (see the Stage 5 report); the moment an image tag is added
  // to TAG_MAP this code starts enforcing declared dimensions on it.
  const imageTags = ['img', 'image'].filter((t) => t in TAG_MAP);
  if (imageTags.length) {
    const checkImages = (nodes: TemplateNode[], templateFile: string): void => {
      for (const node of nodes) {
        if (node.type !== 'element') continue;
        if (imageTags.includes(node.tag) && (!node.attrs['width'] || !node.attrs['height'])) {
          findings.push({
            ...error(
              'DOC_IMG_SIZE',
              `<${node.tag}> has no declared width and height; images must declare their size so layout does not jump`,
              node.pos.line, node.pos.column,
              'Add width and height attributes with the image size in px, e.g. width="120" height="80"',
            ),
            file: templateFile,
          });
        }
        checkImages(node.children, templateFile);
      }
    };
    checkImages(result.ast.children, entryTemplateFile);
  }

  return findings;
}
