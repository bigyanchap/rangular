import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, signal, Container } from '../packages/runtime/src/index';

test('EventEmitter on/emit/off', () => {
  const em = new EventEmitter<number>();
  const seen: number[] = [];
  const off = em.on((v) => seen.push(v));
  em.emit(1);
  em.emit(2);
  off();
  em.emit(3);
  assert.deepEqual(seen, [1, 2]);
  assert.equal(em.listenerCount, 0);
});

test('EventEmitter off removes a specific listener', () => {
  const em = new EventEmitter<string>();
  const a: string[] = [];
  const b: string[] = [];
  const la = (v: string) => a.push(v);
  em.on(la);
  em.on((v) => b.push(v));
  em.off(la);
  em.emit('x');
  assert.deepEqual(a, []);
  assert.deepEqual(b, ['x']);
});

test('signal get/set/subscribe with change notification', () => {
  const s = signal(0);
  const seen: number[] = [];
  const unsub = s.subscribe((v) => seen.push(v));
  s.set(1);
  s.set(1); // no change -> no notification
  s.update((v) => v + 1);
  unsub();
  s.set(99);
  assert.equal(s.get(), 99);
  assert.equal(s.value, 99);
  assert.deepEqual(seen, [1, 2]);
});

test('Container register/get and missing token error', () => {
  const c = new Container();
  class Api {}
  const api = new Api();
  c.register('api', api);
  c.register(Api, api);
  assert.equal(c.get('api'), api);
  assert.equal(c.get(Api), api);
  assert.equal(c.has('nope'), false);
  assert.throws(() => c.get('nope'), /no provider registered for token/);
});
