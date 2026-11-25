import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/config/constants';
import { EventBus } from '../../src/core/events';
import { Player } from '../../src/player/Player';
import { BlockId } from '../../src/registry/blocks';
import { ItemId } from '../../src/registry/items';
import { ContainerManager } from '../../src/systems/ContainerManager';
import { FarmingSystem } from '../../src/systems/FarmingSystem';
import { SurvivalSystem } from '../../src/systems/SurvivalSystem';
import { Chunk } from '../../src/world/Chunk';
import { TerrainGenerator } from '../../src/world/TerrainGenerator';
import { findNearestVillage, getVillageChestsInChunk } from '../../src/world/VillageGenerator';
import { World } from '../../src/world/World';

describe('M5 Survival, Farming & Deterministic Villages', () => {
  it('generates identical cross-chunk village positions, layouts, and blocks for the same seed', () => {
    const g1 = new TerrainGenerator(1337);
    const g2 = new TerrainGenerator(1337);

    const v1 = findNearestVillage(
      1337,
      (x, z) => g1.sampleBiome(x, z),
      (x, z) => g1.sampleHeight(x, z),
      0,
      0,
      8
    );
    const v2 = findNearestVillage(
      1337,
      (x, z) => g2.sampleBiome(x, z),
      (x, z) => g2.sampleHeight(x, z),
      0,
      0,
      8
    );

    expect(v1).not.toBeNull();
    expect(v1).toEqual(v2);
    expect(v1!.houses.length).toBeGreaterThanOrEqual(4);
    expect(v1!.houses.length).toBeLessThanOrEqual(8);
    expect(v1!.farms.length).toBeGreaterThanOrEqual(1);
    expect(v1!.farms.length).toBeLessThanOrEqual(2);
    expect(v1!.chests.length).toBeGreaterThanOrEqual(1);

    // Verify village spans multiple chunks and chunks generated in reverse order are bit-identical
    const minCx = Math.floor(v1!.minX / 16);
    const maxCx = Math.floor(v1!.maxX / 16);
    const minCz = Math.floor(v1!.minZ / 16);
    const maxCz = Math.floor(v1!.maxZ / 16);
    expect(maxCx - minCx).toBeGreaterThanOrEqual(2);

    const forwardChunks: Chunk[] = [];
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        forwardChunks.push(g1.generateChunk(cx, cz));
      }
    }

    let idx = forwardChunks.length - 1;
    let foundChestBlock = false;
    let foundCropBlock = false;
    let foundDoorBlock = false;
    for (let cx = maxCx; cx >= minCx; cx--) {
      for (let cz = maxCz; cz >= minCz; cz--) {
        const revChunk = g2.generateChunk(cx, cz);
        expect(revChunk.blocks).toEqual(forwardChunks[idx].blocks);
        for (let i = 0; i < revChunk.blocks.length; i++) {
          const b = revChunk.blocks[i] as BlockId;
          if (b === BlockId.Chest) foundChestBlock = true;
          if (b === BlockId.CropStage2 || b === BlockId.CropStage3) foundCropBlock = true;
          if (b === BlockId.WoodDoorBottom) foundDoorBlock = true;
        }
        idx--;
      }
    }

    expect(foundChestBlock).toBe(true);
    expect(foundCropBlock).toBe(true);
    expect(foundDoorBlock).toBe(true);

    // Verify lazy chest loot rolls ONCE on first open and stays consistent
    const containers = new ContainerManager();
    const chestInfo = v1!.chests[0];
    const chestCx = Math.floor(chestInfo.x / 16);
    const chestCz = Math.floor(chestInfo.z / 16);
    const chunkChests = getVillageChestsInChunk(
      chestCx,
      chestCz,
      1337,
      (x, z) => g1.sampleBiome(x, z),
      (x, z) => g1.sampleHeight(x, z)
    );
    expect(chunkChests.length).toBeGreaterThanOrEqual(1);
    containers.registerVillageChest(chestInfo.x, chestInfo.y, chestInfo.z, chestInfo.lootSeed);

    // Before first open, slots remain empty & ungenerated
    const raw = containers.get(chestInfo.x, chestInfo.y, chestInfo.z);
    expect(raw?.type === 'chest' && raw.lootGenerated).toBe(false);

    // First open generates deterministic loot
    const opened = containers.getOrCreateChest(chestInfo.x, chestInfo.y, chestInfo.z);
    expect(opened.lootGenerated).toBe(true);
    const nonEmptyCount = opened.slots.filter((s) => s !== null).length;
    expect(nonEmptyCount).toBeGreaterThanOrEqual(3);

    // Removing an item persists on subsequent opens (never re-rolls loot!)
    const firstNonEmptyIdx = opened.slots.findIndex((s) => s !== null);
    opened.slots[firstNonEmptyIdx] = null;
    const reopened = containers.getOrCreateChest(chestInfo.x, chestInfo.y, chestInfo.z);
    expect(reopened.slots[firstNonEmptyIdx]).toBeNull();
  });

  it('SurvivalSystem handles fall damage, armor mitigation, food, bed sleep, starvation, and drowning', () => {
    const bus = new EventBus();
    const survival = new SurvivalSystem();
    const player = new Player({ x: 0, y: 70, z: 0 });
    let diedCause = '';

    // 1. Fall damage: peak y=90 landing at y=70 (20 blocks -> ~17 dmg)
    player.fallPeakY = 90;
    player.pos.y = 70;
    player.onGround = true;
    survival.tick(
      player,
      { landed: true, impactSpeed: 22, horizontalDistance: 0, collidedX: false, collidedZ: false },
      false,
      FIXED_DT,
      bus,
      { onPlayerDied: (c) => { diedCause = c; } }
    );
    expect(player.health).toBeLessThan(10);
    expect(player.dead).toBe(false);

    // 2. Armor mitigates combat damage
    player.health = 20;
    player.invincibilityTicks = 0;
    player.inventory.armor.chestplate = { itemId: ItemId.IronChestplate, count: 1, durability: 200 };
    player.inventory.armor.leggings = { itemId: ItemId.IronLeggings, count: 1, durability: 200 };
    survival.damagePlayer(player, bus, 10, 'husk', { onPlayerDied: () => {} }, false, true);
    // 11 defense points -> 44% reduction -> 5.6 damage -> health ~14.4
    expect(player.health).toBeGreaterThan(13.5);
    expect(player.health).toBeLessThan(16);

    // 3. Eating restores hunger
    player.hunger = 10;
    player.inventory.addItem(ItemId.Bread, 1);
    player.inventory.selectHotbar(0);
    expect(survival.eatSelectedFood(player, bus)).toBe(true);
    expect(player.hunger).toBe(16);

    // 4. Bed sets spawn point & skips night (18000 -> next day 800)
    const bedRes = survival.useBed(player, 10, 65, -4, 18000);
    expect(bedRes.slept).toBe(true);
    expect(bedRes.newWorldTime % 24000).toBe(800);
    expect(player.spawnPoint.x).toBeCloseTo(10.5, 2);

    // 5. Drowning kills when oxygen hits 0
    player.health = 4;
    player.oxygen = 0.05;
    player.headInWater = true;
    for (let t = 0; t < 60 && !player.dead; t++) {
      survival.tick(
        player,
        { landed: false, impactSpeed: 0, horizontalDistance: 0, collidedX: false, collidedZ: false },
        false,
        FIXED_DT,
        bus,
        { onPlayerDied: (c) => { diedCause = c; } }
      );
    }
    expect(player.dead).toBe(true);
    expect(diedCause).toBe('drowning');

    survival.respawnPlayer(player, bus);
    expect(player.dead).toBe(false);
    expect(player.health).toBe(20);
    expect(player.oxygen).toBe(20);
  });

  it('FarmingSystem tills soil, hydrates near water, grows crops, and responds to bonemeal', () => {
    const world = new World(77);
    world.setChunk(new Chunk(0, 0));
    const farming = new FarmingSystem();

    world.setBlock(4, 60, 4, BlockId.Grass);
    world.setBlock(6, 60, 4, BlockId.Water, 0);
    // Give sky light to (4,61,4)
    world.setSkyLight(4, 61, 4, 15);

    expect(farming.tillSoil(world, 4, 60, 4)).toBe(true);
    expect(world.getBlock(4, 60, 4)).toBe(BlockId.FarmlandWet);

    // Plant stage 0 and accelerate growth ticks
    world.setBlock(4, 61, 4, BlockId.CropStage0);
    for (let i = 0; i < 6; i++) {
      farming.tick(world, 1800);
    }
    expect(world.getBlock(4, 61, 4)).toBe(BlockId.CropStage3);

    // Bonemeal skips stage 0 -> 2 -> 3 immediately
    world.setBlock(4, 61, 4, BlockId.CropStage0);
    expect(farming.applyBonemeal(world, 4, 61, 4)).toBe(true);
    expect(world.getBlock(4, 61, 4)).toBe(BlockId.CropStage2);
    expect(farming.applyBonemeal(world, 4, 61, 4)).toBe(true);
    expect(world.getBlock(4, 61, 4)).toBe(BlockId.CropStage3);
  });
});
