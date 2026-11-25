import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test('M5 survival & villages: fall/drown/starve death+respawn, village screenshot & chest loot, crop growth & harvest', async ({
  page,
}) => {
  test.setTimeout(90_000);

  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.message}`);
  });

  await page.goto('/?seed=1337');
  await page.waitForFunction(() => Boolean(window.__game && window.__game.ready()), { timeout: 20_000 });
  await page.waitForFunction(() => window.__game!.getState().loadedChunks >= 20, { timeout: 25_000 });
  await page.waitForTimeout(300);

  // --- PART 1: Find nearest deterministic village, travel there, capture screenshot, open chest loot ---
  const village = await page.evaluate(() => window.__game!.findNearestVillage());
  expect(village).not.toBeNull();
  expect(village!.houseCount).toBeGreaterThanOrEqual(4);
  expect(village!.farmCount).toBeGreaterThanOrEqual(1);
  expect(village!.chests.length).toBeGreaterThanOrEqual(1);

  // Teleport to scenic elevated overlook above the village & wait for chunks around village to load
  await page.evaluate((v) => {
    const g = window.__game!;
    g.setFlying(true);
    // Set daytime noon for crisp village screenshot
    const cur = g.getState().worldTime % 24000;
    g.advanceTime((6000 - cur + 24000) % 24000);
    g.teleport(v.centerX - 18, v.baseY + 18, v.centerZ + 22);
    g.setLook(-0.68, -0.52);
  }, village!);

  // Wait until the village center and chest chunks have streamed in
  await page.waitForFunction(
    (chest) => window.__game!.getBlock(chest.x, chest.y, chest.z) === 34, // BlockId.Chest = 34
    village!.chests[0],
    { timeout: 25_000 }
  );
  await page.waitForTimeout(700);

  const screenshotDir = path.resolve('docs/screenshots');
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, 'M5-village.png') });

  // Open the village chest and verify lazy loot table populates real survival items
  const chestResult = await page.evaluate((chest) => {
    const g = window.__game!;
    g.setFlying(false);
    g.teleport(chest.x - 0.8, chest.y, chest.z + 0.5);
    const opened = g.openContainerAt(chest.x, chest.y, chest.z);
    const snap = g.getOpenContainer();
    const items = snap?.slots?.filter((s) => s !== null) ?? [];
    g.closeContainer();
    return { opened, itemCount: items.length, itemIds: items.map((s) => s!.itemId) };
  }, village!.chests[0]);

  expect(chestResult.opened).toBe(true);
  expect(chestResult.itemCount).toBeGreaterThanOrEqual(3);

  // --- PART 2: Accelerated Crop Growth & Harvest (100% legitimate player actions on village farm!) ---
  const cropResult = await page.evaluate(async (v) => {
    const g = window.__game!;
    // Find a mature CropStage3 (45) on the village farm
    let cropPos: { x: number; y: number; z: number } | null = null;
    for (let dx = -34; dx <= 34 && !cropPos; dx++) {
      for (let dz = -18; dz <= 18 && !cropPos; dz++) {
        const bx = v.centerX + dx;
        const bz = v.centerZ + dz;
        for (let by = v.baseY - 6; by <= v.baseY + 8; by++) {
          if (g.getBlock(bx, by, bz) === 45 && g.getBlock(bx, by - 1, bz) === 41) {
            cropPos = { x: bx, y: by, z: bz };
            break;
          }
        }
      }
    }
    if (!cropPos) return { ok: false, reason: 'No ripe village farm crop found' };

    const lookAt = (tx: number, ty: number, tz: number): void => {
      const p = g.getState().player;
      const dx = tx + 0.5 - p.pos.x;
      const dy = ty + 0.35 - (p.pos.y + 1.62);
      const dz = tz + 0.5 - p.pos.z;
      g.setLook(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
    };

    const countItem = (itemId: number): number =>
      g.getInventory().slots.reduce((sum, s) => (s && s.itemId === itemId ? sum + s.count : sum), 0);

    // Harvest initial ripe crop -> yields Wheat (108) + GrainSeeds (107)
    g.setFlying(false);
    g.teleport(cropPos.x + 0.5, cropPos.y + 0.05, cropPos.z + 1.2);
    lookAt(cropPos.x, cropPos.y, cropPos.z);
    await g.mineBlock(2000);
    g.teleport(cropPos.x + 0.5, cropPos.y + 0.05, cropPos.z + 0.5);
    g.stepSimulation(15);

    const wheatAfterFirst = countItem(108);
    const seedsIdx = g.getInventory().slots.findIndex((s) => s !== null && s.itemId === 107);
    if (seedsIdx < 0) return { ok: false, reason: 'No seeds dropped from crop' };

    // Equip seeds and replant CropStage0 on the hydrated FarmlandWet
    if (seedsIdx >= 9) {
      g.moveSlot({ location: 'inventory', index: seedsIdx }, { location: 'inventory', index: 0 });
      g.selectHotbar(0);
    } else {
      g.selectHotbar(seedsIdx);
    }

    g.teleport(cropPos.x + 0.5, cropPos.y + 0.05, cropPos.z + 1.2);
    lookAt(cropPos.x, cropPos.y - 1, cropPos.z);
    const planted = g.placeBlock();
    const stageAfterPlant = g.getBlock(cropPos.x, cropPos.y, cropPos.z);

    // Accelerate time so the planted CropStage0 grows all the way to CropStage3 (45)!
    for (let round = 0; round < 6 && g.getBlock(cropPos.x, cropPos.y, cropPos.z) < 45; round++) {
      g.advanceTime(1800);
    }
    const stageAfterGrow = g.getBlock(cropPos.x, cropPos.y, cropPos.z);

    // Harvest the newly grown crop!
    lookAt(cropPos.x, cropPos.y, cropPos.z);
    await g.mineBlock(2000);
    g.teleport(cropPos.x + 0.5, cropPos.y + 0.05, cropPos.z + 0.5);
    g.stepSimulation(15);
    const wheatAfterSecond = countItem(108);

    return {
      ok: planted && stageAfterPlant === 42 && stageAfterGrow === 45 && wheatAfterSecond > wheatAfterFirst,
      planted,
      stageAfterPlant,
      stageAfterGrow,
      wheatAfterFirst,
      wheatAfterSecond,
    };
  }, village!);

  expect(cropResult.ok, `Crop test failed: ${JSON.stringify(cropResult)}`).toBe(true);

  // --- PART 3: Verify Fall Death, Drown Death, and Starve Death + Respawn ---
  const deathTests = await page.evaluate((v) => {
    const g = window.__game!;
    // Set safe village road spawn point
    const safeSpawn = { x: v.centerX + 5.5, y: v.baseY + 2, z: v.centerZ + 0.5 };
    g.setSpawnPoint(safeSpawn.x, safeSpawn.y, safeSpawn.z);
    g.setFlying(false);

    // 3a) FALL DEATH -> RESPAWN
    g.teleport(safeSpawn.x, safeSpawn.y + 34, safeSpawn.z);
    g.stepSimulation(120); // ~6s fall -> hits ground at high height -> dies
    const fallState = g.getState().player;
    const fallDied = fallState.dead && fallState.health === 0;
    g.respawn();
    const afterFallRespawn = g.getState().player;

    // 3b) DROWN DEATH -> RESPAWN (use the village well's 2-deep water basin!)
    const wellWaterX = v.centerX - 1;
    const wellWaterZ = v.centerZ - 1;
    let wellWaterY = v.baseY;
    for (let y = v.baseY + 6; y >= v.baseY - 6; y--) {
      if (g.getBlock(wellWaterX, y, wellWaterZ) === 27 && g.getBlock(wellWaterX, y - 1, wellWaterZ) === 27) {
        wellWaterY = y - 1;
        break;
      }
    }
    // Teleport feet cleanly inside lower water block so eye (y + 1.62) sits inside upper water block
    g.teleport(wellWaterX + 0.5, wellWaterY + 0.05, wellWaterZ + 0.5);
    for (let batch = 0; batch < 12 && !g.getState().player.dead; batch++) {
      g.stepSimulation(80);
    }
    const drownState = g.getState().player;
    const drownDied = drownState.dead && drownState.health === 0 && drownState.oxygen === 0;
    g.respawn();
    const afterDrownRespawn = g.getState().player;

    // 3c) STARVE DEATH -> RESPAWN (sprint & jump continuously until hunger hits 0 and starvation kills player)
    g.teleport(safeSpawn.x, safeSpawn.y, safeSpawn.z);
    g.setLook(0, 0);
    g.setKey('KeyW', true);
    g.setKey('ControlLeft', true);
    g.setKey('Space', true);
    let safety = 0;
    while (!g.getState().player.dead && safety++ < 220) {
      // Bounce back inside loaded road area so we never walk off cliffs or into water
      const p = g.getState().player.pos;
      if (Math.hypot(p.x - safeSpawn.x, p.z - safeSpawn.z) > 10) {
        g.teleport(safeSpawn.x, safeSpawn.y + 1, safeSpawn.z);
      }
      g.stepSimulation(60);
    }
    g.releaseAllKeys();
    const starveState = g.getState().player;
    const starveDied = starveState.dead && starveState.health === 0 && starveState.hunger === 0;
    g.respawn();
    const afterStarveRespawn = g.getState().player;

    return {
      fallDied,
      fallRespawned: !afterFallRespawn.dead && afterFallRespawn.health === 20,
      drownDied,
      drownRespawned: !afterDrownRespawn.dead && afterDrownRespawn.health === 20 && afterDrownRespawn.oxygen === 20,
      starveDied,
      starveRespawned: !afterStarveRespawn.dead && afterStarveRespawn.health === 20 && afterStarveRespawn.hunger === 20,
      totalDeaths: afterStarveRespawn.deathCount,
    };
  }, village!);

  expect(deathTests.fallDied).toBe(true);
  expect(deathTests.fallRespawned).toBe(true);
  expect(deathTests.drownDied).toBe(true);
  expect(deathTests.drownRespawned).toBe(true);
  expect(deathTests.starveDied).toBe(true);
  expect(deathTests.starveRespawned).toBe(true);
  expect(deathTests.totalDeaths).toBeGreaterThanOrEqual(3);

  expect(errors).toEqual([]);
});
