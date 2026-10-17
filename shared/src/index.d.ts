/** Coordinates and brush size use a 1000 × 1000 logical canvas; time is milliseconds. */
export type StrokePoint = [x: number, y: number, pressure: number, t: number];

export interface Stroke {
  color: string;
  alpha: number;
  size: number;
  tool: 'pen' | 'eraser';
  points: StrokePoint[];
}

export interface Drawing {
  background: string;
  strokes: Stroke[];
}

/** Unit-square geometry for the future shatter animation. */
export interface Piece {
  path: Path2D;
  points: [number, number][];
  centroid: [number, number];
}

export type InputType = 'pen' | 'touch' | 'mouse';

export interface Prompt {
  slug: string;
  text: string;
}

export type RandomPromptResponse = Prompt;

export interface ApiErrorResponse {
  error: string;
}
