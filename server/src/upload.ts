import { gunzipSync, gzipSync } from 'node:zlib';
import sharp from 'sharp';
import { z } from 'zod';

export const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
export const MAX_STROKE_BYTES = 200 * 1024;
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
        points: z.array(point).min(1).max(5000),
      }),
    )
    .min(1)
    .max(1000),
});

export class UploadError extends Error {}
export function validateStrokes(
  bytes: Uint8Array,
  background: string,
): Buffer | null {
  try {
    if (bytes.byteLength > MAX_STROKE_BYTES) return null;
    const raw = gunzipSync(bytes, { maxOutputLength: 2 * 1024 * 1024 });
    const data = drawingSchema.parse(JSON.parse(raw.toString('utf8')));
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
    return count <= 5000 ? gzipSync(JSON.stringify(data)) : null;
  } catch {
    return null;
  }
}

export async function processImage(bytes: Uint8Array, background: string) {
  if (!/^#[0-9a-f]{6}$/i.test(background))
    throw new UploadError('Choose a valid background color.');
  if (bytes.byteLength > MAX_IMAGE_BYTES)
    throw new UploadError('The PNG must be at most 1.5 MB.');
  if (
    !Buffer.from(bytes)
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new UploadError('Upload a PNG drawing.');
  try {
    const image = sharp(bytes, {
      limitInputPixels: 1000000,
      failOn: 'warning',
    });
    const meta = await image.metadata();
    if (
      meta.format !== 'png' ||
      meta.width !== 1000 ||
      meta.height !== 1000 ||
      (meta.pages ?? 1) !== 1
    )
      throw new UploadError('The drawing must be a single 1000 × 1000 PNG.');
    const flat = await image
      .flatten({ background })
      .removeAlpha()
      .raw()
      .toBuffer();
    const options = {
      raw: { width: 1000, height: 1000, channels: 3 as const },
    };
    const stats = await sharp(flat, options).stats();
    if (stats.channels.every((channel) => channel.stdev < 0.05))
      throw new UploadError('Add a few marks before hanging your drawing.');
    const [full, thumb] = await Promise.all([
      sharp(flat, options).webp({ quality: 90 }).toBuffer(),
      sharp(flat, options).resize(320, 320).webp({ quality: 80 }).toBuffer(),
    ]);
    return { full, thumb };
  } catch (error) {
    if (error instanceof UploadError) throw error;
    throw new UploadError(
      'This PNG could not be read. Use a 1000 × 1000 drawing.',
    );
  }
}

/** Bound active image work as well as the waiting queue. */
export class WorkQueue {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(private readonly limit = 4) {}
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      if (this.waiting.length >= 32)
        throw new UploadError('The wall is busy. Please try again shortly.');
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else this.active++;
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}
