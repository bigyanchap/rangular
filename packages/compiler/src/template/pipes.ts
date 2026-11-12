/**
 * Built-in pipes (Stage 12): the canonical implementation.
 *
 * One semantics, three homes: this module is what the compiler's own
 * expression evaluator uses (template/evaluate.ts); the runtime
 * `pipe()` in @rangular/runtime carries the same code for generated
 * apps; and the preview page runtime carries a plain-JS mirror. A
 * parity test in tests/stage12.test.ts runs one case table through
 * all three and fails if they drift.
 *
 * Semantics follow Angular's built-in pipes, narrowed where the brief
 * narrows them (the date token set, the currency symbol set). Values a
 * pipe cannot make sense of pass through unchanged, the identity-safe
 * rule the earlier pipes already used.
 */

export const BUILTIN_PIPES: string[] = [
  'uppercase', 'lowercase', 'titlecase', 'json',
  'date', 'number', 'percent', 'currency', 'slice', 'keyvalue', 'async',
];

export function isBuiltinPipe(name: string): boolean {
  return BUILTIN_PIPES.includes(name);
}

// --- digitsInfo ---------------------------------------------------------------

export interface DigitsInfo {
  minInt: number;
  minFrac: number;
  maxFrac: number;
}

/** Parse Angular's digitsInfo shape: `1.0-2` means minInt.minFrac-maxFrac. */
export function parseDigitsInfo(info: unknown, fallback: DigitsInfo = { minInt: 1, minFrac: 0, maxFrac: 3 }): DigitsInfo {
  if (typeof info !== 'string') return fallback;
  const m = /^(\d+)\.(\d+)-(\d+)$/.exec(info.trim());
  if (!m) return fallback;
  const minInt = Number(m[1]);
  const minFrac = Number(m[2]);
  const maxFrac = Number(m[3]);
  if (maxFrac < minFrac) return fallback;
  return { minInt, minFrac, maxFrac };
}

/** Format a number with grouping, integer padding and fraction bounds. */
export function formatNumber(value: number, digits: DigitsInfo): string {
  if (!Number.isFinite(value)) return String(value);
  const negative = value < 0;
  const fixed = Math.abs(value).toFixed(digits.maxFrac);
  const dot = fixed.indexOf('.');
  let intPart = dot >= 0 ? fixed.slice(0, dot) : fixed;
  let fracPart = dot >= 0 ? fixed.slice(dot + 1) : '';
  while (fracPart.length > digits.minFrac && fracPart.endsWith('0')) {
    fracPart = fracPart.slice(0, -1);
  }
  while (fracPart.length < digits.minFrac) fracPart += '0';
  while (intPart.length < digits.minInt) intPart = '0' + intPart;
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (negative ? '-' : '') + grouped + (fracPart ? '.' + fracPart : '');
}

// --- date ---------------------------------------------------------------------

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const DATE_FORMATS: Record<string, string> = {
  shortDate: 'M/d/yy',
  mediumDate: 'MMM d, yyyy',
  shortTime: 'h:mm a',
  medium: 'MMM d, yyyy, h:mm:ss a',
  short: 'M/d/yy, h:mm a',
};

/** Coerce a pipe input to a Date: Date objects, ISO strings and timestamps. */
export function toDateValue(value: unknown): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Format with the Stage 12 token set: yyyy, yy, MMM, MM, M, dd, d,
 * HH, H, hh, h, mm, ss, a. Local time, like Angular's default (no
 * timezone argument in this version). Longest tokens win.
 */
export function formatDateValue(d: Date, format: string = 'mediumDate'): string {
  format = DATE_FORMATS[format] ?? format;
  const hours = d.getHours();
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  const tokens: [string, string][] = [
    ['yyyy', String(d.getFullYear())],
    ['MMM', MONTH_SHORT[d.getMonth()]],
    ['yy', pad2(d.getFullYear() % 100)],
    ['MM', pad2(d.getMonth() + 1)],
    ['dd', pad2(d.getDate())],
    ['HH', pad2(hours)],
    ['hh', pad2(hour12)],
    ['mm', pad2(d.getMinutes())],
    ['ss', pad2(d.getSeconds())],
    ['M', String(d.getMonth() + 1)],
    ['d', String(d.getDate())],
    ['H', String(hours)],
    ['h', String(hour12)],
    ['a', hours < 12 ? 'AM' : 'PM'],
  ];
  let out = '';
  let i = 0;
  while (i < format.length) {
    const hit = tokens.find(([tok]) => format.startsWith(tok, i));
    if (hit) {
      out += hit[1];
      i += hit[0].length;
    } else {
      out += format[i];
      i++;
    }
  }
  return out;
}

// --- currency -------------------------------------------------------------------

/** The Stage 12 symbol table; any other code displays the code itself. */
export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  INR: '₹',
  NPR: 'Rs',
};

// --- the pipe dispatcher --------------------------------------------------------

interface Subscribable {
  subscribe(next?: (value: unknown) => void, error?: (err: unknown) => void): { unsubscribe(): void } | void;
}

/**
 * The async pipe's pure-evaluator semantics: subscribe, keep whatever
 * arrives synchronously, unsubscribe, return the latest value (null
 * when nothing has arrived yet, which is also Angular's initial
 * value). Live surfaces (generated code, the interactive preview)
 * keep the subscription open across renders; a one-shot pure
 * evaluation cannot, and this is the documented difference.
 */
export function asyncSnapshot(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  const sub = value as Subscribable;
  if (typeof sub.subscribe !== 'function') return value;
  let latest: unknown = null;
  try {
    const handle = sub.subscribe((v) => { latest = v; });
    if (handle && typeof handle.unsubscribe === 'function') handle.unsubscribe();
  } catch {
    return latest;
  }
  return latest;
}

/** Apply a built-in pipe by name. Unknown names throw, like before. */
export function applyBuiltinPipe(name: string, value: unknown, args: unknown[]): unknown {
  switch (name) {
    case 'uppercase':
      return typeof value === 'string' ? value.toUpperCase() : value;
    case 'lowercase':
      return typeof value === 'string' ? value.toLowerCase() : value;
    case 'titlecase':
      return typeof value === 'string'
        ? value.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        : value;
    case 'json':
      return JSON.stringify(value);
    case 'date': {
      const d = toDateValue(value);
      if (!d) return value;
      const named = typeof args[0] === 'string' ? args[0] : 'mediumDate';
      return formatDateValue(d, named);
    }
    case 'number': {
      if (typeof value !== 'number') return value;
      return formatNumber(value, parseDigitsInfo(args[0], { minInt: 1, minFrac: 0, maxFrac: 3 }));
    }
    case 'percent': {
      if (typeof value !== 'number') return value;
      return formatNumber(value * 100, parseDigitsInfo(args[0], { minInt: 1, minFrac: 0, maxFrac: 3 })) + '%';
    }
    case 'currency': {
      if (typeof value !== 'number') return value;
      const code = typeof args[0] === 'string' && args[0] !== '' ? args[0] : 'USD';
      const display = typeof args[1] === 'string' ? args[1] : 'symbol';
      const digits = parseDigitsInfo(args[2], { minInt: 1, minFrac: 2, maxFrac: 2 });
      const symbol = display === 'code' ? undefined : CURRENCY_SYMBOLS[code];
      const formatted = formatNumber(Math.abs(value), digits);
      const sign = value < 0 ? '-' : '';
      return symbol !== undefined
        ? `${sign}${symbol}${formatted}`
        : `${sign}${code} ${formatted}`;
    }
    case 'slice': {
      if (typeof value !== 'string' && !Array.isArray(value)) return value;
      const start = typeof args[0] === 'number' ? args[0] : 0;
      const end = typeof args[1] === 'number' ? args[1] : undefined;
      return (value as string).slice(start, end);
    }
    case 'keyvalue': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
      const rec = value as Record<string, unknown>;
      return Object.keys(rec)
        .map((key) => ({ key, value: rec[key] }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    }
    case 'async':
      return asyncSnapshot(value);
    default:
      throw new Error(`Unknown pipe '${name}'`);
  }
}
