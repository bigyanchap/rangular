/**
 * Pratt parser for template expressions: `{{ a + b * c }}`, `user.name`,
 * `save($event)`, `cond ? a : b`, `items | async`, `name | uppercase:'x'`.
 *
 * Precedence (lowest to highest): pipe | ternary ?: | || | && |
 * equality (== === != !==) | relational (< > <= >=) | additive (+ -) |
 * multiplicative (* / %) | unary (! -) | call/member | primary.
 */

export type Expr =
  | { type: 'identifier'; name: string }
  | { type: 'literal'; value: string | number | boolean | null; raw: string }
  | { type: 'member'; object: Expr; property: string }
  | { type: 'index'; object: Expr; index: Expr }
  | { type: 'call'; callee: Expr; args: Expr[] }
  | { type: 'unary'; op: string; argument: Expr }
  | { type: 'binary'; op: string; left: Expr; right: Expr }
  | { type: 'conditional'; test: Expr; consequent: Expr; alternate: Expr }
  | { type: 'pipe'; input: Expr; name: string; args: Expr[] };

interface Token {
  kind: 'ident' | 'number' | 'string' | 'punct' | 'eof';
  value: string;
}

const MULTI_OPS = ['===', '!==', '==', '!=', '<=', '>=', '&&', '||'];
const SINGLE_PUNCT = '+-*/%<>!?:.,()[]|';

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let value = '';
      while (j < input.length && input[j] !== ch) {
        if (input[j] === '\\' && j + 1 < input.length) { value += input[j + 1]; j += 2; }
        else { value += input[j]; j++; }
      }
      tokens.push({ kind: 'string', value });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < input.length && /[0-9.]/.test(input[j])) j++;
      tokens.push({ kind: 'number', value: input.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < input.length && /[A-Za-z0-9_$]/.test(input[j])) j++;
      tokens.push({ kind: 'ident', value: input.slice(i, j) });
      i = j;
      continue;
    }
    const three = input.slice(i, i + 3);
    const two = input.slice(i, i + 2);
    if (MULTI_OPS.includes(three)) { tokens.push({ kind: 'punct', value: three }); i += 3; continue; }
    if (MULTI_OPS.includes(two)) { tokens.push({ kind: 'punct', value: two }); i += 2; continue; }
    if (SINGLE_PUNCT.includes(ch)) { tokens.push({ kind: 'punct', value: ch }); i++; continue; }
    throw new Error(`Unexpected character '${ch}' in expression "${input}"`);
  }
  tokens.push({ kind: 'eof', value: '' });
  return tokens;
}

const BINDING_POWER: Record<string, number> = {
  '||': 1, '&&': 2,
  '==': 3, '===': 3, '!=': 3, '!==': 3,
  '<': 4, '>': 4, '<=': 4, '>=': 4,
  '+': 5, '-': 5,
  '*': 6, '/': 6, '%': 6,
};

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  private peek(): Token { return this.tokens[this.pos]; }
  private next(): Token { return this.tokens[this.pos++]; }
  private atPunct(v: string): boolean {
    const t = this.peek();
    return t.kind === 'punct' && t.value === v;
  }
  private expectPunct(v: string): void {
    if (!this.atPunct(v)) throw new Error(`Expected '${v}' but found '${this.peek().value || 'end of expression'}'`);
    this.next();
  }

  /** Entry point: pipe is the lowest-precedence construct. */
  parsePipe(): Expr {
    let input = this.parseConditional();
    while (this.atPunct('|')) {
      this.next();
      const nameTok = this.next();
      if (nameTok.kind !== 'ident') throw new Error(`Expected a pipe name after '|'`);
      const args: Expr[] = [];
      while (this.atPunct(':')) {
        this.next();
        args.push(this.parseConditional());
      }
      input = { type: 'pipe', input, name: nameTok.value, args };
    }
    return input;
  }

  private parseConditional(): Expr {
    const test = this.parseBinary(1);
    if (this.atPunct('?')) {
      this.next();
      const consequent = this.parsePipe();
      this.expectPunct(':');
      const alternate = this.parseConditional();
      return { type: 'conditional', test, consequent, alternate };
    }
    return test;
  }

  private parseBinary(minPower: number): Expr {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.kind !== 'punct') break;
      const power = BINDING_POWER[t.value];
      if (power === undefined || power < minPower) break;
      const op = this.next().value;
      const right = this.parseBinary(power + 1); // left-associative
      left = { type: 'binary', op, left, right };
    }
    return left;
  }

  private parseUnary(): Expr {
    const t = this.peek();
    if (t.kind === 'punct' && (t.value === '!' || t.value === '-')) {
      const op = this.next().value;
      return { type: 'unary', op, argument: this.parseUnary() };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();
    for (;;) {
      if (this.atPunct('.')) {
        this.next();
        const prop = this.next();
        if (prop.kind !== 'ident') throw new Error(`Expected a property name after '.'`);
        expr = { type: 'member', object: expr, property: prop.value };
      } else if (this.atPunct('[')) {
        this.next();
        const index = this.parsePipe();
        this.expectPunct(']');
        expr = { type: 'index', object: expr, index };
      } else if (this.atPunct('(')) {
        this.next();
        const args: Expr[] = [];
        if (!this.atPunct(')')) {
          args.push(this.parsePipe());
          while (this.atPunct(',')) { this.next(); args.push(this.parsePipe()); }
        }
        this.expectPunct(')');
        expr = { type: 'call', callee: expr, args };
      } else break;
    }
    return expr;
  }

  private parsePrimary(): Expr {
    const t = this.next();
    if (t.kind === 'ident') {
      if (t.value === 'true') return { type: 'literal', value: true, raw: 'true' };
      if (t.value === 'false') return { type: 'literal', value: false, raw: 'false' };
      if (t.value === 'null') return { type: 'literal', value: null, raw: 'null' };
      return { type: 'identifier', name: t.value };
    }
    if (t.kind === 'number') return { type: 'literal', value: Number(t.value), raw: t.value };
    if (t.kind === 'string') return { type: 'literal', value: t.value, raw: `'${t.value}'` };
    if (t.kind === 'punct' && t.value === '(') {
      const inner = this.parsePipe();
      this.expectPunct(')');
      return inner;
    }
    throw new Error(`Unexpected token '${t.value || 'end of expression'}'`);
  }

  expectEnd(): void {
    if (this.peek().kind !== 'eof') throw new Error(`Unexpected trailing token '${this.peek().value}'`);
  }
}

export function parseExpression(source: string): Expr {
  const parser = new Parser(tokenize(source.trim()));
  const expr = parser.parsePipe();
  parser.expectEnd();
  return expr;
}

/** Canonical, fully-parenthesised string form, used by tests and codegen. */
export function exprToString(expr: Expr): string {
  switch (expr.type) {
    case 'identifier': return expr.name;
    case 'literal': return expr.raw;
    case 'member': return `${exprToString(expr.object)}.${expr.property}`;
    case 'index': return `${exprToString(expr.object)}[${exprToString(expr.index)}]`;
    case 'call': return `${exprToString(expr.callee)}(${expr.args.map(exprToString).join(', ')})`;
    case 'unary': return `${expr.op}${exprToString(expr.argument)}`;
    case 'binary': return `(${exprToString(expr.left)} ${expr.op} ${exprToString(expr.right)})`;
    case 'conditional':
      return `(${exprToString(expr.test)} ? ${exprToString(expr.consequent)} : ${exprToString(expr.alternate)})`;
    case 'pipe': {
      const args = expr.args.length ? `:${expr.args.map(exprToString).join(':')}` : '';
      return `(${exprToString(expr.input)} | ${expr.name}${args})`;
    }
  }
}

/**
 * Translate a template expression into generated-code source.
 * Pipes have no RN equivalent yet: they are emitted as a call to a runtime
 * `pipe(name, value, ...args)` helper so the shape stays explicit.
 */
export function exprToCode(source: string): string {
  try {
    const expr = parseExpression(source);
    return codeOf(expr);
  } catch {
    return source.trim(); // fall back to the raw text; diagnostics are raised elsewhere
  }
}

function codeOf(expr: Expr): string {
  if (expr.type === 'pipe') {
    const args = expr.args.map(codeOf).join(', ');
    return `pipe('${expr.name}', ${codeOf(expr.input)}${args ? `, ${args}` : ''})`;
  }
  if (expr.type === 'binary') return `(${codeOf(expr.left)} ${expr.op} ${codeOf(expr.right)})`;
  if (expr.type === 'conditional') return `(${codeOf(expr.test)} ? ${codeOf(expr.consequent)} : ${codeOf(expr.alternate)})`;
  return exprToString(expr);
}
