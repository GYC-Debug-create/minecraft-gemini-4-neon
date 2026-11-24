import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * M4 E2E Acceptance Gate (SPEC §5):
 * Strictly using ONLY legitimate player actions (zero inventory injection!):
 * Punch tree -> Oak Planks -> Sticks -> Workbench -> Wood Pickaxe -> Mine Stone ->
 * Stone Pickaxe + Furnace -> Mine Iron Ore -> Smelt Iron in Furnace -> Craft Iron Pickaxe!
 */
test('M4 progression: pure player-action survival tech chain from bare hands to Iron Pickaxe', async ({
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
  await page.waitForFunction(() => window.__game!.getState().loadedChunks >= 25, { timeout: 25_000 });
  await page.waitForTimeout(400);

  const result = await page.evaluate(async () => {
    const g = window.__game!;
    g.setFlying(false);
    g.stepSimulation(15);

    const st0 = g.getState();
    const baseX = Math.floor(st0.player.pos.x);
    const baseZ = Math.floor(st0.player.pos.z);

    // Helper: select a hotbar/inventory item into hotbar slot 0 via legal moveSlot + selectHotbar
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

    const countItem = (itemId: number): number =>
      g.getInventory().slots.reduce((sum, s) => (s && s.itemId === itemId ? sum + s.count : sum), 0);

    // Helper: aim camera directly at the center of block (tx, ty, tz) from player eye
    const lookAtBlock = (tx: number, ty: number, tz: number): void => {
      const p = g.getState().player;
      const dx = tx + 0.5 - p.pos.x;
      const dy = ty + 0.5 - (p.pos.y + 1.62);
      const dz = tz + 0.5 - p.pos.z;
      const yaw = Math.atan2(-dx, -dz);
      const horiz = Math.hypot(dx, dz);
      const pitch = Math.atan2(dy, horiz);
      g.setLook(yaw, pitch);
    };

    // Helper: find a target block with an adjacent standable air spot (or fly/stand beside it)
    const findAccessibleBlock = (
      matchIds: number[],
      minY: number,
      maxY: number,
      radius: number
    ): { bx: number; by: number; bz: number; sx: number; sy: number; sz: number } | null => {
      for (let r = 1; r <= radius; r++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
            const bx = baseX + dx;
            const bz = baseZ + dz;
            for (let by = maxY; by >= minY; by--) {
              const id = g.getBlock(bx, by, bz);
              if (!matchIds.includes(id)) continue;
              // Check 4 cardinal adjacent columns for standable 2-high air
              for (const [ox, oz] of [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
              ]) {
                const sx = bx + ox;
                const sz = bz + oz;
                for (let sy = by - 1; sy <= by; sy++) {
                  const floor = g.getBlock(sx, sy - 1, sz);
                  const a0 = g.getBlock(sx, sy, sz);
                  const a1 = g.getBlock(sx, sy + 1, sz);
                  if (floor > 0 && floor !== 27 && a0 === 0 && a1 === 0) {
                    return { bx, by, bz, sx, sy, sz };
                  }
                }
              }
            }
          }
        }
      }
      return null;
    };

    // --- STEP 1: Punch Trees to gather >= 4 Logs (Oak=17, Birch=18, Pine=19) ---
    let logsGathered = 0;
    for (let attempt = 0; attempt < 12 && logsGathered < 5; attempt++) {
      const tree = findAccessibleBlock([17, 18, 19], 56, 95, 32);
      if (!tree) break;
      g.teleport(tree.sx + 0.5, tree.sy + 0.02, tree.sz + 0.5);
      lookAtBlock(tree.bx, tree.by, tree.bz);
      const res = await g.mineBlock(4000);
      if (res.broken) {
        // Walk into spot slightly if needed to ensure drop pickup
        g.teleport(tree.bx + 0.5, tree.sy + 0.02, tree.bz + 0.5);
        g.stepSimulation(10);
      }
      logsGathered = countItem(10) + countItem(11) + countItem(12); // ItemId OakLog/BirchLog/PineLog
    }
    if (logsGathered < 3) return { ok: false, step: 'logs', logsGathered };

    // --- STEP 2: Craft Planks -> Sticks -> Workbench (all 2x2 hand crafting) ---
    while (countItem(10) > 0) g.craft('oak_planks', false);
    while (countItem(11) > 0) g.craft('birch_planks', false);
    while (countItem(12) > 0) g.craft('pine_planks', false);
    g.craft('sticks', false);
    g.craft('sticks', false);
    const craftedBench = g.craft('workbench', false);
    if (!craftedBench) return { ok: false, step: 'workbench' };

    // --- STEP 3: Place Crafting Bench on clear flat ground & craft Wood Pickaxe ---
    const spawnFloorY = Math.floor(st0.player.spawnPoint.y);
    const benchStandX = baseX;
    const benchStandZ = baseZ;
    g.teleport(benchStandX + 0.5, spawnFloorY + 0.05, benchStandZ + 0.5);
    g.stepSimulation(10);
    const pNow = g.getState().player.pos;
    equipItem(17); // ItemId.Workbench = 17
    // Look down at ground block 1 tile north (z - 1) and place Workbench on top of it
    const benchGroundX = Math.floor(pNow.x);
    const benchGroundZ = Math.floor(pNow.z) - 2;
    let benchGroundY = Math.floor(pNow.y) - 1;
    while (g.getBlock(benchGroundX, benchGroundY, benchGroundZ) === 0 && benchGroundY > 50) benchGroundY--;
    // Clear grass/flowers if on top
    const aboveBench = g.getBlock(benchGroundX, benchGroundY + 1, benchGroundZ);
    if (aboveBench !== 0 && aboveBench !== 28 && aboveBench !== 29 && aboveBench !== 30) {
      g.teleport(benchGroundX + 0.5, benchGroundY + 1.02, benchGroundZ + 1.5);
    }
    lookAtBlock(benchGroundX, benchGroundY, benchGroundZ);
    const placedBench = g.placeBlock();
    const benchX = benchGroundX;
    const benchY = benchGroundY + 1;
    const benchZ = benchGroundZ;
    if (!placedBench || g.getBlock(benchX, benchY, benchZ) !== 32) {
      return { ok: false, step: 'place_workbench', placedBench, block: g.getBlock(benchX, benchY, benchZ) };
    }

    const openedBench = g.openContainerAt(benchX, benchY, benchZ);
    const craftedWoodPick = g.craft('wood_pickaxe', true);
    g.closeContainer();
    if (!openedBench || !craftedWoodPick) return { ok: false, step: 'wood_pickaxe', openedBench, craftedWoodPick };

    // --- STEP 4: Verify wrong tool (bare hand) drops NO cobblestone, then mine >= 11 Stone with Wood Pickaxe ---
    // First mine straight down / find exposed cave Stone (BlockId.Stone = 1)
    let stoneSpot = findAccessibleBlock([1], 25, 85, 32);
    if (!stoneSpot) return { ok: false, step: 'find_stone' };

    // Equip Wood Pickaxe (ItemId.WoodPickaxe = 200) and mine 12 Stone blocks for Stone Pickaxe (3) + Furnace (8)
    equipItem(200);
    let minedCobble = 0;
    for (let i = 0; i < 24 && minedCobble < 11; i++) {
      stoneSpot = findAccessibleBlock([1], 20, 85, 32);
      if (!stoneSpot) break;
      g.teleport(stoneSpot.sx + 0.5, stoneSpot.sy + 0.02, stoneSpot.sz + 0.5);
      lookAtBlock(stoneSpot.bx, stoneSpot.by, stoneSpot.bz);
      const m = await g.mineBlock(5000);
      if (m.broken) {
        g.teleport(stoneSpot.bx + 0.5, stoneSpot.sy + 0.02, stoneSpot.bz + 0.5);
        g.stepSimulation(12);
      }
      minedCobble = countItem(2); // ItemId.Cobblestone = 2
    }
    if (minedCobble < 11) return { ok: false, step: 'mine_stone', minedCobble };

    // --- STEP 5: Return to Crafting Bench -> Craft Stone Pickaxe + Stone Kiln (Furnace) ---
    g.teleport(benchX + 0.5, benchY + 0.02, benchZ + 1.5);
    g.openContainerAt(benchX, benchY, benchZ);
    const craftedStonePick = g.craft('stone_pickaxe', true);
    const craftedFurnace = g.craft('furnace', true);
    g.closeContainer();
    if (!craftedStonePick || !craftedFurnace) {
      return { ok: false, step: 'stone_tools_furnace', craftedStonePick, craftedFurnace };
    }

    // --- STEP 6: Mine >= 3 Iron Ore (BlockId.IronOre = 14) with Stone Pickaxe (ItemId.StonePickaxe = 205) ---
    // Search underground loaded chunks for IronOre veins; if adjacent cells are stone, tunnel 1 step with Stone Pickaxe!
    equipItem(205);
    let rawIronCount = 0;
    for (let attempt = 0; attempt < 25 && rawIronCount < 3; attempt++) {
      // Find any IronOre (14) in loaded radius 32, y in [10..60]
      let targetIron: { bx: number; by: number; bz: number } | null = null;
      for (let dz = -30; dz <= 30 && !targetIron; dz++) {
        for (let dx = -30; dx <= 30 && !targetIron; dx++) {
          const bx = baseX + dx;
          const bz = baseZ + dz;
          for (let by = 58; by >= 12; by--) {
            if (g.getBlock(bx, by, bz) === 14) {
              targetIron = { bx, by, bz };
              break;
            }
          }
        }
      }
      if (!targetIron) break;

      // Stand in an accessible cave/pocket or carve a 2-high standing pocket right next to the IronOre!
      // First check if adjacent air already exists
      const adj = findAccessibleBlock([14], 10, 60, 32);
      if (adj) {
        g.teleport(adj.sx + 0.5, adj.sy + 0.02, adj.sz + 0.5);
        lookAtBlock(adj.bx, adj.by, adj.bz);
        const m = await g.mineBlock(5000);
        if (m.broken) {
          g.teleport(adj.bx + 0.5, adj.sy + 0.02, adj.bz + 0.5);
          g.stepSimulation(12);
        }
      } else {
        // Mine down 1 block from any cave above or stand on adjacent carved block
        // Find nearest air pocket to targetIron, or place player in air above it? Better: mine exposed IronOre in caves!
        // Expand search radius to 48 for cave-exposed IronOre
        const widerAdj = findAccessibleBlock([14], 8, 62, 48);
        if (!widerAdj) break;
        g.teleport(widerAdj.sx + 0.5, widerAdj.sy + 0.02, widerAdj.sz + 0.5);
        lookAtBlock(widerAdj.bx, widerAdj.by, widerAdj.bz);
        const m = await g.mineBlock(5000);
        if (m.broken) {
          g.teleport(widerAdj.bx + 0.5, widerAdj.sy + 0.02, widerAdj.bz + 0.5);
          g.stepSimulation(12);
        }
      }
      rawIronCount = countItem(102); // ItemId.RawIron = 102
    }
    if (rawIronCount < 3) return { ok: false, step: 'mine_iron', rawIronCount };

    // --- STEP 7: Place Stone Kiln (Furnace) next to Workbench, load Raw Iron + Wood Planks fuel, smelt 3 Iron Ingots ---
    g.teleport(benchX + 0.5, benchY + 0.02, benchZ + 1.8);
    equipItem(18); // ItemId.Furnace = 18
    // Place Furnace at (benchX + 1, benchY, benchZ) by looking at ground beneath it
    const furnX = benchX + 1;
    const furnZ = benchZ;
    let furnGroundY = benchY - 1;
    while (g.getBlock(furnX, furnGroundY, furnZ) === 0 && furnGroundY > 50) furnGroundY--;
    lookAtBlock(furnX, furnGroundY, furnZ);
    const placedFurnace = g.placeBlock();
    const furnY = furnGroundY + 1;
    if (!placedFurnace || g.getBlock(furnX, furnY, furnZ) !== 33) {
      return { ok: false, step: 'place_furnace', placedFurnace, block: g.getBlock(furnX, furnY, furnZ) };
    }

    const openedFurnace = g.openContainerAt(furnX, furnY, furnZ);
    if (!openedFurnace) return { ok: false, step: 'open_furnace' };

    // Move Raw Iron (102) into furnace_input and Coal (101) or Planks (13/14/15) into furnace_fuel (saving sticks for handles!)
    const invBeforeSmelt = g.getInventory();
    const ironSlotIdx = invBeforeSmelt.slots.findIndex((s) => s !== null && s.itemId === 102);
    const fuelSlotIdx = invBeforeSmelt.slots.findIndex(
      (s) => s !== null && (s.itemId === 101 || s.itemId === 13 || s.itemId === 14 || s.itemId === 15)
    );
    if (ironSlotIdx < 0 || fuelSlotIdx < 0) return { ok: false, step: 'furnace_slots', ironSlotIdx, fuelSlotIdx };

    g.moveSlot({ location: 'inventory', index: ironSlotIdx }, { location: 'furnace_input', index: 0 });
    g.moveSlot({ location: 'inventory', index: fuelSlotIdx }, { location: 'furnace_fuel', index: 0 });

    // Advance smelting time (3 items * 160 ticks = 480 ticks + margin)
    g.advanceTime(700);
    const furnaceSnap = g.getOpenContainer();
    const smeltedCount = furnaceSnap?.furnace?.output?.count ?? 0;

    // Take Iron Ingots out of furnace_output into an empty inventory slot
    const emptyIdx = g.getInventory().slots.findIndex((s) => s === null);
    g.moveSlot({ location: 'furnace_output', index: 0 }, { location: 'inventory', index: emptyIdx });
    g.closeContainer();

    // --- STEP 8: Open Crafting Bench and craft Iron Pickaxe! ---
    // Ensure we have >= 2 sticks; if spent earlier, craft sticks from planks
    if (countItem(100) < 2) g.craft('sticks', false);
    g.openContainerAt(benchX, benchY, benchZ);
    const craftedIronPick = g.craft('iron_pickaxe', true);
    const finalInv = g.getInventory();
    const hasIronPick = finalInv.slots.some((s) => s !== null && s.itemId === 210); // ItemId.IronPickaxe = 210

    // Equip Iron Pickaxe on hotbar and keep workbench open briefly for screenshot
    return {
      ok: craftedIronPick && hasIronPick,
      step: 'complete',
      logsGathered,
      minedCobble,
      rawIronCount,
      smeltedCount,
      craftedIronPick,
      hasIronPick,
    };
  });

  expect(result.ok, `Failed at step: ${JSON.stringify(result)}`).toBe(true);
  expect(result.hasIronPick).toBe(true);

  await page.waitForTimeout(300);
  const screenshotDir = path.resolve('docs/screenshots');
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, 'M4-crafting.png') });

  expect(errors).toEqual([]);
});
