import { newRound, resetPlayer, canAct, near, roundStep, roundView, departed, finishIfNeeded, OBJECTIVES, type Round, type Life } from './game.js';
import { segmentClear } from './hunters.js';
import { micNoiseAllowed, type VoiceRole } from './audio.js';
import { newHunters, stepHunters, hunterSnapshot, type Hunter, type Noise } from './hunters.js';
import { initialDoors, closedDoors, doorDistance, type DoorStates } from './map.js';
import { blocked, PLAYER_RADIUS } from './movement.js';
import { ARENA, advance, newMotion, type Motion } from './movement.js';
import { randomBytes, randomUUID } from 'node:crypto';

export class GameError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
function fail(code: string, message: string): never { throw new GameError(code, message); }
export interface Player { life:Life;hearts:number;lastRescueUsed:boolean;ammo:number;revive:{targetId:string;startedTick:number;lastHeldTick:number}|null;invulnerableUntil:number;panelUntil:number;spectating:string|null;ownerAuthorized:boolean;
  voiceAvailable:boolean; calibrated:boolean; voiceRole: VoiceRole; stepDistance:number; lastMicLevelAt:number; lastDoorAt: number; motion: Motion; id: string; name: string; token: string; connected: boolean; ready: boolean;
  mic: boolean; threshold: number | null; disconnectedAt: number | null;
}
export interface SoundEvent { id:number; kind:'door'|'step'; x:number; z:number; strength:number }
export interface Room { round:Round; soundEvents:SoundEvent[]; soundSeq:number; mode: 'coop' | 'solo-test'; hunters: Hunter[]; noises: Noise[]; doors: DoorStates; code: string; hostId: string; phase: 'lobby' | 'playing' | 'finished'; tick: number; players: Map<string, Player> }
export class Rooms {
  readonly rooms = new Map<string, Room>();
  constructor(private now = Date.now, private maxRooms = 100) {}
  private name(value: unknown): string {
    if (typeof value !== 'string') return fail('INVALID_NAME', 'اكتب اسمًا صالحًا.');
    const name = value.normalize('NFKC').trim();
    if (!/^[\p{L}\p{N} _-]{1,20}$/u.test(name)) return fail('INVALID_NAME', 'الاسم من ١ إلى ٢٠ حرفًا أو رقمًا، بلا رموز خاصة.');
    return name;
  }
  private player(name: string): Player {
    return { life:'active',hearts:3,lastRescueUsed:false,ammo:1,revive:null,invulnerableUntil:0,panelUntil:0,spectating:null,ownerAuthorized:false,voiceAvailable:false, calibrated:false, voiceRole:'active', stepDistance:0, lastMicLevelAt:-Infinity, lastDoorAt: -Infinity, motion: newMotion(), id: randomUUID(), name, token: randomBytes(32).toString('hex'), connected: true, ready: false, mic: false, threshold: null, disconnectedAt: null };
  }
  create(value: unknown, mode: unknown = 'coop') {
    if (mode !== 'coop' && mode !== 'solo-test') return fail('INVALID_MODE', 'وضع الغرفة غير صالح.');
    const name = this.name(value);
    if (this.rooms.size >= this.maxRooms) return fail('SERVER_FULL', 'الخادم ممتلئ، حاول لاحقًا.');
    let code: string;
    do { code = randomBytes(4).toString('hex').slice(0, 6).toUpperCase(); } while (this.rooms.has(code));
    const player = this.player(name);
    const room: Room = { round:newRound(), soundEvents:[], soundSeq:0, mode, hunters: newHunters(), noises: [], doors: initialDoors(), code, hostId: player.id, phase: 'lobby', tick: 0, players: new Map([[player.id, player]]) };
    this.rooms.set(code, room); return { room, player };
  }
  join(code: unknown, value: unknown) {
    const room = this.get(code); const name = this.name(value);
    if (room.mode === 'solo-test') return fail('SOLO_ROOM', 'هذه غرفة تجربة فردية ولا تقبل انضمام لاعبين آخرين.');
    if (room.phase !== 'lobby') return fail('ROUND_STARTED', 'الجولة بدأت بالفعل.');
    if (room.players.size >= 4) return fail('ROOM_FULL', 'الغرفة ممتلئة.');
    if ([...room.players.values()].some(p => p.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return fail('NAME_TAKEN', 'الاسم مستخدم في الغرفة.');
    const player = this.player(name); room.players.set(player.id, player); return { room, player };
  }
  get(code: unknown): Room {
    if (typeof code !== 'string') return fail('ROOM_NOT_FOUND', 'رمز الغرفة غير صحيح أو منتهي.');
    const room = this.rooms.get(code.normalize('NFKC').trim().replace(/[٠-٩۰-۹]/g,c=>String(c.charCodeAt(0)-(c>='۰'?'۰'.charCodeAt(0):'٠'.charCodeAt(0)))).toUpperCase());
    if (!room) return fail('ROOM_NOT_FOUND', 'رمز الغرفة غير صحيح أو منتهي.'); return room;
  }
  resume(code: unknown, token: unknown) {
    const room = this.get(code);
    const player = [...room.players.values()].find(p => typeof token === 'string' && p.token === token);
    if (!player || (!player.connected && (player.disconnectedAt === null || this.now() - player.disconnectedAt >= 30_000)))
      return fail('INVALID_SESSION', 'الجلسة غير صالحة أو انتهت مهلة العودة.');
    player.ownerAuthorized=false;player.mic=false;player.voiceAvailable=false;player.calibrated=false;player.threshold=null;player.ready=false;player.motion.input=null;player.revive=null;player.connected = true; player.disconnectedAt = null; player.token = randomBytes(32).toString('hex');this.transfer(room);
    // Reconnection requires microphone setup again; readiness never survives a disconnect.
    return { room, player };
  }
  mic(room: Room, player: Player, available: unknown, threshold: unknown) {
    if (typeof available !== 'boolean' || (available && (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0 || threshold > 1)))
      return fail('INVALID_MIC', 'بيانات معايرة المايك غير صالحة.');
    player.mic = available; player.voiceAvailable=available;player.calibrated=available; player.threshold = available ? threshold as number : null;
    if (!available) { player.ready = false; player.motion.input = null; }
  }
  ready(room: Room, player: Player, ready: unknown) {
    if (room.phase !== 'lobby') return fail('INVALID_PHASE', 'الجولة بدأت بالفعل.');
    if (typeof ready !== 'boolean') return fail('INVALID_MESSAGE', 'طلب غير صالح.');
    if (ready && (!player.mic || player.threshold === null)) return fail('MIC_REQUIRED', 'شغّل المايك وأكمل المعايرة قبل الاستعداد.');
    player.ready = ready;
  }
  start(room: Room, player: Player) {
    if (room.hostId !== player.id) return fail('HOST_ONLY', 'المضيف وحده يستطيع بدء الجولة.');
    if (room.phase !== 'lobby') return fail('INVALID_PHASE', 'الجولة بدأت بالفعل.');
    if (room.players.size < (room.mode === 'solo-test' ? 1 : 2) || [...room.players.values()].some(p => !p.connected || !p.ready || !p.mic))
      return fail('NOT_READY', room.mode === 'solo-test' ? 'شغّل المايك وأكمل المعايرة والاستعداد لبدء التجربة الفردية.' : 'يلزم لاعبان على الأقل واستعداد جميع اللاعبين.');
    room.phase = 'playing';room.round=newRound(room.round.escapeCode);room.round.startedAt=room.tick;room.hunters=newHunters();room.doors=initialDoors();
    for(const p of room.players.values()){resetPlayer(p);room.round.roster.set(p.id,{id:p.id,name:p.name,life:p.life});}
    [...room.players.values()].forEach((p, index) => { p.motion = newMotion(index); });
  }
  move(room: Room, player: Player, message: Record<string, unknown>) {
    if (room.phase !== 'playing') return fail('INVALID_PHASE', 'الحركة متاحة أثناء الجولة فقط.');
    if (!player.connected || !player.mic) return fail('MIC_REQUIRED', 'استعد اتصال المايك قبل الحركة.');
    if(player.life!=='active')return fail('NOT_ACTIVE','أنت غير قادر على الحركة حاليًا.');
    const { seq, x, z, yaw, mode, pitch=0 } = message;
    if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0 ||
      typeof x !== 'number' || !Number.isFinite(x) || Math.abs(x) > 1 ||
      typeof z !== 'number' || !Number.isFinite(z) || Math.abs(z) > 1 ||
      typeof yaw !== 'number' || !Number.isFinite(yaw) || Math.abs(yaw) > Math.PI ||
      typeof pitch !== 'number' || !Number.isFinite(pitch) || Math.abs(pitch)>1.3 ||
      (mode !== 'walk' && mode !== 'run' && mode !== 'crouch') ||
      Object.keys(message).some(k => !['type', 'requestId', 'seq', 'x', 'z', 'yaw', 'mode', 'pitch'].includes(k)))
      return fail('INVALID_MOVE', 'نيّة الحركة غير صالحة؛ لا ترسل الموقع أو السرعة.');
    if (seq <= player.motion.lastSeq) return fail('STALE_INPUT', 'رقم حركة قديم أو مكرر.');
    player.motion.lastSeq = seq;
    player.motion.input = { seq, x, z, yaw, pitch, mode, at: this.now() };
  }
  door(room: Room, player: Player, id: unknown, open: unknown) {
    if (room.phase !== 'playing') return fail('INVALID_PHASE','التفاعل متاح أثناء الجولة فقط.');
    if (!player.connected || !player.mic) return fail('MIC_REQUIRED','استعد اتصال المايك قبل التفاعل.');
    if(player.life!=='active')return fail('NOT_ACTIVE','أنت غير قادر على التفاعل حاليًا.');
    const d = ARENA.doors.find(d => d.id === id);
    if (!d || typeof open !== 'boolean') return fail('INVALID_DOOR','طلب باب غير صالح.');
    if (doorDistance(player.motion.x,player.motion.z,d)>1.8) return fail('TOO_FAR','اقترب من الباب للتفاعل.');
    const obstacles = closedDoors(room.doors).filter(w => w !== d);
    const tx=(d.minX+d.maxX)/2,tz=(d.minZ+d.maxZ)/2;
    for (let t=.1;t<1;t+=.1) if (blocked(player.motion.x+(tx-player.motion.x)*t,player.motion.z+(tz-player.motion.z)*t,obstacles))
      return fail('DOOR_OBSTRUCTED','الباب خلف عائق، اقترب من فتحته.');
    if (room.doors[d.id] === open) return;
    if (this.now()-player.lastDoorAt<500) return fail('DOOR_COOLDOWN','انتظر قليلًا قبل التفاعل التالي.');
    if (!open && [...[...room.players.values()].map(p=>p.motion),...room.hunters].some(p => p.x>d.minX-PLAYER_RADIUS && p.x<d.maxX+PLAYER_RADIUS && p.z>d.minZ-PLAYER_RADIUS && p.z<d.maxZ+PLAYER_RADIUS))
      return fail('DOOR_OCCUPIED','لا يمكن قفل الباب أثناء عبور لاعب أو مطارد.');
    room.doors[d.id]=open; player.lastDoorAt=this.now();
    // A noise is an observed location outside the slab, not a live player tracker.
    const vertical=d.maxZ-d.minZ>d.maxX-d.minX;
    const noise={x:vertical?(player.motion.x<tx?d.minX-.5:d.maxX+.5):tx,z:vertical?tz:(player.motion.z<tz?d.minZ-.5:d.maxZ+.5)};
    room.soundEvents.push({id:++room.soundSeq,kind:'door',x:tx,z:tz,strength:.8});
    room.noises.push(noise); room.noises=room.noises.slice(-16);
    for(const h of room.hunters) { h.route=[]; h.planIn=0; }
  }
  step() {
    for (const room of this.rooms.values()) {
      if (room.phase !== 'playing') continue;
      room.tick++;
      for (const player of room.players.values()) {
        const before={x:player.motion.x,z:player.motion.z};
        advance(player.motion, canAct(player), this.now(), closedDoors(room.doors));
        const distance=Math.hypot(before.x-player.motion.x,before.z-player.motion.z);
        player.stepDistance+=distance;
        const mode=player.motion.input?.mode||'walk';
        if(distance>0 && player.stepDistance>=(mode==='run'?.85:mode==='crouch'?1.4:1.1)){
          player.stepDistance=0;const strength=mode==='run'?1:mode==='crouch'?.15:.5;
          room.soundEvents.push({id:++room.soundSeq,kind:'step',x:player.motion.x,z:player.motion.z,strength});
          if(micNoiseAllowed(player.voiceRole)) room.noises.push({x:player.motion.x,z:player.motion.z,strength});
        }
      }
      room.noises=room.noises.slice(-32);room.soundEvents=room.soundEvents.slice(-32);roundStep(room);
    }
  }
  micLevel(room:Room,p:Player,value:unknown){
    if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1)return fail('INVALID_LEVEL','مستوى المايك غير صالح.');
    if(this.now()-p.lastMicLevelAt<200)return;p.lastMicLevelAt=this.now();
    if(room.phase==='playing'&&p.connected&&p.mic&&p.threshold!==null&&value>p.threshold&&micNoiseAllowed(p.voiceRole))
      room.noises.push({x:p.motion.x,z:p.motion.z,strength:Math.min(1,.4+value)});
    room.noises=room.noises.slice(-32);
  }
  aiStep() {
    for(const room of this.rooms.values()) if(room.phase==='playing') {
      stepHunters(room.hunters,[...room.players.values()].filter(p=>p.life==='active').map(p=>({id:p.id,x:p.motion.x,z:p.motion.z})),room.doors,room.noises,room.tick);
      room.noises=[];
    }
  }
  movementSnapshot(room: Room, viewer?:Player) {
    return { type: 'state', tick: room.tick, doors: {...room.doors}, round:roundView(room,viewer),roster:[...room.players.values()].map(p=>({id:p.id,life:p.life,hearts:p.hearts})), players: [...room.players.values()].filter(p=>!viewer||p.id===viewer.id||this.visible(room,viewer,p.motion)).map(p => ({
      id: p.id, x: p.motion.x, z: p.motion.z, yaw: p.motion.yaw,pitch:p.motion.pitch, ackSeq: p.motion.appliedSeq,
      life:p.life,hearts:p.hearts,frozen: !p.connected || !p.mic || p.life!=='active',
    })) };
  }
  huntersSnapshot(room: Room,viewer?:Player) { return {type:'hunters',tick:room.tick,hunters:hunterSnapshot(room.hunters.filter(h=>!viewer||this.visible(room,viewer,h)))}; }
  visible(room:Room,viewer:Player,target:{x:number;z:number}){
    const origin=(viewer.life!=='active'&&viewer.spectating?room.players.get(viewer.spectating):viewer)?.motion||viewer.motion;
    return Math.hypot(origin.x-target.x,origin.z-target.z)<=18&&segmentClear(origin,target,closedDoors(room.doors),true);
  }
  private acting(room:Room,p:Player){if(room.phase!=='playing')return fail('INVALID_PHASE','لا توجد جولة نشطة.');if(!canAct(p))return fail('NOT_ACTIVE','يلزم لاعب نشط ومايك متصل.');}
  revive(room:Room,p:Player,targetId:unknown){
    this.acting(room,p);const t=typeof targetId==='string'?room.players.get(targetId):undefined;
    if(!t||t===p||!['downed','last-chance'].includes(t.life)||!near(room,p.motion,t.motion))return fail('INVALID_REVIVE','اقترب من زميل ساقط لإحيائه.');
    if(!p.revive||p.revive.targetId!==t.id)p.revive={targetId:t.id,startedTick:room.tick,lastHeldTick:room.tick};else p.revive.lastHeldTick=room.tick;
  }
  collect(room:Room,p:Player,id:unknown){
    this.acting(room,p);const clue=OBJECTIVES.clues.find(c=>c.id===id),ammo=OBJECTIVES.ammo.find(c=>c.id===id),target=clue||ammo;
    if(!target||!near(room,p.motion,target))return fail('INVALID_PICKUP','اقترب من عنصر صالح لجمعه.');
    const set=clue?room.round.collected:room.round.pickups;if(set.has(target.id))return fail('ALREADY_COLLECTED','جُمع هذا العنصر بالفعل.');
    set.add(target.id);if(ammo)p.ammo++;
  }
  rescueFriend(room:Room,p:Player){this.acting(room,p);const f=room.round.friend;if(f.state!=='trapped'||!near(room,p.motion,f))return fail('INVALID_RESCUE','لا يمكن إنقاذ سليم من هنا.');f.state='following';f.leaderId=p.id;f.route=[];}
  shoot(room:Room,p:Player){
    this.acting(room,p);if(p.ammo<=0)return fail('NO_AMMO','لا توجد ذخيرة.');p.ammo--;
    const yaw=p.motion.yaw,dx=-Math.sin(yaw),dz=-Math.cos(yaw);
    const targets=room.hunters.map(h=>({h,along:(h.x-p.motion.x)*dx+(h.z-p.motion.z)*dz,side:Math.abs((h.x-p.motion.x)*dz-(h.z-p.motion.z)*dx)})).filter(v=>v.along>=0&&v.along<=12&&v.side<=.4&&(p.motion.input?.mode==='crouch'?1.1:1.65)+Math.tan(p.motion.pitch)*v.along>=0&&(p.motion.input?.mode==='crouch'?1.1:1.65)+Math.tan(p.motion.pitch)*v.along<=1.9&&segmentClear(p.motion,v.h,closedDoors(room.doors),true)).sort((a,b)=>a.along-b.along);
    if(targets[0]){const h=targets[0].h;h.stunnedUntilTick=room.tick+200;h.state='stunned';h.route=[];h.targetId=null;}
  }
  escape(room:Room,p:Player,value:unknown,ownerCode=false){
    this.acting(room,p);if(!near(room,p.motion,OBJECTIVES.gate,1.8))return fail('TOO_FAR','اقترب من لوحة البوابة.');
    if(p.panelUntil>room.tick)return fail('PANEL_LOCKED','اللوحة مغلقة مؤقتًا بعد المحاولة السابقة.');
    if(!ownerCode&&(typeof value!=='string'||!/^\d{4}$/.test(value)))return fail('INVALID_CODE','الكود أربعة أرقام.');
    if(!ownerCode&&value!==room.round.escapeCode){p.panelUntil=room.tick+160;room.noises.push({...OBJECTIVES.gate});return fail('WRONG_CODE','كود خاطئ؛ صدرت ضوضاء وأُغلقت اللوحة ثماني ثوانٍ.');}
    p.life='escaped';p.voiceRole='spectator';p.revive=null;p.motion.input=null;
    const f=room.round.friend;if(f.state==='following'&&near(room,f,OBJECTIVES.gate,2)){f.state='escaped';f.route=[];}
    finishIfNeeded(room);
  }
  spectate(room:Room,p:Player,id:unknown){if(p.life==='active'||typeof id!=='string'||room.players.get(id)?.life!=='active')return fail('INVALID_SPECTATE','اختر لاعبًا نشطًا لمشاهدته.');p.spectating=id;}
  rematch(room:Room,p:Player){
    if(room.hostId!==p.id)return fail('HOST_ONLY','المضيف وحده يعيد الجولة.');if(room.phase!=='finished')return fail('INVALID_PHASE','الجولة لم تنته بعد.');
    room.phase='lobby';room.round=newRound(room.round.escapeCode);room.hunters=newHunters();room.doors=initialDoors();room.soundEvents=[];room.noises=[];
    [...room.players.values()].forEach((p,index)=>{resetPlayer(p);p.motion=newMotion(index);p.ready=false;});
  }
  disconnect(room: Room, player: Player) {
    player.motion.input = null;
    player.voiceAvailable=false;player.calibrated=false;player.connected = false; player.ready = false; player.mic = false; player.threshold = null; player.disconnectedAt = this.now();
    this.transfer(room);
  }
  leave(room: Room, player: Player) {
    departed(room,player);room.players.delete(player.id);finishIfNeeded(room); this.transfer(room);
    if (!room.players.size) this.rooms.delete(room.code);
  }
  private transfer(room: Room) {
    if (!room.players.get(room.hostId)?.connected) {
      const next = [...room.players.values()].find(p => p.connected);
      if (next) room.hostId = next.id;
    }
  }
  sweep() {
    const changed: Room[] = [];
    for (const room of this.rooms.values()) for (const p of [...room.players.values()]) {
      if (!p.connected && p.disconnectedAt !== null && this.now() - p.disconnectedAt >= 30_000) {
        this.leave(room, p); if (!changed.includes(room)) changed.push(room);
      }
    }
    return changed;
  }
  snapshot(room: Room) {
    return { code: room.code, mode: room.mode, hostId: room.hostId, phase: room.phase, doors: {...room.doors}, mapId: ARENA.id, result:room.round.result, players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, connected: p.connected, life:p.life,hearts:p.hearts,ready: p.ready, voiceAvailable:p.voiceAvailable, mic: p.mic })) };
  }
}
