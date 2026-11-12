/**
 * Date and time value helpers for the Rangular date-time picker
 * (Stage 10), pure TypeScript with no imports: the value model the
 * RgDateTimePicker primitive, the compiler's preview paint and the
 * preview page runtime all share. The page runtime mirrors these
 * functions in plain JavaScript; the two implementations are
 * parity-tested against the same case tables in tests/stage10.test.ts.
 *
 * The value that crosses the template boundary is an ISO string in
 * local time with no zone suffix, `YYYY-MM-DDTHH:mm:00`, the string
 * form of the parts. A `Date` is also accepted on the way in (a
 * component may hold one), its local fields are read. Composition
 * always produces the ISO string, which is what the picker's
 * `(change)` event emits as `$event`.
 */

export interface DateTimeParts {
  /** Full year, e.g. 2026. */
  year: number;
  /** Month, 1 to 12. */
  month: number;
  /** Day of month, 1 to 31. */
  day: number;
  /** Hour, 0 to 23. */
  hour: number;
  /** Minute, 0 to 59. */
  minute: number;
}

export type PickerMode = 'date' | 'time' | 'datetime';

export const PICKER_MODES: PickerMode[] = ['date', 'time', 'datetime'];

export const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Days in a month, leap years handled (1900 is not, 2000 is). */
export function daysInMonth(year: number, month: number): number {
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return lengths[month - 1] ?? 31;
}

/** Clamp parts into range: month 1 to 12, day into its month, hour 0 to 23, minute 0 to 59. */
export function clampDateTimeParts(parts: DateTimeParts): DateTimeParts {
  const month = Math.min(12, Math.max(1, Math.trunc(parts.month) || 1));
  const year = Math.trunc(parts.year) || 2000;
  const day = Math.min(daysInMonth(year, month), Math.max(1, Math.trunc(parts.day) || 1));
  const hour = Math.min(23, Math.max(0, Math.trunc(parts.hour) || 0));
  const minute = Math.min(59, Math.max(0, Math.trunc(parts.minute) || 0));
  return { year, month, day, hour, minute };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?\s*(?:Z)?$/;

/**
 * Parse a picker value (an ISO string as produced here, a date-only
 * ISO string, or a Date) into parts. Returns null for anything else,
 * including out-of-range fields like month 13 or February 30.
 */
export function parseDateTimeValue(value: unknown): DateTimeParts | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
      hour: value.getHours(),
      minute: value.getMinutes(),
    };
  }
  if (typeof value !== 'string') return null;
  const m = ISO_RE.exec(value.trim());
  if (!m) return null;
  const parts: DateTimeParts = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: m[4] === undefined ? 0 : Number(m[4]),
    minute: m[5] === undefined ? 0 : Number(m[5]),
  };
  if (parts.month < 1 || parts.month > 12) return null;
  if (parts.day < 1 || parts.day > daysInMonth(parts.year, parts.month)) return null;
  if (parts.hour < 0 || parts.hour > 23 || parts.minute < 0 || parts.minute > 59) return null;
  return parts;
}

/** Compose parts into the ISO string form the picker emits. */
export function composeDateTimeIso(parts: DateTimeParts): string {
  const p = clampDateTimeParts(parts);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}:00`;
}

/** The current local date and time as parts (the picker's fallback value). */
export function nowParts(): DateTimeParts {
  const d = new Date();
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
  };
}

/** The 12-hour clock hour of parts (1 to 12); iOS wheels use this form. */
export function hour12Of(parts: DateTimeParts): number {
  const h = parts.hour % 12;
  return h === 0 ? 12 : h;
}

/** 'AM' or 'PM' for parts. */
export function ampmOf(parts: DateTimeParts): 'AM' | 'PM' {
  return parts.hour < 12 ? 'AM' : 'PM';
}

/**
 * The field display text of a value, the same text in the generated
 * app and the preview: `Nov 13, 2026` for date mode, `9:00 AM` for
 * time mode, both joined for datetime mode.
 */
export function formatDateTimeValue(parts: DateTimeParts, mode: PickerMode): string {
  const p = clampDateTimeParts(parts);
  const date = `${MONTH_SHORT[p.month - 1]} ${p.day}, ${p.year}`;
  const time = `${hour12Of(p)}:${pad2(p.minute)} ${ampmOf(p)}`;
  if (mode === 'date') return date;
  if (mode === 'time') return time;
  return `${date} ${time}`;
}

/** The year wheel of date mode: the value's year plus and minus 25 years (51 entries). */
export function pickerYears(anchorYear: number): number[] {
  const years: number[] = [];
  for (let y = anchorYear - 25; y <= anchorYear + 25; y++) years.push(y);
  return years;
}

/** The minute wheel values for a minute interval (1 or 5 in this version). */
export function pickerMinutes(minuteInterval: number): number[] {
  const step = minuteInterval === 5 ? 5 : 1;
  const minutes: number[] = [];
  for (let m = 0; m < 60; m += step) minutes.push(m);
  return minutes;
}

/** One wheel of the picker: its name, its options and its selected value. */
export interface WheelSpec {
  name: 'month' | 'day' | 'year' | 'date' | 'hour' | 'minute' | 'ampm';
  options: { value: string; label: string }[];
  value: string;
}

/** How many days either side of the value the datetime mode date wheel spans. */
export const DATE_WHEEL_DAYS = 183;

/** Day arithmetic on the UTC calendar, so daylight saving never shifts a date. */
function addDays(year: number, month: number, day: number, n: number): { year: number; month: number; day: number } {
  const dt = new Date(Date.UTC(year, month - 1, day + n));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

/**
 * The wheels of one picker mode for a pending value:
 * - date: month, day, year wheels;
 * - time: hour (1 to 12), minute, AM/PM wheels, the iOS form;
 * - datetime: one combined date wheel (a window of days around the
 *   value, labelled like `Nov 13 2026`, the way the iOS date and time
 *   picker lists days), then hour, minute and AM/PM wheels.
 */
export function dateTimeWheels(parts: DateTimeParts, mode: PickerMode, minuteInterval: number): WheelSpec[] {
  const p = clampDateTimeParts(parts);
  const wheels: WheelSpec[] = [];
  if (mode === 'date') {
    wheels.push({
      name: 'month',
      options: MONTH_SHORT.map((label, i) => ({ value: `${i + 1}`, label })),
      value: `${p.month}`,
    });
    const days: { value: string; label: string }[] = [];
    for (let d = 1; d <= daysInMonth(p.year, p.month); d++) days.push({ value: `${d}`, label: `${d}` });
    wheels.push({ name: 'day', options: days, value: `${p.day}` });
    wheels.push({
      name: 'year',
      options: pickerYears(p.year).map((y) => ({ value: `${y}`, label: `${y}` })),
      value: `${p.year}`,
    });
  }
  if (mode === 'datetime') {
    const options: { value: string; label: string }[] = [];
    for (let n = -DATE_WHEEL_DAYS; n <= DATE_WHEEL_DAYS; n++) {
      const d = addDays(p.year, p.month, p.day, n);
      options.push({
        value: `${d.year}-${pad2(d.month)}-${pad2(d.day)}`,
        label: `${MONTH_SHORT[d.month - 1]} ${d.day} ${d.year}`,
      });
    }
    wheels.push({
      name: 'date',
      options,
      value: `${p.year}-${pad2(p.month)}-${pad2(p.day)}`,
    });
  }
  if (mode === 'time' || mode === 'datetime') {
    const hours: { value: string; label: string }[] = [];
    for (let h = 1; h <= 12; h++) hours.push({ value: `${h}`, label: `${h}` });
    wheels.push({ name: 'hour', options: hours, value: `${hour12Of(p)}` });
    // A value between steps (9:03 with a 5 minute interval) selects
    // the nearest step, the way the iOS wheel settles; picking any
    // step then sets the minute exactly.
    const step = minuteInterval === 5 ? 5 : 1;
    const snappedMinute = Math.min(60 - step, Math.round(p.minute / step) * step);
    wheels.push({
      name: 'minute',
      options: pickerMinutes(minuteInterval).map((m) => ({ value: `${m}`, label: pad2(m) })),
      value: `${snappedMinute}`,
    });
    wheels.push({
      name: 'ampm',
      options: [{ value: 'AM', label: 'AM' }, { value: 'PM', label: 'PM' }],
      value: ampmOf(p),
    });
  }
  return wheels;
}

/**
 * Apply one wheel selection to a pending value and return the new
 * pending value. Day clamps into its month (January 31 to February
 * becomes February 28 or 29); hour and AM/PM compose the 24-hour
 * hour between them.
 */
export function applyWheelValue(parts: DateTimeParts, wheel: string, value: string): DateTimeParts {
  const p = clampDateTimeParts(parts);
  switch (wheel) {
    case 'month': return clampDateTimeParts({ ...p, month: Number(value) });
    case 'day': return clampDateTimeParts({ ...p, day: Number(value) });
    case 'year': return clampDateTimeParts({ ...p, year: Number(value) });
    case 'date': {
      const parsed = parseDateTimeValue(value);
      if (!parsed) return p;
      return { ...p, year: parsed.year, month: parsed.month, day: parsed.day };
    }
    case 'hour': {
      const h12 = Number(value);
      if (!Number.isFinite(h12)) return p;
      return { ...p, hour: (h12 % 12) + (p.hour >= 12 ? 12 : 0) };
    }
    case 'minute': return { ...p, minute: Number(value) || 0 };
    case 'ampm': {
      const wantPm = value === 'PM';
      const isPm = p.hour >= 12;
      if (wantPm === isPm) return p;
      return { ...p, hour: wantPm ? p.hour + 12 : p.hour - 12 };
    }
    default: return p;
  }
}
