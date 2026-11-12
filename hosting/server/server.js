import { OwnerAuth, ConnectionLimiter } from './security.js';
import { AudioCoordinator, voiceWeight, validSignal, AUDIO_PROTOCOL } from './audio.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ARENA } from './movement.js';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { GameError, Rooms } from './rooms.js';
export function createGameServer(options = {}) {
    const rooms = new Rooms(Date.now, options.maxRooms);
    const owner = new OwnerAuth(options.ownerSecretHash);
    const upgrades = new ConnectionLimiter(1, 20), roomCreates = new ConnectionLimiter(.1, 10);
    const calibration = new AudioCoordinator();
    const clients = new Set();
    // Resolve assets against this module, not the host's working directory.
    // The checked-in hosting runtime uses ../public; development uses dist/public.
    const assetDefinitions = {
        '/': { urls: [new URL('../public/index.html', import.meta.url)], type: 'text/html; charset=utf-8' },
        '/style.css': { urls: [new URL('../public/style.css', import.meta.url)], type: 'text/css; charset=utf-8' },
        '/app.js': { urls: [new URL('../public/app.js', import.meta.url), new URL('../dist/public/app.js', import.meta.url)], type: 'text/javascript; charset=utf-8' },
        // Explicit allowlist: no directory serving, and /ready fails if a shipped asset is missing.
        '/assets/mansion-cover.jpg': { urls: [new URL('../public/assets/mansion-cover.jpg', import.meta.url)], type: 'image/jpeg' },
        '/assets/aged-plaster.jpg': { urls: [new URL('../public/assets/aged-plaster.jpg', import.meta.url)], type: 'image/jpeg' },
        '/assets/aged-wood.jpg': { urls: [new URL('../public/assets/aged-wood.jpg', import.meta.url)], type: 'image/jpeg' },
        '/assets/fonts/IBMPlexSansArabic-Regular.ttf': { urls: [new URL('../public/assets/fonts/IBMPlexSansArabic-Regular.ttf', import.meta.url)], type: 'font/ttf' },
        '/assets/fonts/IBMPlexSansArabic-SemiBold.ttf': { urls: [new URL('../public/assets/fonts/IBMPlexSansArabic-SemiBold.ttf', import.meta.url)], type: 'font/ttf' },
        '/assets/fonts/OFL.txt': { urls: [new URL('../public/assets/fonts/OFL.txt', import.meta.url)], type: 'text/plain; charset=utf-8' },
    };
    const assets = new Map();
    for (const [path, definition] of Object.entries(assetDefinitions)) {
        for (const url of definition.urls) {
            try {
                assets.set(path, { body: readFileSync(fileURLToPath(url)), type: definition.type });
                break;
            }
            catch { /* /ready reports missing assets without exposing server paths. */ }
        }
    }
    const server = createServer((req, res) => {
        let path;
        try {
            path = new URL(req.url || '/', 'http://localhost').pathname;
        }
        catch {
            res.writeHead(400);
            res.end();
            return;
        }
        const read = req.method === 'GET' || req.method === 'HEAD';
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors *");
        res.setHeader('Cache-Control', 'no-store');
        if (read && Object.hasOwn(assetDefinitions, path)) {
            const asset = assets.get(path);
            if (!asset) {
                res.writeHead(503);
                res.end(req.method === 'HEAD' ? undefined : 'Client not built. Run npm run build before deploying.');
                return;
            }
            res.setHeader('Content-Type', asset.type);
            res.setHeader('Content-Length', asset.body.length);
            res.end(req.method === 'HEAD' ? undefined : asset.body);
            return;
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        if (read && path === '/health')
            res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ status: 'ok' }));
        else if (read && path === '/ready') {
            const ready = assets.size === Object.keys(assetDefinitions).length;
            res.statusCode = ready ? 200 : 503;
            res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ status: ready ? 'ready' : 'not_ready' }));
        }
        else {
            res.statusCode = 404;
            res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ error: 'NOT_FOUND' }));
        }
    });
    const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024, perMessageDeflate: false });
    server.on('upgrade', (req, socket, head) => {
        const origin = req.headers.origin;
        if (!upgrades.allow(req.socket.remoteAddress || 'unknown') || req.url !== '/ws' || clients.size >= (options.maxConnections ?? 400) ||
            (options.allowedOrigins?.length && (!origin || !options.allowedOrigins.includes(origin)))) {
            socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
            return;
        }
        wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req.socket.remoteAddress || 'unknown'));
    });
    function send(c, message) {
        if (c.socket.readyState !== WebSocket.OPEN)
            return;
        if (c.socket.bufferedAmount > 64 * 1024) {
            c.socket.terminate();
            return;
        }
        c.socket.send(JSON.stringify(message));
    }
    function broadcast(room) {
        const message = { type: 'room', room: rooms.snapshot(room) };
        for (const c of clients)
            if (c.room === room) {
                send(c, message);
                send(c, { type: 'calibration', ...calibration.snapshot(room) });
            }
    }
    wss.on('connection', (socket, ip) => {
        const c = { socket, alive: true, tokens: 40, updated: Date.now(), signalTokens: 40, signalAt: Date.now(), ip };
        clients.add(c);
        socket.on('error', () => { });
        socket.on('pong', () => { c.alive = true; });
        send(c, { type: 'hello', version: 1, audio: AUDIO_PROTOCOL });
        socket.on('message', (raw, binary) => {
            const now = Date.now();
            c.tokens = Math.min(40, c.tokens + (now - c.updated) * .03);
            c.updated = now;
            if (c.tokens < 1) {
                socket.close(1008, 'Rate limit');
                return;
            }
            c.tokens--;
            let requestId;
            try {
                if (binary)
                    throw new GameError('INVALID_MESSAGE', 'الرسائل النصية فقط مسموحة.');
                let m;
                try {
                    const parsed = JSON.parse(raw.toString());
                    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
                        throw Error();
                    m = parsed;
                }
                catch {
                    if (Buffer.byteLength(raw.toString()) > 1024) {
                        socket.close(1009, 'Message too large');
                        return;
                    }
                    throw new GameError('INVALID_MESSAGE', 'رسالة غير صالحة.');
                }
                if (Buffer.byteLength(raw.toString()) > 1024 && m.type !== 'signal') {
                    socket.close(1009, 'Message too large');
                    return;
                }
                if (typeof m.requestId === 'string' && m.requestId.length <= 64)
                    requestId = m.requestId;
                if (['create', 'join', 'resume'].includes(m.type)) {
                    if (c.player)
                        throw new GameError('ALREADY_JOINED', 'غادر الغرفة الحالية أولًا.');
                    if (m.type === 'create' && !roomCreates.allow(c.ip))
                        throw new GameError('CREATE_RATE', 'إنشاء غرف كثيرة، حاول بعد قليل.');
                    const session = m.type === 'create' ? rooms.create(m.name, m.mode) : m.type === 'join' ? rooms.join(m.code, m.name) : rooms.resume(m.code, m.token);
                    if (m.type === 'resume')
                        calibration.cancel(session.room, session.player, now);
                    for (const old of clients)
                        if (old !== c && old.player === session.player) {
                            old.room = undefined;
                            old.player = undefined;
                            old.socket.close(1000, 'Session resumed elsewhere');
                        }
                    c.room = session.room;
                    c.player = session.player;
                    send(c, { type: 'session', requestId, code: c.room.code, playerId: c.player.id, token: c.player.token });
                    send(c, { type: 'map', map: ARENA });
                    broadcast(c.room);
                    if (c.room.phase === 'playing') {
                        send(c, rooms.movementSnapshot(c.room, c.player));
                        send(c, rooms.huntersSnapshot(c.room, c.player));
                    }
                    return;
                }
                if (!c.room || !c.player)
                    throw new GameError('NOT_JOINED', 'انضم إلى غرفة أولًا.');
                const { room, player } = c;
                switch (m.type) {
                    case 'signal': {
                        c.signalTokens = Math.min(40, c.signalTokens + (now - c.signalAt) * .01);
                        c.signalAt = now;
                        if (c.signalTokens < 1)
                            throw new GameError('SIGNAL_RATE', 'طلبات اتصال صوتي كثيرة.');
                        c.signalTokens--;
                        const target = [...clients].find(t => t.room === room && t.player && t.player.id === m.to && t.player.id !== player.id);
                        if (!target || !validSignal(m.data))
                            throw new GameError('INVALID_SIGNAL', 'طلب اتصال صوتي غير صالح.');
                        send(target, { type: 'signal', from: player.id, data: m.data });
                        return;
                    }
                    case 'level':
                        rooms.micLevel(room, player, m.level);
                        return;
                    case 'calibrate':
                        player.voiceAvailable = true;
                        player.ready = false;
                        player.mic = false;
                        player.calibrated = false;
                        calibration.request(room, player, now);
                        break;
                    case 'calibration-result': {
                        let result;
                        try {
                            result = calibration.finish(room, player, m.threshold, m.contaminated, now);
                        }
                        catch {
                            throw new GameError('INVALID_CALIBRATION', 'المعايرة غير صالحة أو لم تكتمل خمس ثوانٍ.');
                        }
                        if (!result.retry)
                            rooms.mic(room, player, true, result.threshold);
                        send(c, { type: 'calibration-result', ...result });
                        break;
                    }
                    case 'owner-auth': {
                        if (!owner.authenticate(c.ip, m.secret)) {
                            console.warn('Owner authentication failed');
                            throw new GameError('OWNER_AUTH_FAILED', 'تعذر توثيق جلسة المالك.');
                        }
                        player.ownerAuthorized = true;
                        send(c, { type: 'owner-session', authorized: true });
                        return;
                    }
                    case 'revive':
                        rooms.revive(room, player, m.targetId);
                        return;
                    case 'revive-cancel':
                        player.revive = null;
                        return;
                    case 'collect':
                        rooms.collect(room, player, m.id);
                        break;
                    case 'rescue-friend':
                        rooms.rescueFriend(room, player);
                        break;
                    case 'shoot':
                        rooms.shoot(room, player);
                        break;
                    case 'escape':
                        rooms.escape(room, player, m.code, player.ownerAuthorized && owner.verify(m.code));
                        break;
                    case 'spectate':
                        rooms.spectate(room, player, m.targetId);
                        break;
                    case 'rematch':
                        rooms.rematch(room, player);
                        break;
                    case 'move':
                        rooms.move(room, player, m);
                        return;
                    case 'door':
                        rooms.door(room, player, m.id, m.open);
                        break;
                    case 'mic':
                        if (m.available === true && !player.calibrated)
                            throw new GameError('CALIBRATION_REQUIRED', 'أكمل معايرة المايك أولًا.');
                        rooms.mic(room, player, m.available, m.threshold);
                        if (!m.available)
                            calibration.cancel(room, player, now);
                        break;
                    case 'ready':
                        rooms.ready(room, player, m.ready);
                        break;
                    case 'start':
                        rooms.start(room, player);
                        break;
                    case 'leave':
                        calibration.cancel(room, player, now);
                        rooms.leave(room, player);
                        c.room = undefined;
                        c.player = undefined;
                        break;
                    default: throw new GameError('UNKNOWN_TYPE', 'نوع الطلب غير معروف.');
                }
                send(c, { type: 'ack', requestId, action: m.type });
                broadcast(room);
            }
            catch (error) {
                send(c, { type: 'error', requestId, code: error instanceof GameError ? error.code : 'INTERNAL_ERROR', message: error instanceof GameError ? error.message : 'حدث خطأ داخلي.' });
            }
        });
        socket.on('close', () => {
            clients.delete(c);
            if (c.room && c.player) {
                calibration.cancel(c.room, c.player, Date.now());
                rooms.disconnect(c.room, c.player);
                broadcast(c.room);
            }
        });
    });
    // Fixed steps: delayed callbacks slow the simulation, never grant a giant movement delta.
    const simulation = setInterval(() => rooms.step(), 50);
    const ai = setInterval(() => {
        if (options.hunters !== false)
            rooms.aiStep();
        for (const room of rooms.rooms.values())
            if (room.phase === 'playing') {
                for (const c of clients)
                    if (c.room === room && c.player)
                        send(c, rooms.huntersSnapshot(room, c.player));
            }
    }, 100);
    ai.unref();
    const replication = setInterval(() => {
        for (const room of rooms.rooms.values())
            if (room.phase !== 'lobby') {
                for (const c of clients)
                    if (c.room === room && c.player)
                        send(c, rooms.movementSnapshot(room, c.player));
            }
    }, 1000 / 15);
    simulation.unref();
    replication.unref();
    const audioTick = setInterval(() => {
        for (const room of rooms.rooms.values()) {
            calibration.pump(room, Date.now());
            const events = room.soundEvents.splice(0);
            for (const c of clients)
                if (c.room === room && c.player) {
                    send(c, { type: 'calibration', ...calibration.snapshot(room) });
                    send(c, { type: 'voice-policy', weights: Object.fromEntries([...room.players.values()].filter(p => p.id !== c.player.id).map(p => [p.id, voiceWeight(room, p, c.player)])), outgoing: Object.fromEntries([...room.players.values()].filter(p => p.id !== c.player.id).map(p => [p.id, voiceWeight(room, c.player, p)])) });
                    if (events.length)
                        send(c, { type: 'sounds', events });
                }
        }
    }, 250);
    audioTick.unref();
    const sweep = setInterval(() => { for (const room of rooms.sweep())
        broadcast(room); }, 1000);
    const heartbeat = setInterval(() => {
        for (const c of clients) {
            if (!c.alive)
                c.socket.terminate();
            else {
                c.alive = false;
                c.socket.ping();
            }
        }
    }, 15_000);
    sweep.unref();
    heartbeat.unref();
    async function close() {
        clearInterval(audioTick);
        clearInterval(ai);
        clearInterval(simulation);
        clearInterval(replication);
        clearInterval(sweep);
        clearInterval(heartbeat);
        for (const c of clients)
            c.socket.terminate();
        await new Promise(resolve => wss.close(() => resolve()));
        await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    }
    return { server, rooms, close };
}
