/**
 * Chart geometry (Stage 15), pure TypeScript with no imports: the
 * one small engine the RgChart primitive, the compiler's preview
 * paint and the preview page runtime all share. The page runtime
 * mirrors these functions in plain JavaScript; the two are
 * parity-tested against the same case tables in tests/stage15.test.ts.
 *
 * The data shape is one documented form, an array of label and
 * value pairs:
 *
 *   [ { label: 'Mon', value: 12 }, { label: 'Tue', value: 19 } ]
 *
 * A point may carry its own `color` (a hex string); without one it
 * takes the next colour of the palette the caller passes in. The
 * engine returns a model of plain shapes (rects, paths, circles,
 * texts) in a width by height box, and each surface serializes the
 * same model: react-native-svg in the app, inline SVG in both
 * preview renderers. Coordinates are rounded to two decimals in the
 * model itself, so the three serializations agree byte for byte on
 * the geometry.
 *
 * Scope, stated plainly: three chart types (bar, line, pie), one
 * series, no axes lines, no gridlines, no animation, no interaction.
 * Bar and pie values are counts: a negative value reads as 0. A
 * line scales between the data's own minimum and maximum.
 */

export interface ChartPoint {
  label: string;
  value: number;
  color?: string;
}

export type ChartShape =
  | { kind: 'rect'; x: number; y: number; width: number; height: number; fill: string }
  | { kind: 'path'; d: string; fill?: string; stroke?: string; strokeWidth?: number }
  | { kind: 'circle'; cx: number; cy: number; r: number; fill: string }
  | { kind: 'text'; x: number; y: number; text: string; fill: string; size: number; anchor: 'middle' | 'start' };

export interface ChartModel {
  width: number;
  height: number;
  shapes: ChartShape[];
}

export const CHART_TYPES: string[] = ['bar', 'line', 'pie'];

/** Coerce unknown input into chart points; anything unusable drops out. */
export function normalizeChartData(data: unknown): ChartPoint[] {
  if (!Array.isArray(data)) return [];
  const out: ChartPoint[] = [];
  for (const item of data) {
    if (item === null || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const value = Number(rec['value']);
    if (!Number.isFinite(value)) continue;
    out.push({
      label: rec['label'] === undefined || rec['label'] === null ? '' : String(rec['label']),
      value,
      ...(typeof rec['color'] === 'string' ? { color: rec['color'] } : {}),
    });
  }
  return out;
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function colorOf(point: ChartPoint, index: number, palette: string[]): string {
  return point.color ?? palette[index % Math.max(palette.length, 1)] ?? '#000000';
}

const LABEL_STRIP = 18;
const LEGEND_ROW = 18;

/**
 * Build the shape model for one chart. `width` is the chart's full
 * width; `height` is the plotting height the author asked for (the
 * returned model's height adds the label strip, and for pie the
 * legend rows, below it).
 */
export function chartModel(
  type: string,
  data: unknown,
  width: number,
  height: number,
  palette: string[],
  labelColor: string,
): ChartModel {
  const points = normalizeChartData(data);
  const w = Math.max(40, Math.floor(width) || 40);
  const plotH = Math.max(40, Math.floor(height) || 40);
  const shapes: ChartShape[] = [];
  if (!points.length) return { width: w, height: plotH, shapes };

  if (type === 'pie') {
    const total = points.reduce((sum, p) => sum + Math.max(0, p.value), 0);
    const r = Math.min(w, plotH) / 2;
    const cx = w / 2;
    const cy = plotH / 2;
    let angle = -90;
    points.forEach((p, i) => {
      const frac = total > 0 ? Math.max(0, p.value) / total : 0;
      const sweep = frac * 360;
      const fill = colorOf(p, i, palette);
      if (frac > 0) {
        if (frac >= 0.9999) {
          shapes.push({ kind: 'circle', cx: r2(cx), cy: r2(cy), r: r2(r), fill });
        } else {
          const a0 = (angle * Math.PI) / 180;
          const a1 = ((angle + sweep) * Math.PI) / 180;
          const x0 = cx + r * Math.cos(a0);
          const y0 = cy + r * Math.sin(a0);
          const x1 = cx + r * Math.cos(a1);
          const y1 = cy + r * Math.sin(a1);
          const large = sweep > 180 ? 1 : 0;
          shapes.push({
            kind: 'path',
            d: `M ${r2(cx)} ${r2(cy)} L ${r2(x0)} ${r2(y0)} A ${r2(r)} ${r2(r)} 0 ${large} 1 ${r2(x1)} ${r2(y1)} Z`,
            fill,
          });
        }
      }
      angle += sweep;
    });
    // The legend lives in the model (one swatch rect and one text
    // per point) so all three surfaces lay it out identically.
    points.forEach((p, i) => {
      const y = plotH + 6 + i * LEGEND_ROW;
      shapes.push({ kind: 'rect', x: 0, y: r2(y), width: 10, height: 10, fill: colorOf(p, i, palette) });
      shapes.push({
        kind: 'text', x: 16, y: r2(y + 10), text: `${p.label} ${p.value}`,
        fill: labelColor, size: 12, anchor: 'start',
      });
    });
    return { width: w, height: plotH + 6 + points.length * LEGEND_ROW, shapes };
  }

  if (type === 'line') {
    let min = Math.min(...points.map((p) => p.value));
    let max = Math.max(...points.map((p) => p.value));
    if (min === max) { min -= 1; max += 1; }
    const stroke = colorOf(points[0], 0, palette);
    const coords = points.map((p, i) => {
      const x = points.length === 1 ? w / 2 : (i * w) / (points.length - 1);
      const y = plotH - ((p.value - min) / (max - min)) * (plotH - 8) - 4;
      return { x: r2(x), y: r2(y) };
    });
    const d = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
    shapes.push({ kind: 'path', d, stroke, strokeWidth: 2 });
    coords.forEach((c) => shapes.push({ kind: 'circle', cx: c.x, cy: c.y, r: 3, fill: stroke }));
    points.forEach((p, i) => {
      shapes.push({
        kind: 'text', x: coords[i].x, y: plotH + 14, text: p.label,
        fill: labelColor, size: 12, anchor: 'middle',
      });
    });
    return { width: w, height: plotH + LABEL_STRIP, shapes };
  }

  // bar (the default; an unknown type is a compile error long
  // before the engine sees it, GEN_CHART_TYPE).
  const max = Math.max(1, ...points.map((p) => Math.max(0, p.value)));
  const slot = w / points.length;
  const barW = slot * 0.6;
  points.forEach((p, i) => {
    const v = Math.max(0, p.value);
    const h = (v / max) * (plotH - 4);
    shapes.push({
      kind: 'rect',
      x: r2(slot * i + slot * 0.2), y: r2(plotH - h),
      width: r2(barW), height: r2(h),
      fill: colorOf(p, i, palette),
    });
    shapes.push({
      kind: 'text', x: r2(slot * i + slot / 2), y: plotH + 14, text: p.label,
      fill: labelColor, size: 12, anchor: 'middle',
    });
  });
  return { width: w, height: plotH + LABEL_STRIP, shapes };
}
