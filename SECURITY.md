# Security

Rangular is a compiler: it reads source files and writes generated code
and a preview page. This file records the security audit of that surface,
what was tested, what was found, and what was fixed.

**Audit date:** 2026-11-12 (after Stage 5, before the v1 push).
**Scope:** the compiler (`packages/compiler`), the CLI
(`packages/cli`), the runtime helpers (`packages/runtime`), the shipped
UI source (`packages/ui`), and the generated preview page.
**Method:** every vector below was tested with a small adversarial
fixture run through the real compiler and CLI, and the actual output
was used as the evidence. Fixes landed at the source with regression
tests in `tests/security.test.ts`.

## The trust model in one paragraph

The component author is trusted to write code: interpolation
expressions, method bodies and field initializers are their code by
design and are compiled as code. What must never happen is for *data*
to become code: plain template text, static attribute values and field
values are data, and the compiler keeps them inside their literal
context. The second boundary is the filesystem: a component that a
project takes in from elsewhere must not silently pull files from
outside the project into build output, previews or source maps.

## Findings

### Fixed

1. **Plain text could become a JSX expression (High).**
   Template text was emitted raw into the generated TSX, so text like
   `Price: { notCode }` produced `{ notCode }` as a live expression
   container, and a stray `}` broke the output. Fix: a static text part
   containing `{`, `}`, `<` or `>` is now emitted as a `{'...'}`
   string expression. Plain text without those characters is emitted
   exactly as before.
   (`packages/compiler/src/codegen/generate.ts`)

2. **A quote in a static attribute value could inject props (High).**
   A single-quoted attribute whose value contains a double quote, for
   example `title='x" onPress={() => pwned()} y="z'`, was emitted
   verbatim and the generated element gained a real injected
   `onPress` prop. Fix: static attribute values are entity-escaped
   (`&` and `"`) when emitted, so the payload stays inert text inside
   the attribute string. (Same file.)

3. **A field value could close the preview's script block (High).**
   The preview page serializes field values as JSON inside an inline
   `<script>` block. A value containing `</script>` ended the block
   and injected a live script element into the page. The
   server-rendered first paint already escaped values correctly; the
   script serialization did not. Fix: all JSON embedded in the script
   block now goes through `jsonForScript`, which escapes `<` and the
   JS line terminators. The page parses exactly the same values.
   (`packages/compiler/src/preview/renderPreview.ts`)
   The in-page runtime itself was checked and is safe: it builds DOM
   with `createElement` and `textContent`, never `innerHTML` with
   data (the one `innerHTML` assignment clears the mount node with a
   constant empty string).

4. **Author strings could break out of generated comments (Medium).**
   A selector containing a newline ended the generated file's header
   comment and put the rest of the string on its own code line, and a
   structural directive expression containing `*/` ended the TODO
   block comments codegen emits. Fix: strings placed inside generated
   comments are flattened (newlines become spaces, `*/` becomes
   `* /`) at every comment site: the header line, the structural TODO
   comments, and the field and DI TODO line comments.
   (`packages/compiler/src/codegen/generate.ts`)

5. **Paths could escape the project (Medium).**
   `templateUrl`, `styleUrls` and relative imports were resolved with
   no boundary: `templateUrl: '../secret.html'`, an absolute path, or
   an import of `../evil` read the file and embedded its contents in
   the generated code and preview (and, with `--source-map`, in the
   map's `sourcesContent`). Fix: the boundary rule below. The CLI
   resolvers refuse to read outside files at all, and the compiler
   independently reports a `CMP_PATH_ESCAPE` error and uses nothing
   from outside. (`packages/cli/src/cli.ts`,
   `packages/compiler/src/compile.ts`)

6. **A `__proto__` key in a literal changed the object's prototype (Low).**
   The literal evaluator built objects by assignment, so
   `{ '__proto__': { ... } }` set the built object's prototype instead
   of creating an own property. It could not pollute
   `Object.prototype` (verified), but the semantics were wrong. Fix:
   properties are created with `Object.defineProperty`, matching
   `JSON.parse` semantics. (`packages/compiler/src/template/literal.ts`)

7. **CSS class selector keys were unvalidated (Low).**
   Element selectors were checked against a pattern but class keys
   were not, while class keys are emitted as StyleSheet keys in
   generated code. Fix: class keys must now be plain identifiers, or
   the rule is skipped with a `CSS_SELECTOR` warning, the same
   treatment element selectors already had.
   (`packages/compiler/src/style/css.ts`)

### Checked and not findings

- **Dangerous primitives:** no `eval`, no `new Function`, no
  `child_process` anywhere in the product packages. The preview's
  `__eval` and the compiler's expression evaluator are AST tree
  walkers over the parsed expression subset, they never execute
  source text. (`child_process` appears only in tests, to run the
  CLI.) Template expressions cannot reach globals through the
  evaluator beyond what the component scope holds.
- **Prototype pollution through the runtime:** the DI `Container`
  stores providers in a `Map`, so a token named `__proto__` is an
  ordinary entry (verified). `ReactiveService` keeps listeners in a
  `Set`. Fetched JSON from `HttpClient` is handed to the subscriber
  as a whole value, never merged into shared state. The one
  `Object.assign` in the codebase (doctor's style merge) only ever
  copies the fixed, compiler-validated CSS property set.
- **Dependencies and scripts:** the whole repo depends only on
  `typescript` (runtime) and `@types/node` (dev). The root
  `package.json` has only `build`, `clean` and `test` scripts; the
  package files have no scripts at all. There are no `install`,
  `prepare` or other lifecycle scripts.
- **HttpClient:** it wraps the platform `fetch` with its defaults
  (redirects followed, no credentials handling of its own) and parses
  responses as JSON. That is the documented Angular-shaped behaviour,
  noted here rather than redesigned.

### Accepted risks, with reasons

- **`--out` paths are the user's own choice.** The CLI writes build
  output, previews, catalogs and watch output wherever `--out`
  points. That is the operator's explicit instruction on their own
  machine, the same as any compiler's output flag, so no boundary is
  applied to outputs. The boundary below governs what the compiler
  *reads* on a source file's say-so, which is the direction data can
  leak.
- **`rangular init` writes a fixed starter set** into the directory
  it is given and refuses a non-empty directory. The file names and
  contents are constants, nothing is derived from input.
- **Source maps embed source contents** (`sourcesContent`) for the
  files a compilation legitimately read, by design, so debuggers can
  show the original source. Maps are written only with
  `--source-map`, and the path boundary now guarantees those contents
  come from inside the project.

## Stage 12 re-audit (2026-11-12)

The closing re-audit re-ran the Stage 5 adversarial method against the
current compiler, covering the original fixture classes (still green)
plus every surface Stages 6 to 12 added. Each item below was run
through the real compiler or CLI with a hostile fixture; the outputs
are the evidence, and the fixtures are pinned as regression tests in
`tests/security.test.ts` and `tests/stage12.test.ts`.

### Fixed in this audit

1. **A static `minlength` / `maxlength` attribute could inject code
   (High).** Validator arguments that arrived as static attributes
   were emitted raw into the generated `Validators.minLength(...)`
   call, so `minlength="3); pwned();//"` broke out of the call and
   injected arbitrary code into the generated component. Binding-form
   arguments (`[minlength]="expr"`) are the author's own expressions
   and were never the issue; static attribute text is data. Fix: a
   static value must be all digits to become an argument; anything
   else drops that validator with a `GEN_VALIDATOR_ARG` warning.
   Static `pattern` values were checked in the same pass: they were
   already emitted through `JSON.stringify` and are safe.
   (`packages/compiler/src/template/forms.ts`,
   `packages/compiler/src/codegen/generate.ts`)

### Checked, no finding

- **Icon names.** A static `name` with quotes and markup is not in
  the icon set, so it fails with `GEN_ICON_UNKNOWN` and never reaches
  the output as markup. Bound names are the author's expressions.
- **routerLink strings.** A value carrying quotes and braces is
  emitted as one escaped string argument to the navigate call; the
  payload survives only inside the quoted string.
- **Routes file contents.** The routes file is author code, but its
  string data (paths, redirects) is re-emitted as a JSON array in the
  generated navigator construction and through `jsonForScript` in the
  preview. A path of `x'; pwned();//` round-trips through
  `JSON.parse` as inert data in both.
- **Datetime values.** A static `value` with a quote is emitted
  entity-escaped in the attribute string, the Stage 5 discipline, and
  the picker parses values as ISO data, never as code.
- **Autocomplete options.** Options are component data; an option
  containing `</script><script>alert(1)</script>` reaches the preview
  only in `jsonForScript`-escaped form, with exactly one script block
  in the page.
- **Badge values.** A static `badge` with a quote is entity-escaped
  into the attribute string like any other static attribute.
- **Custom pipe names.** A `@Pipe` name is data everywhere it lands:
  the preview serializes the pipe registry through `jsonForScript`
  (a name containing a script closer stays escaped), template pipe
  uses parse as identifiers (a hostile name cannot be written as a
  pipe use at all), and an unregistered name is a `PIPE_UNKNOWN`
  error. Pipe class and instance names in generated code derive from
  the class name, which is the author's own identifier.
- **Projection children.** Content written inside a child component
  tag is template content and gets the same treatment as any template
  text: brace-bearing text is emitted as a string expression and
  painted as text in the preview.
- **Attribute directives.** The directive subset extracts style
  assignments from the directive class (author code) and substitutes
  host input values as expressions or JSON strings; static attribute
  values bound to inputs are data and are emitted as quoted strings.
- **Scaffold paths.** `rangular init --app` with a bare name writes
  only under `<repoRoot>/apps/<name>`, and bare names are restricted
  to letters, digits, dot, underscore and hyphen, with `.` and `..`
  refused outright (`CLI_INIT_UNSAFE`). An explicit path is the
  caller's own chosen target; every file the scaffold writes is
  joined under the resolved target directory, and a non-empty target
  is refused (`CLI_INIT_NOT_EMPTY`) rather than overwritten.

## The file access boundary rule

When the CLI compiles a component, the project root is the nearest
ancestor directory of the entry component file that contains a
`package.json`; if none is found, the entry file's own directory is
the root. Every `templateUrl`, `styleUrl` and relative import that a
compilation resolves must stay inside that root. A path that escapes
(following `..` segments or an absolute path) is refused: the file is
not read, compilation fails with a `CMP_PATH_ESCAPE` error naming the
path and the root, and nothing from the file reaches the output.

Library callers using `compileComponent` directly opt into the same
rule by passing `rootDir`. Callers who omit it keep the previous
behaviour, and the boundary then applies only to absolute file keys:
bare in-memory keys from test resolvers are names, not paths.

Inside the project, `..` segments are fine: a component in `src/` may
reference `../shared/base.css` as long as the result stays under the
root.

## Reporting

This is a young, single-maintainer project. If you find a security
problem, open an issue on the GitHub repository describing the
component, the input you gave it, and the output that surprised you.
A small fixture that reproduces the problem is the most helpful
thing you can include, it is exactly how the findings above were
confirmed and fixed.
