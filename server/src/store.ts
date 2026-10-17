import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface Store {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

export class LocalDiskStore implements Store {
  constructor(private readonly root: string) {}
  private path(key: string) {
    if (
      !/^[0-9A-HJKMNP-TV-Z]{26}\/(full\.webp|thumb\.webp|strokes\.json\.gz)$/.test(
        key,
      )
    )
      throw new Error('Invalid storage key.');
    return join(this.root, key);
  }
  async put(key: string, data: Uint8Array) {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, data, { flag: 'wx' });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  async get(key: string) {
    try {
      return new Uint8Array(await readFile(this.path(key)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
}
