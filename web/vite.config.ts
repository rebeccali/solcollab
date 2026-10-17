import { defineConfig } from 'vite';
import { loadConfig } from '../server/src/config.js';

const { port } = loadConfig();
const target = `http://127.0.0.1:${port}`;

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': target, '/img': target },
  },
});
