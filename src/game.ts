import { randomInt } from 'node:crypto';
import type { Room, Player } from './rooms.js';
import { closedDoors } from './map.js';
import { segmentClear, sees, findPath, type Point } from './hunters.js';
export type Life='active'|'downed'|'last-chance'|'eliminated'|'escaped';
import { OBJECTIVES } from './objectives.js';
export { OBJECTIVES } from './objectives.js';
export interface Round {
  escapeCode:string; collected:Set<string>; pickups:Set<string>; startedAt:number;
  roster:Map<string,{id:string;name:string;life:Life}>;
  friend:Point&{state:'trapped'|'following'|'lost'|'escaped';leaderId:string|null;route:Point[]};
  result:null|{outcome:'complete'|'partial'|'loss';reason:string;durationSeconds:number;revives:number;players:{id:string;name:string;life:Life}[]};
  revives:number;
}
export function newRound(previous=''):Round{let code;do{code=String(randomInt(10000)).padStart(4,'0');}while(code===previous);return {escapeCode:code,collected:new Set(),pickups:new Set(),startedAt:0,roster:new Map(),friend:{...OBJECTIVES.friend,state:'trapped',leaderId:null,route:[]},result:null,revives:0};}
export function resetPlayer(p:Player){p.life='active';p.hearts=3;p.lastRescueUsed=false;p.ammo=1;p.revive=null;p.invulnerableUntil=0;p.panelUntil=0;p.spectating=null;p.voiceRole='active';}
export function canAct(p:Player){return p.connected&&p.mic&&p.life==='active';}
export function near(room:Room,p:Point,target:Point,range=1.5){return Math.hypot(p.x-target.x,p.z-target.z)<=range&&segmentClear(p,target,closedDoors(room.doors),true);}
export function catchPlayer(room:Room,p:Player){
  if(p.life!=='active'||room.tick<p.invulnerableUntil)return;
  p.hearts=Math.max(0,p.hearts-1);p.life=p.hearts>0?'downed':p.lastRescueUsed?'eliminated':'last-chance';
  p.voiceRole=p.life==='eliminated'?'spectator':'downed';p.motion.input=null;p.revive=null;
  for(const other of room.players.values())if(other.revive?.targetId===p.id)other.revive=null;
}
export function finishIfNeeded(room:Room){
  if(room.phase!=='playing')return;
  for(const p of room.players.values())room.round.roster.set(p.id,{id:p.id,name:p.name,life:p.life});
  const roster=[...room.round.roster.values()];
  const allEscaped=roster.length>0&&roster.every(p=>p.life==='escaped');
  if(!allEscaped&&roster.some(p=>p.life==='active'))return;
  room.phase='finished';
  room.round.result={outcome:allEscaped?(room.round.friend.state==='escaped'?'complete':'partial'):'loss',reason:allEscaped?(room.round.friend.state==='escaped'?'خرجتم جميعًا ومعكم سليم':'خرجتم… وسليم لم يخرج معكم'):(roster.some(p=>p.life==='escaped')?'انتهت الجولة دون هروب الجميع':'لم يبق لاعب نشط'),durationSeconds:Math.round((room.tick-room.round.startedAt)/20),revives:room.round.revives,players:roster};
  for(const p of room.players.values()){p.revive=null;p.motion.input=null;p.voiceRole='spectator';}
}
export function departed(room:Room,p:Player){if(room.phase==='playing'){room.round.roster.set(p.id,{id:p.id,name:p.name,life:p.life==='escaped'?'escaped':'eliminated'});}}
export function roundStep(room:Room){
  if(room.phase!=='playing')return;
  const walls=closedDoors(room.doors);
  for(const p of room.players.values()){
    if(p.life==='active'&&room.hunters.some(h=>h.state!=='stunned'&&Math.hypot(h.x-p.motion.x,h.z-p.motion.z)<=1.1&&sees(h,p.motion,walls)))catchPlayer(room,p);
  }
  for(const p of room.players.values()){
    const action=p.revive;if(!action)continue;const target=room.players.get(action.targetId);
    if(!canAct(p)||!target||!['downed','last-chance'].includes(target.life)||!near(room,p.motion,target.motion)||room.tick-action.lastHeldTick>8){p.revive=null;continue;}
    if(room.tick-action.startedTick>=200){
      if(target.life==='last-chance')target.lastRescueUsed=true;
      target.life='active';target.voiceRole='active';target.invulnerableUntil=room.tick+40;target.motion.input=null;
      p.revive=null;room.round.revives++;
      for(const other of room.players.values())if(other.revive?.targetId===target.id)other.revive=null;
    }
  }
  const friend=room.round.friend;
  if(friend.state==='following'){
    const active=[...room.players.values()].filter(p=>p.life==='active');
    const leader=active.find(p=>p.id===friend.leaderId)||active.sort((a,b)=>Math.hypot(a.motion.x-friend.x,a.motion.z-friend.z)-Math.hypot(b.motion.x-friend.x,b.motion.z-friend.z))[0];
    if(leader){
      friend.leaderId=leader.id;
      if(room.tick%10===0)friend.route=findPath(friend,leader.motion,walls);
      let budget=.12;
      while(friend.route.length&&budget>0&&Math.hypot(friend.x-leader.motion.x,friend.z-leader.motion.z)>1){
        const dest=friend.route[0],dx=dest.x-friend.x,dz=dest.z-friend.z,d=Math.hypot(dx,dz);
        if(d<.01){friend.route.shift();continue;}
        const step=Math.min(budget,d),next={x:friend.x+dx/d*step,z:friend.z+dz/d*step};
        if(!segmentClear(friend,next,walls)){friend.route=[];break;}Object.assign(friend,next);budget-=step;if(step===d)friend.route.shift();
      }
    }
    if(room.hunters.some(h=>h.state!=='stunned'&&near(room,h,friend,1.1))){friend.state='lost';friend.route=[];friend.leaderId=null;}
  }
  for(const p of room.players.values())if(p.life!=='active'&&(!p.spectating||room.players.get(p.spectating)?.life!=='active'))p.spectating=[...room.players.values()].find(q=>q.life==='active')?.id||null;
  finishIfNeeded(room);
}
export function roundView(room:Room,viewer?:Player){
  const f=room.round.friend;
  return {objectives:OBJECTIVES,clues:OBJECTIVES.clues.map((c,i)=>({id:c.id,collected:room.round.collected.has(c.id),digit:room.round.collected.has(c.id)?room.round.escapeCode[i]:null})),pickups:[...room.round.pickups],friend:{x:f.x,z:f.z,state:f.state},result:room.round.result,
    self:viewer?{life:viewer.life,hearts:viewer.hearts,ammo:viewer.ammo,lastRescueUsed:viewer.lastRescueUsed,panelTicks:Math.max(0,viewer.panelUntil-room.tick),spectating:viewer.spectating,revive:viewer.revive?{targetId:viewer.revive.targetId,progress:Math.min(1,(room.tick-viewer.revive.startedTick)/200)}:null}:null};
}
