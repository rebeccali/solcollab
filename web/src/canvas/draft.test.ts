import { describe, expect, it } from 'vitest';
import { isDrawing } from './draft';
describe('restoring a draft', () => {
  it('rejects corrupt storage and excessive coordinates instead of crashing the editor', () => {
    for (const value of [
      null,
      {},
      { background: '#FFFFFF', strokes: [{}] },
      {
        background: '#FFFFFF',
        strokes: [
          {
            tool: 'pen',
            color: '#000000',
            alpha: 1,
            size: 12,
            points: [[Infinity, 0, 1, 0]],
          },
        ],
      },
    ])
      expect(isDrawing(value)).toBe(false);
  });
  it('accepts a blank canvas or a completed dot', () => {
    expect(isDrawing({ background: '#FFFFFF', strokes: [] })).toBe(true);
    expect(
      isDrawing({
        background: '#FFFFFF',
        strokes: [
          {
            tool: 'pen',
            color: '#000000',
            alpha: 1,
            size: 12,
            points: [[20, 20, 1, 0]],
          },
        ],
      }),
    ).toBe(true);
  });
});
