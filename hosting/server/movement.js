import { ARENA } from './map.js';
export { ARENA } from './map.js';
export const STEP_SECONDS = 1 / 20;
export const PLAYER_RADIUS = .3;
export const INPUT_TIMEOUT_MS = 250;
export function newMotion(index = 0) {
    return { ...ARENA.spawns[index % ARENA.spawns.length], yaw: 0, pitch: 0, lastSeq: -1, appliedSeq: -1, input: null };
}
export function blocked(x, z, extra = []) {
    const r = PLAYER_RADIUS;
    const overlaps = (w) => x > w.minX - r && x < w.maxX + r && z > w.minZ - r && z < w.maxZ + r;
    return x < ARENA.minX + r || x > ARENA.maxX - r || z < ARENA.minZ + r || z > ARENA.maxZ - r ||
        ARENA.walls.some(overlaps) || extra.some(overlaps);
}
/** Sweep a displacement against the same walls used by the authoritative simulation. */
export function moveWithCollisions(m, dx, dz, extra = []) {
    if (!dx && !dz)
        return;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / (PLAYER_RADIUS / 2)));
    for (let n = 0; n < steps; n++) {
        if (dx && !blocked(m.x + dx / steps, m.z, extra))
            m.x += dx / steps;
        if (dz && !blocked(m.x, m.z + dz / steps, extra))
            m.z += dz / steps;
    }
}
export function advance(m, enabled, now, extra = [], seconds = STEP_SECONDS) {
    const i = m.input;
    if (!enabled || !i || now - i.at >= INPUT_TIMEOUT_MS) {
        m.input = null;
        return;
    }
    m.yaw = i.yaw;
    m.pitch = i.pitch ?? 0;
    m.appliedSeq = i.seq;
    const speed = { walk: 2.4, run: 4.8, crouch: 1.3 }[i.mode];
    const length = Math.max(1, Math.hypot(i.x, i.z));
    // The server always uses its fixed step. Substeps are for client presentation only.
    const dt = Number.isFinite(seconds) ? Math.max(0, Math.min(STEP_SECONDS, seconds)) : 0;
    const dx = i.x / length * speed * dt, dz = i.z / length * speed * dt;
    // Small conservative axis sweeps prevent tunnelling and permit wall sliding.
    moveWithCollisions(m, dx, dz, extra);
}
