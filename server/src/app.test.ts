import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { parsePromptSources } from './prompts.js';
import { createTestEnv, type TestEnv } from './node/testing.js';
import type { Fetcher } from './env.js';

const files = parsePromptSources([
  { name: 'a.txt', content: 'Draw a line.\nDraw a circle.' },
]);
const envs: TestEnv[] = [];
const testEnv = async (assets?: Fetcher) => {
  const env = await createTestEnv({}, assets);
  envs.push(env);
  return env.env;
};
afterEach(async () => {
  for (const env of envs.splice(0)) await env.dispose();
});

describe('prompt API', () => {
  it('returns only the public prompt fields and prevents caching', async () => {
    const app = createApp({ files, rng: () => 0 });
    const response = await app.request(
      '/api/prompt/random',
      {},
      await testEnv(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      slug: 'draw-a-line',
      text: 'Draw a line.',
    });
  });

  it('applies exclusion hints and can recover when all instructions are excluded', async () => {
    const app = createApp({ files, rng: () => 0 }),
      env = await testEnv();
    const response = await app.request(
      '/api/prompt/random?exclude=draw-a-line',
      {},
      env,
    );
    expect(await response.json()).toEqual({
      slug: 'draw-a-circle',
      text: 'Draw a circle.',
    });
    const reset = await app.request(
      '/api/prompt/random?exclude=draw-a-line,draw-a-circle',
      {},
      env,
    );
    expect(reset.status).toBe(200);
  });

  it('returns a helpful server error rather than leaking internal details', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await createApp({ files: [] }).request(
      '/api/prompt/random',
      {},
      await testEnv(),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'The wall is temporarily unavailable. Please try again.',
    });
  });

  it('serves pages from static assets but keeps unknown API/image routes and missing assets as 404s', async () => {
    const assets: Fetcher = {
      fetch: async (input) =>
        new URL(input instanceof Request ? input.url : input).pathname === '/'
          ? new Response(
              '<title>x</title><div id="app"></div><h1>Solcollab</h1>',
            )
          : new Response('Not found', { status: 404 }),
    };
    const app = createApp({ files }),
      env = await testEnv(assets);
    const entry = await app.request('/', {}, env);
    expect(entry.status).toBe(302);
    expect(entry.headers.get('Cache-Control')).toBe('no-store');
    const page = await app.request('/draw/draw-a-line', {}, env);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Solcollab');
    const gallery = await app.request('/p/draw-a-line', {}, env);
    expect(await gallery.text()).toContain('<title>Draw a line. — Wall 1');
    for (const path of ['/api/missing', '/img/missing', '/assets/missing.js'])
      expect((await app.request(path, {}, env)).status).toBe(404);
  });

  it('syncs the bundled catalog into D1 once and re-syncs when it changes', async () => {
    const env = await testEnv();
    await createApp({ files }).request('/api/prompt/random', {}, env);
    const next = parsePromptSources([
      { name: 'a.txt', content: 'Draw a square.' },
    ]);
    const response = await createApp({ files: next, rng: () => 0 }).request(
      '/api/prompt/random',
      {},
      env,
    );
    expect(await response.json()).toEqual({
      slug: 'draw-a-square',
      text: 'Draw a square.',
    });
    const all = await env.DB.prepare(
      'SELECT slug, active FROM prompts ORDER BY slug',
    ).all();
    expect(all.results).toEqual([
      { slug: 'draw-a-circle', active: 0 },
      { slug: 'draw-a-line', active: 0 },
      { slug: 'draw-a-square', active: 1 },
    ]);
  });

  it('refuses uploads outside local development until IP_HASH_SECRET is set', async () => {
    const t = await createTestEnv({ ENVIRONMENT: 'staging' });
    envs.push(t);
    const response = await createApp({ files }).request(
      '/api/submissions',
      { method: 'POST', body: new FormData() },
      t.env,
    );
    expect(response.status).toBe(503);
  });
});
