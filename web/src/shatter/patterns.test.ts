import { describe, expect, it } from 'vitest';
import { grid } from './patterns/grid';
import { area, contains, seeded, bezier } from './geometry';
import { rowMajor, randomOrder, byInk } from './orders';
describe('shatter patterns and choreography', () => {
  it.each([1, 6, 10, 20])(
    'partitions the square at density %i without gaps or overlaps',
    (density) => {
      const pieces = grid.generate(seeded(42), { density });
      expect(pieces.reduce((sum, p) => sum + area(p.points), 0)).toBeCloseTo(
        1,
        6,
      );
      for (const piece of pieces)
        for (const p of piece.points) {
          expect(p[0]).toBeGreaterThanOrEqual(0);
          expect(p[0]).toBeLessThanOrEqual(1);
          expect(p[1]).toBeGreaterThanOrEqual(0);
          expect(p[1]).toBeLessThanOrEqual(1);
        }
      // Sample at non-boundary positions to avoid counting shared polygon edges twice.
      const coverage = new Uint8Array(200 * 200);
      for (const piece of pieces) {
        const xs = piece.points.map((p) => p[0]),
          ys = piece.points.map((p) => p[1]);
        for (
          let y = Math.floor(Math.min(...ys) * 200);
          y < Math.min(200, Math.ceil(Math.max(...ys) * 200));
          y++
        )
          for (
            let x = Math.floor(Math.min(...xs) * 200);
            x < Math.min(200, Math.ceil(Math.max(...xs) * 200));
            x++
          )
            if (contains(piece.points, (x + 0.37) / 200, (y + 0.41) / 200))
              coverage[y * 200 + x] = coverage[y * 200 + x]! + 1;
      }
      expect(coverage.every((value) => value === 1)).toBe(true);
      expect(pieces.map((p) => p.points)).toEqual(
        grid.generate(seeded(42), { density }).map((p) => p.points),
      );
    },
  );
  it('produces deterministic permutations and supports ink ordering', () => {
    const pieces = grid.generate(seeded(1), { density: 3 });
    expect(rowMajor(pieces, seeded(2))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const random = randomOrder(pieces, seeded(3));
    expect(new Set(random).size).toBe(9);
    expect(random).toEqual(randomOrder(pieces, seeded(3)));
    expect(byInk(pieces, seeded(4), [0, 0, 0, 0, 0, 0, 0, 0, 1])[8]).toBe(0);
  });
  it('keeps Bézier endpoints exact', () => {
    expect(bezier([0, 0], [2, 9], [4, 0], 0)).toEqual([0, 0]);
    expect(bezier([0, 0], [2, 9], [4, 0], 1)).toEqual([4, 0]);
  });
});
