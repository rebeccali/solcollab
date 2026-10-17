import { getStroke } from 'perfect-freehand';
import type { Drawing, Stroke } from '@solcollab/shared';

export const LOGICAL_SIZE = 1000;
export function pressureWidth(
  pressure: number,
  enabled: boolean,
  input: string,
) {
  return enabled && input === 'pen'
    ? 0.25 + 0.75 * Math.pow(Math.max(0, Math.min(1, pressure)), 0.6)
    : 1;
}
export function paintStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  const outline = getStroke(
    stroke.points.map((p) => [p[0], p[1], p[2]]),
    {
      size: stroke.size / 2,
      thinning: 1,
      smoothing: 0.5,
      streamline: 0.35,
      simulatePressure: false,
      last: true,
    },
  );
  if (!outline.length) return;
  const path = new Path2D();
  path.moveTo(outline[0]![0]!, outline[0]![1]!);
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!,
      b = outline[(i + 1) % outline.length]!;
    path.quadraticCurveTo(
      a[0]!,
      a[1]!,
      (a[0]! + b[0]!) / 2,
      (a[1]! + b[1]!) / 2,
    );
  }
  path.closePath();
  ctx.save();
  ctx.globalCompositeOperation =
    stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.globalAlpha = stroke.tool === 'eraser' ? 1 : stroke.alpha;
  ctx.fillStyle = stroke.color;
  ctx.fill(path);
  ctx.restore();
}
export function renderInk(canvas: HTMLCanvasElement, strokes: Stroke[]) {
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(canvas.width / 1000, 0, 0, canvas.height / 1000, 0, 0);
  for (const stroke of strokes) paintStroke(ctx, stroke);
}
export function renderDrawing(
  canvas: HTMLCanvasElement,
  drawing: Drawing,
  ink?: HTMLCanvasElement,
) {
  const layer = ink ?? document.createElement('canvas');
  layer.width = canvas.width;
  layer.height = canvas.height;
  renderInk(layer, drawing.strokes);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = drawing.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(layer, 0, 0);
}
