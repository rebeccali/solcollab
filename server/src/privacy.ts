const encoder = new TextEncoder();
async function hmac(key: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(
    await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message)),
  );
}
/** The salt rotates daily (HMAC of the date), so raw addresses are never stored and no salt needs storage. */
export async function hashIp(
  ip: string,
  secret: Uint8Array,
  now = Date.now(),
): Promise<string> {
  const day = new Date(now).toISOString().slice(0, 10);
  const salt = await hmac(secret, day);
  return [...(await hmac(salt, ip))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
