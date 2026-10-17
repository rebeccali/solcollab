import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig, repoRoot } from './config.js';
import { loadPrompts } from './prompts.js';
import { Database } from './db/index.js';
import { LocalDiskStore } from './store.js';
import { loadIpSecret } from './privacy.js';

const config = loadConfig();
const files = await loadPrompts(join(repoRoot, 'prompts'));
const db = new Database(join(config.dataDir, 'solcollab.db'));
db.syncPrompts(files);
process.on('SIGHUP', () => {
  void loadPrompts(join(repoRoot, 'prompts'))
    .then((next) => {
      db.syncPrompts(next);
      files.splice(0, files.length, ...next);
      console.log('Instructions reloaded.');
    })
    .catch((error) =>
      console.error(
        'Instruction reload failed; keeping the existing catalog.',
        error,
      ),
    );
});
const webDirectory = join(repoRoot, 'web/dist');
const app = createApp({
  files,
  db,
  store: new LocalDiskStore(join(config.dataDir, 'images')),
  storeStrokes: config.storeStrokes,
  ipSecret: loadIpSecret(config.dataDir),
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
      db.close();
      if (error) console.error(error);
      process.exit(error ? 1 : 0);
    });
  });
}
