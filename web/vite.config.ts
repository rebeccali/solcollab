import { defineConfig } from 'vite';
// The Worker runs in local workerd via `wrangler dev` (server/package.json).
const target = `http://127.0.0.1:${process.env.SOLCOLLAB_API_PORT ?? 8787}`;

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': target, '/img': target, '^/($|\\?)': target },
  },
});
