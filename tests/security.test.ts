import {test}from'node:test';import assert from'node:assert/strict';import{createHash}from'node:crypto';
import{OwnerAuth,ConnectionLimiter}from'../src/security.js';
test('owner auth disabled by default, uses hash and caps attempts across sockets',()=>{
  assert.equal(new OwnerAuth('').authenticate('ip','anything'),false);let time=0;const value='test-fixture-not-a-deployed-secret';const hash=createHash('sha256').update(value).digest('hex');const auth=new OwnerAuth(hash,()=>time);
  assert.equal(auth.authenticate('ip',value),true);for(let i=0;i<4;i++)assert.equal(auth.authenticate('ip','bad'),false);assert.equal(auth.authenticate('ip',value),false);time=60001;assert.equal(auth.authenticate('ip',value),true);
  assert.equal(auth.verify('x'.repeat(129)),false);assert.throws(()=>new OwnerAuth('bad'));
});
test('token bucket is bounded and refills without trusting client time',()=>{let time=0;const limit=new ConnectionLimiter(1,2,()=>time);assert.ok(limit.allow('a'));assert.ok(limit.allow('a'));assert.equal(limit.allow('a'),false);time=1000;assert.ok(limit.allow('a'));assert.ok(limit.allow('b'));});
