import { type Wall } from '../src/map.js';
import { advance, blocked, moveWithCollisions, newMotion, PLAYER_RADIUS, STEP_SECONDS, type Motion } from '../src/movement.js';

/** Presentation only: gameplay and collision authority remain on the server. */
export type MotionIntent = Pick<NonNullable<Motion['input']>, 'x' | 'z' | 'yaw' | 'pitch' | 'mode'>;
type Position = Pick<Motion, 'x' | 'z'>;
const MAX_FRAME_GAP_MS = 250;
const MAX_FRAME_SIM_SECONDS = .1;
const MAX_VISUAL_ERROR = 1.5;
const CORRECTION_SECONDS = .15;

function clearPath(from: Position, to: Position, walls: Wall[]) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / (PLAYER_RADIUS / 2)));
  for (let i = 1; i <= steps; i++) if (blocked(from.x + dx * i / steps, from.z + dz * i / steps, walls)) return false;
  return true;
}

/**
 * Draw the local player at frame rate between 20 Hz prediction updates. Small
 * server corrections are absorbed smoothly, while freezes, long gaps and big
 * corrections snap back to the current predicted/authoritative position.
 */
export class MotionPresentation {
  private motion = newMotion();
  private lastFrame: number | null = null;
  private initialized = false;

  reset() { this.initialized = false; this.lastFrame = null; }

  update(target: Position, intent: MotionIntent | null, now: number, walls: Wall[] = []): Position {
    const elapsed = this.lastFrame === null ? 0 : now - this.lastFrame;
    const error = Math.hypot(target.x - this.motion.x, target.z - this.motion.z);
    this.lastFrame = now;
    if (!this.initialized || !intent || elapsed < 0 || elapsed > MAX_FRAME_GAP_MS ||
        blocked(this.motion.x, this.motion.z, walls) || error > MAX_VISUAL_ERROR ||
        (error > .25 && !clearPath(this.motion, target, walls))) {
      this.initialized = true;
      this.motion.x = target.x; this.motion.z = target.z; this.motion.input = null;
      return this.motion;
    }
    const seconds = Math.min(MAX_FRAME_SIM_SECONDS, elapsed / 1000);
    if (!seconds) return this.motion;

    const before = { x: this.motion.x, z: this.motion.z };
    this.motion.input = { ...intent, seq: 0, at: now };
    // Slow devices still advance at the intended speed, in collision-safe substeps.
    for (let remaining = seconds; remaining > 1e-9;) {
      const step = Math.min(STEP_SECONDS, remaining);
      advance(this.motion, true, now, walls, step); remaining -= step;
    }
    const factor = 1 - Math.exp(-seconds / CORRECTION_SECONDS);
    let dx = (target.x - this.motion.x) * factor;
    let dz = (target.z - this.motion.z) * factor;

    // A small late correction must not make a player visibly walk backwards
    // while they are still pressing forward. Larger discrepancies still snap.
    const length = Math.hypot(intent.x, intent.z);
    if (length) {
      const x = intent.x / length, z = intent.z / length;
      const forward = (this.motion.x - before.x) * x + (this.motion.z - before.z) * z;
      const correction = dx * x + dz * z;
      if (forward > 1e-8 && correction < -forward / 2) {
        const adjustment = -forward / 2 - correction;
        dx += adjustment * x; dz += adjustment * z;
      }
    }
    // The cosmetic camera must not pass through the same walls/doors either.
    moveWithCollisions(this.motion, dx, dz, walls);
    return this.motion;
  }
}
