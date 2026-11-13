import * as ts from 'typescript';
import { Diagnostic, error } from '../diagnostics';

export interface ComponentField {
  name: string;
  /** Source text of the initializer, if any (e.g. `'Welcome'`, `0`, `false`). */
  initializer?: string;
  /** Source text of the declared type, if any. */
  type?: string;
  isInput: boolean;
  isOutput: boolean;
}

export interface MethodParam {
  /** Bare parameter name, e.g. `step` or `$event`. */
  name: string;
  /** Full source text, e.g. `step: number = 1`, preserved in generated .tsx. */
  text: string;
}

export interface ComponentMethod {
  name: string;
  params: MethodParam[];
  /** Source text of the method body block (including braces), if it has one. */
  body?: string;
}

/** One constructor parameter property: `private mail: MailService`. */
export interface ConstructorDep {
  /** The property the dependency is stored on, e.g. `mail`. */
  propertyName: string;
  /** The declared type name used as the DI token, e.g. `MailService`. */
  typeName: string;
}

export interface ComponentInfo {
  className: string;
  /** 1-based line of the class declaration in its source file (Stage 5, source maps). */
  sourceLine?: number;
  selector?: string;
  template?: string;
  templateUrl?: string;
  styleUrls: string[];
  /** Inline styles, joined when several strings are given. */
  styles?: string;
  fields: ComponentField[];
  methods: string[];
  /** Method signatures + body source, for method translation (Stage 2). */
  methodDetails: ComponentMethod[];
  /** Constructor parameter properties (Stage 3 DI). Empty when no constructor. */
  constructorDeps?: ConstructorDep[];
  /** Source text of the constructor body block, when one exists. */
  constructorBody?: string;
}

/** An @Injectable class (Stage 3, M6), same member shape as a component. */
export interface ServiceInfo {
  className: string;
  /** True only for @Injectable({ providedIn: 'root' }), the injectable kind. */
  providedInRoot: boolean;
  fields: ComponentField[];
  methods: string[];
  methodDetails: ComponentMethod[];
  constructorDeps: ConstructorDep[];
  constructorBody?: string;
  /** Key of the file this class was read from (the compile.ts registry key). */
  fileName: string;
}

/**
 * A custom @Pipe class (Stage 12). The compiler registers it by its
 * pipe `name`, emits the class into the generated file and rewrites
 * `value | name:args` into a call on one shared instance's transform.
 */
export interface PipeInfo {
  /** The pipe name from @Pipe({ name: '...' }), used after the | in templates. */
  pipeName: string;
  className: string;
  fields: ComponentField[];
  methods: string[];
  methodDetails: ComponentMethod[];
  constructorDeps: ConstructorDep[];
  constructorBody?: string;
  /** Bare parameter names of transform(value, ...args), in order. */
  transformParams: string[];
  /**
   * When transform's body is exactly one return statement, the source
   * text of the returned expression. The preview's static paint can
   * evaluate that shape with its safe expression evaluator (no eval);
   * richer bodies run only in the interactive preview and the app.
   */
  transformReturn?: string;
  /** Key of the file this class was read from (the compile.ts registry key). */
  fileName: string;
}

/** One @Input field of a directive class. */
export interface DirectiveInput {
  name: string;
  /** Source text of the initializer, when one is written (the default). */
  initializer?: string;
}

/**
 * An attribute @Directive class (Stage 12), the supported subset: a
 * bracket selector, @Input fields, an ElementRef constructor
 * dependency, and styling logic in ngOnInit or in a setter for one
 * input. parseDirective.ts extracts the style assignments.
 */
export interface DirectiveInfo {
  className: string;
  /** The selector as written, e.g. '[appHighlight]'. */
  selector?: string;
  /** The attribute name inside the brackets, when the selector has that shape. */
  attrName?: string;
  inputs: DirectiveInput[];
  /** The constructor property typed ElementRef, when one is injected. */
  elProp?: string;
  /** Source text of the ngOnInit body block, when present. */
  initBody?: string;
  /** A set accessor: its property, its parameter name, its body block. */
  setter?: { prop: string; paramName: string; body: string };
  /** Key of the file this class was read from (the compile.ts registry key). */
  fileName: string;
}

/** One binding an import declaration introduces in the importing file. */
export interface ImportBinding {
  /** Local name bound in the importing file, e.g. 'fmt'. */
  local: string;
  /**
   * The exported name in the source module: 'default' for a default
   * import, '*' for a namespace import, or the named export as written
   * before any `as`.
   */
  imported: string;
  /** Type-only binding (an `import type` clause or an inline `type` modifier). */
  typeOnly: boolean;
}

export interface ImportInfo {
  /** Named imports by local name, e.g. ['Component', 'Input']. */
  names: string[];
  /** Module specifier as written, e.g. './mail.service' or '@angular/core'. */
  from: string;
  /**
   * Every binding the declaration introduces (default, named,
   * namespace). Empty for a side-effect import (`import 'x';`).
   */
  bindings: ImportBinding[];
  /** 1-based line of the declaration in its file. */
  line: number;
}

/**
 * An `import A = require('x')` or `import A = B.C` declaration
 * (Stage: third-party imports). Recorded so the pipeline can diagnose
 * it: the form cannot be carried into the generated module.
 */
export interface ImportEqualsInfo {
  /** The local name the declaration binds, e.g. 'AS'. */
  local: string;
  /** 1-based line of the declaration in its file. */
  line: number;
}

/**
 * A third-party import binding compile.ts hands to codegen for
 * carrying into the generated module (merged across contributing
 * files: the same binding declared twice is carried once).
 */
export interface CarriedImportBinding extends ImportBinding {
  /** Module specifier as written in the source, carried verbatim. */
  from: string;
  /** The contributing source file that declared the binding. */
  file: string;
}

/** Everything one TypeScript file contributes to a compilation. */
export interface ClassFileInfo {
  components: ComponentInfo[];
  services: ServiceInfo[];
  /** Custom @Pipe classes (Stage 12). */
  pipes: PipeInfo[];
  /** Attribute @Directive classes (Stage 12). */
  directives: DirectiveInfo[];
  imports: ImportInfo[];
  /** `import A = require(...)` / `import A = B.C` declarations. */
  importEquals: ImportEqualsInfo[];
}

export interface ParseComponentResult {
  component?: ComponentInfo;
  diagnostics: Diagnostic[];
}

function decoratorName(decorator: ts.Decorator): string | undefined {
  const expr = decorator.expression;
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) return expr.expression.text;
  if (ts.isIdentifier(expr)) return expr.text;
  return undefined;
}

function decoratorArgs(decorator: ts.Decorator): ts.Expression[] {
  const expr = decorator.expression;
  return ts.isCallExpression(expr) ? [...expr.arguments] : [];
}

function hasDecorator(node: ts.ClassElement, name: string): boolean {
  if (!ts.canHaveDecorators(node)) return false;
  return (ts.getDecorators(node) ?? []).some((d) => decoratorName(d) === name);
}

function stringOf(node: ts.Expression | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

function stringArrayOf(node: ts.Expression | undefined): string[] {
  if (!node || !ts.isArrayLiteralExpression(node)) return [];
  return node.elements.map((el) => stringOf(el)).filter((s): s is string => s !== undefined);
}

/** Fields + methods of a class, shared by component and service reading. */
function readMembers(
  node: ts.ClassDeclaration,
  sf: ts.SourceFile,
): { fields: ComponentField[]; methods: string[]; methodDetails: ComponentMethod[] } {
  const fields: ComponentField[] = [];
  const methods: string[] = [];
  const methodDetails: ComponentMethod[] = [];
  for (const member of node.members) {
    if (ts.isPropertyDeclaration(member) && member.name) {
      fields.push({
        name: member.name.getText(sf),
        initializer: member.initializer ? member.initializer.getText(sf) : undefined,
        type: member.type ? member.type.getText(sf) : undefined,
        isInput: hasDecorator(member, 'Input'),
        isOutput: hasDecorator(member, 'Output'),
      });
    } else if (ts.isMethodDeclaration(member) && member.name) {
      methods.push(member.name.getText(sf));
      methodDetails.push({
        name: member.name.getText(sf),
        params: member.parameters.map((p) => ({
          name: p.name.getText(sf),
          text: p.getText(sf),
        })),
        body: member.body ? member.body.getText(sf) : undefined,
      });
    }
  }
  return { fields, methods, methodDetails };
}

/**
 * Constructor parameter properties (Stage 3 DI): a parameter counts as an
 * injected dependency only when it carries an accessibility/readonly
 * modifier, exactly Angular's rule. Plain parameters are not properties
 * and are ignored.
 */
function readConstructor(
  node: ts.ClassDeclaration,
  sf: ts.SourceFile,
): { deps: ConstructorDep[]; body?: string } {
  const deps: ConstructorDep[] = [];
  let body: string | undefined;
  for (const member of node.members) {
    if (!ts.isConstructorDeclaration(member)) continue;
    body = member.body ? member.body.getText(sf) : undefined;
    for (const param of member.parameters) {
      const modifiers = ts.getModifiers(param) ?? [];
      const isParamProperty = modifiers.some((m) =>
        m.kind === ts.SyntaxKind.PrivateKeyword ||
        m.kind === ts.SyntaxKind.PublicKeyword ||
        m.kind === ts.SyntaxKind.ProtectedKeyword ||
        m.kind === ts.SyntaxKind.ReadonlyKeyword);
      if (!isParamProperty || !param.type || !ts.isIdentifier(param.name)) continue;
      deps.push({ propertyName: param.name.text, typeName: param.type.getText(sf).trim() });
    }
  }
  return { deps, body };
}

function classDecorators(node: ts.ClassDeclaration): readonly ts.Decorator[] {
  return ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
}

function readComponentClass(node: ts.ClassDeclaration, sf: ts.SourceFile): ComponentInfo | undefined {
  const compDec = classDecorators(node).find((d) => decoratorName(d) === 'Component');
  if (!compDec || !node.name) return undefined;
  const info: ComponentInfo = {
    className: node.name.text,
    sourceLine: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
    styleUrls: [],
    fields: [],
    methods: [],
    methodDetails: [],
  };
  const arg = decoratorArgs(compDec)[0];
  if (arg && ts.isObjectLiteralExpression(arg)) {
    for (const prop of arg.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const key = prop.name.getText(sf).replace(/['"]/g, '');
      if (key === 'selector') info.selector = stringOf(prop.initializer);
      else if (key === 'template') info.template = stringOf(prop.initializer);
      else if (key === 'templateUrl') info.templateUrl = stringOf(prop.initializer);
      else if (key === 'styleUrls') info.styleUrls = stringArrayOf(prop.initializer);
      else if (key === 'styles') info.styles = stringArrayOf(prop.initializer).join('\n');
    }
  }
  const members = readMembers(node, sf);
  info.fields = members.fields;
  info.methods = members.methods;
  info.methodDetails = members.methodDetails;
  const ctor = readConstructor(node, sf);
  info.constructorDeps = ctor.deps;
  info.constructorBody = ctor.body;
  return info;
}

function readServiceClass(node: ts.ClassDeclaration, sf: ts.SourceFile, fileName: string): ServiceInfo | undefined {
  const dec = classDecorators(node).find((d) => decoratorName(d) === 'Injectable');
  if (!dec || !node.name) return undefined;
  let providedInRoot = false;
  const arg = decoratorArgs(dec)[0];
  if (arg && ts.isObjectLiteralExpression(arg)) {
    for (const prop of arg.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const key = prop.name.getText(sf).replace(/['"]/g, '');
      if (key === 'providedIn') providedInRoot = stringOf(prop.initializer) === 'root';
    }
  }
  const members = readMembers(node, sf);
  const ctor = readConstructor(node, sf);
  return {
    className: node.name.text,
    providedInRoot,
    fields: members.fields,
    methods: members.methods,
    methodDetails: members.methodDetails,
    constructorDeps: ctor.deps,
    constructorBody: ctor.body,
    fileName,
  };
}

function readPipeClass(node: ts.ClassDeclaration, sf: ts.SourceFile, fileName: string): PipeInfo | undefined {
  const dec = classDecorators(node).find((d) => decoratorName(d) === 'Pipe');
  if (!dec || !node.name) return undefined;
  let pipeName: string | undefined;
  const arg = decoratorArgs(dec)[0];
  if (arg && ts.isObjectLiteralExpression(arg)) {
    for (const prop of arg.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const key = prop.name.getText(sf).replace(/['"]/g, '');
      if (key === 'name') pipeName = stringOf(prop.initializer);
    }
  }
  if (!pipeName) return undefined;
  const members = readMembers(node, sf);
  const ctor = readConstructor(node, sf);
  let transformParams: string[] = [];
  let transformReturn: string | undefined;
  for (const member of node.members) {
    if (!ts.isMethodDeclaration(member) || !member.name || member.name.getText(sf) !== 'transform') continue;
    transformParams = member.parameters.map((p) => p.name.getText(sf));
    if (member.body && member.body.statements.length === 1) {
      const only = member.body.statements[0];
      if (ts.isReturnStatement(only) && only.expression) {
        transformReturn = only.expression.getText(sf);
      }
    }
  }
  return {
    pipeName,
    className: node.name.text,
    fields: members.fields,
    methods: members.methods,
    methodDetails: members.methodDetails,
    constructorDeps: ctor.deps,
    constructorBody: ctor.body,
    transformParams,
    transformReturn,
    fileName,
  };
}

function readDirectiveClass(node: ts.ClassDeclaration, sf: ts.SourceFile, fileName: string): DirectiveInfo | undefined {
  const dec = classDecorators(node).find((d) => decoratorName(d) === 'Directive');
  if (!dec || !node.name) return undefined;
  let selector: string | undefined;
  const arg = decoratorArgs(dec)[0];
  if (arg && ts.isObjectLiteralExpression(arg)) {
    for (const prop of arg.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const key = prop.name.getText(sf).replace(/['"]/g, '');
      if (key === 'selector') selector = stringOf(prop.initializer);
    }
  }
  const info: DirectiveInfo = {
    className: node.name.text,
    selector,
    inputs: [],
    fileName,
  };
  const bracket = selector ? /^\[\s*([A-Za-z][\w-]*)\s*\]$/.exec(selector.trim()) : null;
  if (bracket) info.attrName = bracket[1];
  const ctor = readConstructor(node, sf);
  const elDep = ctor.deps.find((d) => d.typeName === 'ElementRef');
  if (elDep) info.elProp = elDep.propertyName;
  for (const member of node.members) {
    if (ts.isPropertyDeclaration(member) && member.name && hasDecorator(member, 'Input')) {
      info.inputs.push({
        name: member.name.getText(sf),
        initializer: member.initializer ? member.initializer.getText(sf) : undefined,
      });
    } else if (ts.isMethodDeclaration(member) && member.name
      && member.name.getText(sf) === 'ngOnInit' && member.body) {
      info.initBody = member.body.getText(sf);
    } else if (ts.isSetAccessorDeclaration(member) && member.name && member.body
      && member.parameters.length === 1) {
      info.setter = {
        prop: member.name.getText(sf),
        paramName: member.parameters[0].name.getText(sf),
        body: member.body.getText(sf),
      };
      // An @Input() setter is also an input: the host binds it by the
      // accessor's name, and the setter parameter stands for its value.
      if (hasDecorator(member, 'Input')
        && !info.inputs.some((i) => i.name === info.setter!.prop)) {
        info.inputs.push({ name: info.setter.prop });
      }
    }
  }
  return info;
}

/**
 * Read a whole TypeScript file: every @Component class, every @Injectable
 * class and every import statement. Stage 3's registry (compile.ts) follows
 * relative imports across files using this per-file view. Emits no
 * diagnostics of its own, a file of only services is a valid file.
 */
export function parseClassFile(tsSource: string, fileName = 'component.ts'): ClassFileInfo {
  const sf = ts.createSourceFile(fileName, tsSource, ts.ScriptTarget.Latest, /* setParentNodes */ true);
  const result: ClassFileInfo = { components: [], services: [], pipes: [], directives: [], imports: [], importEquals: [] };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const names: string[] = [];
      const bindings: ImportBinding[] = [];
      const clause = node.importClause;
      if (clause) {
        if (clause.name) {
          bindings.push({ local: clause.name.text, imported: 'default', typeOnly: clause.isTypeOnly });
        }
        const named = clause.namedBindings;
        if (named && ts.isNamedImports(named)) {
          for (const el of named.elements) {
            names.push(el.name.text);
            bindings.push({
              local: el.name.text,
              imported: el.propertyName ? el.propertyName.text : el.name.text,
              typeOnly: clause.isTypeOnly || el.isTypeOnly,
            });
          }
        } else if (named && ts.isNamespaceImport(named)) {
          bindings.push({ local: named.name.text, imported: '*', typeOnly: clause.isTypeOnly });
        }
      }
      result.imports.push({
        names,
        from: node.moduleSpecifier.text,
        bindings,
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      });
      return;
    }
    if (ts.isImportEqualsDeclaration(node)) {
      result.importEquals.push({
        local: node.name.text,
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      });
      return;
    }
    if (ts.isClassDeclaration(node) && node.name) {
      const comp = readComponentClass(node, sf);
      if (comp) result.components.push(comp);
      const svc = readServiceClass(node, sf, fileName);
      if (svc) result.services.push(svc);
      const pipe = readPipeClass(node, sf, fileName);
      if (pipe) result.pipes.push(pipe);
      const directive = readDirectiveClass(node, sf, fileName);
      if (directive) result.directives.push(directive);
      return; // classes are not nested further for our purposes
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return result;
}

/**
 * Extract @Component metadata from a TypeScript source file using the
 * official TypeScript compiler API, Rangular never parses TS by hand.
 */
export function parseComponent(tsSource: string, fileName = 'component.ts'): ParseComponentResult {
  const diagnostics: Diagnostic[] = [];
  const { components } = parseClassFile(tsSource, fileName);
  const found = components[0];
  if (!found) {
    diagnostics.push(error('CLS_NO_COMPONENT', 'No @Component-decorated class found in the source', undefined, undefined, "Decorate the class: @Component({ selector: 'app-x', templateUrl: './x.component.html' }) export class XComponent { ... }, only @Component classes are compiled; @NgModule/@Injectable classes are not entry points"));
  }
  return { component: found, diagnostics };
}
