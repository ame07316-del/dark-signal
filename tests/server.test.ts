import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createGameServer } from '../src/server.js';

async function connect(url: string, origin?: string) {
  const ws = new WebSocket(url, origin ? { origin } : undefined);
  const messages: any[] = []; const waiters: (() => void)[] = [];
  ws.on('message', data => { messages.push(JSON.parse(data.toString())); waiters.splice(0).forEach(w => w()); });
  await once(ws, 'open');
  async function next(type: string): Promise<any> {
    const deadline = Date.now() + 2000;
    while (true) {
      const index = messages.findIndex(m => m.type === type);
      if (index >= 0) return messages.splice(index, 1)[0];
      if (Date.now() >= deadline) throw Error(`Timed out waiting for ${type}`);
      await new Promise<void>(resolve => { const timer = setTimeout(resolve, 50); waiters.push(() => { clearTimeout(timer); resolve(); }); });
    }
  }
  return { ws, next, send: (m: object) => ws.send(JSON.stringify(m)) };
}
test('HTTP health and websocket lobby lifecycle, reconnect, validation and host transfer', async () => {
  const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.deepEqual(await (await fetch(base + '/health')).json(), { status: 'ok' });
    assert.match(await (await fetch(base + '/')).text(), /DARK SIGNAL/);
    assert.match((await fetch(base + '/app.js')).headers.get('content-type')!, /javascript/);
    assert.equal((await fetch(base + '/missing')).status, 404);
    const a = await connect(base.replace('http', 'ws') + '/ws'); const b = await connect(base.replace('http', 'ws') + '/ws');
    a.ws.send('null'); assert.equal((await a.next('error')).code, 'INVALID_MESSAGE');
    a.send({ type: 'create', name: 'Host', requestId: '1' }); const session = await a.next('session');
    assert.equal(session.requestId, '1');
    b.send({ type: 'join', code: session.code, name: 'Guest' }); const guest = await b.next('session');
    b.send({ type: 'start' }); assert.equal((await b.next('error')).code, 'HOST_ONLY');
    for (const c of [a, b]) {
      for(const p of app.rooms.get(session.code).players.values())p.calibrated=true;
      c.send({ type: 'mic', available: true, threshold: .1 }); await c.next('ack');
      c.send({ type: 'ready', ready: true }); await c.next('ack');
    }
    a.send({ type: 'start' }); await a.next('ack');
    assert.equal(app.rooms.get(session.code).phase, 'playing');
    const hunters = await b.next('hunters');
    assert.ok(hunters.hunters.every((h:any)=>['hamza','rana'].includes(h.id)));
    assert.ok(hunters.hunters.length<2); // interest filtering hides the distant wing
    assert.equal(JSON.stringify(hunters).includes('targetId'), false);
    const closed = once(a.ws, 'close'); a.ws.close(); await closed;
    // Wait for server-side disconnect processing by consuming its broadcast.
    let state; do { state = await b.next('room'); } while (state.room.hostId !== guest.playerId);
    const c = await connect(base.replace('http', 'ws') + '/ws');
    c.send({ type: 'resume', code: session.code, token: session.token }); const resumed = await c.next('session');
    assert.equal(resumed.playerId, session.playerId); assert.notEqual(resumed.token, session.token);
    c.send({ type: 'leave' }); await c.next('ack'); b.send({ type: 'leave' }); await b.next('ack');
    assert.equal(app.rooms.rooms.size, 0);
  } finally { await app.close(); }
});
test('origin restriction rejects untrusted websocket upgrade', async () => {
  const app = createGameServer({ allowedOrigins: ['https://game.example'] });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert(address && typeof address !== 'string');
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, { origin: 'https://evil.example' });
    const [error] = await once(ws, 'error'); assert.match(error.message, /403/);
    const good = await connect(`ws://127.0.0.1:${address.port}/ws`, 'https://game.example');
    assert.equal((await good.next('hello')).version, 1);
  } finally { await app.close(); }
});
test('rate and payload limits close abusive connections', async () => {
  const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert(address && typeof address !== 'string');
  try {
    const url = `ws://127.0.0.1:${address.port}/ws`;
    const c = await connect(url); const closed = once(c.ws, 'close');
    for (let i = 0; i < 60; i++) c.send({ type: 'unknown' });
    assert.equal((await closed)[0], 1008);
    const large = await connect(url); large.ws.on('error', () => {});
    const ended = once(large.ws, 'close'); large.ws.send('x'.repeat(1025));
    assert.equal((await ended)[0], 1009);
  } finally { await app.close(); }
});
test('two websocket players receive authoritative movement and mic freeze', async () => {
  const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert(address && typeof address !== 'string');
  try {
    const url = `ws://127.0.0.1:${address.port}/ws`;
    const a = await connect(url), b = await connect(url);
    a.send({ type: 'create', name: 'A' }); const session = await a.next('session');
    b.send({ type: 'join', code: session.code, name: 'B' }); const guest = await b.next('session');
    assert.equal((await a.next('map')).map.id, 'mansion-ground-v2');
    a.send({ type: 'move', seq: 0, x: 1, z: 0, yaw: 0, mode: 'walk' });
    assert.equal((await a.next('error')).code, 'INVALID_PHASE');
    for (const c of [a, b]) {
      for(const p of app.rooms.get(session.code).players.values())p.calibrated=true;
      c.send({ type: 'mic', available: true, threshold: .1 }); await c.next('ack');
      c.send({ type: 'ready', ready: true }); await c.next('ack');
    }
    a.send({ type: 'start' }); await a.next('ack');
    a.send({ type: 'move', seq: 1, x: 1, z: 0, yaw: .5, mode: 'walk' });
    b.send({ type: 'move', seq: 1, x: 0, z: 1, yaw: 0, mode: 'run' });
    let state;
    do { state = await b.next('state'); } while (state.players.some((p: any) => p.ackSeq !== 1));
    assert.ok(state.players.find((p: any) => p.id === session.playerId).x > 2);
    assert.ok(state.players.find((p: any) => p.id === guest.playerId).z > 2);
    assert.equal(JSON.stringify(state).includes('token'), false);
    a.send({ type: 'mic', available: false }); await a.next('ack');
    do { state = await b.next('state'); } while (!state.players.find((p: any) => p.id === session.playerId).frozen);
    const frozenX = state.players.find((p: any) => p.id === session.playerId).x;
    state = await b.next('state'); assert.equal(state.players.find((p: any) => p.id === session.playerId).x, frozenX);
    a.send({ type: 'move', seq: 2, x: 1, z: 0, yaw: 0, mode: 'walk' });
    assert.equal((await a.next('error')).code, 'MIC_REQUIRED');
  } finally { await app.close(); }
});
test('signaling only routes within a room; mic cannot skip calibration and large game frames stay forbidden',async()=>{
  const app=createGameServer();app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  const address=app.server.address();assert(address&&typeof address!=='string');
  try {
    const url=`ws://127.0.0.1:${address.port}/ws`,a=await connect(url),b=await connect(url),c=await connect(url);
    a.send({type:'create',name:'A'});const sa=await a.next('session');
    b.send({type:'join',code:sa.code,name:'B'});const sb=await b.next('session');
    c.send({type:'create',name:'C'});const sc=await c.next('session');
    a.send({type:'mic',available:true,threshold:.1});assert.equal((await a.next('error')).code,'CALIBRATION_REQUIRED');
    a.send({type:'signal',to:sc.playerId,data:{kind:'offer',sdp:'v=0'}});assert.equal((await a.next('error')).code,'INVALID_SIGNAL');
    a.send({type:'signal',to:sa.playerId,data:{kind:'offer',sdp:'v=0'}});assert.equal((await a.next('error')).code,'INVALID_SIGNAL');
    a.send({type:'signal',to:sb.playerId,data:{kind:'offer',sdp:'v=0\r\n'+'x'.repeat(2000)}});
    const signal=await b.next('signal');assert.equal(signal.from,sa.playerId);assert.ok(signal.data.sdp.length>1024);
    a.send({type:'signal',to:sb.playerId,data:{kind:'offer',sdp:'v=0',bad:true}});assert.equal((await a.next('error')).code,'INVALID_SIGNAL');
    const closed=once(c.ws,'close');c.send({type:'move',padding:'x'.repeat(1100)});assert.equal((await closed)[0],1009);
  }finally{await app.close();}
});
test('refresh takeover rotates token, preserves one seat, and stale close cannot disconnect new socket',async()=>{
  const app=createGameServer();app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const addr=app.server.address();assert(addr&&typeof addr!=='string');
  try{
    const url=`ws://127.0.0.1:${addr.port}/ws`,a=await connect(url);a.send({type:'create',name:'Refresh',mode:'solo-test'});const s=await a.next('session');
    const original=app.rooms.get(s.code).players.get(s.playerId)!;app.rooms.mic(app.rooms.get(s.code),original,true,.1);original.ready=true;original.ownerAuthorized=true;
    const b=await connect(url);b.send({type:'resume',code:s.code,token:s.token});const next=await b.next('session');assert.notEqual(next.token,s.token);assert.equal(original.mic,false);assert.equal(original.ready,false);assert.equal(original.ownerAuthorized,false);
    const room=app.rooms.get(s.code);assert.equal(room.players.size,1);assert.equal(room.players.get(s.playerId)?.connected,true);
    const c=await connect(url);c.send({type:'resume',code:s.code,token:s.token});assert.equal((await c.next('error')).code,'INVALID_SESSION');
    assert.equal(room.players.get(s.playerId)?.connected,true);
  }finally{await app.close();}
});

test('owner escape requires private authentication and only escapes the authenticated owner',async()=>{
  const {createHash}=await import('node:crypto');const fixture='local-test-fixture-only';
  const app=createGameServer({hunters:false,ownerSecretHash:createHash('sha256').update(fixture).digest('hex')});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const addr=app.server.address();assert(addr&&typeof addr!=='string');
  try{
    const url=`ws://127.0.0.1:${addr.port}/ws`,a=await connect(url),b=await connect(url);
    a.send({type:'create',name:'Owner'});const sa=await a.next('session');b.send({type:'join',code:sa.code,name:'Peer'});const sb=await b.next('session');
    const room=app.rooms.get(sa.code),owner=room.players.get(sa.playerId)!,peer=room.players.get(sb.playerId)!;
    for(const p of [owner,peer]){app.rooms.mic(room,p,true,.01);app.rooms.ready(room,p,true);}app.rooms.start(room,owner);
    owner.motion.x=16;owner.motion.z=2;peer.motion.x=16;peer.motion.z=2;
    b.send({type:'escape',code:fixture,owner:true});assert.equal((await b.next('error')).code,'INVALID_CODE');
    a.send({type:'owner-auth',secret:fixture});assert.equal((await a.next('owner-session')).authorized,true);
    a.send({type:'escape',code:fixture});await a.next('ack');assert.equal(owner.life,'escaped');assert.equal(peer.life,'active');assert.equal(room.phase,'playing');
    assert.equal(JSON.stringify(app.rooms.movementSnapshot(room,peer)).includes(fixture),false);
  }finally{await app.close();}
});
test('wire objectives, escape results and rematch produce a complete server round',async()=>{
  const app=createGameServer({hunters:false});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const addr=app.server.address();assert(addr&&typeof addr!=='string');
  try{
    const a=await connect(`ws://127.0.0.1:${addr.port}/ws`);a.send({type:'create',name:'Round',mode:'solo-test'});const session=await a.next('session');
    const room=app.rooms.get(session.code),p=room.players.get(session.playerId)!;app.rooms.mic(room,p,true,.01);app.rooms.ready(room,p,true);
    a.send({type:'start'});await a.next('ack');
    const {OBJECTIVES}=await import('../src/objectives.js');
    for(const c of OBJECTIVES.clues){Object.assign(p.motion,c);a.send({type:'collect',id:c.id});await a.next('ack');}
    Object.assign(p.motion,OBJECTIVES.friend);a.send({type:'rescue-friend'});await a.next('ack');
    Object.assign(room.round.friend,OBJECTIVES.gate);Object.assign(p.motion,OBJECTIVES.gate);
    a.send({type:'escape',code:room.round.escapeCode});await a.next('ack');
    assert.equal(room.round.result?.outcome,'complete');let state;do{state=await a.next('state');}while(!state.round.result);
    assert.equal(state.round.self.life,'escaped');assert.equal(state.round.result.players.length,1);
    const oldCode=room.round.escapeCode;a.send({type:'rematch'});await a.next('ack');assert.equal(room.phase,'lobby');assert.notEqual(room.round.escapeCode,oldCode);
  }finally{await app.close();}
});
