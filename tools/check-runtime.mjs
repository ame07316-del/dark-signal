import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { files, fingerprints, inputs, root } from './runtime-files.mjs';
export function verifyRuntime() {
  const manifest = JSON.parse(readFileSync(resolve(root, 'hosting/manifest.json'), 'utf8'));
  if (manifest.version !== 1 || !isDeepStrictEqual(manifest.inputs, fingerprints(inputs())) ||
      !isDeepStrictEqual(manifest.outputs, fingerprints(files('hosting').filter(path => path !== 'hosting/manifest.json')))) {
    throw new Error('Packaged runtime is stale or incomplete. Run npm ci --include=dev && npm run build, then include hosting/ in your changes.');
  }
}
verifyRuntime();
console.log('Packaged runtime matches sources and output checksums.');
