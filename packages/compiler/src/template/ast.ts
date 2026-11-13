/** AST types for Rangular templates. */

export interface SourcePos {
  line: number;
  column: number;
}

export interface PropBinding {
  name: string;
  expression: string;
}

export interface EventBinding {
  name: string;
  expression: string;
}

export interface StructuralDirective {
  /** e.g. 'ngIf' or 'ngFor' (without the leading '*'). */
  name: string;
  expression: string;
}

export interface ElementNode {
  type: 'element';
  tag: string;
  /** Static attributes, e.g. class="card" title="Hi". Insertion order preserved. */
  attrs: Record<string, string>;
  /** Attributes present without a value, e.g. `avatar`. */
  booleanAttrs: string[];
  propBindings: PropBinding[];
  /** Two-way bindings from `[(name)]="expr"` (Stage 8); kept apart from
   *  propBindings because a two-way binding also writes back. */
  twoWayBindings: PropBinding[];
  eventBindings: EventBinding[];
  structural?: StructuralDirective;
  /**
   * Structural directives the parser dropped because the element
   * already carried one (one structural directive per element): the
   * parser warns TPL_STRUCTURAL_MULTIPLE for each, and codegen emits
   * a TODO comment naming each dropped directive.
   */
  droppedStructural?: StructuralDirective[];
  /** Template reference variable name from `#ref`, without '#'. */
  ref?: string;
  /** The exportAs value of a template reference, e.g. `#email="ngModel"` (Stage 8). */
  refExport?: string;
  children: TemplateNode[];
  pos: SourcePos;
}

export type TextPart =
  | { type: 'static'; value: string }
  | { type: 'expr'; expression: string };

export interface TextNode {
  type: 'text';
  parts: TextPart[];
  pos: SourcePos;
}

export type TemplateNode = ElementNode | TextNode;

export interface TemplateRoot {
  type: 'root';
  children: TemplateNode[];
}

export function isElement(node: TemplateNode): node is ElementNode {
  return node.type === 'element';
}

export function isText(node: TemplateNode): node is TextNode {
  return node.type === 'text';
}

/** The full text of a TextNode if it is purely static, else undefined. */
export function staticText(node: TextNode): string | undefined {
  if (node.parts.every((p) => p.type === 'static')) {
    return node.parts.map((p) => (p as { value: string }).value).join('');
  }
  return undefined;
}
