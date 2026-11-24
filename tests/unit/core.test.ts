import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/events';
import { NoiseGenerator } from '../../src/core/noise';
import { hash2D, SeededRNG, stringToSeed } from '../../src/core/rng';
import { BiomeId, ToolTier, ToolType } from '../../src/core/types';
import { EntitySystem } from '../../src/entities/EntitySystem';
import { BlockId, BlockRegistry } from '../../src/registry/blocks';
import { ItemId, ItemRegistry } from '../../src/registry/items';
import { Chunk, worldToChunkCoord, worldToLocalCoord } from '../../src/world/Chunk';
import { World } from '../../src/world/World';

describe('M0 Core Architecture', () => {
  it('BlockRegistry and ItemRegistry have consistent unique definitions', () => {
    const blocks = BlockRegistry.all();
    expect(blocks.length).toBeGreaterThan(30);
    const blockKeys = new Set(blocks.map((b) => b.key));
    expect(blockKeys.size).toBe(blocks.length);

    expect(BlockRegistry.get(BlockId.Stone).toolType).toBe(ToolType.Pickaxe);
    expect(BlockRegistry.get(BlockId.Stone).minToolTier).toBe(ToolTier.Wood);
    expect(BlockRegistry.get(BlockId.IronOre).minToolTier).toBe(ToolTier.Stone);
    expect(BlockRegistry.get(BlockId.Torch).lightEmission).toBe(14);
    expect(BlockRegistry.get(BlockId.StoneSlab).height).toBe(0.5);

    const items = ItemRegistry.all();
    const itemKeys = new Set(items.map((i) => i.key));
    expect(itemKeys.size).toBe(items.length);
    expect(ItemRegistry.get(ItemId.PrismitePickaxe)?.toolTier).toBe(ToolTier.Prismite);
    expect(ItemRegistry.get(ItemId.IronPickaxe)?.maxStack).toBe(1);
    expect(ItemRegistry.get(ItemId.OakPlanks)?.maxStack).toBe(64);
  });

  it('SeededRNG and NoiseGenerator are strictly deterministic', () => {
    expect(stringToSeed('stoneroot-42')).toBe(stringToSeed('stoneroot-42'));
    expect(hash2D(123, -10, 45)).toBe(hash2D(123, -10, 45));

    const r1 = new SeededRNG(999);
    const r2 = new SeededRNG(999);
    for (let i = 0; i < 50; i++) {
      expect(r1.next()).toBe(r2.next());
    }

    const n1 = new NoiseGenerator(4242);
    const n2 = new NoiseGenerator(4242);
    for (let i = -5; i <= 5; i++) {
      expect(n1.fbm2D(i * 0.13, i * -0.07)).toBe(n2.fbm2D(i * 0.13, i * -0.07));
      expect(n1.fbm3D(i * 0.1, i * 0.2, i * 0.3)).toBe(n2.fbm3D(i * 0.1, i * 0.2, i * 0.3));
    }
  });

  it('Chunk coordinate mapping and serialization preserve negative coordinates and data', () => {
    expect(worldToChunkCoord(-1)).toBe(-1);
    expect(worldToLocalCoord(-1)).toBe(15);
    expect(worldToChunkCoord(-16)).toBe(-1);
    expect(worldToLocalCoord(-16)).toBe(0);

    const c = new Chunk(-2, 3);
    c.setBlock(4, 65, 9, BlockId.PrismiteOre, 3);
    c.setSkyLight(4, 66, 9, 12);
    c.setBlockLight(4, 66, 9, 9);
    c.setBiome(4, 9, BiomeId.Mountains);

    expect(c.getBlock(4, 65, 9)).toBe(BlockId.PrismiteOre);
    expect(c.getMeta(4, 65, 9)).toBe(3);
    expect(c.getSkyLight(4, 66, 9)).toBe(12);
    expect(c.getBlockLight(4, 66, 9)).toBe(9);
    expect(c.getBiome(4, 9)).toBe(BiomeId.Mountains);

    const restored = Chunk.deserialize(c.serialize());
    expect(restored.getBlock(4, 65, 9)).toBe(BlockId.PrismiteOre);
    expect(restored.getMeta(4, 65, 9)).toBe(3);
    expect(restored.getBiome(4, 9)).toBe(BiomeId.Mountains);
  });

  it('World reads/writes across chunks and emits block:changed events', () => {
    const bus = new EventBus();
    const events: Array<{ x: number; y: number; z: number; newId: BlockId }> = [];
    bus.on('block:changed', (e) => events.push({ x: e.x, y: e.y, z: e.z, newId: e.newId }));

    const world = new World(777, bus);
    world.setChunk(new Chunk(-1, 0));
    world.setChunk(new Chunk(0, 0));

    expect(world.setBlock(-1, 50, 2, BlockId.Cobblestone)).toBe(true);
    expect(world.getBlock(-1, 50, 2)).toBe(BlockId.Cobblestone);
    expect(world.getChunk(-1, 0)?.modified).toBe(true);
    expect(world.getChunk(0, 0)?.dirty).toBe(true);
    expect(events).toEqual([{ x: -1, y: 50, z: 2, newId: BlockId.Cobblestone }]);
  });

  it('EntitySystem manages entity lifecycle cleanly', () => {
    const bus = new EventBus();
    const sys = new EntitySystem(bus);
    let ticks = 0;
    const id = sys.allocateId();
    sys.add({
      id,
      kind: 'boar',
      pos: { x: 0, y: 65, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      yaw: 0,
      width: 0.8,
      height: 0.8,
      alive: true,
      ageTicks: 0,
      update() {
        ticks++;
        if (ticks >= 3) this.alive = false;
      },
      toSnapshot() {
        return { id: this.id, kind: this.kind, pos: { ...this.pos } };
      },
    });

    expect(sys.count()).toBe(1);
    sys.update(0.05);
    sys.update(0.05);
    expect(sys.count()).toBe(1);
    sys.update(0.05);
    expect(sys.count()).toBe(0);
  });
});
