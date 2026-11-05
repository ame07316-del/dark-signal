import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARENA, zoneAt } from '../src/map.js';
import { advance, blocked, newMotion } from '../src/movement.js';
test('blockout walls are valid and four spawns are free and separated', () => {
  for (const w of ARENA.walls) {
    assert.ok(w.minX>=0 && w.maxX<=ARENA.maxX && w.minZ>=0 && w.maxZ<=ARENA.maxZ);
    assert.ok(w.minX<w.maxX && w.minZ<w.maxZ);
  }
  for (const [i,p] of ARENA.spawns.entries()) {
    assert.equal(blocked(p.x,p.z),false);
    for (const q of ARENA.spawns.slice(i+1)) assert.ok(Math.hypot(p.x-q.x,p.z-q.z)>.6);
    assert.equal(zoneAt(p.x,p.z),'رواق الدخول');
  }
});
test('all named areas have a traversable route from spawn, replayed through actual collision', () => {
  const start = ARENA.spawns[0];
  const key = (x:number,z:number) => `${x},${z}`;
  const queue = [{x:start.x,z:start.z}];
  const parent = new Map<string,string|null>([[key(start.x,start.z),null]]);
  for (let cursor=0;cursor<queue.length;cursor++) {
    const p=queue[cursor];
    for (const [dx,dz] of [[.5,0],[-.5,0],[0,.5],[0,-.5]]) {
      const x=p.x+dx,z=p.z+dz,k=key(x,z);
      if (parent.has(k) || blocked(x,z) || blocked(p.x+dx/2,p.z+dz/2)) continue;
      parent.set(k,key(p.x,p.z));queue.push({x,z});
    }
  }
  for (const area of ARENA.zones) {
    const target=key(area.x,area.z); assert.ok(parent.has(target),`No route to ${area.id}`);
    const path:string[]=[]; let k:string|null=target;
    while(k!==null){path.push(k);k=parent.get(k)!;}
    const m=newMotion(); let clock=0;
    for(const point of path.reverse()) {
      const [x,z]=point.split(',').map(Number);
      for(let n=0;n<20 && Math.hypot(x-m.x,z-m.z)>.001;n++) {
        const dx=x-m.x,dz=z-m.z,length=Math.hypot(dx,dz),factor=Math.min(1,length/.12)/length;
        m.input={x:dx*factor,z:dz*factor,yaw:0,mode:'walk',seq:clock,at:clock};advance(m,true,clock);clock+=50;
      }
      assert.ok(Math.hypot(m.x-x,m.z-z)<.001,`Collision blocked route to ${area.id} at ${point}`);
    }
  }
});
test('courtyard doorway permits travel while adjacent wall blocks it', () => {
  for(const [z,passes] of [[16,true],[8,false]] as const) {
    const m=newMotion();m.x=8;m.z=z;
    for(let n=0;n<30;n++){m.input={x:1,z:0,yaw:0,mode:'walk',seq:n,at:n*50};advance(m,true,n*50);}
    assert.equal(m.x>10,passes);
  }
  assert.equal(zoneAt(16,16),'الفناء المركزي');
});
