import {findPath}from'../src/hunters.js';import{closedDoors}from'../src/map.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rooms,GameError } from '../src/rooms.js';
import { catchPlayer,OBJECTIVES,roundView,roundStep,finishIfNeeded } from '../src/game.js';
import { stepHunters } from '../src/hunters.js';
const rejects=(fn:()=>void,code:string)=>assert.throws(fn,(e:unknown)=>e instanceof GameError&&e.code===code);
function setup(solo=false){const store=new Rooms();const {room,player:a}=store.create('A',solo?'solo-test':'coop');const b=solo?null:store.join(room.code,'B').player;for(const p of [a,b].filter(Boolean) as typeof a[]){store.mic(room,p,true,.01);store.ready(room,p,true);}store.start(room,a);return {store,room,a,b:b!};}
function revive(s:ReturnType<typeof setup>,target=s.a,actor=s.b){actor.motion.x=target.motion.x+.6;actor.motion.z=target.motion.z;for(let n=0;n<=200&&target.life!=='active';n++){s.store.revive(s.room,actor,target.id);s.room.tick++;roundStep(s.room);}}
test('three hearts, 10s revive, final rescue once, then permanent elimination',()=>{
  const s=setup();catchPlayer(s.room,s.a);assert.equal(s.a.hearts,2);assert.equal(s.a.life,'downed');assert.equal(s.a.voiceRole,'downed');
  rejects(()=>s.store.move(s.room,s.a,{seq:1,x:1,z:0,yaw:0,mode:'walk'}),'NOT_ACTIVE');
  revive(s);assert.equal(s.a.life,'active');assert.equal(s.a.hearts,2);
  s.room.tick=s.a.invulnerableUntil;catchPlayer(s.room,s.a);revive(s);s.room.tick=s.a.invulnerableUntil;catchPlayer(s.room,s.a);
  assert.equal(s.a.hearts,0);assert.equal(s.a.life,'last-chance');revive(s);assert.equal(s.a.lastRescueUsed,true);
  s.room.tick=s.a.invulnerableUntil;catchPlayer(s.room,s.a);assert.equal(s.a.life,'eliminated');assert.equal(s.a.voiceRole,'spectator');
});
test('revive heartbeat stops/reset; hitting rescuer cancels; nearby hunter alone does not',()=>{
  const s=setup();catchPlayer(s.room,s.a);s.b.motion.x=2.8;s.b.motion.z=2;
  s.store.revive(s.room,s.b,s.a.id);s.room.tick+=9;roundStep(s.room);assert.equal(s.b.revive,null);
  s.store.revive(s.room,s.b,s.a.id);s.room.tick+=4;roundStep(s.room);assert.ok(s.b.revive);
  catchPlayer(s.room,s.b);assert.equal(s.b.revive,null);finishIfNeeded(s.room);assert.equal(s.room.phase,'finished');assert.equal(s.room.round.result?.outcome,'loss');
});
test('catch uses distance, vision and closed walls; stun prevents catch',()=>{
  const s=setup();s.a.motion.x=16;s.a.motion.z=16;const h=s.room.hunters[0];Object.assign(h,{x:16,z:16.9,yaw:0});roundStep(s.room);assert.equal(s.a.life,'downed');
  const t=setup();t.a.motion.x=16;t.a.motion.z=8.8;Object.assign(t.room.hunters[0],{x:16,z:10.2,yaw:0});t.room.doors['court-north']=false;roundStep(t.room);assert.equal(t.a.life,'active');
  t.a.motion.z=16;Object.assign(t.room.hunters[0],{x:16,z:16.5,yaw:0,state:'stunned',stunnedUntilTick:200});roundStep(t.room);assert.equal(t.a.life,'active');
});
test('ammo, hit ray, cover, 10s stun and no client location override',()=>{
  const s=setup();s.a.motion.x=16;s.a.motion.z=16;s.a.motion.yaw=0;const h=s.room.hunters[0];Object.assign(h,{x:16,z:12});
  s.store.shoot(s.room,s.a);assert.equal(s.a.ammo,0);assert.equal(h.state,'stunned');assert.equal(h.stunnedUntilTick,200);rejects(()=>s.store.shoot(s.room,s.a),'NO_AMMO');
  const before={x:h.x,z:h.z};stepHunters([h],[],s.room.doors,[],199);assert.equal(h.state,'stunned');assert.deepEqual({x:h.x,z:h.z},before);stepHunters([h],[],s.room.doors,[],200);assert.notEqual(h.state,'stunned');
  s.a.ammo=1;s.a.motion.x=8;s.a.motion.z=8;s.a.motion.yaw=-Math.PI/2;Object.assign(h,{x:11,z:8,state:'patrol'});s.store.shoot(s.room,s.a);assert.equal(h.state,'patrol');assert.equal(s.a.ammo,0);
});
test('clue collection is distance checked, unique, and unrevealed code stays private',()=>{
  const s=setup();assert.equal(roundView(s.room,s.a).clues.every(c=>c.digit===null),true);rejects(()=>s.store.collect(s.room,s.a,'clue-1'),'INVALID_PICKUP');
  for(const c of OBJECTIVES.clues){Object.assign(s.a.motion,c);s.store.collect(s.room,s.a,c.id);rejects(()=>s.store.collect(s.room,s.a,c.id),'ALREADY_COLLECTED');}
  assert.equal(roundView(s.room,s.a).clues.map(c=>c.digit).join(''),s.room.round.escapeCode);
  assert.equal(JSON.stringify(s.store.movementSnapshot(s.room,s.a)).includes('escapeCode'),false);
  const ammo=OBJECTIVES.ammo[0];Object.assign(s.a.motion,ammo);s.store.collect(s.room,s.a,ammo.id);assert.equal(s.a.ammo,2);rejects(()=>s.store.collect(s.room,s.a,ammo.id),'ALREADY_COLLECTED');
});
test('wrong code causes noise and 8s lock; escape does not end round for remaining active player',()=>{
  const s=setup();Object.assign(s.a.motion,OBJECTIVES.gate);const wrong=s.room.round.escapeCode==='0000'?'0001':'0000';
  rejects(()=>s.store.escape(s.room,s.a,wrong),'WRONG_CODE');assert.equal(s.a.panelUntil,160);assert.ok(s.room.noises.length>0);rejects(()=>s.store.escape(s.room,s.a,s.room.round.escapeCode),'PANEL_LOCKED');
  s.room.tick=160;s.store.escape(s.room,s.a,s.room.round.escapeCode);assert.equal(s.room.phase,'playing');assert.equal(s.a.life,'escaped');assert.equal(s.a.voiceRole,'spectator');
  s.store.spectate(s.room,s.a,s.b.id);assert.equal(s.a.spectating,s.b.id);
  Object.assign(s.b.motion,OBJECTIVES.gate);s.store.escape(s.room,s.b,s.room.round.escapeCode);assert.equal(s.room.phase,'finished');assert.equal(s.room.round.result?.outcome,'partial');
  s.store.rematch(s.room,s.a);assert.equal(s.room.phase,'lobby');assert.equal(s.a.hearts,3);assert.equal(s.a.ammo,1);assert.equal(s.a.ready,false);assert.equal(s.room.round.collected.size,0);
});
test('Salim rescue follows, can be permanently lost, or can escape for complete ending',()=>{
  const s=setup();Object.assign(s.a.motion,OBJECTIVES.friend);s.store.rescueFriend(s.room,s.a);assert.equal(s.room.round.friend.state,'following');
  s.a.motion.z=23;s.a.invulnerableUntil=1000;for(let i=0;i<20;i++){s.room.tick++;roundStep(s.room);}assert.equal(s.room.round.friend.state,'following');
  Object.assign(s.room.hunters[0],{x:s.room.round.friend.x,z:s.room.round.friend.z});roundStep(s.room);assert.equal(s.room.round.friend.state,'lost');rejects(()=>s.store.rescueFriend(s.room,s.a),'INVALID_RESCUE');
  const t=setup(true);Object.assign(t.a.motion,OBJECTIVES.friend);t.store.rescueFriend(t.room,t.a);Object.assign(t.room.round.friend,OBJECTIVES.gate);Object.assign(t.a.motion,OBJECTIVES.gate);t.store.escape(t.room,t.a,t.room.round.escapeCode);assert.equal(t.room.round.friend.state,'escaped');assert.equal(t.room.round.result?.outcome,'complete');
});
test('disconnect is frozen but no mic timeout; departures count as eliminated and can end round',()=>{
  const s=setup();s.store.mic(s.room,s.a,false,null);roundStep(s.room);assert.equal(s.room.phase,'playing');s.store.leave(s.room,s.a);catchPlayer(s.room,s.b);finishIfNeeded(s.room);assert.equal(s.room.round.result?.outcome,'loss');assert.equal(s.room.round.result?.players.length,2);
});
test('personalized state hides distant or occluded positions and internal game data',()=>{
  const s=setup();s.b.motion.x=29;s.b.motion.z=18;
  const state=s.store.movementSnapshot(s.room,s.a);assert.equal(state.players.length,1);assert.equal(state.players[0].id,s.a.id);assert.equal(s.store.huntersSnapshot(s.room,s.a).hunters.some(h=>h.id==='rana'),false);
  const json=JSON.stringify(state);assert.equal(json.includes(s.a.token),false);assert.equal(json.includes('ownerAuthorized'),false);
});
test('full playable objective loop walks shared navigation, rescues Salim and escapes without teleporting',()=>{
  const s=setup(true);for(const h of s.room.hunters){h.state='stunned';h.stunnedUntilTick=100000;}
  const walk=(target:{x:number;z:number})=>{
    const path=findPath(s.a.motion,target,closedDoors(s.room.doors));assert.ok(path.length);
    for(const p of path)for(let n=0;n<500&&Math.hypot(s.a.motion.x-p.x,s.a.motion.z-p.z)>.01;n++){
      const dx=p.x-s.a.motion.x,dz=p.z-s.a.motion.z,d=Math.hypot(dx,dz),factor=Math.min(1,d/.12)/d;
      s.store.move(s.room,s.a,{seq:s.room.tick+1,x:dx*factor,z:dz*factor,yaw:0,mode:'walk'});s.store.step();
    }
    assert.ok(Math.hypot(s.a.motion.x-target.x,s.a.motion.z-target.z)<.02);
  };
  for(const c of OBJECTIVES.clues){walk(c);s.store.collect(s.room,s.a,c.id);}
  walk(OBJECTIVES.friend);s.store.rescueFriend(s.room,s.a);walk(OBJECTIVES.gate);
  s.a.motion.input=null;for(let n=0;n<500&&Math.hypot(s.room.round.friend.x-16,s.room.round.friend.z-2)>1.8;n++)s.store.step();
  assert.ok(Math.hypot(s.room.round.friend.x-16,s.room.round.friend.z-2)<=1.8);
  s.store.escape(s.room,s.a,s.room.round.escapeCode);assert.equal(s.room.round.result?.outcome,'complete');
});
test('pitch prevents ground shots; solo catch ends round; room codes normalize Arabic digits',()=>{
  const s=setup(true);s.a.motion.x=16;s.a.motion.z=16;s.a.motion.yaw=0;s.a.motion.pitch=-1;Object.assign(s.room.hunters[0],{x:16,z:12});s.store.shoot(s.room,s.a);assert.notEqual(s.room.hunters[0].state,'stunned');
  catchPlayer(s.room,s.a);finishIfNeeded(s.room);assert.equal(s.room.round.result?.outcome,'loss');
  const t=setup();const old=t.room.code;t.store.rooms.delete(old);t.room.code='A102F3';t.store.rooms.set(t.room.code,t.room);assert.equal(t.store.get(' a١٠٢f٣ ').code,t.room.code);
});
test('life transitions actually bind proximity/spectator audio and exclude downed microphone noise',async()=>{
  const {voiceWeight}=await import('../src/audio.js');const s=setup();catchPlayer(s.room,s.a);s.a.lastMicLevelAt=-Infinity;s.store.micLevel(s.room,s.a,.9);assert.equal(s.room.noises.length,0);assert.equal(s.a.voiceRole,'downed');
  s.a.life='active';s.a.voiceRole='active';Object.assign(s.a.motion,OBJECTIVES.gate);s.store.escape(s.room,s.a,s.room.round.escapeCode);s.b.motion.x=29;s.b.motion.z=29;
  assert.equal(voiceWeight(s.room,s.a,s.b),1);assert.equal(voiceWeight(s.room,s.b,s.a),0);
});
