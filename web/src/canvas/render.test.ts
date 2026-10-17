import { describe, expect, it } from 'vitest';
import { pressureWidth } from './render';
describe('pen pressure', () => {
  it('uses full width for mouse and touch, or when pressure is disabled', () => {
    expect(pressureWidth(0.5, true, 'mouse')).toBe(1);
    expect(pressureWidth(0, true, 'touch')).toBe(1);
    expect(pressureWidth(0.1, false, 'pen')).toBe(1);
  });
  it('maps pen pressure through the fixed curve, including zero at pen-down', () => {
    expect(pressureWidth(0, true, 'pen')).toBe(0.25);
    expect(pressureWidth(1, true, 'pen')).toBe(1);
    expect(pressureWidth(0.5, true, 'pen')).toBeCloseTo(
      0.25 + 0.75 * 0.5 ** 0.6,
    );
  });
});
