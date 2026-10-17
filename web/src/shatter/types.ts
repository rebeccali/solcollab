import type { Piece } from '@solcollab/shared';
export type { Piece } from '@solcollab/shared';
export interface ShatterPattern {
  name: string;
  instruction: string;
  generate(rng: () => number, options: { density: number }): Piece[];
}
export type OrderFn = (
  pieces: Piece[],
  rng: () => number,
  ink?: number[],
) => number[];
export type Point = [number, number];
