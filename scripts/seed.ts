/** Development fixtures only. These are never a source of artwork for a public wall. */
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { monotonicFactory } from 'ulid';
import { loadConfig, repoRoot } from '../server/src/config.js';
import { Database } from '../server/src/db/index.js';
import { loadPrompts } from '../server/src/prompts.js';
import { LocalDiskStore } from '../server/src/store.js';

const args = process.argv.slice(2);
const option = (key: string) => {
  const index = args.indexOf(key);
  return index >= 0 ? args[index + 1] : undefined;
};
const amount = Number(option('--per-prompt') ?? 50);
if (!Number.isInteger(amount) || amount < 1 || amount > 1000)
  throw new Error('--per-prompt must be 1–1000.');
const config = loadConfig(),
  db = new Database(join(config.dataDir, 'solcollab.db'));
const files = await loadPrompts(join(repoRoot, 'prompts'));
db.syncPrompts(files);
const store = new LocalDiskStore(join(config.dataDir, 'images')),
  id = monotonicFactory();
const only = option('--only');
const prompts = files
  .flatMap((file) => file.prompts)
  .filter((prompt) => !only || prompt.slug === only);
if (!prompts.length) throw new Error('No matching prompt.');
try {
  for (let pass = 0; pass < (args.includes('--archived') ? 2 : 1); pass++) {
    if (pass === 1)
      db.transaction(() => {
        const next = db.currentWall().id + 1;
        db.run(
          'UPDATE walls SET closed_at=? WHERE closed_at IS NULL',
          Date.now(),
        );
        db.run(
          'INSERT INTO walls(title,opened_at) VALUES (?,?)',
          `Wall ${next}`,
          Date.now(),
        );
      });
    const wall = db.currentWall();
    for (const [index, prompt] of prompts.entries()) {
      const pixels = Buffer.alloc(1000 * 1000 * 3, 255);
      // Simple diagnostic raster marks, not generated public artwork.
      for (let y = 80; y < 920; y++)
        for (let width = 0; width < 16; width++) {
          const x = ((y + index * 40) % 850) + 50 + width;
          const offset = (y * 1000 + x) * 3;
          pixels[offset] = 30;
          pixels[offset + 1] = 70;
          pixels[offset + 2] = 150;
        }
      const image = sharp(pixels, {
        raw: { width: 1000, height: 1000, channels: 3 },
      });
      const [full, thumb] = await Promise.all([
        image.clone().webp({ quality: 90 }).toBuffer(),
        image.clone().resize(320, 320).webp({ quality: 80 }).toBuffer(),
      ]);
      for (let i = 0; i < amount; i++) {
        const uid = id();
        await store.put(`${uid}/full.webp`, full);
        await store.put(`${uid}/thumb.webp`, thumb);
        db.insertSubmission({
          id: uid,
          wall_id: wall.id,
          prompt_slug: prompt.slug,
          shuffle_key: randomBytes(4).readUInt32BE(),
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
  db.close();
}
