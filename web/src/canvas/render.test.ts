import { describe, expect, it } from 'vitest';
import { floodMask } from './render';

describe('flood fill', () => {
  it('fills the region inside an outline without leaking past it', () => {
    const size = 9;
    const data = new Uint8ClampedArray(size * size * 4);
    // A closed square outline from (2,2) to (6,6).
    for (let i = 2; i <= 6; i++)
      for (const [x, y] of [
        [i, 2],
        [i, 6],
        [2, i],
        [6, i],
      ])
        data[(y! * size + x!) * 4 + 3] = 255;
    const inside = floodMask(data, size, size, 4, 4);
    expect(inside.reduce((a, b) => a + b, 0)).toBe(9);
    const outside = floodMask(data, size, size, 0, 0);
    expect(outside[4 * size + 4]).toBe(0);
    expect(outside.reduce((a, b) => a + b, 0)).toBe(81 - 25);
  });
});
