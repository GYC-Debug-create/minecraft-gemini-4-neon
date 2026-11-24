import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test('M3 lighting & sky: noon, dusk, midnight, and underground cave torch screenshots + light telemetry', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.message}`);
  });

  await page.goto('/?seed=1337');
  await page.waitForFunction(() => Boolean(window.__game && window.__game.ready()), { timeout: 20_000 });
  await page.waitForFunction(() => window.__game!.getState().loadedChunks >= 25, { timeout: 25_000 });
  await page.waitForTimeout(500);

  const screenshotDir = path.resolve('docs/screenshots');
  fs.mkdirSync(screenshotDir, { recursive: true });

  // Helper to jump to exact time-of-day (0=sunrise, 6000=noon, 12000=dusk, 18000=midnight)
  const setTimeOfDay = async (targetTick: number): Promise<void> => {
    await page.evaluate((target) => {
      const g = window.__game!;
      const cur = g.getState().worldTime % 24000;
      const delta = (target - cur + 24000) % 24000;
      g.advanceTime(delta);
    }, targetTick);
    await page.waitForTimeout(350);
  };

  // Position scenic overlook for Noon, Dusk, and Midnight
  await page.evaluate(() => {
    const g = window.__game!;
    const st = g.getState();
    g.setFlying(true);
    g.teleport(st.player.pos.x, st.player.pos.y + 14, st.player.pos.z);
    g.setLook(-1.45, -0.15); // Facing toward sun/horizon arc
  });

  // 1) Noon (6000)
  await setTimeOfDay(6000);
  await page.screenshot({ path: path.join(screenshotDir, 'M3-noon.png') });

  // 2) Dusk (11750 - warm golden-amber sunset with sun hovering right above horizon)
  await setTimeOfDay(11750);
  await page.screenshot({ path: path.join(screenshotDir, 'M3-dusk.png') });

  // 3) Midnight (18000 - starry dark night sky)
  await setTimeOfDay(18000);
  await page.screenshot({ path: path.join(screenshotDir, 'M3-midnight.png') });

  // 4) Cave Torch: pick up the Spawn Waystone Torch legitimately via mining, enter a dark underground cave, place torch!
  const caveResult = await page.evaluate(async () => {
    const g = window.__game!;
    const st = g.getState();
    const spawnX = Math.floor(st.player.spawnPoint.x);
    const spawnZ = Math.floor(st.player.spawnPoint.z);

    // Locate the Spawn Waystone Torch (BlockId.Torch === 35) near spawn
    let torchPos: { x: number; y: number; z: number } | null = null;
    for (let dx = -4; dx <= 4 && !torchPos; dx++) {
      for (let dz = -4; dz <= 4 && !torchPos; dz++) {
        for (let y = 55; y <= 90; y++) {
          if (g.getBlock(spawnX + dx, y, spawnZ + dz) === 35) {
            torchPos = { x: spawnX + dx, y, z: spawnZ + dz };
            break;
          }
        }
      }
    }
    if (!torchPos) return { ok: false, reason: 'No spawn waystone torch found' };

    // Stand beside the torch, look at it, and mine it legitimately
    g.setFlying(false);
    g.teleport(torchPos.x + 0.5, torchPos.y, torchPos.z + 1.5);
    g.setLook(0, -0.82);
    const mined = await g.mineBlock(2000);
    if (!mined.broken) {
      // Try aiming slightly steeper at torch center
      g.setLook(0, -0.72);
      const retry = await g.mineBlock(2000);
      if (!retry.broken) return { ok: false, reason: 'Failed to mine spawn torch' };
    }

    // Find a dark underground cave pocket (skyLight === 0, at least 3x3x3 air cavity) inside loaded chunks
    let caveSpot: { x: number; y: number; z: number } | null = null;
    for (let dx = -24; dx <= 24 && !caveSpot; dx++) {
      for (let dz = -24; dz <= 24 && !caveSpot; dz++) {
        const cx = spawnX + dx;
        const cz = spawnZ + dz;
        for (let y = 18; y <= 46; y++) {
          const floor = g.getBlock(cx, y - 1, cz);
          const a0 = g.getBlock(cx, y, cz);
          const a1 = g.getBlock(cx, y + 1, cz);
          const frontFloor = g.getBlock(cx, y - 1, cz - 2);
          const frontAir0 = g.getBlock(cx, y, cz - 2);
          const frontAir1 = g.getBlock(cx, y + 1, cz - 2);
          const midAir0 = g.getBlock(cx, y, cz - 1);
          const midAir1 = g.getBlock(cx, y + 1, cz - 1);
          const l = g.getLight(cx, y, cz - 2);
          if (
            floor > 0 &&
            floor !== 27 &&
            frontFloor > 0 &&
            frontFloor !== 27 &&
            a0 === 0 &&
            a1 === 0 &&
            midAir0 === 0 &&
            midAir1 === 0 &&
            frontAir0 === 0 &&
            frontAir1 === 0 &&
            l.sky === 0 &&
            l.block === 0
          ) {
            caveSpot = { x: cx, y, z: cz };
            break;
          }
        }
      }
    }
    if (!caveSpot) return { ok: false, reason: 'No dark cave cavity found near spawn' };

    const lightBefore = g.getLight(caveSpot.x, caveSpot.y, caveSpot.z - 2);

    // Move into cave, look down at cave floor 2 blocks ahead, and place our mined Pitch Torch
    g.teleport(caveSpot.x + 0.5, caveSpot.y + 0.05, caveSpot.z + 0.5);
    g.setLook(0, -0.72);

    // Select hotbar slot containing Torch
    const inv = g.getInventory();
    const torchSlot = inv.slots.findIndex((s) => s !== null && s.itemId === 20); // ItemId.Torch = 20
    if (torchSlot >= 0 && torchSlot < 9) g.selectHotbar(torchSlot);
    else g.selectHotbar(0);

    const placed = g.placeBlock();
    const lightAtTorchArea = g.getLight(caveSpot.x, caveSpot.y, caveSpot.z - 2);
    const lightNearPlayer = g.getLight(caveSpot.x, caveSpot.y, caveSpot.z);

    // Look slightly up so the torch & illuminated rock cave walls frame nicely in the screenshot
    g.setLook(0, -0.35);

    return {
      ok: true,
      placed,
      lightBefore,
      lightAtTorchArea,
      lightNearPlayer,
    };
  });

  expect(caveResult.ok).toBe(true);
  expect(caveResult.placed).toBe(true);
  expect(caveResult.lightBefore!.sky).toBe(0);
  expect(caveResult.lightBefore!.block).toBe(0);
  expect(Math.max(caveResult.lightAtTorchArea!.block, caveResult.lightNearPlayer!.block)).toBeGreaterThanOrEqual(11);

  // Wait for priority worker remesh so cave walls render warmly lit by the placed torch
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(screenshotDir, 'M3-cave-torch.png') });

  // Verify the rendered cave screenshot actually has warm torch-lit pixels (not pitch black!)
  const litPixelCheck = await page.evaluate(() => {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    const tmp = document.createElement('canvas');
    tmp.width = 160;
    tmp.height = 90;
    const ctx = tmp.getContext('2d')!;
    ctx.drawImage(canvas, 0, 0, 160, 90);
    const data = ctx.getImageData(20, 20, 120, 55).data;
    let brightPixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 45 || data[i + 1] > 35) brightPixels++;
    }
    return brightPixels;
  });
  expect(litPixelCheck).toBeGreaterThan(200);

  expect(errors).toEqual([]);
});
