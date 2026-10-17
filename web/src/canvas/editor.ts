import type {
  Drawing,
  InputType,
  Stroke,
  StrokePoint,
} from '@solcollab/shared';
import { renderDrawing, renderInk } from './render';
import { isDrawing } from './draft';
import {
  ANCHORS,
  CLOSE_RADIUS,
  distance,
  shapePath,
  toStrokePoints,
  type Point,
  type ShapeTool,
} from './shapes';

export class Editor {
  readonly ink = document.createElement('canvas');
  readonly background = document.createElement('canvas');
  readonly cursor = document.createElement('span');
  state: Drawing = { background: '#FFFFFF', strokes: [] };
  color = '#202020';
  alpha = 1;
  size = 12;
  tool: 'pen' | 'eraser' = 'pen';
  /** Geometric or fill tool in use; null draws freehand. */
  shape: ShapeTool | 'fill' | null = null;
  private history: Drawing[] = [];
  private future: Drawing[] = [];
  private active: Stroke | null = null;
  private pointer: number | null = null;
  private began = 0;
  private counts: Record<InputType, number> = { mouse: 0, pen: 0, touch: 0 };
  private observer: ResizeObserver;
  private keyboardPoint: [number, number] = [500, 500];
  private keyboardStroke = false;
  private dirty = false;
  private anchors: Point[] = [];
  private hover: Point | null = null;
  private pressedAt: Point | null = null;
  frozen = false;
  onChange: () => void = () => {};
  onMessage: (message: string) => void = () => {};

  constructor(
    readonly host: HTMLElement,
    readonly slug: string,
  ) {
    this.host.className = 'canvas-stage';
    this.ink.className = 'ink-layer';
    this.background.className = 'background-layer';
    this.ink.tabIndex = 0;
    this.ink.setAttribute('role', 'application');
    this.ink.setAttribute(
      'aria-label',
      'Drawing canvas. Arrow keys move the pen. Space starts or ends a stroke.',
    );
    this.cursor.className = 'brush-cursor';
    this.cursor.setAttribute('aria-hidden', 'true');
    host.append(this.background, this.ink, this.cursor);
    try {
      const draft = JSON.parse(sessionStorage.getItem(this.key) ?? 'null');
      if (isDrawing(draft)) {
        this.state = { background: draft.background, strokes: draft.strokes };
        const counts = (
          draft as Drawing & { input_counts?: Record<InputType, number> }
        ).input_counts;
        if (counts)
          for (const key of ['mouse', 'pen', 'touch'] as const)
            if (Number.isFinite(counts[key]) && counts[key] >= 0)
              this.counts[key] = counts[key];
        this.dirty = draft.strokes.length > 0;
      }
    } catch {
      /* Disabled storage must not prevent drawing. */
    }
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.ink.addEventListener('pointerdown', this.down);
    this.ink.addEventListener('pointermove', this.move);
    this.ink.addEventListener('pointerup', this.up);
    this.ink.addEventListener('pointercancel', this.up);
    this.ink.addEventListener('lostpointercapture', this.up);
    this.ink.addEventListener('pointerleave', () => {
      this.cursor.hidden = true;
    });
    this.ink.addEventListener('keydown', this.canvasKey);
    this.ink.addEventListener('blur', () => this.finishKeyboard());
    window.addEventListener('keydown', this.shortcuts);
    window.addEventListener('beforeunload', this.beforeUnload);
    document.addEventListener('pointerdown', this.outside, true);
    this.resize();
  }
  get key() {
    return `solcollab:draft:${this.slug}`;
  }
  get canUndo() {
    return this.history.length > 0 || this.anchors.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  get inputType(): InputType {
    return (Object.keys(this.counts) as InputType[]).reduce(
      (best, key) => (this.counts[key] > this.counts[best] ? key : best),
      'mouse',
    );
  }
  get hasMarks() {
    return this.state.strokes.some((stroke) => stroke.tool === 'pen');
  }
  get isDirty() {
    return this.dirty;
  }
  private pointCount() {
    return (
      this.state.strokes.reduce(
        (sum, stroke) => sum + stroke.points.length,
        0,
      ) + (this.active?.points.length ?? 0)
    );
  }
  private resize() {
    const size = Math.max(
      1,
      Math.round(
        this.host.getBoundingClientRect().width *
          Math.min(devicePixelRatio || 1, 3),
      ),
    );
    this.ink.width =
      this.ink.height =
      this.background.width =
      this.background.height =
        size;
    this.render();
  }
  private render() {
    const ctx = this.background.getContext('2d')!;
    ctx.fillStyle = this.state.background;
    ctx.fillRect(0, 0, this.background.width, this.background.height);
    renderInk(this.ink, [
      ...this.state.strokes,
      ...(this.active ? [this.active] : []),
      ...this.shapeStrokes(this.previewPath()),
    ]);
  }
  private shapeStrokes(path: Point[]): Stroke[] {
    return toStrokePoints(path).map((points) => ({
      color: this.color,
      alpha: this.alpha,
      size: this.size,
      tool: this.tool,
      points,
    }));
  }
  private get geometry(): ShapeTool | null {
    return this.shape === 'fill' ? null : this.shape;
  }
  private previewPath(): Point[] {
    const shape = this.geometry;
    if (!shape || !this.anchors.length) return [];
    const hover = this.hover;
    if (shape === 'polygon') {
      const closing =
        hover &&
        this.anchors.length >= 3 &&
        distance(hover, this.anchors[0]!) < CLOSE_RADIUS;
      return closing
        ? shapePath('polygon', this.anchors, true)
        : shapePath('polygon', hover ? [...this.anchors, hover] : this.anchors);
    }
    return shapePath(shape, hover ? [...this.anchors, hover] : this.anchors);
  }
  /** Place the next anchor of the active shape, committing once the shape is complete. */
  private place(p: Point) {
    const shape = this.geometry;
    if (!shape) return;
    if (
      shape === 'polygon' &&
      this.anchors.length >= 3 &&
      distance(p, this.anchors[0]!) < CLOSE_RADIUS
    ) {
      this.commitShape(true);
      return;
    }
    this.anchors.push(p);
    if (this.anchors.length >= ANCHORS[shape]) this.commitShape();
    else this.onChange();
  }
  /** Finish the pending shape; a polygon closes back to its first vertex. */
  commitShape(closed = this.shape === 'polygon') {
    const shape = this.geometry;
    const anchors = this.anchors;
    this.anchors = [];
    this.hover = null;
    this.pressedAt = null;
    if (!shape || anchors.length < 2) {
      this.render();
      this.onChange();
      return;
    }
    const strokes = this.shapeStrokes(
      shapePath(shape, anchors, closed && anchors.length >= 3),
    );
    const points = strokes.reduce((sum, s) => sum + s.points.length, 0);
    if (
      this.pointCount() + points > 5000 ||
      this.state.strokes.length + strokes.length > 1000
    ) {
      this.onMessage(
        'This shape would overfill the drawing. Hang it or undo a stroke to continue.',
      );
      this.render();
      this.onChange();
      return;
    }
    if (strokes.length)
      this.change({
        ...this.state,
        strokes: [...this.state.strokes, ...strokes],
      });
    else this.render();
  }
  cancelShape() {
    if (!this.anchors.length) return;
    this.anchors = [];
    this.hover = null;
    this.pressedAt = null;
    this.render();
    this.onChange();
  }
  setShape(shape: ShapeTool | 'fill' | null) {
    if (this.anchors.length) this.commitShape();
    this.shape = shape;
  }
  /** Clicking off the canvas closes a pending polygon and drops other unfinished shapes. */
  private outside = (event: PointerEvent) => {
    if (!this.anchors.length || this.frozen) return;
    const target = event.target;
    if (
      target instanceof Node &&
      (this.ink.contains(target) ||
        (target instanceof Element && target.closest('[data-keeps-shape]')))
    )
      return;
    if (this.shape === 'polygon') this.commitShape(true);
    else this.cancelShape();
  };
  private save() {
    this.dirty = true;
    try {
      sessionStorage.setItem(
        this.key,
        JSON.stringify({ ...this.state, input_counts: this.counts }),
      );
    } catch {
      this.onMessage(
        'Browser storage is unavailable. Keep this tab open until your drawing is hung.',
      );
    }
    this.onChange();
  }
  private change(next: Drawing) {
    this.history.push(this.state);
    if (this.history.length > 100) this.history.shift();
    this.future = [];
    this.state = next;
    this.render();
    this.save();
  }
  private add(p: StrokePoint) {
    if (!this.active) return;
    if (this.pointCount() >= 5000) {
      this.onMessage(
        'You have reached 5,000 points. Hang this drawing, or undo a stroke to continue.',
      );
      return;
    }
    this.active.points.push(p);
  }
  private coordinates(event: PointerEvent): StrokePoint {
    const rect = this.ink.getBoundingClientRect();
    return [
      Math.max(
        0,
        Math.min(1000, ((event.clientX - rect.left) / rect.width) * 1000),
      ),
      Math.max(
        0,
        Math.min(1000, ((event.clientY - rect.top) / rect.height) * 1000),
      ),
      1, // Pen input uses the same constant width as touch and mouse.
      Math.max(0, event.timeStamp - this.began),
    ];
  }
  private showCursor(event: PointerEvent) {
    const rect = this.ink.getBoundingClientRect();
    this.cursor.hidden = event.pointerType === 'touch';
    this.cursor.style.left = `${event.clientX - rect.left}px`;
    this.cursor.style.top = `${event.clientY - rect.top}px`;
    this.cursor.style.width =
      this.cursor.style.height = `${(this.size / 1000) * rect.width}px`;
  }
  private down = (event: PointerEvent) => {
    if (this.frozen || this.pointer !== null || event.button !== 0) return;
    if (this.pointCount() >= 5000 || this.state.strokes.length >= 1000) {
      this.onMessage(
        'This drawing is full. Hang it or undo a stroke to continue.',
      );
      return;
    }
    event.preventDefault();
    this.ink.focus({ preventScroll: true });
    this.pointer = event.pointerId;
    this.began = event.timeStamp;
    if (this.shape === 'fill') {
      this.pointer = null;
      const [x, y] = this.coordinates(event);
      this.counts[(event.pointerType || 'mouse') as InputType] =
        (this.counts[(event.pointerType || 'mouse') as InputType] ?? 0) + 1;
      this.change({
        ...this.state,
        strokes: [
          ...this.state.strokes,
          {
            color: this.color,
            alpha: this.alpha,
            size: this.size,
            tool: this.tool,
            fill: true,
            points: [[x, y, 1, 0]],
          },
        ],
      });
      return;
    }
    if (this.shape) {
      const [x, y] = this.coordinates(event);
      this.pressedAt = this.hover = [x, y];
      if (!this.anchors.length)
        this.counts[(event.pointerType || 'mouse') as InputType] =
          (this.counts[(event.pointerType || 'mouse') as InputType] ?? 0) + 1;
      this.ink.setPointerCapture(event.pointerId);
      this.showCursor(event);
      this.place([x, y]);
      this.render();
      return;
    }
    this.active = {
      color: this.color,
      alpha: this.alpha,
      size: this.size,
      tool: this.tool,
      points: [],
    };
    this.add(this.coordinates(event));
    this.counts[(event.pointerType || 'mouse') as InputType] =
      (this.counts[(event.pointerType || 'mouse') as InputType] ?? 0) + 1;
    this.ink.setPointerCapture(event.pointerId);
    this.showCursor(event);
    this.render();
  };
  private move = (event: PointerEvent) => {
    this.showCursor(event);
    if (this.shape && this.anchors.length && !this.frozen) {
      const [x, y] = this.coordinates(event);
      this.hover = [x, y];
      this.render();
      return;
    }
    if (this.pointer !== event.pointerId || !this.active || this.frozen) return;
    const coalesced = event.getCoalescedEvents?.() ?? [];
    for (const p of coalesced.length ? coalesced : [event])
      this.add(this.coordinates(p));
    this.render();
  };
  private up = (event: PointerEvent) => {
    if (this.pointer !== event.pointerId) return;
    const stroke = this.active;
    this.pointer = null;
    this.active = null;
    if (this.ink.hasPointerCapture(event.pointerId))
      this.ink.releasePointerCapture(event.pointerId);
    const pressedAt = this.pressedAt;
    this.pressedAt = null;
    if (this.shape && pressedAt && this.anchors.length) {
      // Dragging places the next anchor where the pointer is released.
      const [x, y] = this.coordinates(event);
      if (event.type === 'pointerup' && distance([x, y], pressedAt) > 8)
        this.place([x, y]);
      return;
    }
    if (stroke?.points.length)
      this.change({ ...this.state, strokes: [...this.state.strokes, stroke] });
  };
  private canvasKey = (event: KeyboardEvent) => {
    if (this.frozen) return;
    if (event.code === 'Space') {
      event.preventDefault();
      if (this.keyboardStroke) {
        this.finishKeyboard();
        return;
      }
      if (this.pointCount() >= 5000) return;
      this.keyboardStroke = true;
      this.began = performance.now();
      this.active = {
        color: this.color,
        alpha: this.alpha,
        size: this.size,
        tool: this.tool,
        points: [[...this.keyboardPoint, 1, 0]],
      };
      this.render();
    }
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (delta[event.key]) {
      event.preventDefault();
      const d = delta[event.key]!;
      const step = event.shiftKey ? 25 : 5;
      this.keyboardPoint = [
        Math.max(0, Math.min(1000, this.keyboardPoint[0] + d[0] * step)),
        Math.max(0, Math.min(1000, this.keyboardPoint[1] + d[1] * step)),
      ];
      if (this.keyboardStroke) {
        this.add([...this.keyboardPoint, 1, performance.now() - this.began]);
        this.render();
      }
      const rect = this.ink.getBoundingClientRect();
      this.cursor.hidden = false;
      this.cursor.style.left = `${(this.keyboardPoint[0] / 1000) * rect.width}px`;
      this.cursor.style.top = `${(this.keyboardPoint[1] / 1000) * rect.height}px`;
      this.cursor.style.width =
        this.cursor.style.height = `${(this.size / 1000) * rect.width}px`;
    }
    if (event.key === 'Escape') {
      this.finishKeyboard();
      this.cancelShape();
    }
    if (event.key === 'Enter' && this.anchors.length) {
      event.preventDefault();
      this.commitShape();
    }
  };
  finishKeyboard() {
    if (this.keyboardStroke) {
      const stroke = this.active;
      this.keyboardStroke = false;
      this.active = null;
      if (stroke)
        this.change({
          ...this.state,
          strokes: [...this.state.strokes, stroke],
        });
    }
  }
  private shortcuts = (event: KeyboardEvent) => {
    if (
      this.frozen ||
      (event.target instanceof Element &&
        event.target.matches('input,textarea,select'))
    )
      return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
    }
    if (event.key === '[' || event.key === ']') {
      event.preventDefault();
      this.size = Math.max(
        1,
        Math.min(80, this.size + (event.key === ']' ? 1 : -1)),
      );
      this.onChange();
    }
  };
  private beforeUnload = (event: BeforeUnloadEvent) => {
    if (this.dirty || this.active?.points.length) {
      event.preventDefault();
      event.returnValue = '';
    }
  };
  undo() {
    if (this.frozen) return;
    this.finishKeyboard();
    if (this.anchors.length) {
      // While a shape is in progress, undo steps back one anchor.
      this.anchors.pop();
      this.render();
      this.onChange();
      return;
    }
    const previous = this.history.pop();
    if (previous) {
      this.future.push(this.state);
      this.state = previous;
      this.render();
      this.save();
    }
  }
  redo() {
    if (this.frozen) return;
    const next = this.future.pop();
    if (next) {
      this.history.push(this.state);
      this.state = next;
      this.render();
      this.save();
    }
  }
  clear() {
    this.cancelShape();
    if (!this.frozen) this.change({ ...this.state, strokes: [] });
  }
  setBackground(background: string) {
    if (!this.frozen && background !== this.state.background)
      this.change({ ...this.state, background });
  }
  snapshot() {
    this.finishKeyboard();
    this.commitShape();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1000;
    renderDrawing(canvas, this.state);
    return canvas;
  }
  saved() {
    this.dirty = false;
    try {
      sessionStorage.removeItem(this.key);
    } catch {
      /* Storage can be disabled. */
    }
  }
  destroy() {
    this.observer.disconnect();
    window.removeEventListener('keydown', this.shortcuts);
    window.removeEventListener('beforeunload', this.beforeUnload);
    document.removeEventListener('pointerdown', this.outside, true);
  }
}
