import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadIpSecret(directory: string): Buffer {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, 'ip-secret');
  try {
    return readFileSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const secret = randomBytes(32);
    writeFileSync(path, secret, { mode: 0o600, flag: 'wx' });
    return secret;
  }
}
export function hashIp(
  ip: string,
  secret: Uint8Array,
  now = Date.now(),
): string {
  const day = new Date(now).toISOString().slice(0, 10);
  const salt = createHmac('sha256', secret).update(day).digest();
  return createHmac('sha256', salt).update(ip).digest('hex');
}
