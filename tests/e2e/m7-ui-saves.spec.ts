import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test('M7 UI & IndexedDB saves: settings persist, terrain + inventory + chest persist across reload, F3 debug visible', async ({
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

  const screenshotDir = path.resolve('docs/screenshots');
  fs.mkdirSync(screenshotDir, { recursive: true });

  // 1) Open bare root "/" -> Main Menu visible (defaults to Chinese, supports instant ZH/EN switching)
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__game && window.__game.ready()), { timeout: 20_000 });
  await expect(page.locator('#main-menu')).toBeVisible();
  await expect(page.locator('#btn-new-world')).toHaveText('创建新世界');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(screenshotDir, 'M7-main-menu.png') });

  // Toggle to English & back to Chinese via quick toggle button
  await page.click('#btn-lang-toggle');
  await expect(page.locator('#btn-new-world')).toHaveText('Create New World');
  await page.click('#btn-lang-toggle');
  await expect(page.locator('#btn-new-world')).toHaveText('创建新世界');

  // 2) Change settings via Settings modal & verify persistence across reload
  await page.click('#btn-main-settings');
  await expect(page.locator('#settings-modal')).toBeVisible();
  await page.locator('#setting-fov').fill('88');
  await page.locator('#setting-fov').dispatchEvent('input');
  await page.locator('#setting-render-dist').fill('6');
  await page.locator('#setting-render-dist').dispatchEvent('input');
  await page.click('#btn-settings-done');
  await page.waitForTimeout(250);

  // Start new world via Main Menu UI with seed 1337
  await page.fill('#input-world-seed', '1337');
  await page.click('#btn-new-world');
  await expect(page.locator('#main-menu')).toBeHidden();
  await page.waitForFunction(() => window.__game!.getState().loadedChunks >= 16, { timeout: 25_000 });
  await page.waitForTimeout(300);

  // 3) Perform legitimate terrain edit + craft Chest + store items in Chest + keep items in Inventory
  const beforeSave = await page.evaluate(async () => {
    const g = window.__game!;
    g.setFlying(false);
    g.stepSimulation(15);
    const st0 = g.getState();
    const sx = Math.floor(st0.player.pos.x);
    const sz = Math.floor(st0.player.pos.z);

    const lookAt = (tx: number, ty: number, tz: number): void => {
      const p = g.getState().player;
      const dx = tx + 0.5 - p.pos.x;
      const dy = ty + 0.5 - (p.pos.y + 1.62);
      const dz = tz + 0.5 - p.pos.z;
      g.setLook(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
    };

    const countItem = (itemId: number): number =>
      g.getInventory().slots.reduce((sum, s) => (s && s.itemId === itemId ? sum + s.count : sum), 0);

    const equipItem = (itemId: number): boolean => {
      const inv = g.getInventory();
      const idx = inv.slots.findIndex((s) => s !== null && s.itemId === itemId);
      if (idx < 0) return false;
      if (idx < 9) {
        g.selectHotbar(idx);
        return true;
      }
      g.moveSlot({ location: 'inventory', index: idx }, { location: 'inventory', index: 0 });
      g.selectHotbar(0);
      return true;
    };

    // Punch 5 tree logs -> 20 planks -> Workbench (4) + Chest (8) + 8 planks remaining
    for (let i = 0; i < 14 && countItem(10) + countItem(11) + countItem(12) < 5; i++) {
      let found: { bx: number; by: number; bz: number; px: number; py: number; pz: number } | null = null;
      for (let r = 1; r <= 32 && !found; r++) {
        for (let dz = -r; dz <= r && !found; dz++) {
          for (let dx = -r; dx <= r && !found; dx++) {
            if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
            const bx = sx + dx;
            const bz = sz + dz;
            for (let by = 92; by >= 58; by--) {
              const b = g.getBlock(bx, by, bz);
              if (b !== 17 && b !== 18 && b !== 19) continue;
              for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                if (g.getBlock(bx + ox, by - 1, bz + oz) > 0 && g.getBlock(bx + ox, by, bz + oz) === 0 && g.getBlock(bx + ox, by + 1, bz + oz) === 0) {
                  found = { bx, by, bz, px: bx + ox, py: by, pz: bz + oz };
                  break;
                }
              }
              if (found) break;
            }
          }
        }
      }
      if (!found) break;
      g.teleport(found.px + 0.5, found.py + 0.02, found.pz + 0.5);
      lookAt(found.bx, found.by, found.bz);
      const m = await g.mineBlock(4000);
      if (m.broken) {
        g.teleport(found.bx + 0.5, found.py + 0.02, found.bz + 0.5);
        g.stepSimulation(12);
      }
    }

    while (countItem(10) > 0) g.craft('oak_planks', false);
    while (countItem(11) > 0) g.craft('birch_planks', false);
    while (countItem(12) > 0) g.craft('pine_planks', false);
    g.craft('workbench', false);

    const isSolidSurface = (b: number): boolean => b > 0 && (b < 27 || b > 31);

    // Find clear ground column at (sx, sz - 2)
    const bx = sx;
    const bz = sz - 2;
    let groundY = Math.floor(st0.player.pos.y) + 4;
    while (!isSolidSurface(g.getBlock(bx, groundY, bz)) && groundY > 50) groundY--;

    // Place Workbench at (bx, groundY + 1, bz)
    g.setFlying(true);
    g.teleport(bx + 0.5, groundY + 3.2, bz + 0.5);
    equipItem(17);
    lookAt(bx, groundY, bz);
    g.placeBlock();

    // Craft Chest at Workbench
    g.setFlying(false);
    g.teleport(bx + 0.5, groundY + 1.05, bz + 1.5);
    g.openContainerAt(bx, groundY + 1, bz);
    const craftedChest = g.craft('chest', true);
    g.closeContainer();

    // Place Chest at (bx + 1, chestFloorY + 1, bz)
    const chestX = bx + 1;
    const chestZ = bz;
    let chestFloorY = groundY + 3;
    while (!isSolidSurface(g.getBlock(chestX, chestFloorY, chestZ)) && chestFloorY > 50) chestFloorY--;
    const chestY = chestFloorY + 1;
    g.setFlying(true);
    g.teleport(chestX + 0.5, chestY + 2.2, chestZ + 0.5);
    equipItem(19); // ItemId.Chest = 19
    lookAt(chestX, chestFloorY, chestZ);
    const placedChest = g.placeBlock();

    // Dig a solid terrain block right beside workbench at (bx - 1, digY, bz) so terrain edit is unmistakable
    const digX = bx - 1;
    const digZ = bz;
    let digY = groundY + 3;
    while (!isSolidSurface(g.getBlock(digX, digY, digZ)) && digY > 50) digY--;
    g.setFlying(true);
    g.teleport(digX + 0.5, digY + 2.2, digZ + 0.5);
    // Clear any tall grass above digY first if present
    if (g.getBlock(digX, digY + 1, digZ) !== 0) {
      lookAt(digX, digY + 1, digZ);
      await g.mineBlock(1000);
    }
    lookAt(digX, digY, digZ);
    await g.mineBlock(3000);

    // Open Chest and move half of our planks stack into chest slot 0 (leaving planks in BOTH chest AND player inventory!)
    g.setFlying(false);
    g.teleport(chestX + 0.5, chestY + 0.05, chestZ + 1.4);
    const openedChest = g.openContainerAt(chestX, chestY, chestZ);
    const plankSlotIdx = g
      .getInventory()
      .slots.findIndex((s) => s !== null && (s.itemId === 13 || s.itemId === 14 || s.itemId === 15));
    let movedToChest = false;
    if (openedChest && plankSlotIdx >= 0) {
      movedToChest = g.moveSlot(
        { location: 'inventory', index: plankSlotIdx },
        { location: 'chest', index: 0 },
        true // right-click split half!
      );
    }
    const chestSnapBefore = g.getOpenContainer();
    g.closeContainer();

    // Frame a clean scenic view of the placed Workbench, Chest, dug hole, and surrounding forest
    g.teleport(bx + 0.6, groundY + 1.05, bz + 3.2);
    g.stepSimulation(20); // settle ground & pick up any nearby dropped item before snapshotting
    lookAt(bx + 0.3, groundY + 1.1, bz);

    return {
      ok: craftedChest && placedChest && openedChest && movedToChest,
      benchPos: { x: bx, y: groundY + 1, z: bz },
      chestPos: { x: chestX, y: chestY, z: chestZ },
      digPos: { x: digX, y: digY, z: digZ },
      digBlockBefore: g.getBlock(digX, digY, digZ),
      benchBlockBefore: g.getBlock(bx, groundY + 1, bz),
      chestBlockBefore: g.getBlock(chestX, chestY, chestZ),
      chestSlotsBefore: chestSnapBefore?.slots ?? [],
    };
  });

  expect(beforeSave.ok, `Save prep failed: ${JSON.stringify(beforeSave)}`).toBe(true);
  expect(beforeSave.digBlockBefore).toBe(0);
  expect(beforeSave.benchBlockBefore).toBe(32); // Workbench
  expect(beforeSave.chestBlockBefore).toBe(34); // Chest
  expect(beforeSave.chestSlotsBefore[0]).not.toBeNull();

  // 4) Toggle F3 Debug Panel and capture M7 UI screenshot
  await page.keyboard.press('F3');
  await expect(page.locator('#f3-debug-overlay')).toBeVisible();
  await page.waitForTimeout(600); // Wait for 500ms HUD refresh tick so F3 text populates
  const f3Text = await page.locator('#f3-debug-overlay').textContent();
  expect(f3Text).toContain('FPS:');
  expect(f3Text).toContain('Chunk:');
  expect(f3Text).toContain('Biome:');
  expect(f3Text).toContain('Light:');
  expect(f3Text).toContain('Facing:');

  // Save right before capturing screenshot & reloading so saved inventory snapshot matches exact reload state
  const invBefore = await page.evaluate(async () => {
    const g = window.__game!;
    await g.saveNow();
    return g.getInventory();
  });

  await page.screenshot({ path: path.join(screenshotDir, 'M7-ui-save.png') });

  // 5) Reload the browser page completely -> verify settings persisted & click Continue World!
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__game && window.__game.ready()), { timeout: 20_000 });
  await expect(page.locator('#main-menu')).toBeVisible();
  await expect(page.locator('#btn-continue-world')).toBeEnabled();

  const settingsAfterReload = await page.evaluate(() => window.__game!.getSettings());
  expect(settingsAfterReload.fov).toBe(88);
  expect(settingsAfterReload.renderDistance).toBe(6);

  await page.click('#btn-continue-world');
  await expect(page.locator('#main-menu')).toBeHidden();
  await page.waitForFunction(
    (cp) => window.__game!.getBlock(cp.x, cp.y, cp.z) === 34,
    beforeSave.chestPos,
    { timeout: 20_000 }
  );
  await page.waitForTimeout(300);

  // 6) Verify terrain edits, player inventory, AND chest contents match 100% identically!
  const afterReload = await page.evaluate((prev) => {
    const g = window.__game!;
    const opened = g.openContainerAt(prev.chestPos.x, prev.chestPos.y, prev.chestPos.z);
    const chestSnap = g.getOpenContainer();
    g.closeContainer();
    return {
      digBlockAfter: g.getBlock(prev.digPos.x, prev.digPos.y, prev.digPos.z),
      benchBlockAfter: g.getBlock(prev.benchPos.x, prev.benchPos.y, prev.benchPos.z),
      chestBlockAfter: g.getBlock(prev.chestPos.x, prev.chestPos.y, prev.chestPos.z),
      invAfter: g.getInventory(),
      opened,
      chestSlotsAfter: chestSnap?.slots ?? [],
    };
  }, beforeSave);

  expect(afterReload.digBlockAfter).toBe(0);
  expect(afterReload.benchBlockAfter).toBe(32);
  expect(afterReload.chestBlockAfter).toBe(34);
  expect(afterReload.invAfter).toEqual(invBefore);
  expect(afterReload.opened).toBe(true);
  expect(afterReload.chestSlotsAfter).toEqual(beforeSave.chestSlotsBefore);

  expect(errors).toEqual([]);
});
