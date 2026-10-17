import type { Drawing } from '@solcollab/shared';
import { renderDrawing } from '../canvas/render';
import { button, element } from '../ui/dom';
import { schedule, visibleStrokes } from './schedule';

export class ReplayPlayer {
  readonly node = element('div', 'replay-player');
  readonly canvas = element('canvas', 'replay-canvas');
  private elapsed = 0;
  private started = 0;
  private playing = false;
  private frame = 0;
  private readonly timeline;
  private readonly ink = document.createElement('canvas');
  private readonly play = button('Pause', () => this.toggle());
  private readonly progress = element('progress');
  constructor(private readonly drawing: Drawing) {
    this.timeline = schedule(drawing.strokes);
    this.canvas.width = this.canvas.height = 1000;
    this.progress.max = 5000;
    this.progress.setAttribute('aria-label', 'Replay progress');
    const controls = element('div', 'replay-controls');
    controls.append(
      this.play,
      button('Restart', () => this.restart()),
      this.progress,
    );
    this.node.append(this.canvas, controls);
    this.canvas.addEventListener('click', () => this.restart());
    this.render();
    this.restart();
  }
  private render() {
    renderDrawing(
      this.canvas,
      {
        background: this.drawing.background,
        strokes: visibleStrokes(
          this.drawing.strokes,
          this.timeline,
          this.elapsed,
        ),
      },
      this.ink,
    );
    this.progress.value = this.elapsed;
  }
  private tick = (now: number) => {
    if (!this.playing) return;
    this.elapsed = Math.min(5000, now - this.started);
    this.render();
    if (this.elapsed >= 5000) {
      this.playing = false;
      this.play.textContent = 'Play again';
      return;
    }
    this.frame = requestAnimationFrame(this.tick);
  };
  toggle() {
    if (this.playing) {
      this.playing = false;
      cancelAnimationFrame(this.frame);
      this.play.textContent = 'Play';
    } else {
      if (this.elapsed >= 5000) this.elapsed = 0;
      this.playing = true;
      this.started = performance.now() - this.elapsed;
      this.play.textContent = 'Pause';
      this.frame = requestAnimationFrame(this.tick);
    }
  }
  restart() {
    cancelAnimationFrame(this.frame);
    this.elapsed = 0;
    this.playing = false;
    this.toggle();
  }
  destroy() {
    this.playing = false;
    cancelAnimationFrame(this.frame);
  }
}
