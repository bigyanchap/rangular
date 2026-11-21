/**
 * The block editor's text model (framework 0.5.0, lesson 94's
 * redesign at Bigyan's direction): the editor's value stays ONE
 * string, and each LINE of that string is one block. A line's
 * prefix names its kind:
 *
 *   '# '        a title block
 *   '## '       a heading block
 *   '> '        a quote block
 *   '- [ ] '    a checklist block, open
 *   '- [x] '    a checklist block, done
 *   '- '        a bullet block
 *   '1. '       a numbered block (any digits; the writer
 *               renumbers a run 1, 2, 3 as it serializes)
 *   (no prefix) a body block
 *
 * Inside a block's text, four inline marks style runs of words:
 * double stars are bold, a single star is italic, double plus is
 * underline and double tilde is strikethrough. The marks are
 * flat: a marked run holds plain text, marks do not nest. The
 * editor renders blocks styled at rest and shows a block's marks
 * only while that block is being edited, so what the writer sees
 * is the styled note, and what the app stores is this string.
 *
 * Pure functions only, no React Native imports, so the model is
 * unit tested directly and the browser preview mirrors it.
 */

export type BlockKind =
  | 'title'
  | 'heading'
  | 'body'
  | 'quote'
  | 'check'
  | 'bullet'
  | 'number';

export interface Block {
  kind: BlockKind;
  text: string;
  done: boolean;
}

export function bodyBlock(text: string): Block {
  return { kind: 'body', text, done: false };
}

export function parseBlocks(value: string): Block[] {
  const text = value === undefined || value === null ? '' : String(value);
  return text.split('\n').map((line) => {
    if (line.startsWith('## ')) return { kind: 'heading' as BlockKind, text: line.slice(3), done: false };
    if (line.startsWith('# ')) return { kind: 'title' as BlockKind, text: line.slice(2), done: false };
    if (line.startsWith('> ')) return { kind: 'quote' as BlockKind, text: line.slice(2), done: false };
    if (line.startsWith('- [ ] ')) return { kind: 'check' as BlockKind, text: line.slice(6), done: false };
    if (line.startsWith('- [x] ') || line.startsWith('- [X] ')) return { kind: 'check' as BlockKind, text: line.slice(6), done: true };
    if (line.startsWith('- ')) return { kind: 'bullet' as BlockKind, text: line.slice(2), done: false };
    const numbered = /^\d+\. /.exec(line);
    if (numbered) return { kind: 'number' as BlockKind, text: line.slice(numbered[0].length), done: false };
    return bodyBlock(line);
  });
}

export function serializeBlocks(blocks: Block[]): string {
  let run = 0;
  return blocks
    .map((b) => {
      if (b.kind === 'number') {
        run += 1;
        return `${run}. ${b.text}`;
      }
      run = 0;
      if (b.kind === 'title') return `# ${b.text}`;
      if (b.kind === 'heading') return `## ${b.text}`;
      if (b.kind === 'quote') return `> ${b.text}`;
      if (b.kind === 'check') return `${b.done ? '- [x] ' : '- [ ] '}${b.text}`;
      if (b.kind === 'bullet') return `- ${b.text}`;
      return b.text;
    })
    .join('\n');
}

export function setBlockKind(blocks: Block[], index: number, kind: BlockKind): Block[] {
  return blocks.map((b, i) =>
    i === index ? { kind, text: b.text, done: kind === 'check' ? b.done : false } : b,
  );
}

export function setBlockText(blocks: Block[], index: number, text: string): Block[] {
  return blocks.map((b, i) => (i === index ? { ...b, text } : b));
}

export function toggleBlockDone(blocks: Block[], index: number): Block[] {
  return blocks.map((b, i) =>
    i === index && b.kind === 'check' ? { ...b, done: !b.done } : b,
  );
}

export function insertBlockAfter(blocks: Block[], index: number, kind: BlockKind = 'body'): Block[] {
  const next = blocks.slice();
  next.splice(index + 1, 0, { kind, text: '', done: false });
  return next;
}

export function removeBlock(blocks: Block[], index: number): Block[] {
  const next = blocks.filter((_, i) => i !== index);
  return next.length > 0 ? next : [bodyBlock('')];
}

export function moveBlock(blocks: Block[], index: number, dir: -1 | 1): Block[] {
  const target = index + dir;
  if (target < 0 || target >= blocks.length) return blocks;
  const next = blocks.slice();
  const held = next[index];
  next[index] = next[target];
  next[target] = held;
  return next;
}

interface Span {
  outerStart: number;
  contentStart: number;
  contentEnd: number;
  outerEnd: number;
}

/**
 * The marked spans of one marker in a text. For the single star
 * the scan steps over double stars, so a bold span never reads
 * as two italic marks.
 */
export function markedSpans(text: string, marker: string): Span[] {
  const spans: Span[] = [];
  const m = marker.length;
  let i = 0;
  while (i < text.length) {
    if (marker === '*' && text.startsWith('**', i)) {
      i += 2;
      continue;
    }
    if (text.startsWith(marker, i)) {
      const close = text.indexOf(marker, i + m);
      if (close > i + m) {
        spans.push({ outerStart: i, contentStart: i + m, contentEnd: close, outerEnd: close + m });
        i = close + m;
        continue;
      }
    }
    i += 1;
  }
  return spans;
}

/**
 * Are there marks of this kind sitting just outside the
 * selection? For the single star, a star that belongs to a bold
 * pair does not count: the closing star of a bold span must not
 * read as an italic opener.
 */
function marksOutside(text: string, s: number, e: number, marker: string): boolean {
  const m = marker.length;
  if (s < m || text.slice(s - m, s) !== marker || text.slice(e, e + m) !== marker) return false;
  if (marker === '*') {
    if (text[s - 2] === '*') return false;
    if (text[e + 1] === '*') return false;
  }
  return true;
}

function marksInside(inner: string, marker: string): boolean {
  if (inner.length <= 2 * marker.length) return false;
  if (!inner.startsWith(marker) || !inner.endsWith(marker)) return false;
  if (marker === '*' && inner.startsWith('**')) return false;
  return true;
}

export interface InlineToggle {
  text: string;
  start: number;
  end: number;
}

/**
 * One press of a toolbar mark button. A selection that is not
 * marked gets wrapped; a selection that is marked, whether the
 * marks sit just outside it or just inside it, gets unwrapped.
 * A bare caret inside a marked run unwraps that run; a bare
 * caret anywhere else changes nothing. The returned selection
 * keeps covering the same words.
 */
export function toggleInline(
  text: string,
  start: number,
  end: number,
  marker: string,
): InlineToggle {
  const m = marker.length;
  const s = Math.max(0, Math.min(start, text.length));
  const e = Math.max(s, Math.min(end, text.length));
  if (s < e) {
    if (marksOutside(text, s, e, marker)) {
      return { text: text.slice(0, s - m) + text.slice(s, e) + text.slice(e + m), start: s - m, end: e - m };
    }
    const inner = text.slice(s, e);
    if (marksInside(inner, marker)) {
      return { text: text.slice(0, s) + inner.slice(m, inner.length - m) + text.slice(e), start: s, end: e - 2 * m };
    }
    return { text: text.slice(0, s) + marker + inner + marker + text.slice(e), start: s + m, end: e + m };
  }
  const span = markedSpans(text, marker).find((sp) => s >= sp.outerStart && s <= sp.outerEnd);
  if (span) {
    const caret = Math.max(span.contentStart - m, Math.min(s - m, span.contentEnd - m));
    return {
      text: text.slice(0, span.outerStart) + text.slice(span.contentStart, span.contentEnd) + text.slice(span.outerEnd),
      start: caret,
      end: caret,
    };
  }
  return { text, start: s, end: e };
}

/** Is the selection (or the caret's run) currently wearing this mark? */
export function inlineActive(text: string, start: number, end: number, marker: string): boolean {
  const m = marker.length;
  const s = Math.max(0, Math.min(start, text.length));
  const e = Math.max(s, Math.min(end, text.length));
  if (s < e) {
    if (marksOutside(text, s, e, marker)) return true;
    return marksInside(text.slice(s, e), marker);
  }
  return markedSpans(text, marker).some((sp) => s >= sp.contentStart && s <= sp.contentEnd);
}

export interface InlineRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
}

const INLINE_MARKS: { marker: string; key: 'bold' | 'italic' | 'underline' | 'strike' }[] = [
  { marker: '**', key: 'bold' },
  { marker: '~~', key: 'strike' },
  { marker: '++', key: 'underline' },
  { marker: '*', key: 'italic' },
];

/** Split a block's text into styled runs. Flat: marks do not nest. */
export function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  let plain = '';
  const flush = () => {
    if (plain) {
      runs.push({ text: plain, bold: false, italic: false, underline: false, strike: false });
      plain = '';
    }
  };
  let i = 0;
  while (i < text.length) {
    const hit = INLINE_MARKS.find((mk) => text.startsWith(mk.marker, i));
    if (hit) {
      const close = text.indexOf(hit.marker, i + hit.marker.length);
      if (close > i + hit.marker.length) {
        flush();
        const run: InlineRun = { text: text.slice(i + hit.marker.length, close), bold: false, italic: false, underline: false, strike: false };
        run[hit.key] = true;
        runs.push(run);
        i = close + hit.marker.length;
        continue;
      }
    }
    plain += text[i];
    i += 1;
  }
  flush();
  return runs;
}
