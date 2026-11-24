import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test('M0 smoke: app boots, renders WebGL canvas with zero errors, exposes __game', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.message}`);
  });

  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__game && window.__game.ready()), { timeout: 20_000 });

  // Wait a few animation frames for WebGL render
  await page.waitForTimeout(500);

  const state = await page.evaluate(() => window.__game!.getState());
  expect(state.seed).toBeGreaterThanOrEqual(0);
  expect(state.loadedChunks).toBeGreaterThanOrEqual(1);

  // Verify canvas has non-zero dimensions and rendered pixels
  const canvasCheck = await page.evaluate(() => {
    const c = document.getElementById('game-canvas') as HTMLCanvasElement | null;
    if (!c) return { ok: false, reason: 'missing canvas' };
    return { ok: c.width > 0 && c.height > 0, width: c.width, height: c.height };
  });
  expect(canvasCheck.ok).toBe(true);

  const screenshotDir = path.resolve('docs/screenshots');
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, 'M0-smoke.png') });

  expect(errors).toEqual([]);
});
