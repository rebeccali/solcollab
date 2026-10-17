import { describe, expect, it } from 'vitest';
import type { Stroke } from '@solcollab/shared';
import { schedule, visibleStrokes } from './schedule';
const stroke = (duration: number): Stroke => ({
  color: '#000000',
  alpha: 1,
  size: 12,
  tool: 'pen',
  points: [
    [0, 0, 1, 0],
    [500, 500, 1, duration],
  ],
});
describe('five second replay', () => {
  it.each([
    [stroke(2000)],
    [stroke(0)],
    Array.from({ length: 1000 }, (_, index) => stroke(index % 9 ? 1 : 3000)),
  ])('ends at exactly five seconds without overlapping strokes', (...args) => {
    const strokes = args as Stroke[];
    const timing = schedule(strokes);
    expect(timing.at(-1)!.start + timing.at(-1)!.duration).toBeCloseTo(5000, 8);
    for (let i = 1; i < timing.length; i++)
      expect(timing[i]!.start).toBeGreaterThanOrEqual(
        timing[i - 1]!.start + timing[i - 1]!.duration - 1e-8,
      );
  });
  it('reveals points in their original within-stroke order and ends with the original drawing', () => {
    const strokes = [stroke(100), { ...stroke(200), tool: 'eraser' as const }];
    const timing = schedule(strokes);
    expect(visibleStrokes(strokes, timing, -1)).toEqual([]);
    expect(visibleStrokes(strokes, timing, 50)[0]?.points).toHaveLength(1);
    expect(visibleStrokes(strokes, timing, 5000)).toEqual(strokes);
  });
  it('handles an empty drawing', () => {
    expect(schedule([])).toEqual([]);
  });
});
