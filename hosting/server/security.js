import { createHash, timingSafeEqual } from 'node:crypto';
export class OwnerAuth {
    hash;
    now;
    attempts = new Map();
    constructor(hash = process.env.OWNER_SECRET_HASH || '', now = Date.now) {
        this.hash = hash;
        this.now = now;
        if (hash && !/^[a-f0-9]{64}$/i.test(hash))
            throw Error('OWNER_SECRET_HASH must be SHA-256 hex');
    }
    configured() { return !!this.hash; }
    verify(value) { if (!this.hash || typeof value !== 'string' || value.length < 1 || Buffer.byteLength(value) > 128)
        return false; const actual = createHash('sha256').update(value).digest(); return timingSafeEqual(actual, Buffer.from(this.hash, 'hex')); }
    authenticate(key, value) {
        const now = this.now();
        for (const [k, v] of this.attempts)
            if (v.until <= now)
                this.attempts.delete(k);
        if (this.attempts.size > 10000)
            return false;
        const a = this.attempts.get(key) || { count: 0, until: now + 60000 };
        a.count++;
        this.attempts.set(key, a);
        if (a.count > 5)
            return false;
        return this.verify(value);
    }
}
export class ConnectionLimiter {
    rate;
    burst;
    now;
    values = new Map();
    constructor(rate, burst, now = Date.now) {
        this.rate = rate;
        this.burst = burst;
        this.now = now;
    }
    allow(key) { const now = this.now(); if (this.values.size > 10000)
        for (const [k, v] of this.values)
            if (now - v.at > 60000)
                this.values.delete(k); if (this.values.size > 10000 && !this.values.has(key))
        return false; const v = this.values.get(key) || { at: now, tokens: this.burst }; v.tokens = Math.min(this.burst, v.tokens + (now - v.at) * this.rate / 1000); v.at = now; if (v.tokens < 1) {
        this.values.set(key, v);
        return false;
    } v.tokens--; this.values.set(key, v); return true; }
}
