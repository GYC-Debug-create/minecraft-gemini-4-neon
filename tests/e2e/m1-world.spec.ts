import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test('M1 world: Web Worker generates & renders textured infinite voxel terrain with free-fly', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.message}`);
  });

  await page.goto('/?seed=1337');
  await page.waitForFunction(() => Boolean(window.__game && window.__game.ready()), { timeout: 20_000 });

  // Wait for initial chunks around spawn to generate & mesh in Web Worker
  await page.waitForFunction(() => window.__game!.getState().loadedChunks >= 25, { timeout: 25_000 });
  await page.waitForTimeout(400);

  // Position camera at a scenic vantage point overlooking terrain & trees
  const startState = await page.evaluate(() => {
    const st = window.__game!.getState();
    window.__game!.setFlying(true);
    window.__game!.setLook(0.6, -0.32);
    return st;
  });

  await page.waitForTimeout(300);

  const screenshotDir = path.resolve('docs/screenshots');
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, 'M1-world.png') });

  // Fly forward across chunks to prove infinite terrain streaming
  await page.evaluate(() => {
    window.__game!.setKey('KeyW', true);
    window.__game!.setKey('ControlLeft', true);
  });
  await page.waitForTimeout(1400);
  await page.evaluate(() => {
    window.__game!.releaseAllKeys();
  });
  await page.waitForTimeout(400);

  const afterFly = await page.evaluate(() => ({
    state: window.__game!.getState(),
    perf: window.__game!.getPerfMetrics(),
  }));

  const distMoved = Math.hypot(
    afterFly.state.player.pos.x - startState.player.pos.x,
    afterFly.state.player.pos.z - startState.player.pos.z
  );
  expect(distMoved).toBeGreaterThan(8);
  expect(afterFly.perf.triangles).toBeGreaterThan(2000);
  expect(afterFly.perf.loadedChunks).toBeGreaterThanOrEqual(25);
  expect(errors).toEqual([]);
});
