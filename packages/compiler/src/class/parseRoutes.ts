import * as ts from 'typescript';
import { Diagnostic, error, warning } from '../diagnostics';

/**
 * Routes files (Stage 9): the Angular routing configuration, read with
 * the TypeScript compiler API like everything else in Rangular.
 *
 * Rangular mirrors the modern standalone Angular form: a routes file
 * exporting a `Routes` array,
 *
 *   import { Routes } from '@angular/router';
 *   export const routes: Routes = [
 *     { path: '', redirectTo: 'inbox', pathMatch: 'full' },
 *     { path: 'inbox', component: InboxComponent },
 *     { path: 'mail/:id', component: MailDetailComponent },
 *     { path: '**', component: NotFoundComponent },
 *   ];
 *
 * (Historically the same array was handed to RouterModule.forRoot in an
 * NgModule; Rangular has no modules, so the exported array is the whole
 * configuration, the way provideRouter(routes) consumes it in current
 * Angular.)
 *
 * One array is read per file: the first top-level variable whose name
 * ends in "routes" (any case) or whose type annotation mentions
 * `Routes`, with an array literal initializer. Each entry must be an
 * object literal; the supported keys are path, component, redirectTo
 * and pathMatch. Angular features beyond v1 (child routes, guards,
 * resolvers, lazy loading) are named by GEN_ROUTE_UNSUPPORTED errors,
 * never silently dropped. `data` and `title` are accepted and ignored:
 * they are metadata with no runtime effect in this version.
 */

export interface RouteDef {
  /** The path pattern as written, e.g. 'mail/:id', '' or '**'. */
  path: string;
  /** The component class name from `component: XComponent`, when present. */
  componentName?: string;
  /** The redirect target from `redirectTo: 'inbox'`, when present. */
  redirectTo?: string;
  /** The pathMatch value as written ('full' is the only behaviour v1 implements). */
  pathMatch?: string;
  /** Any key outside the supported set that was ignored with a warning. */
  ignoredKeys: string[];
}

/** A route with its component resolved against the compilation's registry. */
export interface ResolvedRoute extends RouteDef {
  /** The resolved component's selector, when the class resolved. */
  selector?: string;
}

export interface ParseRoutesResult {
  routes: RouteDef[];
  diagnostics: Diagnostic[];
  /** True when a Routes array was found in the file at all. */
  found: boolean;
}

/** Route entry keys whose Angular feature is not in Rangular v1. */
const UNSUPPORTED_KEYS: Record<string, string> = {
  children: 'child routes (nested outlets)',
  canActivate: 'route guards (canActivate)',
  canActivateChild: 'route guards (canActivateChild)',
  canDeactivate: 'route guards (canDeactivate)',
  canMatch: 'route guards (canMatch)',
  resolve: 'resolvers (resolve)',
  loadComponent: 'lazy loading (loadComponent)',
  loadChildren: 'lazy loading (loadChildren)',
};

const KNOWN_KEYS = new Set(['path', 'component', 'redirectTo', 'pathMatch', 'data', 'title']);

const FIX_UNSUPPORTED = 'Remove the unsupported key for now; the feature is on the roadmap in docs/ROADMAP.md (Stage 9 supports flat routes with components and full-path redirects only)';
const FIX_SHAPE = "Write each entry as an object literal: { path: 'mail/:id', component: MailDetailComponent } or { path: '', redirectTo: 'inbox', pathMatch: 'full' }";

function stringOf(node: ts.Expression | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

/** Unwrap `[...] as Routes` / `<Routes>[...]` to the array literal. */
function arrayOf(node: ts.Expression): ts.ArrayLiteralExpression | undefined {
  if (ts.isArrayLiteralExpression(node)) return node;
  if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) return arrayOf(node.expression);
  if (ts.isParenthesizedExpression(node)) return arrayOf(node.expression);
  return undefined;
}

function readEntry(node: ts.Expression, diagnostics: Diagnostic[]): RouteDef | undefined {
  if (!ts.isObjectLiteralExpression(node)) {
    diagnostics.push(error(
      'GEN_ROUTE_UNSUPPORTED',
      'A route entry is not an object literal; route entries must be written out in full',
      undefined, undefined, FIX_SHAPE,
    ));
    return undefined;
  }
  let path: string | undefined;
  let componentName: string | undefined;
  let redirectTo: string | undefined;
  let pathMatch: string | undefined;
  const ignoredKeys: string[] = [];
  for (const prop of node.properties) {
    if (ts.isSpreadAssignment(prop)) {
      diagnostics.push(error(
        'GEN_ROUTE_UNSUPPORTED',
        'A route entry uses a spread; spread entries cannot be read statically',
        undefined, undefined, FIX_SHAPE,
      ));
      continue;
    }
    if (!ts.isPropertyAssignment(prop)) {
      diagnostics.push(error(
        'GEN_ROUTE_UNSUPPORTED',
        'A route entry uses a shorthand or computed property; entries must be plain key: value pairs',
        undefined, undefined, FIX_SHAPE,
      ));
      continue;
    }
    const key = prop.name.getText().replace(/^['"]|['"]$/g, '');
    const unsupported = UNSUPPORTED_KEYS[key];
    if (unsupported) {
      diagnostics.push(error(
        'GEN_ROUTE_UNSUPPORTED',
        `Route entry uses '${key}', which is ${unsupported}; Rangular routing does not support it yet`,
        undefined, undefined, FIX_UNSUPPORTED,
      ));
      continue;
    }
    if (!KNOWN_KEYS.has(key)) {
      ignoredKeys.push(key);
      diagnostics.push(warning(
        'GEN_ROUTE_UNSUPPORTED',
        `Route entry key '${key}' is not a supported route key and was ignored`,
        undefined, undefined,
        "Supported keys are path, component, redirectTo and pathMatch (data and title are accepted and ignored); remove the key or see docs/ROADMAP.md for what is planned",
      ));
      continue;
    }
    if (key === 'path') path = stringOf(prop.initializer);
    else if (key === 'redirectTo') redirectTo = stringOf(prop.initializer);
    else if (key === 'pathMatch') pathMatch = stringOf(prop.initializer);
    else if (key === 'component') {
      componentName = ts.isIdentifier(prop.initializer) ? prop.initializer.text : undefined;
      if (componentName === undefined) {
        diagnostics.push(error(
          'GEN_ROUTE_UNSUPPORTED',
          'A route\'s component is not a plain class reference; lazy or computed components are not supported',
          undefined, undefined,
          'Name the component class directly and import it in the routes file: { path: \'inbox\', component: InboxComponent }',
        ));
      }
    }
    // data / title: accepted, no runtime effect in this version; they
    // are recorded in ignoredKeys so nothing is silently dropped.
    else if (key === 'data' || key === 'title') ignoredKeys.push(key);
  }
  if (path === undefined) {
    diagnostics.push(error(
      'GEN_ROUTE_UNSUPPORTED',
      'A route entry has no string \'path\'; every entry needs one',
      undefined, undefined, FIX_SHAPE,
    ));
    return undefined;
  }
  if (componentName !== undefined && redirectTo !== undefined) {
    diagnostics.push(error(
      'GEN_ROUTE_UNSUPPORTED',
      `Route '${path}' declares both a component and a redirectTo; Angular forbids the combination and so does Rangular`,
      undefined, undefined,
      'Keep one: a component route renders, a redirect route forwards. Split them into two entries if both paths are needed',
    ));
    return undefined;
  }
  if (componentName === undefined && redirectTo === undefined) {
    diagnostics.push(error(
      'GEN_ROUTE_UNSUPPORTED',
      `Route '${path}' declares neither a component nor a redirectTo; there is nothing for it to do`,
      undefined, undefined, FIX_SHAPE,
    ));
    return undefined;
  }
  return { path, componentName, redirectTo, pathMatch, ignoredKeys };
}

/**
 * Read the Routes array of a routes file. Emits diagnostics for
 * unsupported shapes; a file with no Routes array reports found: false
 * and no diagnostics (compile.ts decides what that means).
 */
export function parseRoutesFile(tsSource: string, fileName = 'app.routes.ts'): ParseRoutesResult {
  const diagnostics: Diagnostic[] = [];
  const sf = ts.createSourceFile(fileName, tsSource, ts.ScriptTarget.Latest, /* setParentNodes */ true);
  let array: ts.ArrayLiteralExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (array) return;
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      const name = node.name.text;
      const typeText = node.type ? node.type.getText(sf) : '';
      if (/routes$/i.test(name) || /\bRoutes\b/.test(typeText)) {
        array = arrayOf(node.initializer);
      }
    }
    if (!array) ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!array) return { routes: [], diagnostics, found: false };
  const routes: RouteDef[] = [];
  for (const element of array.elements) {
    const def = readEntry(element, diagnostics);
    if (def) routes.push(def);
  }
  return { routes, diagnostics, found: true };
}
