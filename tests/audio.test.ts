import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioCoordinator,voiceWeight,micNoiseAllowed,validSignal } from '../src/audio.js';
import { Rooms } from '../src/rooms.js';
function setup(){let now=0;const store=new Rooms(()=>now);const {room,player:a}=store.create('A');const {player:b}=store.join(room.code,'B');for(const p of [a,b]){store.mic(room,p,true,.1);store.ready(room,p,true);}store.start(room,a);return {store,room,a,b,time:(n:number)=>{now=n;}};}
test('calibration is sequential, enforces duration, retries once then accepts with warning',()=>{
  const {room,a,b}=setup(),cal=new AudioCoordinator();cal.request(room,a,0);cal.request(room,b,0);
  assert.equal(cal.snapshot(room).active?.playerId,a.id);assert.deepEqual(cal.snapshot(room).queue,[b.id]);
  assert.throws(()=>cal.finish(room,a,.1,false,4999));assert.throws(()=>cal.finish(room,b,.1,false,5000));
  assert.equal(cal.finish(room,a,.1,true,5000).retry,true);assert.equal(cal.snapshot(room).active?.quiet,true);
  const accepted=cal.finish(room,a,.2,true,10000);assert.equal(accepted.warning,true);assert.equal(accepted.retry,false);
  assert.equal(cal.snapshot(room).active?.playerId,b.id);assert.throws(()=>cal.finish(room,b,NaN,false,15000));
  cal.finish(room,b,.1,false,15000);assert.equal(cal.snapshot(room).active,null);
});
test('calibration cancellation, abandoned active slot and disconnected queues do not block team',()=>{
  const {room,a,b}=setup(),cal=new AudioCoordinator();cal.request(room,a,0);cal.request(room,b,0);
  cal.pump(room,21000);assert.equal(cal.snapshot(room).active?.playerId,b.id);
  cal.cancel(room,b,21000);assert.equal(cal.snapshot(room).active,null);
  cal.request(room,a,22000);cal.request(room,b,22000);b.connected=false;cal.cancel(room,a,22001);
  assert.equal(cal.snapshot(room).active,null);
});
test('proximity gain fades at eight metres and walls attenuate; lobby and spectator policies differ',()=>{
  const {room,a,b}=setup();a.motion.x=16;a.motion.z=16;b.motion.x=16;b.motion.z=20;
  assert.equal(voiceWeight(room,a,b),.5);b.motion.z=24;assert.equal(voiceWeight(room,a,b),0);
  a.motion.x=8;a.motion.z=8;b.motion.x=11;b.motion.z=8;assert.ok(Math.abs(voiceWeight(room,a,b)-.625*.55)<1e-9);
  a.voiceRole='spectator';assert.equal(voiceWeight(room,a,b),1);
  a.voiceRole='downed';assert.equal(micNoiseAllowed(a.voiceRole),false);assert.ok(voiceWeight(room,a,b)<1);
  room.phase='lobby';assert.equal(voiceWeight(room,a,b),1);a.voiceAvailable=false;assert.equal(voiceWeight(room,a,b),0);
});
test('mic levels have validation, threshold, rate limit and no downed/spectator AI contribution',()=>{
  const {store,room,a,time}=setup();assert.throws(()=>store.micLevel(room,a,NaN));assert.throws(()=>store.micLevel(room,a,2));
  store.micLevel(room,a,.05);assert.equal(room.noises.length,0);
  time(250);store.micLevel(room,a,.3);assert.equal(room.noises.length,1);
  store.micLevel(room,a,.3);assert.equal(room.noises.length,1);
  for(const role of ['downed','spectator'] as const){a.voiceRole=role;time(role==='downed'?500:750);store.micLevel(room,a,.8);assert.equal(room.noises.length,1);}
  assert.equal(micNoiseAllowed('active'),true);
});
test('footsteps come from displacement, no steps when stopped or blocked',()=>{
  const {store,room,a,time}=setup();for(let n=0;n<20;n++){time(n*50);store.step();}assert.equal(room.soundEvents.length,0);
  for(let n=0;n<20;n++){time(1000+n*50);store.move(room,a,{seq:n,x:1,z:0,yaw:0,mode:'walk'});store.step();}
  assert.ok(room.soundEvents.some(e=>e.kind==='step'));
  a.motion.x=.3;a.motion.z=2;room.soundEvents=[];
  for(let n=20;n<50;n++){time(1000+n*50);store.move(room,a,{seq:n,x:-1,z:0,yaw:0,mode:'walk'});store.step();}
  assert.equal(room.soundEvents.length,0);
});
test('signal schema excludes extra fields and oversized SDP while allowing valid ICE',()=>{
  assert.equal(validSignal({kind:'offer',sdp:'v=0'}),true);assert.equal(validSignal({kind:'answer',sdp:'x'.repeat(13000)}),false);
  assert.equal(validSignal({kind:'offer',sdp:'v=0',token:'secret'}),false);
  assert.equal(validSignal({kind:'ice',candidate:'candidate:...',sdpMid:'0',sdpMLineIndex:0}),true);
  assert.equal(validSignal({kind:'ice',candidate:'x',sdpMid:'0',sdpMLineIndex:-1}),false);
});

test('microphone noise leads a hunter to the observed position, not a hidden live tracker',()=>{
  const {store,room,a,b,time}=setup();a.motion.x=16;a.motion.z=12;b.motion.x=2;b.motion.z=2;
  Object.assign(room.hunters[0],{x:16,z:16,yaw:Math.PI});
  time(250);store.micLevel(room,a,.5);store.aiStep();
  assert.equal(room.hunters[0].state,'investigate');assert.deepEqual(room.hunters[0].goal,{x:16,z:12});
  assert.equal(room.hunters[0].targetId,null);
});
