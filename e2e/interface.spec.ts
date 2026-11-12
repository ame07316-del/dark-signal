import { test, expect, type BrowserContext } from '@playwright/test';

async function quietMicrophone(context: BrowserContext) {
  await context.addInitScript(() => {
    const Audio = window.AudioContext;
    window.AudioContext = class extends Audio {
      createAnalyser() {
        const analyser = super.createAnalyser();
        analyser.getFloatTimeDomainData = (data: Float32Array) => data.fill(0);
        return analyser;
      }
    };
  });
}

test('Arabic entry remains usable on desktop and narrow phones', async ({ browser }) => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('#homeScreen')).toBeVisible();
    await expect(page.locator('#roomScreen')).toBeHidden();
    await expect(page.locator('#heroTitle')).toContainText('القصر يصغي');
    await expect(page.locator('#create')).toBeEnabled();
    await expect(page.locator('#join')).toBeVisible();
    await expect(page.locator('#solo')).toContainText('تجربة فردية');
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.fonts.check('16px IBMPlexArabic'))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('.hero-art').evaluate(el => getComputedStyle(el).backgroundImage)).toContain('mansion-cover.jpg');
    await page.screenshot({ path: `test-results/interface-home-${viewport.width}.png`, fullPage: true });
    expect(errors).toEqual([]);
    await context.close();
  }
});

test('solo lobby explains isolation, rejects another player and returns home', async ({ browser }) => {
  const host = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const guest = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const a = await host.newPage(), b = await guest.newPage();
  await Promise.all([a.goto('/'), b.goto('/')]);
  await a.locator('#name').fill('المضيف');
  await a.locator('#solo').click();
  await expect(a.locator('#homeScreen')).toBeHidden();
  await expect(a.locator('#roomScreen')).toBeVisible();
  await expect(a.locator('#roomTitle')).toHaveText('تجربة فردية');
  await expect(a.locator('#roomMode')).toContainText('لا يمكن للاعبين الآخرين الانضمام');
  await expect(a.locator('#firstStepTitle')).toHaveText('تجربة خاصة');
  await expect(a.locator('#copy')).toBeDisabled();
  await expect(a.locator('#start')).toBeDisabled();
  await expect(a.locator('#players li')).toHaveCount(1);
  const code = (await a.locator('#roomCode').textContent())!;
  await a.screenshot({ path: 'test-results/interface-lobby-1440.png', fullPage: true });
  await b.locator('#name').fill('الضيف');
  await b.locator('#code').fill(code);
  await b.locator('#join').click();
  await expect(b.locator('#entryError')).toContainText('لا تقبل انضمام');
  await expect(b.locator('#homeScreen')).toBeVisible();
  await a.reload();
  await expect(a.locator('#roomCode')).toHaveText(code);
  await expect(a.locator('#players li')).toHaveCount(1);
  await a.locator('#leave').click();
  await expect(a.locator('#homeScreen')).toBeVisible();
  await expect(a.locator('#solo')).toBeEnabled();
  expect(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await host.close(); await guest.close();
});

test('mobile game controls, local 3D assets and result presentation', async ({ browser }) => {
  const context = await browser.newContext({ permissions: ['microphone'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await quietMicrophone(context);
  // Capture a real state frame; only the results UI below is exercised with synthetic result data.
  await context.addInitScript(() => {
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        (window as any).__interfaceSocket = this;
        this.addEventListener('message', event => {
          if (!event.isTrusted) return;
          const message = JSON.parse(event.data);
          if (message.type === 'state') {
            (window as any).__interfaceState = message;
            if ((window as any).__holdInterfaceState) event.stopImmediatePropagation();
          }
          if (message.type === 'room') (window as any).__interfaceRoom = message.room;
        });
      }
    };
  });
  const page = await context.newPage();
  const errors: string[] = [], textureResponses = new Map<string, number>();
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (/\/assets\/aged-(plaster|wood)\.jpg$/.test(response.url())) textureResponses.set(new URL(response.url()).pathname, response.status()); });
  await page.goto('/');
  await page.locator('#solo').scrollIntoViewIfNeeded();
  await page.locator('#solo').click();
  await expect(page.locator('#roomScreen')).toBeVisible();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await page.locator('#mic').click();
  await expect(page.locator('#ready')).toBeEnabled({ timeout: 25_000 });
  await page.locator('#ready').click(); await page.locator('#start').click();
  await expect(page.locator('#gamePanel')).toBeVisible();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(page.locator('#prepPanel')).toBeHidden();
  await expect(page.locator('#stats')).toContainText('tick');
  await expect(page.locator('#arena')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/interface-game-390.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });

  // Hold a real touch pointer on the D-pad and verify the authoritative position changes.
  const right = page.locator('[data-key="KeyD"]'); await right.scrollIntoViewIfNeeded();
  const rect = (await right.boundingBox())!;
  const cdp = await context.newCDPSession(page);
  const pos = async () => Number((await page.locator('#stats').textContent())!.match(/x ([0-9.]+)/)![1]);
  const before = await pos();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, id: 1 }] });
  await expect.poll(pos, { timeout: 5000, intervals: [50] }).toBeGreaterThan(before + .25);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(250); const stopped = await pos();
  await page.waitForTimeout(350); expect((await pos()) - stopped).toBeLessThan(.15);

  await page.locator('#toggleView').click();
  await expect(page.locator('#view3d')).toBeVisible();
  await expect.poll(() => textureResponses.size, { timeout: 10_000 }).toBe(2);
  expect([...textureResponses.values()]).toEqual([200, 200]);
  await page.locator('#view3d').screenshot({ path: 'test-results/interface-scene-390.png' });
  await page.locator('#toggleView').click();
  await expect(page.locator('#arena')).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  for (const [outcome, title] of [['complete', 'نجوتم معًا'], ['partial', 'هربتم دون سليم'], ['loss', 'انتهت الجولة']]) {
    await page.evaluate(({ outcome }) => {
      const w = window as any, state = structuredClone(w.__interfaceState);
      w.__holdInterfaceState = true;
      state.round.self.life = 'escaped';
      state.round.result = { outcome, reason: 'نتيجة تجريبية', durationSeconds: 73, revives: 1, players: [{ name: 'لاعب تجريبي', life: 'escaped' }] };
      w.__interfaceSocket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(state) }));
    }, { outcome });
    await expect(page.locator('#resultCard')).toBeVisible();
    await expect(page.locator('#resultCard')).toBeInViewport();
    await expect(page.locator('#resultTitle')).toHaveText(title);
    await expect(page.locator('#results')).toContainText('73 ثانية');
    await expect(page.locator('#rematch')).toBeEnabled();
  }
  await page.evaluate(() => {
    const w = window as any, room = structuredClone(w.__interfaceRoom); room.phase = 'lobby';
    w.__interfaceSocket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'room', room }) }));
  });
  await expect(page.locator('#prepPanel')).toBeVisible();
  await expect(page.locator('#resultCard')).toBeHidden();
  expect(errors).toEqual([]);
  await context.close();
});
