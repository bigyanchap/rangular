#!/usr/bin/env node
/**
 * Rangular CLI (Stage 0+1):
 *   rangular build <component.ts> --out <file.tsx>
 *   rangular ast <template.html>
 *   rangular preview <component.ts> --out <file.html>
 *
 * Run from the compiled output: node dist/packages/cli/src/cli.js ...
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  compileComponent,
  formatDiagnostic,
  hasErrors,
  parseComponent,
  parseTemplate,
  printAst,
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
  return { tsSource, resolveFile };
}

function main(): void {
  const [command, target, ...rest] = process.argv.slice(2);
  if (!command || !target) {
    console.log('Usage:\n  rangular build <component.ts> --out <file.tsx>\n  rangular ast <template.html>\n  rangular preview <component.ts> --out <file.html>');
    process.exit(command ? 2 : 0);
  }

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
    const { tsSource, resolveFile } = readComponent(target);
    if (command === 'build') {
      const result = compileComponent({ tsSource, fileName: path.basename(target), resolveFile });
      for (const d of result.diagnostics) console.error(formatDiagnostic(d));
      if (hasErrors(result.diagnostics)) process.exit(1);
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.writeFileSync(out, result.code);
      console.log(`Wrote ${out} (${result.code.split('\n').length} lines)`);
      return;
    }
    // preview
    const { component, diagnostics: cDiags } = parseComponent(tsSource, path.basename(target));
    if (!component) {
      for (const d of cDiags) console.error(formatDiagnostic(d));
      process.exit(1);
    }
    let templateSource = component.template;
    if (!templateSource && component.templateUrl) templateSource = resolveFile(component.templateUrl);
    if (!templateSource) fail('no template could be resolved for preview');
    const { root, diagnostics: tDiags } = parseTemplate(templateSource);
    for (const d of tDiags) console.error(formatDiagnostic(d));
    if (hasErrors(tDiags)) process.exit(1);
    const html = renderPreview(component, root);
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, html);
    console.log(`Wrote ${out} (preview for ${component.selector ?? component.className})`);
    return;
  }

  fail(`unknown command '${command}'`);
}

main();
