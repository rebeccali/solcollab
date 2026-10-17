import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.SOLCOLLAB_BASE_URL ?? 'http://127.0.0.1:5173';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
  throw new Error('Browser fixtures are restricted to localhost.');
const output =
  process.env.SOLCOLLAB_SCREENSHOTS ?? '/private/tmp/solcollab-browser-check';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
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
  await page.waitForURL(/\/p\/.+\?mine=/, { timeout: 20000 });
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
  await page.waitForURL(/\/p\//, { timeout: 20000 });
  await page.locator('#mine-slot img').waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'Browser checks passed: draw, background undo/redo, draft restore, submit, pinning, lightbox, replay, sort, explore, walls, mobile, keyboard.',
  );
} finally {
  await browser.close();
}
