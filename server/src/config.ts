import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

// Both src/config.ts and dist/config.js are two levels below the repository root.
export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export interface Config {
  port: number;
  dataDir: string;
  publicDomain: string;
  storeStrokes: boolean;
  turnstileSiteKey: string;
  turnstileSecretKey: string;
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
  root = repoRoot,
): Config {
  let fileValues: Record<string, string> = {};
  try {
    fileValues = parse(readFileSync(resolve(root, '.env')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const env = { ...fileValues, ...environment };
  const rawPort = env.PORT ?? '8787';
  if (!/^\d+$/.test(rawPort) || +rawPort < 1 || +rawPort > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  const storeStrokes = env.STORE_STROKES ?? 'true';
  if (storeStrokes !== 'true' && storeStrokes !== 'false') {
    throw new Error('STORE_STROKES must be true or false.');
  }
  const dataDir = env.DATA_DIR ?? './data';
  const publicDomain = env.PUBLIC_DOMAIN ?? '{{DOMAIN}}';
  if (!dataDir.trim() || !publicDomain.trim()) {
    throw new Error('DATA_DIR and PUBLIC_DOMAIN must not be empty.');
  }
  return {
    port: Number(rawPort),
    dataDir: resolve(root, dataDir),
    publicDomain,
    storeStrokes: storeStrokes === 'true',
    turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? '',
    turnstileSecretKey: env.TURNSTILE_SECRET_KEY ?? '',
  };
}
