// Exercise the actual distributable with production dependencies ONLY, not tsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
const root = fileURLToPath(new URL('../', import.meta.url));
const origin = 'https://dark-signal.test';
async function freePort() {
  const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;
}
async function launch(folder) {
  const port=await freePort();let logs='';
  const child=spawn(process.execPath,[join(folder,'hosting/server/index.js')],{
    cwd:join(folder,'unrelated-working-directory'),
    env:{...process.env,NODE_ENV:'production',PORT:String(port),ALLOWED_ORIGINS:origin,OWNER_SECRET_HASH:''},
    stdio:['ignore','pipe','pipe'],
  });
  const stop=async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await once(child,'exit');}};
  try {
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error(`Startup timeout: ${logs}`)),10000);
      const collect=data=>{logs+=data.toString();if(logs.includes('backend listening on port')){clearTimeout(timer);resolve();}};
      child.stdout.on('data',collect);child.stderr.on('data',collect);
      child.once('error',e=>{clearTimeout(timer);reject(e);});
      child.once('exit',()=>{clearTimeout(timer);reject(Error(`Runtime exited: ${logs}`));});
    });
    return {base:`http://127.0.0.1:${port}`,stop};
  } catch(e){await stop();throw e;}
}
async function connect(base,allowedOrigin=origin) {
  const ws=new WebSocket(base.replace('http','ws')+'/ws',{origin:allowedOrigin});const queue=[];
  ws.on('message',data=>queue.push(JSON.parse(data.toString())));await once(ws,'open');
  return {ws,send:m=>ws.send(JSON.stringify(m)),next:async(type,predicate=()=>true)=>{
    const until=Date.now()+4000;
    while(Date.now()<until){const i=queue.findIndex(m=>m.type===type&&predicate(m));if(i>=0)return queue.splice(i,1)[0];await delay(10);}
    throw Error(`Timed out waiting for ${type}`);
  }};
}
test('checked-in runtime runs without dist, compilers, prestart or a source-tree working directory', {timeout:90000}, async t=>{
  execFileSync(process.execPath,[join(root,'tools/check-runtime.mjs')],{cwd:root});
  const folder=mkdtempSync(join(tmpdir(),'dark-signal-runtime-'));
  let app;
  try {
    for(const path of ['package.json','package-lock.json','hosting'])cpSync(join(root,path),join(folder,path),{recursive:true});
    mkdirSync(join(folder,'unrelated-working-directory'));
    const npm=process.env.npm_execpath || fileURLToPath(new URL('../lib/node_modules/npm/bin/npm-cli.js',`file://${process.execPath}`));
    execFileSync(process.execPath,[npm,'ci','--omit=dev','--no-audit','--no-fund'],{cwd:folder,timeout:60000,env:{...process.env,NODE_ENV:'production'},stdio:'pipe'});
    for(const path of ['dist','src','client','node_modules/typescript','node_modules/esbuild','node_modules/three','node_modules/.bin/tsc'])assert.equal(existsSync(join(folder,path)),false,path);
    assert.equal(existsSync(join(folder,'node_modules/ws')),true);
    const pkg=JSON.parse(readFileSync(join(folder,'package.json'),'utf8'));
    assert.equal(pkg.scripts.start,'node hosting/server/index.js');assert.equal(pkg.main,'hosting/server/index.js');assert.equal(pkg.scripts.prestart,undefined);
    app=await launch(folder);
    await t.test('static assets, query strings, HEAD and health/readiness work',async()=>{
      for(const [path,type]of [['/','text/html'],['/app.js?v=smoke','javascript'],['/style.css','text/css']]){
        const response=await fetch(app.base+path);assert.equal(response.status,200);assert.ok(response.headers.get('content-type').includes(type));assert.ok((await response.text()).length>100);
      }
      for(const [path,type]of [
        ['/assets/mansion-cover.jpg','image/jpeg'],['/assets/aged-plaster.jpg','image/jpeg'],['/assets/aged-wood.jpg','image/jpeg'],
        ['/assets/fonts/IBMPlexSansArabic-Regular.ttf','font/ttf'],['/assets/fonts/IBMPlexSansArabic-SemiBold.ttf','font/ttf'],['/assets/fonts/OFL.txt','text/plain'],
      ]){
        const response=await fetch(app.base+path);assert.equal(response.status,200,path);assert.ok(response.headers.get('content-type').includes(type),path);assert.ok((await response.arrayBuffer()).byteLength>100,path);
        const head=await fetch(app.base+path,{method:'HEAD'});assert.equal(head.status,200,path);assert.ok(Number(head.headers.get('content-length'))>100,path);
      }
      assert.equal((await fetch(app.base+'/assets/fonts/unknown.ttf')).status,404);
      assert.equal((await fetch(app.base+'/',{method:'HEAD'})).status,200);
      assert.deepEqual(await(await fetch(app.base+'/ready')).json(),{status:'ready'});
      assert.deepEqual(await(await fetch(app.base+'/health')).json(),{status:'ok'});
      assert.equal((await fetch(app.base+'/package.json')).status,404);
    });
    await t.test('production WebSocket origin, calibrated coop start, movement/freeze and refresh work',async()=>{
      const sockets=[];
      try {
        const bad=new WebSocket(app.base.replace('http','ws')+'/ws',{origin:'https://evil.test'});const [error]=await once(bad,'error');assert.match(error.message,/403/);
        const a=await connect(app.base),b=await connect(app.base);sockets.push(a.ws,b.ws);
        a.send({type:'create',name:'Runtime host'});const sa=await a.next('session');
        b.send({type:'join',code:sa.code,name:'Runtime guest'});const sb=await b.next('session');
        for(const c of [a,b]){
          c.send({type:'calibrate'});await c.next('ack',m=>m.action==='calibrate');await delay(5100);
          c.send({type:'calibration-result',threshold:.02,contaminated:false});await c.next('calibration-result');await c.next('ack',m=>m.action==='calibration-result');
          c.send({type:'ready',ready:true});await c.next('ack',m=>m.action==='ready');
        }
        a.send({type:'start'});await a.next('ack',m=>m.action==='start');
        a.send({type:'move',seq:1,x:1,z:0,yaw:0,pitch:0,mode:'walk'});
        await a.next('state',m=>m.players.some(p=>p.id===sa.playerId&&p.x>2));
        a.send({type:'mic',available:false});await a.next('ack',m=>m.action==='mic');await a.next('state',m=>m.players.some(p=>p.id===sa.playerId&&p.frozen));
        const fresh=await connect(app.base);sockets.push(fresh.ws);const closed=once(b.ws,'close');
        fresh.send({type:'resume',code:sa.code,token:sb.token});const resumed=await fresh.next('session');await closed;
        assert.equal(resumed.playerId,sb.playerId);assert.notEqual(resumed.token,sb.token);
        const room=(await fresh.next('room')).room;assert.equal(room.players.length,2);assert.equal(room.players.find(p=>p.id===sb.playerId).mic,false);
        fresh.send({type:'mic',available:true,threshold:.02});assert.equal((await fresh.next('error')).code,'CALIBRATION_REQUIRED');
      } finally {for(const ws of sockets)ws.terminate();}
    });
    await app.stop();app=null;
    rmSync(join(folder,'hosting/public/assets/mansion-cover.jpg'));
    app=await launch(folder);
    await t.test('readiness detects a missing packaged visual asset',async()=>{
      assert.equal((await fetch(app.base+'/health')).status,200);
      assert.equal((await fetch(app.base+'/ready')).status,503);
      assert.equal((await fetch(app.base+'/assets/mansion-cover.jpg')).status,503);
    });
    await app.stop();app=null;
    cpSync(join(root,'hosting/public/assets/mansion-cover.jpg'),join(folder,'hosting/public/assets/mansion-cover.jpg'));
    rmSync(join(folder,'hosting/public/app.js'));
    app=await launch(folder);
    await t.test('readiness reports incomplete frontend, rather than a false healthy deployment',async()=>{
      assert.equal((await fetch(app.base+'/health')).status,200);
      assert.equal((await fetch(app.base+'/ready')).status,503);
      assert.equal((await fetch(app.base+'/app.js')).status,503);
    });
    await t.test('runtime verification rejects source drift and edited generated files',()=>{
      const copy=mkdtempSync(join(tmpdir(),'dark-signal-integrity-'));
      try {
        const manifest=JSON.parse(readFileSync(join(root,'hosting/manifest.json'),'utf8'));
        cpSync(join(root,'hosting'),join(copy,'hosting'),{recursive:true});
        for(const path of Object.keys(manifest.inputs)){
          mkdirSync(resolve(copy,path,'..'),{recursive:true});cpSync(join(root,path),join(copy,path));
        }
        const verify=()=>execFileSync(process.execPath,[join(copy,'tools/check-runtime.mjs')],{stdio:'pipe'});
        verify();
        writeFileSync(join(copy,'client/app.ts'),'// deliberately changed fixture');
        assert.throws(verify,/stale or incomplete/);
        cpSync(join(root,'client/app.ts'),join(copy,'client/app.ts'));
        writeFileSync(join(copy,'hosting/public/app.js'),'// deliberately changed fixture');
        assert.throws(verify,/stale or incomplete/);
      } finally {rmSync(copy,{recursive:true,force:true});}
    });
  } finally {if(app)await app.stop();rmSync(folder,{recursive:true,force:true});}
});
