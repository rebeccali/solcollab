import type { R2Bucket } from './env.js';

export interface Store {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

const KEY =
  /^[0-9A-HJKMNP-TV-Z]{26}\/(full\.webp|thumb\.webp|strokes\.json\.gz)$/;
export function checkKey(key: string): string {
  if (!KEY.test(key)) throw new Error('Invalid storage key.');
  return key;
}

/** Keys are per-ULID and never reused, so a put cannot clobber another drawing. */
export class R2Store implements Store {
  constructor(private readonly bucket: R2Bucket) {}
  async put(key: string, data: Uint8Array) {
    await this.bucket.put(checkKey(key), data, {
      httpMetadata: {
        contentType: key.endsWith('.gz') ? 'application/json' : 'image/webp',
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
  }
  async get(key: string) {
    const object = await this.bucket.get(checkKey(key));
    return object ? new Uint8Array(await object.arrayBuffer()) : null;
  }
  async delete(key: string) {
    await this.bucket.delete(checkKey(key));
  }
}
