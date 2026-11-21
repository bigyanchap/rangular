import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { compileComponent, CompileResult } from '../packages/compiler/src/compile';
import { renderPreview } from '../packages/compiler/src/preview/renderPreview';

// Switch colour roles: a <switch> gains color="primary|success"
// (success paints the on state the theme success green, off
// stays the surface grey), validated at compile time the way
// the button colour roles are, and the preview paints the
// same two states.

const FIXTURE_TS = `
import { Component } from '@angular/core';

@Component({
  selector: 'app-switches',
  templateUrl: './app.component.html',
})
export class SwitchesComponent {
  dataOn = true;
  plainOn = true;

  onData(value: boolean) {
    this.dataOn = value;
  }

  onPlain(value: boolean) {
    this.plainOn = value;
  }
}
`;

const FIXTURE_HTML = `
<switch color="success" [checked]="dataOn" (change)="onData($event)">Mobile data</switch>
<switch [checked]="plainOn" (change)="onPlain($event)">Plain</switch>
`;

function compileFixture(html: string = FIXTURE_HTML): CompileResult {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rangular-sw-'));
  fs.writeFileSync(path.join(dir, 'app.component.ts'), FIXTURE_TS);
  fs.writeFileSync(path.join(dir, 'app.component.html'), html);
  const entry = path.join(dir, 'app.component.ts');
  return compileComponent({
    tsSource: fs.readFileSync(entry, 'utf8'),
    fileName: entry,
    resolveFile: (rel) => {
      const p = path.join(dir, rel);
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined;
    },
    resolveImport: (spec, importer) => {
      const base = path.resolve(path.dirname(importer), spec);
      for (const cand of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
          return { source: fs.readFileSync(cand, 'utf8'), fileName: cand };
        }
      }
      return undefined;
    },
  });
}

test('switch color success reaches RgSwitch as a prop, with no diagnostics', () => {
  const result = compileFixture();
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(result.code!.includes('color="success"'), result.code!);
});

test('a plain switch carries no color prop and no diagnostics', () => {
  const result = compileFixture();
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  const plainLine = result.code!.split('\n').find((l) => l.includes('>Plain</RgSwitch>'));
  assert.ok(plainLine, result.code!);
  assert.ok(!plainLine.includes('color='), plainLine);
});

test('a switch color outside the two roles is a GEN_SWITCH_COLOR error with the fix', () => {
  const result = compileFixture(FIXTURE_HTML.replace('color="success"', 'color="pink"'));
  const diag = result.diagnostics.find((d) => d.code === 'GEN_SWITCH_COLOR');
  assert.ok(diag, JSON.stringify(result.diagnostics));
  assert.equal(diag.severity, 'error');
  assert.ok(diag.fix?.includes('color="success"'), diag.fix);
});

test('the preview paints a checked success switch with the success class', () => {
  const result = compileFixture();
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  const html = renderPreview(result.component!, result.ast!);
  assert.ok(html.includes('switch on success'), html.slice(0, 2000));
  assert.ok(html.includes('--role-success'), html.slice(0, 4000));
});
