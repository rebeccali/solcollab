import { getStroke } from 'perfect-freehand';
import type { Drawing, Stroke } from '@solcollab/shared';

export const LOGICAL_SIZE = 1000;
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
/** Summed RGBA distance under which a pixel counts as part of the filled region. */
const FILL_TOLERANCE = 96;

/** Pixels connected to (sx, sy) whose color matches the seed pixel. */
export function floodMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  sx: number,
  sy: number,
) {
  const mask = new Uint8Array(width * height);
  const seed = (sy * width + sx) * 4;
  const [r, g, b, a] = [
    data[seed]!,
    data[seed + 1]!,
    data[seed + 2]!,
    data[seed + 3]!,
  ];
  const matches = (p: number) => {
    if (mask[p]) return false;
    const i = p * 4,
      alpha = data[i + 3]!;
    // Fully transparent ink shows the background regardless of its stored RGB.
    if (a < 8 && alpha < 8) return true;
    return (
      Math.abs(data[i]! - r) +
        Math.abs(data[i + 1]! - g) +
        Math.abs(data[i + 2]! - b) +
        Math.abs(alpha - a) <=
      FILL_TOLERANCE
    );
  };
  const stack = [sx, sy];
  while (stack.length) {
    const y = stack.pop()!,
      x0 = stack.pop()!;
    let x = x0;
    const row = y * width;
    if (!matches(row + x)) continue;
    while (x > 0 && matches(row + x - 1)) x--;
    let up = false,
      down = false;
    for (; x < width && matches(row + x); x++) {
      mask[row + x] = 1;
      if (y > 0) {
        const open = matches(row - width + x);
        if (open && !up) stack.push(x, y - 1);
        up = open;
      }
      if (y < height - 1) {
        const open = matches(row + width + x);
        if (open && !down) stack.push(x, y + 1);
        down = open;
      }
    }
  }
  return mask;
}

/** Grow a mask by `radius` pixels so fills tuck under anti-aliased stroke edges. */
function dilate(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
) {
  const horizontal = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (mask[y * width + x])
        for (
          let dx = Math.max(0, x - radius);
          dx <= Math.min(width - 1, x + radius);
          dx++
        )
          horizontal[y * width + dx] = 1;
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (horizontal[y * width + x])
        for (
          let dy = Math.max(0, y - radius);
          dy <= Math.min(height - 1, y + radius);
          dy++
        )
          out[dy * width + x] = 1;
  return out;
}

function paintFill(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  const { width, height } = ctx.canvas;
  const point = stroke.points[0]!;
  const sx = Math.min(width - 1, Math.floor((point[0] / 1000) * width));
  const sy = Math.min(height - 1, Math.floor((point[1] / 1000) * height));
  const source = ctx.getImageData(0, 0, width, height);
  const mask = dilate(
    floodMask(source.data, width, height, sx, sy),
    width,
    height,
    Math.max(1, Math.round(width / 1000)),
  );
  const red = parseInt(stroke.color.slice(1, 3), 16),
    green = parseInt(stroke.color.slice(3, 5), 16),
    blue = parseInt(stroke.color.slice(5, 7), 16);
  const fill = new ImageData(width, height);
  for (let p = 0; p < mask.length; p++)
    if (mask[p]) {
      fill.data[p * 4] = red;
      fill.data[p * 4 + 1] = green;
      fill.data[p * 4 + 2] = blue;
      fill.data[p * 4 + 3] = 255;
    }
  const layer = document.createElement('canvas');
  layer.width = width;
  layer.height = height;
  layer.getContext('2d')!.putImageData(fill, 0, 0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation =
    stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.globalAlpha = stroke.tool === 'eraser' ? 1 : stroke.alpha;
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

/** Ink rendered through a drawing's latest fill, so redraws skip re-running flood fills. */
interface FillSnapshot {
  strokes: Stroke[];
  image: HTMLCanvasElement;
}
const snapshots: FillSnapshot[] = [];

export function renderInk(canvas: HTMLCanvasElement, strokes: Stroke[]) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  let lastFill = -1;
  strokes.forEach((stroke, i) => {
    if (stroke.fill) lastFill = i;
  });
  const cached =
    lastFill >= 0
      ? snapshots.find(
          (snapshot) =>
            snapshot.image.width === canvas.width &&
            snapshot.image.height === canvas.height &&
            snapshot.strokes.length === lastFill + 1 &&
            snapshot.strokes.every((stroke, i) => stroke === strokes[i]),
        )
      : undefined;
  if (cached) ctx.drawImage(cached.image, 0, 0);
  ctx.setTransform(canvas.width / 1000, 0, 0, canvas.height / 1000, 0, 0);
  for (let i = cached ? lastFill + 1 : 0; i < strokes.length; i++) {
    const stroke = strokes[i]!;
    if (stroke.fill) paintFill(ctx, stroke);
    else paintStroke(ctx, stroke);
    if (i === lastFill && !cached) {
      const image = document.createElement('canvas');
      image.width = canvas.width;
      image.height = canvas.height;
      image.getContext('2d')!.drawImage(canvas, 0, 0);
      snapshots.unshift({ strokes: strokes.slice(0, lastFill + 1), image });
      snapshots.length = Math.min(snapshots.length, 3);
    }
  }
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
