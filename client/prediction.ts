import { type Wall } from '../src/map.js';
import { advance, type Motion } from '../src/movement.js';
export interface Sample { seq: number; x: number; z: number; yaw: number;pitch?:number; mode: 'walk' | 'run' | 'crouch' }
export function reconcile(motion: Motion, authoritative: { x: number; z: number; yaw: number; ackSeq: number; frozen: boolean }, pending: Sample[], now: number, extra: Wall[] = []) {
  const before = { x: motion.x, z: motion.z };
  motion.x = authoritative.x; motion.z = authoritative.z; motion.yaw = authoritative.yaw;
  motion.input = null;
  const remaining = authoritative.frozen ? [] : pending.filter(i => i.seq > authoritative.ackSeq).slice(-5);
  // Latest-intent protocol: bounded approximation, not deterministic per-input server replay.
  for (const i of remaining) { motion.input = { ...i, at: now }; advance(motion, true, now, extra); }
  return { pending: remaining, correction: Math.hypot(before.x - motion.x, before.z - motion.z) };
}
