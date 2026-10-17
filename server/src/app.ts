import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { bodyLimit } from 'hono/body-limit';
import { basicAuth } from 'hono/basic-auth';
import { getCookie, setCookie } from 'hono/cookie';
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
import { R2Store, type Store } from './store.js';
import {
  MAX_BODY_BYTES,
  processImage,
  UploadError,
  validateStrokes,
} from './upload.js';
import {
  galleryPage,
  positiveInteger,
  publicSubmission,
  wallPage,
} from './gallery.js';
import { hashIp } from './privacy.js';
import { parseConfig, type Config } from './config.js';
import type { D1Database, Env } from './env.js';

interface AppOptions {
  files: PromptFile[];
  rng?: () => number;
  /** Override storage (tests). Defaults to R2 via the MEDIA binding. */
  store?: (env: Env) => Store;
}
type AppEnv = {
  Bindings: Env;
  Variables: { db: Database; config: Config; store: Store };
};
const nextId = monotonicFactory();

const encoder = new TextEncoder();
async function catalogHash(files: PromptFile[]) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(JSON.stringify(files)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function createApp(options: AppOptions) {
  const { files, rng = Math.random } = options;
  /**
   * The bundled prompt catalog is synced into D1 the first time an isolate sees a database,
   * and only written when its hash differs from the one stored in settings.
   */
  const synced = new WeakMap<D1Database, Promise<void>>();
  const syncPrompts = (db: Database) => {
    let pending = synced.get(db.d1);
    if (!pending) {
      pending = (async () => {
        const hash = await catalogHash(files);
        if ((await db.setting('prompts_hash')) === hash) return;
        await db.syncPrompts(files);
        await db.run(
          `INSERT INTO settings(key,value) VALUES ('prompts_hash',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
          hash,
        );
      })();
      pending.catch(() => synced.delete(db.d1));
      synced.set(db.d1, pending);
    }
    return pending;
  };

  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('config', parseConfig(c.env));
    return next();
  });
  // Private previews: one shared password for the whole site, including static assets when
  // the environment routes every request through the Worker (staging "run_worker_first": true).
  app.use('*', async (c, next) => {
    const { sitePassword, requireSitePassword } = c.var.config;
    if (c.req.path === '/healthz') return next();
    if (!sitePassword) {
      if (requireSitePassword)
        return c.text('This preview is not open yet.', 503, {
          'Cache-Control': 'no-store',
        });
      return next();
    }
    await basicAuth({
      username: 'solcollab',
      password: sitePassword,
      realm: 'Solcollab preview',
    })(c, next);
    // Nothing behind the password may be cached where someone without it could read it.
    c.res.headers.set('Cache-Control', 'private, no-store');
  });
  app.use('*', async (c, next) => {
    if (c.req.path === '/healthz') return next();
    const db = new Database(c.env.DB);
    c.set('db', db);
    c.set('store', options.store?.(c.env) ?? new R2Store(c.env.MEDIA));
    await syncPrompts(db);
    return next();
  });

  const findWall = async (db: Database, value?: string) => {
    const id = positiveInteger(value, (await db.currentWall()).id);
    const wall = await db.get<WallRow>('SELECT * FROM walls WHERE id=?', id);
    if (!wall) throw new HTTPException(404, { message: 'Wall not found.' });
    return wall;
  };
  const findPrompt = async (db: Database, slug: string) => {
    const prompt = await db.get<PromptRow>(
      'SELECT * FROM prompts WHERE slug=?',
      slug,
    );
    if (!prompt)
      throw new HTTPException(404, { message: 'Instruction not found.' });
    return prompt;
  };
  const count = async (db: Database, wall: number, slug?: string) =>
    (await db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM submissions WHERE wall_id=? AND status='visible' ${slug ? 'AND prompt_slug=?' : ''}`,
      wall,
      ...(slug ? [slug] : []),
    ))!.count;
  const thumbs = async (db: Database, wall: number, slug?: string) =>
    (
      await db.all<{ image_key: string }>(
        `SELECT image_key FROM submissions WHERE wall_id=? AND status='visible' ${slug ? 'AND prompt_slug=?' : ''} ORDER BY id DESC LIMIT 4`,
        wall,
        ...(slug ? [slug] : []),
      )
    ).map((row) => `/img/${row.image_key}/thumb.webp`);
  /** One query for all open prompts, not one per prompt: every D1 call is a round trip. */
  const eligible = async (db: Database) => {
    const open = new Set(
      (
        await db.all<{ slug: string }>(
          'SELECT slug FROM prompts WHERE active=1 AND accepting=1',
        )
      ).map((row) => row.slug),
    );
    return files.map((file) => ({
      ...file,
      prompts: file.prompts.filter((p) => open.has(p.slug)),
    }));
  };

  app.get('/', async (c) => {
    c.header('Cache-Control', 'no-store');
    const prompt = selectRandomPrompt(
      await eligible(c.var.db),
      parseExclude(c.req.query('exclude')),
      rng,
    );
    return c.redirect(`/draw/${prompt.slug}`, 302);
  });
  app.get('/healthz', (c) => c.json({ ok: true }));
  app.get('/api/config', async (c) => {
    const { db, config } = c.var;
    c.header('Cache-Control', 'public, s-maxage=30');
    const [open, readOnly, wall, banner] = await Promise.all([
      db.setting('submissions_open'),
      db.setting('read_only'),
      db.currentWall(),
      db.setting('banner_message'),
    ]);
    return c.json<PublicConfig>({
      store_strokes: config.storeStrokes,
      submissions_open: open !== 'false' && readOnly !== 'true',
      current_wall: wall,
      banner_message: banner,
    });
  });
  app.get('/api/prompt/random', async (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(
      selectRandomPrompt(
        await eligible(c.var.db),
        parseExclude(c.req.query('exclude')),
        rng,
      ),
    );
  });
  app.get('/api/walls', async (c) => {
    const { db } = c.var;
    c.header('Cache-Control', 'public, s-maxage=300');
    const walls = await db.all<WallRow>('SELECT * FROM walls ORDER BY id DESC');
    return c.json({
      items: await Promise.all(
        walls.map(async (wall): Promise<Wall> => ({
          ...wall,
          count: await count(db, wall.id),
          thumbs: await thumbs(db, wall.id),
        })),
      ),
      next_cursor: null,
    });
  });
  app.get('/api/prompts', async (c) => {
    const { db } = c.var;
    const wall = await findWall(db, c.req.query('wall')),
      limit = positiveInteger(c.req.query('limit'), 24, 60),
      sort = c.req.query('sort') ?? 'active';
    if (!['active', 'new'].includes(sort))
      throw new HTTPException(400, { message: 'Invalid prompt order.' });
    const column = sort === 'active' ? 'count' : 'created_at';
    let after: [number, string] | undefined;
    const cursor = c.req.query('cursor');
    if (cursor) {
      try {
        const parsed: unknown = JSON.parse(base64UrlDecode(cursor));
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
    const rows = await db.all<PromptRow & { count: number }>(
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
      items: await Promise.all(
        items.map(async (p): Promise<PromptDetail> => ({
          slug: p.slug,
          text: p.text,
          active: !!p.active,
          accepting: !!p.accepting && !wall.closed_at,
          count: p.count,
          wall: wall.id,
          thumbs: await thumbs(db, wall.id, p.slug),
        })),
      ),
      next_cursor:
        rows.length > limit && last
          ? base64UrlEncode(JSON.stringify([last[column], last.slug]))
          : null,
    });
  });
  app.get('/api/prompts/:slug', async (c) => {
    const { db } = c.var;
    const p = await findPrompt(db, c.req.param('slug')),
      wall = await findWall(db, c.req.query('wall'));
    c.header('Cache-Control', 'public, s-maxage=60');
    return c.json<PromptDetail>({
      slug: p.slug,
      text: p.text,
      active: !!p.active,
      accepting: !!p.accepting && !wall.closed_at,
      count: await count(db, wall.id, p.slug),
      wall: wall.id,
      thumbs: await thumbs(db, wall.id, p.slug),
    });
  });
  app.get('/api/prompts/:slug/submissions', async (c) => {
    const { db, config } = c.var;
    const slug = c.req.param('slug');
    await findPrompt(db, slug);
    const wall = await findWall(db, c.req.query('wall')),
      sort = c.req.query('sort') ?? 'new',
      bucketValue = c.req.query('bucket') ?? '0';
    if (!/^\d+$/.test(bucketValue))
      throw new HTTPException(400, { message: 'Invalid bucket.' });
    const cursor = c.req.query('cursor');
    const page = await galleryPage(db, wall.id, slug, {
      sort,
      ...(cursor ? { cursor } : {}),
      limit: positiveInteger(c.req.query('limit'), 30, 60),
      bucket: +bucketValue,
      storeStrokes: config.storeStrokes,
    });
    c.header(
      'Cache-Control',
      `public, s-maxage=${wall.closed_at ? 86400 : sort === 'random' ? 60 : 10}, stale-while-revalidate=60`,
    );
    return c.json(page);
  });
  app.get('/api/submissions', async (c) => {
    const { db, config } = c.var;
    const wall = await findWall(db, c.req.query('wall')),
      seedValue = c.req.query('seed') ?? '0',
      cursor = c.req.query('cursor');
    if (!/^\d{1,10}$/.test(seedValue))
      throw new HTTPException(400, { message: 'Invalid shuffle seed.' });
    const page = await wallPage(db, wall, {
      seed: +seedValue,
      ...(cursor ? { cursor } : {}),
      limit: positiveInteger(c.req.query('limit'), 48, 96),
      now: Date.now(),
      storeStrokes: config.storeStrokes,
    });
    c.header(
      'Cache-Control',
      `public, s-maxage=${wall.closed_at ? 86400 : 60}, stale-while-revalidate=60`,
    );
    return c.json(page);
  });
  app.get('/api/submissions/:id', async (c) => {
    const row = await c.var.db.get<SubmissionRow>(
      "SELECT * FROM submissions WHERE id=? AND status='visible'",
      c.req.param('id'),
    );
    if (!row) throw new HTTPException(404, { message: 'Drawing not found.' });
    c.header('Cache-Control', 'public, s-maxage=300');
    return c.json(publicSubmission(row, c.var.config.storeStrokes));
  });
  app.post(
    '/api/submissions',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json({ error: 'The upload is too large.' }, 413),
    }),
    async (c) => {
      const { db, config, store } = c.var;
      c.header('Cache-Control', 'no-store');
      if (!config.ipSecret)
        throw new HTTPException(503, {
          message: 'Uploads are not configured yet.',
        });
      const [open, readOnly] = await Promise.all([
        db.setting('submissions_open'),
        db.setting('read_only'),
      ]);
      if (open === 'false' || readOnly === 'true')
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
      const prompt = await findPrompt(db, slug);
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
      const rendered = await processImage(bytes, background);
      const strokes =
        config.storeStrokes && body.strokes instanceof File
          ? await validateStrokes(
              new Uint8Array(await body.strokes.arrayBuffer()),
              background,
            )
          : null;
      let device = getCookie(c, 'device_id');
      if (!device || !/^[0-9a-f-]{36}$/.test(device)) {
        device = crypto.randomUUID();
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
        const row = await db.insertSubmission({
          id,
          wall_id: (await db.currentWall()).id,
          prompt_slug: slug,
          shuffle_key: crypto.getRandomValues(new Uint32Array(1))[0]!,
          background,
          display_name: name || null,
          input_type: ['pen', 'mouse', 'touch'].includes(
            String(body.input_type),
          )
            ? String(body.input_type)
            : null,
          image_key: id,
          strokes_key: strokes ? `${id}/strokes.json.gz` : null,
          // Set by Cloudflare on every request; local dev and tests fall back to loopback.
          ip_hash: await hashIp(
            c.req.header('CF-Connecting-IP') ?? '127.0.0.1',
            config.ipSecret,
          ),
          device_id: device,
          created_at: Date.now(),
        });
        return c.json(publicSubmission(row, config.storeStrokes), 201);
      } catch (error) {
        await Promise.allSettled(writes.map(([key]) => store.delete(key)));
        throw error;
      }
    },
  );
  app.get('/img/:id/:file', async (c) => {
    const { db, config, store } = c.var;
    const key = `${c.req.param('id')}/${c.req.param('file')}`;
    if (
      !/^[0-9A-HJKMNP-TV-Z]{26}\/(full\.webp|thumb\.webp|strokes\.json\.gz)$/.test(
        key,
      )
    )
      throw new HTTPException(404);
    const row = await db.get<SubmissionRow>(
      "SELECT * FROM submissions WHERE id=? AND status='visible'",
      c.req.param('id'),
    );
    if (!row || (key.endsWith('.gz') && !config.storeStrokes))
      throw new HTTPException(404);
    const data = await store.get(key);
    if (!data) throw new HTTPException(404);
    const headers = new Headers({
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Type': key.endsWith('.gz') ? 'application/json' : 'image/webp',
    });
    if (key.endsWith('.gz')) headers.set('Content-Encoding', 'gzip');
    // The stroke file is stored gzipped: "manual" tells Workers not to compress it again.
    return new Response(new Uint8Array(data), {
      headers,
      encodeBody: 'manual',
    } as ResponseInit);
  });
  app.all('/api/*', (c) =>
    c.json<ApiErrorResponse>({ error: 'Not found.' }, 404),
  );
  app.all('/img/*', (c) =>
    c.json<ApiErrorResponse>({ error: 'Not found.' }, 404),
  );

  // Pages. Static files (/assets/*) are served by Workers Static Assets before the Worker
  // runs; only requests that match no file reach these routes.
  const indexHtml = async (c: { env: Env; req: { url: string } }) => {
    if (!c.env.ASSETS) throw new HTTPException(404);
    const response = await c.env.ASSETS.fetch(new URL('/', c.req.url));
    if (!response.ok) throw new HTTPException(404);
    return response.text();
  };
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
  for (const path of [
    '/p/:slug',
    '/w/:wall/p/:slug',
    '/p/:slug/:id',
    '/w/:wall/p/:slug/:id',
  ])
    app.get(path, async (c) => {
      const { db, config } = c.var;
      const html = await indexHtml(c);
      const slug = c.req.param('slug')!,
        prompt = await findPrompt(db, slug),
        wall = await findWall(db, c.req.param('wall'));
      const rows = (
        await galleryPage(db, wall.id, slug, {
          sort: 'new',
          limit: 30,
          bucket: 0,
          storeStrokes: config.storeStrokes,
        })
      ).items;
      const title = `${prompt.text} — ${wall.title} — Solcollab`;
      const content = `<main class="main-content"><a href="/explore-gallery">Explore Gallery</a><h1 class="page-title">${escape(prompt.text)}</h1><p>${escape(wall.title)}${wall.closed_at ? ' · This wall is closed.' : ''}</p><div class="gallery-grid">${rows.map((row) => `<figure class="tile"><a href="#${row.id}"><img src="${row.thumb_url}" width="320" height="320" loading="lazy" alt="Drawing ${row.number}"></a><figcaption>#${row.number} · ${escape(row.display_name ?? 'anonymous')}</figcaption></figure>`).join('')}</div></main>`;
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
    '/explore-gallery',
    '/walls',
    '/w/:wall',
    '/about',
  ])
    app.get(path, async (c) => c.html(await indexHtml(c)));
  // Old links to the explore wall.
  app.get('/prompts', (c) => c.redirect('/explore-gallery', 301));

  // Requests that match no route: a static file when every request runs the Worker first,
  // otherwise a 404 (Workers Static Assets already answered for files that exist).
  app.notFound(async (c) => {
    if (c.env.ASSETS && ['GET', 'HEAD'].includes(c.req.method)) {
      const asset = await c.env.ASSETS.fetch(c.req.raw);
      // Re-wrapped so middleware can still adjust headers (fetched responses are immutable).
      if (asset.status !== 404) return new Response(asset.body, asset);
    }
    return c.text('Not found', 404);
  });
  app.onError((error, c) => {
    // Keeps headers such as WWW-Authenticate from middleware that built its own response.
    if (error instanceof HTTPException && error.res) return error.getResponse();
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

function base64UrlEncode(text: string) {
  return btoa(String.fromCharCode(...encoder.encode(text)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function base64UrlDecode(value: string) {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(
    Uint8Array.from(binary, (char) => char.charCodeAt(0)),
  );
}
