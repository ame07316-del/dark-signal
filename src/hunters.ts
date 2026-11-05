import { ARENA, closedDoors, type DoorStates, type Wall } from './map.js';
import { blocked } from './movement.js';
export interface Point { x:number; z:number }
export interface Hunter extends Point {
  id:'hamza'|'rana'; name:string; yaw:number; state:'patrol'|'investigate'|'chase'|'stunned';stunnedUntilTick:number;
  route:Point[]; patrolIndex:number; goal:Point|null; targetId:string|null; planIn:number; searchLeft:number;
}
export interface Noise extends Point { strength?:number }
export interface SeenPlayer extends Point { id:string }
export const HUNTER_TUNING = {
  hamza:{patrol:2.2,chase:4.4,hearing:18,fov:80,vision:6},
  rana:{patrol:2,chase:4.6,hearing:10,fov:110,vision:8},
};
const patrols:Record<Hunter['id'],Point[]>={
  hamza:[{x:3,z:18},{x:3,z:10},{x:7,z:10},{x:7,z:16},{x:16,z:16}],
  rana:[{x:29,z:18},{x:29,z:10},{x:24,z:10},{x:24,z:16},{x:16,z:16}],
};
export function newHunters():Hunter[] {
  return (['hamza','rana'] as const).map(id=>({id,name:id==='hamza'?'حمزة':'رنا',...patrols[id][0],yaw:0,stunnedUntilTick:0,state:'patrol',route:[],patrolIndex:1,goal:null,targetId:null,planIn:0,searchLeft:0}));
}
/** Conservative swept visibility for navigation; physical visibility uses unexpanded walls. */
export function segmentClear(a:Point,b:Point,extra:Wall[],physical=false) {
  const n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.1));
  for(let i=0;i<=n;i++) {
    const x=a.x+(b.x-a.x)*i/n,z=a.z+(b.z-a.z)*i/n;
    if(physical ? [...ARENA.walls,...extra].some(w=>x>=w.minX&&x<=w.maxX&&z>=w.minZ&&z<=w.maxZ) : blocked(x,z,extra)) return false;
  }
  return true;
}
export function sees(h:Hunter,p:Point,extra:Wall[]) {
  const t=HUNTER_TUNING[h.id],dx=p.x-h.x,dz=p.z-h.z,d=Math.hypot(dx,dz);
  return d<=t.vision && (d<.001 || (-Math.sin(h.yaw)*dx-Math.cos(h.yaw)*dz)/d>=Math.cos(t.fov*Math.PI/360)) && segmentClear(h,p,extra,true);
}
/** One metre cardinal grid; exact start/goal connectors are collision checked. */
export function findPath(start:Point,goal:Point,extra:Wall[]):Point[] {
  if(blocked(goal.x,goal.z,extra)) return [];
  if(segmentClear(start,goal,extra)) return [{...goal}];
  const near=(p:Point)=>{
    const nodes:Point[]=[];
    for(let x=Math.max(1,Math.floor(p.x)-1);x<=Math.min(31,Math.ceil(p.x)+1);x++)
      for(let z=Math.max(1,Math.floor(p.z)-1);z<=Math.min(31,Math.ceil(p.z)+1);z++)
        if(!blocked(x,z,extra)&&segmentClear(p,{x,z},extra)) nodes.push({x,z});
    return nodes.sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z));
  };
  const starts=near(start),ends=near(goal);if(!starts.length||!ends.length)return [];
  const key=(p:Point)=>p.x*33+p.z;
  const targets=new Set(ends.map(key));const queue=[starts[0]];
  const parent=new Map<number,Point|null>([[key(starts[0]),null]]);let end:Point|undefined;
  for(let i=0;i<queue.length;i++) {
    const p=queue[i];if(targets.has(key(p))){end=p;break;}
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const next={x:p.x+dx,z:p.z+dz};
      if(parent.has(key(next))||blocked(next.x,next.z,extra)||!segmentClear(p,next,extra))continue;
      parent.set(key(next),p);queue.push(next);
    }
  }
  if(!end)return [];
  const path:Point[]=[{...goal}];let node:Point|null=end;
  while(node){path.push(node);node=parent.get(key(node))!;}
  return path.reverse();
}
export function stepHunters(hunters:Hunter[],players:SeenPlayer[],doors:DoorStates,noises:Noise[],tick=0) {
  const extra=closedDoors(doors);
  for(const h of hunters) {
    if(tick<h.stunnedUntilTick){h.state='stunned';continue;}
    if(h.state==='stunned'){h.state='investigate';h.goal={x:h.x,z:h.z};h.searchLeft=1;h.route=[];h.planIn=0;}
    const tuning=HUNTER_TUNING[h.id];h.planIn-=.1;
    const seen=players.filter(p=>sees(h,p,extra)).sort((a,b)=>Math.hypot(a.x-h.x,a.z-h.z)-Math.hypot(b.x-h.x,b.z-h.z))[0];
    let changed=false;
    if(seen) {
      changed=h.state!=='chase';h.state='chase';h.targetId=seen.id;h.goal={x:seen.x,z:seen.z};h.searchLeft=2;
    } else {
      if(h.state==='chase'){h.state='investigate';h.targetId=null;changed=true;}
      const heard=noises.filter(n=>Math.hypot(n.x-h.x,n.z-h.z)<=tuning.hearing*(n.strength??1)*(segmentClear(h,n,extra,true)?1:.55))
        .sort((a,b)=>Math.hypot(a.x-h.x,a.z-h.z)-Math.hypot(b.x-h.x,b.z-h.z))[0];
      if(heard){h.state='investigate';h.goal={x:heard.x,z:heard.z};h.searchLeft=2;changed=true;}
    }
    if(h.state==='patrol') {
      const target=patrols[h.id][h.patrolIndex];
      if(Math.hypot(h.x-target.x,h.z-target.z)<.15) h.patrolIndex=(h.patrolIndex+1)%patrols[h.id].length;
      h.goal={...patrols[h.id][h.patrolIndex]};
    } else if(h.state==='investigate' && h.goal && Math.hypot(h.x-h.goal.x,h.z-h.goal.z)<.2) {
      h.searchLeft-=.1;h.yaw+=.1;
      if(h.searchLeft<=0){h.state='patrol';h.goal=null;h.route=[];h.planIn=0;}
    }
    if(h.state==='investigate' && !h.route.length && h.planIn>0 && h.goal && Math.hypot(h.x-h.goal.x,h.z-h.goal.z)>=.2) {
      h.searchLeft-=.1;
      if(h.searchLeft<=0){h.state='patrol';h.goal=null;h.planIn=0;}
    }
    if(h.goal && (changed||h.planIn<=0)) {
      h.route=findPath(h,h.goal,extra);h.planIn=.5;
      if(!h.route.length && h.state==='patrol') h.patrolIndex=(h.patrolIndex+1)%patrols[h.id].length;
    }
    let budget=(h.state==='chase'?tuning.chase:tuning.patrol)*.1;
    while(h.route.length && budget>0) {
      const p=h.route[0],dx=p.x-h.x,dz=p.z-h.z,d=Math.hypot(dx,dz);
      if(d<.001){h.route.shift();continue;}
      const distance=Math.min(d,budget),next={x:h.x+dx/d*distance,z:h.z+dz/d*distance};
      if(!segmentClear(h,next,extra)){h.route=[];h.planIn=0;break;}
      h.yaw=Math.atan2(-dx,-dz);h.x=next.x;h.z=next.z;budget-=distance;
      if(distance===d)h.route.shift();
    }
  }
}
export function hunterSnapshot(hunters:Hunter[]) {
  return hunters.map(({id,name,x,z,yaw,state})=>({id,name,x,z,yaw,state}));
}
