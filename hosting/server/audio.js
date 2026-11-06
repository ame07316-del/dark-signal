import { closedDoors } from './map.js';
import { segmentClear } from './hunters.js';
export function voiceWeight(room, source, listener) {
    if (!source.connected || !listener.connected || !source.voiceAvailable || !listener.voiceAvailable)
        return 0;
    if (source.voiceRole === 'spectator' || room.phase === 'lobby')
        return 1;
    const distance = Math.hypot(source.motion.x - listener.motion.x, source.motion.z - listener.motion.z);
    return Math.max(0, 1 - distance / 8) * (segmentClear(source.motion, listener.motion, closedDoors(room.doors), true) ? 1 : .55);
}
export function micNoiseAllowed(role) { return role === 'active'; }
export class AudioCoordinator {
    states = new WeakMap();
    get(room) { let s = this.states.get(room); if (!s) {
        s = { active: null, queue: [], attempts: new Map() };
        this.states.set(room, s);
    } return s; }
    request(room, p, now) { const s = this.get(room); if (s.active?.playerId !== p.id && !s.queue.includes(p.id))
        s.queue.push(p.id); this.pump(room, now); }
    pump(room, now) {
        const s = this.get(room);
        s.queue = s.queue.filter(id => room.players.get(id)?.connected);
        if (s.active && (!room.players.get(s.active.playerId)?.connected || now - s.active.startedAt > 20_000))
            s.active = null;
        if (!s.active && s.queue.length) {
            const playerId = s.queue.shift();
            s.active = { playerId, startedAt: now, attempt: s.attempts.get(playerId) || 0, quiet: (s.attempts.get(playerId) || 0) > 0 };
        }
    }
    snapshot(room) { const s = this.get(room); return { active: s.active, queue: [...s.queue] }; }
    finish(room, p, threshold, contaminated, now) {
        const s = this.get(room), a = s.active;
        if (!a || a.playerId !== p.id || now - a.startedAt < 5000 || now - a.startedAt > 20_000)
            throw Error('CALIBRATION_WAIT');
        if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0 || threshold > 1 || typeof contaminated !== 'boolean')
            throw Error('CALIBRATION_INVALID');
        if (contaminated && a.attempt === 0) {
            s.attempts.set(p.id, 1);
            s.active = { playerId: p.id, startedAt: now, attempt: 1, quiet: true };
            return { retry: true, warning: false, threshold };
        }
        s.active = null;
        s.attempts.delete(p.id);
        this.pump(room, now);
        return { retry: false, warning: contaminated, threshold };
    }
    cancel(room, p, now) { const s = this.get(room); s.queue = s.queue.filter(id => id !== p.id); if (s.active?.playerId === p.id)
        s.active = null; s.attempts.delete(p.id); this.pump(room, now); }
}
export function validSignal(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data))
        return false;
    const m = data;
    if (m.kind === 'offer' || m.kind === 'answer')
        return typeof m.sdp === 'string' && m.sdp.length > 0 && Buffer.byteLength(m.sdp) <= 12 * 1024 && Object.keys(m).every(k => k === 'kind' || k === 'sdp');
    if (m.kind === 'ice')
        return typeof m.candidate === 'string' && m.candidate.length <= 2048 && (m.sdpMid === null || typeof m.sdpMid === 'string' && m.sdpMid.length < 64) && (m.sdpMLineIndex === null || typeof m.sdpMLineIndex === 'number' && Number.isInteger(m.sdpMLineIndex) && m.sdpMLineIndex >= 0 && m.sdpMLineIndex < 16) && Object.keys(m).every(k => ['kind', 'candidate', 'sdpMid', 'sdpMLineIndex'].includes(k));
    return false;
}
export const AUDIO_PROTOCOL = { version: 1, range: 8, wallGain: .55, stun: 'stun:stun.l.google.com:19302' };
