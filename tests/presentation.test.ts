import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closedDoors, initialDoors } from '../src/map.js';
import { advance, newMotion } from '../src/movement.js';
import { MotionPresentation, type MotionIntent } from '../client/presentation.js';
import { movementStatus } from '../client/movement-status.js';

const walkRight: MotionIntent = { x: 1, z: 0, yaw: 0, mode: 'walk' };
const walkDown: MotionIntent = { x: 0, z: 1, yaw: 0, mode: 'walk' };

function advanceTarget(target: ReturnType<typeof newMotion>, intent: MotionIntent, now: number, walls = closedDoors(initialDoors())) {
  target.input = { ...intent, at: now, seq: Math.floor(now) };
  advance(target, true, now, walls);
}

test('the presented position advances each frame and absorbs a small backward correction', () => {
  const target = newMotion(), presenter = new MotionPresentation();
  let last = presenter.update(target, walkRight, 0).x;
  let moving = 0;
  for (let frame = 1; frame <= 120; frame++) {
    const now = frame * 1000 / 60;
    if (frame % 3 === 0) advanceTarget(target, walkRight, now);
    if (frame === 30) target.x -= .12; // late authoritative correction
    const x = presenter.update(target, walkRight, now).x;
    assert.ok(x >= last - 1e-9, `presentation went backwards at frame ${frame}`);
    assert.ok(x - last < .08, `large visual jump at frame ${frame}`);
    if (x - last > .001) moving++;
    last = x;
  }
  assert.ok(moving >= 115);
  assert.ok(Math.abs(last - target.x) < .25);
});

test('presentation advances at the intended speed on a slow ten-frame-per-second device', () => {
  const target = newMotion(), presenter = new MotionPresentation();
  presenter.update(target, walkRight, 0);
  let x = target.x;
  for (let frame = 1; frame <= 10; frame++) {
    const now = frame * 100;
    advanceTarget(target, walkRight, now);
    advanceTarget(target, walkRight, now);
    x = presenter.update(target, walkRight, now).x;
  }
  assert.ok(x > 4.2 && x < 4.6, `unexpected one-second position: ${x}`);
});

test('presentation respects a closed door and proceeds after it opens', () => {
  const target = newMotion(); target.x = 3; target.z = 5.2;
  const doors = initialDoors(); doors['entry-west'] = false;
  const presenter = new MotionPresentation();
  presenter.update(target, walkDown, 0, closedDoors(doors));
  let displayed = target.z;
  for (let frame = 1; frame <= 180; frame++) {
    const now = frame * 1000 / 60;
    if (frame === 91) doors['entry-west'] = true;
    const walls = closedDoors(doors);
    if (frame % 3 === 0) advanceTarget(target, walkDown, now, walls);
    displayed = presenter.update(target, walkDown, now, walls).z;
    if (frame <= 90) assert.ok(displayed <= 5.7 + 1e-9, `crossed closed door: ${displayed}`);
  }
  assert.ok(displayed > 6.6, `did not move through open door: ${displayed}`);
});

test('freezes, long frame gaps and large corrections use the target immediately', () => {
  const target = newMotion(), presenter = new MotionPresentation();
  presenter.update(target, walkRight, 0);
  presenter.update(target, walkRight, 16);
  target.x = 2.1;
  assert.equal(presenter.update(target, null, 32).x, 2.1); // downed, lost microphone or connection
  assert.equal(presenter.update(target, null, 48).x, 2.1);
  assert.equal(presenter.update(target, walkRight, 500).x, 2.1); // tab/background stall
  target.x = 4;
  assert.equal(presenter.update(target, walkRight, 516).x, 4);
});

test('a closed door between a corrected target and the camera does not trap the view', () => {
  const target = newMotion(); target.x = 3; target.z = 5.5;
  const doors = initialDoors(); doors['entry-west'] = false;
  const presenter = new MotionPresentation();
  presenter.update(target, null, 0, closedDoors(doors));
  target.z = 6.8; // an authoritative correction on the other side of the newly closed door
  const displayed = presenter.update(target, { ...walkDown, z: 0 }, 16, closedDoors(doors));
  assert.equal(displayed.z, target.z);
});

test('movement status distinguishes a downed player, round end and a missing microphone', () => {
  assert.match(movementStatus('downed', true, false), /ساقط.*الحركة متوقفة/);
  assert.match(movementStatus('last-chance', true, false), /الفرصة الأخيرة/);
  assert.match(movementStatus('active', false, false), /المايك/);
  assert.match(movementStatus('downed', true, true), /انتهت الجولة.*إعادة للردهة/);
  assert.equal(movementStatus('active', true, false), '');
});
