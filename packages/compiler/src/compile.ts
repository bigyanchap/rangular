import {
  ClassFileInfo,
  ComponentInfo,
  parseClassFile,
  ServiceInfo,
} from './class/parseComponent';
import { ChildUnitInput, generateComponent } from './codegen/generate';
import { Diagnostic, error, warning } from './diagnostics';
import { parseCss, ParsedCss } from './style/css';
import { TemplateRoot } from './template/ast';
import { parseTemplate } from './template/parser';

export interface ResolvedSource {
  source: string;
  /** Canonical key for the resolved file (used for cycle detection). */
  fileName: string;
}

export interface CompileOptions {
  tsSource: string;
  fileName?: string;
  /** Inline template content, when the caller already read templateUrl. */
  templateSource?: string;
  /** Resolver for templateUrl / styleUrls, e.g. reading from disk in the CLI. */
  resolveFile?: (relativePath: string) => string | undefined;
  /**
   * Resolver for relative imports (Stage 3): given a specifier like
   * './mail.service' and the importing file's key, return its source.
   * When absent, resolveFile is tried with the specifier and with '.ts'
   * appended, using the specifier itself as the file key.
   */
  resolveImport?: (specifier: string, importerFileName: string) => ResolvedSource | undefined;
}

export interface CompileResult {
  code: string;
  diagnostics: Diagnostic[];
  ast?: TemplateRoot;
  component?: ComponentInfo;
  css?: ParsedCss;
  /** Child components resolved through imports, with parsed templates (M5). */
  children: ChildUnitInput[];
  /** Every @Injectable class resolved through imports (M6). */
  services: ServiceInfo[];
}

/**
 * The full pipeline: class parse -> import registry (Stage 3: child
 * components and services are followed through relative imports) ->
 * template parse -> CSS parse -> code generation. Never throws for bad
 * user input; it reports diagnostics.
 */
export function compileComponent(options: CompileOptions): CompileResult {
  const diagnostics: Diagnostic[] = [];
  const entryKey = options.fileName ?? 'component.ts';

  const readRelative = (importer: string, rel: string): ResolvedSource | undefined => {
    if (options.resolveImport) return options.resolveImport(rel, importer);
    if (options.resolveFile) {
      const direct = options.resolveFile(rel);
      if (direct !== undefined) return { source: direct, fileName: rel };
      const withExt = options.resolveFile(rel + '.ts');
      if (withExt !== undefined) return { source: withExt, fileName: rel + '.ts' };
    }
    return undefined;
  };

  // --- Import registry (Stage 3) -------------------------------------------
  // Classes are registered BEFORE recursing into a file's imports, so an
  // import cycle still resolves every class on the cycle; the cycle itself
  // is reported once as CMP_IMPORT_CYCLE.
  const componentsBySelector = new Map<string, { info: ComponentInfo; fileName: string }>();
  const servicesByName = new Map<string, ServiceInfo>();
  const visited = new Set<string>();
  const stack: string[] = [];
  let entryParsed: ClassFileInfo | undefined;

  const visitFile = (fileName: string, source: string): void => {
    if (stack.includes(fileName)) {
      diagnostics.push(warning(
        'CMP_IMPORT_CYCLE',
        `Import cycle detected: ${[...stack, fileName].join(' -> ')} — classes on the cycle were registered from their first visit`,
        undefined, undefined,
        'Break the cycle by moving the shared class (component or service) into its own file that both sides import',
      ));
      return;
    }
    if (visited.has(fileName)) return;
    visited.add(fileName);
    stack.push(fileName);
    const parsed = parseClassFile(source, fileName);
    if (fileName === entryKey) entryParsed = parsed;
    for (const info of parsed.components) {
      if (!info.selector) continue;
      const prev = componentsBySelector.get(info.selector);
      if (prev && prev.info.className !== info.className) {
        diagnostics.push(error(
          'CMP_DUP_SELECTOR',
          `Selector '${info.selector}' is declared by both ${prev.info.className} and ${info.className}`,
          undefined, undefined,
          'Give each component a unique selector — selectors are how templates find child components',
        ));
      } else if (!prev) {
        componentsBySelector.set(info.selector, { info, fileName });
      }
    }
    for (const svc of parsed.services) {
      if (!servicesByName.has(svc.className)) servicesByName.set(svc.className, svc);
    }
    for (const imp of parsed.imports) {
      if (!imp.from.startsWith('.')) continue;
      const resolved = readRelative(fileName, imp.from);
      if (!resolved) {
        diagnostics.push(error(
          'CMP_IMPORT_UNRESOLVED',
          `Could not resolve import '${imp.from}' from '${fileName}'`,
          undefined, undefined,
          `Check the path is relative to the importing file and the file exists — e.g. import { MailService } from './mail.service';`,
        ));
        continue;
      }
      visitFile(resolved.fileName, resolved.source);
    }
    stack.pop();
  };
  visitFile(entryKey, options.tsSource);

  const component = entryParsed?.components[0];
  if (!component) {
    diagnostics.push(error('CLS_NO_COMPONENT', 'No @Component-decorated class found in the source', undefined, undefined, "Decorate the class: @Component({ selector: 'app-x', templateUrl: './x.component.html' }) export class XComponent { ... } — only @Component classes are compiled; @NgModule/@Injectable classes are not entry points"));
    return { code: '', diagnostics, children: [], services: [...servicesByName.values()] };
  }

  // --- Entry template --------------------------------------------------------
  let templateSource = options.templateSource ?? component.template;
  if (!templateSource && component.templateUrl) {
    templateSource = options.resolveFile?.(component.templateUrl)
      ?? readRelative(entryKey, component.templateUrl)?.source;
    if (!templateSource) {
      diagnostics.push(error(
        'CMP_TEMPLATE',
        `Could not resolve templateUrl '${component.templateUrl}' — pass templateSource or a resolveFile callback`,
        undefined, undefined,
        'Check the path is relative to the component file and the template file exists — e.g. templateUrl: \'./x.component.html\'',
      ));
      return { code: '', diagnostics, component, children: [], services: [...servicesByName.values()] };
    }
  }
  if (!templateSource) {
    diagnostics.push(error('CMP_TEMPLATE', 'Component has neither an inline template nor a templateUrl', undefined, undefined, "Add templateUrl: './x.component.html' (or an inline template: `...`) to the @Component decorator"));
    return { code: '', diagnostics, component, children: [], services: [...servicesByName.values()] };
  }

  const { root, diagnostics: tplDiags } = parseTemplate(templateSource);
  diagnostics.push(...tplDiags);

  const loadCss = (info: ComponentInfo, fileKey: string): ParsedCss => {
    let stylesText = info.styles ?? '';
    for (const url of info.styleUrls) {
      const cssText = fileKey === entryKey
        ? options.resolveFile?.(url) ?? readRelative(fileKey, url)?.source
        : readRelative(fileKey, url)?.source;
      if (cssText) stylesText += '\n' + cssText;
    }
    return parseCss(stylesText);
  };
  const css = loadCss(component, entryKey);

  // --- Child components: parse each registered child's template -------------
  const children: ChildUnitInput[] = [];
  for (const { info, fileName } of componentsBySelector.values()) {
    if (info === component) continue;
    let childTemplate = info.template;
    if (!childTemplate && info.templateUrl) {
      childTemplate = readRelative(fileName, info.templateUrl)?.source;
      if (!childTemplate) {
        diagnostics.push(error(
          'CMP_TEMPLATE',
          `Could not resolve templateUrl '${info.templateUrl}' for child component ${info.className}`,
          undefined, undefined,
          'Check the path is relative to the child component file and the template file exists',
        ));
        continue;
      }
    }
    if (!childTemplate) {
      diagnostics.push(error('CMP_TEMPLATE', `Child component ${info.className} has neither an inline template nor a templateUrl`, undefined, undefined, "Add templateUrl: './x.component.html' (or an inline template) to the child's @Component decorator"));
      continue;
    }
    const parsedTpl = parseTemplate(childTemplate);
    diagnostics.push(...parsedTpl.diagnostics);
    children.push({ info, ast: parsedTpl.root, css: loadCss(info, fileName) });
  }

  const services = [...servicesByName.values()];
  const { code, diagnostics: genDiags } = generateComponent(component, root, css, { children, services });
  diagnostics.push(...genDiags);

  return { code, diagnostics, ast: root, component, css, children, services };
}

export function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}
