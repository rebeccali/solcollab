// The Solcollab upload pipeline (server/src/upload.ts processImage) rebuilt on jSquash.
// Shared by the Worker (src/index.js) and the Node cross-check (node_bench.mjs).
import decodePng from '@jsquash/png/decode.js';
import encodeWebp from '@jsquash/webp/encode.js';
import resize from '@jsquash/resize';

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export async function processImage(bytes, background = '#ffffff', now = () => performance.now()) {
  const marks = {};
  let t = now();
  const lap = (name) => {
    const n = now();
    marks[name] = n - t;
    t = n;
  };

  const u8 = new Uint8Array(bytes);
  if (!PNG_SIGNATURE.every((b, i) => u8[i] === b)) throw new Error('Not a PNG');
  const image = await decodePng(u8);
  if (image.width !== 1000 || image.height !== 1000) throw new Error('Not 1000x1000');
  lap('decode');

  // Flatten alpha onto the background, in place (straight alpha "over").
  const [br, bg, bb] = [1, 3, 5].map((i) => parseInt(background.slice(i, i + 2), 16));
  const d = image.data;
  const sum = [0, 0, 0], sumSq = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    const r = d[i] * a + br * (1 - a), g = d[i + 1] * a + bg * (1 - a), b = d[i + 2] * a + bb * (1 - a);
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2];
    sumSq[0] += d[i] * d[i]; sumSq[1] += d[i + 1] * d[i + 1]; sumSq[2] += d[i + 2] * d[i + 2];
  }
  const n = d.length / 4;
  const stdev = sum.map((s, c) => Math.sqrt(Math.max(0, sumSq[c] / n - (s / n) ** 2)));
  if (stdev.every((s) => s < 0.05)) throw new Error('Blank drawing');
  lap('flatten+stats');

  const full = await encodeWebp(image, { quality: 90 });
  lap('encodeFull');
  const small = await resize(image, { width: 320, height: 320 });
  lap('resize');
  const thumb = await encodeWebp(small, { quality: 80 });
  lap('encodeThumb');

  return { full: full.byteLength, thumb: thumb.byteLength, stdev, marks };
}
