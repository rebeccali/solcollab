import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig, repoRoot } from './config.js';
import { loadPrompts } from './prompts.js';

const config = loadConfig();
const files = await loadPrompts(join(repoRoot, 'prompts'));
const webDirectory = join(repoRoot, 'web/dist');
const app = createApp({
  files,
  ...(existsSync(webDirectory) ? { webDirectory } : {}),
});
const server = serve(
  { fetch: app.fetch, hostname: '127.0.0.1', port: config.port },
  () => {
    console.log(`Solcollab API: http://127.0.0.1:${config.port}`);
  },
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close((error) => {
      if (error) console.error(error);
      process.exit(error ? 1 : 0);
    });
  });
}
