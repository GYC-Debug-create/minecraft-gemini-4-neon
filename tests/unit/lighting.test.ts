import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/config/balance';
import { EventBus } from '../../src/core/events';
import { BlockId } from '../../src/registry/blocks';
import { Chunk } from '../../src/world/Chunk';
import { recomputeWorldLighting, updateLightingAt } from '../../src/world/Lighting';
import { WaterFlowSystem } from '../../src/world/WaterFlow';
import { World } from '../../src/world/World';

function createEnclosedRoomWorld(): World {
  const bus = new EventBus();
  const world = new World(42, bus);
  world.setChunk(new Chunk(0, 0));
  world.setChunk(new Chunk(1, 0));

  // Solid floor y=10, ceiling y=16, walls around x in [2..18], z in [2..12] (crosses chunk border x=15->16!)
  for (let x = 2; x <= 18; x++) {
    for (let z = 2; z <= 12; z++) {
      world.setBlock(x, 10, z, BlockId.Stone);
      world.setBlock(x, 16, z, BlockId.Stone);
      for (let y = 11; y <= 15; y++) {
        if (x === 2 || x === 18 || z === 2 || z === 12) {
          world.setBlock(x, y, z, BlockId.Stone);
        }
      }
    }
  }

  recomputeWorldLighting(world);

  // Wire incremental lighting on block changes
  bus.on('block:changed', ({ x, y, z, oldId, newId }) => {
    updateLightingAt(world, x, y, z, oldId, newId);
  });

  return world;
}

describe('M3 Lighting Propagation & Water Flow', () => {
  it('completely enclosed room has skyLight === 0 and blockLight === 0', () => {
    const world = createEnclosedRoomWorld();
    expect(world.getSkyLight(8, 12, 7)).toBe(0);
    expect(world.getBlockLight(8, 12, 7)).toBe(0);
    expect(world.getSkyLight(16, 12, 7)).toBe(0);
    // Above the roof is full direct sunlight 15
    expect(world.getSkyLight(8, 17, 7)).toBe(15);
  });

  it('torch emits light 14 and decays strictly by Manhattan distance (including across chunk border)', () => {
    const world = createEnclosedRoomWorld();

    // Place torch at (10, 11, 7)
    world.setBlock(10, 11, 7, BlockId.Torch);

    expect(world.getBlockLight(10, 11, 7)).toBe(14);
    expect(world.getBlockLight(11, 11, 7)).toBe(13);
    expect(world.getBlockLight(13, 11, 7)).toBe(11);
    expect(world.getBlockLight(15, 11, 7)).toBe(9);
    // Cross chunk border into chunk (1,0) at x=16, x=17!
    expect(world.getBlockLight(16, 11, 7)).toBe(8);
    expect(world.getBlockLight(17, 11, 7)).toBe(7);
    // Diagonal distance 2 -> 14 - 2 = 12
    expect(world.getBlockLight(11, 12, 7)).toBe(12);
    // Outside distance 14 (Manhattan dist = 7 + 4 + 4 = 15) -> 0
    expect(world.getBlockLight(3, 15, 3)).toBe(0);

    // Breaking the torch incrementally extinguishes block light back to 0
    world.setBlock(10, 11, 7, BlockId.Air);
    expect(world.getBlockLight(10, 11, 7)).toBe(0);
    expect(world.getBlockLight(13, 11, 7)).toBe(0);
    expect(world.getBlockLight(16, 11, 7)).toBe(0);
  });

  it('breaking a ceiling block incrementally floods sky light into enclosed room and resealing restores darkness', () => {
    const world = createEnclosedRoomWorld();
    expect(world.getSkyLight(8, 11, 7)).toBe(0);

    // Break roof at (8, 16, 7)
    world.setBlock(8, 16, 7, BlockId.Air);

    // Direct vertical sky shaft should now be 15 all the way down to y=11!
    expect(world.getSkyLight(8, 15, 7)).toBe(15);
    expect(world.getSkyLight(8, 11, 7)).toBe(15);
    // Adjacent tiles decay horizontally by -1 per block
    expect(world.getSkyLight(9, 11, 7)).toBe(14);
    expect(world.getSkyLight(10, 11, 7)).toBe(13);
    expect(world.getSkyLight(12, 11, 7)).toBe(11);

    // Place Stone back at (8, 16, 7) -> dark again
    world.setBlock(8, 16, 7, BlockId.Stone);
    expect(world.getSkyLight(8, 15, 7)).toBe(0);
    expect(world.getSkyLight(8, 11, 7)).toBe(0);
    expect(world.getSkyLight(10, 11, 7)).toBe(0);
  });

  it('WaterFlowSystem spreads finitely from source and drains when source is removed', () => {
    const bus = new EventBus();
    const world = new World(99, bus);
    world.setChunk(new Chunk(0, 0));
    const waterFlow = new WaterFlowSystem();

    // Flat stone floor at y = 20
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        world.setBlock(x, 20, z, BlockId.Stone);
      }
    }

    bus.on('block:changed', ({ x, y, z }) => waterFlow.enqueueArea(x, y, z));

    // Place single water source at (8, 21, 8)
    world.setBlock(8, 21, 8, BlockId.Water, 0);
    for (let t = 0; t < 60; t++) waterFlow.tick(world);

    const maxDist = BALANCE.water.maxSpreadDistance;
    expect(world.getBlock(8 + maxDist, 21, 8)).toBe(BlockId.Water);
    expect(world.getMeta(8 + maxDist, 21, 8)).toBe(maxDist);
    // Beyond maxSpreadDistance must stay Air!
    expect(world.getBlock(8 + maxDist + 1, 21, 8)).toBe(BlockId.Air);

    // Remove source -> flowing water drains away cleanly
    world.setBlock(8, 21, 8, BlockId.Air, 0);
    for (let t = 0; t < 100; t++) waterFlow.tick(world);
    expect(world.getBlock(9, 21, 8)).toBe(BlockId.Air);
    expect(world.getBlock(8 + maxDist, 21, 8)).toBe(BlockId.Air);
  });
});
