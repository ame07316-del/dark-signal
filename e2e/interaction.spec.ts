import { test, expect } from '@playwright/test';

test('door feedback follows authoritative messages even while rendering is paused', async ({ browser }) => {
  const context = await browser.newContext({ permissions: ['microphone'] });
  await context.addInitScript(() => {
    const Audio = window.AudioContext;
    window.AudioContext = class extends Audio {
      createAnalyser() {
        const analyser = super.createAnalyser();
        analyser.getFloatTimeDomainData = (data: Float32Array) => data.fill(0);
        return analyser;
      }
    };
    const request = window.requestAnimationFrame.bind(window);
    (window as any).__pauseFrames = false; (window as any).__draws = 0;
    window.requestAnimationFrame = callback => request(time => { if (!(window as any).__pauseFrames) callback(time); });
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function(...args:any[]) {
      if (this.canvas.id === 'arena') (window as any).__draws++;
      return (draw as any).apply(this, args);
    };
  });
  const page = await context.newPage();
  await page.goto('/'); await page.locator('#solo').click(); await page.locator('#mic').click();
  await expect(page.locator('#ready')).toBeEnabled({ timeout: 25_000 });
  await page.locator('#ready').click(); await page.locator('#start').click();
  const z = async () => Number((await page.locator('#stats').textContent())!.match(/z ([0-9.]+)/)![1]);
  await expect(page.locator('#stats')).toContainText('tick');
  await page.keyboard.down('KeyS');
  await expect.poll(z, { intervals: [50], timeout: 5000 }).toBeGreaterThan(4.6);
  await page.keyboard.up('KeyS'); await page.waitForTimeout(150);
  if (await z() > 5.35) {
    await page.keyboard.down('KeyW'); await expect.poll(z, { intervals: [50] }).toBeLessThan(5.2);
    await page.keyboard.up('KeyW'); await page.waitForTimeout(150);
  }
  await expect(page.locator('#interact')).toBeEnabled();
  await expect(page.locator('#interact')).toContainText('قفل');
  // Suppress RAF and tell the watchdog the page is hidden, without stopping WebSocket messages.
  await page.evaluate(() => { (window as any).__pauseFrames = true; Object.defineProperty(document, 'hidden', { value: true, configurable: true }); });
  await page.waitForTimeout(750);
  const before = await page.evaluate(() => (window as any).__draws);
  await page.evaluate(() => (document.getElementById('interact') as HTMLButtonElement).click());
  await expect(page.locator('#interact')).toContainText('فتح', { timeout: 5000 });
  expect(await page.evaluate(() => (window as any).__draws)).toBe(before);
  await context.close();
});
