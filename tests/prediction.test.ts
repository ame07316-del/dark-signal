import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, type Sample } from '../client/prediction.js';
import { newMotion } from '../src/movement.js';
const input = (seq: number): Sample => ({ seq, x: 1, z: 0, yaw: 0, mode: 'walk' });
test('prediction rebases onto server and discards acknowledged samples', () => {
  const m = newMotion(); m.x = 10;
  const result = reconcile(m, { x: 2, z: 2, yaw: 0, ackSeq: 1, frozen: false }, [input(1), input(2)], 0);
  assert.ok(Math.abs(m.x - 2.12) < 1e-9); assert.equal(result.pending.length, 1);
  assert.ok(result.correction > 7);
});
test('frozen authoritative state clears prediction immediately', () => {
  const m = newMotion();
  const result = reconcile(m, { x: 3, z: 4, yaw: 1, ackSeq: -1, frozen: true }, [input(1)], 0);
  assert.equal(m.x, 3); assert.equal(m.z, 4); assert.equal(m.input, null); assert.equal(result.pending.length, 0);
});
test('reconciliation bounds replay and shares server wall collision', () => {
  const m = newMotion();
  const pending = Array.from({ length: 20 }, (_, i) => input(i));
  const result = reconcile(m, { x: 8.65, z: 8, yaw: 0, ackSeq: -1, frozen: false }, pending, 0);
  assert.equal(result.pending.length, 5); assert.ok(m.x <= 8.7);
});
