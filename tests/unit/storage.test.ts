import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { CURRENT_SAVE_VERSION } from '../../src/config/constants';
import { BiomeId } from '../../src/core/types';
import { BlockId } from '../../src/registry/blocks';
import { ItemId } from '../../src/registry/items';
import { SaveManager } from '../../src/storage/SaveManager';
import { migrateWorldSave, WorldSaveV2 } from '../../src/storage/schema';
import { Chunk } from '../../src/world/Chunk';

describe('M7 IndexedDB Persistence & Schema Migration', () => {
  it('saves and reloads modified chunks, player inventory, containers, and settings accurately', async () => {
    const dbName = `stoneroot-test-${Date.now()}-${Math.random()}`;
    const sm = new SaveManager(dbName);

    await sm.saveSettings({
      renderDistance: 6,
      fov: 90,
      mouseSensitivity: 1.45,
      volume: 0.4,
    });
    const loadedSettings = await sm.loadSettings();
    expect(loadedSettings).toEqual({
      renderDistance: 6,
      fov: 90,
      mouseSensitivity: 1.45,
      volume: 0.4,
    });

    const chunk = new Chunk(2, -1);
    chunk.setBlock(5, 65, 7, BlockId.OakPlanks, 0);
    chunk.setBiome(5, 7, BiomeId.Forest);
    chunk.modified = true;

    const save: WorldSaveV2 = {
      version: CURRENT_SAVE_VERSION,
      worldId: 'world-test-1',
      name: 'Test World',
      seed: 1337,
      worldTime: 9400,
      savedAt: Date.now(),
      player: {
        pos: { x: 37.5, y: 66, z: -9.5 },
        yaw: 1.2,
        pitch: -0.3,
        health: 17,
        hunger: 15,
        saturation: 3,
        oxygen: 20,
        spawnPoint: { x: 0.5, y: 65, z: 0.5 },
        deathCount: 1,
        inventory: {
          selectedSlot: 2,
          slots: [
            { itemId: ItemId.IronPickaxe, count: 1, durability: 210 },
            { itemId: ItemId.OakPlanks, count: 18 },
            ...new Array(34).fill(null),
          ],
          armor: {
            helmet: { itemId: ItemId.IronHelmet, count: 1, durability: 150 },
            chestplate: null,
            leggings: null,
            boots: null,
          },
        },
      },
      containers: [
        {
          type: 'chest',
          pos: { x: 36, y: 65, z: -9 },
          slots: [{ itemId: ItemId.Bread, count: 5 }, ...new Array(26).fill(null)],
        },
      ],
    };

    await sm.saveWorld(save, [chunk.serialize()]);

    const loaded = await sm.loadLatestWorld();
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    expect(loaded.migrated).toBe(false);
    expect(loaded.world.seed).toBe(1337);
    expect(loaded.world.worldTime).toBe(9400);
    expect(loaded.world.player.health).toBe(17);
    expect(loaded.world.player.inventory.slots[0]).toEqual({
      itemId: ItemId.IronPickaxe,
      count: 1,
      durability: 210,
    });
    expect(loaded.world.player.inventory.armor.helmet?.itemId).toBe(ItemId.IronHelmet);
    expect(loaded.world.containers.length).toBe(1);
    const chest = loaded.world.containers[0];
    expect(chest.type === 'chest' && chest.slots[0]?.itemId).toBe(ItemId.Bread);

    const restoredChunk = loaded.chunks.get('2,-1');
    expect(restoredChunk).toBeDefined();
    expect(Chunk.deserialize(restoredChunk!).getBlock(5, 65, 7)).toBe(BlockId.OakPlanks);

    await sm.close();
  });

  it('migrates legacy v1 save to v2 cleanly and safely rejects corrupt/future versions without crashing', async () => {
    const v1Raw = {
      version: 1,
      worldId: 'legacy-1',
      seed: 4242,
      worldTime: 4000,
      savedAt: 1000,
      player: {
        pos: { x: 1, y: 65, z: 2 },
        inventory: {
          selectedSlot: 0,
          slots: [{ itemId: ItemId.OakLog, count: 4 }],
        },
      },
    };
    const mig = migrateWorldSave(v1Raw);
    expect(mig.ok).toBe(true);
    if (mig.ok) {
      expect(mig.migrated).toBe(true);
      expect(mig.data.version).toBe(CURRENT_SAVE_VERSION);
      expect(mig.data.player.inventory.slots.length).toBe(36);
      expect(mig.data.player.inventory.armor.helmet).toBeNull();
      expect(mig.data.containers).toEqual([]);
    }

    // Future unsupported version returns ok: false safely
    const future = migrateWorldSave({ version: 99, seed: 123, player: { pos: { x: 0, y: 64, z: 0 } } });
    expect(future.ok).toBe(false);

    // Corrupt record stored in IndexedDB does not throw
    const dbName = `stoneroot-corrupt-${Date.now()}-${Math.random()}`;
    const sm = new SaveManager(dbName);
    await sm.putRawWorldRecord({ worldId: 'bad', version: 99, savedAt: Date.now() });
    const res = await sm.loadLatestWorld();
    expect(res.ok).toBe(false);
    await sm.close();
  });
});
