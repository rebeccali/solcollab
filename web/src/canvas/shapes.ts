import type { StrokePoint } from '@solcollab/shared';

export type ShapeTool = 'line' | 'arc' | 'polygon' | 'circle';
export type Point = [number, number];

/** Logical units between sampled points; dense enough that freehand smoothing keeps edges straight. */
const SPACING = 6;
/** Replay time per logical unit of path length, in milliseconds. */
const MS_PER_UNIT = 0.6;
/** How close (logical units) a click must land to the first vertex to close a polygon. */
export const CLOSE_RADIUS = 18;

/** Anchors each tool needs before it commits; polygons commit when closed instead. */
export const ANCHORS: Record<ShapeTool, number> = {
  line: 2,
  arc: 3,
  circle: 2,
  polygon: Infinity,
};

const distance = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);

function polyline(points: Point[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!,
      b = points[i + 1]!;
    const steps = Math.max(1, Math.ceil(distance(a, b) / SPACING));
    for (let s = 0; s < steps; s++)
      out.push([
        a[0] + ((b[0] - a[0]) * s) / steps,
        a[1] + ((b[1] - a[1]) * s) / steps,
      ]);
  }
  if (points.length) out.push(points.at(-1)!);
  return out;
}

function circle(center: Point, radius: number): Point[] {
  const steps = Math.max(24, Math.ceil((2 * Math.PI * radius) / SPACING));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const angle = (i / steps) * 2 * Math.PI;
    return [
      center[0] + radius * Math.cos(angle),
      center[1] + radius * Math.sin(angle),
    ];
  });
}

/** Arc from `start` to `end` bulging through `through`; collinear points fall back to a line. */
function arc(start: Point, end: Point, through: Point): Point[] {
  const [ax, ay] = start,
    [bx, by] = through,
    [cx, cy] = end;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-6) return polyline([start, end]);
  const a2 = ax * ax + ay * ay,
    b2 = bx * bx + by * by,
    c2 = cx * cx + cy * cy;
  const center: Point = [
    (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d,
    (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d,
  ];
  const radius = distance(center, start);
  if (radius > 20000) return polyline([start, end]);
  const angle = (p: Point) => Math.atan2(p[1] - center[1], p[0] - center[0]);
  const tau = 2 * Math.PI;
  const norm = (value: number) => ((value % tau) + tau) % tau;
  const from = angle(start);
  // Sweep counter-clockwise if that passes `through` before `end`, otherwise clockwise.
  let sweep = norm(angle(end) - from);
  if (norm(angle(through) - from) > sweep) sweep -= tau;
  const steps = Math.max(8, Math.ceil((Math.abs(sweep) * radius) / SPACING));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = from + (sweep * i) / steps;
    return [center[0] + radius * Math.cos(t), center[1] + radius * Math.sin(t)];
  });
}

/** Sampled path for a shape; `closed` joins a polygon back to its first vertex. */
export function shapePath(
  tool: ShapeTool,
  anchors: Point[],
  closed = false,
): Point[] {
  if (!anchors.length) return [];
  if (anchors.length === 1) return [anchors[0]!];
  switch (tool) {
    case 'line':
      return polyline(anchors.slice(0, 2));
    case 'circle':
      return circle(anchors[0]!, distance(anchors[0]!, anchors[1]!));
    case 'arc':
      return anchors.length === 2
        ? polyline(anchors)
        : arc(anchors[0]!, anchors[1]!, anchors[2]!);
    case 'polygon':
      return polyline(closed ? [...anchors, anchors[0]!] : anchors);
  }
}

const inside = (p: Point) =>
  p[0] >= 0 && p[0] <= 1000 && p[1] >= 0 && p[1] <= 1000;

/** Point where segment a→b (a inside, b outside, or vice versa) crosses the canvas edge. */
function edge(a: Point, b: Point): Point {
  let lo = 0,
    hi = 1;
  const at = (t: number): Point => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
  ];
  const aIn = inside(a);
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (inside(at(mid)) === aIn) lo = mid;
    else hi = mid;
  }
  const p = at(aIn ? lo : hi);
  return [Math.max(0, Math.min(1000, p[0])), Math.max(0, Math.min(1000, p[1]))];
}

/**
 * Split a path into on-canvas runs and timestamp them, so shapes that leave the
 * 1000 × 1000 canvas are clipped instead of flattened against its edge.
 */
export function toStrokePoints(path: Point[]): StrokePoint[][] {
  const runs: Point[][] = [];
  let run: Point[] = [];
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!,
      prev = path[i - 1];
    if (inside(p)) {
      if (!run.length && prev && !inside(prev)) run.push(edge(p, prev));
      run.push(p);
    } else if (run.length) {
      run.push(edge(prev!, p));
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  // A full circle starts and ends at the same spot; rejoin its first and last runs.
  if (
    runs.length > 1 &&
    distance(path[0]!, path.at(-1)!) < 1e-6 &&
    inside(path[0]!)
  )
    runs[0] = [...runs.pop()!, ...runs[0]!.slice(1)];
  return runs.map((points) => {
    let length = 0;
    return points.map((p, i) => {
      if (i) length += distance(points[i - 1]!, p);
      return [p[0], p[1], 1, Math.min(600000, length * MS_PER_UNIT)];
    });
  });
}

export { distance };
