import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/config/balance';
import { FIXED_DT } from '../../src/config/constants';
import { ItemStack } from '../../src/core/types';
import { MobEntity } from '../../src/entities/Mob';
import { canHostileSpawnAt } from '../../src/entities/MobSpawner';
import { findPath } from '../../src/entities/Pathfinding';
import { BlockId } from '../../src/registry/blocks';
import { ItemId } from '../../src/registry/items';
import { Chunk } from '../../src/world/Chunk';
import { recomputeWorldLighting } from '../../src/world/Lighting';
import { World } from '../../src/world/World';

function createFlatWorld(): World {
  const world = new World(321);
  world.setChunk(new Chunk(0, 0));
  world.setChunk(new Chunk(1, 0));
  for (let x = 0; x < 32; x++) {
    for (let z = 0; z < 16; z++) {
      world.setBlock(x, 10, z, BlockId.Stone);
    }
  }
  recomputeWorldLighting(world);
  return world;
}

describe('M6 Mobs, Spawning Rules & Bounded A* Pathfinding', () => {
  it('hostile mobs NEVER spawn on blocks with effective light >= hostileMaxLight threshold', () => {
    const world = createFlatWorld();

    // Daytime outdoor surface has skyLight === 15 -> NEVER spawns hostiles
    expect(canHostileSpawnAt(world, 8, 11, 8, true)).toBe(false);

    // Nighttime dark surface (blockLight === 0) -> CAN spawn hostiles
    expect(canHostileSpawnAt(world, 8, 11, 8, false)).toBe(true);

    // Place a Torch at (8, 11, 8): every cell with blockLight >= 7 (Manhattan dist <= 7) MUST NEVER spawn hostiles even at midnight!
    world.setBlock(8, 11, 8, BlockId.Torch);
    recomputeWorldLighting(world);

    for (let x = 1; x <= 15; x++) {
      for (let z = 1; z <= 15; z++) {
        if (x === 8 && z === 8) continue;
        const blk = world.getBlockLight(x, 11, z);
        if (blk >= BALANCE.mobs.hostileMaxLight) {
          expect(canHostileSpawnAt(world, x, 11, z, false)).toBe(false);
        }
      }
    }

    // Explicitly test every threshold value 0..15
    for (let lv = 0; lv <= 15; lv++) {
      world.setBlockLight(24, 11, 8, lv);
      const allowed = canHostileSpawnAt(world, 24, 11, 8, false);
      if (lv >= BALANCE.mobs.hostileMaxLight) {
        expect(allowed).toBe(false);
      } else {
        expect(allowed).toBe(true);
      }
    }
  });

  it('A* pathfinding routes cleanly around a solid obstacle wall', () => {
    const world = createFlatWorld();
    // Solid barrier wall across x = 10, z in [2..12], height 3 (gap at z = 1 and z = 13)
    for (let z = 2; z <= 12; z++) {
      for (let y = 11; y <= 13; y++) {
        world.setBlock(10, y, z, BlockId.Cobblestone);
      }
    }

    const res = findPath(
      world,
      { x: 6, y: 11, z: 7 },
      { x: 14, y: 11, z: 7 },
      { maxNodes: 240 }
    );

    expect(res.reached).toBe(true);
    expect(res.path.length).toBeGreaterThan(8);
    // Every waypoint must be open air (never clipping through the wall at x=10, z=2..12)
    for (const wp of res.path) {
      expect(world.getBlock(wp.x, wp.y, wp.z)).toBe(BlockId.Air);
      if (wp.x === 10) {
        expect(wp.z < 2 || wp.z > 12).toBe(true);
      }
    }
  });

  it('A* pathfinding strictly enforces maxNodes search cap on unreachable goal', () => {
    const world = createFlatWorld();
    // Completely enclose goal (20, 11, 8) in a 3-high stone vault
    for (let x = 18; x <= 22; x++) {
      for (let z = 6; z <= 10; z++) {
        if (x === 18 || x === 22 || z === 6 || z === 10) {
          for (let y = 11; y <= 14; y++) world.setBlock(x, y, z, BlockId.Stone);
        }
        world.setBlock(x, 14, z, BlockId.Stone);
      }
    }

    const cap = 55;
    const res = findPath(world, { x: 4, y: 11, z: 8 }, { x: 20, y: 11, z: 8 }, { maxNodes: cap });
    expect(res.reached).toBe(false);
    expect(res.nodesExplored).toBeLessThanOrEqual(cap);
  });

  it('mobs respect invincibility frames, knockback, daylight burning, and drop tables', () => {
    const world = createFlatWorld();
    let dropped: ItemStack[] = [];

    const husk = new MobEntity(
      1,
      'husk',
      { x: 6.5, y: 11.0, z: 6.5 },
      {
        world,
        getPlayerPos: () => ({ x: 15, y: 11, z: 6 }),
        isPlayerAlive: () => true,
        isDaytime: () => true,
        onDamagePlayer: () => {},
        onShootArrow: () => {},
        onMobDied: (_m, d) => { dropped = d; },
      },
      777
    );

    // Hit with knockback + verify immediate second hit blocked by i-frames
    expect(husk.takeDamage(6, { x: 1, y: 0, z: 0 })).toBe(true);
    expect(husk.health).toBe(14);
    expect(husk.takeDamage(6, { x: 1, y: 0, z: 0 })).toBe(false);

    // Step in bright daylight -> Ash Husk catches fire and takes sun burn damage
    for (let t = 0; t < 30; t++) husk.update(FIXED_DT);
    expect(husk.burning).toBe(true);
    expect(husk.health).toBeLessThan(14);

    // Finish killing -> drops Rotten Flesh
    husk.invincibilityTicks = 0;
    husk.takeDamage(100, { x: 1, y: 0, z: 0 });
    expect(husk.alive).toBe(false);
    expect(dropped.some((d) => d.itemId === ItemId.RottenFlesh)).toBe(true);
  });
});
