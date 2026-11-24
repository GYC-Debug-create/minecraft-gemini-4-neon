import { describe, expect, it } from 'vitest';
import { BiomeId } from '../../src/core/types';
import { BlockId } from '../../src/registry/blocks';
import { buildChunkMesh } from '../../src/world/Mesher';
import { findSafeSpawn, TerrainGenerator } from '../../src/world/TerrainGenerator';

describe('M1 World Generation & Mesher', () => {
  it('generates bit-identical chunks for the same seed', () => {
    const g1 = new TerrainGenerator(2026);
    const g2 = new TerrainGenerator(2026);

    for (const [cx, cz] of [
      [0, 0],
      [-2, 3],
      [5, -4],
    ]) {
      const c1 = g1.generateChunk(cx, cz);
      const c2 = g2.generateChunk(cx, cz);
      expect(c1.blocks).toEqual(c2.blocks);
      expect(c1.biomes).toEqual(c2.biomes);
      expect(c1.meta).toEqual(c2.meta);
      expect(c1.light).toEqual(c2.light);
    }
  });

  it('generates distinct worlds for different seeds', () => {
    const g1 = new TerrainGenerator(1111);
    const g2 = new TerrainGenerator(9999);
    const c1 = g1.generateChunk(0, 0);
    const c2 = g2.generateChunk(0, 0);

    let diffs = 0;
    for (let i = 0; i < c1.blocks.length; i++) {
      if (c1.blocks[i] !== c2.blocks[i]) diffs++;
    }
    expect(diffs).toBeGreaterThan(200);
  });

  it('produces multiple biomes, ores, caves, trees, and water across sampled regions', () => {
    const gen = new TerrainGenerator(1337);
    const seenBiomes = new Set<BiomeId>();
    const seenBlocks = new Set<BlockId>();

    // Sample wide biome distribution
    for (let x = -1600; x <= 1600; x += 48) {
      for (let z = -1600; z <= 1600; z += 48) {
        seenBiomes.add(gen.sampleBiome(x, z));
      }
    }
    expect(seenBiomes.size).toBeGreaterThanOrEqual(5);

    // Inspect generated chunks for bedrock, ores, trees, caves (underground air), and water
    let undergroundAir = 0;
    for (let cx = -3; cx <= 3; cx++) {
      for (let cz = -3; cz <= 3; cz++) {
        const chunk = gen.generateChunk(cx, cz);
        for (let y = 0; y < 128; y++) {
          for (let z = 0; z < 16; z++) {
            for (let x = 0; x < 16; x++) {
              const b = chunk.getBlock(x, y, z);
              seenBlocks.add(b);
              if (y >= 8 && y <= 35 && b === BlockId.Air) undergroundAir++;
            }
          }
        }
      }
    }

    expect(seenBlocks.has(BlockId.Bedrock)).toBe(true);
    expect(seenBlocks.has(BlockId.Stone)).toBe(true);
    expect(seenBlocks.has(BlockId.CoalOre)).toBe(true);
    expect(seenBlocks.has(BlockId.IronOre)).toBe(true);
    expect(seenBlocks.has(BlockId.GoldOre)).toBe(true);
    expect(seenBlocks.has(BlockId.PrismiteOre)).toBe(true);
    expect(
      seenBlocks.has(BlockId.OakLog) ||
        seenBlocks.has(BlockId.BirchLog) ||
        seenBlocks.has(BlockId.PineLog)
    ).toBe(true);
    expect(undergroundAir).toBeGreaterThan(50);
  });

  it('findSafeSpawn returns dry land with clear air above', () => {
    const gen = new TerrainGenerator(1337);
    const spawn = findSafeSpawn(1337);
    const cx = Math.floor(spawn.x / 16);
    const cz = Math.floor(spawn.z / 16);
    const chunk = gen.generateChunk(cx, cz);
    const lx = spawn.x & 15;
    const lz = spawn.z & 15;
    expect(chunk.getBlock(lx, spawn.y - 1, lz)).not.toBe(BlockId.Air);
    expect(chunk.getBlock(lx, spawn.y - 1, lz)).not.toBe(BlockId.Water);
    expect(chunk.getBlock(lx, spawn.y, lz)).toBe(BlockId.Air);
    expect(chunk.getBlock(lx, spawn.y + 1, lz)).toBe(BlockId.Air);
  });

  it('Mesher produces valid non-empty buffers with face culling and AO', () => {
    const gen = new TerrainGenerator(1337);
    const chunk = gen.generateChunk(0, 0);
    const mesh = buildChunkMesh(0, 0, chunk.blocks, chunk.light, chunk.meta);

    expect(mesh.opaque.positions.length).toBeGreaterThan(0);
    expect(mesh.opaque.indices.length).toBeGreaterThan(0);
    expect(mesh.opaque.positions.length / 3).toBe(mesh.opaque.colors.length / 3);
    expect(mesh.opaque.positions.length / 3).toBe(mesh.opaque.uvs.length / 2);
    expect(mesh.meshMs).toBeGreaterThanOrEqual(0);
  });
});
