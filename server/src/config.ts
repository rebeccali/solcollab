import type { Env } from './env.js';

export interface Config {
  environment: 'local' | 'staging' | 'production';
  publicDomain: string;
  storeStrokes: boolean;
  /** null when IP_HASH_SECRET is missing outside local development: uploads are refused. */
  ipSecret: Uint8Array | null;
  turnstileSiteKey: string;
  /** null = no gate. */
  sitePassword: string | null;
  requireSitePassword: boolean;
}

const LOCAL_IP_SECRET = new TextEncoder().encode('local-development-only');

/** Vars come from wrangler.jsonc (per environment) and secrets from `wrangler secret put` / .dev.vars. */
export function parseConfig(env: Partial<Env>): Config {
  const environment = env.ENVIRONMENT ?? 'local';
  if (!['local', 'staging', 'production'].includes(environment))
    throw new Error('ENVIRONMENT must be local, staging, or production.');
  const storeStrokes = env.STORE_STROKES ?? 'true';
  if (storeStrokes !== 'true' && storeStrokes !== 'false')
    throw new Error('STORE_STROKES must be true or false.');
  const publicDomain = env.PUBLIC_DOMAIN ?? '{{DOMAIN}}';
  if (!publicDomain.trim()) throw new Error('PUBLIC_DOMAIN must not be empty.');
  const secret = env.IP_HASH_SECRET?.trim();
  const requireSitePassword = env.REQUIRE_SITE_PASSWORD ?? 'false';
  if (requireSitePassword !== 'true' && requireSitePassword !== 'false')
    throw new Error('REQUIRE_SITE_PASSWORD must be true or false.');
  return {
    environment: environment as Config['environment'],
    publicDomain,
    storeStrokes: storeStrokes === 'true',
    ipSecret: secret
      ? new TextEncoder().encode(secret)
      : environment === 'local'
        ? LOCAL_IP_SECRET
        : null,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? '',
    sitePassword: env.SITE_PASSWORD || null,
    requireSitePassword: requireSitePassword === 'true',
  };
}
