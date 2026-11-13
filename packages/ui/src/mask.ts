/**
 * Input masks (Stage 15), pure TypeScript with no imports: the value
 * model the RgInput primitive, the compiler's preview paint and the
 * preview page runtime all share. The page runtime mirrors this
 * function in plain JavaScript; the two implementations are
 * parity-tested against the same case tables in tests/stage15.test.ts.
 *
 * The pattern language is deliberately small, three slot characters
 * and literals everywhere else:
 *
 *   9   one digit (0 to 9)
 *   A   one letter (a to z, A to Z)
 *   *   one character of any kind
 *
 * Every other pattern character is a literal: it appears in the
 * output once the slot after it is filled, so a half typed value
 * never trails dangling separators. Characters the user types that
 * do not fit the next open slot are skipped, and typing a literal
 * that matches the pattern's next literal is accepted silently (a
 * user typing the dash in a phone number is not punished for it).
 *
 * The masked string is the value: the component field holds the
 * formatted text (a mask="(999) 999-9999" field reads
 * "(555) 123-4567"), the same way ngx-mask's default keeps the
 * formatted value in the model. There is no raw-value channel in
 * this version.
 */

/** True when a pattern character is one of the three slot kinds. */
export function isMaskSlot(ch: string): boolean {
  return ch === '9' || ch === 'A' || ch === '*';
}

function slotAccepts(slot: string, ch: string): boolean {
  if (slot === '9') return ch >= '0' && ch <= '9';
  if (slot === 'A') return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
  return true;
}

/**
 * Format `raw` through `pattern`, returning the masked string. Raw
 * input may itself be already masked (an edit in the middle, a
 * pasted formatted value): slot characters are re-extracted from it
 * in order, so formatting a formatted value is a no-op.
 */
export function applyMask(raw: string, pattern: string): string {
  const input = String(raw ?? '');
  // Pass 1: pull the characters that fill slots, in order. While
  // looking for the next slot, a typed character equal to the
  // literal it lands on is consumed as that literal.
  const filled: string[] = [];
  let pi = 0;
  for (const ch of input) {
    let consumed = false;
    while (pi < pattern.length && !isMaskSlot(pattern[pi])) {
      if (pattern[pi] === ch) { consumed = true; pi++; break; }
      pi++;
    }
    if (consumed) continue;
    if (pi >= pattern.length) break;
    if (slotAccepts(pattern[pi], ch)) {
      filled.push(ch);
      pi++;
    }
  }
  // Pass 2: rebuild the string. Literals are buffered and only
  // flushed when the slot after them is filled, so a partial value
  // never ends with a dangling separator.
  let out = '';
  let pending = '';
  let fi = 0;
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i];
    if (isMaskSlot(p)) {
      if (fi >= filled.length) break;
      out += pending + filled[fi++];
      pending = '';
    } else {
      pending += p;
    }
  }
  return out;
}

/** How many slot characters a complete value for this pattern holds. */
export function maskLength(pattern: string): number {
  let n = 0;
  for (const ch of pattern) if (isMaskSlot(ch)) n++;
  return n;
}
