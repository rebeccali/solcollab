import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';

const base = process.env.SOLCOLLAB_BASE_URL ?? 'http://127.0.0.1:5173';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
  throw new Error('Browser fixtures are restricted to localhost.');
const output =
  process.env.SOLCOLLAB_SCREENSHOTS ??
  join(tmpdir(), 'solcollab-browser-check');
await mkdir(output, { recursive: true });
const browserType = { chromium, firefox, webkit }[
  process.env.SOLCOLLAB_BROWSER ?? 'chromium'
];
if (!browserType) throw new Error('Unknown test browser.');
const browser = await browserType.launch({
  headless: true,
  ...(browserType === chromium &&
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1360, height: 980 },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.goto(base);
  await page.locator('.ink-layer').waitFor();
  assert.match(new URL(page.url()).pathname, /^\/draw\//);
  const drawPath = new URL(page.url()).pathname;
  const canvas = page.locator('.ink-layer'),
    box = (await canvas.boundingBox())!;
  assert.ok(
    await page.getByRole('button', { name: 'Hang on the wall' }).isDisabled(),
  );
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7, {
    steps: 30,
  });
  await page.mouse.up();
  await page.getByLabel('Background color').fill('#f2c230');
  await page.getByLabel('Background color').dispatchEvent('change');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(
    await page.getByLabel('Background color').inputValue(),
    '#ffffff',
  );
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.reload();
  await page.locator('.ink-layer').waitFor();
  assert.equal(
    await page.getByLabel('Background color').inputValue(),
    '#f2c230',
  );
  await page
    .getByLabel('Sign it (optional)', { exact: true })
    .fill('<b>Browser fixture</b>');
  await page.screenshot({ path: `${output}/draw-desktop.png`, fullPage: true });
  await page.getByRole('button', { name: 'Hang on the wall' }).click();
  await page.waitForURL(/\/p\/.+\?mine=[0-9A-HJKMNP-TV-Z]{26}/, {
    timeout: 20000,
  });
  await page.locator('#mine-slot img').waitFor();
  const galleryUrl = page.url();
  const id = new URL(galleryUrl).searchParams.get('mine')!;
  const row = await (
    await page.request.get(`${base}/api/submissions/${id}`)
  ).json();
  assert.ok(row.strokes_url);
  assert.equal(row.background, '#f2c230');
  assert.equal(
    await page.locator('#mine-slot b').count(),
    0,
    'display names are text, never HTML',
  );
  await page.locator('#mine-slot .tile-art').click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: '▶ Replay' }).click();
  await page.locator('.replay-canvas').waitFor();
  await page.waitForTimeout(5300);
  const progress = await page
    .locator('.replay-controls progress')
    .getAttribute('value');
  assert.equal(Number(progress), 5000);
  const meanError = await page
    .locator('.replay-canvas')
    .evaluate(async (canvas, url) => {
      const actual = (canvas as HTMLCanvasElement)
        .getContext('2d')!
        .getImageData(0, 0, 1000, 1000).data;
      const image = await createImageBitmap(await (await fetch(url)).blob());
      const reference = document.createElement('canvas');
      reference.width = reference.height = 1000;
      const ctx = reference.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      const expected = ctx.getImageData(0, 0, 1000, 1000).data;
      image.close();
      let error = 0;
      for (let i = 0; i < actual.length; i++)
        error += Math.abs(actual[i]! - expected[i]!);
      return error / actual.length;
    }, row.full_url);
  assert.ok(
    meanError < 3.5,
    `Replay pixel difference ${meanError} exceeds the WebP tolerance.`,
  );
  await page.getByRole('button', { name: 'Close ×' }).click();
  await page.getByLabel('Gallery order').selectOption('random');
  await page.getByRole('button', { name: 'Shuffle again' }).click();
  await page.screenshot({
    path: `${output}/gallery-desktop.png`,
    fullPage: true,
  });
  await page
    .getByRole('link', { name: 'Explore prompts', exact: true })
    .click();
  await page.locator('.prompt-card').first().waitFor();
  await page.getByRole('link', { name: 'Past walls', exact: true }).click();
  await page.locator('.prompt-card').first().waitFor();
  await page.goto(`${base}${drawPath}`);
  await page.locator('.ink-layer').waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  const mobileCanvas = (await page.locator('.ink-layer').boundingBox())!;
  assert.ok(mobileCanvas.width > 100);
  await page.screenshot({ path: `${output}/draw-mobile.png`, fullPage: true });
  for (const viewport of [
    { width: 375, height: 667 },
    { width: 360, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(100);
    assert.ok(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth &&
          document.documentElement.scrollHeight <= innerHeight + 1,
      ),
      'The editor should fit the phone viewport.',
    );
  }
  // Keyboard-only users can make a mark and submit.
  await page.locator('.ink-layer').focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  assert.ok(
    await page.getByRole('button', { name: 'Hang on the wall' }).isEnabled(),
  );
  await page.getByRole('button', { name: 'Hang on the wall' }).click();
  await page.waitForURL(/\/p\/.+\?mine=[0-9A-HJKMNP-TV-Z]{26}/, {
    timeout: 20000,
  });
  await page.locator('#mine-slot img').waitFor();
  if (browserType === chromium) {
    const touchContext = await browser.newContext({
      hasTouch: true,
      viewport: { width: 390, height: 844 },
      reducedMotion: 'reduce',
    });
    const touch = await touchContext.newPage();
    await touch.goto(`${base}${drawPath}`);
    await touch.locator('.ink-layer').waitFor();
    await touch.locator('.ink-layer').tap();
    await touch.getByRole('button', { name: 'Hang on the wall' }).tap();
    await touch.waitForURL(/mine=[0-9A-HJKMNP-TV-Z]{26}/);
    const touchId = new URL(touch.url()).searchParams.get('mine');
    const touchRow = await (
      await touch.request.get(`${base}/api/submissions/${touchId}`)
    ).json();
    assert.equal(touchRow.input_type, 'touch');
    await touchContext.close();
    const pen = await context.newPage();
    await pen.goto(`${base}${drawPath}`);
    await pen.locator('.ink-layer').waitFor();
    assert.equal(
      await pen.getByLabel('Pen pressure', { exact: true }).count(),
      0,
    );
    const penBox = (await pen.locator('.ink-layer').boundingBox())!;
    const cdp = await context.newCDPSession(pen);
    const x = penBox.x + penBox.width * 0.3,
      y = penBox.y + penBox.height * 0.3;
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
      pointerType: 'pen',
      force: 0.1,
    });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: x + 40,
      y: y + 40,
      buttons: 1,
      pointerType: 'pen',
      force: 0.9,
    });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: x + 40,
      y: y + 40,
      button: 'left',
      buttons: 0,
      clickCount: 1,
      pointerType: 'pen',
    });
    await pen.getByRole('button', { name: 'Hang on the wall' }).click();
    await pen.waitForURL(/mine=[0-9A-HJKMNP-TV-Z]{26}/);
    const penId = new URL(pen.url()).searchParams.get('mine');
    const penRow = await (
      await pen.request.get(`${base}/api/submissions/${penId}`)
    ).json();
    const penDrawing = await (
      await pen.request.get(`${base}${penRow.strokes_url}`)
    ).json();
    assert.equal(penRow.input_type, 'pen');
    assert.ok(
      penDrawing.strokes.every((stroke: { points: number[][] }) =>
        stroke.points.every((point) => point[2] === 1),
      ),
      'Pen pressure must not change stroke width.',
    );
    await cdp.detach();
    await pen.close();
  }
  await page.goto(`${base}/about`);
  await page
    .getByRole('heading', { name: 'One instruction. Many interpretations.' })
    .waitFor();
  assert.equal(
    await page.getByRole('heading', { name: 'Contact & takedowns' }).count(),
    0,
  );
  assert.equal(await page.locator('a[href^="mailto:"]').count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    'Browser checks passed: draw, background undo/redo, draft restore, submit, pinning, lightbox, replay, sort, explore, walls, mobile, keyboard.',
  );
} finally {
  await browser.close();
}
