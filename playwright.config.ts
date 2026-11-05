import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { defineConfig } from '@playwright/test';
import chromium from '@sparticuz/chromium';
// Chromium is supplied through npm; no browser download from an external CDN.
const require = createRequire(import.meta.url);
const libs = resolve(tmpdir(), 'dark-signal-browser');
mkdirSync(libs, { recursive: true });
const archive = resolve(libs, 'al2023.tar');
writeFileSync(archive, brotliDecompressSync(readFileSync(resolve(dirname(require.resolve('@sparticuz/chromium')), '../bin/al2023.tar.br'))));
execFileSync('tar', ['xf', archive, '-C', libs]);
process.env.LD_LIBRARY_PATH = `${libs}/lib:${process.env.LD_LIBRARY_PATH || ''}`;
export default defineConfig({
  testDir: './e2e', timeout: 90_000, workers: 1,
  use: {
    baseURL: 'http://localhost:3100', headless: true,
    launchOptions: { executablePath: await chromium.executablePath(), args: [...chromium.args.filter(a => a !== '--single-process'), '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
  },
  webServer: { command: 'npm run build && npx tsx tools/serve-e2e.ts', url: 'http://localhost:3100/health', env: { PORT: '3100' }, reuseExistingServer: false },
});
