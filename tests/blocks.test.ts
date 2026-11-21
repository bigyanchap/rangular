import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBlocks,
  serializeBlocks,
  setBlockKind,
  setBlockText,
  toggleBlockDone,
  insertBlockAfter,
  removeBlock,
  moveBlock,
  toggleInline,
  inlineActive,
  parseInline,
  markedSpans,
} from '../packages/ui/src/blocks';

const SEED =
  '# Morning pages\n' +
  'Saw the **sunrise** again, and the air was *clear* and ++quiet++.\n' +
  '- [x] Walked the river road\n' +
  '- [ ] Took photos\n' +
  '- Evening walk\n' +
  '1. Read one chapter';

test('blocks: parse reads every kind from its line prefix', () => {
  const blocks = parseBlocks(SEED);
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ['title', 'body', 'check', 'check', 'bullet', 'number'],
  );
  assert.equal(blocks[0].text, 'Morning pages');
  assert.equal(blocks[2].done, true);
  assert.equal(blocks[3].done, false);
  assert.equal(blocks[5].text, 'Read one chapter');
});

test('blocks: serialize is the exact inverse of parse', () => {
  assert.equal(serializeBlocks(parseBlocks(SEED)), SEED);
  assert.equal(serializeBlocks(parseBlocks('')), '');
  assert.deepEqual(parseBlocks(''), [{ kind: 'body', text: '', done: false }]);
});

test('blocks: heading and quote prefixes, numbered runs renumber', () => {
  const blocks = parseBlocks('## Later\n> A wise line\n4. First\n9. Second\nPlain');
  assert.deepEqual(blocks.map((b) => b.kind), ['heading', 'quote', 'number', 'number', 'body']);
  assert.equal(serializeBlocks(blocks), '## Later\n> A wise line\n1. First\n2. Second\nPlain');
});

test('blocks: kind changes keep the text and drop done outside check', () => {
  const blocks = parseBlocks(SEED);
  const asBullet = setBlockKind(blocks, 2, 'bullet');
  assert.equal(asBullet[2].kind, 'bullet');
  assert.equal(asBullet[2].done, false);
  assert.equal(serializeBlocks(asBullet).split('\n')[2], '- Walked the river road');
  const asTitle = setBlockKind(blocks, 1, 'title');
  assert.equal(serializeBlocks(asTitle).split('\n')[1], '# Saw the **sunrise** again, and the air was *clear* and ++quiet++.');
});

test('blocks: check done toggles, insert and remove keep the rest', () => {
  const blocks = parseBlocks(SEED);
  assert.equal(toggleBlockDone(blocks, 3)[3].done, true);
  assert.equal(toggleBlockDone(blocks, 1)[1].done, false, 'a body block has no done to toggle');
  const grown = insertBlockAfter(blocks, 0);
  assert.equal(grown.length, 7);
  assert.deepEqual(grown[1], { kind: 'body', text: '', done: false });
  const shrunk = removeBlock(blocks, 0);
  assert.equal(shrunk.length, 5);
  assert.equal(shrunk[0].kind, 'body');
  assert.deepEqual(removeBlock(parseBlocks('only'), 0), [{ kind: 'body', text: '', done: false }]);
});

test('blocks: move swaps neighbours and stops at the edges', () => {
  const blocks = parseBlocks(SEED);
  const moved = moveBlock(blocks, 5, -1);
  assert.equal(moved[4].kind, 'number');
  assert.equal(moved[5].kind, 'bullet');
  assert.equal(moveBlock(blocks, 0, -1), blocks);
  assert.equal(moveBlock(blocks, 5, 1), blocks);
});

test('blocks: setBlockText replaces one block only', () => {
  const blocks = setBlockText(parseBlocks(SEED), 1, 'A new line');
  assert.equal(serializeBlocks(blocks).split('\n')[1], 'A new line');
});

test('inline: one press wraps, the next press unwraps', () => {
  const text = 'Saw the sunrise again';
  const wrapped = toggleInline(text, 8, 15, '**');
  assert.equal(wrapped.text, 'Saw the **sunrise** again');
  assert.deepEqual([wrapped.start, wrapped.end], [10, 17]);
  const unwrapped = toggleInline(wrapped.text, wrapped.start, wrapped.end, '**');
  assert.equal(unwrapped.text, text);
  assert.deepEqual([unwrapped.start, unwrapped.end], [8, 15]);
});

test('inline: a selection that includes its marks unwraps too', () => {
  const out = toggleInline('Saw the **sunrise** again', 8, 19, '**');
  assert.equal(out.text, 'Saw the sunrise again');
});

test('inline: a bare caret inside a marked run unwraps the run', () => {
  const out = toggleInline('the air was *clear* today', 15, 15, '*');
  assert.equal(out.text, 'the air was clear today');
  const idle = toggleInline('plain words only', 3, 3, '**');
  assert.equal(idle.text, 'plain words only', 'a caret outside any run changes nothing');
});

test('inline: italic never treats a bold span as its marks', () => {
  const text = 'a **bold** word';
  assert.equal(inlineActive(text, 4, 4, '*'), false);
  assert.equal(inlineActive(text, 4, 4, '**'), true);
  assert.equal(markedSpans(text, '*').length, 0);
  assert.equal(markedSpans(text, '**').length, 1);
});

test('inline: inlineActive follows wraps and carets', () => {
  const text = 'Saw the **sunrise** again';
  assert.equal(inlineActive(text, 10, 17, '**'), true);
  assert.equal(inlineActive(text, 12, 12, '**'), true);
  assert.equal(inlineActive(text, 0, 3, '**'), false);
  assert.equal(inlineActive(text, 10, 17, '*'), false);
});

test('inline: parseInline splits runs and keeps their styles apart', () => {
  const runs = parseInline('Saw the **sunrise** again, *clear* and ++quiet++, ~~gone~~.');
  assert.deepEqual(
    runs.map((r) => [r.text, r.bold, r.italic, r.underline, r.strike]),
    [
      ['Saw the ', false, false, false, false],
      ['sunrise', true, false, false, false],
      [' again, ', false, false, false, false],
      ['clear', false, true, false, false],
      [' and ', false, false, false, false],
      ['quiet', false, false, true, false],
      [', ', false, false, false, false],
      ['gone', false, false, false, true],
      ['.', false, false, false, false],
    ],
  );
  assert.deepEqual(parseInline('no marks at all'), [
    { text: 'no marks at all', bold: false, italic: false, underline: false, strike: false },
  ]);
  assert.deepEqual(parseInline('a * lone star'), [
    { text: 'a * lone star', bold: false, italic: false, underline: false, strike: false },
  ]);
});
