import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rooms, GameError } from '../src/rooms.js';
import { closedDoors } from '../src/map.js';
import { reconcile } from '../client/prediction.js';
const rejects=(fn:()=>void,code:string)=>assert.throws(fn,(e:unknown)=>e instanceof GameError && e.code===code);
function setup() {
  let now=0;const store=new Rooms(()=>now);const {room,player:a}=store.create('A');const {player:b}=store.join(room.code,'B');
  for(const p of [a,b]){store.mic(room,p,true,.1);store.ready(room,p,true);}store.start(room,a);
  return {store,room,a,b,time:(n:number)=>{now=n;}};
}
test('door interaction validates phase, mic, identity, distance and occlusion',()=>{
  const s=setup();const {store,room,a}=s;
  rejects(()=>store.door(room,a,'missing',true),'INVALID_DOOR');
  rejects(()=>store.door(room,a,'entry-west','yes'),'INVALID_DOOR');
  rejects(()=>store.door(room,a,'entry-west',false),'TOO_FAR');
  a.motion.x=3;a.motion.z=5;
  store.mic(room,a,false,null);rejects(()=>store.door(room,a,'entry-west',false),'MIC_REQUIRED');
  store.mic(room,a,true,.1);
  // Adjacent solid wall obstructs an apparently nearby door centre.
  a.motion.x=1.5;a.motion.z=6.6;
  rejects(()=>store.door(room,a,'entry-west',false),'DOOR_OBSTRUCTED');
  room.phase='lobby';rejects(()=>store.door(room,a,'entry-west',false),'INVALID_PHASE');
});
test('door requests are explicit, idempotent, rate limited and room isolated',()=>{
  const {store,room,a,time}=setup();a.motion.x=3;a.motion.z=5;
  store.door(room,a,'entry-west',false);assert.equal(room.doors['entry-west'],false);
  store.door(room,a,'entry-west',false); // duplicate doesn't toggle
  rejects(()=>store.door(room,a,'entry-west',true),'DOOR_COOLDOWN');
  const other=store.create('C');assert.equal(other.room.doors['entry-west'],true);
  time(500);store.door(room,a,'entry-west',true);assert.equal(room.doors['entry-west'],true);
  assert.equal(store.snapshot(room).doors['entry-west'],true);
});
test('closing is refused if any player occupies the door, including a disconnected player',()=>{
  const {store,room,a,b}=setup();a.motion.x=3;a.motion.z=5;b.motion.x=3;b.motion.z=6.15;
  rejects(()=>store.door(room,a,'entry-west',false),'DOOR_OCCUPIED');
  store.disconnect(room,b);rejects(()=>store.door(room,a,'entry-west',false),'DOOR_OCCUPIED');
  store.leave(room,b);store.door(room,a,'entry-west',false);assert.equal(room.doors['entry-west'],false);
});
test('closed door blocks actual server movement and prediction, opening restores passage',()=>{
  const {store,room,a,time}=setup();a.motion.x=3;a.motion.z=5;
  store.door(room,a,'entry-west',false);
  for(let n=0;n<20;n++) {
    time(n*50);store.move(room,a,{seq:n,x:0,z:1,yaw:0,mode:'walk'});store.step();
  }
  assert.ok(a.motion.z<=5.7);assert.ok(a.motion.z>5.5);
  const frozenZ=a.motion.z;
  reconcile(a.motion,{x:3,z:frozenZ,yaw:0,ackSeq:19,frozen:false},[{seq:20,x:0,z:1,yaw:0,mode:'walk'}],1000,closedDoors(room.doors));
  assert.ok(a.motion.z<=5.7);
  time(1000);store.door(room,a,'entry-west',true);
  for(let n=20;n<40;n++) { time(n*50);store.move(room,a,{seq:n,x:0,z:1,yaw:0,mode:'walk'});store.step(); }
  assert.ok(a.motion.z>6.3);
  assert.equal(store.movementSnapshot(room).doors['entry-west'],true);
});
