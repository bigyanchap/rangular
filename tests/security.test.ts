import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { compileComponent, hasErrors } from '../packages/compiler/src/compile';
import { renderPreview } from '../packages/compiler/src/preview/renderPreview';
import { literalValue } from '../packages/compiler/src/template/literal';
import { parseCss } from '../packages/compiler/src/style/css';
import { Container } from '../packages/runtime/src/index';

const ROOT = path.join(__dirname, '..', '..');
const cliPath = path.join(ROOT, 'dist', 'packages', 'cli', 'src', 'cli.js');

/**
 * Security audit regressions (2026-11-12). Every test here is a fixture
 * that was first demonstrated exploitable against the unfixed compiler:
 * plain template text and static attribute values breaking out of their
 * literal context in generated code, a field value closing the preview
 * page's script block, and templateUrl / import paths reading files
 * outside the project tree.
 */

function compileWithTemplate(tsSource: string, template: string, extra: Record<string, unknown> = {}) {
  return compileComponent({
    tsSource,
    fileName: '/proj/x.component.ts',
    resolveFile: () => template,
    ...extra,
  });
}

const ENTRY = `import { Component } from '@angular/core';
@Component({ selector: 'app-x', templateUrl: './x.component.html' })
export class XComponent { note = 'n'; }
`;

test('security: plain text with braces stays data in generated code', () => {
  const result = compileWithTemplate(ENTRY, '<screen><p>Price: { notCode } and a stray } here</p></screen>');
  assert.equal(hasErrors(result.diagnostics), false);
  // The whole static part becomes one string expression, so the { can
  // never open a JSX expression container.
  assert.ok(result.code.includes('{"Price: { notCode } and a stray } here"}'), result.code);
  assert.ok(!result.code.includes('>Price: { notCode }'), result.code);
});

test('security: ordinary static text is still emitted as plain JSX text', () => {
  const result = compileWithTemplate(ENTRY, '<screen><p>Past five. Keep going</p></screen>');
  assert.ok(result.code.includes('>Past five. Keep going<'), result.code);
});

test('security: a quote inside a static attribute value cannot inject props', () => {
  const tpl = `<screen><appbar title='x" onPress={() => pwned()} y="z'></appbar></screen>`;
  const result = compileWithTemplate(ENTRY, tpl);
  assert.equal(hasErrors(result.diagnostics), false);
  // The payload survives only as inert text inside the title string.
  assert.ok(result.code.includes('title="x&quot; onPress={() => pwned()} y=&quot;z"'), result.code);
  assert.ok(!result.code.includes('title="x" onPress'), result.code);
});

test('security: a newline in a selector cannot break out of the header comment', () => {
  const tsSource = `import { Component } from '@angular/core';
@Component({ selector: 'app-x\\nINJECTED_LINE', template: '<screen><p>hi</p></screen>' })
export class XComponent { note = 'n'; }
`;
  const result = compileComponent({ tsSource, fileName: '/proj/x.component.ts' });
  const firstLine = result.code.split('\n')[0];
  assert.ok(firstLine.includes('app-x INJECTED_LINE)'), firstLine);
  assert.ok(!result.code.split('\n').some((l) => l.startsWith('INJECTED_LINE')), result.code);
});

test('security: a structural expression cannot close a generated JSX comment', () => {
  const result = compileWithTemplate(ENTRY, '<screen><p *ngFor="bogus */ INJECTED">hi</p></screen>');
  assert.ok(result.code.includes('bogus * / INJECTED'), result.code);
  assert.ok(!result.code.includes('bogus */ INJECTED'), result.code);
});

test('security: a field value cannot close the preview script block', () => {
  const tsSource = `import { Component } from '@angular/core';
@Component({ selector: 'app-x', templateUrl: './x.component.html' })
export class XComponent { note = '</script><script>alert(1)</script>'; }
`;
  const result = compileWithTemplate(tsSource, '<screen><p>{{ note }}</p></screen>');
  assert.ok(result.component && result.ast);
  const html = renderPreview(result.component, result.ast);
  assert.ok(!html.includes('</script><script>alert(1)</script>'), 'raw payload leaked into the page');
  assert.ok(html.includes('\\u003c/script>'), 'payload should be present only in escaped form');
  // The server-rendered first paint escapes it as text, as before.
  assert.ok(html.includes('&lt;/script&gt;'));
  // Exactly one real script block: the preview runtime.
  assert.equal((html.match(/<script>/g) ?? []).length, 1);
});

test('security: templateUrl escaping the project root is refused (library level)', () => {
  const tsSource = `import { Component } from '@angular/core';
@Component({ selector: 'app-x', templateUrl: '../../secret.html' })
export class XComponent { note = 'n'; }
`;
  const result = compileComponent({
    tsSource,
    fileName: '/proj/src/x.component.ts',
    rootDir: '/proj',
    resolveFile: () => 'SECRET TEMPLATE TEXT',
  });
  assert.equal(result.code, '');
  assert.ok(result.diagnostics.some((d) => d.code === 'CMP_PATH_ESCAPE'), JSON.stringify(result.diagnostics));
  assert.ok(!JSON.stringify(result).includes('SECRET TEMPLATE TEXT'));
});

test('security: a relative import escaping the project root is refused (library level)', () => {
  const tsSource = `import { Component } from '@angular/core';
import { EvilComponent } from '../evil';
@Component({ selector: 'app-x', template: '<screen><app-evil></app-evil></screen>' })
export class XComponent { note = 'n'; }
`;
  const evil = `import { Component } from '@angular/core';
@Component({ selector: 'app-evil', template: '<screen><p>EVIL TEXT</p></screen>' })
export class EvilComponent { note = 'e'; }
`;
  const result = compileComponent({
    tsSource,
    fileName: '/proj/src/x.component.ts',
    rootDir: '/proj',
    resolveImport: () => ({ source: evil, fileName: '/evil.ts' }),
  });
  assert.ok(result.diagnostics.some((d) => d.code === 'CMP_PATH_ESCAPE'), JSON.stringify(result.diagnostics));
  assert.ok(!result.code.includes('EVIL TEXT'), result.code);
});

test('security: the CLI refuses templateUrl and import escapes end to end', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rangular-sec-'));
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'package.json'), '{ "name": "fixture", "private": true }\n');
  fs.writeFileSync(path.join(tmp, 'secret.html'), 'CLI SECRET TEXT\n');
  fs.writeFileSync(path.join(tmp, 'evil.ts'), `import { Component } from '@angular/core';
@Component({ selector: 'app-evil', template: '<screen><p>CLI EVIL TEXT</p></screen>' })
export class EvilComponent { note = 'e'; }
`);
  const write = (name: string, body: string) => {
    const file = path.join(proj, 'src', name);
    fs.writeFileSync(file, body);
    return file;
  };
  const tplEntry = write('escape.component.ts', `import { Component } from '@angular/core';
@Component({ selector: 'app-escape', templateUrl: '../../secret.html' })
export class EscapeComponent { note = 'n'; }
`);
  const absEntry = write('abs.component.ts', `import { Component } from '@angular/core';
@Component({ selector: 'app-abs', templateUrl: '${path.join(tmp, 'secret.html')}' })
export class AbsComponent { note = 'n'; }
`);
  const impEntry = write('imports.component.ts', `import { Component } from '@angular/core';
import { EvilComponent } from '../../evil';
@Component({ selector: 'app-imports', template: '<screen><app-evil></app-evil></screen>' })
export class ImportsComponent { note = 'n'; }
`);
  for (const [name, entry] of [['tpl', tplEntry], ['abs', absEntry], ['imp', impEntry]] as const) {
    const out = path.join(tmp, `${name}.tsx`);
    const run = spawnSync('node', [cliPath, 'build', entry, '--out', out, '--json'], { encoding: 'utf8' });
    const payload = JSON.parse(run.stdout);
    assert.equal(payload.ok, false, `${name}: ${run.stdout} ${run.stderr}`);
    assert.ok(!fs.existsSync(out), `${name}: no output may be written`);
    const codes = payload.diagnostics.map((d: { code: string }) => d.code);
    if (name !== 'imp') assert.ok(codes.includes('CMP_PATH_ESCAPE'), `${name}: ${codes}`);
    // The import case is stopped even earlier, inside the CLI resolver,
    // so it surfaces as an unresolved import; either way it fails closed.
    const written = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    assert.ok(!written.includes('SECRET') && !written.includes('EVIL'), name);
  }
});

test('security: a __proto__ key in a literal stays an own property', () => {
  const r = literalValue("{ '__proto__': { polluted: 'yes' }, a: 1 }");
  assert.equal(r.ok, true);
  const value = r.value as Record<string, unknown>;
  assert.ok(Object.prototype.hasOwnProperty.call(value, '__proto__'));
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('security: the DI container treats __proto__ as an ordinary token', () => {
  const c = new Container();
  const marker = { marker: true };
  c.register('__proto__', marker);
  assert.equal(c.get('__proto__'), marker);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('security: CSS class selectors must be plain identifiers', () => {
  const bad = parseCss('.bad key { color: red; }');
  assert.ok(!('bad key' in bad.styles));
  assert.ok(bad.diagnostics.some((d) => d.code === 'CSS_SELECTOR'));
  const good = parseCss('.card-note { color: red; }');
  assert.ok('card-note' in good.styles);
});

// --- Stage 12 re-audit fixtures (2026-11-12) ---------------------------------
//
// The Stage 6 to 12 attack surface, run through the same adversarial
// method as the Stage 5 audit: icon names, routerLink strings, routes
// file contents, form validator attributes, datetime values,
// autocomplete options, badge values, custom pipe names, projection
// children and scaffold paths. One fixture in this set was a live
// hole when first run (the static minlength attribute); the rest
// verified as data-safe and are pinned here as regressions.

function compileSecProject(files: Record<string, string>, entryName = 'app.component.ts') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rangular-sec12-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  const entry = path.join(dir, entryName);
  return compileComponent({
    tsSource: fs.readFileSync(entry, 'utf8'),
    fileName: entry,
    resolveFile: (rel) => {
      const p = path.join(dir, rel);
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined;
    },
    resolveImport: (spec, importer) => {
      const base = path.resolve(path.dirname(importer), spec);
      for (const cand of [base, `${base}.ts`]) {
        if (fs.existsSync(cand)) return { source: fs.readFileSync(cand, 'utf8'), fileName: cand };
      }
      return undefined;
    },
  });
}

test('security: a static minlength attribute cannot inject into the generated validators call', () => {
  const result = compileWithTemplate(
    ENTRY,
    '<screen><input [(ngModel)]="note" minlength="3); pwned();//"></screen>',
  );
  assert.ok(result.diagnostics.some((d) => d.code === 'GEN_VALIDATOR_ARG'),
    JSON.stringify(result.diagnostics));
  assert.ok(!result.code.includes('pwned'), result.code);
  assert.ok(!result.code.includes('minLength(3)'), result.code);
  const ok = compileWithTemplate(
    ENTRY,
    '<screen><input [(ngModel)]="note" minlength="3"></screen>',
  );
  assert.ok(ok.code.includes('minLength(3)'), ok.code);
  assert.ok(!ok.diagnostics.some((d) => d.code === 'GEN_VALIDATOR_ARG'));
});

test('security: a pattern attribute with quotes stays a JSON string in generated code', () => {
  const result = compileWithTemplate(
    ENTRY,
    `<screen><input [(ngModel)]="note" pattern='x" }); pwned();//'></screen>`,
  );
  assert.ok(!result.diagnostics.some((d) => d.severity === 'error'), JSON.stringify(result.diagnostics));
  assert.ok(result.code.includes('pattern("x\\" }); pwned();//")'), result.code);
  assert.ok(!result.code.includes('pattern("x" });'), result.code);
});

test('security: an icon name with a quote is an unknown icon, never emitted markup', () => {
  const result = compileWithTemplate(
    ENTRY,
    `<screen><icon name='check" onPress="pwned'></icon></screen>`,
  );
  assert.ok(result.diagnostics.some((d) => d.code === 'GEN_ICON_UNKNOWN'),
    JSON.stringify(result.diagnostics));
  assert.ok(!result.code.includes('onPress="pwned'), result.code);
});

test('security: a routes file path and redirect with quotes stay JSON data in generated code', () => {
  const result = compileSecProject({
    'app.component.ts': `
      import { Component } from '@angular/core';
      import { InboxComponent } from './inbox.component';
      @Component({ selector: 'app-x', template: '<screen><router-outlet></router-outlet></screen>' })
      export class XComponent { note = 'n'; }
    `,
    'inbox.component.ts': `
      import { Component } from '@angular/core';
      @Component({ selector: 'app-inbox', template: '<screen><p>Inbox</p></screen>' })
      export class InboxComponent {}
    `,
    'app.routes.ts': `
      import { Routes } from '@angular/router';
      import { InboxComponent } from './inbox.component';
      export const routes: Routes = [
        { path: "x'; pwned();//", component: InboxComponent },
        { path: 'home', redirectTo: "y\\"}; pwned();//" },
      ];
    `,
  });
  assert.ok(result.code.includes('new RgNavigator(['), result.code);
  const jsonText = result.code.slice(
    result.code.indexOf('new RgNavigator([') + 'new RgNavigator('.length,
    result.code.indexOf('])', result.code.indexOf('new RgNavigator([')) + 1,
  );
  const parsed = JSON.parse(jsonText) as { path: string; redirectTo?: string }[];
  assert.equal(parsed[0].path, "x'; pwned();//", 'the hostile path round-trips as inert data');
  assert.ok(!result.code.includes("navigate(\"x';"), result.code);
});

test('security: a routerLink string with quotes and braces stays a string argument', () => {
  const result = compileSecProject({
    'app.component.ts': `
      import { Component } from '@angular/core';
      @Component({ selector: 'app-x', template: '<screen><button routerLink="/x\\"}; pwned();//">Go</button><router-outlet></router-outlet></screen>' })
      export class XComponent { note = 'n'; }
    `,
    'app.routes.ts': `
      import { Routes } from '@angular/router';
      export const routes: Routes = [{ path: 'x' }];
    `,
  });
  assert.ok(!result.code.includes('pwned();//")'), result.code.split('\n').find((l) => l.includes('pwned')) ?? '');
  assert.ok(!/onPress=\{\(\) => [^}]*pwned\(\)/.test(result.code.replace(/"[^"]*"/g, '""')),
    'the payload survives only inside a quoted string');
});

test('security: a badge value with a quote stays data in generated code', () => {
  const result = compileWithTemplate(
    ENTRY,
    `<screen><button badge='9" } pwned={1} x="'>B</button></screen>`,
  );
  // The payload survives only as inert text inside the entity-escaped
  // attribute string, the Stage 5 attribute discipline.
  assert.ok(result.code.includes('badge="9&quot; } pwned={1} x=&quot;"'), result.code);
  assert.ok(!result.code.includes('badge="9" }'), result.code);
});

test('security: an autocomplete option cannot close the preview script block', () => {
  const tsSource = `import { Component } from '@angular/core';
@Component({ selector: 'app-x', templateUrl: './x.component.html' })
export class XComponent { city = ''; cities = ['Oslo', '</script><script>alert(1)</script>']; }
`;
  const result = compileWithTemplate(
    tsSource,
    '<screen><input [(ngModel)]="city" [options]="cities"></screen>',
  );
  assert.ok(result.component && result.ast);
  const html = renderPreview(result.component, result.ast, {
    children: result.children, services: result.services,
    pipes: result.pipes, directives: result.directives,
  });
  assert.equal((html.match(/<script>/g) ?? []).length, 1, 'exactly one script block');
  assert.ok(!html.includes('</script><script>alert(1)</script>'), 'raw payload leaked into the page');
  assert.ok(html.includes('\\u003c/script>'), 'the payload survives only in escaped form');
});

test('security: a custom pipe name with a script closer stays escaped in the preview', () => {
  const result = compileSecProject({
    'app.component.ts': `
      import { Component } from '@angular/core';
      import { WeirdPipe } from './weird.pipe';
      @Component({ selector: 'app-x', template: '<screen><p>hi</p></screen>' })
      export class XComponent { note = 'n'; }
    `,
    'weird.pipe.ts': `
      import { Pipe } from '@angular/core';
      @Pipe({ name: 'weird</script><script>alert(1)</script>' })
      export class WeirdPipe { transform(value: string): string { return value; } }
    `,
  });
  assert.ok(result.component && result.ast);
  const html = renderPreview(result.component, result.ast, {
    children: result.children, services: result.services,
    pipes: result.pipes, directives: result.directives,
  });
  assert.equal((html.match(/<script>/g) ?? []).length, 1, 'exactly one script block');
  assert.ok(!html.includes('weird</script><script>alert(1)</script>'), 'raw payload leaked into the page');
});

test('security: projected children with braces stay data, like any template text', () => {
  const result = compileSecProject({
    'app.component.ts': `
      import { Component } from '@angular/core';
      import { PanelComponent } from './panel.component';
      @Component({ selector: 'app-x', template: '<screen><app-panel><p>Total: { not code }</p></app-panel></screen>' })
      export class XComponent { note = 'n'; }
    `,
    'panel.component.ts': `
      import { Component } from '@angular/core';
      @Component({ selector: 'app-panel', template: '<card><ng-content></ng-content></card>' })
      export class PanelComponent {}
    `,
  });
  assert.ok(result.code.includes('{"Total: { not code }"}'), result.code);
  assert.ok(!result.code.includes('>Total: { not code }'), result.code);
  const html = renderPreview(result.component!, result.ast!, {
    children: result.children, services: result.services,
    pipes: result.pipes, directives: result.directives,
  });
  assert.ok(html.includes('Total: { not code }'), 'the paint shows the braces as text');
});

test('security: a datetime value with a quote cannot break out of its prop', () => {
  const result = compileWithTemplate(
    ENTRY,
    `<screen><datetime-picker value='2024-01-01" } pwned={1}'></datetime-picker></screen>`,
  );
  assert.ok(result.code.includes('value="2024-01-01&quot; } pwned={1}"'), result.code);
  assert.ok(!result.code.includes('value="2024-01-01" }'), result.code);
});
