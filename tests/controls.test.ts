import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldDirection, wrapYaw } from '../client/controls.js';
test('first-person forward and strafe rotate with camera yaw', () => {
  const front = worldDirection(0,-1,Math.PI/2);
  assert.ok(Math.abs(front.x+1)<1e-9); assert.ok(Math.abs(front.z)<1e-9);
  const right = worldDirection(1,0,Math.PI/2);
  assert.ok(Math.abs(right.x)<1e-9); assert.ok(Math.abs(right.z+1)<1e-9);
});
test('rotation preserves intent length and wrapping stays inside protocol bounds', () => {
  for (let n=-100;n<100;n++) {
    const yaw = wrapYaw(n); assert.ok(yaw>=-Math.PI && yaw<=Math.PI);
    const d=worldDirection(1,1,yaw); assert.ok(Math.abs(Math.hypot(d.x,d.z)-Math.sqrt(2))<1e-9);
  }
});
