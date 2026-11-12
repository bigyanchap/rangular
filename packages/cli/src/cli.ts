#!/usr/bin/env node
/**
 * Rangular CLI:
 *   rangular build <component.ts> --out <file.tsx> [--json]
 *   rangular ast <template.html>
 *   rangular preview <component.ts> --out <file.html> [--json]
 *   rangular catalog [--out <dir>]
 *
 * Run from the compiled output: node dist/packages/cli/src/cli.js ...
 *
 * --json prints ONE JSON object to stdout ({ ok, outFile?, diagnostics })
 * and nothing else, so AI tools and scripts can consume diagnostics and
 * self-correct. Human diagnostics (with `fix:` lines) go to stderr.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  buildCatalog,
  compileComponent,
  Diagnostic,
  formatDiagnostic,
  hasErrors,
  parseTemplate,
  printAst,
  renderCatalogMarkdown,
  renderPreview,
} from '../../compiler/src/index';

function fail(message: string): never {
  console.error(`rangular: ${message}`);
  process.exit(2);
}

function option(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function readComponent(componentFile: string) {
  const abs = path.resolve(componentFile);
  if (!fs.existsSync(abs)) fail(`file not found: ${componentFile}`);
  const tsSource = fs.readFileSync(abs, 'utf8');
  const dir = path.dirname(abs);
  const resolveFile = (rel: string) => {
    const p = path.resolve(dir, rel);
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
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return { source: fs.readFileSync(candidate, 'utf8'), fileName: candidate };
      }
    }
    return undefined;
  };
  return { tsSource, resolveFile, resolveImport, absPath: abs };
}

function toJsonDiagnostic(d: Diagnostic): Record<string, unknown> {
  const out: Record<string, unknown> = { severity: d.severity, code: d.code, message: d.message };
  if (d.line !== undefined) out.line = d.line;
  if (d.column !== undefined) out.column = d.column;
  if (d.fix !== undefined) out.fix = d.fix;
  return out;
}

function printJson(payload: Record<string, unknown>): void {
  console.log(JSON.stringify(payload, null, 2));
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

  const target = args[1];
  const rest = args.slice(2);
  if (!command || !target) {
    console.log('Usage:\n  rangular build <component.ts> --out <file.tsx> [--json]\n  rangular ast <template.html>\n  rangular preview <component.ts> --out <file.html> [--json]\n  rangular catalog [--out <dir>]');
    process.exit(command ? 2 : 0);
  }
  const json = rest.includes('--json');

  if (command === 'ast') {
    const abs = path.resolve(target);
    if (!fs.existsSync(abs)) fail(`file not found: ${target}`);
    const { root, diagnostics } = parseTemplate(fs.readFileSync(abs, 'utf8'));
    for (const d of diagnostics) console.error(formatDiagnostic(d));
    console.log(printAst(root));
    process.exit(hasErrors(diagnostics) ? 1 : 0);
  }

  if (command === 'build' || command === 'preview') {
    const out = option(rest, '--out');
    if (!out) fail(`--out <file> is required for '${command}'`);
    const { tsSource, resolveFile, resolveImport, absPath } = readComponent(target);
    if (command === 'build') {
      const result = compileComponent({ tsSource, fileName: absPath, resolveFile, resolveImport });
      if (json) {
        const ok = !hasErrors(result.diagnostics);
        if (ok) {
          fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
          fs.writeFileSync(out, result.code);
        }
        printJson({
          ok,
          file: path.basename(target),
          ...(ok ? { outFile: out } : {}),
          diagnostics: result.diagnostics.map(toJsonDiagnostic),
        });
        process.exit(ok ? 0 : 1);
      }
      for (const d of result.diagnostics) console.error(formatDiagnostic(d));
      if (hasErrors(result.diagnostics)) process.exit(1);
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.writeFileSync(out, result.code);
      console.log(`Wrote ${out} (${result.code.split('\n').length} lines)`);
      return;
    }
    // preview, through the full compiler so child components and services
    // resolved from imports render exactly as they compile (Stage 3).
    const compiled = compileComponent({ tsSource, fileName: absPath, resolveFile, resolveImport });
    const allDiags = compiled.diagnostics;
    if (!compiled.component || !compiled.ast || hasErrors(allDiags)) {
      if (json) {
        printJson({ ok: false, file: path.basename(target), diagnostics: allDiags.map(toJsonDiagnostic) });
        process.exit(1);
      }
      for (const d of allDiags) console.error(formatDiagnostic(d));
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
    for (const d of allDiags) console.error(formatDiagnostic(d));
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, html);
    console.log(`Wrote ${out} (preview for ${component.selector ?? component.className})`);
    return;
  }

  fail(`unknown command '${command}'`);
}

main();
