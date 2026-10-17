import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
const base = process.env.SOLCOLLAB_BASE_URL ?? 'http://127.0.0.1:5173';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
  throw new Error('Only localhost fixtures are permitted.');
const output =
  process.env.SOLCOLLAB_SCREENSHOTS ??
  join(tmpdir(), 'solcollab-browser-check');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
try {
  const context = await browser.newContext({
    viewport: { width: 1360, height: 980 },
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await page.locator('.ink-layer').waitFor();
  const drawPath = new URL(page.url()).pathname;
  const draw = async () => {
    await page.locator('.ink-layer').focus();
    await page.keyboard.press('Space');
    for (let i = 0; i < 8; i++) await page.keyboard.press('Shift+ArrowRight');
    for (let i = 0; i < 8; i++) await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Space');
  };
  await draw();
  await page.route(
    '**/api/submissions',
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2800));
      await route.continue();
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.locator('.shatter-overlay').waitFor();
  await page.waitForTimeout(1200);
  await page.screenshot({
    path: `${output}/grid-fill-carry.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.waitForTimeout(1000);
  assert.match(
    await page.locator('.shatter-caption').innerText(),
    /Awaiting the curator/,
  );
  await page.keyboard.press('Enter');
  await page.waitForURL(/mine=[0-9A-HJKMNP-TV-Z]{26}/, { timeout: 15000 });
  assert.equal(await page.locator('.shatter-overlay').count(), 0);
  await page.screenshot({
    path: `${output}/grid-fill-hung.png`,
    fullPage: true,
  });
  await page.goto(`${base}${drawPath}`);
  await page.locator('.ink-layer').waitFor();
  await draw();
  await page.route(
    '**/api/submissions',
    (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Fixture: wall temporarily closed.' }),
      }),
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Submit' }).click();
  await page
    .locator('.editor-status')
    .filter({ hasText: 'Fixture: wall temporarily closed.' })
    .waitFor();
  assert.ok(await page.getByRole('button', { name: 'Submit' }).isEnabled());
  assert.equal(await page.locator('.shatter-overlay').count(), 0);
  // A retry hangs the restored drawing successfully.
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.waitForURL(/mine=[0-9A-HJKMNP-TV-Z]{26}/, { timeout: 15000 });
  // Browser Back cancels the overlay without overwriting the requested route.
  await page.goto(`${base}${drawPath}`);
  await page.locator('.ink-layer').waitFor();
  await draw();
  await page.route(
    '**/api/submissions',
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.abort().catch(() => {});
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.waitForURL(/mine=pending/);
  await page.goBack();
  await page.locator('.shatter-overlay').waitFor({ state: 'detached' });
  assert.equal(new URL(page.url()).pathname, drawPath);
  assert.ok(await page.getByRole('button', { name: 'Submit' }).isEnabled());
  if (process.env.SOLCOLLAB_TEST_TIMEOUT === 'true') {
    await page.goto(`${base}${drawPath}`);
    await page.locator('.ink-layer').waitFor();
    await draw();
    await page.route(
      '**/api/submissions',
      async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 14000));
        await route.abort().catch(() => {});
      },
      { times: 1 },
    );
    await page.getByRole('button', { name: 'Submit' }).click();
    await page
      .locator('.editor-status')
      .filter({ hasText: 'took too long' })
      .waitFor({ timeout: 17000 });
    assert.ok(await page.getByRole('button', { name: 'Submit' }).isEnabled());
  }
  await page.goto(`${base}/dev/shatter?pattern=grid&order=by-ink&seed=42&n=6`);
  await page.locator('.harness-canvas').waitFor();
  await page.getByLabel('Piece outlines').check();
  await page.getByLabel('Animation time').evaluate((node) => {
    (node as HTMLInputElement).value = '1500';
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.screenshot({ path: `${output}/harness.png`, fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'Animation checks passed: carry, remeasure on resize, upload hold, skip, hang, failure restore, retry, and harness.',
  );
} finally {
  await browser.close();
}
