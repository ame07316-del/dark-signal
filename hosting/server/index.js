import { createGameServer } from './server.js';
import { runtimeConfig } from './config.js';
const { port, allowedOrigins } = runtimeConfig();
const app = createGameServer({ allowedOrigins });
app.server.listen(port, '0.0.0.0', () => console.log(`Dark Signal backend listening on port ${port}`));
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'])
    process.on(signal, () => {
        if (stopping)
            return;
        stopping = true;
        void app.close().catch(() => { process.exitCode = 1; });
    });
