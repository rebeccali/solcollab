import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { gzipSync, gunzipSync } from 'node:zlib';
import { monotonicFactory } from 'ulid';
import type { Database, PromptRow } from './db/index.js';
import { parsePromptSources } from './prompts.js';
import { createApp } from './app.js';
import { galleryPage, wallPage } from './gallery.js';
import { R2Store, type Store } from './store.js';
import {
  MAX_BODY_BYTES,
  MAX_IMAGE_BYTES,
  processImage,
  validateStrokes,
} from './upload.js';
import { hashIp } from './privacy.js';
import type { Env } from './env.js';
import type { Submission } from '@solcollab/shared';
import {
  createTestEnv,
  initTestCodecs,
  makePng,
  webpSize,
  type TestEnv,
} from './node/testing.js';

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
const envs: TestEnv[] = [];
const setup = async (vars: Partial<Env> = {}) => {
  const t = await createTestEnv(vars);
  envs.push(t);
  await t.db.syncPrompts(files);
  return t;
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
const form = async (
  strokes: Uint8Array = gzipSync(JSON.stringify(drawing)),
) => {
  const body = new FormData();
  body.set('prompt_slug', 'draw-a-line');
  body.set('background', '#FFFFFF');
  body.set(
    'image',
    new Blob([new Uint8Array(await makePng())], { type: 'image/png' }),
    'drawing.png',
  );
  body.set('strokes', new Blob([new Uint8Array(strokes)]), 'strokes.json.gz');
  body.set('display_name', '<b>Rebecca</b>');
  return body;
};
const submission = (id: string, overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
});
beforeAll(() => initTestCodecs(), 60000);
afterEach(async () => {
  for (const t of envs.splice(0)) await t.dispose();
});

describe('database and pagination', () => {
  it('migrates, seeds one current wall, and deactivates missing prompts without losing metadata', async () => {
    const { db } = await setup();
    expect((await db.currentWall()).title).toBe('Wall 1');
    await db.run('UPDATE prompts SET accepting=0 WHERE slug=?', 'draw-a-line');
    await db.syncPrompts(
      parsePromptSources([
        {
          name: 'b.txt',
          content: 'Draw a corrected line. {slug: draw-a-line}',
        },
      ]),
    );
    expect(
      (
        await db.get<PromptRow>(
          'SELECT * FROM prompts WHERE slug=?',
          'draw-a-circle',
        )
      )?.active,
    ).toBe(0);
    expect(
      await db.get<PromptRow>(
        'SELECT * FROM prompts WHERE slug=?',
        'draw-a-line',
      ),
    ).toMatchObject({
      text: 'Draw a corrected line.',
      source_file: 'b.txt',
      active: 1,
      accepting: 0,
    });
    await expect(
      db.run("INSERT INTO walls(title,opened_at) VALUES ('Other',0)"),
    ).rejects.toThrow();
  });
  it('rolls back numbering if insertion fails (D1 batch is one transaction)', async () => {
    const { db } = await setup(),
      id = monotonicFactory()();
    expect((await db.insertSubmission(submission(id))).number).toBe(1);
    await expect(db.insertSubmission(submission(id))).rejects.toThrow();
    expect(
      (await db.get<{ count: number }>('SELECT count FROM wall_prompt_counts'))
        ?.count,
    ).toBe(1);
  });
  const insertMany = async (
    db: Database,
    count: number,
    row: (i: number, id: string) => Record<string, unknown>,
  ) => {
    const id = monotonicFactory(),
      ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const uid = id();
      ids.push(uid);
      await db.insertSubmission(submission(uid, row(i, uid)));
    }
    return ids;
  };
  it('visits 500 drawings exactly once in every tested random bucket, including equal shuffle keys and wraparound', async () => {
    const { db } = await setup();
    await insertMany(db, 500, (i) => ({
      shuffle_key:
        i % 5 === 0
          ? 0
          : i % 5 === 1
            ? 0xffffffff
            : Math.floor(i / 3) * 20000000,
      created_at: i,
    }));
    for (const bucket of [0, 1, 31, 63]) {
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await galleryPage(db, 1, 'draw-a-line', {
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
    const newest = await galleryPage(db, 1, 'draw-a-line', {
      sort: 'new',
      bucket: 0,
      limit: 30,
      storeStrokes: true,
    });
    const next = await galleryPage(db, 1, 'draw-a-line', {
      sort: 'new',
      bucket: 0,
      limit: 30,
      storeStrokes: true,
      cursor: newest.next_cursor!,
    });
    expect(
      new Set([...newest.items, ...next.items].map((p) => p.id)).size,
    ).toBe(60);
  }, 60000);
  it('pages the whole wall once per seed, across prompts, leaning toward newer drawings', async () => {
    const { db } = await setup();
    const wall = { ...(await db.currentWall()), opened_at: 0, closed_at: 997 };
    let state = 7;
    const created = await insertMany(db, 400, (i) => {
      state = (state * 1103515245 + 12345) >>> 0;
      return {
        prompt_slug: i % 2 ? 'draw-a-line' : 'draw-a-circle',
        shuffle_key: i % 7 === 0 ? 42 : state,
        created_at: Math.floor((i / 400) * 1000),
      };
    });
    for (const seed of [0, 1, 123456789, 0xffffffff]) {
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await wallPage(db, wall, {
          seed,
          limit: 23,
          now: 5000,
          storeStrokes: true,
          ...(cursor ? { cursor } : {}),
        });
        seen.push(...page.items.map((p) => p.id));
        cursor = page.next_cursor ?? undefined;
      } while (cursor && seen.length <= 410);
      expect(new Set(seen).size).toBe(400);
      expect(seen).toHaveLength(400);
      const rank = (uid: string) => seen.indexOf(uid);
      const mean = (ids: string[]) =>
        ids.reduce((sum, uid) => sum + rank(uid), 0) / ids.length;
      expect(mean(created.slice(-100))).toBeLessThan(
        mean(created.slice(0, 100)),
      );
      expect(seen.slice(0, 40)).not.toEqual(created.slice(-40).reverse());
    }
    await expect(
      wallPage(db, wall, {
        seed: 0,
        cursor: '1.2.3~BAD',
        limit: 10,
        now: 0,
        storeStrokes: true,
      }),
    ).rejects.toThrow();
  }, 60000);
  it('rejects malformed cursors and invalid buckets', async () => {
    const { db } = await setup();
    for (const options of [
      { sort: 'new', cursor: 'bad', bucket: 0 },
      { sort: 'random', cursor: 'r.64.0~BAD.0', bucket: 0 },
      { sort: 'random', bucket: 64 },
      { sort: 'other', bucket: 0 },
    ])
      await expect(
        galleryPage(db, 1, 'draw-a-line', {
          ...options,
          limit: 30,
          storeStrokes: true,
        }),
      ).rejects.toThrow();
  });
});
describe('uploads', () => {
  it('re-encodes a valid drawing into R2, stores validated replay, preserves literal display text, and serves immutable images', async () => {
    const { db, env } = await setup(),
      app = createApp({ files });
    const response = await app.request(
      '/api/submissions',
      { method: 'POST', body: await form() },
      env,
    );
    expect(response.status).toBe(201);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    const row: Submission = await response.json();
    expect(row.number).toBe(1);
    expect(row.display_name).toBe('<b>Rebecca</b>');
    const full = await app.request(row.full_url, {}, env);
    expect(full.headers.get('Cache-Control')).toContain('immutable');
    expect(await webpSize(await full.arrayBuffer())).toEqual({
      width: 1000,
      height: 1000,
    });
    const thumb = await app.request(row.thumb_url, {}, env);
    expect((await webpSize(await thumb.arrayBuffer())).width).toBe(320);
    const replay = await app.request(row.strokes_url!, {}, env);
    expect(replay.headers.get('Content-Encoding')).toBe('gzip');
    expect(
      JSON.parse(
        gunzipSync(Buffer.from(await replay.arrayBuffer())).toString(),
      ),
    ).toEqual(drawing);
    const gallery = await app.request(
      '/api/prompts/draw-a-line/submissions',
      {},
      env,
    );
    expect((await gallery.json()).items).toHaveLength(1);
    await db.run("UPDATE submissions SET status='hidden' WHERE id=?", row.id);
    expect((await app.request(row.full_url, {}, env)).status).toBe(404);
  });
  it('accepts malformed strokes without a replay, and ignores strokes when disabled', async () => {
    for (const storeStrokes of [true, false]) {
      const { env } = await setup({ STORE_STROKES: String(storeStrokes) }),
        store = makeStore(),
        app = createApp({ files, store: () => store });
      const response = await app.request(
        '/api/submissions',
        { method: 'POST', body: await form(new Uint8Array([1, 2, 3])) },
        env,
      );
      expect(response.status).toBe(201);
      expect((await response.json()).strokes_url).toBeNull();
      expect(store.data.size).toBe(2);
    }
  });
  it('rejects magic-byte errors, wrong dimensions, uniform images, invalid backgrounds, and oversized images', async () => {
    for (const [bytes, background] of [
      [new TextEncoder().encode('bad'), '#FFFFFF'],
      [await makePng(50), '#FFFFFF'],
      [await makePng(1000, false), '#FFFFFF'],
      [await makePng(), 'red'],
      [new Uint8Array(MAX_IMAGE_BYTES + 1), '#FFFFFF'],
    ] as const)
      await expect(processImage(bytes, background)).rejects.toThrow();
  });
  it('flattens transparency onto the chosen background', async () => {
    const { thumb } = await processImage(await makePng(), '#123456');
    expect(thumb.byteLength).toBeGreaterThan(0);
  });
  it('enforces the multipart limit, closed instructions, and closed submissions', async () => {
    const { db, env } = await setup(),
      store = makeStore(),
      app = createApp({ files, store: () => store });
    expect(
      (
        await app.request(
          '/api/submissions',
          { method: 'POST', body: new Uint8Array(MAX_BODY_BYTES + 1) },
          env,
        )
      ).status,
    ).toBe(413);
    await db.run("UPDATE prompts SET accepting=0 WHERE slug='draw-a-line'");
    expect(
      (
        await app.request(
          '/api/submissions',
          { method: 'POST', body: await form() },
          env,
        )
      ).status,
    ).toBe(409);
    await db.run(
      "UPDATE settings SET value='false' WHERE key='submissions_open'",
    );
    expect(
      (
        await app.request(
          '/api/submissions',
          { method: 'POST', body: await form() },
          env,
        )
      ).status,
    ).toBe(503);
  });
  it('cleans up partial file writes without incrementing counts', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db, env } = await setup(),
      memory = makeStore();
    const store: Store = {
      ...memory,
      put: async (key, data) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        await memory.put(key, data);
        if (key.endsWith('thumb.webp')) throw new Error('disk full');
      },
    };
    const response = await createApp({ files, store: () => store }).request(
      '/api/submissions',
      { method: 'POST', body: await form() },
      env,
    );
    expect(response.status).toBe(500);
    expect(memory.data.size).toBe(0);
    expect(await db.all('SELECT * FROM submissions')).toHaveLength(0);
  });
  it('guards decompression, total point count, timestamps, colors, and coordinates', async () => {
    expect(
      await validateStrokes(
        gzipSync('x'.repeat(2 * 1024 * 1024 + 1)),
        '#FFFFFF',
      ),
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
        await validateStrokes(gzipSync(JSON.stringify(mutated)), '#FFFFFF'),
      ).toBeNull();
  });
});
describe('storage and privacy', () => {
  it('stores in R2 under drawing keys only', async () => {
    const { env } = await setup(),
      store = new R2Store(env.MEDIA),
      key = `${monotonicFactory()()}/full.webp`;
    await store.put(key, new Uint8Array([1, 2, 3]));
    expect(await store.get(key)).toEqual(new Uint8Array([1, 2, 3]));
    await expect(store.get('../secret')).rejects.toThrow();
    await expect(store.put('other/key', new Uint8Array())).rejects.toThrow();
    await store.delete(key);
    expect(await store.get(key)).toBeNull();
  });
  it('rotates hashes daily and never returns the raw address', async () => {
    const secret = new Uint8Array(32).fill(3),
      day = Date.UTC(2026, 9, 17);
    expect(await hashIp('127.0.0.1', secret, day)).toBe(
      await hashIp('127.0.0.1', secret, day + 1000),
    );
    expect(await hashIp('127.0.0.1', secret, day)).not.toBe(
      await hashIp('127.0.0.1', secret, day + 86400000),
    );
    expect(await hashIp('127.0.0.1', secret, day)).toHaveLength(64);
  });
});
