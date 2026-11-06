export interface FrameDriver {
  now(): number;
  request(callback: (time: number) => void): number;
  cancel(id: number): void;
  interval(callback: () => void, milliseconds: number): number;
  clearInterval(id: number): void;
  hidden(): boolean;
}

const browserDriver: FrameDriver = {
  now: () => performance.now(),
  request: callback => requestAnimationFrame(callback),
  cancel: id => cancelAnimationFrame(id),
  interval: (callback, milliseconds) => window.setInterval(callback, milliseconds),
  clearInterval: id => window.clearInterval(id),
  hidden: () => document.hidden,
};

/**
 * Normally draw on the browser's animation clock. Some visible windows can
 * stop receiving animation callbacks while timers and networking still run;
 * a low-frequency watchdog prevents their UI from remaining frozen indefinitely.
 */
export function startFrameLoop(draw: (now: number) => void, driver: FrameDriver = browserDriver) {
  let active = true, frame = 0, generation = 0, lastDraw = driver.now();
  function render(now: number) {
    if (!active) return;
    lastDraw = driver.now();
    draw(now);
    if (active) {
      const scheduled = ++generation;
      frame = driver.request(time => { if (active && scheduled === generation) render(time); });
    }
  }
  render(lastDraw);
  const watchdog = driver.interval(() => {
    const now = driver.now();
    if (active && !driver.hidden() && now - lastDraw >= 500) {
      generation++; driver.cancel(frame);
      render(now);
    }
  }, 250);
  return () => { active = false; generation++; driver.cancel(frame); driver.clearInterval(watchdog); };
}
