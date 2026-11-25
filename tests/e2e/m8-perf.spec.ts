import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test('M8 performance & polish: render distance 8 metrics, chunk-crossing JS time < 8ms, and final panorama screenshot', async ({
  page,
}) => {
  test.setTimeout(120_000);

  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.message}`);
  });

  await page.goto('/?seed=1337');
  await page.waitForFunction(() => Boolean(window.__game && window.__game.ready()), { timeout: 20_000 });

  // Explicitly configure Render Distance = 8 (SPEC Section 4 target)
  await page.evaluate(() => {
    const g = window.__game!;
    g.setSettings({ renderDistance: 8, fov: 78 });
    const st = g.getState();
    g.setFlying(true);
    g.teleport(st.player.pos.x, st.player.pos.y + 18, st.player.pos.z);
    g.setLook(0.45, -0.26);
  });

  // Wait until render distance 8 circle (~197 chunks) finishes streaming in
  await page.waitForFunction(
    () => (window.__game?.getPerfMetrics().loadedChunks ?? 0) >= 180,
    null,
    { timeout: 60_000 }
  );
  // Let pending background remeshes settle before steady-state measurement
  await page.waitForTimeout(1500);

  // Measure steady-state per-frame main-thread JS time (excluding GPU) over 30 RAF frames
  const steady = await page.evaluate(async () => {
    const g = window.__game!;
    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      samples.push(g.getPerfMetrics().frameJsMs);
    }
    const perf = g.getPerfMetrics();
    const sorted = [...samples].sort((a, b) => a - b);
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    const max = sorted[sorted.length - 1];
    return {
      loadedChunks: perf.loadedChunks,
      drawCalls: perf.drawCalls,
      triangles: perf.triangles,
      chunkGenAvgMs: Number(perf.chunkGenAvgMs.toFixed(2)),
      chunkMeshAvgMs: Number(perf.chunkMeshAvgMs.toFixed(2)),
      fpsReference: perf.fps,
      steadyAvgJsMs: Number(avg.toFixed(2)),
      steadyP95JsMs: Number(p95.toFixed(2)),
      steadyMaxJsMs: Number(max.toFixed(2)),
    };
  });

  // Capture M8 final scenic panorama at render distance 8 with F3 telemetry visible
  await page.keyboard.press('F3');
  await page.waitForTimeout(600);
  const screenshotDir = path.resolve('docs/screenshots');
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, 'M8-final.png') });
  await page.keyboard.press('F3');

  // Measure chunk-border crossing main-thread JS time while flying rapidly across 4+ chunk borders (> 64 blocks)
  const crossing = await page.evaluate(async () => {
    const g = window.__game!;
    const startPos = g.getState().player.pos;
    g.setLook(0, -0.2); // face -Z cleanly
    g.setKey('KeyW', true);
    g.setKey('ControlLeft', true);

    const samples: number[] = [];
    let chunksCrossed = 0;
    let lastCx = Math.floor(startPos.x / 16);
    let lastCz = Math.floor(startPos.z / 16);

    for (let i = 0; i < 55; i++) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      // Advance smoothly at sprint-fly speed (~1.6 blocks per frame -> crosses ~5+ chunk borders)
      const p = g.getState().player.pos;
      g.teleport(p.x, p.y, p.z - 1.6);
      const cx = Math.floor(p.x / 16);
      const cz = Math.floor((p.z - 1.6) / 16);
      if (cx !== lastCx || cz !== lastCz) {
        chunksCrossed++;
        lastCx = cx;
        lastCz = cz;
      }
      samples.push(g.getPerfMetrics().frameJsMs);
    }

    g.releaseAllKeys();
    const sorted = [...samples].sort((a, b) => a - b);
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    const max = sorted[sorted.length - 1];
    const perfAfter = g.getPerfMetrics();
    return {
      chunksCrossed,
      crossAvgJsMs: Number(avg.toFixed(2)),
      crossP95JsMs: Number(p95.toFixed(2)),
      crossMaxJsMs: Number(max.toFixed(2)),
      loadedChunksAfter: perfAfter.loadedChunks,
      chunkGenAvgMsAfter: Number(perfAfter.chunkGenAvgMs.toFixed(2)),
      chunkMeshAvgMsAfter: Number(perfAfter.chunkMeshAvgMs.toFixed(2)),
    };
  });

  const summary = { ...steady, ...crossing };
  console.log('[M8_PERF_METRICS]', JSON.stringify(summary));

  // SPEC Section 4 assertions
  expect(steady.loadedChunks).toBeGreaterThanOrEqual(180);
  expect(steady.drawCalls).toBeGreaterThan(0);
  expect(steady.triangles).toBeGreaterThan(0);
  expect(steady.chunkGenAvgMs).toBeGreaterThan(0);
  expect(steady.chunkMeshAvgMs).toBeGreaterThan(0);
  expect(steady.steadyAvgJsMs, `Steady-state JS frame time exceeded 8ms: ${JSON.stringify(summary)}`).toBeLessThan(8.0);
  expect(crossing.chunksCrossed).toBeGreaterThanOrEqual(4);
  expect(crossing.crossAvgJsMs, `Chunk-crossing avg JS frame time exceeded 8ms: ${JSON.stringify(summary)}`).toBeLessThan(8.0);
  expect(errors).toEqual([]);
});
