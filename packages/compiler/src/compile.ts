import { parseComponent, ComponentInfo } from './class/parseComponent';
import { generateComponent } from './codegen/generate';
import { Diagnostic, error } from './diagnostics';
import { parseCss, ParsedCss } from './style/css';
import { TemplateRoot } from './template/ast';
import { parseTemplate } from './template/parser';

export interface CompileOptions {
  tsSource: string;
  fileName?: string;
  /** Inline template content, when the caller already read templateUrl. */
  templateSource?: string;
  /** Resolver for templateUrl / styleUrls, e.g. reading from disk in the CLI. */
  resolveFile?: (relativePath: string) => string | undefined;
}

export interface CompileResult {
  code: string;
  diagnostics: Diagnostic[];
  ast?: TemplateRoot;
  component?: ComponentInfo;
  css?: ParsedCss;
}

/**
 * The full Stage 0+1 pipeline: class parse -> template parse -> CSS parse ->
 * code generation. Never throws for bad user input; it reports diagnostics.
 */
export function compileComponent(options: CompileOptions): CompileResult {
  const diagnostics: Diagnostic[] = [];
  const { component, diagnostics: classDiags } = parseComponent(options.tsSource, options.fileName);
  diagnostics.push(...classDiags);
  if (!component) return { code: '', diagnostics };

  let templateSource = options.templateSource ?? component.template;
  if (!templateSource && component.templateUrl) {
    templateSource = options.resolveFile?.(component.templateUrl);
    if (!templateSource) {
      diagnostics.push(error(
        'CMP_TEMPLATE',
        `Could not resolve templateUrl '${component.templateUrl}' — pass templateSource or a resolveFile callback`,
        undefined, undefined,
        'Check the path is relative to the component file and the template file exists — e.g. templateUrl: \'./x.component.html\'',
      ));
      return { code: '', diagnostics, component };
    }
  }
  if (!templateSource) {
    diagnostics.push(error('CMP_TEMPLATE', 'Component has neither an inline template nor a templateUrl', undefined, undefined, "Add templateUrl: './x.component.html' (or an inline template: `...`) to the @Component decorator"));
    return { code: '', diagnostics, component };
  }

  const { root, diagnostics: tplDiags } = parseTemplate(templateSource);
  diagnostics.push(...tplDiags);

  let stylesText = component.styles ?? '';
  for (const url of component.styleUrls) {
    const cssText = options.resolveFile?.(url);
    if (cssText) stylesText += '\n' + cssText;
  }
  const css = parseCss(stylesText);

  const { code, diagnostics: genDiags } = generateComponent(component, root, css);
  diagnostics.push(...genDiags);

  return { code, diagnostics, ast: root, component, css };
}

export function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}
