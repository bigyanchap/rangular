/** A compiler diagnostic. Bad input produces diagnostics, never a thrown exception. */
export interface Diagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  /** 1-based line in the offending source, when known. */
  line?: number;
  /** 1-based column in the offending source, when known. */
  column?: number;
  /**
   * The source file the diagnostic belongs to (Stage 5): the template
   * (.html) path for template diagnostics, the .ts path for class
   * diagnostics, and the file holding the styles for style diagnostics.
   * Optional: pipeline stages that do not know the origin leave it unset,
   * and compile.ts fills it in where the origin is known.
   */
  file?: string;
  /**
   * A concrete corrected pattern the author (human or AI) can apply.
   * Stage 2.5: diagnostics teach the fix, not just name the problem.
   */
  fix?: string;
  /**
   * The full list of valid icon names (Stage 7). Only GEN_ICON_UNKNOWN
   * carries it, so a JSON consumer can offer or check the whole set
   * without parsing the human readable message.
   */
  validIcons?: string[];
}

export function error(code: string, message: string, line?: number, column?: number, fix?: string): Diagnostic {
  return { severity: 'error', code, message, line, column, fix };
}

export function warning(code: string, message: string, line?: number, column?: number, fix?: string): Diagnostic {
  return { severity: 'warning', code, message, line, column, fix };
}

export function formatDiagnostic(d: Diagnostic, entryFile?: string): string {
  const where = d.line !== undefined ? ` (${d.line}:${d.column ?? 1})` : '';
  // The file is printed only when it differs from the file the user asked
  // about, so single-file output stays as terse as before (Stage 5).
  const fileNote = d.file && d.file !== entryFile ? ` [in ${d.file}]` : '';
  const head = `${d.severity.toUpperCase()} ${d.code}${where}: ${d.message}${fileNote}`;
  return d.fix ? `${head}\n  fix: ${d.fix}` : head;
}

/**
 * Every diagnostic code the compiler can emit, with its meaning.
 * Single source of truth: the catalog is generated from this list.
 */
export const DIAGNOSTIC_CODES: Record<string, string> = {
  TPL_INTERPOLATION: 'A {{ interpolation in a template is never closed with }}.',
  TPL_TAG: 'A "<" in a template is not followed by a tag name.',
  TPL_UNCLOSED: 'An element is opened but never closed.',
  TPL_ATTR: 'An attribute in a template could not be parsed.',
  TPL_CLOSE: 'A closing tag appears with no matching opening element.',
  TPL_MISMATCH: 'A closing tag does not match the currently open element.',
  TPL_NGFOR: 'The *ngFor microsyntax could not be parsed.',
  TPL_NGFOR_SEGMENT: 'A segment of *ngFor microsyntax is not supported and was ignored.',
  CLS_NO_COMPONENT: 'No class decorated with @Component was found in the source file.',
  CMP_TEMPLATE: 'The component template could not be resolved (missing inline template and templateUrl).',
  CSS_SELECTOR: 'A CSS selector is not an element or .class selector; the rule was skipped.',
  CSS_DECL: 'A CSS declaration is malformed (expected "property: value").',
  CSS_UNSUPPORTED: 'A CSS property is outside the supported subset; the declaration was dropped.',
  STYLE_OFF_SCALE: 'A spacing, radius or font-size value is off its design-token scale; the generated style uses the nearest on-scale value.',
  GEN_UNKNOWN_TAG: 'A template tag is not a known Rangular block; it was emitted as <View>.',
  GEN_FIELD: 'A field has a non-literal initializer and was not hoisted into the generated component.',
  GEN_FIELD_STATE: 'A field is assigned in a method but has a non-literal initializer, so it cannot become useState yet.',
  GEN_NGIF_ELSE_TODO: '*ngIf with else/then microsyntax is not generated yet; the element was emitted unconditionally.',
  GEN_STRUCTURAL_TODO: 'A structural directive other than *ngIf/*ngFor is not supported yet; the element was emitted unconditionally.',
  GEN_CONTROL_NESTING: 'A control declaration is nested in the wrong parent; option belongs in switcher and radio belongs in radio-group, and those groups accept only their own declarations.',
  GEN_ICON_UNKNOWN: 'An <icon> names an icon that is not in the Rangular icon set; the JSON form of this diagnostic carries the full valid list in validIcons.',
  GEN_ICON_NAME: 'An <icon> element has no name attribute and no [name] binding, so there is nothing to draw.',
  GEN_ICON_SIZE: 'An <icon> size is off the icon size scale (20, 24, 28); the generated code uses the nearest on-scale size.',
  METHOD_UNSUPPORTED: 'A statement in a component method is outside the supported translation subset; it was left as a TODO.',
  CMP_IMPORT_UNRESOLVED: 'A relative import in a compiled file could not be resolved to a source file.',
  CMP_PATH_ESCAPE: 'A templateUrl, styleUrl or relative import resolved to a file outside the project root; the file was not read.',
  CMP_IMPORT_CYCLE: 'Two or more source files import each other in a cycle; the cycle was broken at the repeated file, whose classes were already registered.',
  CMP_DUP_SELECTOR: 'Two different component classes declare the same selector in one compilation.',
  DI_UNKNOWN_TOKEN: 'A constructor dependency names a type that is not a known @Injectable({ providedIn: \'root\' }) service or HttpClient in this compilation.',
  DI_CYCLE: 'Injectable services depend on each other in a cycle; container registrations could not be ordered.',
  DOC_HEX_COLOR: 'Doctor: a hex colour literal appears in the component styles instead of a colour role token.',
  DOC_OFF_SCALE: 'Doctor: a spacing, radius or font-size value in the styles is off its design-token scale (the compiler would snap it).',
  DOC_RAW_TEXT: 'Doctor: loose text sits directly inside a container element instead of a text element.',
  DOC_TAP_TARGET: 'Doctor: an element with a (click) binding is sized below the 44 by 44 minimum tap target.',
  DOC_IMG_SIZE: 'Doctor: an image element has no declared width and height.',
  CLI_INIT_NOT_EMPTY: 'The rangular init command was pointed at a directory that is not empty.',
};
