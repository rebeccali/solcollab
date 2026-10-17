import { join } from 'node:path';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import type { ApiErrorResponse, RandomPromptResponse } from '@solcollab/shared';
import {
  parseExclude,
  selectRandomPrompt,
  type PromptFile,
} from './prompts.js';

interface AppOptions {
  files: PromptFile[];
  webDirectory?: string;
  rng?: () => number;
}

export function createApp({
  files,
  webDirectory,
  rng = Math.random,
}: AppOptions) {
  const app = new Hono();
  app.get('/api/prompt/random', (c) => {
    c.header('Cache-Control', 'no-store');
    const prompt = selectRandomPrompt(
      files,
      parseExclude(c.req.query('exclude')),
      rng,
    );
    return c.json<RandomPromptResponse>({
      slug: prompt.slug,
      text: prompt.text,
    });
  });
  // Unknown API and image URLs must never fall through to the HTML shell.
  app.all('/api/*', (c) =>
    c.json<ApiErrorResponse>({ error: 'Not found.' }, 404),
  );
  app.all('/img/*', (c) =>
    c.json<ApiErrorResponse>({ error: 'Not found.' }, 404),
  );

  if (webDirectory) {
    app.get('*', serveStatic({ root: webDirectory }));
    app.get('/', serveStatic({ path: join(webDirectory, 'index.html') }));
  }
  app.onError((error, c) => {
    console.error(error);
    return c.json<ApiErrorResponse>(
      { error: 'The instructions are unavailable.' },
      500,
    );
  });
  return app;
}
