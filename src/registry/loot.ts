import { CHEST_SIZE } from '../config/constants';
import { SeededRNG } from '../core/rng';
import { ItemStack } from '../core/types';
import { ItemId, ItemRegistry } from './items';

export interface LootEntry {
  itemId: ItemId;
  minCount: number;
  maxCount: number;
  weight: number;
}

export const VILLAGE_CHEST_LOOT_TABLE: readonly LootEntry[] = [
  { itemId: ItemId.Bread, minCount: 2, maxCount: 5, weight: 22 },
  { itemId: ItemId.GrainSeeds, minCount: 3, maxCount: 8, weight: 18 },
  { itemId: ItemId.Apple, minCount: 2, maxCount: 4, weight: 15 },
  { itemId: ItemId.IronIngot, minCount: 1, maxCount: 4, weight: 14 },
  { itemId: ItemId.Coal, minCount: 3, maxCount: 8, weight: 14 },
  { itemId: ItemId.WoodPickaxe, minCount: 1, maxCount: 1, weight: 8 },
  { itemId: ItemId.StonePickaxe, minCount: 1, maxCount: 1, weight: 8 },
  { itemId: ItemId.StoneAxe, minCount: 1, maxCount: 1, weight: 7 },
  { itemId: ItemId.StoneSword, minCount: 1, maxCount: 1, weight: 7 },
  { itemId: ItemId.IronHelmet, minCount: 1, maxCount: 1, weight: 4 },
  { itemId: ItemId.IronChestplate, minCount: 1, maxCount: 1, weight: 3 },
  { itemId: ItemId.IronBoots, minCount: 1, maxCount: 1, weight: 4 },
];

/**
 * Generates deterministic village chest contents lazily on first open.
 */
export function generateVillageChestLoot(lootSeed: number): Array<ItemStack | null> {
  const rng = new SeededRNG(lootSeed);
  const slots: Array<ItemStack | null> = new Array(CHEST_SIZE).fill(null);
  const totalWeight = VILLAGE_CHEST_LOOT_TABLE.reduce((acc, e) => acc + e.weight, 0);

  const rollCount = rng.int(4, 7);
  for (let i = 0; i < rollCount; i++) {
    let pick = rng.next() * totalWeight;
    let chosen = VILLAGE_CHEST_LOOT_TABLE[0];
    for (const entry of VILLAGE_CHEST_LOOT_TABLE) {
      pick -= entry.weight;
      if (pick <= 0) {
        chosen = entry;
        break;
      }
    }
    const def = ItemRegistry.get(chosen.itemId);
    const count = rng.int(chosen.minCount, chosen.maxCount);
    const stack: ItemStack = {
      itemId: chosen.itemId,
      count: def ? Math.min(count, def.maxStack) : count,
      ...(def?.durability ? { durability: def.durability } : {}),
    };

    // Pick an empty slot
    let slotIdx = rng.int(0, CHEST_SIZE - 1);
    for (let tries = 0; tries < CHEST_SIZE; tries++) {
      const idx = (slotIdx + tries) % CHEST_SIZE;
      if (slots[idx] === null) {
        slots[idx] = stack;
        break;
      }
    }
  }
  return slots;
}

export interface MobDropRule {
  itemId: ItemId;
  minCount: number;
  maxCount: number;
  chance: number;
}

export const MOB_DROP_TABLES: Record<string, readonly MobDropRule[]> = {
  boar: [
    { itemId: ItemId.RawPork, minCount: 1, maxCount: 3, chance: 1.0 },
    { itemId: ItemId.Leather, minCount: 1, maxCount: 2, chance: 0.75 },
  ],
  ram: [
    { itemId: ItemId.RawMutton, minCount: 1, maxCount: 2, chance: 1.0 },
    { itemId: ItemId.Wool, minCount: 1, maxCount: 2, chance: 1.0 },
  ],
  fowl: [
    { itemId: ItemId.RawFowl, minCount: 1, maxCount: 1, chance: 1.0 },
    { itemId: ItemId.Feather, minCount: 1, maxCount: 3, chance: 0.9 },
  ],
  husk: [{ itemId: ItemId.RottenFlesh, minCount: 1, maxCount: 2, chance: 1.0 }],
  bone_archer: [
    { itemId: ItemId.Bone, minCount: 1, maxCount: 2, chance: 1.0 },
    { itemId: ItemId.Arrow, minCount: 1, maxCount: 3, chance: 0.8 },
  ],
  gloom_spider: [{ itemId: ItemId.SilkThread, minCount: 1, maxCount: 2, chance: 1.0 }],
};

export function rollMobDrops(kind: string, rng: SeededRNG): ItemStack[] {
  const rules = MOB_DROP_TABLES[kind];
  if (!rules) return [];
  const drops: ItemStack[] = [];
  for (const r of rules) {
    if (rng.chance(r.chance)) {
      const count = rng.int(r.minCount, r.maxCount);
      if (count > 0) drops.push({ itemId: r.itemId, count });
    }
  }
  return drops;
}
