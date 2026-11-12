/** A compiler diagnostic. Bad input produces diagnostics, never a thrown exception. */
export interface Diagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  /** 1-based line in the offending source, when known. */
  line?: number;
  /** 1-based column in the offending source, when known. */
  column?: number;
}

export function error(code: string, message: string, line?: number, column?: number): Diagnostic {
  return { severity: 'error', code, message, line, column };
}

export function warning(code: string, message: string, line?: number, column?: number): Diagnostic {
  return { severity: 'warning', code, message, line, column };
}

export function formatDiagnostic(d: Diagnostic): string {
  const where = d.line !== undefined ? ` (${d.line}:${d.column ?? 1})` : '';
  return `${d.severity.toUpperCase()} ${d.code}${where}: ${d.message}`;
}
