import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runtimeConfig } from '../src/config.js';
test('production requires explicit origins and accepts a trailing slash without breaking WS', () => {
  assert.throws(() => runtimeConfig({ NODE_ENV:'production' }), /ALLOWED_ORIGINS/);
  assert.deepEqual(runtimeConfig({ NODE_ENV:'production', PORT:'8080', ALLOWED_ORIGINS:' https://dark-signal.bonto.run/,https://dark-signal.bonto.run ' }), { port:8080, allowedOrigins:['https://dark-signal.bonto.run'] });
});
test('configuration rejects invalid ports, wildcard origins, paths and embedded credentials', () => {
  for (const PORT of ['0','65536','abc','1.5']) assert.throws(() => runtimeConfig({ PORT }), /PORT/);
  for (const ALLOWED_ORIGINS of ['*','https://host.test/ws','https://u:password@host.test','file:///tmp/a','https://host.test?x=1']) assert.throws(() => runtimeConfig({ ALLOWED_ORIGINS }), /ALLOWED_ORIGINS/);
  assert.deepEqual(runtimeConfig({}), { port:3000, allowedOrigins:undefined });
});
