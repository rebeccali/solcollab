import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { bodyLimit } from 'hono/body-limit';
import { getCookie, setCookie } from 'hono/cookie';
import { serveStatic } from '@hono/node-server/serve-static';
import type { HttpBindings } from '@hono/node-server';
import { monotonicFactory } from 'ulid';
import type {
  ApiErrorResponse,
  PromptDetail,
  PublicConfig,
  Wall,
} from '@solcollab/shared';
import {
  parseExclude,
  selectRandomPrompt,
  type PromptFile,
} from './prompts.js';
import {
  Database,
  type PromptRow,
  type SubmissionRow,
  type WallRow,
} from './db/index.js';
import type { Store } from './store.js';
import {
  MAX_BODY_BYTES,
  processImage,
  UploadError,
  validateStrokes,
  WorkQueue,
} from './upload.js';
import { galleryPage, positiveInteger, publicSubmission } from './gallery.js';
import { hashIp } from './privacy.js';

interface AppOptions {
  files: PromptFile[];
  webDirectory?: string;
  rng?: () => number;
  db?: Database;
  store?: Store;
  storeStrokes?: boolean;
  ipSecret?: Uint8Array;
}
const nextId = monotonicFactory();

export function createApp(options: AppOptions) {
  const {
    files,
    webDirectory,
    rng = Math.random,
    store,
    storeStrokes = true,
    ipSecret = randomBytes(32),
  } = options;
  const db = options.db ?? new Database(':memory:');
  if (!options.db) db.syncPrompts(files);
  const queue = new WorkQueue(4);
  const app = new Hono<{ Bindings: HttpBindings }>();
  const findWall = (value?: string) => {
    const id = positiveInteger(value, db.currentWall().id);
    const wall = db.get<WallRow>('SELECT * FROM walls WHERE id=?', id);
    if (!wall) throw new HTTPException(404, { message: 'Wall not found.' });
    return wall;
  };
  const findPrompt = (slug: string) => {
    const prompt = db.get<PromptRow>(
      'SELECT * FROM prompts WHERE slug=?',
      slug,
    );
    if (!prompt)
      throw new HTTPException(404, { message: 'Instruction not found.' });
    return prompt;
  };
  const count = (wall: number, slug?: string) =>
    db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM submissions WHERE wall_id=? AND status='visible' ${slug ? 'AND prompt_slug=?' : ''}`,
      wall,
      ...(slug ? [slug] : []),
    )!.count;
  const thumbs = (wall: number, slug?: string) =>
    db
      .all<{ image_key: string }>(
        `SELECT image_key FROM submissions WHERE wall_id=? AND status='visible' ${slug ? 'AND prompt_slug=?' : ''} ORDER BY id DESC LIMIT 4`,
        wall,
        ...(slug ? [slug] : []),
      )
      .map((row) => `/img/${row.image_key}/thumb.webp`);
  const eligible = () =>
    files.map((file) => ({
      ...file,
      prompts: file.prompts.filter((p) =>
        db.get(
          'SELECT slug FROM prompts WHERE slug=? AND active=1 AND accepting=1',
          p.slug,
        ),
      ),
    }));

  app.get('/', (c) => {
    c.header('Cache-Control', 'no-store');
    const prompt = selectRandomPrompt(
      eligible(),
      parseExclude(c.req.query('exclude')),
      rng,
    );
    return c.redirect(`/draw/${prompt.slug}`, 302);
  });
  app.get('/healthz', (c) => c.json({ ok: true }));
  app.get('/api/config', (c) => {
    c.header('Cache-Control', 'public, s-maxage=30');
    return c.json<PublicConfig>({
      store_strokes: storeStrokes,
      submissions_open:
        db.setting('submissions_open') !== 'false' &&
        db.setting('read_only') !== 'true',
      current_wall: db.currentWall(),
      banner_message: db.setting('banner_message'),
    });
  });
  app.get('/api/prompt/random', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(
      selectRandomPrompt(eligible(), parseExclude(c.req.query('exclude')), rng),
    );
  });
  app.get('/api/walls', (c) => {
    c.header('Cache-Control', 'public, s-maxage=300');
    return c.json({
      items: db
        .all<WallRow>('SELECT * FROM walls ORDER BY id DESC')
        .map((wall): Wall => ({
          ...wall,
          count: count(wall.id),
          thumbs: thumbs(wall.id),
        })),
      next_cursor: null,
    });
  });
  app.get('/api/prompts', (c) => {
    const wall = findWall(c.req.query('wall')),
      limit = positiveInteger(c.req.query('limit'), 24, 60),
      sort = c.req.query('sort') ?? 'active';
    if (!['active', 'new'].includes(sort))
      throw new HTTPException(400, { message: 'Invalid prompt order.' });
    const column = sort === 'active' ? 'count' : 'created_at';
    let after: [number, string] | undefined;
    if (c.req.query('cursor')) {
      try {
        const parsed: unknown = JSON.parse(
          Buffer.from(c.req.query('cursor')!, 'base64url').toString(),
        );
        if (
          !Array.isArray(parsed) ||
          parsed.length !== 2 ||
          typeof parsed[0] !== 'number' ||
          !Number.isFinite(parsed[0]) ||
          typeof parsed[1] !== 'string' ||
          parsed[1].length > 200
        )
          throw new Error();
        after = parsed as [number, string];
      } catch {
        throw new HTTPException(400, { message: 'Invalid prompt cursor.' });
      }
    }
    const rows = db.all<PromptRow & { count: number }>(
      `SELECT * FROM (SELECT p.*, (SELECT COUNT(*) FROM submissions s WHERE s.wall_id=? AND s.prompt_slug=p.slug AND s.status='visible') AS count FROM prompts p) q WHERE (active=1 OR count>0) ${after ? `AND (${column} < ? OR (${column} = ? AND slug > ?))` : ''} ORDER BY ${column} DESC,slug ASC LIMIT ?`,
      wall.id,
      ...(after ? [after[0], after[0], after[1]] : []),
      limit + 1,
    );
    const items = rows.slice(0, limit),
      last = items.at(-1);
    c.header(
      'Cache-Control',
      `public, s-maxage=${wall.closed_at ? 86400 : 60}`,
    );
    return c.json({
      items: items.map((p): PromptDetail => ({
        slug: p.slug,
        text: p.text,
        active: !!p.active,
        accepting: !!p.accepting && !wall.closed_at,
        count: p.count,
        wall: wall.id,
        thumbs: thumbs(wall.id, p.slug),
      })),
      next_cursor:
        rows.length > limit && last
          ? Buffer.from(JSON.stringify([last[column], last.slug])).toString(
              'base64url',
            )
          : null,
    });
  });
  app.get('/api/prompts/:slug', (c) => {
    const p = findPrompt(c.req.param('slug')),
      wall = findWall(c.req.query('wall'));
    c.header('Cache-Control', 'public, s-maxage=60');
    return c.json<PromptDetail>({
      slug: p.slug,
      text: p.text,
      active: !!p.active,
      accepting: !!p.accepting && !wall.closed_at,
      count: count(wall.id, p.slug),
      wall: wall.id,
      thumbs: thumbs(wall.id, p.slug),
    });
  });
  app.get('/api/prompts/:slug/submissions', (c) => {
    const slug = c.req.param('slug');
    findPrompt(slug);
    const wall = findWall(c.req.query('wall')),
      sort = c.req.query('sort') ?? 'new',
      bucketValue = c.req.query('bucket') ?? '0';
    if (!/^\d+$/.test(bucketValue))
      throw new HTTPException(400, { message: 'Invalid bucket.' });
    const cursor = c.req.query('cursor');
    const page = galleryPage(db, wall.id, slug, {
      sort,
      ...(cursor ? { cursor } : {}),
      limit: positiveInteger(c.req.query('limit'), 30, 60),
      bucket: +bucketValue,
      storeStrokes,
    });
    c.header(
      'Cache-Control',
      `public, s-maxage=${wall.closed_at ? 86400 : sort === 'random' ? 60 : 10}, stale-while-revalidate=60`,
    );
    return c.json(page);
  });
  app.get('/api/submissions/:id', (c) => {
    const row = db.get<SubmissionRow>(
      "SELECT * FROM submissions WHERE id=? AND status='visible'",
      c.req.param('id'),
    );
    if (!row) throw new HTTPException(404, { message: 'Drawing not found.' });
    c.header('Cache-Control', 'public, s-maxage=300');
    return c.json(publicSubmission(row, storeStrokes));
  });
  app.post(
    '/api/submissions',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json({ error: 'The upload is too large.' }, 413),
    }),
    async (c) => {
      c.header('Cache-Control', 'no-store');
      if (!store)
        throw new HTTPException(503, { message: 'Storage is unavailable.' });
      if (
        db.setting('submissions_open') === 'false' ||
        db.setting('read_only') === 'true'
      )
        throw new HTTPException(503, {
          message:
            'The wall is closed for now. Your drawing is saved in this browser.',
        });
      const body = await c.req.parseBody().catch(() => {
        throw new HTTPException(400, {
          message: 'The upload form could not be read.',
        });
      });
      const slug = typeof body.prompt_slug === 'string' ? body.prompt_slug : '';
      const prompt = findPrompt(slug);
      if (!prompt.active || !prompt.accepting)
        throw new HTTPException(409, {
          message: 'This instruction is closed for new drawings.',
        });
      if (!(body.image instanceof File))
        throw new HTTPException(400, { message: 'Attach a PNG drawing.' });
      if (body.image.size > 1.5 * 1024 * 1024)
        throw new HTTPException(413, {
          message: 'The PNG must be at most 1.5 MB.',
        });
      const background =
        typeof body.background === 'string' ? body.background : '#FFFFFF';
      const bytes = new Uint8Array(await body.image.arrayBuffer());
      const rendered = await queue.run(() => processImage(bytes, background));
      const strokes =
        storeStrokes && body.strokes instanceof File
          ? validateStrokes(
              new Uint8Array(await body.strokes.arrayBuffer()),
              background,
            )
          : null;
      let device = getCookie(c, 'device_id');
      if (!device || !/^[0-9a-f-]{36}$/.test(device)) {
        device = randomUUID();
        setCookie(c, 'device_id', device, {
          httpOnly: true,
          sameSite: 'Lax',
          secure: new URL(c.req.url).protocol === 'https:',
          maxAge: 31536000,
          path: '/',
        });
      }
      const name =
        typeof body.display_name === 'string'
          ? [
              ...body.display_name
                .normalize('NFKC')
                .replace(
                  // Strip non-printing controls before an optional signature is stored.
                  // eslint-disable-next-line no-control-regex
                  /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g,
                  '',
                )
                .trim(),
            ]
              .slice(0, 32)
              .join('')
          : null;
      const id = nextId();
      const writes: [string, Uint8Array][] = [
        [`${id}/full.webp`, rendered.full],
        [`${id}/thumb.webp`, rendered.thumb],
      ];
      if (strokes) writes.push([`${id}/strokes.json.gz`, strokes]);
      try {
        const results = await Promise.allSettled(
          writes.map(([key, data]) => store.put(key, data)),
        );
        const failure = results.find((result) => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
        const row = db.insertSubmission({
          id,
          wall_id: db.currentWall().id,
          prompt_slug: slug,
          shuffle_key: randomBytes(4).readUInt32BE(),
          background,
          display_name: name || null,
          input_type: ['pen', 'mouse', 'touch'].includes(
            String(body.input_type),
          )
            ? String(body.input_type)
            : null,
          image_key: id,
          strokes_key: strokes ? `${id}/strokes.json.gz` : null,
          ip_hash: hashIp(
            c.env?.incoming?.socket?.remoteAddress ?? '127.0.0.1',
            ipSecret,
          ),
          device_id: device,
          created_at: Date.now(),
        });
        return c.json(publicSubmission(row, storeStrokes), 201);
      } catch (error) {
        await Promise.allSettled(writes.map(([key]) => store.delete(key)));
        throw error;
      }
    },
  );
  app.get('/img/:id/:file', async (c) => {
    const key = `${c.req.param('id')}/${c.req.param('file')}`;
    if (
      !/^[0-9A-HJKMNP-TV-Z]{26}\/(full\.webp|thumb\.webp|strokes\.json\.gz)$/.test(
        key,
      ) ||
      !store
    )
      throw new HTTPException(404);
    const row = db.get<SubmissionRow>(
      "SELECT * FROM submissions WHERE id=? AND status='visible'",
      c.req.param('id'),
    );
    if (!row || (key.endsWith('.gz') && !storeStrokes))
      throw new HTTPException(404);
    const data = await store.get(key);
    if (!data) throw new HTTPException(404);
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header(
      'Content-Type',
      key.endsWith('.gz') ? 'application/json' : 'image/webp',
    );
    if (key.endsWith('.gz')) c.header('Content-Encoding', 'gzip');
    return c.body(new Uint8Array(data));
  });
  app.all('/api/*', (c) =>
    c.json<ApiErrorResponse>({ error: 'Not found.' }, 404),
  );
  app.all('/img/*', (c) =>
    c.json<ApiErrorResponse>({ error: 'Not found.' }, 404),
  );
  if (webDirectory) {
    app.use('/assets/*', async (c, next) => {
      await next();
      if (c.res.status === 200)
        c.header('Cache-Control', 'public, max-age=31536000, immutable');
    });
    app.get('/assets/*', serveStatic({ root: webDirectory }));
    const escape = (text: string) =>
      text.replace(
        /[&<>"']/g,
        (char) =>
          ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
          })[char]!,
      );
    for (const path of ['/p/:slug', '/w/:wall/p/:slug'])
      app.get(path, async (c) => {
        const slug = c.req.param('slug')!,
          prompt = findPrompt(slug),
          wall = findWall(c.req.param('wall'));
        const rows = galleryPage(db, wall.id, slug, {
          sort: 'new',
          limit: 30,
          bucket: 0,
          storeStrokes,
        }).items;
        const title = `${prompt.text} — ${wall.title} — Solcollab`;
        const content = `<main class="main-content"><a href="/prompts">Explore prompts</a><h1 class="page-title">${escape(prompt.text)}</h1><p>${escape(wall.title)}${wall.closed_at ? ' · This wall is closed.' : ''}</p><div class="gallery-grid">${rows.map((row) => `<figure class="tile"><a href="#${row.id}"><img src="${row.thumb_url}" width="320" height="320" loading="lazy" alt="Drawing ${row.number}"></a><figcaption>#${row.number} · ${escape(row.display_name ?? 'anonymous')}</figcaption></figure>`).join('')}</div></main>`;
        const html = await readFile(join(webDirectory, 'index.html'), 'utf8');
        c.header('Cache-Control', 'no-store');
        return c.html(
          html
            .replace(/<title>.*?<\/title>/, `<title>${escape(title)}</title>`)
            .replace(
              /<div id="app">[\s\S]*?<\/div>/,
              `<div id="app">${content}</div>`,
            ),
        );
      });
    for (const path of [
      '/draw/:slug',
      '/prompts',
      '/walls',
      '/w/:wall',
      '/about',
    ])
      app.get(path, serveStatic({ path: join(webDirectory, 'index.html') }));
  }
  app.onError((error, c) => {
    if (error instanceof HTTPException)
      return c.json({ error: error.message || 'Not found.' }, error.status);
    if (error instanceof UploadError)
      return c.json({ error: error.message }, 400);
    console.error(error);
    return c.json<ApiErrorResponse>(
      { error: 'The wall is temporarily unavailable. Please try again.' },
      500,
    );
  });
  return app;
}
