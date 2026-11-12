#!/usr/bin/env node
/**
 * Rangular CLI:
 *   rangular build <component.ts> --out <file.tsx> [--json] [--source-map]
 *   rangular ast <template.html>
 *   rangular preview <component.ts> --out <file.html> [--json]
 *   rangular catalog [--out <dir>]
 *   rangular watch <component.ts> --out <file.tsx>
 *   rangular init <dir>
 *   rangular doctor <component.ts> [--json]
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
  '  rangular build <component.ts> --out <file.tsx> [--json] [--source-map]',
  '  rangular ast <template.html>',
  '  rangular preview <component.ts> --out <file.html> [--json]',
  '  rangular catalog [--out <dir>]',
  '  rangular watch <component.ts> --out <file.tsx>',
  '  rangular init <dir>',
  '  rangular doctor <component.ts> [--json]',
].join('\n');

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
  styles: [\`
    h1 { color: #0b57d0; margin-bottom: 8px; }
  \`],
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
  <appbar title="Rangular" search="Search"></appbar>
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
function startWatch(target: string, out: string): void {
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
      const result = compileComponent({ tsSource, fileName: absPath, resolveFile, resolveImport, rootDir });
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
    const dir = args[1];
    if (!dir) fail('usage: rangular init <dir>');
    initProject(dir);
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
    startWatch(target, out);
    return;
  }

  if (command === 'doctor') {
    const { tsSource, resolveFile, resolveImport, absPath, rootDir } = readComponent(target);
    const result = compileComponent({ tsSource, fileName: absPath, resolveFile, resolveImport, rootDir });
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
    if (command === 'build') {
      const sourceMap = rest.includes('--source-map');
      const result = compileComponent({ tsSource, fileName: absPath, resolveFile, resolveImport, sourceMap, rootDir });
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
    const compiled = compileComponent({ tsSource, fileName: absPath, resolveFile, resolveImport, rootDir });
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
