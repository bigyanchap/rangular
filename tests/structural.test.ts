import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNgFor, parseNgIf } from '../packages/compiler/src/template/structural';

test('parseNgFor: let item of items', () => {
  const { parts, diagnostics } = parseNgFor('let m of mails');
  assert.equal(diagnostics.length, 0);
  assert.equal(parts?.itemVar, 'm');
  assert.equal(parts?.source, 'mails');
  assert.equal(parts?.indexVar, undefined);
  assert.equal(parts?.trackBy, undefined);
});

test('parseNgFor: index local', () => {
  const { parts } = parseNgFor('let m of mails; let i = index');
  assert.equal(parts?.indexVar, 'i');
});

test('parseNgFor: trackBy segment', () => {
  const { parts } = parseNgFor('let m of mails; trackBy: trackById');
  assert.equal(parts?.trackBy, 'trackById');
});

test('parseNgFor: source may be a member expression', () => {
  const { parts } = parseNgFor('let x of state.items; let pos = index');
  assert.equal(parts?.source, 'state.items');
  assert.equal(parts?.indexVar, 'pos');
});

test('parseNgFor: malformed microsyntax yields a diagnostic, not a throw', () => {
  const { parts, diagnostics } = parseNgFor('mails');
  assert.equal(parts, undefined);
  assert.ok(diagnostics.some((d) => d.code === 'TPL_NGFOR'));
});

test('parseNgIf: plain condition', () => {
  const parts = parseNgIf('count >= 5');
  assert.equal(parts.condition, 'count >= 5');
  assert.equal(parts.elseRef, undefined);
});

test('parseNgIf: else segment is detected', () => {
  const parts = parseNgIf('ready; else noTpl');
  assert.equal(parts.condition, 'ready');
  assert.equal(parts.elseRef, 'noTpl');
});
