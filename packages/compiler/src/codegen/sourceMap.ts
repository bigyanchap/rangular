/**
 * Source maps (Stage 5, M7): a small hand-written base64 VLQ encoder and
 * a mappings builder, no dependencies. Granularity is deliberately block
 * level in v1: the generated component function start maps back to the
 * class declaration in the .ts file, and each top level template
 * element's generated JSX start maps back to that element's position in
 * the template file. Per-expression mappings are post-v1.
 */

export interface SourceSegment {
  /** 0-based line in the generated file. */
  generatedLine: number;
  /** 0-based column in the generated file. */
  generatedColumn: number;
  /** Index into the sources array. */
  sourceIndex: number;
  /** 0-based line in the source file. */
  sourceLine: number;
  /** 0-based column in the source file. */
  sourceColumn: number;
}

export interface SourceMapV3 {
  version: 3;
  file?: string;
  sources: string[];
  sourcesContent?: (string | null)[];
  names: string[];
  mappings: string;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Encode one signed integer as base64 VLQ. */
export function encodeVlq(value: number): string {
  let v = value < 0 ? ((-value) << 1) | 1 : value << 1;
  let out = '';
  do {
    let digit = v & 31;
    v >>>= 5;
    if (v > 0) digit |= 32; // continuation bit
    out += B64[digit];
  } while (v > 0);
  return out;
}

/**
 * Build the mappings string from raw segments. Segments are sorted by
 * generated position, duplicates at the same generated position are
 * dropped (first wins), and every field is encoded relative to the
 * previous segment, with the generated column resetting per line.
 */
export function buildMappings(segments: SourceSegment[]): string {
  const sorted = [...segments].sort(
    (a, b) => a.generatedLine - b.generatedLine || a.generatedColumn - b.generatedColumn,
  );
  const lines: string[] = [];
  let prevSource = 0;
  let prevSourceLine = 0;
  let prevSourceColumn = 0;
  let currentLine = 0;
  let prevGenColumn = 0;
  let lineBuf = '';
  const flush = () => { lines.push(lineBuf); lineBuf = ''; };
  for (const seg of sorted) {
    while (currentLine < seg.generatedLine) {
      flush();
      currentLine++;
      prevGenColumn = 0;
    }
    if (lineBuf) lineBuf += ',';
    lineBuf += encodeVlq(seg.generatedColumn - prevGenColumn)
      + encodeVlq(seg.sourceIndex - prevSource)
      + encodeVlq(seg.sourceLine - prevSourceLine)
      + encodeVlq(seg.sourceColumn - prevSourceColumn);
    prevGenColumn = seg.generatedColumn;
    prevSource = seg.sourceIndex;
    prevSourceLine = seg.sourceLine;
    prevSourceColumn = seg.sourceColumn;
  }
  flush();
  return lines.join(';');
}

/** Assemble a complete source map v3 object. */
export function makeSourceMap(
  sources: string[],
  segments: SourceSegment[],
  opts: { file?: string; sourcesContent?: (string | null)[] } = {},
): SourceMapV3 {
  const map: SourceMapV3 = {
    version: 3,
    sources,
    names: [],
    mappings: buildMappings(segments),
  };
  if (opts.file) map.file = opts.file;
  if (opts.sourcesContent) map.sourcesContent = opts.sourcesContent;
  return map;
}
