import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test('M6 mobs: midnight hostile spawn + combat kill drop + enclosed lit 5x5 hut full-night survival', async ({
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

  // --- PART 1: Craft an Oak Blade legitimately from spawn trees, then accelerate 2 min at midnight ---
  const spawnResult = await page.evaluate(async () => {
    const g = window.__game!;
    g.setFlying(false);
    g.stepSimulation(15);
    const st0 = g.getState();
    const spawnX = Math.floor(st0.player.pos.x);
    const spawnZ = Math.floor(st0.player.pos.z);

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

    // Punch 3 tree logs for planks -> sticks -> workbench -> Oak Blade (Wood Sword, 4 dmg)
    for (let attempt = 0; attempt < 10 && countItem(10) + countItem(11) + countItem(12) < 3; attempt++) {
      let found: { bx: number; by: number; bz: number; sx: number; sy: number; sz: number } | null = null;
      for (let r = 1; r <= 32 && !found; r++) {
        for (let dz = -r; dz <= r && !found; dz++) {
          for (let dx = -r; dx <= r && !found; dx++) {
            if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
            const bx = spawnX + dx;
            const bz = spawnZ + dz;
            for (let by = 92; by >= 58; by--) {
              const id = g.getBlock(bx, by, bz);
              if (id !== 17 && id !== 18 && id !== 19) continue;
              for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                if (g.getBlock(bx + ox, by - 1, bz + oz) > 0 && g.getBlock(bx + ox, by, bz + oz) === 0 && g.getBlock(bx + ox, by + 1, bz + oz) === 0) {
                  found = { bx, by, bz, sx: bx + ox, sy: by, sz: bz + oz };
                  break;
                }
              }
              if (found) break;
            }
          }
        }
      }
      if (!found) break;
      g.teleport(found.sx + 0.5, found.sy + 0.02, found.sz + 0.5);
      lookAt(found.bx, found.by, found.bz);
      const m = await g.mineBlock(4000);
      if (m.broken) {
        g.teleport(found.bx + 0.5, found.sy + 0.02, found.bz + 0.5);
        g.stepSimulation(12);
      }
    }

    while (countItem(10) > 0) g.craft('oak_planks', false);
    while (countItem(11) > 0) g.craft('birch_planks', false);
    while (countItem(12) > 0) g.craft('pine_planks', false);
    g.craft('sticks', false);
    g.craft('workbench', false);

    // Place workbench near spawn and craft Wood Sword (ItemId 203)
    const benchX = spawnX;
    const benchZ = spawnZ - 2;
    let benchGroundY = Math.floor(st0.player.pos.y) + 4;
    while (g.getBlock(benchX, benchGroundY, benchZ) === 0 && benchGroundY > 50) benchGroundY--;
    g.setFlying(true);
    g.teleport(benchX + 0.5, benchGroundY + 3.2, benchZ + 0.5);
    equipItem(17);
    lookAt(benchX, benchGroundY, benchZ);
    g.placeBlock();
    g.setFlying(false);
    g.teleport(benchX + 0.5, benchGroundY + 1.05, benchZ + 1.5);
    g.openContainerAt(benchX, benchGroundY + 1, benchZ);
    const craftedSword = g.craft('wood_sword', true);
    g.closeContainer();
    equipItem(203);

    // Jump to midnight (18000) and accelerate 2 real minutes (2400 ticks)
    const cur = g.getState().worldTime % 24000;
    const toMidnight = (18000 - cur + 24000) % 24000;
    g.setFlying(true);
    g.advanceTime(toMidnight);
    g.setFlying(false);
    g.stepSimulation(10);

    // Accelerate 2 minutes (2400 ticks) at midnight in open terrain
    g.advanceTime(2400);

    const ents = g.getEntities();
    const hostiles = ents.filter(
      (e) => e.kind === 'husk' || e.kind === 'bone_archer' || e.kind === 'gloom_spider'
    );
    return {
      craftedSword,
      hostileCount: hostiles.length,
      firstHostile: hostiles[0] ?? null,
    };
  });

  expect(spawnResult.craftedSword).toBe(true);
  expect(spawnResult.hostileCount).toBeGreaterThanOrEqual(1);
  expect(spawnResult.firstHostile).not.toBeNull();

  // Frame a spawned hostile mob for M6 screenshot
  await page.evaluate((mob) => {
    const g = window.__game!;
    g.setFlying(true);
    g.teleport(mob.pos.x, mob.pos.y + 0.6, mob.pos.z + 3.4);
    const p = g.getState().player.pos;
    const dx = mob.pos.x - p.x;
    const dy = mob.pos.y + 0.7 - (p.y + 1.62);
    const dz = mob.pos.z - p.z;
    g.setLook(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
  }, spawnResult.firstHostile!);
  await page.waitForTimeout(350);

  const screenshotDir = path.resolve('docs/screenshots');
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, 'M6-mobs.png') });

  // --- PART 2: Slay hostile mob with crafted Oak Blade & verify loot drops ---
  const killResult = await page.evaluate((targetMob) => {
    const g = window.__game!;
    g.setFlying(false);
    const mobDropIds = new Set([158, 112, 115, 113]); // RottenFlesh=158, Bone=112, Arrow=115, SilkThread=113

    // Ensure Oak Blade (203) is selected
    const swordIdx = g.getInventory().slots.findIndex((s) => s !== null && s.itemId === 203);
    if (swordIdx >= 0 && swordIdx < 9) g.selectHotbar(swordIdx);

    let killed = false;
    let hits = 0;
    for (let swing = 0; swing < 20; swing++) {
      const ents = g.getEntities();
      const curMob = ents.find((e) => e.id === targetMob.id);
      if (!curMob) {
        killed = true;
        break;
      }
      // Pick clear 2.0-block attack offset around target
      let px = curMob.pos.x;
      let pz = curMob.pos.z + 2.0;
      for (const [ox, oz] of [[0, 2.0], [0, -2.0], [2.0, 0], [-2.0, 0]]) {
        const tx = Math.floor(curMob.pos.x + ox);
        const tz = Math.floor(curMob.pos.z + oz);
        const ty = Math.floor(curMob.pos.y);
        if (g.getBlock(tx, ty, tz) === 0 && g.getBlock(tx, ty + 1, tz) === 0) {
          px = curMob.pos.x + ox;
          pz = curMob.pos.z + oz;
          break;
        }
      }
      g.teleport(px, curMob.pos.y + 0.05, pz);
      const p = g.getState().player.pos;
      const aimY = curMob.kind === 'gloom_spider' ? curMob.pos.y + 0.45 : curMob.pos.y + 0.95;
      const dx = curMob.pos.x - p.x;
      const dy = aimY - (p.y + 1.62);
      const dz = curMob.pos.z - p.z;
      g.setLook(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
      if (g.attack()) hits++;
      g.stepSimulation(9);
    }

    const dropsNear = g
      .getEntities()
      .filter((e) => e.kind === 'dropped_item' && e.itemId !== undefined && mobDropIds.has(e.itemId));
    if (dropsNear.length > 0) {
      g.teleport(dropsNear[0].pos.x, dropsNear[0].pos.y + 0.05, dropsNear[0].pos.z);
      g.stepSimulation(20);
    }

    const collectedDrops = g.getInventory().slots.filter((s) => s !== null && mobDropIds.has(s.itemId));
    return {
      killed: killed || collectedDrops.length > 0 || dropsNear.length > 0,
      hits,
      droppedInWorld: dropsNear.length,
      collectedCount: collectedDrops.length,
      collectedIds: collectedDrops.map((s) => s!.itemId),
    };
  }, spawnResult.firstHostile!);

  expect(killResult.killed, `Kill failed: ${JSON.stringify(killResult)}`).toBe(true);
  expect(killResult.collectedCount + killResult.droppedInWorld).toBeGreaterThanOrEqual(1);

  // --- PART 3: Enclosed 5x5 Torch-Lit Hut Full-Night Survival (0 interior spawns, player survives!) ---
  await page.evaluate(async () => {
    await window.__game!.startNewWorld(1337);
  });
  await page.waitForFunction(() => window.__game!.getState().loadedChunks >= 20, { timeout: 25_000 });
  await page.waitForTimeout(300);

  const shelterNightResult = await page.evaluate(async () => {
    const g = window.__game!;
    g.setFlying(false);
    g.stepSimulation(20);
    const st0 = g.getState();
    const spawnX = Math.floor(st0.player.spawnPoint.x);
    const spawnZ = Math.floor(st0.player.spawnPoint.z);

    const lookAt = (tx: number, ty: number, tz: number): void => {
      const p = g.getState().player;
      const dx = tx + 0.5 - p.pos.x;
      const dy = ty + 0.5 - (p.pos.y + 1.62);
      const dz = tz + 0.5 - p.pos.z;
      g.setLook(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
    };

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

    // 1. Mine the Spawn Waystone Torch (BlockId.Torch = 35)
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
    if (!torchPos) return { ok: false, reason: 'missing spawn torch' };
    g.teleport(torchPos.x + 0.5, torchPos.y, torchPos.z + 1.2);
    lookAt(torchPos.x, torchPos.y, torchPos.z);
    await g.mineBlock(2000);
    g.teleport(torchPos.x + 0.5, torchPos.y, torchPos.z + 0.5);
    g.stepSimulation(15);

    // 2. Gather wood logs and craft >= 130 Planks for a completely sealed 5x5x3 shelter
    const findLog = (): { bx: number; by: number; bz: number; sx: number; sy: number; sz: number } | null => {
      for (let r = 1; r <= 36; r++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
            const bx = spawnX + dx;
            const bz = spawnZ + dz;
            for (let by = 92; by >= 58; by--) {
              const id = g.getBlock(bx, by, bz);
              if (id !== 17 && id !== 18 && id !== 19) continue;
              for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const sx = bx + ox;
                const sz = bz + oz;
                for (let sy = by - 1; sy <= by; sy++) {
                  if (g.getBlock(sx, sy - 1, sz) > 0 && g.getBlock(sx, sy, sz) === 0 && g.getBlock(sx, sy + 1, sz) === 0) {
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

    for (let i = 0; i < 65; i++) {
      const totalPlankEquiv =
        countItem(13) + countItem(14) + countItem(15) + (countItem(10) + countItem(11) + countItem(12)) * 4;
      if (totalPlankEquiv >= 132) break;
      const log = findLog();
      if (!log) break;
      g.teleport(log.sx + 0.5, log.sy + 0.02, log.sz + 0.5);
      lookAt(log.bx, log.by, log.bz);
      const m = await g.mineBlock(4000);
      if (m.broken) {
        g.teleport(log.bx + 0.5, log.sy + 0.02, log.bz + 0.5);
        g.stepSimulation(12);
      }
    }
    while (countItem(10) > 0) g.craft('oak_planks', false);
    while (countItem(11) > 0) g.craft('birch_planks', false);
    while (countItem(12) > 0) g.craft('pine_planks', false);

    // 3. Locate the flattest 5x5 ground patch near spawn so the 5x5 hut needs <= 80 planks (48 walls + 25 roof)
    let hx = spawnX;
    let hz = spawnZ;
    let hy = 64;
    let bestSpan = 999;

    const colTop = (x: number, z: number): number => {
      for (let y = 95; y >= 50; y--) {
        const b = g.getBlock(x, y, z);
        if (b > 0 && b !== 28 && b !== 29 && b !== 30 && b !== 31 && b !== 20 && b !== 21 && b !== 22) {
          return y;
        }
      }
      return 50;
    };

    for (let ox = -24; ox <= 24; ox += 2) {
      for (let oz = -24; oz <= 24; oz += 2) {
        const cx = spawnX + ox;
        const cz = spawnZ + oz;
        let lo = 999;
        let hi = 0;
        let wet = false;
        for (let dx = -2; dx <= 2; dx++) {
          for (let dz = -2; dz <= 2; dz++) {
            const top = colTop(cx + dx, cz + dz);
            const b = g.getBlock(cx + dx, top, cz + dz);
            if (b === 27 || b === 17 || b === 18 || b === 19) wet = true;
            if (top < lo) lo = top;
            if (top > hi) hi = top;
          }
        }
        if (!wet && hi - lo < bestSpan) {
          bestSpan = hi - lo;
          hx = cx;
          hz = cz;
          hy = hi;
          if (bestSpan === 0) break;
        }
      }
      if (bestSpan === 0) break;
    }

    const equipAnyPlank = (): boolean => equipItem(13) || equipItem(14) || equipItem(15);

    const placeAt = (tx: number, ty: number, tz: number, itemId?: number): boolean => {
      const curB = g.getBlock(tx, ty, tz);
      if (curB !== 0 && curB !== 28 && curB !== 29 && curB !== 30 && curB !== 31) return true;
      const okEquip = itemId !== undefined ? equipItem(itemId) : equipAnyPlank();
      if (!okEquip) return false;
      const dirs: ReadonlyArray<readonly [number, number, number]> = [
        [0, -1, 0],
        [1, 0, 0],
        [-1, 0, 0],
        [0, 0, 1],
        [0, 0, -1],
        [0, 1, 0],
      ];
      for (const [ox, oy, oz] of dirs) {
        const ax = tx + ox;
        const ay = ty + oy;
        const az = tz + oz;
        const ab = g.getBlock(ax, ay, az);
        if (ab > 0 && ab !== 27 && ab !== 28 && ab !== 29 && ab !== 30 && ab !== 31 && ab !== 35) {
          g.setFlying(true);
          if (oy === -1) {
            g.teleport(tx + 0.5, ty + 2.1, tz + 0.5);
          } else if (oy === 1) {
            g.teleport(tx + 0.5, ty - 2.6, tz + 0.5);
          } else {
            g.teleport(tx + 0.5, ty - 2.6, tz + 0.5);
            const p = g.getState().player;
            const faceX = tx + 0.5 + ox * 0.52;
            const faceY = ty + 0.5;
            const faceZ = tz + 0.5 + oz * 0.52;
            const dx = faceX - p.pos.x;
            const dy = faceY - (p.pos.y + 1.62);
            const dz = faceZ - p.pos.z;
            g.setLook(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
            if (g.placeBlock()) return true;
            continue;
          }
          lookAt(ax, ay, az);
          if (g.placeBlock()) return true;
        }
      }
      return false;
    };

    // Level floor up to hy (at most a few blocks on flattest patch)
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        let topY = colTop(hx + dx, hz + dz);
        for (let y = topY + 1; y <= hy; y++) {
          placeAt(hx + dx, y, hz + dz);
        }
      }
    }
    // Torch inside center (hx, hy+1, hz)
    const placedTorch = placeAt(hx, hy + 1, hz, 20);
    // 4 walls (hy+1..hy+3)
    for (let wy = hy + 1; wy <= hy + 3; wy++) {
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          if (Math.abs(dx) === 2 || Math.abs(dz) === 2) {
            placeAt(hx + dx, wy, hz + dz);
          }
        }
      }
    }
    // Roof 5x5 at hy+4 (outer ring to center)
    for (let ring = 2; ring >= 0; ring--) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dz = -ring; dz <= ring; dz++) {
          if (Math.abs(dx) === ring || Math.abs(dz) === ring) {
            placeAt(hx + dx, hy + 4, hz + dz);
          }
        }
      }
    }

    // Check roof/wall completeness for clear diagnostics
    let missingShell = 0;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (g.getBlock(hx + dx, hy + 4, hz + dz) === 0) missingShell++;
        if (Math.abs(dx) === 2 || Math.abs(dz) === 2) {
          for (let wy = hy + 1; wy <= hy + 3; wy++) {
            if (g.getBlock(hx + dx, wy, hz + dz) === 0) missingShell++;
          }
        }
      }
    }

    // Stand player inside the sealed lit 5x5 hut!
    g.setFlying(false);
    g.teleport(hx + 1.5, hy + 1.05, hz + 0.5);
    g.stepSimulation(10);

    const lightInsideCenter = g.getLight(hx, hy + 1, hz);
    const lightInsideCorner = g.getLight(hx + 1, hy + 1, hz + 1);

    // Jump to dusk (12100) and endure an ENTIRE night (11500 ticks -> dawn 23600)!
    const cur = g.getState().worldTime % 24000;
    const toDusk = (12100 - cur + 24000) % 24000;
    g.advanceTime(toDusk);

    let interiorHostileSpawns = 0;
    for (let chunk = 0; chunk < 11; chunk++) {
      g.advanceTime(1050);
      const ents = g.getEntities();
      for (const e of ents) {
        if (e.kind === 'husk' || e.kind === 'bone_archer' || e.kind === 'gloom_spider') {
          if (
            e.pos.x >= hx - 1 &&
            e.pos.x <= hx + 2 &&
            e.pos.z >= hz - 1 &&
            e.pos.z <= hz + 2 &&
            e.pos.y >= hy &&
            e.pos.y <= hy + 4
          ) {
            interiorHostileSpawns++;
          }
        }
      }
    }

    const endPlayer = g.getState().player;
    return {
      ok:
        placedTorch &&
        missingShell === 0 &&
        lightInsideCenter.sky === 0 &&
        lightInsideCenter.block >= 12 &&
        lightInsideCorner.block >= 10 &&
        !endPlayer.dead &&
        endPlayer.health > 0 &&
        interiorHostileSpawns === 0,
      placedTorch,
      missingShell,
      bestSpan,
      remainingPlanks: countItem(13) + countItem(14) + countItem(15),
      lightInsideCenter,
      lightInsideCorner,
      playerDead: endPlayer.dead,
      playerHealth: endPlayer.health,
      interiorHostileSpawns,
    };
  });

  expect(shelterNightResult.ok, `Hut night test failed: ${JSON.stringify(shelterNightResult)}`).toBe(true);
  expect(errors).toEqual([]);
});
