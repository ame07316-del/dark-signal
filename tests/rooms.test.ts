import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rooms, GameError } from '../src/rooms.js';
const rejects = (fn: () => unknown, code: string) => assert.throws(fn, (e: unknown) => e instanceof GameError && e.code === code);
test('private rooms validate names, capacity and duplicate names', () => {
  const store = new Rooms();
  rejects(() => store.create('<script>'), 'INVALID_NAME');
  const { room } = store.create('حمزة');
  rejects(() => store.join(room.code, 'حمزة'), 'NAME_TAKEN');
  for (const name of ['A', 'B', 'C']) store.join(room.code.toLowerCase(), name);
  rejects(() => store.join(room.code, 'D'), 'ROOM_FULL');
  rejects(() => store.get('missing'), 'ROOM_NOT_FOUND');
  assert.equal(JSON.stringify(store.snapshot(room)).includes('token'), false);
});
test('start requires host, two players, calibrated microphones and everyone ready', () => {
  const store = new Rooms(); const { room, player: host } = store.create('Host');
  rejects(() => store.start(room, host), 'NOT_READY');
  const { player } = store.join(room.code, 'Guest');
  rejects(() => store.ready(room, host, true), 'MIC_REQUIRED');
  rejects(() => store.mic(room, host, true, NaN), 'INVALID_MIC');
  for (const p of [host, player]) { store.mic(room, p, true, .1); store.ready(room, p, true); }
  rejects(() => store.start(room, player), 'HOST_ONLY');
  store.mic(room, player, false, null);
  rejects(() => store.start(room, host), 'NOT_READY');
  store.mic(room, player, true, .1); store.ready(room, player, true);
  store.start(room, host); assert.equal(room.phase, 'playing');
  rejects(() => store.join(room.code, 'Late'), 'ROUND_STARTED');
});
test('disconnect transfers host; resume rotates token, expires at 30 seconds', () => {
  let now = 0; const store = new Rooms(() => now);
  const { room, player: host } = store.create('Host'); const { player } = store.join(room.code, 'Guest');
  const token = host.token; store.disconnect(room, host); assert.equal(room.hostId, player.id);
  const resumed = store.resume(room.code, token); assert.notEqual(resumed.player.token, token);
  assert.equal(host.mic, false); assert.equal(host.ready, false);
  rejects(() => store.resume(room.code, token), 'INVALID_SESSION');
  store.disconnect(room, host); now = 30_000;
  rejects(() => store.resume(room.code, host.token), 'INVALID_SESSION');
  store.sweep(); assert.equal(room.players.size, 1);
  store.leave(room, player); assert.equal(store.rooms.size, 0);
});
test('room cap and all-disconnected rooms are cleaned', () => {
  let now = 0; const store = new Rooms(() => now, 1); const { room, player } = store.create('A');
  rejects(() => store.create('B'), 'SERVER_FULL'); store.disconnect(room, player);
  now = 30_000; store.sweep(); assert.equal(store.rooms.size, 0);
});
