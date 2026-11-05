import { type Wall, ARENA } from './map.js';
export { ARENA } from './map.js';
export const STEP_SECONDS = 1 / 20;
export const PLAYER_RADIUS = .3;
export const INPUT_TIMEOUT_MS = 250;
export interface Motion {
  x: number; z: number; yaw: number; pitch:number; lastSeq: number; appliedSeq: number;
  input: { x: number; z: number; yaw: number; pitch?:number; mode: 'walk' | 'run' | 'crouch'; seq: number; at: number } | null;
}
export function newMotion(index = 0): Motion {
  return { ...ARENA.spawns[index % ARENA.spawns.length], yaw: 0, pitch:0, lastSeq: -1, appliedSeq: -1, input: null };
}
export function blocked(x: number, z: number, extra: Wall[] = []) {
  const r = PLAYER_RADIUS;
  return x < ARENA.minX + r || x > ARENA.maxX - r || z < ARENA.minZ + r || z > ARENA.maxZ - r ||
    [...ARENA.walls,...extra].some(w => x > w.minX - r && x < w.maxX + r && z > w.minZ - r && z < w.maxZ + r);
}
export function advance(m: Motion, enabled: boolean, now: number, extra: Wall[] = []) {
  const i = m.input;
  if (!enabled || !i || now - i.at >= INPUT_TIMEOUT_MS) { m.input = null; return; }
  m.yaw = i.yaw;m.pitch=i.pitch??0; m.appliedSeq = i.seq;
  const speed = { walk: 2.4, run: 4.8, crouch: 1.3 }[i.mode];
  const length = Math.max(1, Math.hypot(i.x, i.z));
  const dx = i.x / length * speed * STEP_SECONDS, dz = i.z / length * speed * STEP_SECONDS;
  // Small conservative axis sweeps prevent tunnelling and permit wall sliding.
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / (PLAYER_RADIUS / 2)));
  for (let n = 0; n < steps; n++) {
    if (!blocked(m.x + dx / steps, m.z, extra)) m.x += dx / steps;
    if (!blocked(m.x, m.z + dz / steps, extra)) m.z += dz / steps;
  }
}
