import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { parsePromptSources } from './prompts.js';

const files = parsePromptSources([
  { name: 'a.txt', content: 'Draw a line.\nDraw a circle.' },
]);

describe('prompt API', () => {
  it('returns only the public prompt fields and prevents caching', async () => {
    const app = createApp({ files, rng: () => 0 });
    const response = await app.request('/api/prompt/random');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      slug: 'draw-a-line',
      text: 'Draw a line.',
    });
  });

  it('applies exclusion hints and can recover when all instructions are excluded', async () => {
    const app = createApp({ files, rng: () => 0 });
    const response = await app.request(
      '/api/prompt/random?exclude=draw-a-line',
    );
    expect(await response.json()).toEqual({
      slug: 'draw-a-circle',
      text: 'Draw a circle.',
    });
    const reset = await app.request(
      '/api/prompt/random?exclude=draw-a-line,draw-a-circle',
    );
    expect(reset.status).toBe(200);
  });

  it('returns a helpful server error rather than leaking internal details', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await createApp({ files: [] }).request(
      '/api/prompt/random',
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'The instructions are unavailable.',
    });
  });

  it('serves a built page but keeps unknown API/image routes and missing assets as 404s', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'solcollab-web-'));
    try {
      await writeFile(join(directory, 'index.html'), '<h1>Solcollab</h1>');
      const app = createApp({ files, webDirectory: directory });
      const page = await app.request('/');
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('Solcollab');
      for (const path of [
        '/api/missing',
        '/img/missing',
        '/assets/missing.js',
      ]) {
        expect((await app.request(path)).status).toBe(404);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
