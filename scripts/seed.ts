/** Development fixtures only. These are never a source of artwork for a public wall. */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import encodeWebp from '@jsquash/webp/encode.js';
import resize from '@jsquash/resize';
import { monotonicFactory } from 'ulid';
import { Database } from '../server/src/db/index.js';
import type { Env } from '../server/src/env.js';
import {
  initCodecsFromDisk,
  loadPrompts,
  repoRoot,
} from '../server/src/node/files.js';
import { R2Store } from '../server/src/store.js';

const args = process.argv.slice(2);
const option = (key: string) => {
  const index = args.indexOf(key);
  return index >= 0 ? args[index + 1] : undefined;
};
const amount = Number(option('--per-prompt') ?? 50);
if (!Number.isInteger(amount) || amount < 1 || amount > 1000)
  throw new Error('--per-prompt must be 1–1000.');

// Writes into the same local D1/R2 state that `npm run dev` (wrangler dev) uses.
// Run `npm run db:migrate:local -w server` first (the seed script does this).
await mkdir(join(repoRoot, 'web/dist'), { recursive: true });
const proxy = await getPlatformProxy<Env>({
  configPath: join(repoRoot, 'server/wrangler.jsonc'),
  persist: { path: join(repoRoot, 'server/.wrangler/state/v3') },
});
await initCodecsFromDisk();
const db = new Database(proxy.env.DB),
  store = new R2Store(proxy.env.MEDIA),
  id = monotonicFactory();
const files = await loadPrompts(join(repoRoot, 'prompts'));
await db.syncPrompts(files);
const only = option('--only');
const prompts = files
  .flatMap((file) => file.prompts)
  .filter((prompt) => !only || prompt.slug === only);
if (!prompts.length) throw new Error('No matching prompt.');
try {
  for (let pass = 0; pass < (args.includes('--archived') ? 2 : 1); pass++) {
    if (pass === 1) {
      const next = (await db.currentWall()).id + 1;
      await db.batch([
        db.statement(
          'UPDATE walls SET closed_at=? WHERE closed_at IS NULL',
          Date.now(),
        ),
        db.statement(
          'INSERT INTO walls(title,opened_at) VALUES (?,?)',
          `Wall ${next}`,
          Date.now(),
        ),
      ]);
    }
    const wall = await db.currentWall();
    for (const [index, prompt] of prompts.entries()) {
      const pixels = new Uint8ClampedArray(1000 * 1000 * 4).fill(255);
      // Simple diagnostic raster marks, not generated public artwork.
      for (let y = 80; y < 920; y++)
        for (let width = 0; width < 16; width++) {
          const x = ((y + index * 40) % 850) + 50 + width;
          const offset = (y * 1000 + x) * 4;
          pixels[offset] = 30;
          pixels[offset + 1] = 70;
          pixels[offset + 2] = 150;
        }
      const image = new ImageData(pixels, 1000, 1000);
      const full = new Uint8Array(await encodeWebp(image, { quality: 90 }));
      const thumb = new Uint8Array(
        await encodeWebp(await resize(image, { width: 320, height: 320 }), {
          quality: 80,
        }),
      );
      for (let i = 0; i < amount; i++) {
        const uid = id();
        await store.put(`${uid}/full.webp`, full);
        await store.put(`${uid}/thumb.webp`, thumb);
        await db.insertSubmission({
          id: uid,
          wall_id: wall.id,
          prompt_slug: prompt.slug,
          shuffle_key: crypto.getRandomValues(new Uint32Array(1))[0]!,
          background: '#FFFFFF',
          display_name: 'Development fixture',
          input_type: 'mouse',
          image_key: uid,
          strokes_key: null,
          ip_hash: 'fixture',
          device_id: 'fixture',
          created_at: Date.now(),
        });
      }
    }
    console.log(
      `${wall.title}: ${prompts.length * amount} diagnostic fixtures added.`,
    );
  }
} finally {
  await proxy.dispose();
}
