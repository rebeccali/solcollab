import decodePng from '@jsquash/png/decode.js';
import encodeWebp from '@jsquash/webp/encode.js';
import resize from '@jsquash/resize';
import { z } from 'zod';
import { codecsReady } from './codecs.js';

export const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
export const MAX_STROKE_BYTES = 200 * 1024;
export const MAX_STROKE_JSON_BYTES = 2 * 1024 * 1024;
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const point = z.tuple([
  z.number().min(0).max(1000),
  z.number().min(0).max(1000),
  z.number().min(0).max(1),
  z.number().min(0).max(600000),
]);
const drawingSchema = z.object({
  background: color,
  strokes: z
    .array(
      z.object({
        color,
        alpha: z.number().min(0).max(1),
        size: z.number().min(1).max(80),
        tool: z.enum(['pen', 'eraser']),
        fill: z.literal(true).optional(),
        points: z.array(point).min(1).max(5000),
      }),
    )
    .min(1)
    .max(1000),
});

export class UploadError extends Error {}

async function readAll(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error('Decompressed data is too large.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
/** Bounded gunzip: aborts as soon as the output passes `limit`, so a zip bomb cannot exhaust memory. */
export function gunzip(bytes: Uint8Array, limit: number) {
  return readAll(
    new Blob([new Uint8Array(bytes)])
      .stream()
      .pipeThrough(new DecompressionStream('gzip')),
    limit,
  );
}
export function gzip(bytes: Uint8Array) {
  return readAll(
    new Blob([new Uint8Array(bytes)])
      .stream()
      .pipeThrough(new CompressionStream('gzip')),
    Number.MAX_SAFE_INTEGER,
  );
}

export async function validateStrokes(
  bytes: Uint8Array,
  background: string,
): Promise<Uint8Array | null> {
  try {
    if (bytes.byteLength > MAX_STROKE_BYTES) return null;
    const raw = await gunzip(bytes, MAX_STROKE_JSON_BYTES);
    const data = drawingSchema.parse(JSON.parse(new TextDecoder().decode(raw)));
    if (data.background.toLowerCase() !== background.toLowerCase()) return null;
    let count = 0;
    for (const stroke of data.strokes) {
      let previous = -1;
      for (const p of stroke.points) {
        if (p[3] < previous) return null;
        previous = p[3];
        count++;
      }
    }
    return count <= 5000
      ? await gzip(new TextEncoder().encode(JSON.stringify(data)))
      : null;
  } catch {
    return null;
  }
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Decode → flatten onto the background → blank check → WebP full (q90) and thumb (q80, 320 px). */
export async function processImage(bytes: Uint8Array, background: string) {
  if (!/^#[0-9a-f]{6}$/i.test(background))
    throw new UploadError('Choose a valid background color.');
  if (bytes.byteLength > MAX_IMAGE_BYTES)
    throw new UploadError('The PNG must be at most 1.5 MB.');
  if (!PNG_SIGNATURE.every((byte, i) => bytes[i] === byte))
    throw new UploadError('Upload a PNG drawing.');
  await codecsReady();
  let image: ImageData;
  try {
    image = await decodePng(new Uint8Array(bytes).buffer);
  } catch {
    throw new UploadError(
      'This PNG could not be read. Use a 1000 × 1000 drawing.',
    );
  }
  if (image.width !== 1000 || image.height !== 1000)
    throw new UploadError('The drawing must be a single 1000 × 1000 PNG.');

  // Straight-alpha "over" onto the background, in place, collecting per-channel statistics.
  const [br, bg, bb] = [1, 3, 5].map((i) =>
    parseInt(background.slice(i, i + 2), 16),
  ) as [number, number, number];
  const d = image.data;
  const sum = [0, 0, 0],
    sumSq = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]! / 255;
    d[i] = d[i]! * a + br * (1 - a);
    d[i + 1] = d[i + 1]! * a + bg * (1 - a);
    d[i + 2] = d[i + 2]! * a + bb * (1 - a);
    d[i + 3] = 255;
    for (let c = 0; c < 3; c++) {
      const v = d[i + c]!;
      sum[c]! += v;
      sumSq[c]! += v * v;
    }
  }
  const n = d.length / 4;
  if (
    sum.every(
      (s, c) => Math.sqrt(Math.max(0, sumSq[c]! / n - (s / n) ** 2)) < 0.05,
    )
  )
    throw new UploadError('Add a few marks before hanging your drawing.');

  const full = new Uint8Array(await encodeWebp(image, { quality: 90 }));
  const small = await resize(image, { width: 320, height: 320 });
  const thumb = new Uint8Array(await encodeWebp(small, { quality: 80 }));
  return { full, thumb };
}
