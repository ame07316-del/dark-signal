import { test, expect } from '@playwright/test';
test('two browser players calibrate, start, move and leave', async ({ browser }) => {
  const first = await browser.newContext({ permissions: ['microphone'] });
  const second = await browser.newContext({ permissions: ['microphone'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  for(const context of [first,second])await context.addInitScript(()=>{
    const NativeAudio=window.AudioContext;(window as any).__audio=[];(window as any).__tones=0;
    window.AudioContext=class extends NativeAudio {constructor(options?:AudioContextOptions){super(options);(window as any).__audio.push(this);}createOscillator(){(window as any).__tones++;return super.createOscillator();}};
    const Native=window.RTCPeerConnection;
    (window as any).__pcs=[];
    window.RTCPeerConnection=class extends Native {constructor(config?:RTCConfiguration){super(config);(window as any).__pcs.push(this);}};
  });
  const a = await first.newPage(), b = await second.newPage();
  const errors: string[] = []; for (const p of [a,b]) p.on('pageerror', e => errors.push(e.message));
  await Promise.all([a.goto('/'), b.goto('/')]);
  await a.locator('#name').fill('أول'); await a.locator('#create').click();
  await expect(a.locator('#roomCode')).toHaveText(/[A-F0-9]{6}/);
  const code = await a.locator('#roomCode').textContent();
  await b.locator('#name').fill('ثاني'); await b.locator('#code').fill(code!); await b.locator('#join').click();
  await expect(a.locator('#players li')).toHaveCount(2);
  await Promise.all([a.locator('#mic').click(), b.locator('#mic').click()]);
  await expect(a.locator('#ready')).toBeEnabled({ timeout: 35_000 });
  await expect(b.locator('#ready')).toBeEnabled({ timeout: 35_000 });
  await expect(a.locator('#voiceStatus')).toContainText(/اتصال صوتي مباشر نشط|الصوت متصل/, {timeout:20000});
  await expect(b.locator('#voiceStatus')).toContainText(/اتصال صوتي مباشر نشط|الصوت متصل/, {timeout:20000});
  for(const page of [a,b])await expect.poll(async()=>page.evaluate(async()=>{
    let bytes=0;for(const pc of (window as any).__pcs as RTCPeerConnection[]){const stats=await pc.getStats();stats.forEach((s:any)=>{if(s.type==='inbound-rtp'&&s.kind==='audio')bytes+=s.bytesReceived||0;});}return bytes;
  }),{timeout:20000}).toBeGreaterThan(0);
  await a.locator('#ready').click(); await b.locator('#ready').click();
  await expect(a.locator('#start')).toBeEnabled(); await a.locator('#start').click();
  await expect(a.locator('#stats')).toContainText('tick');
  await expect(a.locator('#hunters')).toContainText('حمزة');
  await expect(b.locator('#hunters')).toContainText(/رنا|حمزة/);
  await a.bringToFront();
  await a.locator('#toggleView').click();
  await expect(a.locator('#view3d')).toBeVisible();
  await expect(a.locator('#arena')).toBeHidden();
  await expect(a.locator('#toggleView')).toHaveAttribute('aria-pressed', 'true');
  await a.locator('#flashlight').click();
  await expect(a.locator('#flashlight')).toHaveAttribute('aria-pressed', 'false');
  await a.keyboard.press('KeyF');
  await expect(a.locator('#flashlight')).toHaveAttribute('aria-pressed', 'true');
  expect(await a.evaluate(()=>(window as any).__tones)).toBeGreaterThan(0);
  expect(await a.evaluate(()=>(window as any).__audio.length)).toBe(1);
  const before = Number((await a.locator('#stats').textContent())!.match(/x ([0-9.]+)/)![1]);
  await a.keyboard.down('KeyW'); await a.waitForTimeout(300); await a.keyboard.up('KeyW');
  await expect.poll(async () => Number((await a.locator('#stats').textContent())!.match(/x ([0-9.]+)/)![1])).toBeGreaterThan(before + .2);
  await expect(b.locator('#stats')).toContainText('tick');
  await a.locator('#toggleView').click();
  const z = async () => Number((await a.locator('#stats').textContent())!.match(/z ([0-9.]+)/)![1]);
  await a.keyboard.down('KeyS');
  await expect.poll(z,{intervals:[50]}).toBeGreaterThan(4.8);
  await a.keyboard.up('KeyS'); await a.waitForTimeout(120);
  await expect(a.locator('#interact')).toBeEnabled();
  await a.keyboard.press('KeyE');
  await expect(a.locator('#interact')).toContainText('فتح');
  await a.keyboard.down('KeyS');await a.waitForTimeout(700);await a.keyboard.up('KeyS');
  expect(await z()).toBeLessThan(5.71);
  await a.keyboard.press('KeyE');await expect(a.locator('#interact')).toContainText('قفل');
  await a.keyboard.down('KeyS');
  await expect.poll(z,{intervals:[50]}).toBeGreaterThan(6.5);await a.keyboard.up('KeyS');
  // Move beyond proximity range: outgoing RTP tracks must be detached, not the mic device.
  await a.keyboard.down('KeyD');await a.waitForTimeout(250);await a.keyboard.up('KeyD');
  await a.keyboard.down('KeyS');await expect.poll(z,{intervals:[50],timeout:10000}).toBeGreaterThan(11.8);await a.keyboard.up('KeyS');
  for(const page of [a,b])await expect.poll(async()=>page.evaluate(()=>((window as any).__pcs as RTCPeerConnection[]).filter(p=>p.connectionState==='connected').every(p=>p.getSenders().every(s=>s.track===null))),{timeout:5000}).toBe(true);
  await a.keyboard.down('KeyW');await expect.poll(z,{intervals:[50],timeout:10000}).toBeLessThan(7);await a.keyboard.up('KeyW');
  for(const page of [a,b])await expect.poll(async()=>page.evaluate(()=>((window as any).__pcs as RTCPeerConnection[]).filter(p=>p.connectionState==='connected').some(p=>p.getSenders().some(s=>s.track?.kind==='audio'))),{timeout:5000}).toBe(true);


  await b.locator('#toggleView').click();
  await expect(b.locator('#view3d')).toBeVisible();
  // Drag-look is the fallback for touch and browsers that refuse pointer lock.
  const surface = await b.locator('#view3d').boundingBox();
  await b.mouse.move(surface!.x + 100, surface!.y + 100);
  await b.mouse.down(); await b.mouse.move(surface!.x + 180, surface!.y + 100, { steps: 5 }); await b.mouse.up();
  await b.locator('#toggleView').click();
  await expect(b.locator('#arena')).toBeVisible();
  const mobileOverflow = await b.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(mobileOverflow).toBe(false);
  await a.evaluate(()=>{
    const pc=((window as any).__pcs as RTCPeerConnection[]).find(p=>p.connectionState==='connected')!;
    const track=pc.getSenders().find(s=>s.track)?.track!;track.stop();track.dispatchEvent(new Event('ended'));
  });
  await expect(a.locator('#mic')).toBeEnabled();
  const stopped=await z();await a.keyboard.down('KeyW');await a.waitForTimeout(300);await a.keyboard.up('KeyW');
  expect(await z()).toBe(stopped);
  await a.locator('#mic').click();
  await expect(a.locator('#players li').filter({hasText:'أول'})).toContainText('مايك جاهز',{timeout:25000});
  await expect.poll(async()=>a.evaluate(()=>((window as any).__pcs as RTCPeerConnection[]).filter(p=>p.connectionState==='connected').length),{timeout:15000}).toBe(1);
  await b.locator('#leave').click(); await expect(a.locator('#players li')).toHaveCount(1);
  expect(errors).toEqual([]);
  await first.close(); await second.close();
});

test('solo button allows one real browser to calibrate and explore', async ({ browser }) => {
  const context=await browser.newContext({permissions:['microphone']});const page=await context.newPage();
  await page.goto('/');await page.locator('#name').fill('مجرب');await page.locator('#solo').click();
  await expect(page.locator('#players li')).toHaveCount(1);
  await expect(page.locator('#phase')).toContainText('تجربة فردية');
  await expect(page.locator('#start')).toBeDisabled();await page.locator('#mic').click();
  await expect(page.locator('#ready')).toBeEnabled({timeout:35000});await page.locator('#ready').click();
  await expect(page.locator('#start')).toBeEnabled();await page.locator('#start').click();
  await expect(page.locator('#stats')).toContainText('tick');await expect(page.locator('#hunters')).toContainText('حمزة');
  await page.locator('#toggleView').click();await expect(page.locator('#view3d')).toBeVisible();
  await page.keyboard.down('KeyW');
  await expect.poll(async()=>Number((await page.locator('#stats').textContent())!.match(/x ([0-9.]+)/)![1]),{intervals:[50]}).toBeGreaterThan(2.2);
  await page.keyboard.up('KeyW');await page.locator('#leave').click();await expect(page.locator('#solo')).toBeEnabled();
  await context.close();
});

test('four participants build all six voice links after queued quiet calibration',async({browser})=>{
  const contexts=[];const pages=[];
  for(let i=0;i<4;i++){
    const context=await browser.newContext({permissions:['microphone']});contexts.push(context);
    await context.addInitScript(()=>{
      const Native=window.RTCPeerConnection;(window as any).__pcs=[];
      window.RTCPeerConnection=class extends Native{constructor(c?:RTCConfiguration){super(c);(window as any).__pcs.push(this);}};
      // A quiet calibration fixture only; the actual mic track remains the browser's fake device.
      const Audio=window.AudioContext;
      window.AudioContext=class extends Audio{createAnalyser(){const a=super.createAnalyser();a.getFloatTimeDomainData=(data:Float32Array)=>data.fill(0);return a;}};
    });
    const page=await context.newPage();pages.push(page);await page.goto('/');await page.locator('#name').fill(`فريق ${i}`);
  }
  await pages[0].locator('#create').click();await expect(pages[0].locator('#roomCode')).toHaveText(/[A-F0-9]{6}/);
  const code=(await pages[0].locator('#roomCode').textContent())!;
  for(const page of pages.slice(1)){await page.locator('#code').fill(code);await page.locator('#join').click();}
  await expect(pages[0].locator('#players li')).toHaveCount(4);
  await Promise.all(pages.map(page=>page.locator('#mic').click()));
  for(const page of pages){await expect(page.locator('#ready')).toBeEnabled({timeout:40000});await page.locator('#ready').click();}
  for(const page of pages)await expect.poll(async()=>page.evaluate(()=>((window as any).__pcs as RTCPeerConnection[]).filter(p=>p.connectionState==='connected').length),{timeout:20000}).toBe(3);
  for(const context of contexts)await context.close();
});

test('blank-name entry and refresh preserve one solo seat',async({browser})=>{
  const context=await browser.newContext();const page=await context.newPage();await page.goto('/');await page.locator('#solo').click();
  await expect(page.locator('#players li')).toHaveCount(1);const code=await page.locator('#roomCode').textContent();
  await expect(page.locator('#name')).toHaveValue(/لاعب \d+/);await page.reload();await expect(page.locator('#roomCode')).toHaveText(code!);await expect(page.locator('#players li')).toHaveCount(1);await context.close();
});

test('game HUD fires one shot and collects the first clue through real input',async({browser})=>{
  const context=await browser.newContext({permissions:['microphone']});const page=await context.newPage();await page.goto('/');await page.locator('#solo').click();await page.locator('#mic').click();await expect(page.locator('#ready')).toBeEnabled({timeout:25000});await page.locator('#ready').click();await page.locator('#start').click();
  await expect(page.locator('#life')).toContainText('قلوب 3/3');await page.keyboard.press('KeyG');await expect(page.locator('#life')).toContainText('ذخيرة 0');await expect(page.locator('#shoot')).toBeDisabled();
  const position=async(axis:string)=>Number((await page.locator('#stats').textContent())!.match(new RegExp(`${axis} ([0-9.]+)`))![1]);
  await page.keyboard.down('KeyD');await expect.poll(()=>position('x'),{intervals:[50],timeout:5000}).toBeGreaterThan(3);await page.keyboard.up('KeyD');
  await page.keyboard.down('KeyS');await expect.poll(()=>position('z'),{intervals:[50],timeout:7000}).toBeGreaterThan(8.8);await page.keyboard.up('KeyS');
  await expect(page.locator('#interact')).toContainText('جمع دليل');await page.keyboard.press('KeyE');await expect(page.locator('#clues')).toContainText(/الأدلة: \d/);await context.close();
});
