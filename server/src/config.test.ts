import { describe, expect, it } from 'vitest';
import { parseConfig } from './config.js';

describe('typed configuration', () => {
  it('supplies local defaults, including a development-only IP secret', () => {
    const config = parseConfig({});
    expect(config).toMatchObject({
      environment: 'local',
      publicDomain: '{{DOMAIN}}',
      storeStrokes: true,
      turnstileSiteKey: '',
    });
    expect(config.ipSecret).toBeInstanceOf(Uint8Array);
  });

  it('reads Worker vars and secrets', () => {
    const config = parseConfig({
      ENVIRONMENT: 'production',
      STORE_STROKES: 'false',
      PUBLIC_DOMAIN: 'example.test',
      IP_HASH_SECRET: 'test-only',
      TURNSTILE_SITE_KEY: 'site',
    });
    expect(config).toMatchObject({
      environment: 'production',
      publicDomain: 'example.test',
      storeStrokes: false,
      turnstileSiteKey: 'site',
    });
    expect(new TextDecoder().decode(config.ipSecret!)).toBe('test-only');
  });

  it('refuses to invent an IP secret outside local development', () => {
    for (const ENVIRONMENT of ['staging', 'production'])
      expect(parseConfig({ ENVIRONMENT }).ipSecret).toBeNull();
    expect(
      parseConfig({ ENVIRONMENT: 'staging', IP_HASH_SECRET: '  ' }).ipSecret,
    ).toBeNull();
  });

  it.each(['0', '1', 'yes', 'FALSE', ''])(
    'rejects ambiguous STORE_STROKES=%s',
    (value) => {
      expect(() => parseConfig({ STORE_STROKES: value })).toThrow(
        'STORE_STROKES',
      );
    },
  );

  it('reads the optional site password and whether it is required', () => {
    expect(parseConfig({})).toMatchObject({
      sitePassword: null,
      requireSitePassword: false,
    });
    expect(
      parseConfig({ SITE_PASSWORD: 'pw', REQUIRE_SITE_PASSWORD: 'true' }),
    ).toMatchObject({ sitePassword: 'pw', requireSitePassword: true });
    expect(() => parseConfig({ REQUIRE_SITE_PASSWORD: 'yes' })).toThrow(
      'REQUIRE_SITE_PASSWORD',
    );
  });

  it('rejects unknown environments and empty domains', () => {
    expect(() => parseConfig({ ENVIRONMENT: 'dev' })).toThrow('ENVIRONMENT');
    expect(() => parseConfig({ PUBLIC_DOMAIN: ' ' })).toThrow('PUBLIC_DOMAIN');
  });
});
