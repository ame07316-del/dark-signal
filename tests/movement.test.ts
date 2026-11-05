import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rooms, GameError } from '../src/rooms.js';
import { PLAYER_RADIUS } from '../src/movement.js';
function setup() {
  let now = 0; const store = new Rooms(() => now);
  const { room, player: a } = store.create('A'); const { player: b } = store.join(room.code, 'B');
  for (const p of [a, b]) { store.mic(room, p, true, .1); store.ready(room, p, true); }
  store.start(room, a);
  let seq = 0;
  function step(x = 1, z = 0, mode = 'walk', player = a) {
    store.move(room, player, { type: 'move', seq: seq++, x, z, yaw: 0, mode });
    now += 50; store.step();
  }
  return { store, room, a, b, step, time: (t: number) => { now = t; } };
}
test('fixed authoritative speed, normalized diagonal, and independent players', () => {
  for (const [mode, speed] of [['walk', 2.4], ['run', 4.8], ['crouch', 1.3]] as const) {
    const s = setup();
    for (let n = 0; n < 20; n++) s.step(1, 1, mode);
    assert.ok(Math.abs(Math.hypot(s.a.motion.x - 2, s.a.motion.z - 2) - speed) < 1e-9);
    assert.equal(s.b.motion.x, 3); assert.equal(s.room.tick, 20);
  }
});
test('wall sweeps prevent crossing, slide along wall, arena bounds hold', () => {
  const s = setup(); s.a.motion.x = 8; s.a.motion.z = 8;
  for (let n = 0; n < 20; n++) s.step(1, 1, 'run');
  assert.ok(s.a.motion.x <= 9 - PLAYER_RADIUS); assert.ok(s.a.motion.z > 10);
  s.a.motion.x = .4; s.a.motion.z = .4;
  for (let n = 0; n < 100; n++) s.step(-1, -1, 'run');
  assert.ok(s.a.motion.x >= PLAYER_RADIUS); assert.ok(s.a.motion.z >= PLAYER_RADIUS);
});
test('mic loss and disconnect freeze without replay on restore, stale inputs expire', () => {
  const s = setup(); s.step(); const x = s.a.motion.x;
  s.store.mic(s.room, s.a, false, null); s.store.step(); assert.equal(s.a.motion.x, x);
  s.time(60_000); s.store.sweep(); assert.equal(s.room.players.size, 2); // mic is not a network disconnect
  s.store.mic(s.room, s.a, true, .1); s.store.step(); assert.equal(s.a.motion.x, x);
  s.step(); const moved = s.a.motion.x;
  s.time(61_000); s.store.step(); assert.equal(s.a.motion.x, moved);
  s.step(); const beforeDisconnect = s.a.motion.x;
  const token = s.a.token; s.store.disconnect(s.room, s.a); s.store.step();
  assert.equal(s.a.motion.x, beforeDisconnect);
  s.store.resume(s.room.code, token); s.store.mic(s.room, s.a, true, .1); s.store.step();
  assert.equal(s.a.motion.x, beforeDisconnect);
});
test('reject spoofed positions, invalid numbers and replayed sequence', () => {
  const s = setup();
  const valid = { type: 'move', seq: 1, x: 1, z: 0, yaw: 0, mode: 'walk' };
  for (const change of [{ x: NaN }, { z: Infinity }, { x: 2 }, { seq: 1.2 }, { seq: -1 }, { yaw: 9 }, { mode: 'fly' }, { position: { x: 99 } }, { dt: 99 }]) {
    assert.throws(() => s.store.move(s.room, s.a, { ...valid, ...change }), (e: unknown) => e instanceof GameError && e.code === 'INVALID_MOVE');
  }
  s.store.move(s.room, s.a, valid);
  assert.throws(() => s.store.move(s.room, s.a, valid), /قديم/);
  // Flooding valid inputs doesn't move until the server advances one fixed step.
  for (let seq = 2; seq < 100; seq++) s.store.move(s.room, s.a, { ...valid, seq });
  assert.equal(s.a.motion.x, 2); s.store.step(); assert.ok(Math.abs(s.a.motion.x - 2.12) < 1e-9);
  assert.equal(s.a.motion.appliedSeq, 99);
});
