import { afterEach, describe, expect, it, vi } from 'vitest';
import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { monotonicFactory } from 'ulid';
import { Database, type PromptRow } from './db/index.js';
import { parsePromptSources } from './prompts.js';
import { createApp } from './app.js';
import { galleryPage } from './gallery.js';
import { LocalDiskStore, type Store } from './store.js';
import {
  MAX_BODY_BYTES,
  MAX_IMAGE_BYTES,
  processImage,
  validateStrokes,
  WorkQueue,
} from './upload.js';
import { hashIp } from './privacy.js';
import type { Submission } from '@solcollab/shared';

const files = parsePromptSources([
  { name: 'a.txt', content: 'Draw a line.\nDraw a circle.' },
]);
const drawing = {
  background: '#FFFFFF',
  strokes: [
    {
      color: '#000000',
      alpha: 1,
      size: 12,
      tool: 'pen',
      points: [
        [10, 10, 1, 0],
        [400, 400, 1, 120],
      ],
    },
  ],
};
const databases: Database[] = [];
const makeDb = () => {
  const db = new Database(':memory:');
  databases.push(db);
  db.syncPrompts(files);
  return db;
};
const makeStore = () => {
  const data = new Map<string, Uint8Array>();
  return {
    data,
    put: async (key: string, bytes: Uint8Array) => {
      data.set(key, bytes);
    },
    get: async (key: string) => data.get(key) ?? null,
    delete: async (key: string) => {
      data.delete(key);
    },
  };
};
const image = async (size = 1000) => {
  const bytes = Buffer.alloc(size * size * 3, 255);
  for (let y = 10; y < Math.min(300, size); y++)
    for (let x = 10; x < Math.min(300, size); x++) {
      bytes[(y * size + x) * 3] = 0;
    }
  return sharp(bytes, { raw: { width: size, height: size, channels: 3 } })
    .png()
    .toBuffer();
};
const form = async (
  strokes: Uint8Array = gzipSync(JSON.stringify(drawing)),
) => {
  const body = new FormData();
  body.set('prompt_slug', 'draw-a-line');
  body.set('background', '#FFFFFF');
  body.set(
    'image',
    new Blob([new Uint8Array(await image())], { type: 'image/png' }),
    'drawing.png',
  );
  body.set('strokes', new Blob([new Uint8Array(strokes)]), 'strokes.json.gz');
  body.set('display_name', '<b>Rebecca</b>');
  return body;
};
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe('database and pagination', () => {
  it('migrates, seeds one current wall, and deactivates missing prompts without losing metadata', () => {
    const db = makeDb();
    expect(db.currentWall().title).toBe('Wall 1');
    db.run('UPDATE prompts SET accepting=0 WHERE slug=?', 'draw-a-line');
    db.syncPrompts(
      parsePromptSources([
        {
          name: 'b.txt',
          content: 'Draw a corrected line. {slug: draw-a-line}',
        },
      ]),
    );
    expect(
      db.get<PromptRow>('SELECT * FROM prompts WHERE slug=?', 'draw-a-circle')
        ?.active,
    ).toBe(0);
    expect(
      db.get<PromptRow>('SELECT * FROM prompts WHERE slug=?', 'draw-a-line'),
    ).toMatchObject({
      text: 'Draw a corrected line.',
      source_file: 'b.txt',
      active: 1,
      accepting: 0,
    });
    expect(() =>
      db.run("INSERT INTO walls(title,opened_at) VALUES ('Other',0)"),
    ).toThrow();
  });
  it('rolls back numbering if insertion fails', () => {
    const db = makeDb(),
      id = monotonicFactory()();
    const row = {
      id,
      wall_id: 1,
      prompt_slug: 'draw-a-line',
      shuffle_key: 1,
      background: '#FFFFFF',
      display_name: null,
      input_type: null,
      image_key: id,
      strokes_key: null,
      ip_hash: 'hash',
      device_id: 'device',
      created_at: 1,
    };
    expect(db.insertSubmission(row).number).toBe(1);
    expect(() => db.insertSubmission(row)).toThrow();
    expect(
      db.get<{ count: number }>('SELECT count FROM wall_prompt_counts')?.count,
    ).toBe(1);
  });
  it('visits 500 drawings exactly once in every tested random bucket, including equal shuffle keys and wraparound', () => {
    const db = makeDb(),
      id = monotonicFactory();
    for (let i = 0; i < 500; i++) {
      const key =
        i % 5 === 0
          ? 0
          : i % 5 === 1
            ? 0xffffffff
            : Math.floor(i / 3) * 20000000;
      const uid = id();
      db.insertSubmission({
        id: uid,
        wall_id: 1,
        prompt_slug: 'draw-a-line',
        shuffle_key: key,
        background: '#FFFFFF',
        display_name: null,
        input_type: null,
        image_key: uid,
        strokes_key: null,
        ip_hash: 'hash',
        device_id: 'device',
        created_at: i,
      });
    }
    for (const bucket of [0, 1, 31, 63]) {
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = galleryPage(db, 1, 'draw-a-line', {
          sort: 'random',
          bucket,
          limit: 17,
          storeStrokes: true,
          ...(cursor ? { cursor } : {}),
        });
        seen.push(...page.items.map((p) => p.id));
        cursor = page.next_cursor ?? undefined;
      } while (cursor && seen.length <= 510);
      expect(seen).toHaveLength(500);
      expect(new Set(seen).size).toBe(500);
    }
    const newest = galleryPage(db, 1, 'draw-a-line', {
      sort: 'new',
      bucket: 0,
      limit: 30,
      storeStrokes: true,
    });
    const next = galleryPage(db, 1, 'draw-a-line', {
      sort: 'new',
      bucket: 0,
      limit: 30,
      storeStrokes: true,
      cursor: newest.next_cursor!,
    });
    expect(
      new Set([...newest.items, ...next.items].map((p) => p.id)).size,
    ).toBe(60);
  });
  it('rejects malformed cursors and invalid buckets', () => {
    const db = makeDb();
    for (const options of [
      { sort: 'new', cursor: 'bad', bucket: 0 },
      { sort: 'random', cursor: 'r.64.0~BAD.0', bucket: 0 },
      { sort: 'random', bucket: 64 },
      { sort: 'other', bucket: 0 },
    ])
      expect(() =>
        galleryPage(db, 1, 'draw-a-line', {
          ...options,
          limit: 30,
          storeStrokes: true,
        }),
      ).toThrow();
  });
});
describe('uploads', () => {
  it('re-encodes a valid drawing, stores validated replay, preserves literal display text, and serves immutable images', async () => {
    const db = makeDb(),
      store = makeStore(),
      app = createApp({ files, db, store });
    const response = await app.request('/api/submissions', {
      method: 'POST',
      body: await form(),
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    const row: Submission = await response.json();
    expect(row.number).toBe(1);
    expect(row.display_name).toBe('<b>Rebecca</b>');
    const full = await app.request(row.full_url);
    expect(full.headers.get('Cache-Control')).toContain('immutable');
    expect(
      (await sharp(Buffer.from(await full.arrayBuffer())).metadata()).width,
    ).toBe(1000);
    const replay = await app.request(row.strokes_url!);
    expect(
      JSON.parse(
        gunzipSync(Buffer.from(await replay.arrayBuffer())).toString(),
      ),
    ).toEqual(drawing);
    const gallery = await app.request('/api/prompts/draw-a-line/submissions');
    expect((await gallery.json()).items).toHaveLength(1);
    db.run("UPDATE submissions SET status='hidden' WHERE id=?", row.id);
    expect((await app.request(row.full_url)).status).toBe(404);
  });
  it('accepts malformed strokes without a replay, and ignores strokes when disabled', async () => {
    for (const storeStrokes of [true, false]) {
      const db = makeDb(),
        store = makeStore(),
        app = createApp({ files, db, store, storeStrokes });
      const response = await app.request('/api/submissions', {
        method: 'POST',
        body: await form(new Uint8Array([1, 2, 3])),
      });
      expect(response.status).toBe(201);
      expect((await response.json()).strokes_url).toBeNull();
      expect(store.data.size).toBe(2);
    }
  });
  it('rejects magic-byte errors, wrong dimensions, uniform images, invalid backgrounds, and oversized images', async () => {
    const blank = await sharp({
      create: { width: 1000, height: 1000, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
    for (const [bytes, background] of [
      [Buffer.from('bad'), '#FFFFFF'],
      [await image(50), '#FFFFFF'],
      [blank, '#FFFFFF'],
      [await image(), 'red'],
      [Buffer.alloc(MAX_IMAGE_BYTES + 1), '#FFFFFF'],
    ] as const)
      await expect(processImage(bytes, background)).rejects.toThrow();
  });
  it('enforces the multipart limit, closed instructions, and closed submissions', async () => {
    const db = makeDb(),
      app = createApp({ files, db, store: makeStore() });
    expect(
      (
        await app.request('/api/submissions', {
          method: 'POST',
          body: new Uint8Array(MAX_BODY_BYTES + 1),
        })
      ).status,
    ).toBe(413);
    db.run("UPDATE prompts SET accepting=0 WHERE slug='draw-a-line'");
    expect(
      (
        await app.request('/api/submissions', {
          method: 'POST',
          body: await form(),
        })
      ).status,
    ).toBe(409);
    db.run("UPDATE settings SET value='false' WHERE key='submissions_open'");
    expect(
      (
        await app.request('/api/submissions', {
          method: 'POST',
          body: await form(),
        })
      ).status,
    ).toBe(503);
  });
  it('cleans up partial file writes without incrementing counts', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = makeDb(),
      memory = makeStore();
    const store: Store = {
      ...memory,
      put: async (key, data) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        await memory.put(key, data);
        if (key.endsWith('thumb.webp')) throw new Error('disk full');
      },
    };
    const response = await createApp({ files, db, store }).request(
      '/api/submissions',
      { method: 'POST', body: await form() },
    );
    expect(response.status).toBe(500);
    expect(memory.data.size).toBe(0);
    expect(db.all('SELECT * FROM submissions')).toHaveLength(0);
  });
  it('guards decompression, total point count, timestamps, colors, and coordinates', () => {
    expect(
      validateStrokes(gzipSync('x'.repeat(2 * 1024 * 1024 + 1)), '#FFFFFF'),
    ).toBeNull();
    for (const mutated of [
      { ...drawing, background: '#bad' },
      {
        ...drawing,
        strokes: [
          {
            ...drawing.strokes[0],
            points: [
              [0, 0, 1, 100],
              [0, 0, 1, 0],
            ],
          },
        ],
      },
      {
        ...drawing,
        strokes: [{ ...drawing.strokes[0], points: [[1001, 0, 1, 0]] }],
      },
      {
        ...drawing,
        strokes: [
          {
            ...drawing.strokes[0],
            points: Array.from({ length: 5001 }, () => [0, 0, 1, 0]),
          },
        ],
      },
    ])
      expect(
        validateStrokes(gzipSync(JSON.stringify(mutated)), '#FFFFFF'),
      ).toBeNull();
  });
  it('limits simultaneous image tasks and keeps the queue moving after failures', async () => {
    const queue = new WorkQueue(4);
    let active = 0,
      max = 0;
    await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) =>
        queue.run(async () => {
          active++;
          max = Math.max(max, active);
          await new Promise((resolve) => setTimeout(resolve, 2));
          active--;
          if (i === 2) throw new Error('test');
        }),
      ),
    );
    expect(max).toBe(4);
    expect(active).toBe(0);
  });
});
describe('storage and privacy', () => {
  it('writes atomically and rejects path traversal', async () => {
    const path = await mkdtemp(join(tmpdir(), 'solcollab-store-'));
    try {
      const store = new LocalDiskStore(path),
        id = monotonicFactory()(),
        key = `${id}/full.webp`;
      await store.put(key, new Uint8Array([1, 2, 3]));
      expect(await store.get(key)).toEqual(new Uint8Array([1, 2, 3]));
      expect(await readdir(join(path, id))).toEqual(['full.webp']);
      await expect(store.get('../secret')).rejects.toThrow();
      await store.delete(key);
      expect(await store.get(key)).toBeNull();
    } finally {
      await rm(path, { recursive: true, force: true });
    }
  });
  it('rotates hashes daily and never returns the raw address', () => {
    const secret = new Uint8Array(32).fill(3),
      day = Date.UTC(2026, 9, 17);
    expect(hashIp('127.0.0.1', secret, day)).toBe(
      hashIp('127.0.0.1', secret, day + 1000),
    );
    expect(hashIp('127.0.0.1', secret, day)).not.toBe(
      hashIp('127.0.0.1', secret, day + 86400000),
    );
    expect(hashIp('127.0.0.1', secret, day)).toHaveLength(64);
  });
});
