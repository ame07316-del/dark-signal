import { rmSync } from 'node:fs';
// Remove only disposable compiler output, never sources or the checked-in runtime.
rmSync(new URL('../dist/', import.meta.url), { recursive: true, force: true });
