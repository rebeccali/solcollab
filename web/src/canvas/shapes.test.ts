import { describe, expect, it } from 'vitest';
import { shapePath, toStrokePoints } from './shapes';

describe('shapes', () => {
  it('samples a line between its endpoints', () => {
    const path = shapePath('line', [
      [100, 100],
      [400, 100],
    ]);
    expect(path[0]).toEqual([100, 100]);
    expect(path.at(-1)).toEqual([400, 100]);
    expect(path.every(([, y]) => y === 100)).toBe(true);
  });
  it('bends an arc through its third point', () => {
    const path = shapePath('arc', [
      [100, 500],
      [900, 500],
      [500, 100],
    ]);
    expect(path[0]![0]).toBeCloseTo(100);
    expect(path.at(-1)![0]).toBeCloseTo(900);
    expect(Math.min(...path.map(([, y]) => y))).toBeCloseTo(100, 0);
    expect(Math.max(...path.map(([, y]) => y))).toBeLessThanOrEqual(500.001);
  });
  it('closes a polygon back to its first vertex', () => {
    const anchors: [number, number][] = [
      [100, 100],
      [300, 100],
      [200, 300],
    ];
    expect(shapePath('polygon', anchors, true).at(-1)).toEqual([100, 100]);
  });
  it('clips circles at the canvas edge into in-bounds strokes', () => {
    const runs = toStrokePoints(
      shapePath('circle', [
        [50, 500],
        [250, 500],
      ]),
    );
    expect(runs.length).toBe(1);
    for (const run of runs)
      for (const [x, y, , t] of run) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(1000);
        expect(t).toBeGreaterThanOrEqual(0);
      }
    const times = runs[0]!.map((p) => p[3]);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});
