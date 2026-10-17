import type { OrderFn, Piece } from './types';
import { contains } from './geometry';
function ranked(indices: number[]) {
  const ranks: number[] = [];
  indices.forEach((index, rank) => {
    ranks[index] = rank;
  });
  return ranks;
}
export const rowMajor: OrderFn = (pieces) =>
  ranked(
    pieces
      .map((_, i) => i)
      .sort(
        (a, b) =>
          Math.round(pieces[a]!.centroid[1] * 1e6) -
            Math.round(pieces[b]!.centroid[1] * 1e6) ||
          pieces[a]!.centroid[0] - pieces[b]!.centroid[0],
      ),
  );
export const randomOrder: OrderFn = (pieces, rng) => {
  const indices = pieces.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j]!, indices[i]!];
  }
  return ranked(indices);
};
export const byInk: OrderFn = (pieces, rng, ink = []) => {
  void rng;
  return ranked(
    pieces
      .map((_, i) => i)
      .sort((a, b) => (ink[b] ?? 0) - (ink[a] ?? 0) || a - b),
  );
};
export const orders = {
  'row-major': rowMajor,
  random: randomOrder,
  'by-ink': byInk,
};
export const orderText = {
  'row-major': 'left to right, top to bottom',
  random: 'in no particular order',
  'by-ink': 'the heaviest pieces first',
};
export function inkStats(canvas: HTMLCanvasElement, pieces: Piece[]) {
  const sample = document.createElement('canvas');
  sample.width = sample.height = 100;
  const ctx = sample.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0, 100, 100);
  const data = ctx.getImageData(0, 0, 100, 100).data;
  return pieces.map((piece) => {
    let alpha = 0,
      count = 0;
    for (let y = 0; y < 100; y++)
      for (let x = 0; x < 100; x++)
        if (contains(piece.points, (x + 0.5) / 100, (y + 0.5) / 100)) {
          alpha += data[(y * 100 + x) * 4 + 3]! / 255;
          count++;
        }
    return count ? alpha / count : 0;
  });
}
