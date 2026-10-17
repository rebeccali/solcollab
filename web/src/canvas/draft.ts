import type { Drawing, Stroke } from '@solcollab/shared';
/** Browser storage may contain old or incomplete drafts; validate before rendering. */
export function isDrawing(value: unknown): value is Drawing {
  if (!value || typeof value !== 'object') return false;
  const drawing = value as Drawing;
  if (
    typeof drawing.background !== 'string' ||
    !/^#[0-9a-f]{6}$/i.test(drawing.background) ||
    !Array.isArray(drawing.strokes) ||
    drawing.strokes.length > 1000
  )
    return false;
  let total = 0;
  return drawing.strokes.every((stroke: Stroke) => {
    if (
      !stroke ||
      !['pen', 'eraser'].includes(stroke.tool) ||
      !/^#[0-9a-f]{6}$/i.test(stroke.color) ||
      !Number.isFinite(stroke.alpha) ||
      stroke.alpha < 0 ||
      stroke.alpha > 1 ||
      !Number.isFinite(stroke.size) ||
      stroke.size < 1 ||
      stroke.size > 80 ||
      !Array.isArray(stroke.points) ||
      !stroke.points.length
    )
      return false;
    total += stroke.points.length;
    if (total > 5000) return false;
    let last = -1;
    return stroke.points.every((point) => {
      if (
        !Array.isArray(point) ||
        point.length !== 4 ||
        !point.every(Number.isFinite) ||
        point[0] < 0 ||
        point[0] > 1000 ||
        point[1] < 0 ||
        point[1] > 1000 ||
        point[2] < 0 ||
        point[2] > 1 ||
        point[3] < last ||
        point[3] > 600000
      )
        return false;
      last = point[3];
      return true;
    });
  });
}
