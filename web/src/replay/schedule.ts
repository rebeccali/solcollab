import type { Stroke } from '@solcollab/shared';

export interface ScheduledStroke {
  start: number;
  duration: number;
  realDuration: number;
}
export function schedule(strokes: Stroke[], budget = 5000): ScheduledStroke[] {
  if (!strokes.length) return [];
  const gaps = Math.min(budget * 0.15, 60 * (strokes.length - 1)),
    gap = strokes.length > 1 ? gaps / (strokes.length - 1) : 0;
  const real = strokes.map((s) => s.points.at(-1)?.[3] ?? 0),
    total = real.reduce((a, b) => a + b, 0);
  const raw = real.map((d) =>
    Math.max(
      16,
      total ? (d / total) * (budget - gaps) : (budget - gaps) / strokes.length,
    ),
  );
  const sum = raw.reduce((a, b) => a + b, 0);
  let start = 0;
  return raw.map((duration, index) => {
    const scaled = (duration / sum) * (budget - gaps);
    const result = {
      start,
      duration: index === raw.length - 1 ? budget - start : scaled,
      realDuration: real[index]!,
    };
    start += scaled + gap;
    return result;
  });
}
export function visibleStrokes(
  strokes: Stroke[],
  timeline: ScheduledStroke[],
  time: number,
): Stroke[] {
  const visible: Stroke[] = [];
  for (let i = 0; i < strokes.length; i++) {
    const timing = timeline[i]!,
      stroke = strokes[i]!;
    if (time < timing.start) break;
    if (time >= timing.start + timing.duration) {
      visible.push(stroke);
      continue;
    }
    const progress = Math.min(1, (time - timing.start) / timing.duration);
    const points = stroke.points.filter(
      (p) =>
        timing.realDuration === 0 || p[3] / timing.realDuration <= progress,
    );
    if (points.length) visible.push({ ...stroke, points });
    break;
  }
  return visible;
}
