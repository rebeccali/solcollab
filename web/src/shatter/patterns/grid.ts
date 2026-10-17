import type { ShatterPattern, Point } from '../types';
import { centroid } from '../geometry';
export const grid: ShatterPattern = {
  name: 'grid',
  instruction:
    'The drawing is divided into {n} equal squares. Each square is carried to the wall and hung in order',
  generate(rng, { density }) {
    void rng;
    if (!Number.isInteger(density) || density < 1 || density > 30)
      throw new Error('Grid density must be 1–30.');
    return Array.from({ length: density * density }, (_, index) => {
      const x = index % density,
        y = Math.floor(index / density);
      const points: Point[] = [
        [x / density, y / density],
        [(x + 1) / density, y / density],
        [(x + 1) / density, (y + 1) / density],
        [x / density, (y + 1) / density],
      ];
      let path: Path2D | undefined;
      return {
        points,
        centroid: centroid(points),
        get path() {
          if (!path) {
            path = new Path2D();
            path.moveTo(...points[0]!);
            for (const p of points.slice(1)) path.lineTo(...p);
            path.closePath();
          }
          return path;
        },
      };
    });
  },
};
