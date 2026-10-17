import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('typed configuration', () => {
  const directories: string[] = [];
  const makeRoot = () => {
    const root = mkdtempSync(join(tmpdir(), 'solcollab-config-'));
    directories.push(root);
    return root;
  };
  afterEach(() => {
    for (const root of directories.splice(0))
      rmSync(root, { recursive: true, force: true });
  });

  it('supplies local defaults without requiring an .env file', () => {
    const root = makeRoot();
    expect(loadConfig({}, root)).toEqual({
      port: 8787,
      dataDir: join(root, 'data'),
      publicDomain: '{{DOMAIN}}',
      storeStrokes: true,
      turnstileSiteKey: '',
      turnstileSecretKey: '',
    });
  });

  it('reads .env, lets the process environment win, and resolves data from the repo root', () => {
    const root = makeRoot();
    writeFileSync(
      join(root, '.env'),
      'PORT=9999\nDATA_DIR=./archive\nSTORE_STROKES=false\nPUBLIC_DOMAIN=example.test\nTURNSTILE_SECRET_KEY=test-only\n',
    );
    expect(loadConfig({ PORT: '8888' }, root)).toEqual({
      port: 8888,
      dataDir: join(root, 'archive'),
      publicDomain: 'example.test',
      storeStrokes: false,
      turnstileSiteKey: '',
      turnstileSecretKey: 'test-only',
    });
  });

  it.each(['0', '-1', '65536', '8787junk', '1.5', '', 'Infinity'])(
    'rejects invalid PORT=%s',
    (port) => {
      expect(() => loadConfig({ PORT: port }, makeRoot())).toThrow('PORT');
    },
  );

  it.each(['0', '1', 'yes', 'FALSE', ''])(
    'rejects ambiguous STORE_STROKES=%s',
    (value) => {
      expect(() => loadConfig({ STORE_STROKES: value }, makeRoot())).toThrow(
        'STORE_STROKES',
      );
    },
  );

  it('rejects empty paths and domains', () => {
    expect(() => loadConfig({ DATA_DIR: '' }, makeRoot())).toThrow('DATA_DIR');
    expect(() => loadConfig({ PUBLIC_DOMAIN: ' ' }, makeRoot())).toThrow(
      'PUBLIC_DOMAIN',
    );
  });
});
