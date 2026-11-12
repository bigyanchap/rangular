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
  /** Full source text, e.g. `step: number = 1` — preserved in generated .tsx. */
  text: string;
}

export interface ComponentMethod {
  name: string;
  params: MethodParam[];
  /** Source text of the method body block (including braces), if it has one. */
  body?: string;
}

export interface ComponentInfo {
  className: string;
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

/**
 * Extract @Component metadata from a TypeScript source file using the
 * official TypeScript compiler API — Rangular never parses TS by hand.
 */
export function parseComponent(tsSource: string, fileName = 'component.ts'): ParseComponentResult {
  const diagnostics: Diagnostic[] = [];
  const sf = ts.createSourceFile(fileName, tsSource, ts.ScriptTarget.Latest, /* setParentNodes */ true);

  let found: ComponentInfo | undefined;

  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isClassDeclaration(node) && node.name) {
      const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
      const compDec = decorators.find((d) => decoratorName(d) === 'Component');
      if (compDec) {
        const info: ComponentInfo = {
          className: node.name.text,
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
        for (const member of node.members) {
          if (ts.isPropertyDeclaration(member) && member.name) {
            info.fields.push({
              name: member.name.getText(sf),
              initializer: member.initializer ? member.initializer.getText(sf) : undefined,
              type: member.type ? member.type.getText(sf) : undefined,
              isInput: hasDecorator(member, 'Input'),
              isOutput: hasDecorator(member, 'Output'),
            });
          } else if (ts.isMethodDeclaration(member) && member.name) {
            info.methods.push(member.name.getText(sf));
            info.methodDetails.push({
              name: member.name.getText(sf),
              params: member.parameters.map((p) => ({
                name: p.name.getText(sf),
                text: p.getText(sf),
              })),
              body: member.body ? member.body.getText(sf) : undefined,
            });
          }
        }
        found = info;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (!found) {
    diagnostics.push(error('CLS_NO_COMPONENT', 'No @Component-decorated class found in the source'));
  }
  return { component: found, diagnostics };
}
