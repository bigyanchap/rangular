import { Component } from '@angular/core';

/**
 * The code block lesson: a `<code>` block shows a line the way an
 * editor does, on a dark surface in a monospace face, in both
 * themes, so a command or a snippet never reads as body text.
 * Long lines scroll horizontally inside the block instead of
 * wrapping, the way an editor treats a line as one line.
 */
@Component({
  selector: 'app-code-block',
  templateUrl: './code-block.component.html',
})
export class CodeBlockComponent {}
