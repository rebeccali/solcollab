import type { ShatterPattern } from './types';
import { orderText } from './orders';
export function caption(
  pattern: ShatterPattern,
  count: number,
  order: keyof typeof orderText = 'row-major',
  number?: number,
) {
  return `Wall Drawing ${number ? `#${number}` : '#—'}. ${pattern.instruction.replace('{n}', String(count))}, ${orderText[order]}.`;
}
