import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startFrameLoop, type FrameDriver } from '../client/frame-loop.js';

class FakeDriver implements FrameDriver {
  time = 0;
  isHidden = false;
  nextId = 0;
  frames = new Map<number, (time: number) => void>();
  timers = new Map<number, () => void>();
  cancelled: number[] = [];
  now() { return this.time; }
  request(callback: (time: number) => void) { const id = ++this.nextId; this.frames.set(id, callback); return id; }
  cancel(id: number) { this.cancelled.push(id); this.frames.delete(id); }
  interval(callback: () => void, _milliseconds: number) { const id = ++this.nextId; this.timers.set(id, callback); return id; }
  clearInterval(id: number) { this.timers.delete(id); }
  hidden() { return this.isHidden; }
  watchdog() { for (const timer of this.timers.values()) timer(); }
  nextFrame() {
    const [id, callback] = this.frames.entries().next().value!;
    this.frames.delete(id); callback(this.time);
  }
}

test('a stalled visible frame uses one watchdog render, then resumes without duplicate loops', () => {
  const driver = new FakeDriver(), renders: number[] = [];
  const stop = startFrameLoop(now => renders.push(now), driver);
  assert.deepEqual(renders, [0]);
  assert.equal(driver.frames.size, 1);
  const originalFrame = [...driver.frames.keys()][0];
  const staleCallback = driver.frames.get(originalFrame)!;
  driver.time = 250; driver.watchdog(); assert.deepEqual(renders, [0]);
  driver.time = 500; driver.watchdog();
  assert.deepEqual(renders, [0, 500]);
  assert.ok(driver.cancelled.includes(originalFrame));
  assert.equal(driver.frames.size, 1);
  staleCallback(501); // Even a late cancelled callback cannot start a second loop.
  assert.deepEqual(renders, [0, 500]);
  assert.equal(driver.frames.size, 1);
  driver.time = 516; driver.nextFrame();
  assert.deepEqual(renders, [0, 500, 516]);
  assert.equal(driver.frames.size, 1);
  driver.time = 750; driver.watchdog(); assert.equal(renders.length, 3);
  stop();
  assert.equal(driver.frames.size, 0);
  assert.equal(driver.timers.size, 0);
  driver.time = 1000; driver.watchdog(); assert.equal(renders.length, 3);
});

test('the watchdog does not render a hidden page but catches up after it becomes visible', () => {
  const driver = new FakeDriver(), renders: number[] = [];
  const stop = startFrameLoop(now => renders.push(now), driver);
  driver.isHidden = true; driver.time = 1000; driver.watchdog();
  assert.deepEqual(renders, [0]);
  driver.isHidden = false; driver.watchdog();
  assert.deepEqual(renders, [0, 1000]);
  assert.equal(driver.frames.size, 1);
  stop();
});
