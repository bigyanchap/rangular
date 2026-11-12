import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileComponent } from '../packages/compiler/src/compile';

function compileClass(classBody: string, template = '<p>x</p>'): { code: string; diagnostics: { code: string; severity: string }[] } {
  const tsSource = `
    @Component({ selector: 'app-t', template: ${JSON.stringify(template)} })
    export class TComponent { ${classBody} }
  `;
  const result = compileComponent({ tsSource });
  assert.equal(
    result.diagnostics.filter((d) => d.severity === 'error').length, 0,
    JSON.stringify(result.diagnostics),
  );
  return result as { code: string; diagnostics: { code: string; severity: string }[] };
}

test('a field assigned in a method becomes useState state', () => {
  const { code } = compileClass(`
    count = 0;
    bump() { this.count++; }
  `);
  assert.match(code, /import \{ useState \} from 'react';/);
  assert.match(code, /const \[count, setCount\] = useState\(0\);/);
});

test('a field never assigned stays a plain const', () => {
  const { code } = compileClass(`
    label = 'Counter';
    count = 0;
    bump() { this.count++; }
  `);
  assert.match(code, /const label = 'Counter';/);
  assert.doesNotMatch(code, /\[label, setLabel\]/);
});

test('array/object literal fields hoist and can become state', () => {
  const { code } = compileClass(`
    mails = [{ id: 1, from: 'A' }];
    clear() { this.mails = []; }
  `);
  assert.match(code, /const \[mails, setMails\] = useState\(\[\{ id: 1, from: 'A' \}\]\);/);
  assert.match(code, /setMails\(\[\]\);/);
});

test('++ and -- translate to setter calls', () => {
  const { code } = compileClass(`
    count = 0;
    up() { this.count++; }
    down() { this.count--; }
  `);
  assert.match(code, /setCount\(count \+ 1\);/);
  assert.match(code, /setCount\(count - 1\);/);
});

test('+= and -= translate to setter calls, parameters preserved', () => {
  const { code } = compileClass(`
    count = 0;
    add(step: number) { this.count += step; }
    sub(step: number) { this.count -= step; }
  `);
  assert.match(code, /const add = \(step: number\) => \{\s+setCount\(count \+ step\);/);
  assert.match(code, /setCount\(count - step\);/);
});

test('plain assignment and this.method() calls translate', () => {
  const { code } = compileClass(`
    count = 5;
    reset() { this.count = 0; this.audit(); }
    audit() { }
  `);
  assert.match(code, /const reset = \(\) => \{\s+setCount\(0\);\s+audit\(\);/);
});

test('the state setter is used for $event assignments', () => {
  const { code } = compileClass(`
    last = '';
    save($event: any) { this.last = $event; }
  `);
  assert.match(code, /const \[last, setLast\] = useState\(''\);/);
  assert.match(code, /setLast\(\$event\);/);
});

test('if/else statements translate recursively', () => {
  const { code } = compileClass(`
    count = 0;
    clamp() { if (this.count > 10) { this.count = 10; } else { this.count += 0; } }
  `);
  assert.match(code, /if \(count > 10\) \{\s+setCount\(10\);\s+\} else \{\s+setCount\(count \+ 0\);\s+\}/);
});

test('local const declarations and return statements translate', () => {
  const { code } = compileClass(`
    count = 1;
    describe() { const label = 'n=' + this.count; return label; }
  `);
  assert.match(code, /const label = 'n=' \+ count;/);
  assert.match(code, /return label;/);
});

test('an unsupported statement warns and leaves a TODO, never broken code', () => {
  const { code, diagnostics } = compileClass(`
    count = 0;
    loop() { for (let i = 0; i < 3; i++) { this.count++; } }
  `);
  assert.ok(diagnostics.some((d) => d.code === 'METHOD_UNSUPPORTED'));
  assert.match(code, /TODO\(Rangular\): unsupported in method 'loop': ForStatement/);
});
