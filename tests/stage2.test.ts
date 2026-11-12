import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { compileComponent, hasErrors } from '../packages/compiler/src/compile';
import { renderPreview } from '../packages/compiler/src/preview/renderPreview';

const ROOT = path.join(__dirname, '..', '..');
const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

function compileExample(name: string) {
  const dir = path.join(ROOT, 'examples', name);
  const tsSource = fs.readFileSync(path.join(dir, `${name}.component.ts`), 'utf8');
  const result = compileComponent({
    tsSource,
    fileName: `${name}.component.ts`,
    resolveFile: (rel) => fs.readFileSync(path.join(dir, rel), 'utf8'),
  });
  return { dir, result };
}

function compileSnippet(template: string, classBody = '') {
  const tsSource = `
    @Component({ selector: 'app-t', template: ${JSON.stringify(template)} })
    export class TComponent { ${classBody} }
  `;
  return compileComponent({ tsSource });
}

// --- Event codegen (M3) -----------------------------------------------------

test('(click) with a call emits an onPress arrow', () => {
  const { code } = compileSnippet('<button (click)="increment()">+</button>', 'increment() {}');
  assert.match(code, /onPress=\{\(\) => increment\(\)\}/);
});

test('(click) with a bare method reference emits onPress={fn}', () => {
  const { code } = compileSnippet('<button (click)="increment">+</button>', 'increment() {}');
  assert.match(code, /onPress=\{increment\}/);
});

test('(click) handlers pass $event through', () => {
  const { code } = compileSnippet('<button (click)="save($event)">Save</button>', 'save(e: any) {}');
  assert.match(code, /onPress=\{\(\) => save\(\$event\)\}/);
});

test('(click) on a row emits onPress too', () => {
  const { code } = compileSnippet('<row (click)="open()" title="x"></row>', 'open() {}');
  assert.match(code, /<RgRow[^>]*onPress=\{\(\) => open\(\)\}/);
});

// --- Structural codegen (M4) -------------------------------------------------

test('*ngIf wraps the element in a conditional', () => {
  const { code } = compileSnippet('<p *ngIf="count >= 5">Past five</p>', 'count = 0;');
  assert.match(code, /\{\(count >= 5\) && \(/);
  assert.match(code, /<Text variant="body">Past five<\/Text>/);
});

test('*ngIf with else microsyntax degrades to a TODO warning, not broken code', () => {
  const result = compileSnippet('<p *ngIf="ready; else alt">x</p>', 'ready = true;');
  assert.ok(result.diagnostics.some((d) => d.code === 'GEN_NGIF_ELSE_TODO'));
  assert.equal(hasErrors(result.diagnostics), false);
  assert.match(result.code, /<Text variant="body">x<\/Text>/);
});

test('*ngFor emits a keyed map with loop-variable bindings intact', () => {
  const { code, diagnostics } = compileSnippet(
    '<list><row *ngFor="let m of mails; let i = index" [title]="m.from" [time]="m.time"></row></list>',
    'mails = [];',
  );
  assert.equal(hasErrors(diagnostics), false, JSON.stringify(diagnostics));
  assert.match(code, /\{mails\.map\(\(m, i\) => \(/);
  assert.match(code, /key=\{m\?\.id \?\? i\}/);
  assert.match(code, /title=\{m\.from\}/);
  assert.match(code, /time=\{m\.time\}/);
});

test('*ngFor with trackBy uses the trackBy function for the key', () => {
  const { code } = compileSnippet(
    '<div *ngFor="let m of mails; trackBy: byId">{{ m.from }}</div>',
    'mails = []; byId(m: any) { return m.id; }',
  );
  assert.match(code, /key=\{byId\(m\)\}/);
});

// --- Examples -----------------------------------------------------------------

test('counter example compiles with zero errors and matches its golden .tsx', () => {
  const { dir, result } = compileExample('counter');
  assert.equal(hasErrors(result.diagnostics), false, JSON.stringify(result.diagnostics));
  const golden = fs.readFileSync(path.join(dir, 'counter.component.tsx'), 'utf8');
  assert.equal(normalize(result.code), normalize(golden));
  assert.match(result.code, /const \[count, setCount\] = useState\(0\);/);
});

test('inbox example compiles with zero errors and matches its golden .tsx', () => {
  const { dir, result } = compileExample('inbox');
  assert.equal(hasErrors(result.diagnostics), false, JSON.stringify(result.diagnostics));
  const golden = fs.readFileSync(path.join(dir, 'inbox.component.tsx'), 'utf8');
  assert.equal(normalize(result.code), normalize(golden));
  assert.match(result.code, /mails\.map\(\(m, i\) => \(/);
});

// --- Interactive preview --------------------------------------------------------

test('counter preview embeds live state, translated methods and the runtime', () => {
  const { result } = compileExample('counter');
  const html = renderPreview(result.component!, result.ast!);
  assert.match(html, /const state = \{"count":0\};/);
  assert.match(html, /increment: function \(\)/);
  assert.match(html, /state\.count\+\+/);
  assert.match(html, /function __render\(\)/);
  // Server-rendered initial paint: count 0 shown, ngIf paragraph hidden.
  assert.match(html, /<h1 class="display">0<\/h1>/);
  assert.doesNotMatch(html.split('<script>')[0], /Past five/);
});

test('inbox preview serializes the mails and server-renders all four rows', () => {
  const { result } = compileExample('inbox');
  const html = renderPreview(result.component!, result.ast!);
  assert.match(html, /"from":"Sarju"/);
  assert.match(html, /"from":"Awaken Me"/);
  const initial = html.split('<script>')[0];
  for (const name of ['Sarju', 'Google', 'Medium', 'Awaken Me']) {
    assert.match(initial, new RegExp(`row-title">${name}`), `row for ${name}`);
  }
  assert.doesNotMatch(initial, /No mail\. Enjoy the quiet\./);
});
