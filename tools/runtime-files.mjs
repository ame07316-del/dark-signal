import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export const root = fileURLToPath(new URL('../', import.meta.url));
export function files(folder) {
  return readdirSync(resolve(root, folder), { withFileTypes: true }).flatMap(entry => {
    const path = `${folder}/${entry.name}`;
    return entry.isDirectory() ? files(path) : [path];
  }).sort();
}
export function fingerprints(paths) {
  return Object.fromEntries(paths.sort().map(path => [path, createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')]));
}
export function inputs() {
  return [...files('src'), ...files('client'), ...files('public'),
    'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.client.json',
    'tools/clean-build.mjs', 'tools/package-runtime.mjs', 'tools/runtime-files.mjs', 'tools/check-runtime.mjs'];
}
