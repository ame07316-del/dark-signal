import { createGameServer } from './server.js';
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean);
if (process.env.NODE_ENV === 'production' && !allowedOrigins?.length) throw new Error('ALLOWED_ORIGINS is required in production');
const app = createGameServer({ allowedOrigins });
app.server.listen(port, '0.0.0.0', () => console.log(`Dark Signal backend listening on port ${port}`));
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  if (stopping) return; stopping = true;
  void app.close().catch(() => { process.exitCode = 1; });
});
