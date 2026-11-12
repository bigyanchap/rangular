import {
  ClassFileInfo,
  ComponentInfo,
  parseClassFile,
  ServiceInfo,
} from './class/parseComponent';
import { parseRoutesFile, ResolvedRoute } from './class/parseRoutes';
import { analyzeFormInitializer, isFormInitializer } from './class/formInit';
import { ChildUnitInput, generateComponent } from './codegen/generate';
import { SourceMapV3 } from './codegen/sourceMap';
import { Diagnostic, error, warning } from './diagnostics';
import { parseCss, ParsedCss } from './style/css';
import { TemplateNode, TemplateRoot } from './template/ast';
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
  /** Ask codegen for a block level source map (Stage 5). */
  sourceMap?: boolean;
  /**
   * Routes file specifier (Stage 9), resolved like a relative import
   * from the entry file, e.g. './app.routes.ts'. When omitted, the
   * compiler auto-discovers a sibling 'app.routes.ts' next to the entry
   * component: the routes file is read whenever it exists, and required
   * (GEN_ROUTES_MISSING) whenever a template uses <router-outlet> or
   * routerLink, or a component injects Router / ActivatedRoute.
   */
  routesSpecifier?: string;
  /**
   * Project root boundary (security audit, 2026-11-12): when set, every
   * file a compilation resolves (templateUrl, styleUrls, relative
   * imports) must stay inside this directory tree. A path that escapes
   * is refused with a CMP_PATH_ESCAPE error and the file is never used.
   * The CLI sets this to the nearest ancestor of the entry file that
   * holds a package.json, falling back to the entry file's directory.
   * Library callers who omit it keep the previous trusting behaviour.
   * The check applies to absolute file keys; bare in-memory keys are
   * not filesystem paths and are left alone.
   */
  rootDir?: string;
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
  /**
   * The resolved route table (Stage 9): the routes file's entries with
   * their component classes resolved against the registry. Empty when
   * the compilation has no routes file.
   */
  routes: ResolvedRoute[];
  /**
   * Every source file this compilation read (Stage 5): the entry .ts, the
   * templates, and every resolved relative import. `rangular watch` watches
   * exactly this set and re-resolves it after each compile.
   */
  files: string[];
  /** Block level source map, present only when requested (Stage 5). */
  sourceMap?: SourceMapV3;
}

/**
 * Join a templateUrl or styleUrl onto the directory of the file that
 * declares it, with '.' and '..' segments normalised. File keys here are
 * plain strings (absolute paths from the CLI, bare names in tests), so
 * this stays string based and platform neutral.
 */
export function resolveSiblingPath(fromFile: string, rel: string): string {
  if (rel.startsWith('/')) return rel;
  const dir = fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/')) : '';
  const parts = (dir ? dir.split('/') : []).filter((p) => p !== '');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return (fromFile.startsWith('/') ? '/' : '') + parts.join('/');
}

/** Normalise a string file key ('.' and '..' segments resolved). */
function normalizeKey(p: string): string {
  const isAbs = p.startsWith('/');
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop();
      else if (!isAbs) parts.push('..');
      continue;
    }
    parts.push(seg);
  }
  return (isAbs ? '/' : '') + parts.join('/');
}

/**
 * True when `candidate` is `root` or lives under it. Only absolute keys
 * are judged: a relative or bare key is an in-memory name from a test
 * resolver, not a filesystem path, and is always allowed through (the
 * CLI passes absolute keys, so the boundary is enforced there).
 */
export function isWithinRoot(candidate: string, root: string): boolean {
  if (!candidate.startsWith('/') || !root.startsWith('/')) return true;
  const c = normalizeKey(candidate);
  const r = normalizeKey(root);
  if (c === r) return true;
  const prefix = r.endsWith('/') ? r : `${r}/`;
  return c.startsWith(prefix);
}

/** Tag diagnostics with their source file where the origin is known (Stage 5). */
function tagFile(diags: Diagnostic[], file: string | undefined): Diagnostic[] {
  if (!file) return diags;
  return diags.map((d) => (d.file ? d : { ...d, file }));
}

/**
 * Diagnostic codes whose origin is the template file rather than the
 * class file: template parse problems plus the codegen diagnostics that
 * carry template positions (unknown tags, structural TODO notes). The
 * TPL_NGFOR codes come out of codegen via parseNgFor, so they are listed
 * here as well as under the TPL prefix.
 */
function isTemplateDriven(code: string): boolean {
  return code.startsWith('TPL_')
    || code === 'GEN_UNKNOWN_TAG'
    || code === 'GEN_NGIF_ELSE_TODO'
    || code === 'GEN_STRUCTURAL_TODO'
    || code === 'GEN_CONTROL_NESTING'
    || code === 'GEN_ICON_UNKNOWN'
    || code === 'GEN_ICON_NAME'
    || code === 'GEN_ICON_SIZE'
    || code === 'GEN_NGMODEL_TARGET'
    || code === 'GEN_NGMODEL_EXPR'
    || code === 'GEN_FORM_CONTROL'
    || code === 'GEN_FORMGROUP_TYPE'
    || code === 'GEN_ROUTE_UNSUPPORTED';
}

function isStyleDriven(code: string): boolean {
  return code.startsWith('CSS_') || code === 'STYLE_OFF_SCALE';
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

  // Project root boundary (security audit, 2026-11-12): see rootDir.
  const rootDir = options.rootDir;
  const escapesRoot = (p: string): boolean => rootDir !== undefined && !isWithinRoot(p, rootDir);
  const pathEscape = (what: string, p: string): Diagnostic => error(
    'CMP_PATH_ESCAPE',
    `${what} '${p}' resolves outside the project root '${rootDir}'; the file was not read`,
    undefined, undefined,
    'Keep every templateUrl, styleUrl and relative import inside the project tree (the folder holding your package.json), or move the file into the project',
  );
  /** The styleUrls of one class that stay inside the root; escapes are reported and dropped. */
  const allowedStyleUrls = (info: ComponentInfo, fileKey: string): string[] => {
    const allowed: string[] = [];
    for (const url of info.styleUrls) {
      const key = resolveSiblingPath(fileKey, url);
      if (escapesRoot(key)) {
        diagnostics.push(pathEscape(`styleUrl '${url}' of ${info.className}`, key));
        continue;
      }
      allowed.push(url);
    }
    return allowed;
  };

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
  /** Source text per visited file, kept for source map sourcesContent. */
  const fileSources = new Map<string, string>();
  let entryParsed: ClassFileInfo | undefined;

  const visitFile = (fileName: string, source: string): void => {
    fileSources.set(fileName, source);
    if (stack.includes(fileName)) {
      diagnostics.push(warning(
        'CMP_IMPORT_CYCLE',
        `Import cycle detected: ${[...stack, fileName].join(' -> ')}, classes on the cycle were registered from their first visit`,
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
          'Give each component a unique selector, selectors are how templates find child components',
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
          `Check the path is relative to the importing file and the file exists, e.g. import { MailService } from './mail.service';`,
        ));
        continue;
      }
      if (escapesRoot(resolved.fileName)) {
        diagnostics.push(pathEscape(`Import '${imp.from}' from '${fileName}'`, resolved.fileName));
        continue;
      }
      visitFile(resolved.fileName, resolved.source);
    }
    stack.pop();
  };
  visitFile(entryKey, options.tsSource);
  const files = [...visited];

  const component = entryParsed?.components[0];
  if (!component) {
    diagnostics.push({ ...error('CLS_NO_COMPONENT', 'No @Component-decorated class found in the source', undefined, undefined, "Decorate the class: @Component({ selector: 'app-x', templateUrl: './x.component.html' }) export class XComponent { ... }, only @Component classes are compiled; @NgModule/@Injectable classes are not entry points"), file: entryKey });
    return { code: '', diagnostics, children: [], services: [...servicesByName.values()], routes: [], files };
  }

  // --- Entry template --------------------------------------------------------
  // The resolved template path (for per-file diagnostics and the watch set).
  // An inline template lives in the .ts file itself, so its diagnostics
  // belong to the class file.
  const entryTemplateFile = component.templateUrl
    ? resolveSiblingPath(entryKey, component.templateUrl)
    : entryKey;
  if (component.templateUrl && escapesRoot(entryTemplateFile)) {
    diagnostics.push(pathEscape(`templateUrl '${component.templateUrl}'`, entryTemplateFile));
    return { code: '', diagnostics, component, children: [], services: [...servicesByName.values()], routes: [], files };
  }
  if (component.templateUrl) files.push(entryTemplateFile);
  const entryStyleUrls = allowedStyleUrls(component, entryKey);
  for (const url of entryStyleUrls) files.push(resolveSiblingPath(entryKey, url));
  let templateSource = options.templateSource ?? component.template;
  if (!templateSource && component.templateUrl) {
    templateSource = options.resolveFile?.(component.templateUrl)
      ?? readRelative(entryKey, component.templateUrl)?.source;
    if (!templateSource) {
      diagnostics.push({ ...error(
        'CMP_TEMPLATE',
        `Could not resolve templateUrl '${component.templateUrl}', pass templateSource or a resolveFile callback`,
        undefined, undefined,
        'Check the path is relative to the component file and the template file exists, e.g. templateUrl: \'./x.component.html\'',
      ), file: entryKey });
      return { code: '', diagnostics, component, children: [], services: [...servicesByName.values()], routes: [], files };
    }
  }
  if (!templateSource) {
    diagnostics.push({ ...error('CMP_TEMPLATE', 'Component has neither an inline template nor a templateUrl', undefined, undefined, "Add templateUrl: './x.component.html' (or an inline template: `...`) to the @Component decorator"), file: entryKey });
    return { code: '', diagnostics, component, children: [], services: [...servicesByName.values()], routes: [], files };
  }

  const { root, diagnostics: tplDiags } = parseTemplate(templateSource);
  diagnostics.push(...tagFile(tplDiags, entryTemplateFile));

  // --- Routes (Stage 9) ------------------------------------------------------
  // Discovery rule (the one rule, also stated in AGENTS.md and the
  // Routing section of docs/VIBE_CODING.md): the routes file is the one
  // named by routesSpecifier (the CLI --routes flag), or a sibling
  // 'app.routes.ts' next to the entry component. It is read whenever it
  // exists; it is REQUIRED whenever routing is used: a <router-outlet>
  // or routerLink in a template, or a Router / ActivatedRoute injection
  // in any registered component. The routes file is visited like any
  // imported file, so the components it imports register as children
  // before the child pass below runs.
  const routingUsageIn = (nodes: TemplateNode[]): { outlet: boolean; links: boolean } => {
    const usage = { outlet: false, links: false };
    const walk = (list: TemplateNode[]): void => {
      for (const n of list) {
        if (n.type !== 'element') continue;
        if (n.tag.toLowerCase() === 'router-outlet') usage.outlet = true;
        if (n.attrs['routerLink'] !== undefined
          || n.propBindings.some((b) => b.name === 'routerLink')) usage.links = true;
        walk(n.children);
      }
    };
    walk(nodes);
    return usage;
  };
  const entryUsage = routingUsageIn(root.children);
  const injectsRouter = [component, ...[...componentsBySelector.values()].map((c) => c.info)]
    .some((info) => (info.constructorDeps ?? []).some(
      (d) => d.typeName === 'Router' || d.typeName === 'ActivatedRoute',
    ));
  const routingUsed = entryUsage.outlet || entryUsage.links || injectsRouter;
  const routesSpecifier = options.routesSpecifier ?? './app.routes.ts';
  // A resolver may signal a missing file by throwing instead of
  // returning undefined; for the optional routes file both mean absent.
  let routesResolved: { source: string; fileName: string } | undefined;
  try {
    routesResolved = readRelative(entryKey, routesSpecifier);
  } catch {
    routesResolved = undefined;
  }
  let routes: ResolvedRoute[] | undefined;
  if (routesResolved) {
    if (escapesRoot(routesResolved.fileName)) {
      diagnostics.push(pathEscape(`Routes file '${routesSpecifier}'`, routesResolved.fileName));
    } else {
      const visitedBefore = new Set(files);
      visitFile(routesResolved.fileName, routesResolved.source);
      for (const f of visited) if (!visitedBefore.has(f)) files.push(f);
      const parsedRoutes = parseRoutesFile(routesResolved.source, routesResolved.fileName);
      diagnostics.push(...tagFile(parsedRoutes.diagnostics, routesResolved.fileName));
      if (!parsedRoutes.found && (routingUsed || options.routesSpecifier)) {
        diagnostics.push({
          ...error(
            'GEN_ROUTES_MISSING',
            `Routes file '${routesResolved.fileName}' holds no Routes array; nothing was registered`,
            undefined, undefined,
            "Export the route table from the routes file: export const routes: Routes = [{ path: 'home', component: HomeComponent }];",
          ),
          file: entryKey,
        });
      } else {
        const byClassName = new Map<string, ComponentInfo>();
        byClassName.set(component.className, component);
        for (const { info } of componentsBySelector.values()) byClassName.set(info.className, info);
        const seenPaths = new Set<string>();
        routes = [];
        for (const def of parsedRoutes.routes) {
          if (seenPaths.has(def.path)) {
            diagnostics.push({
              ...warning(
                'GEN_ROUTE_DUPLICATE',
                `Path '${def.path}' is declared more than once in the routes file; the first entry wins and this one never matches`,
                undefined, undefined,
                'Give each route a unique path; matching tries entries in declaration order',
              ),
              file: routesResolved.fileName,
            });
          }
          seenPaths.add(def.path);
          if (def.componentName !== undefined) {
            const info = byClassName.get(def.componentName);
            if (!info) {
              diagnostics.push({
                ...error(
                  'GEN_ROUTE_COMPONENT',
                  `Route '${def.path}' names component '${def.componentName}', which is not an @Component class resolved in this compilation`,
                  undefined, undefined,
                  `Import ${def.componentName} in the routes file (its file is followed like any import) and make sure it is decorated with @Component`,
                ),
                file: routesResolved.fileName,
              });
              continue;
            }
            if (info === component) {
              diagnostics.push({
                ...error(
                  'GEN_ROUTE_COMPONENT',
                  `Route '${def.path}' names the root component '${def.componentName}' itself; the root component hosts the outlet and cannot also be a route target`,
                  undefined, undefined,
                  'Point the route at a separate screen component and keep the root component as the shell',
                ),
                file: routesResolved.fileName,
              });
              continue;
            }
            routes.push({ ...def, selector: info.selector });
          } else {
            routes.push({ ...def });
          }
        }
        const declaredPaths = new Set(parsedRoutes.routes.map((r) => r.path));
        for (const def of parsedRoutes.routes) {
          if (def.redirectTo !== undefined && !declaredPaths.has(def.redirectTo)) {
            diagnostics.push({
              ...error(
                'GEN_ROUTE_UNSUPPORTED',
                `Route '${def.path}' redirects to '${def.redirectTo}', which is not the path of any route in the table`,
                undefined, undefined,
                `Point redirectTo at a declared path (declared: ${[...declaredPaths].join(', ')}), or add a route with that path`,
              ),
              file: routesResolved.fileName,
            });
          }
        }
      }
    }
  } else if (routingUsed || options.routesSpecifier) {
    diagnostics.push({
      ...error(
        'GEN_ROUTES_MISSING',
        `Routing is used (${[
          entryUsage.outlet ? 'a <router-outlet>' : '',
          entryUsage.links ? 'routerLink' : '',
          injectsRouter ? 'a Router/ActivatedRoute injection' : '',
        ].filter(Boolean).join(', ')}) but no routes file was found at '${routesSpecifier}'`,
        undefined, undefined,
        "Create app.routes.ts next to the root component: export const routes: Routes = [{ path: 'home', component: HomeComponent }]; or pass the routes file explicitly (rangular build --routes <file>)",
      ),
      file: entryKey,
    });
  }

  const loadCss = (info: ComponentInfo, fileKey: string, styleUrls: string[]): ParsedCss => {
    let stylesText = info.styles ?? '';
    for (const url of styleUrls) {
      const cssText = fileKey === entryKey
        ? options.resolveFile?.(url) ?? readRelative(fileKey, url)?.source
        : readRelative(fileKey, url)?.source;
      if (cssText) stylesText += '\n' + cssText;
    }
    return parseCss(stylesText);
  };
  const css = loadCss(component, entryKey, entryStyleUrls);

  // --- Child components: parse each registered child's template -------------
  const children: ChildUnitInput[] = [];
  for (const { info, fileName } of componentsBySelector.values()) {
    if (info === component) continue;
    const childTemplateFile = info.templateUrl ? resolveSiblingPath(fileName, info.templateUrl) : fileName;
    if (info.templateUrl && escapesRoot(childTemplateFile)) {
      diagnostics.push(pathEscape(`templateUrl '${info.templateUrl}' of child component ${info.className}`, childTemplateFile));
      continue;
    }
    if (info.templateUrl) files.push(childTemplateFile);
    const childStyleUrls = allowedStyleUrls(info, fileName);
    for (const url of childStyleUrls) files.push(resolveSiblingPath(fileName, url));
    let childTemplate = info.template;
    if (!childTemplate && info.templateUrl) {
      childTemplate = readRelative(fileName, info.templateUrl)?.source;
      if (!childTemplate) {
        diagnostics.push({ ...error(
          'CMP_TEMPLATE',
          `Could not resolve templateUrl '${info.templateUrl}' for child component ${info.className}`,
          undefined, undefined,
          'Check the path is relative to the child component file and the template file exists',
        ), file: fileName });
        continue;
      }
    }
    if (!childTemplate) {
      diagnostics.push({ ...error('CMP_TEMPLATE', `Child component ${info.className} has neither an inline template nor a templateUrl`, undefined, undefined, "Add templateUrl: './x.component.html' (or an inline template) to the child's @Component decorator"), file: fileName });
      continue;
    }
    const parsedTpl = parseTemplate(childTemplate);
    diagnostics.push(...tagFile(parsedTpl.diagnostics, childTemplateFile));
    if (options.sourceMap) fileSources.set(childTemplateFile, childTemplate);
    children.push({ info, ast: parsedTpl.root, css: loadCss(info, fileName, childStyleUrls), fileName, templateFile: childTemplateFile });
  }

  const services = [...servicesByName.values()];
  // Reactive form initializers the preview cannot evaluate (Stage 8):
  // the generated app runs them verbatim, so this is a warning, and it
  // belongs to the class file that declares the field.
  for (const [info, file] of [
    [component, entryKey] as const,
    ...children.map((c) => [c.info, c.fileName ?? entryKey] as const),
  ]) {
    for (const field of info.fields) {
      if (!isFormInitializer(field.initializer)) continue;
      const analysis = analyzeFormInitializer(field.initializer!);
      if (!analysis.supported) {
        diagnostics.push({
          ...warning(
            'GEN_FORM_INITIALIZER',
            `Field '${field.name}' of ${info.className} has a form initializer the preview cannot evaluate (${analysis.reason ?? 'unsupported shape'}); the generated app runs it as written, but the preview renders the form without live values`,
            undefined, undefined,
            'Keep form initializers to literals, Validators references and validator calls: new FormGroup({ email: new FormControl(\'\', [Validators.required, Validators.email]) })',
          ),
          file,
        });
      }
    }
  }
  if (options.sourceMap) fileSources.set(entryTemplateFile, templateSource);
  const { code, diagnostics: genDiags, sourceMap } = generateComponent(component, root, css, {
    children,
    services,
    routes,
    ...(options.sourceMap
      ? { sourceMap: { entryTsFile: entryKey, entryTemplateFile, contents: fileSources } }
      : {}),
  });
  // Per-file origins for codegen diagnostics (Stage 5): template-driven
  // codes belong to the entry template (child units share the entry
  // tagging in v1), style codes to the file holding the entry styles
  // (the first styleUrl when external, else the .ts file), and everything
  // else to the entry class file.
  const entryStylesFile = component.styleUrls.length
    ? resolveSiblingPath(entryKey, component.styleUrls[0])
    : entryKey;
  for (const d of genDiags) {
    if (d.file) { diagnostics.push(d); continue; }
    if (isTemplateDriven(d.code)) diagnostics.push({ ...d, file: entryTemplateFile });
    else if (isStyleDriven(d.code)) diagnostics.push({ ...d, file: entryStylesFile });
    else diagnostics.push({ ...d, file: entryKey });
  }

  return { code, diagnostics, ast: root, component, css, children, services, routes: routes ?? [], files, sourceMap };
}

export function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}
