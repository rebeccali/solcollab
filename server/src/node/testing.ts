/** Node test helpers: real local D1 and R2 from Wrangler's platform proxy (the workerd simulator behind `wrangler dev`). */
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import encodePng, { init as initPngEncode } from '@jsquash/png/encode.js';
import decodeWebp, { init as initWebpDecode } from '@jsquash/webp/decode.js';
import type { Env, Fetcher } from '../env.js';
import { Database } from '../db/index.js';
import { initCodecsFromDisk, repoRoot } from './files.js';

/** Splits migration files into statements (they end each statement with `;` at a line end). */
async function migrationStatements(): Promise<string[]> {
  const directory = join(repoRoot, 'server/migrations');
  const names = (await readdir(directory))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  const statements: string[] = [];
  for (const name of names) {
    const sql = (await readFile(join(directory, name), 'utf8'))
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    statements.push(
      ...sql
        .split(/;\s*(?:\n|$)/)
        .map((statement) => statement.trim())
        .filter(Boolean),
    );
  }
  return statements;
}

export interface TestEnv {
  env: Env;
  db: Database;
  dispose(): Promise<void>;
}
/** A fresh, migrated, in-memory D1 database and R2 bucket. */
export async function createTestEnv(
  vars: Partial<Env> = {},
  assets?: Fetcher,
): Promise<TestEnv> {
  // Bindings come from server/wrangler.jsonc; persist: false gives a fresh in-memory D1 and R2.
  await mkdir(join(repoRoot, 'web/dist'), { recursive: true });
  const proxy = await getPlatformProxy<Env>({
    configPath: join(repoRoot, 'server/wrangler.jsonc'),
    persist: false,
  });
  const env = {
    DB: proxy.env.DB,
    MEDIA: proxy.env.MEDIA,
    ENVIRONMENT: 'local',
    ...(assets ? { ASSETS: assets } : {}),
    ...vars,
  } as Env;
  const db = new Database(env.DB);
  await db.batch((await migrationStatements()).map((sql) => db.statement(sql)));
  return { env, db, dispose: () => proxy.dispose() };
}

let codecs: Promise<void> | undefined;
/** Upload codecs plus the PNG encoder and WebP decoder tests use to make and inspect images. */
export function initTestCodecs() {
  codecs ??= (async () => {
    await initCodecsFromDisk();
    const wasm = async (path: string) =>
      WebAssembly.compile(
        new Uint8Array(await readFile(join(repoRoot, 'node_modules', path))),
      );
    await initPngEncode(
      await wasm('@jsquash/png/codec/pkg/squoosh_png_bg.wasm'),
    );
    await initWebpDecode(await wasm('@jsquash/webp/codec/dec/webp_dec.wasm'));
  })();
  return codecs;
}

/** An RGBA PNG; `mark` paints a red square so the image is not blank. */
export async function makePng(size = 1000, mark = true): Promise<Uint8Array> {
  await initTestCodecs();
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  if (mark)
    for (let y = 10; y < Math.min(300, size); y++)
      for (let x = 10; x < Math.min(300, size); x++)
        data[(y * size + x) * 4 + 1] = data[(y * size + x) * 4 + 2] = 0;
  return new Uint8Array(await encodePng(new ImageData(data, size, size)));
}

export async function webpSize(bytes: ArrayBuffer) {
  await initTestCodecs();
  const image = await decodeWebp(bytes);
  return { width: image.width, height: image.height };
}
