import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { compileComponent } from '../packages/compiler/src/compile';

const ROOT = path.join(__dirname, '..', '..');

function compileSnippet(template: string, extraClass = ''): string {
  const tsSource = `
    @Component({ selector: 'app-t', template: ${JSON.stringify(template)} })
    export class TComponent { ${extraClass} }
  `;
  const result = compileComponent({ tsSource });
  assert.equal(result.diagnostics.filter((d) => d.severity === 'error').length, 0, JSON.stringify(result.diagnostics));
  return result.code;
}

test('div maps to View and text stays text', () => {
  const code = compileSnippet('<div>Hello</div>');
  assert.match(code, /import \{ View \} from 'react-native';/);
  assert.match(code, /<View>Hello<\/View>/);
});

test('div wrapping text uses View with a Text child shape', () => {
  const code = compileSnippet('<div><p>Hello</p></div>');
  assert.match(code, /<View>/);
  assert.match(code, /<Text variant="body">Hello<\/Text>/);
});

test('h1 maps to Text with the display variant', () => {
  const code = compileSnippet('<h1>Title</h1>');
  assert.match(code, /<Text variant="display">Title<\/Text>/);
});

test('interpolation becomes a JSX expression', () => {
  const code = compileSnippet('<h1>{{ title }}</h1>', `title = 'Hi';`);
  assert.match(code, /\{title\}/);
  assert.match(code, /const title = 'Hi';/);
  assert.match(code, /export default function T\(\)/);
});

test('[disabled] binding becomes disabled={...}', () => {
  const code = compileSnippet('<button [disabled]="isOff">Go</button>', 'isOff = true;');
  assert.match(code, /<RgButton disabled=\{isOff\}>Go<\/RgButton>/);
  assert.match(code, /from '@rangular\/ui'/);
});

test('event bindings degrade to a TODO comment plus warning', () => {
  const result = compileComponent({
    tsSource: `@Component({ selector: 'app-t', template: '<button (click)="go()">Go</button>' })
               export class TComponent { go() {} }`,
  });
  assert.match(result.code, /TODO\(M3\): \(click\)="go\(\)"/);
  assert.ok(result.diagnostics.some((d) => d.code === 'GEN_EVENT_TODO'));
});

test('golden: hello example output matches the committed file', () => {
  const dir = path.join(ROOT, 'examples', 'hello');
  const tsSource = fs.readFileSync(path.join(dir, 'hello.component.ts'), 'utf8');
  const result = compileComponent({
    tsSource,
    fileName: 'hello.component.ts',
    resolveFile: (rel) => fs.readFileSync(path.join(dir, rel), 'utf8'),
  });
  assert.equal(result.diagnostics.filter((d) => d.severity === 'error').length, 0, JSON.stringify(result.diagnostics));
  const golden = fs.readFileSync(path.join(dir, 'hello.component.tsx'), 'utf8');
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
  assert.equal(normalize(result.code), normalize(golden));
});
