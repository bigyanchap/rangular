import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileComponent, CompileResult, hasErrors } from '../packages/compiler/src/compile';

/**
 * Third-party import tests. Before this round, every import of a bare
 * (third-party) module specifier in a component or service file was
 * silently dropped by codegen: the calls were emitted, the import
 * never was, and the generated app threw a ReferenceError at runtime
 * (proven with AsyncStorage in a bookmarks service). The rule now:
 * a bare import in a file that contributes classes to the generated
 * module is carried into the generated module's import block, merged
 * per specifier, unless its name is already taken there, in which
 * case it is dropped with a GEN_IMPORT_COLLISION warning. The
 * import = require(...) form cannot be carried and warns
 * CMP_IMPORT_FORM. Framework specifiers (@angular/*, @rangular/*,
 * react, react-native) and relative imports behave exactly as before:
 * framework names are consumed semantically, relative imports are
 * followed and their classes inlined.
 */

function compileProject(files: Record<string, string>, entryName = 'app.component.ts'): CompileResult {
  return compileComponent({
    tsSource: files[entryName],
    fileName: entryName,
    resolveImport: (spec, importer) => {
      if (!spec.startsWith('.')) return undefined;
      const dir = importer.includes('/') ? importer.slice(0, importer.lastIndexOf('/')) : '';
      let rel = spec.replace(/^\.\//, '');
      if (!rel.endsWith('.ts')) rel += '.ts';
      const key = dir ? `${dir}/${rel}` : rel;
      return files[key] ? { source: files[key], fileName: key } : undefined;
    },
  });
}

function component(imports: string, classBody = '', extraHead = ''): string {
  return `${extraHead}import { Component } from '@angular/core';
${imports}
@Component({ selector: 'app-root', template: '<p>hi</p>' })
export class AppComponent { ${classBody} }
`;
}

function withService(svcSource: string, svcName = 'store.service', svcClass = 'StoreService'): Record<string, string> {
  return {
    'app.component.ts': component(`import { ${svcClass} } from './${svcName}';`,
      `constructor(private store: ${svcClass}) {}`),
    [`${svcName}.ts`]: svcSource,
  };
}

function importLines(code: string): string[] {
  return code.split('\n').filter((l) => l.startsWith('import '));
}

// --- Carried forms: components ------------------------------------------------

test('a named third-party import in a component is carried into the generated module', () => {
  const result = compileProject({
    'app.component.ts': component(`import { format } from 'date-fns';`,
      `label = ''; show() { this.label = format('x'); }`),
  });
  assert.equal(hasErrors(result.diagnostics), false, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(importLines(result.code).includes(`import { format } from 'date-fns';`), result.code);
  assert.match(result.code, /format\('x'\)/);
});

test('an aliased named third-party import keeps its alias', () => {
  const result = compileProject({
    'app.component.ts': component(`import { format as fmt } from 'date-fns';`,
      `label = ''; show() { this.label = fmt('x'); }`),
  });
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(importLines(result.code).includes(`import { format as fmt } from 'date-fns';`), result.code);
});

test('a default third-party import in a component is carried (the AsyncStorage shape)', () => {
  const result = compileProject({
    'app.component.ts': component(`import AsyncStorage from '@react-native-async-storage/async-storage';`,
      `done = false; save() { AsyncStorage.setItem('k', 'v').then(() => { this.done = true; }); }`),
  });
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(
    importLines(result.code).includes(`import AsyncStorage from '@react-native-async-storage/async-storage';`),
    result.code,
  );
  assert.match(result.code, /AsyncStorage\.setItem\('k', 'v'\)/);
});

test('a namespace third-party import in a component is carried', () => {
  const result = compileProject({
    'app.component.ts': component(`import * as _ from 'lodash';`,
      `label = ''; show() { this.label = _.chunk('x'); }`),
  });
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(importLines(result.code).includes(`import * as _ from 'lodash';`), result.code);
});

test('a side-effect third-party import in a component is carried', () => {
  const result = compileProject({
    'app.component.ts': component(`import 'reflect-metadata';`),
  });
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(importLines(result.code).includes(`import 'reflect-metadata';`), result.code);
});

test('a default plus named third-party import is carried as one statement', () => {
  const result = compileProject({
    'app.component.ts': component(`import Def, { helper } from 'some-lib';`,
      `label = ''; show() { this.label = helper(Def); }`),
  });
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(importLines(result.code).includes(`import Def, { helper } from 'some-lib';`), result.code);
});

test('a third-party import in a child component file is carried', () => {
  const result = compileProject({
    'app.component.ts': component(`import { KidComponent } from './kid.component';`),
    'kid.component.ts': `import { Component } from '@angular/core';
import { format } from 'date-fns';
@Component({ selector: 'app-kid', template: '<p>kid</p>' })
export class KidComponent { label = ''; show() { this.label = format('x'); } }
`,
  });
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(importLines(result.code).includes(`import { format } from 'date-fns';`), result.code);
});

// --- Carried forms: services ----------------------------------------------------

test('a default third-party import in a service is carried (the proven AsyncStorage bug)', () => {
  const result = compileProject(withService(`import { Injectable } from '@angular/core';
import AsyncStorage from '@react-native-async-storage/async-storage';
@Injectable({ providedIn: 'root' })
export class StoreService {
  saved = '';
  save(v: string) { AsyncStorage.setItem('k', v).then(() => { this.saved = v; }); }
  load() { AsyncStorage.getItem('k').then((v) => { this.saved = v; }); }
}
`));
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(
    importLines(result.code).includes(`import AsyncStorage from '@react-native-async-storage/async-storage';`),
    result.code,
  );
  assert.match(result.code, /AsyncStorage\.setItem\('k', v\)/);
  assert.match(result.code, /AsyncStorage\.getItem\('k'\)/);
});

test('a named third-party import in a service is carried', () => {
  const result = compileProject(withService(`import { Injectable } from '@angular/core';
import { nanoid } from 'nanoid';
@Injectable({ providedIn: 'root' })
export class StoreService {
  id = '';
  make() { this.id = nanoid(); }
}
`));
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(importLines(result.code).includes(`import { nanoid } from 'nanoid';`), result.code);
});

test('a type-only third-party import in a service is carried as an import type', () => {
  const result = compileProject(withService(`import { Injectable } from '@angular/core';
import type { User } from 'some-lib';
@Injectable({ providedIn: 'root' })
export class StoreService {
  current: User;
}
`));
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(importLines(result.code).includes(`import type { User } from 'some-lib';`), result.code);
  assert.match(result.code, /current: User;/);
});

test('an inline type binding rides the value statement as a type entry', () => {
  const result = compileProject(withService(`import { Injectable } from '@angular/core';
import { type User, makeUser } from 'some-lib';
@Injectable({ providedIn: 'root' })
export class StoreService {
  current: User;
  make() { this.current = makeUser(); }
}
`));
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(
    importLines(result.code).includes(`import { type User, makeUser } from 'some-lib';`),
    result.code,
  );
});

test('the same third-party import declared by two contributing files is carried once', () => {
  const files = withService(`import { Injectable } from '@angular/core';
import { format } from 'date-fns';
@Injectable({ providedIn: 'root' })
export class StoreService {
  stamp = '';
  mark() { this.stamp = format('x'); }
}
`);
  files['app.component.ts'] = component(
    `import { StoreService } from './store.service';
import { format } from 'date-fns';`,
    `label = ''; constructor(private store: StoreService) {} show() { this.label = format('y'); }`,
  );
  const result = compileProject(files);
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  const lines = importLines(result.code).filter((l) => l.includes(`'date-fns'`));
  assert.equal(lines.length, 1, result.code);
  assert.equal(lines[0], `import { format } from 'date-fns';`);
});

test('a third-party import in a service that is never emitted is not carried', () => {
  const files = withService(`import { Injectable } from '@angular/core';
import { nanoid } from 'nanoid';
@Injectable()
export class StoreService {
  id = '';
  make() { this.id = nanoid(); }
}
`);
  const result = compileProject(files);
  assert.ok(!importLines(result.code).some((l) => l.includes(`'nanoid'`)), result.code);
});

// --- Diagnosed forms --------------------------------------------------------------

test('one local name imported from two different modules warns GEN_IMPORT_COLLISION and keeps the first', () => {
  const files = withService(`import { Injectable } from '@angular/core';
import { thing } from 'lib-b';
@Injectable({ providedIn: 'root' })
export class StoreService {
  v = '';
  use() { this.v = thing(); }
}
`);
  files['app.component.ts'] = component(
    `import { StoreService } from './store.service';
import { thing } from 'lib-a';`,
    `label = ''; constructor(private store: StoreService) {} show() { this.label = thing(); }`,
  );
  const result = compileProject(files);
  const d = result.diagnostics.find((x) => x.code === 'GEN_IMPORT_COLLISION');
  assert.ok(d, JSON.stringify(result.diagnostics));
  assert.equal(d.severity, 'warning');
  assert.equal(hasErrors(result.diagnostics), false);
  assert.ok(d.fix, 'the diagnostic teaches the fix');
  assert.ok(importLines(result.code).includes(`import { thing } from 'lib-a';`), result.code);
  assert.ok(!importLines(result.code).some((l) => l.includes(`'lib-b'`)), result.code);
});

test('a third-party binding named like a generated class warns GEN_IMPORT_COLLISION and is dropped', () => {
  const files = withService(`import { Injectable } from '@angular/core';
@Injectable({ providedIn: 'root' })
export class StoreService { total = 3; }
`);
  files['app.component.ts'] = component(
    `import { StoreService } from './store.service';
import { StoreService as ForeignStore } from 'some-lib';`,
    `constructor(private store: StoreService) {}`,
  );
  // The local name here is ForeignStore, which is free: carried. Now the
  // colliding shape: the same local name as the emitted service class.
  const ok = compileProject(files);
  assert.deepEqual(ok.diagnostics, [], JSON.stringify(ok.diagnostics));
  assert.ok(importLines(ok.code).includes(`import { StoreService as ForeignStore } from 'some-lib';`), ok.code);

  files['app.component.ts'] = component(
    `import { StoreService } from './store.service';
import { StoreService } from 'some-lib';`,
    `constructor(private store: StoreService) {}`,
  );
  const result = compileProject(files);
  const d = result.diagnostics.find((x) => x.code === 'GEN_IMPORT_COLLISION');
  assert.ok(d, JSON.stringify(result.diagnostics));
  assert.equal(d.severity, 'warning');
  assert.ok(!importLines(result.code).some((l) => l.includes(`'some-lib'`)), result.code);
  assert.match(result.code, /export class StoreService extends ReactiveService/);
});

test('a third-party binding named like a framework import of the module warns GEN_IMPORT_COLLISION', () => {
  const result = compileProject(withService(`import { Injectable } from '@angular/core';
import { Container } from 'some-lib';
@Injectable({ providedIn: 'root' })
export class StoreService {
  box = null;
  use() { this.box = Container; }
}
`));
  const d = result.diagnostics.find((x) => x.code === 'GEN_IMPORT_COLLISION');
  assert.ok(d, JSON.stringify(result.diagnostics));
  assert.ok(!importLines(result.code).some((l) => l.includes(`'some-lib'`)), result.code);
  assert.ok(importLines(result.code).some((l) => l.includes(`'${'@rangular/runtime'}'`) && l.includes('Container')), result.code);
});

test('an import = require declaration warns CMP_IMPORT_FORM and is not emitted', () => {
  const result = compileProject(withService(`import { Injectable } from '@angular/core';
import AS = require('async-storage-lib');
@Injectable({ providedIn: 'root' })
export class StoreService {
  save() { AS.setItem('k', 'v'); }
}
`));
  const d = result.diagnostics.find((x) => x.code === 'CMP_IMPORT_FORM');
  assert.ok(d, JSON.stringify(result.diagnostics));
  assert.equal(d.severity, 'warning');
  assert.equal(hasErrors(result.diagnostics), false);
  assert.ok(d.fix && d.fix.includes('import'), d.fix);
  assert.ok(!importLines(result.code).some((l) => l.includes('async-storage-lib')), result.code);
});

// --- No regression: framework and relative imports --------------------------------

test('framework and relative imports produce exactly the output they produced before', () => {
  const files = {
    'app.component.ts': component(`import { MailService } from './mail.service';`,
      `count = 0; constructor(private mail: MailService) {}`),
    'mail.service.ts': `import { Injectable } from '@angular/core';
@Injectable({ providedIn: 'root' })
export class MailService { total = 3; }
`,
  };
  const result = compileProject(files);
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.match(result.code, /export class MailService extends ReactiveService/);
  const lines = importLines(result.code);
  assert.ok(lines.length > 0, result.code);
  for (const l of lines) {
    assert.ok(
      /from '(react|react-native|@rangular\/ui|@rangular\/runtime)'/.test(l),
      `unexpected import line survived: ${l}`,
    );
  }
});

test('a relative default import of a service file still resolves the service', () => {
  const files = {
    'app.component.ts': `import { Component } from '@angular/core';
import MailService from './mail.service';
@Component({ selector: 'app-root', template: '<p>hi</p>' })
export class AppComponent { constructor(private mail: MailService) {} }
`,
    'mail.service.ts': `import { Injectable } from '@angular/core';
@Injectable({ providedIn: 'root' })
export class MailService { total = 3; }
`,
  };
  const result = compileProject(files);
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.match(result.code, /export class MailService extends ReactiveService/);
});
