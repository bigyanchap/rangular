# code-block

**Intent**

Show how a code sample is presented: a `<code>` block compiles to
the `RgCode` primitive, a dark editor surface with a monospace
face, so commands and snippets read as code and never as body
text. The surface is dark in both themes, the way editors look.

**Source**

`code-block.component.ts` declares the component;
`code-block.component.html` is:

```html
<screen>
  <appbar title="Code Block"></appbar>
  <h2>Code looks like code</h2>
  <p>A code block shows a line the way an editor does: a dark surface and a monospace face, in both themes, so a command or a snippet never reads as body text.</p>
  <label>Install the CLI</label>
  <code>npm install -g @rangular/cli</code>
  <label>Run one lesson from the tutorial</label>
  <code>git clone https://github.com/bigyanchap/rangular-tutorial</code>
  <p>Long lines scroll sideways instead of wrapping, the way an editor treats a line as one line.</p>
  <code>node dist/packages/cli/src/cli.js build examples/code-block/code-block.component.ts --out examples/code-block/code-block.component.tsx</code>
</screen>
```

**What it compiles to**

Each `<code>` block becomes one `RgCode` (from `@rangular/ui`):
a view on the `codeSurface` token carrying a horizontal
`ScrollView` whose text uses the platform monospace face (Menlo
on iOS, the system monospace on Android) in the `codeText`
colour. The HTML preview paints a `<pre class="code">` with the
same tokens and a monospace stack, and long lines scroll
horizontally there too.

**Rules used**

- Every template tag resolves through the one tag→component
  mapping (`catalog.md`): `code → RgCode`.
- The block's content is projected text; interpolation works
  inside it like in any text block, so a lesson can bind a code
  string from the class with `{{ lesson.code }}`.
- The editor colours are theme tokens (`codeSurface`,
  `codeText`), identical in light and dark on purpose: an editor
  surface stays dark.
- Code samples written literally in a template must avoid a raw
  `<` or `{{` in the sample itself; those are markup and
  interpolation to the parser. Bind such samples from the class
  instead.

**Common mistakes**

- **Putting a code sample in a `p`.** Body text wraps and reads
  as prose; the point of the block is that code looks like code.
- **Expecting the block to wrap long lines.** It never wraps: a
  line is one line, and the block scrolls horizontally, in the
  app and in the preview alike.
- **Hand-editing `code-block.component.tsx` or `preview.html`.**
  They are generated golden files. Change the `.ts`/`.html` and
  regenerate with the CLI `build` / `preview` commands, or the
  golden test will fail.
