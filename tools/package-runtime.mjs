// Built on the developer/CI machine. Hosting needs only Node and production deps.
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { files, fingerprints, inputs, root } from './runtime-files.mjs';
const output = resolve(root, 'hosting');
rmSync(output, { recursive: true, force: true });
function copy(from, to) {
  mkdirSync(dirname(resolve(root, to)), { recursive: true });
  copyFileSync(resolve(root, from), resolve(root, to));
}
for (const path of files('dist').filter(path => /^dist\/[^/]+\.js$/.test(path))) copy(path, path.replace('dist/', 'hosting/server/'));
// Copy the entire source-owned public tree, including fonts, textures and their licenses.
for (const path of files('public')) copy(path, `hosting/${path}`);
copy('dist/public/app.js', 'hosting/public/app.js');
writeFileSync(resolve(output, 'manifest.json'), JSON.stringify({ version: 1, inputs: fingerprints(inputs()), outputs: fingerprints(files('hosting')) }, null, 2)+'\n');
console.log('Packaged hosting/ runtime. No TypeScript or build tools required on host.');
