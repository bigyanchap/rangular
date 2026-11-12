import { Diagnostic, warning } from '../diagnostics';

/**
 * Angular structural-directive microsyntax parsing:
 *   *ngIf="condition"  |  *ngIf="condition; else elseTpl"
 *   *ngFor="let item of items; let i = index; trackBy: trackById"
 */

export interface NgIfParts {
  condition: string;
  elseRef?: string;
  thenRef?: string;
}

export function parseNgIf(expression: string): NgIfParts {
  const segments = expression.split(';').map((s) => s.trim()).filter(Boolean);
  const parts: NgIfParts = { condition: segments[0] ?? '' };
  for (const seg of segments.slice(1)) {
    const elseMatch = /^else\s+(\S+)$/.exec(seg);
    if (elseMatch) { parts.elseRef = elseMatch[1]; continue; }
    const thenMatch = /^then\s+(\S+)$/.exec(seg);
    if (thenMatch) { parts.thenRef = thenMatch[1]; continue; }
    // Angular also allows `let x` / `as y` segments in ngIf; Stage 2 ignores them.
  }
  return parts;
}

export interface NgForParts {
  itemVar: string;
  /** Source expression being iterated, e.g. `mails`. */
  source: string;
  indexVar?: string;
  /** Name of the trackBy function, when `trackBy: fnName` is present. */
  trackBy?: string;
  /** Other `let x = key` locals (first, last, even, odd...). */
  locals: Record<string, string>;
}

export interface NgForParseResult {
  parts?: NgForParts;
  diagnostics: Diagnostic[];
}

export function parseNgFor(expression: string, line?: number, column?: number): NgForParseResult {
  const diagnostics: Diagnostic[] = [];
  const segments = expression.split(';').map((s) => s.trim()).filter(Boolean);
  const first = segments[0] ?? '';
  const head = /^let\s+([A-Za-z_$][\w$]*)\s+of\s+(.+)$/.exec(first);
  if (!head) {
    diagnostics.push(warning(
      'TPL_NGFOR',
      `Could not parse *ngFor microsyntax "${expression}", expected "let item of items"`,
      line, column,
      'Use the form *ngFor="let item of items; let i = index" (optionally "; trackBy: trackByFn")',
    ));
    return { diagnostics };
  }
  const parts: NgForParts = { itemVar: head[1], source: head[2].trim(), locals: {} };
  for (const seg of segments.slice(1)) {
    const letMatch = /^let\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)$/.exec(seg);
    if (letMatch) {
      if (letMatch[2] === 'index') parts.indexVar = letMatch[1];
      else parts.locals[letMatch[1]] = letMatch[2];
      continue;
    }
    const trackMatch = /^trackBy\s*:\s*(.+)$/.exec(seg);
    if (trackMatch) { parts.trackBy = trackMatch[1].trim(); continue; }
    diagnostics.push(warning(
      'TPL_NGFOR_SEGMENT',
      `Unsupported *ngFor segment "${seg}", ignored`,
      line, column,
      'Supported segments: "let i = index" and "trackBy: fnName", remove or rewrite this segment',
    ));
  }
  return { parts, diagnostics };
}
