import { button, element, field, input } from '../ui/dom';
import { Scene } from './engine';
import { grid } from './patterns/grid';
import { seeded } from './geometry';
import { caption } from './caption';
import { inkStats, orders } from './orders';

export function harness(root: HTMLElement) {
  const query = new URLSearchParams(location.search);
  const pattern = query.get('pattern') ?? 'grid';
  root.append(
    element('h1', 'page-title', 'Hanging, in slow motion.'),
    element(
      'p',
      'muted',
      'Development harness · diagnostic image, not a submitted drawing. Click the canvas to restart.',
    ),
  );
  if (pattern !== 'grid') {
    root.append(element('p', 'banner', 'Only the grid pattern ships in v1.'));
    return () => {};
  }
  const density = input('number', 'Grid density', query.get('n') ?? '10');
  density.min = '1';
  density.max = '20';
  const seed = input('number', 'Random seed', query.get('seed') ?? '42');
  const speed = input('range', 'Playback speed', '1');
  speed.min = '.1';
  speed.max = '1';
  speed.step = '.1';
  const scrub = input('range', 'Animation time', '0');
  scrub.min = '0';
  scrub.max = '2400';
  scrub.step = '1';
  const outlines = input('checkbox', 'Piece outlines', '');
  const order = element('select');
  order.setAttribute('aria-label', 'Piece order');
  for (const name of Object.keys(orders)) {
    const option = element('option', '', name);
    option.value = name;
    order.append(option);
  }
  order.value = query.get('order') ?? 'row-major';
  if (!order.value) order.value = 'row-major';
  const canvas = element('canvas', 'harness-canvas');
  canvas.width = 1000;
  canvas.height = 600;
  const ctx = canvas.getContext('2d')!;
  const fixture = document.createElement('canvas');
  fixture.width = fixture.height = 1000;
  const ink = document.createElement('canvas');
  ink.width = ink.height = 1000;
  const inkCtx = ink.getContext('2d')!;
  inkCtx.fillStyle = '#25241f';
  inkCtx.font = '70px monospace';
  inkCtx.fillText('ANIMATION', 100, 220);
  inkCtx.fillText('TEST IMAGE', 100, 320);
  inkCtx.lineWidth = 12;
  inkCtx.strokeRect(100, 100, 800, 800);
  inkCtx.beginPath();
  inkCtx.moveTo(100, 900);
  inkCtx.lineTo(900, 100);
  inkCtx.stroke();
  const fixtureCtx = fixture.getContext('2d')!;
  fixtureCtx.fillStyle = '#fff';
  fixtureCtx.fillRect(0, 0, 1000, 1000);
  fixtureCtx.drawImage(ink, 0, 0);
  let time = 0,
    playing = true,
    frame = 0,
    last = performance.now(),
    scene: Scene;
  const description = element('p', 'placard');
  const setup = () => {
    const n = Math.max(1, Math.min(20, Math.round(+density.value) || 10));
    density.value = String(n);
    const rng = seeded(+seed.value || 42),
      pieces = grid.generate(rng, { density: n }),
      name = order.value as keyof typeof orders;
    scene = new Scene({
      pieces,
      ranks: orders[name](pieces, rng, inkStats(ink, pieces)),
      seed: +seed.value || 42,
      source: fixture,
      sourceRect: { x: 40, y: 60, width: 420, height: 420 },
    });
    description.textContent = caption(grid, pieces.length, name);
    time = 0;
  };
  setup();
  const pause = button('Pause', () => {
    playing = !playing;
    pause.textContent = playing ? 'Pause' : 'Play';
  });
  const restart = () => {
    time = 0;
    playing = true;
    pause.textContent = 'Pause';
  };
  const controls = element('div', 'harness-controls');
  controls.append(
    field('Grid density', density),
    field('Seed', seed),
    field('Order', order),
    field('Speed', speed),
    field('Time (ms)', scrub),
    field('Outlines & ranks', outlines),
    pause,
    button('Restart', restart),
  );
  root.append(controls, canvas, description);
  for (const control of [density, seed, order])
    control.addEventListener('change', setup);
  scrub.addEventListener('input', () => {
    playing = false;
    pause.textContent = 'Play';
    time = +scrub.value;
  });
  canvas.addEventListener('click', restart);
  const tick = (now: number) => {
    if (playing) time = Math.min(2400, time + (now - last) * +speed.value);
    last = now;
    ctx.clearRect(0, 0, 1000, 600);
    ctx.strokeStyle = '#b3ad9e';
    ctx.strokeRect(738, 48, 184, 184);
    scene.draw(ctx, { x: 750, y: 60, width: 160, height: 160 }, time, {
      outlines: outlines.checked,
    });
    scrub.value = String(Math.round(time));
    if (time === 2400) {
      playing = false;
      pause.textContent = 'Play';
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}
