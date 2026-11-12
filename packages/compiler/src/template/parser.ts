import { Diagnostic, error } from '../diagnostics';
import { ElementNode, SourcePos, TemplateNode, TemplateRoot, TextNode, TextPart } from './ast';

export interface ParseResult {
  root: TemplateRoot;
  diagnostics: Diagnostic[];
}

const VOID_TAGS = new Set(['img', 'br', 'hr', 'input', 'meta', 'link']);

/**
 * Recursive-descent parser for Rangular templates.
 * Handles nested + self-closing elements, static attributes, [prop] bindings,
 * (event) bindings, *structural directives, #ref variables, comments
 * (dropped) and {{ interpolation }} inside text. Malformed markup yields
 * diagnostics with line/column, the parser recovers instead of throwing.
 */
export function parseTemplate(source: string): ParseResult {
  const diagnostics: Diagnostic[] = [];
  let i = 0;
  let line = 1;
  let column = 1;

  const pos = (): SourcePos => ({ line, column });
  const eof = () => i >= source.length;
  const startsWith = (s: string) => source.startsWith(s, i);

  function advance(n: number): string {
    const taken = source.slice(i, i + n);
    for (const ch of taken) {
      if (ch === '\n') { line++; column = 1; } else column++;
    }
    i += n;
    return taken;
  }

  function skipWhitespace(): void {
    while (!eof() && /\s/.test(source[i])) advance(1);
  }

  function readWhile(pred: (ch: string) => boolean): string {
    let out = '';
    while (!eof() && pred(source[i])) out += advance(1);
    return out;
  }

  function splitInterpolation(text: string, at: SourcePos): TextPart[] {
    const parts: TextPart[] = [];
    let rest = text;
    for (;;) {
      const open = rest.indexOf('{{');
      if (open === -1) break;
      const close = rest.indexOf('}}', open + 2);
      if (close === -1) {
        diagnostics.push(error('TPL_INTERPOLATION', 'Unclosed {{ interpolation }}', at.line, at.column, 'Close the interpolation with }}, e.g. {{ title }}'));
        break;
      }
      if (open > 0) parts.push({ type: 'static', value: rest.slice(0, open) });
      parts.push({ type: 'expr', expression: rest.slice(open + 2, close).trim() });
      rest = rest.slice(close + 2);
    }
    if (rest) parts.push({ type: 'static', value: rest });
    return parts;
  }

  function parseText(): TextNode | undefined {
    const at = pos();
    let raw = '';
    while (!eof() && source[i] !== '<') raw += advance(1);
    // Pure layout whitespace between elements is not content.
    if (raw.trim() === '') return undefined;
    const leadingWs = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    void leadingWs;
    return { type: 'text', parts: splitInterpolation(trimmed, at), pos: at };
  }

  function skipComment(): void {
    const end = source.indexOf('-->', i + 4);
    if (end === -1) { advance(source.length - i); return; }
    advance(end + 3 - i);
  }

  function parseElement(): ElementNode | undefined {
    const at = pos();
    advance(1); // '<'
    const tag = readWhile((c) => /[A-Za-z0-9_-]/.test(c));
    if (!tag) {
      diagnostics.push(error('TPL_TAG', 'Expected a tag name after <', at.line, at.column, 'Write a real element, e.g. <p>text</p>; a literal < in text is not supported'));
      return undefined;
    }
    const el: ElementNode = {
      type: 'element', tag, attrs: {}, booleanAttrs: [],
      propBindings: [], twoWayBindings: [], eventBindings: [], children: [], pos: at,
    };

    let selfClosing = false;
    for (;;) {
      skipWhitespace();
      if (eof()) {
        diagnostics.push(error('TPL_UNCLOSED', `Element <${tag}> is never closed`, at.line, at.column, `Close the element with </${tag}> or make it self-closing: <${tag} />`));
        return el;
      }
      if (startsWith('/>')) { advance(2); selfClosing = true; break; }
      if (source[i] === '>') { advance(1); break; }
      parseAttribute(el);
    }
    if (selfClosing || VOID_TAGS.has(tag)) return el;

    el.children = parseNodes(tag, at);
    return el;
  }

  function parseAttribute(el: ElementNode): void {
    const at = pos();
    // Attribute names may start with *, [, ( or # and contain word chars, -, ., [ ] ( ).
    const name = readWhile((c) => /[A-Za-z0-9_\-\.\*\[\]\(\)#]/.test(c));
    if (!name) {
      diagnostics.push(error('TPL_ATTR', 'Could not parse an attribute', at.line, at.column, 'Write attributes as name="value", [prop]="expr", (event)="handler()" or *ngIf="cond"'));
      advance(1);
      return;
    }
    skipWhitespace();
    let value: string | undefined;
    if (!eof() && source[i] === '=') {
      advance(1);
      skipWhitespace();
      const quote = source[i];
      if (quote === '"' || quote === "'") {
        advance(1);
        let v = '';
        while (!eof() && source[i] !== quote) v += advance(1);
        if (!eof()) advance(1); // closing quote
        value = v;
      } else {
        value = readWhile((c) => !/[\s>]/.test(c));
      }
    }

    if (name.startsWith('*')) {
      el.structural = { name: name.slice(1), expression: value ?? '' };
    } else if (name.startsWith('[(') && name.endsWith(')]')) {
      // Two-way binding [(name)]="expr" (Stage 8): its own list, because
      // codegen must write back, not just bind one way.
      el.twoWayBindings.push({ name: name.slice(2, -2), expression: value ?? '' });
    } else if (name.startsWith('[') && name.endsWith(']')) {
      el.propBindings.push({ name: name.slice(1, -1), expression: value ?? '' });
    } else if (name.startsWith('(') && name.endsWith(')')) {
      el.eventBindings.push({ name: name.slice(1, -1), expression: value ?? '' });
    } else if (name.startsWith('#')) {
      el.ref = name.slice(1);
      // #email="ngModel": the value names what the reference exports.
      if (value !== undefined) el.refExport = value;
    } else if (value === undefined) {
      el.booleanAttrs.push(name);
    } else {
      el.attrs[name] = value;
    }
  }

  function parseNodes(untilTag: string | undefined, openPos: SourcePos): TemplateNode[] {
    const nodes: TemplateNode[] = [];
    while (!eof()) {
      if (startsWith('<!--')) { skipComment(); continue; }
      if (startsWith('</')) {
        const at = pos();
        advance(2);
        const closing = readWhile((c) => /[A-Za-z0-9_-]/.test(c));
        skipWhitespace();
        if (!eof() && source[i] === '>') advance(1);
        if (untilTag === undefined) {
          diagnostics.push(error('TPL_CLOSE', `Unexpected closing tag </${closing}>`, at.line, at.column, `Remove the stray </${closing}> or add its opening <${closing}> before it`));
          return nodes;
        }
        if (closing !== untilTag) {
          diagnostics.push(error(
            'TPL_MISMATCH',
            `Expected </${untilTag}> but found </${closing}>`,
            at.line, at.column,
            VOID_TAGS.has(closing.toLowerCase())
              ? `<${closing}> is a void element and takes no closing tag; remove the </${closing}>`
              : `Close <${untilTag}> with </${untilTag}>, check for a missing or mis-nested closing tag above`,
          ));
        }
        return nodes;
      }
      if (source[i] === '<') {
        const el = parseElement();
        if (el) nodes.push(el);
        continue;
      }
      const text = parseText();
      if (text) nodes.push(text);
    }
    if (untilTag !== undefined) {
      diagnostics.push(error('TPL_UNCLOSED', `Element <${untilTag}> is never closed`, openPos.line, openPos.column, `Add the missing closing tag </${untilTag}>`));
    }
    return nodes;
  }

  const children = parseNodes(undefined, { line: 1, column: 1 });
  return { root: { type: 'root', children }, diagnostics };
}
