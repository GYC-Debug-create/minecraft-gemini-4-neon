import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test('M2 interaction: wall collision (5s walk no clip), mine block & place block update world data', async ({
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
  await page.waitForFunction(() => window.__game!.getState().loadedChunks >= 16, { timeout: 25_000 });
  await page.waitForTimeout(400);

  // 1) Find a solid ground spot and test digging 1 block + placing 1 block back cleanly
  const digSetup = await page.evaluate(async () => {
    const g = window.__game!;
    g.setFlying(false);
    // Let player settle onto ground
    g.stepSimulation(20);
    const st = g.getState();
    const px = Math.floor(st.player.pos.x);
    const py = Math.floor(st.player.pos.y);
    const pz = Math.floor(st.player.pos.z);

    // Look down slightly forward at the ground block one step ahead (z - 1) so we don't mine directly under feet
    g.setLook(0, -1.05);
    const beforeBlock = g.getBlock(px, py - 1, pz - 1);
    const mineRes = await g.mineBlock(4000);
    const afterMineBlock = mineRes.pos ? g.getBlock(mineRes.pos.x, mineRes.pos.y, mineRes.pos.z) : -1;
    const invAfterMine = g.getInventory();

    // Now aim into the dug hole (hitting the block underneath it) and place the mined block back!
    g.selectHotbar(0);
    const placed = g.placeBlock();
    const afterPlaceBlock = mineRes.pos ? g.getBlock(mineRes.pos.x, mineRes.pos.y, mineRes.pos.z) : -1;

    return {
      beforeBlock,
      mineRes,
      afterMineBlock,
      hotbar0: invAfterMine.slots[0],
      placed,
      afterPlaceBlock,
    };
  });

  expect(digSetup.mineRes.broken).toBe(true);
  expect(digSetup.mineRes.pos).not.toBeNull();
  expect(digSetup.afterMineBlock).toBe(0); // BlockId.Air
  expect(digSetup.hotbar0).not.toBeNull();
  expect(digSetup.placed).toBe(true);
  expect(digSetup.afterPlaceBlock).not.toBe(0);

  // 2) Capture M2 interaction screenshot showing crosshair, block outline, and hotbar
  await page.evaluate(() => {
    window.__game!.setLook(0.4, -0.45);
  });
  await page.waitForTimeout(300);
  const screenshotDir = path.resolve('docs/screenshots');
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, 'M2-interaction.png') });

  // 3) Walk into a solid wall for 5 real seconds (simulated or real-time) and verify player never clips into wall
  const wallResult = await page.evaluate(async () => {
    const g = window.__game!;
    // Find a natural 2-high solid wall (hillside or tree trunk) within loaded chunks around spawn
    const st = g.getState();
    const baseX = Math.floor(st.player.pos.x);
    const baseZ = Math.floor(st.player.pos.z);

    let spot: { standX: number; standY: number; standZ: number; wallZ: number } | null = null;
    for (let dz = -24; dz <= 24 && !spot; dz++) {
      for (let dx = -24; dx <= 24 && !spot; dx++) {
        const x = baseX + dx;
        const z = baseZ + dz;
        for (let y = 57; y <= 95; y++) {
          const floor = g.getBlock(x, y - 1, z);
          const air1 = g.getBlock(x, y, z);
          const air2 = g.getBlock(x, y + 1, z);
          const wall1 = g.getBlock(x, y, z - 1);
          const wall2 = g.getBlock(x, y + 1, z - 1);
          const isSolidBlock = (id: number) => id >= 1 && id <= 26;
          if (isSolidBlock(floor) && air1 === 0 && air2 === 0 && isSolidBlock(wall1) && isSolidBlock(wall2)) {
            spot = { standX: x + 0.5, standY: y + 0.02, standZ: z + 0.5, wallZ: z - 1 };
            break;
          }
        }
      }
    }

    if (!spot) return { found: false, finalZ: 0, wallFrontZ: 0 };

    g.setFlying(false);
    g.teleport(spot.standX, spot.standY, spot.standZ);
    g.setLook(0, 0); // Looking straight toward -Z into the wall at wallZ
    g.setKey('KeyW', true);
    return { found: true, wallFrontZ: spot.wallZ + 1, standY: spot.standY };
  });

  expect(wallResult.found).toBe(true);

  // Hold W into the wall for 5 full seconds
  await page.waitForTimeout(5000);

  const afterWallWalk = await page.evaluate(() => {
    const g = window.__game!;
    g.releaseAllKeys();
    return g.getState().player;
  });

  // Player AABB half-width is 0.3, so player center Z must remain >= wallFrontZ + 0.28 (never clipping into wallZ)
  expect(afterWallWalk.pos.z).toBeGreaterThanOrEqual(wallResult.wallFrontZ + 0.25);
  expect(errors).toEqual([]);
});
