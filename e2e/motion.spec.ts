import { test, expect } from '@playwright/test';

test('local walking stays smooth with delayed movement messages and the 3D viewport resizes', async ({ browser }) => {
  const context = await browser.newContext({ permissions: ['microphone'] });
  await context.addInitScript(() => {
    // Quiet synthetic microphone for this movement-only fixture.
    const NativeAudio = window.AudioContext;
    (window as any).AudioContext = class extends NativeAudio {
      createAnalyser() {
        const analyser = super.createAnalyser();
        analyser.getFloatTimeDomainData = (data: Float32Array) => data.fill(0);
        return analyser;
      }
    };
    const nativeFrame = window.requestAnimationFrame.bind(window);
    (window as any).__pauseAnimation = false;
    window.requestAnimationFrame = callback => nativeFrame(time => { if (!(window as any).__pauseAnimation) callback(time); });
    const nativeArc = CanvasRenderingContext2D.prototype.arc;
    const nativeText = CanvasRenderingContext2D.prototype.fillText;
    (window as any).__idleDraws = 0;
    CanvasRenderingContext2D.prototype.fillText = function(text, x, y, maxWidth) {
      if (this.canvas.id === 'arena' && text === 'بانتظار بدء اختبار الفريق') (window as any).__idleDraws++;
      if (maxWidth === undefined) return nativeText.call(this, text, x, y);
      return nativeText.call(this, text, x, y, maxWidth);
    };
    const samples: Array<{ t: number; x: number }> = [];
    (window as any).__motionSamples = samples;
    (window as any).__recordMotion = false;
    CanvasRenderingContext2D.prototype.arc = function(x, y, radius, start, end, anticlockwise) {
      if ((window as any).__recordMotion && this.canvas.id === 'arena' && radius === 12) samples.push({ t: performance.now(), x });
      return nativeArc.call(this, x, y, radius, start, end, anticlockwise);
    };
    // Approximate 300 ms RTT for motion without delaying lobby or microphone setup.
    const NativeWebSocket = WebSocket;
    class DelayedSocket {
      static readonly OPEN = NativeWebSocket.OPEN;
      private socket: WebSocket;
      onopen: ((e: Event) => void) | null = null;
      onclose: ((e: CloseEvent) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;
      onmessage: ((e: MessageEvent) => void) | null = null;
      constructor(url: string) {
        this.socket = new NativeWebSocket(url);
        this.socket.onopen = e => this.onopen?.(e);
        this.socket.onclose = e => this.onclose?.(e);
        this.socket.onerror = e => this.onerror?.(e);
        this.socket.onmessage = e => {
          if (JSON.parse(e.data).type === 'state') setTimeout(() => this.onmessage?.(e), 150);
          else this.onmessage?.(e);
        };
      }
      get readyState() { return this.socket.readyState; }
      send(data: string) {
        if (JSON.parse(data).type === 'move') setTimeout(() => { if (this.socket.readyState === NativeWebSocket.OPEN) this.socket.send(data); }, 150);
        else this.socket.send(data);
      }
    }
    (window as any).WebSocket = DelayedSocket;
  });

  const page = await context.newPage();
  await page.goto('/');
  await page.waitForTimeout(650);
  expect(await page.evaluate(() => (window as any).__idleDraws)).toBe(1);
  await page.locator('#solo').click();
  await page.locator('#mic').click();
  await expect(page.locator('#ready')).toBeEnabled({ timeout: 20000 });
  await page.locator('#ready').click();
  await page.locator('#start').click();
  await expect(page.locator('#stats')).toContainText('tick');
  await page.evaluate(() => { (window as any).__motionSamples.length = 0; (window as any).__recordMotion = true; });
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(1800);
  await page.keyboard.up('KeyD');
  await page.evaluate(() => { (window as any).__recordMotion = false; });
  const result = await page.evaluate(() => {
    const samples = (window as any).__motionSamples as Array<{ t: number; x: number }>;
    const differences = samples.slice(1).map((p, i) => ({ dt: p.t - samples[i].t, dx: (p.x - samples[i].x) / 25 }));
    const regular = differences.filter((d, i) => samples[i].t - samples[0].t > 200 && d.dt > 0 && d.dt < 55);
    return {
      frames: regular.length,
      distance: (samples.at(-1)!.x - samples[0].x) / 25,
      movingFraction: regular.filter(d => d.dx > .001).length / regular.length,
      largestBackward: Math.min(...regular.map(d => d.dx)),
    };
  });
  expect(result.frames).toBeGreaterThan(30);
  expect(result.distance).toBeGreaterThan(2.5);
  expect(result.movingFraction).toBeGreaterThan(.6);
  expect(result.largestBackward).toBeGreaterThan(-.05);

  // Reproduce a visible window whose requestAnimationFrame callbacks stop firing.
  await page.evaluate(() => { (window as any).__motionSamples.length = 0; (window as any).__pauseAnimation = true; (window as any).__recordMotion = true; });
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(1600);
  await page.keyboard.up('KeyD');
  const fallback = await page.evaluate(() => {
    const samples = (window as any).__motionSamples as Array<{ x: number }>;
    return { frames: samples.length, distance: samples.length ? (samples.at(-1)!.x - samples[0].x) / 25 : 0 };
  });
  expect(fallback.frames).toBeGreaterThanOrEqual(2);
  expect(fallback.frames).toBeLessThan(8);
  expect(fallback.distance).toBeGreaterThan(.5);
  await page.evaluate(() => { (window as any).__motionSamples.length = 0; (window as any).__pauseAnimation = false; });
  await expect.poll(() => page.evaluate(() => (window as any).__motionSamples.length)).toBeGreaterThan(5);
  await page.evaluate(() => { (window as any).__recordMotion = false; });

  await page.locator('#toggleView').click();
  await expect(page.locator('#view3d')).toBeVisible();
  const hasCorrectSize = () => page.evaluate(() => {
    const host = document.getElementById('viewport')!;
    const canvas = document.getElementById('view3d') as HTMLCanvasElement;
    const ratio = Math.min(devicePixelRatio, 1.5);
    return host.clientWidth > 0 && host.clientHeight > 0 &&
      canvas.width === Math.floor(host.clientWidth * ratio) && canvas.height === Math.floor(host.clientHeight * ratio);
  });
  await expect.poll(hasCorrectSize).toBe(true);
  await page.setViewportSize({ width: 980, height: 720 });
  await expect.poll(hasCorrectSize).toBe(true);
  await context.close();
});
