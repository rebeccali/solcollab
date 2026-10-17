import type { Piece, Point } from './types';
import { bezier, clamp, ease, mix, seeded } from './geometry';
import { grid } from './patterns/grid';
import { caption } from './caption';
import { inkStats, orders } from './orders';
import { element } from '../ui/dom';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface SceneOptions {
  pieces: Piece[];
  ranks: number[];
  seed: number;
  source: CanvasImageSource;
  sourceRect: Rect;
}
export class Scene {
  readonly pieces: Piece[];
  private readonly angles: number[];
  private readonly heights: number[];
  constructor(private readonly options: SceneOptions) {
    this.pieces = options.pieces;
    const rng = seeded(options.seed);
    this.angles = this.pieces.map(() => ((rng() - 0.5) * 24 * Math.PI) / 180);
    this.heights = this.pieces.map(() => 0.05 + rng() * 0.1);
  }
  draw(
    ctx: CanvasRenderingContext2D,
    destination: Rect,
    time: number,
    options: {
      pending?: boolean;
      bob?: number;
      fall?: number;
      outlines?: boolean;
      reduced?: boolean;
    } = {},
  ) {
    const source = this.options.sourceRect,
      fall = options.fall ?? 0;
    if (options.reduced) {
      const progress = clamp((time - 200) / 300);
      ctx.save();
      ctx.globalAlpha = 1 - progress;
      ctx.drawImage(
        this.options.source,
        source.x,
        source.y,
        source.width,
        source.width,
      );
      ctx.globalAlpha = progress;
      ctx.drawImage(
        this.options.source,
        destination.x,
        destination.y,
        destination.width,
        destination.width,
      );
      ctx.restore();
      if (time >= 200) return;
    }
    if (time < 200 && !options.reduced) {
      ctx.drawImage(
        this.options.source,
        source.x,
        source.y,
        source.width,
        source.width,
      );
    }
    for (let i = 0; i < this.pieces.length; i++) {
      const piece = this.pieces[i]!,
        rank = this.options.ranks[i]!,
        angle = this.angles[i]!;
      const from: Point = [
        source.x + piece.centroid[0] * source.width,
        source.y + piece.centroid[1] * source.width,
      ];
      const to: Point = [
        destination.x + piece.centroid[0] * destination.width,
        destination.y + piece.centroid[1] * destination.width,
      ];
      const lift = clamp((time - 500) / 500),
        cut = clamp((time - 200) / 300);
      const lifted: Point = [
        from[0] + (piece.centroid[0] - 0.5) * source.width * 0.035 * lift,
        from[1] + (piece.centroid[1] - 0.5) * source.width * 0.035 * lift,
      ];
      const local = clamp(
          (time - 1000 - (rank / Math.max(1, this.pieces.length - 1)) * 550) /
            450,
        ),
        progress = ease(local);
      const dx = to[0] - lifted[0],
        dy = to[1] - lifted[1];
      const control: Point = [
        (lifted[0] + to[0]) / 2 - dy * this.heights[i]!,
        (lifted[1] + to[1]) / 2 + dx * this.heights[i]!,
      ];
      const center =
        time < 1000 ? lifted : bezier(lifted, control, to, progress);
      let scale =
        time < 500
          ? mix(1, 0.97, cut)
          : time < 1000
            ? mix(0.97, 1.05, lift)
            : mix(1.05, destination.width / source.width, progress);
      let rotation = angle * lift * (1 - progress);
      if (time >= 2000) {
        scale =
          (destination.width / source.width) *
          (options.pending ? 0.97 : mix(0.97, 1, clamp((time - 2000) / 400)));
        center[0] = to[0];
        center[1] =
          to[1] +
          (options.pending
            ? Math.sin((options.bob ?? 0) / 350 + rank * 0.3) * 2
            : 0);
      }
      if (fall) {
        const stagger = (rank / this.pieces.length) * 0.18,
          fallTime = Math.max(0, fall - stagger);
        center[1] += fallTime * fallTime * (innerHeight + source.width) * 2;
        center[0] += Math.sin(i) * fallTime * 70;
        rotation += angle * fallTime * 9;
      }
      ctx.save();
      ctx.translate(...center);
      ctx.rotate(rotation);
      ctx.scale(scale * source.width, scale * source.width);
      ctx.translate(-piece.centroid[0], -piece.centroid[1]);
      if (time < 200) {
        ctx.globalAlpha = clamp(time / 200);
        ctx.strokeStyle = '#25241f';
        ctx.lineWidth = 1 / source.width;
        ctx.stroke(piece.path);
      } else {
        if (time > 500 && time < 1850) {
          ctx.save();
          ctx.shadowColor = '#0004';
          ctx.shadowBlur = 8;
          ctx.shadowOffsetY = 4;
          ctx.fillStyle = '#fff';
          ctx.fill(piece.path);
          ctx.restore();
        }
        ctx.save();
        ctx.clip(piece.path);
        ctx.drawImage(this.options.source, 0, 0, 1, 1);
        ctx.restore();
        if (time < 2000 || options.pending || options.outlines) {
          ctx.strokeStyle = options.outlines ? '#d7261e' : '#0004';
          ctx.lineWidth = 1 / (scale * source.width);
          ctx.stroke(piece.path);
        }
      }
      if (options.outlines) {
        ctx.fillStyle = '#c72c23';
        ctx.font = `${12 / (scale * source.width)}px monospace`;
        ctx.fillText(String(rank), piece.centroid[0], piece.centroid[1]);
      }
      ctx.restore();
    }
  }
}

export async function animateSubmission<T>(options: {
  snapshot: HTMLCanvasElement;
  ink: HTMLCanvasElement;
  sourceRect: Rect;
  upload: Promise<T>;
  signal?: AbortSignal;
  onGallery: () => void;
  destination: () => Rect;
  onHang: (result: T) => void;
  onTimeout: () => void;
}): Promise<T> {
  let outcome: 'pending' | 'success' | 'failure' = 'pending',
    result: T | undefined,
    failure: unknown;
  void options.upload.then(
    (value) => {
      if (outcome === 'failure') return;
      result = value;
      outcome = 'success';
    },
    (error) => {
      if (outcome === 'failure') return;
      failure = error;
      outcome = 'failure';
    },
  );
  const abort = () => {
    if (outcome !== 'failure') {
      failure = new Error(
        'Hanging was interrupted. Your drawing is kept in this tab.',
      );
      outcome = 'failure';
    }
  };
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const overlay = element('canvas', 'shatter-overlay');
  overlay.setAttribute('aria-hidden', 'true');
  const label = element('p', 'shatter-caption');
  label.setAttribute('aria-hidden', 'true');
  document.body.append(overlay, label);
  document.body.classList.add('is-hanging');
  const ratio = Math.min(devicePixelRatio || 1, 2),
    ctx = overlay.getContext('2d')!;
  const resize = () => {
    overlay.width = Math.round(innerWidth * ratio);
    overlay.height = Math.round(innerHeight * ratio);
  };
  resize();
  window.addEventListener('resize', resize);
  const density =
    innerWidth < 500 || (navigator.hardwareConcurrency ?? 8) <= 4 ? 6 : 10;
  const pieces = grid.generate(seeded(1), { density }),
    ranks = orders['row-major'](
      pieces,
      seeded(1),
      inkStats(options.ink, pieces),
    );
  const text = caption(grid, pieces.length);
  label.textContent = '';
  let bitmap: ImageBitmap | HTMLCanvasElement = options.snapshot;
  try {
    bitmap = await createImageBitmap(options.snapshot);
  } catch {
    /* The detached snapshot remains usable. */
  }
  const scene = new Scene({
    pieces,
    ranks,
    seed: Date.now(),
    source: bitmap,
    sourceRect: options.sourceRect,
  });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let skipped = false,
    navigated = false,
    frame = 0,
    last = performance.now(),
    fallBegan: number | undefined;
  const frames: number[] = [];
  const skip = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    skipped = true;
  };
  for (const name of ['pointerdown', 'click', 'keydown'])
    window.addEventListener(name, skip, true);
  const start = performance.now();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tick = (now: number) => {
        try {
          const elapsed = now - start;
          frames.push(now - last);
          last = now;
          if (frames.length > 10) frames.shift();
          if (frames.filter((time) => time > 24).length > 5) skipped = true;
          if (elapsed > 12000 && outcome === 'pending') {
            failure = new Error(
              'The wall took too long to respond. Your drawing is saved. Please try again.',
            );
            outcome = 'failure';
            options.onTimeout();
          }
          let time = skipped ? (reduced ? 500 : 2400) : elapsed;
          const end = reduced ? 500 : 2400;
          if (
            !navigated &&
            time >= (reduced ? 200 : 500) &&
            outcome !== 'failure'
          ) {
            options.onGallery();
            navigated = true;
          }
          let destination = options.sourceRect;
          if (navigated) destination = options.destination();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, overlay.width, overlay.height);
          ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
          if (outcome === 'failure') {
            fallBegan ??= now;
            const fall = (now - fallBegan) / 650;
            if (reduced || fall > 1.3) {
              reject(failure);
              return;
            }
            scene.draw(ctx, destination, Math.min(Math.max(time, 500), 2000), {
              fall,
            });
            label.textContent =
              'The wall could not take your drawing. Bringing it back…';
          } else {
            if (outcome === 'pending')
              time = Math.min(time, reduced ? 500 : 2000);
            scene.draw(ctx, destination, time, {
              pending: outcome === 'pending' && time >= 2000,
              bob: elapsed,
              reduced,
            });
            label.textContent =
              text.slice(0, Math.floor(elapsed / 16)) +
              (outcome === 'pending' && elapsed > 2000
                ? ' Awaiting the curator…'
                : '');
            if (outcome === 'success' && time >= end) {
              options.onHang(result!);
              if (!reduced) confetti(destination);
              resolve(result!);
              return;
            }
          }
          frame = requestAnimationFrame(tick);
        } catch (error) {
          reject(error);
        }
      };
      frame = requestAnimationFrame(tick);
    });
  } finally {
    cancelAnimationFrame(frame);
    overlay.remove();
    label.remove();
    window.removeEventListener('resize', resize);
    document.body.classList.remove('is-hanging');
    options.signal?.removeEventListener('abort', abort);
    for (const name of ['pointerdown', 'click', 'keydown'])
      window.removeEventListener(name, skip, true);
    if (typeof ImageBitmap !== 'undefined' && bitmap instanceof ImageBitmap)
      bitmap.close();
  }
}
function confetti(destination: Rect) {
  const canvas = element('canvas', 'confetti-overlay');
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = innerWidth * ratio;
  canvas.height = innerHeight * ratio;
  const ctx = canvas.getContext('2d')!,
    rng = seeded(Date.now());
  const particles = Array.from({ length: 36 }, () => ({
    x: destination.x + destination.width / 2,
    y: destination.y + destination.width / 2,
    vx: (rng() - 0.5) * 250,
    vy: -100 - rng() * 160,
    rotation: rng() * Math.PI,
    color: ['#D7261E', '#2358BD', '#F2C230'][Math.floor(rng() * 3)]!,
  }));
  const began = performance.now();
  const tick = (now: number) => {
    const t = (now - began) / 1000;
    if (t > 1) {
      canvas.remove();
      return;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(ratio, ratio);
    ctx.globalAlpha = 1 - t;
    particles.forEach((p, index) => {
      ctx.save();
      ctx.translate(p.x + p.vx * t, p.y + p.vy * t + 260 * t * t);
      ctx.rotate(p.rotation + t * 4);
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;
      if (index % 3 === 0) {
        ctx.beginPath();
        ctx.arc(0, 0, 3, 0, Math.PI * 2);
        ctx.fill();
      } else if (index % 3 === 1) {
        ctx.fillRect(-3, -3, 6, 6);
      } else {
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-5, 0);
        ctx.lineTo(5, 0);
        ctx.stroke();
      }
      ctx.restore();
    });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
