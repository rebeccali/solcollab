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

export interface Wall {
  id: number;
  title: string;
  opened_at: number;
  closed_at: number | null;
  count: number;
  thumbs: string[];
}
export interface PublicConfig {
  store_strokes: boolean;
  submissions_open: boolean;
  current_wall: Pick<Wall, 'id' | 'title' | 'opened_at' | 'closed_at'>;
  banner_message: string;
}
export interface PromptDetail extends Prompt {
  accepting: boolean;
  active: boolean;
  count: number;
  wall: number;
  thumbs: string[];
}
export interface Submission {
  id: string;
  prompt_slug: string;
  wall: number;
  number: number;
  background: string;
  display_name: string | null;
  input_type: InputType | null;
  created_at: number;
  full_url: string;
  thumb_url: string;
  strokes_url: string | null;
}
export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}
