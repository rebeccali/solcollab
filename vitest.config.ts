import { readFile } from 'node:fs/promises';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Import *.txt as text, as the Worker bundle does (server/wrangler.jsonc "rules").
  plugins: [
    {
      name: 'text-modules',
      enforce: 'pre',
      async load(id) {
        if (!id.endsWith('.txt')) return null;
        return `export default ${JSON.stringify(await readFile(id, 'utf8'))};`;
      },
    },
  ],
  test: {
    environment: 'node',
    include: ['server/src/**/*.test.ts', 'web/src/**/*.test.ts'],
    restoreMocks: true,
  },
});
