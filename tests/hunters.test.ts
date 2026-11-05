import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newHunters, stepHunters, sees, findPath, segmentClear } from '../src/hunters.js';
import { closedDoors, initialDoors } from '../src/map.js';
import { blocked } from '../src/movement.js';
import { Rooms } from '../src/rooms.js';
test('patrols move on server without crossing geometry',()=>{
  const hs=newHunters(),doors=initialDoors();
  const start=hs.map(h=>({x:h.x,z:h.z}));
  for(let n=0;n<150;n++) {
    const before=hs.map(h=>({x:h.x,z:h.z}));stepHunters(hs,[],doors,[]);
    hs.forEach((h,i)=>{assert.equal(blocked(h.x,h.z),false);assert.ok(segmentClear(before[i],h,[]));assert.ok(Math.hypot(h.x-before[i].x,h.z-before[i].z)<=.221);});
  }
  hs.forEach((h,i)=>assert.ok(Math.hypot(h.x-start[i].x,h.z-start[i].z)>1));
});
test('vision respects front cone, dark range, walls and door state',()=>{
  const [h,r]=newHunters();Object.assign(h,{x:16,z:16,yaw:0});Object.assign(r,{x:16,z:16,yaw:0});
  assert.equal(sees(h,{x:16,z:12},[]),true);assert.equal(sees(h,{x:16,z:20},[]),false);
  assert.equal(sees(h,{x:16,z:9},[]),false); // 6m dark range
  const angled={x:16+4*Math.sin(Math.PI*50/180),z:16-4*Math.cos(Math.PI*50/180)};
  assert.equal(sees(h,angled,[]),false);assert.equal(sees(r,angled,[]),true);
  Object.assign(h,{x:8,z:8,yaw:-Math.PI/2});assert.equal(sees(h,{x:11,z:8},[]),false);
  Object.assign(h,{x:16,z:8,yaw:Math.PI});const p={x:16,z:11};
  assert.equal(sees(h,p,[]),true);const d=initialDoors();d['court-north']=false;
  assert.equal(sees(h,p,closedDoors(d)),false);
});
test('chase targets only visible positions, then investigates last observed location',()=>{
  const hs=newHunters();const h=hs[0];Object.assign(h,{x:16,z:16,yaw:0});
  stepHunters([h],[{id:'p',x:16,z:12}],initialDoors(),[]);
  assert.equal(h.state,'chase');assert.equal(h.targetId,'p');assert.deepEqual(h.goal,{x:16,z:12});
  const before={...h};stepHunters([h],[{id:'p',x:29,z:29}],initialDoors(),[]);
  assert.equal(h.state,'investigate');assert.equal(h.targetId,null);assert.deepEqual(h.goal,{x:16,z:12});
  assert.ok(Math.hypot(h.x-before.x,h.z-before.z)<=.221);
  for(let n=0;n<100;n++)stepHunters([h],[],initialDoors(),[]);
  assert.equal(h.state,'patrol');
});
test('Hamza hears farther and wall attenuation applies without tracking a player',()=>{
  const [h,r]=newHunters();for(const hunter of [h,r])Object.assign(hunter,{x:16,z:16,yaw:0});
  // Within 18*.55 metres but outside 10*.55, behind the west courtyard wall.
  const sound={x:7,z:16};const doors=initialDoors();doors['court-west']=false;
  stepHunters([h,r],[],doors,[sound]);
  assert.equal(h.state,'investigate');assert.deepEqual(h.goal,sound);assert.equal(h.targetId,null);
  assert.equal(r.state,'patrol');
});
test('navigation routes around closed doors and rejects solid destinations',()=>{
  const doors=initialDoors();doors['court-north']=false;const extra=closedDoors(doors);
  const start={x:16,z:8},goal={x:16,z:12};
  assert.equal(segmentClear(start,goal,extra),false);
  const path=findPath(start,goal,extra);assert.ok(path.length>2);
  let last=start;for(const p of path){assert.equal(segmentClear(last,p,extra),true);last=p;}
  assert.deepEqual(last,goal);assert.deepEqual(findPath(start,{x:9.5,z:8},extra),[]);
});
test('AI is scoped to playing rooms; door noise is consumed and internal targets are not broadcast',()=>{
  const store=new Rooms();const {room,player:a}=store.create('A');const {player:b}=store.join(room.code,'B');
  const initial=room.hunters[0].z;store.aiStep();assert.equal(room.hunters[0].z,initial);
  for(const p of [a,b]){store.mic(room,p,true,.1);store.ready(room,p,true);}store.start(room,a);
  a.motion.x=3;a.motion.z=5;store.door(room,a,'entry-west',false);assert.equal(room.noises.length,1);
  store.aiStep();assert.equal(room.noises.length,0);
  assert.equal(store.huntersSnapshot(room).hunters.length,2);
  const snapshot=JSON.stringify(store.huntersSnapshot(room));assert.equal(snapshot.includes('goal'),false);assert.equal(snapshot.includes('route'),false);
  const other=store.create('Other');assert.notEqual(other.room.hunters,room.hunters);
});

test('a door cannot close through a hunter body',()=>{
  const store=new Rooms();const {room,player:a}=store.create('A');const {player:b}=store.join(room.code,'B');
  for(const p of [a,b]){store.mic(room,p,true,.1);store.ready(room,p,true);}store.start(room,a);
  a.motion.x=3;a.motion.z=5;Object.assign(room.hunters[0],{x:3,z:6.15});
  assert.throws(()=>store.door(room,a,'entry-west',false),/أثناء عبور/);
});
