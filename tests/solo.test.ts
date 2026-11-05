import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rooms, GameError } from '../src/rooms.js';
const rejects=(fn:()=>void,code:string)=>assert.throws(fn,(e:unknown)=>e instanceof GameError&&e.code===code);
test('solo test starts with one calibrated ready player; mic is still required',()=>{
  const store=new Rooms();const {room,player}=store.create('Tester','solo-test');
  rejects(()=>store.start(room,player),'NOT_READY');
  rejects(()=>store.ready(room,player,true),'MIC_REQUIRED');
  store.mic(room,player,true,.1);store.ready(room,player,true);store.start(room,player);
  assert.equal(room.phase,'playing');assert.equal(store.snapshot(room).mode,'solo-test');
  store.move(room,player,{seq:1,x:1,z:0,yaw:0,mode:'walk'});store.step();store.aiStep();
  assert.ok(player.motion.x>2);assert.equal(room.hunters.length,2);
});
test('solo rooms cannot be joined and resume retains mode',()=>{
  const store=new Rooms();const {room,player}=store.create('Tester','solo-test');
  rejects(()=>store.join(room.code,'Other'),'SOLO_ROOM');
  const token=player.token;store.disconnect(room,player);store.resume(room.code,token);
  assert.equal(room.mode,'solo-test');assert.equal(room.players.size,1);
  assert.equal(player.ready,false);
});
test('cooperative default still requires two; unknown modes are rejected',()=>{
  const store=new Rooms();rejects(()=>store.create('Tester','free'),'INVALID_MODE');
  const {room,player}=store.create('Tester');store.mic(room,player,true,.1);store.ready(room,player,true);
  assert.equal(room.mode,'coop');rejects(()=>store.start(room,player),'NOT_READY');
});
