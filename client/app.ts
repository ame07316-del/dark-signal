import { OBJECTIVES } from '../src/objectives.js';
import { SoundEngine } from './sound.js';
import { VoiceMesh } from './voice.js';
import { segmentClear } from '../src/hunters.js';
import { initialDoors, closedDoors, doorDistance, zoneAt } from '../src/map.js';
import { createView } from './view3d.js';
import { worldDirection, wrapYaw } from './controls.js';
import { reconcile } from './prediction.js';
import { ARENA, advance, newMotion, type Motion } from '../src/movement.js';
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const button = (id: string) => el<HTMLButtonElement>(id);
const notice = (s: string) => { el('notice').textContent = s;el('entryError').textContent=s; };
let ws: WebSocket, session: { code: string; playerId: string; token: string } | null = null;
let room: any = null, state: any = null, motion: Motion = newMotion(), seq = 0;
let stream: MediaStream | null = null, calibrating = false;
let analyser:AnalyserNode|null=null, micSource:MediaStreamAudioSourceNode|null=null, micGeneration=0, calibrationKey='';
const sound=new SoundEngine();
const voiceStatus=(s:string)=>{el('voiceStatus').textContent=s;};
const voice=new VoiceMesh((to,data)=>send({type:'signal',to,data}),voiceStatus,()=>{
  stopMic();send({type:'mic',available:false});notice('تعذر مسار المحادثة. اللاعب مجمّد؛ اضغط تشغيل المايك لإعادة المحاولة، أو جرّب شبكة أخرى.');
});
function micEnergy(){if(!analyser)return 0;const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);return Math.sqrt(data.reduce((sum,v)=>sum+v*v,0)/data.length);}
let reconnectTimer: ReturnType<typeof setTimeout>, attempts = 0, correction = 0;
let hunters: {id:string;name:string;x:number;z:number;yaw:number;state:string}[] = [];
let doors = initialDoors();
let mapCompatible = true;
let firstPerson = false, yaw = -Math.PI * .75, pitch = 0, lightOn = true;
let view: ReturnType<typeof createView> | null = null;
const keys = new Set<string>(); const remote = new Map<string, { x: number; z: number }>();
let reviveHeld:string|null=null;
let pending: { seq: number; x: number; z: number; yaw: number; mode: 'walk' | 'run' | 'crouch' }[] = [];
function send(m: object) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); }
function save() { if (session) sessionStorage.setItem('dark-signal-session', JSON.stringify({ ...session, seq })); else sessionStorage.removeItem('dark-signal-session'); }
try { const saved = JSON.parse(sessionStorage.getItem('dark-signal-session') || 'null'); if (saved?.token && saved?.code) { session = saved; seq = Number.isSafeInteger(saved.seq) ? saved.seq : 0; } } catch { sessionStorage.removeItem('dark-signal-session'); }
function resetMotion() { keys.clear();reviveHeld=null; pending = []; motion.input = null; }
function stopMic() { micGeneration++;calibrationKey='';calibrating=false;voice.clear();stream?.getTracks().forEach(t => {t.onended=null;t.onmute=null;t.stop();});stream=null;micSource?.disconnect();micSource=null;analyser?.disconnect();analyser=null;renderLobby(); }
function clearSession() { if (document.pointerLockElement) document.exitPointerLock(); session = null; hunters = []; doors = initialDoors(); room = null; state = null; resetMotion();remote.clear();stopMic(); void sound.dispose(); save(); renderLobby(); }
function renderLobby() {
  const me = room?.players.find((p: any) => p.id === session?.playerId);
  for (const id of ['create', 'join', 'solo']) button(id).disabled = !!session || ws?.readyState !== WebSocket.OPEN;
  button('mic').disabled = !me || calibrating || me.mic;
  button('ready').disabled = !mapCompatible || !me?.mic || room?.phase !== 'lobby';
  button('ready').textContent = me?.ready ? 'إلغاء الاستعداد' : 'أنا مستعد';
  button('leave').disabled = !session || ws?.readyState !== WebSocket.OPEN;
  button('start').disabled = !mapCompatible || !me || room?.hostId !== me.id || room.phase !== 'lobby' || room.players.length < (room.mode === 'solo-test' ? 1 : 2) || room.players.some((p: any) => !p.ready || !p.connected);
  el('roomCode').textContent = room?.code || '—';
  el('phase').textContent = room?.phase === 'playing' ? 'الاختبار جارٍ — شغّل المايك لاستعادة الحركة بعد الانقطاع.' : room?.mode === 'solo-test' ? 'تجربة فردية · شغّل المايك وأكمل المعايرة، ثم اضغط أنا مستعد وابدأ الاختبار.' : 'يلزم لاعبان على الأقل، ومايك معاير واستعداد الجميع.';
  el('players').replaceChildren();
  for (const p of room?.players || []) {
    const li = document.createElement('li');
    li.textContent = `${p.name}${p.id === session?.playerId ? ' (أنت)' : ''}${p.id === room.hostId ? ' · مضيف' : ''} — ${!p.connected ? 'منقطع' : p.ready ? 'مستعد' : p.mic ? 'مايك جاهز' : 'بانتظار المايك'}`;
    el('players').append(li);
  }
}
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
  ws.onopen = () => { attempts = 0; el('connection').textContent = '● متصل بالخادم'; if (session) send({ type: 'resume', code: session.code, token: session.token }); renderLobby(); };
  ws.onclose = () => {
    el('connection').textContent = '○ انقطع الاتصال — إعادة المحاولة'; resetMotion(); stopMic(); room = null; state = null; hunters = []; sound.atmosphere(false); renderLobby();
    reconnectTimer = setTimeout(connect, Math.min(5000, 500 * 2 ** attempts++));
  };
  ws.onerror = () => notice('تعذر اتصال الغرف عبر WebSocket. ستتم إعادة المحاولة؛ لو الرابط محميّ افتح المعاينة من داخل Arena بدل رابط E2B الخام.');
  ws.onmessage = event => {
    const m = JSON.parse(event.data);
    if (m.type === 'session') { session = { code: m.code, playerId: m.playerId, token: m.token }; save(); notice('تم الدخول. شغّل المايك، والزم الصمت أثناء المعايرة.'); }
    if (m.type === 'room') { const started = room?.phase !== 'playing' && m.room.phase === 'playing'; room = m.room; doors = room.doors;if(room.phase==='lobby'){resetMotion();state=null;el('results').textContent='';button('rematch').hidden=true;el('life').textContent='٣ قلوب · طلقة واحدة عند بدء الجولة';el('clues').textContent='اجمع الأدلة وأنقذ سليم ثم اهرب';} if (started) { resetMotion(); motion = newMotion(Math.max(0, room.players.findIndex((p: any) => p.id === session?.playerId))); } voice.sync(room.players); sound.atmosphere(room.phase==='playing');renderLobby(); }
    if (m.type === 'map') {
      mapCompatible = m.map?.id === ARENA.id;
      if (!mapCompatible) { resetMotion(); notice('نسخة الخريطة تغيرت. حدّث الصفحة قبل اللعب لتفادي اختلاف التصادم.'); }
      renderLobby();
    }
    if(m.type==='signal')voice.receive(m.from,m.data);
    if(m.type==='voice-policy'){voice.policy(m.weights);voice.outgoing(m.outgoing);}
    if(m.type==='sounds'&&room?.phase==='playing')for(const event of m.events){
      const listener=state?.players.find((p:any)=>p.id===session?.playerId)||motion;
      const occlusion=segmentClear(listener,event,closedDoors(doors),true)?1:.55;sound.event(event,listener,yaw,occlusion);
    }
    if(m.type==='calibration'){
      el('calibrationStatus').textContent=m.active?`${m.active.quiet?'يصمت الفريق كله لإعادة المعايرة':'معايرة بالتتابع'} · ${room?.players.find((p:any)=>p.id===m.active.playerId)?.name||'لاعب'} · ${m.queue.length} في الانتظار`:'لا توجد معايرة جارية';
      if(m.active?.playerId===session?.playerId&&stream)void runCalibration(m.active);
    }
    if(m.type==='calibration-result'){
      if(m.retry)notice('تأثر القياس. يصمت الفريق كله خمس ثوانٍ لإعادة واحدة.');
      else {
        calibrating=false;
        voice.sync(room?.players||[]);
        notice(m.warning?'قُبل آخر قياس بتحذير بعد الإعادة الوحيدة. اضغط أنا مستعد.':'اكتملت المعايرة. اضغط أنا مستعد.');renderLobby();
      }
    }
    if (m.type === 'hunters') { hunters = m.hunters; el('hunters').textContent=hunters.map(h=>`${h.name}: ${{patrol:'دورية',investigate:'يتحقق من أثر',chase:'مطاردة',stunned:'نائم مؤقتًا'}[h.state] || h.state}`).join(' · ')||'حمزة ورنا: خارج مجال الرؤية'; }
    if (m.type === 'state') {
      state = m; doors = m.doors; for(const p of m.roster||m.players){const known=room?.players.find((q:any)=>q.id===p.id);if(known){known.life=p.life;known.hearts=p.hearts;}}
      renderGame();const me = m.players.find((p: any) => p.id === session?.playerId);
      if (!me) return;
      const result = reconcile(motion, me, pending, performance.now(), closedDoors(doors));
      pending = result.pending; correction = result.correction;
      if (me.frozen) resetMotion();
      if(m.round?.self?.spectating){const watched=m.players.find((p:any)=>p.id===m.round.self.spectating);if(watched){motion.x=watched.x;motion.z=watched.z;}}
      el('location').textContent = zoneAt(me.x,me.z);
      el('stats').textContent = `tick ${m.tick} · x ${me.x.toFixed(2)} · z ${me.z.toFixed(2)} · Δ ${correction.toFixed(2)}m`;
    }
    if (m.type === 'ack' && m.action === 'leave') { clearSession(); notice('غادرت الغرفة.'); }
    if(m.type==='owner-session')notice('جلسة المالك موثقة لهذا الاتصال فقط. أدخل الكود الخاص عند البوابة.');
    if (m.type === 'error') { if(m.code==='INVALID_CALIBRATION'){stopMic();send({type:'mic',available:false});}notice(m.message); if (['INVALID_SESSION', 'ROOM_NOT_FOUND'].includes(m.code)) clearSession(); }
  };
}
function playerName(){const input=el<HTMLInputElement>('name');if(!input.value.trim())input.value=`لاعب ${crypto.getRandomValues(new Uint16Array(1))[0]%10000}`;return input.value;}
button('solo').onclick = () => send({ type: 'create', mode: 'solo-test', name: playerName() });
button('create').onclick = () => send({ type: 'create', name: playerName() });
button('join').onclick = () => send({ type: 'join', name: playerName(), code: el<HTMLInputElement>('code').value.trim().toUpperCase() });
button('ready').onclick = () => send({ type: 'ready', ready: !room?.players.find((p: any) => p.id === session?.playerId)?.ready });
button('start').onclick = () => send({ type: 'start' });
button('leave').onclick = () => send({ type: 'leave' });
button('copy').onclick = async () => { if (!room) return; try { await navigator.clipboard.writeText(room.code); notice('تم نسخ رمز الغرفة. شارك الرابط والرمز مع صديقك.'); } catch { notice(`رمز الغرفة: ${room.code}`); } };
async function runCalibration(active:{startedAt:number;attempt:number}) {
  const key=`${active.startedAt}:${active.attempt}`;if(key===calibrationKey)return;calibrationKey=key;
  const generation=micGeneration;
  setTimeout(()=>{if(generation===micGeneration&&calibrating&&calibrationKey===key){stopMic();send({type:'mic',available:false});notice('انتهت مهلة المعايرة. أعد تشغيل المايك للمحاولة مجددًا.');}},25000);
  let total=0,peak=0,min=1,count=0,remoteSpeech=false;
  const started=performance.now();
  while(performance.now()-started<5100){
    if(generation!==micGeneration||!stream?.active)return;
    const rms=micEnergy();total+=rms;peak=Math.max(peak,rms);min=Math.min(min,rms);count++;
    remoteSpeech ||= voice.energy()>.03;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(generation!==micGeneration)return;
  send({type:'calibration-result',threshold:Math.min(1,Math.max(.003,total/Math.max(1,count)*2)),contaminated:remoteSpeech||peak>.15||(peak>Math.max(.03,min*4))});
}
button('mic').onclick = async () => {
  if(calibrating)return;
  const activeSession=session;stopMic();calibrating=true;renderLobby();const generation=micGeneration;
  try {
    const context=await sound.unlock();
    const acquired=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:false}});
    if(generation!==micGeneration||session!==activeSession){acquired.getTracks().forEach(t=>t.stop());return;}
    stream=acquired;analyser=context.createAnalyser();analyser.fftSize=2048;
    micSource=context.createMediaStreamSource(stream);micSource.connect(analyser); // Never connect local mic to speakers.
    for(const track of stream.getAudioTracks()){
      const lost=()=>{stopMic();resetMotion();send({type:'mic',available:false});notice('انقطع المايك. أعد تشغيله لاستعادة الحركة.');};
      track.onended=lost;track.onmute=lost;
    }
    if(session){voice.start(session.playerId,stream,context);voice.sync(room?.players||[]);}
    notice('تم فتح المايك. انتظر دورك والتزم الصمت أثناء القياس خمس ثوانٍ.');send({type:'calibrate'});
  } catch {stopMic();send({type:'mic',available:false});notice('تعذر تشغيل المايك. افتح إذن المتصفح وأعد المحاولة.');}
};
button('enableAudio').onclick=async()=>{try{await sound.unlock();sound.tone('flash',.35);sound.atmosphere(room?.phase==='playing');voiceStatus('صوت المتصفح مفعّل.');}catch{notice('تعذر تشغيل صوت المتصفح.');}};
el<HTMLInputElement>('effectsVolume').oninput=()=>sound.level(Number(el<HTMLInputElement>('effectsVolume').value));
setInterval(()=>{
  if(stream?.active&&!calibrating&&room?.players.find((p:any)=>p.id===session?.playerId)?.mic){
    const level=micEnergy();el<HTMLMeterElement>('micMeter').value=level;send({type:'level',level});
  }
  if(sound.context?.state==='suspended')voiceStatus('المتصفح علّق الصوت. اضغط تفعيل الصوت لاستعادته.');
},250);
const movementKeys = ['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ControlLeft'];
window.addEventListener('keydown', e => { if ((e.target as HTMLElement).matches('input,select')) return; if(e.code==='KeyG'&&!e.repeat)button('shoot').click();if(e.code==='KeyR'&&!e.repeat)beginRevive(); if (e.code === 'KeyE' && !e.repeat) button('interact').click(); if (e.code === 'KeyF' && !e.repeat) button('flashlight').click(); if (movementKeys.includes(e.code)) { e.preventDefault(); keys.add(e.code); } });
window.addEventListener('keyup', e => {keys.delete(e.code);if(e.code==='KeyR')endRevive();});
function release() { resetMotion(); if (room?.phase === 'playing') send({ type: 'move', seq: ++seq, x: 0, z: 0, yaw: 0, mode: 'walk' }); }
window.addEventListener('blur', release); document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-key]')) {
  b.onpointerdown = e => { e.preventDefault(); b.setPointerCapture(e.pointerId); keys.add(b.dataset.key!); };
  for (const name of ['pointerup','pointercancel','lostpointercapture']) b.addEventListener(name, () => keys.delete(b.dataset.key!));
}
setInterval(() => {
  const me = room?.players.find((p: any) => p.id === session?.playerId);
  if (!mapCompatible || state?.round?.self?.life!=='active' || room?.phase !== 'playing' || !me?.mic || ws.readyState !== WebSocket.OPEN || document.hidden) return;
  const x = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
  const z = Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp'));
  const mode = (keys.has('ShiftLeft') ? 'run' : keys.has('ControlLeft') ? 'crouch' : el<HTMLSelectElement>('mode').value) as 'walk' | 'run' | 'crouch';
  const direction = firstPerson ? worldDirection(x,z,yaw) : { x,z };
  const length = Math.max(1,Math.hypot(direction.x,direction.z));
  const input = { seq: ++seq, x: direction.x/length, z: direction.z/length, yaw, pitch, mode };
  send({ type: 'move', ...input }); pending.push(input); pending = pending.slice(-5);
  motion.input = { ...input, at: performance.now() }; advance(motion, true, performance.now(), closedDoors(doors)); save();
}, 50);
const canvas = el<HTMLCanvasElement>('arena'), ctx = canvas.getContext('2d')!;
function nearestDoor() {
  return ARENA.doors.filter(d => doorDistance(motion.x,motion.z,d)<=1.8).sort((a,b)=>doorDistance(motion.x,motion.z,a)-doorDistance(motion.x,motion.z,b))[0];
}
function nearestObjective(){
  const available=[...OBJECTIVES.clues.filter(c=>!state?.round?.clues.find((q:any)=>q.id===c.id)?.collected),...OBJECTIVES.ammo.filter(a=>!state?.round?.pickups.includes(a.id))];
  return available.filter(p=>Math.hypot(p.x-motion.x,p.z-motion.z)<=1.5).sort((a,b)=>Math.hypot(a.x-motion.x,a.z-motion.z)-Math.hypot(b.x-motion.x,b.z-motion.z))[0];
}
button('interact').onclick = () => {
  const object=nearestObjective();if(object){send({type:'collect',id:object.id});return;}
  if(state?.round?.friend.state==='trapped'&&Math.hypot(motion.x-state.round.friend.x,motion.z-state.round.friend.z)<=1.5){send({type:'rescue-friend'});return;}
  const door = nearestDoor();if(door)send({type:'door',id:door.id,open:!doors[door.id]});
};
function beginRevive(){const target=state?.players.find((p:any)=>['downed','last-chance'].includes(p.life)&&Math.hypot(p.x-motion.x,p.z-motion.z)<=1.5);if(target){reviveHeld=target.id;send({type:'revive',targetId:target.id});}}
function endRevive(){reviveHeld=null;send({type:'revive-cancel'});}
button('revive').onpointerdown=e=>{e.preventDefault();button('revive').setPointerCapture(e.pointerId);beginRevive();};
for(const event of ['pointerup','pointercancel','lostpointercapture'])button('revive').addEventListener(event,endRevive);
setInterval(()=>{if(reviveHeld)send({type:'revive',targetId:reviveHeld});},250);
button('shoot').onclick=()=>send({type:'shoot'});
button('escape').onclick=()=>{send({type:'escape',code:el<HTMLInputElement>('escapeCode').value.normalize('NFKC').replace(/[٠-٩۰-۹]/g,c=>String(c.charCodeAt(0)-(c>='۰'?1776:1632)))});el<HTMLInputElement>('escapeCode').value='';};
button('rematch').onclick=()=>send({type:'rematch'});
el<HTMLSelectElement>('spectate').onchange=()=>send({type:'spectate',targetId:el<HTMLSelectElement>('spectate').value});
function renderGame(){
  const r=state?.round,self=r?.self;if(!self)return;
  if(reviveHeld&&!state.players.some((p:any)=>p.id===reviveHeld&&['downed','last-chance'].includes(p.life)))reviveHeld=null;
  const labels:Record<string,string>={active:'نشط',downed:'ساقط — انتظر إحياء زميل', 'last-chance':'بلا قلوب — تنتظر الفرصة الأخيرة',eliminated:'خارج الجولة',escaped:'هارب — مشاهد'};
  el('life').textContent=`${labels[self.life]} · قلوب ${self.hearts}/3 · ذخيرة ${self.ammo}`;
  el('clues').textContent=`الأدلة: ${r.clues.map((c:any)=>c.digit??'؟').join(' · ')} · سليم: ${{trapped:'محتجز',following:'يتبع الفريق',lost:'فُقد نهائيًا',escaped:'هرب'}[r.friend.state as string]||r.friend.state}`;
  el('reviveProgress').textContent=self.revive?`إحياء: ${Math.floor(self.revive.progress*100)}٪ — استمر بالضغط`:'';
  const active=room?.phase==='playing'&&self.life==='active';
  button('shoot').disabled=!active||self.ammo<1;
  button('escape').disabled=!active||self.panelTicks>0||Math.hypot(motion.x-OBJECTIVES.gate.x,motion.z-OBJECTIVES.gate.z)>1.8;
  button('revive').disabled=!active||!state.players.some((p:any)=>['downed','last-chance'].includes(p.life)&&Math.hypot(p.x-motion.x,p.z-motion.z)<=1.5);
  button('rematch').hidden=!r.result;button('rematch').disabled=room?.hostId!==session?.playerId;
  el('results').textContent=r.result?`${r.result.reason} · ${r.result.durationSeconds} ثانية · ${r.result.revives} إحياء — ${r.result.players.map((p:any)=>`${p.name}: ${labels[p.life]}`).join(' / ')}`:'';
  const select=el<HTMLSelectElement>('spectate');const value=self.spectating||'';select.hidden=self.life==='active';
  const alive=room?.players.filter((p:any)=>p.life==='active')||[];
  if(Array.from(select.options).map(o=>o.value).join()!==alive.map((p:any)=>p.id).join()){select.replaceChildren();for(const p of alive){const option=document.createElement('option');option.value=p.id;option.textContent=p.name;select.append(option);}}select.value=value;
  if(r.result)room.phase='finished';
}
if(location.hash==='#owner')el('ownerPanel').hidden=false;
button('ownerEscape').onclick=()=>{const field=el<HTMLInputElement>('ownerSecret');send({type:'escape',code:field.value});field.value='';};
button('ownerAuth').onclick=()=>{const field=el<HTMLInputElement>('ownerSecret');send({type:'owner-auth',secret:field.value});field.value='';};

function draw() {
  const door = nearestDoor(),object=nearestObjective(),friendNearby=state?.round?.friend.state==='trapped'&&Math.hypot(motion.x-state.round.friend.x,motion.z-state.round.friend.z)<=1.5;
  button('interact').disabled = !mapCompatible || room?.phase !== 'playing' || state?.round?.self?.life!=='active' || (!door&&!object&&!friendNearby) || !room?.players.find((p:any)=>p.id===session?.playerId)?.mic;
  button('interact').textContent = object?`E · جمع ${object.id.startsWith('clue')?'دليل':'ذخيرة'}`:friendNearby?'E · إنقاذ سليم':door ? `E · ${doors[door.id] ? 'قفل' : 'فتح'} ${door.label}` : 'E · اقترب من باب';
  if (firstPerson && view) {
    view.draw(motion,pitch,yaw,state?.players || [],doors,hunters,state?.round||null,session?.playerId,el<HTMLSelectElement>('mode').value === 'crouch' || keys.has('ControlLeft'));
    requestAnimationFrame(draw); return;
  }
  ctx.clearRect(0,0,800,800);
  const scale = canvas.width / ARENA.maxX;
  for (const zone of ARENA.zones) {
    ctx.fillStyle = zone.kind === 'courtyard' ? '#233c31' : zone.kind === 'room' ? '#1c2729' : '#172326';
    ctx.fillRect(zone.minX*scale,zone.minZ*scale,(zone.maxX-zone.minX)*scale,(zone.maxZ-zone.minZ)*scale);
  }
  ctx.strokeStyle = '#1e3032'; ctx.lineWidth = 1;
  for (let i = 0; i <= ARENA.maxX; i++) { ctx.beginPath(); ctx.moveTo(i*scale,0);ctx.lineTo(i*scale,800);ctx.moveTo(0,i*scale);ctx.lineTo(800,i*scale);ctx.stroke(); }
  ctx.fillStyle='#4a5856'; for (const w of ARENA.walls) ctx.fillRect(w.minX*scale,w.minZ*scale,(w.maxX-w.minX)*scale,(w.maxZ-w.minZ)*scale);
  for (const d of ARENA.doors) { ctx.fillStyle=doors[d.id]?'#5c9a80':'#bf9858'; ctx.fillRect(d.minX*scale,d.minZ*scale,Math.max(3,(d.maxX-d.minX)*scale),Math.max(3,(d.maxZ-d.minZ)*scale)); }
  ctx.fillStyle = '#8fa69a'; ctx.font = '12px Tahoma'; ctx.textAlign = 'center';
  for (const zone of ARENA.zones) ctx.fillText(zone.label,zone.x*scale,zone.z*scale);
  for (const p of state?.players || []) {
    const local = p.id === session?.playerId;
    const point = local ? motion : remote.get(p.id) || { x:p.x, z:p.z };
    if (!local) { point.x += (p.x-point.x)*.22; point.z += (p.z-point.z)*.22; remote.set(p.id,point); }
    ctx.beginPath();ctx.arc(point.x*scale,point.z*scale,12,0,Math.PI*2);ctx.fillStyle=p.frozen?'#9f8b65':local?'#b1e1ba':'#79b6dd';ctx.fill();
    if(local){ctx.beginPath();ctx.arc(p.x*scale,p.z*scale,16,0,Math.PI*2);ctx.strokeStyle='#fff';ctx.stroke();}
    ctx.fillStyle='#e2ece8';ctx.font='16px Tahoma';ctx.textAlign='center';ctx.fillText(room?.players.find((x:any)=>x.id===p.id)?.name || '',point.x*scale,point.z*scale-24);
  }
  for(const o of [...OBJECTIVES.clues,...OBJECTIVES.ammo,OBJECTIVES.gate]){ctx.fillStyle='id'in o?(String(o.id).startsWith('clue')?'#eadc91':'#83c3d3'):'#9de0ab';ctx.fillRect(o.x*scale-4,o.z*scale-4,8,8);}
  if(state?.round?.friend){const f=state.round.friend;ctx.fillStyle='#d8d5b6';ctx.fillRect(f.x*scale-6,f.z*scale-6,12,12);}
  for (const h of hunters) { ctx.fillStyle=h.id==='hamza'?'#e89070':'#ba94df';ctx.beginPath();ctx.arc(h.x*scale,h.z*scale,10,0,Math.PI*2);ctx.fill();ctx.fillText(h.name,h.x*scale,h.z*scale-16);ctx.beginPath();ctx.moveTo(h.x*scale,h.z*scale);ctx.lineTo((h.x-Math.sin(h.yaw))*scale,(h.z-Math.cos(h.yaw))*scale);ctx.strokeStyle=ctx.fillStyle;ctx.stroke(); }
  if (!state) { ctx.fillStyle='#829a90';ctx.font='22px Tahoma';ctx.textAlign='center';ctx.fillText('بانتظار بدء اختبار الفريق',400,390); }
  requestAnimationFrame(draw);
}
const viewport = el('viewport');
button('flashlight').onclick = () => {
  lightOn = !lightOn; view?.light(lightOn); sound.tone('flash',.4);
  button('flashlight').textContent = `الكشاف: ${lightOn ? 'يعمل' : 'مطفأ'}`;
  button('flashlight').setAttribute('aria-pressed', String(lightOn));
};
function look(dx: number, dy: number) {
  if (!firstPerson || !room?.players.find((p: any) => p.id === session?.playerId)?.mic) return;
  yaw = wrapYaw(yaw - dx * .003); pitch = Math.max(-1.3,Math.min(1.3,pitch - dy * .003));
}
button('toggleView').onclick = () => {
  try {
    if (!view) {
      view = createView(viewport); view.light(lightOn);
      const surface = view.canvas; let drag: {id:number; x:number; y:number} | null = null;
      surface.onpointerdown = e => { if (document.pointerLockElement) return; drag = {id:e.pointerId,x:e.clientX,y:e.clientY}; surface.setPointerCapture(e.pointerId); };
      surface.onpointermove = e => { if (drag?.id === e.pointerId) { look(e.clientX-drag.x,e.clientY-drag.y); drag.x=e.clientX; drag.y=e.clientY; } };
      for (const event of ['pointerup','pointercancel','lostpointercapture']) surface.addEventListener(event, () => { drag = null; });
    }
    firstPerson = !firstPerson; release();
    if (!firstPerson && document.pointerLockElement) document.exitPointerLock();
    viewport.classList.toggle('active',firstPerson); canvas.hidden = firstPerson;
    el('crosshair').hidden = !firstPerson; el('viewHint').hidden = !firstPerson;
    button('toggleView').textContent = firstPerson ? 'الخريطة العلوية' : 'منظور أول 3D';
    button('toggleView').setAttribute('aria-pressed',String(firstPerson));
  } catch { notice('العرض ثلاثي الأبعاد غير متاح على جهازك. الخريطة العلوية ما زالت متاحة.'); }
};
button('capture').onclick = async () => {
  if (!firstPerson) button('toggleView').click();
  try { await view?.canvas.requestPointerLock(); } catch { notice('تعذر قفل الماوس. اسحب داخل المشهد للنظر بدلًا منه.'); }
};
document.addEventListener('mousemove', e => { if (document.pointerLockElement === view?.canvas) look(e.movementX,e.movementY); });
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) release(); });
document.addEventListener('pointerlockerror', () => notice('قفل الماوس غير متاح. استخدم السحب للنظر.'));
connect(); draw();
window.addEventListener('pagehide', () => { clearTimeout(reconnectTimer); stopMic(); void sound.dispose(); view?.dispose(); });
