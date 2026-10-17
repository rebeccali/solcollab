import type { Point } from './types';
export const clamp = (value: number) => Math.max(0, Math.min(1, value));
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const ease = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export function bezier(a: Point, m: Point, b: Point, t: number): Point {
  return [
    (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * m[0] + t * t * b[0],
    (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * m[1] + t * t * b[1],
  ];
}
export function area(points: Point[]) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum) / 2;
}
export function centroid(points: Point[]): Point {
  let crossSum = 0,
    x = 0,
    y = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!,
      cross = a[0] * b[1] - b[0] * a[1];
    crossSum += cross;
    x += (a[0] + b[0]) * cross;
    y += (a[1] + b[1]) * cross;
  }
  return crossSum ? [x / (3 * crossSum), y / (3 * crossSum)] : [0, 0];
}
export function contains(points: Point[], x: number, y: number) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!,
      b = points[j]!;
    if (
      a[1] > y !== b[1] > y &&
      x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
export function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
