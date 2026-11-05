import {performance}from'node:perf_hooks';
import {Rooms}from'../src/rooms.js';
// Deterministic, accelerated simulation benchmark, not an external-device capacity claim.
let now=0;const rooms=new Rooms(()=>now);const players=[];
for(let i=0;i<20;i++){
  const {room,player}=rooms.create(`host ${i}`);const team=[player];for(let j=1;j<4;j++)team.push(rooms.join(room.code,`peer ${j}`).player);
  for(const p of team){rooms.mic(room,p,true,.01);rooms.ready(room,p,true);}rooms.start(room,player);
  for(const p of team)p.invulnerableUntil=Number.MAX_SAFE_INTEGER;players.push({room,team});
}
const timings:number[]=[];const start=performance.now();
for(let tick=0;tick<600;tick++){
  now+=50;for(const{room,team}of players)for(const p of team)rooms.move(room,p,{seq:tick,x:Math.sin(tick/30),z:Math.cos(tick/30),yaw:0,mode:'walk'});
  const t=performance.now();rooms.step();if(tick%2===0)rooms.aiStep();timings.push(performance.now()-t);
}
timings.sort((a,b)=>a-b);console.log(JSON.stringify({rooms:20,players:80,simulatedSeconds:30,elapsedMs:Math.round(performance.now()-start),p95TickMs:Number(timings[Math.floor(timings.length*.95)].toFixed(2)),maxTickMs:Number(timings.at(-1)!.toFixed(2)),heapMiB:Number((process.memoryUsage().heapUsed/1024/1024).toFixed(1))},null,2));
