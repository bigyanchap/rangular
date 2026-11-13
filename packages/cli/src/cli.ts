#!/usr/bin/env node
/**
 * Rangular CLI:
 *   rangular build <component.ts> --out <file.tsx> [--json] [--source-map] [--routes <file>]
 *   rangular ast <template.html>
 *   rangular preview <component.ts> --out <file.html> [--json] [--routes <file>]
 *   rangular catalog [--out <dir>]
 *   rangular watch <component.ts> --out <file.tsx> [--routes <file>]
 *   rangular init <dir> [--app]
 *   rangular doctor <component.ts> [--json] [--routes <file>]
 *
 * --routes names the routes file (Stage 9); without it the compiler
 * auto-discovers a sibling app.routes.ts next to the component.
 *
 * Run from the compiled output: node dist/packages/cli/src/cli.js ...
 *
 * --json prints ONE JSON object to stdout ({ ok, outFile?, diagnostics })
 * and nothing else, so AI tools and scripts can consume diagnostics and
 * self-correct. Human diagnostics (with `fix:` lines) go to stderr.
 * Diagnostics carry a `file` when their origin differs from the entry
 * file: template problems name the .html, style problems the file that
 * holds the styles (Stage 5).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  buildCatalog,
  compileComponent,
  Diagnostic,
  doctorStyleTexts,
  formatDiagnostic,
  hasErrors,
  parseTemplate,
  printAst,
  renderCatalogMarkdown,
  renderPreview,
  runDoctor,
} from '../../compiler/src/index';

function fail(message: string): never {
  console.error(`rangular: ${message}`);
  process.exit(2);
}

function option(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

/**
 * Project root boundary (security audit, 2026-11-12): the nearest
 * ancestor of the entry file that holds a package.json, falling back to
 * the entry file's own directory. The resolvers below refuse to read
 * anything outside this tree, and the same root is passed to the
 * compiler, which reports escapes as CMP_PATH_ESCAPE errors.
 */
function projectRootFor(entryAbs: string): string {
  let dir = path.dirname(entryAbs);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.dirname(entryAbs);
    dir = parent;
  }
}

function withinRoot(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

function readComponent(componentFile: string) {
  const abs = path.resolve(componentFile);
  if (!fs.existsSync(abs)) fail(`file not found: ${componentFile}`);
  const tsSource = fs.readFileSync(abs, 'utf8');
  const dir = path.dirname(abs);
  const rootDir = projectRootFor(abs);
  const resolveFile = (rel: string) => {
    const p = path.resolve(dir, rel);
    if (!withinRoot(rootDir, p)) return undefined;
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined;
  };
  /**
   * Stage 3 import resolution: a relative specifier resolves against the
   * importing file's directory, trying the specifier as-is (templates),
   * with a '.ts' extension, and as a directory index.
   */
  const resolveImport = (spec: string, importer: string) => {
    const base = path.resolve(path.dirname(importer), spec);
    for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
      if (!withinRoot(rootDir, candidate)) continue;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return { source: fs.readFileSync(candidate, 'utf8'), fileName: candidate };
      }
    }
    return undefined;
  };
  return { tsSource, resolveFile, resolveImport, absPath: abs, rootDir };
}

function toJsonDiagnostic(d: Diagnostic): Record<string, unknown> {
  const out: Record<string, unknown> = { severity: d.severity, code: d.code, message: d.message };
  if (d.line !== undefined) out.line = d.line;
  if (d.column !== undefined) out.column = d.column;
  if (d.file !== undefined) out.file = d.file;
  if (d.fix !== undefined) out.fix = d.fix;
  return out;
}

function printJson(payload: Record<string, unknown>): void {
  console.log(JSON.stringify(payload, null, 2));
}

const USAGE = [
  'Usage:',
  '  rangular build <component.ts> --out <file.tsx> [--json] [--source-map] [--routes <file>]',
  '  rangular ast <template.html>',
  '  rangular preview <component.ts> --out <file.html> [--json] [--routes <file>]',
  '  rangular catalog [--out <dir>]',
  '  rangular watch <component.ts> --out <file.tsx> [--routes <file>]',
  '  rangular init <dir> [--app]',
  '  rangular doctor <component.ts> [--json] [--routes <file>]',
].join('\n');

/**
 * The --routes flag (Stage 9) as a specifier the compiler can resolve
 * from the entry file: a './'-style relative path from the component's
 * directory to the routes file. The compiler's own project-root
 * boundary still applies to the resolved file.
 */
function routesSpecifierFor(entryAbs: string, routesArg: string | undefined): string | undefined {
  if (!routesArg) return undefined;
  const routesAbs = path.resolve(routesArg);
  if (!fs.existsSync(routesAbs)) fail(`routes file not found: ${routesArg}`);
  let rel = path.relative(path.dirname(entryAbs), routesAbs).split(path.sep).join('/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

/**
 * The Rangular repo root as seen from this CLI (Stage 12): the CLI
 * runs from <root>/dist/packages/cli/src, so the root is four levels
 * up. The Expo scaffold needs it to compute the file: dependencies
 * that point at the repo's packages, and to place a bare-named app
 * under <root>/apps.
 */
function rangularRepoRoot(): string {
  return path.resolve(__dirname, '..', '..', '..', '..');
}

const STARTER_TS = `import { Component } from '@angular/core';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
})
export class AppComponent {
  title = 'Welcome to Rangular';
  taps = 0;

  start() {
    this.taps++;
  }
}
`;

const STARTER_HTML = `<screen>
  <appbar title="Rangular"></appbar>
  <h1>{{ title }}</h1>
  <card>
    <h3>Your first screen</h3>
    <p>You wrote Angular. This screen is React Native.</p>
    <button (click)="start()">Get started</button>
    <p *ngIf="taps > 0">Started {{ taps }} times</p>
  </card>
</screen>
`;

/** A package.json name from a directory name: lowercase, npm-safe. */
function packageNameOf(dirName: string): string {
  const cleaned = dirName.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[.-]+/, '');
  return cleaned || 'rangular-app';
}

/** A path as a file: dependency specifier, relative and forward-slashed. */
function fileDepOf(fromDir: string, toDir: string): string {
  const rel = path.relative(fromDir, toDir).split(path.sep).join('/');
  return `file:${rel.startsWith('.') ? rel : `./${rel}`}`;
}

/**
 * `rangular init <dir> --app`: scaffold a real Expo app (Stage 12).
 *
 * A bare name (no path separators) creates the app at
 * <repoRoot>/apps/<name>; an explicit path (absolute, or containing a
 * separator) is used as given. Either way the generated package.json
 * depends on @rangular/ui and @rangular/runtime through file:
 * specifiers computed relative from the app directory to this repo's
 * packages, so the app always builds against the checkout it was
 * scaffolded from. Every file is written under the app directory;
 * the starter component is compiled at init time into src/AppRoot.tsx
 * by the real compiler, so what App.tsx imports is genuine compiler
 * output, not a stored sample.
 *
 * The dependency pins are the Expo SDK 58 set (expo ~58, react 19.3,
 * react-native 0.88, react-native-svg 15.16, babel-preset-expo ~58),
 * chosen for mutual compatibility per the SDK 58 release. The set
 * also carries expo-image-picker ~58.0.10 and expo-document-picker
 * ~58.0.5: RgFilePicker names both in literal requires, and Metro
 * resolves every literal require when an app bundles, so both are
 * required dependencies of any app built on @rangular/ui, not an
 * option an app picks per kind. The set moved from SDK 54 to
 * SDK 58 on 2026-11-12 because the store build of Expo Go supports
 * SDK 58 only and refused an SDK 54 app. The pins come from the
 * SDK's published compatibility set; they were not installed or
 * device-verified from this environment, and the app README
 * says so.
 */
function initApp(dirArg: string): void {
  const repoRoot = rangularRepoRoot();
  const isBareName = !path.isAbsolute(dirArg) && !dirArg.includes('/') && !dirArg.includes('\\');
  let appDir: string;
  if (isBareName) {
    if (!/^[A-Za-z0-9._-]+$/.test(dirArg) || dirArg === '.' || dirArg === '..') {
      console.error(formatDiagnostic({
        severity: 'error',
        code: 'CLI_INIT_UNSAFE',
        message: `Cannot init an app named '${dirArg}': a bare app name may only use letters, digits, dot, underscore and hyphen, and may not be . or ..`,
        fix: 'Use a simple name, e.g. rangular init my-app --app, or pass an explicit path',
      }));
      process.exit(1);
    }
    appDir = path.join(repoRoot, 'apps', dirArg);
  } else {
    appDir = path.resolve(dirArg);
  }
  if (fs.existsSync(appDir) && fs.readdirSync(appDir).length > 0) {
    console.error(formatDiagnostic({
      severity: 'error',
      code: 'CLI_INIT_NOT_EMPTY',
      message: `Cannot init an app into '${appDir}': the directory is not empty`,
      fix: 'Pick a new directory name, or empty the directory first, e.g. rangular init my-app --app',
    }));
    process.exit(1);
  }
  const appName = packageNameOf(path.basename(appDir));
  const relToRepo = path.relative(appDir, repoRoot).split(path.sep).join('/') || '.';
  const srcDir = path.join(appDir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  const write = (rel: string, content: string): void => {
    const target = path.join(appDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };

  write('package.json', JSON.stringify({
    name: appName,
    version: '1.0.0',
    private: true,
    main: 'node_modules/expo/AppEntry.js',
    scripts: {
      start: 'expo start',
      android: 'expo start --android',
      ios: 'expo start --ios',
      web: 'expo start --web',
    },
    dependencies: {
      '@rangular/runtime': fileDepOf(appDir, path.join(repoRoot, 'packages', 'runtime')),
      '@rangular/ui': fileDepOf(appDir, path.join(repoRoot, 'packages', 'ui')),
      expo: '~58.0.0',
      'expo-document-picker': '~58.0.5',
      'expo-image-picker': '~58.0.10',
      react: '19.3.0',
      'react-native': '0.88.1',
      'react-native-svg': '15.16.0',
    },
    devDependencies: {
      '@babel/core': '^7.25.2',
      'babel-preset-expo': '~58.0.0',
      typescript: '~5.9.2',
    },
  }, null, 2) + '\n');
  write('app.json', JSON.stringify({
    expo: {
      name: appName,
      slug: appName,
      version: '1.0.0',
      scheme: appName,
      orientation: 'portrait',
      platforms: ['ios', 'android'],
    },
  }, null, 2) + '\n');
  write('babel.config.js', `module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
`);
  write('metro.config.js', `const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

// Monorepo layout: this app lives outside the Rangular repo's package
// directories but depends on them through file: specifiers, so Metro
// must watch the repo root and resolve modules from both node_modules.
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '${relToRepo}');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
`);
  write('tsconfig.json', JSON.stringify({
    extends: 'expo/tsconfig.base',
    compilerOptions: { strict: true },
  }, null, 2) + '\n');
  write('App.tsx', `import React from 'react';
import AppRoot from './src/AppRoot';

// Hardware back (Android) and Rangular routing: the compiled root
// module keeps its navigator private, so App.tsx cannot call back()
// on it yet. In-app back navigation is a template concern today (a
// button that navigates where the user came from); the app README's
// "Back behaviour" section states exactly what works and what does
// not. Nothing is wired here that is not real.
export default function App() {
  return <AppRoot />;
}
`);
  write(path.join('src', 'app.component.ts'), STARTER_TS);
  write(path.join('src', 'app.component.html'), STARTER_HTML);
  write('.gitignore', 'node_modules\n.expo\ndist\n');

  // Compile the starter now, with the real compiler, so src/AppRoot.tsx
  // is genuine output for the starter source.
  const entryAbs = path.join(srcDir, 'app.component.ts');
  const { tsSource, resolveFile, resolveImport, rootDir } = readComponent(entryAbs);
  const result = compileComponent({ tsSource, fileName: entryAbs, resolveFile, resolveImport, rootDir });
  for (const d of result.diagnostics) console.error(formatDiagnostic(d, entryAbs));
  if (hasErrors(result.diagnostics) || !result.code) {
    console.error('rangular: the starter component did not compile; the scaffold is incomplete');
    process.exit(1);
  }
  write(path.join('src', 'AppRoot.tsx'), result.code);

  write('README.md', `# ${appName}

A real Expo app scaffolded by Rangular (Stage 12). You write
Angular-style components in \`src/\`; the Rangular compiler turns them
into React Native code, and Expo runs the result.

## Run it on a phone

    npm install
    npx expo start

Then scan the QR code with Expo Go. Your component is
\`src/app.component.ts\` (with its template
\`src/app.component.html\`); the compiled output Expo loads is
\`src/AppRoot.tsx\`, generated from it at scaffold time.

## Recompile after editing the component

Run this from the Rangular repo root (the folder you cloned; every
path in the command is relative to that folder):

    node dist/packages/cli/src/cli.js build ${path.relative(repoRoot, entryAbs).split(path.sep).join('/')} --out ${path.relative(repoRoot, path.join(srcDir, 'AppRoot.tsx')).split(path.sep).join('/')}

Or run the same command with \`watch\` instead of \`build\` and it
recompiles on every save.

## Preview in a browser, no phone needed

The dev preview renders any app component as a phone-width page you
can click through. From the Rangular repo root:

    node dist/packages/cli/src/cli.js preview ${path.relative(repoRoot, entryAbs).split(path.sep).join('/')} --out ${path.relative(repoRoot, path.join(appDir, 'preview.html')).split(path.sep).join('/')}

Then open \`preview.html\` in this app folder in a browser. The
preview is interactive: handlers run and lists respond, exactly as
the generated app behaves.

## How the pieces fit

- \`package.json\` depends on \`@rangular/ui\` and
  \`@rangular/runtime\` through \`file:\` specifiers that point at the
  Rangular checkout this app was scaffolded from, so the app always
  builds against that checkout. Move the app and those paths move
  with it only if the relative layout is kept; edit them if you
  relocate the app on its own.
- The Expo pins (expo ~58, react 19.3, react-native 0.88,
  react-native-svg 15.16, expo-image-picker ~58.0.10,
  expo-document-picker ~58.0.5, babel-preset-expo ~58) are the Expo
  SDK 58 set, chosen for mutual compatibility. The set moved from
  SDK 54 to SDK 58 because the store build of Expo Go supports
  SDK 58 only. They were selected from the SDK's published
  compatibility, not installed or device-verified when this
  scaffold was written.
- \`expo-image-picker\` and \`expo-document-picker\` are required
  dependencies, not extras: \`RgFilePicker\` in \`@rangular/ui\`
  names both in literal requires, and Metro resolves every literal
  require when the app bundles, so the bundle fails without either
  one. Keep both even if this app never shows a file picker.
- \`metro.config.js\` is the standard monorepo config: it watches the
  Rangular repo root (so the file: packages resolve) and looks for
  node_modules in both the app and the repo root.

## Back behaviour

The starter has one screen, so there is nothing to go back to. When
an app grows a router (see the routing section of the repo's
docs/VIBE_CODING.md), navigation inside the app is complete:
routerLink and the Router service work. The Android hardware back
button is not wired to the Rangular navigator in this version: the
compiled root module keeps its navigator private, so App.tsx cannot
call back() on it honestly, and this scaffold does not pretend
otherwise. In-app back affordances (a Back button that navigates to
the previous screen explicitly) work today; exporting the navigator
for hardware back is future work.

## What was verified

The scaffold's structure and the starter's compilation are covered
by the Rangular test suite. An actual Expo Go launch on a device was
not run in the environment that wrote this scaffold; your first
\`npx expo start\` is the device proof.
`);
  console.log(`Created an Expo app in ${appDir}`);
  if (isBareName && !process.cwd().startsWith(repoRoot)) {
    console.log(`Note: a bare name places the app under the Rangular repo's apps folder (${appDir}), not the current directory.`);
  }
  console.log(`Run it: cd ${appDir} && npm install && npx expo start`);
}

/** `rangular init <dir>`: scaffold a starter project (Stage 5). */
function initProject(dirArg: string): void {
  const dir = path.resolve(dirArg);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
    console.error(formatDiagnostic({
      severity: 'error',
      code: 'CLI_INIT_NOT_EMPTY',
      message: `Cannot init into '${dirArg}': the directory is not empty`,
      fix: 'Pick a new directory name, or empty the directory first, e.g. rangular init my-app',
    }));
    process.exit(1);
  }
  const srcDir = path.join(dir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'app.component.ts'), `import { Component } from '@angular/core';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
})
export class AppComponent {
  title = 'Welcome to Rangular';
  taps = 0;

  start() {
    this.taps++;
  }
}
`);
  fs.writeFileSync(path.join(srcDir, 'app.component.html'), `<screen>
  <appbar title="Rangular"></appbar>
  <h1>{{ title }}</h1>
  <card>
    <h3>Your first screen</h3>
    <p>You wrote Angular. This screen is React Native.</p>
    <button (click)="start()">Get started</button>
    <p *ngIf="taps > 0">Started {{ taps }} times</p>
  </card>
</screen>
`);
  fs.writeFileSync(path.join(dir, 'README.md'), `# ${path.basename(dir)}

A starter Rangular project. You write Angular-style components in
\`src/\`, and the Rangular compiler turns them into React Native code.

## Build the starter screen

From the Rangular repo root (the folder you cloned), run:

    node dist/packages/cli/src/cli.js build ${dirArg}/src/app.component.ts --out ${dirArg}/src/app.component.tsx

## Preview it in a browser

    node dist/packages/cli/src/cli.js preview ${dirArg}/src/app.component.ts --out ${dirArg}/preview.html

Then open \`${dirArg}/preview.html\` in any browser. The preview is
interactive: the Get started button works, and the Light and Dark toggle
in the corner flips the whole screen between themes.

## Keep it building while you edit

    node dist/packages/cli/src/cli.js watch ${dirArg}/src/app.component.ts --out ${dirArg}/src/app.component.tsx

Watch recompiles on every save and prints OK or the diagnostics.
Press Ctrl+C to stop.

## Check the polish

    node dist/packages/cli/src/cli.js doctor ${dirArg}/src/app.component.ts

Doctor reports polish problems (raw hex colours, off-scale values,
loose text, small tap targets) with the fix for each.
`);
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\ndist\n');
  console.log(`Created a starter Rangular project in ${dirArg}`);
  console.log(`Build it: node dist/packages/cli/src/cli.js build ${dirArg}/src/app.component.ts --out ${dirArg}/src/app.component.tsx`);
}

/** `rangular watch`: compile now, then recompile on every change (Stage 5). */
function startWatch(target: string, out: string, routesSpecifier: string | undefined): void {
  let watchers: fs.FSWatcher[] = [];
  let timer: NodeJS.Timeout | undefined;
  let compiling = false;
  let queued = false;

  const closeWatchers = (): void => {
    for (const w of watchers) { try { w.close(); } catch { /* already closed */ } }
    watchers = [];
  };

  const arm = (files: string[]): void => {
    closeWatchers();
    const dirs = new Set<string>();
    for (const f of files) {
      const abs = path.resolve(f);
      if (fs.existsSync(abs)) {
        try { watchers.push(fs.watch(abs, () => schedule())); } catch { /* unsupported fs */ }
      } else {
        dirs.add(path.dirname(abs));
      }
    }
    // A resolved file that does not exist yet (a template about to be
    // created) is covered by watching its directory instead.
    for (const d of dirs) {
      if (fs.existsSync(d)) {
        try { watchers.push(fs.watch(d, () => schedule())); } catch { /* unsupported fs */ }
      }
    }
  };

  const compileOnce = (): void => {
    if (compiling) { queued = true; return; }
    compiling = true;
    try {
      const stamp = new Date().toISOString();
      const { tsSource, resolveFile, resolveImport, absPath, rootDir } = readComponent(target);
      const result = compileComponent({ tsSource, fileName: absPath, resolveFile, resolveImport, rootDir, routesSpecifier });
      for (const d of result.diagnostics) console.error(formatDiagnostic(d, absPath));
      if (hasErrors(result.diagnostics)) {
        const errors = result.diagnostics.filter((d) => d.severity === 'error').length;
        console.log(`[${stamp}] FAILED ${target} (${errors} error${errors === 1 ? '' : 's'})`);
      } else {
        fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
        fs.writeFileSync(out, result.code);
        console.log(`[${stamp}] OK ${out}`);
      }
      // The watch set is re-resolved after every compile, so imports or
      // templates added by an edit start being watched immediately.
      arm(result.files.length ? result.files : [absPath]);
    } finally {
      compiling = false;
      if (queued) { queued = false; schedule(); }
    }
  };

  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(compileOnce, 100);
  };

  compileOnce();
  console.log(`Watching ${target} for changes, Ctrl+C to stop`);
  process.on('SIGINT', () => {
    closeWatchers();
    console.log('\nWatch stopped');
    process.exit(0);
  });
}

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'catalog') {
    const outDir = option(args, '--out') ?? '.';
    const catalog = buildCatalog();
    fs.mkdirSync(path.resolve(outDir), { recursive: true });
    const jsonPath = path.join(outDir, 'catalog.json');
    const mdPath = path.join(outDir, 'catalog.md');
    fs.writeFileSync(jsonPath, JSON.stringify(catalog, null, 2) + '\n');
    fs.writeFileSync(mdPath, renderCatalogMarkdown(catalog));
    console.log(`Wrote ${jsonPath} and ${mdPath} (${catalog.tags.length} tags, ${catalog.primitives.length} primitives, ${catalog.diagnostics.length} diagnostic codes)`);
    return;
  }

  if (command === 'init') {
    const dir = args.slice(1).find((a) => !a.startsWith('--'));
    if (!dir) fail('usage: rangular init <dir> [--app]');
    if (args.includes('--app')) initApp(dir);
    else initProject(dir);
    return;
  }

  const target = args[1];
  const rest = args.slice(2);
  if (!command || !target) {
    console.log(USAGE);
    process.exit(command ? 2 : 0);
  }
  const json = rest.includes('--json');

  if (command === 'ast') {
    const abs = path.resolve(target);
    if (!fs.existsSync(abs)) fail(`file not found: ${target}`);
    const { root, diagnostics } = parseTemplate(fs.readFileSync(abs, 'utf8'));
    for (const d of diagnostics) console.error(formatDiagnostic(d, abs));
    console.log(printAst(root));
    process.exit(hasErrors(diagnostics) ? 1 : 0);
  }

  if (command === 'watch') {
    const out = option(rest, '--out');
    if (!out) fail(`--out <file> is required for 'watch'`);
    const { absPath: watchAbs } = readComponent(target);
    startWatch(target, out, routesSpecifierFor(watchAbs, option(rest, '--routes')));
    return;
  }

  if (command === 'doctor') {
    const { tsSource, resolveFile, resolveImport, absPath, rootDir } = readComponent(target);
    const result = compileComponent({
      tsSource, fileName: absPath, resolveFile, resolveImport, rootDir,
      routesSpecifier: routesSpecifierFor(absPath, option(rest, '--routes')),
    });
    const styleTexts = doctorStyleTexts(result, absPath, (abs) => (
      withinRoot(rootDir, abs) && fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : undefined
    ));
    const findings = runDoctor({ result, entryFile: absPath, styleTexts });
    const all = [...result.diagnostics, ...findings];
    if (json) {
      printJson({
        ok: !hasErrors(all),
        file: path.basename(target),
        diagnostics: all.map(toJsonDiagnostic),
      });
      process.exit(hasErrors(all) ? 1 : 0);
    }
    for (const d of all) console.error(formatDiagnostic(d, absPath));
    if (hasErrors(result.diagnostics)) process.exit(1);
    if (!findings.length) {
      console.log(`doctor: clean, ${target} has no polish findings`);
    } else {
      console.log(`doctor: ${findings.length} finding${findings.length === 1 ? '' : 's'} in ${target} (warnings do not fail the run)`);
    }
    process.exit(hasErrors(findings) ? 1 : 0);
  }

  if (command === 'build' || command === 'preview') {
    const out = option(rest, '--out');
    if (!out) fail(`--out <file> is required for '${command}'`);
    const { tsSource, resolveFile, resolveImport, absPath, rootDir } = readComponent(target);
    const routesSpecifier = routesSpecifierFor(absPath, option(rest, '--routes'));
    if (command === 'build') {
      const sourceMap = rest.includes('--source-map');
      const result = compileComponent({ tsSource, fileName: absPath, resolveFile, resolveImport, sourceMap, rootDir, routesSpecifier });
      const ok = !hasErrors(result.diagnostics);
      const writeOut = (): void => {
        fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
        if (sourceMap && result.sourceMap) {
          result.sourceMap.file = path.basename(out);
          const code = result.code.replace(/\n?$/, '\n') + `//# sourceMappingURL=${path.basename(out)}.map\n`;
          fs.writeFileSync(out, code);
          fs.writeFileSync(`${out}.map`, JSON.stringify(result.sourceMap, null, 2) + '\n');
        } else {
          fs.writeFileSync(out, result.code);
        }
      };
      if (json) {
        if (ok) writeOut();
        printJson({
          ok,
          file: path.basename(target),
          ...(ok ? { outFile: out } : {}),
          ...(ok && sourceMap ? { sourceMapFile: `${out}.map` } : {}),
          diagnostics: result.diagnostics.map(toJsonDiagnostic),
        });
        process.exit(ok ? 0 : 1);
      }
      for (const d of result.diagnostics) console.error(formatDiagnostic(d, absPath));
      if (hasErrors(result.diagnostics)) process.exit(1);
      writeOut();
      console.log(`Wrote ${out} (${result.code.split('\n').length} lines)`);
      return;
    }
    // preview, through the full compiler so child components and services
    // resolved from imports render exactly as they compile (Stage 3).
    const compiled = compileComponent({ tsSource, fileName: absPath, resolveFile, resolveImport, rootDir, routesSpecifier });
    const allDiags = compiled.diagnostics;
    if (!compiled.component || !compiled.ast || hasErrors(allDiags)) {
      if (json) {
        printJson({ ok: false, file: path.basename(target), diagnostics: allDiags.map(toJsonDiagnostic) });
        process.exit(1);
      }
      for (const d of allDiags) console.error(formatDiagnostic(d, absPath));
      process.exit(1);
    }
    const component = compiled.component;
    const html = renderPreview(component, compiled.ast, {
      children: compiled.children,
      services: compiled.services,
      routes: compiled.routes,
      pipes: compiled.pipes,
      directives: compiled.directives,
    });
    if (json) {
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.writeFileSync(out, html);
      printJson({
        ok: true,
        file: path.basename(target),
        outFile: out,
        diagnostics: allDiags.map(toJsonDiagnostic),
      });
      process.exit(0);
    }
    for (const d of allDiags) console.error(formatDiagnostic(d, absPath));
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, html);
    console.log(`Wrote ${out} (preview for ${component.selector ?? component.className})`);
    return;
  }

  fail(`unknown command '${command}'`);
}

main();
