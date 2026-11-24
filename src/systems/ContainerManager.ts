import { BALANCE } from '../config/balance';
import { CHEST_SIZE } from '../config/constants';
import { BlockPos, ContainerSnapshot, ItemStack } from '../core/types';
import { ItemRegistry } from '../registry/items';
import { generateVillageChestLoot } from '../registry/loot';
import { findSmeltingRecipe } from '../registry/recipes';
import { cloneStack, createItemStack } from '../player/Inventory';

export interface ChestContainer {
  type: 'chest';
  pos: BlockPos;
  slots: Array<ItemStack | null>;
  /** Optional lazy village loot seed: loot is rolled ONCE on first open, then persisted normally */
  lootSeed?: number;
  lootGenerated?: boolean;
}

export interface FurnaceContainer {
  type: 'furnace';
  pos: BlockPos;
  input: ItemStack | null;
  fuel: ItemStack | null;
  output: ItemStack | null;
  burnTime: number;
  burnTimeMax: number;
  smeltProgress: number;
  smeltTimeMax: number;
}

export type StoredContainer = ChestContainer | FurnaceContainer;

export function containerKey(x: number, y: number, z: number): string {
  return `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
}

export class ContainerManager {
  private readonly containers = new Map<string, StoredContainer>();

  clear(): void {
    this.containers.clear();
  }

  get(x: number, y: number, z: number): StoredContainer | undefined {
    return this.containers.get(containerKey(x, y, z));
  }

  remove(x: number, y: number, z: number): StoredContainer | undefined {
    const key = containerKey(x, y, z);
    const existing = this.containers.get(key);
    this.containers.delete(key);
    return existing;
  }

  /** Registers a village chest with a deterministic loot seed (loot generated lazily on first open). */
  registerVillageChest(x: number, y: number, z: number, lootSeed: number): void {
    const key = containerKey(x, y, z);
    if (this.containers.has(key)) return;
    this.containers.set(key, {
      type: 'chest',
      pos: { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) },
      slots: new Array(CHEST_SIZE).fill(null),
      lootSeed,
      lootGenerated: false,
    });
  }

  getOrCreateChest(x: number, y: number, z: number): ChestContainer {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const key = containerKey(ix, iy, iz);
    const existing = this.containers.get(key);
    if (existing && existing.type === 'chest') {
      if (existing.lootSeed !== undefined && !existing.lootGenerated) {
        existing.slots = generateVillageChestLoot(existing.lootSeed);
        existing.lootGenerated = true;
      }
      return existing;
    }
    const created: ChestContainer = {
      type: 'chest',
      pos: { x: ix, y: iy, z: iz },
      slots: new Array(CHEST_SIZE).fill(null),
    };
    this.containers.set(key, created);
    return created;
  }

  getOrCreateFurnace(x: number, y: number, z: number): FurnaceContainer {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const key = containerKey(ix, iy, iz);
    const existing = this.containers.get(key);
    if (existing && existing.type === 'furnace') return existing;
    const created: FurnaceContainer = {
      type: 'furnace',
      pos: { x: ix, y: iy, z: iz },
      input: null,
      fuel: null,
      output: null,
      burnTime: 0,
      burnTimeMax: 0,
      smeltProgress: 0,
      smeltTimeMax: BALANCE.furnace.smeltTicks,
    };
    this.containers.set(key, created);
    return created;
  }

  /** Extracts all items inside a container (when chest/furnace block is broken). */
  extractDropsOnBreak(x: number, y: number, z: number): ItemStack[] {
    const c = this.remove(x, y, z);
    if (!c) return [];
    const drops: ItemStack[] = [];
    if (c.type === 'chest') {
      if (c.lootSeed !== undefined && !c.lootGenerated) {
        c.slots = generateVillageChestLoot(c.lootSeed);
        c.lootGenerated = true;
      }
      for (const s of c.slots) {
        if (s) drops.push(s);
      }
    } else {
      if (c.input) drops.push(c.input);
      if (c.fuel) drops.push(c.fuel);
      if (c.output) drops.push(c.output);
    }
    return drops;
  }

  /** Advances all active furnaces by `ticks` simulation ticks (20 TPS). */
  tickFurnaces(ticks = 1): void {
    for (const c of this.containers.values()) {
      if (c.type !== 'furnace') continue;
      for (let t = 0; t < ticks; t++) {
        this.stepSingleFurnace(c);
      }
    }
  }

  private stepSingleFurnace(f: FurnaceContainer): void {
    const recipe = f.input ? findSmeltingRecipe(f.input.itemId) : undefined;
    const canOutput =
      recipe !== undefined &&
      (f.output === null ||
        (f.output.itemId === recipe.output &&
          f.output.count + recipe.outputCount <= (ItemRegistry.get(recipe.output)?.maxStack ?? 64)));

    // Ignite new fuel if needed and smelting is possible
    if (f.burnTime <= 0 && canOutput && f.fuel) {
      const fuelDef = ItemRegistry.get(f.fuel.itemId);
      const fuelTicks = fuelDef?.fuelTicks ?? 0;
      if (fuelTicks > 0) {
        f.burnTime = fuelTicks;
        f.burnTimeMax = fuelTicks;
        f.fuel.count--;
        if (f.fuel.count <= 0) f.fuel = null;
      }
    }

    if (f.burnTime > 0) {
      f.burnTime--;
      if (canOutput && recipe && f.input) {
        f.smeltProgress++;
        if (f.smeltProgress >= f.smeltTimeMax) {
          f.smeltProgress = 0;
          f.input.count--;
          if (f.input.count <= 0) f.input = null;
          if (!f.output) {
            f.output = createItemStack(recipe.output, recipe.outputCount);
          } else {
            f.output.count += recipe.outputCount;
          }
        }
      } else {
        f.smeltProgress = 0;
      }
    } else {
      f.smeltProgress = Math.max(0, f.smeltProgress - 2);
    }
  }

  toSnapshot(c: StoredContainer): ContainerSnapshot {
    if (c.type === 'chest') {
      return {
        type: 'chest',
        pos: { ...c.pos },
        slots: c.slots.map(cloneStack),
      };
    }
    return {
      type: 'furnace',
      pos: { ...c.pos },
      furnace: {
        input: cloneStack(c.input),
        fuel: cloneStack(c.fuel),
        output: cloneStack(c.output),
        burnTime: c.burnTime,
        burnTimeMax: c.burnTimeMax,
        smeltProgress: c.smeltProgress,
        smeltTimeMax: c.smeltTimeMax,
      },
    };
  }

  serializeAll(): StoredContainer[] {
    const out: StoredContainer[] = [];
    for (const c of this.containers.values()) {
      if (c.type === 'chest') {
        out.push({
          type: 'chest',
          pos: { ...c.pos },
          slots: c.slots.map(cloneStack),
          ...(c.lootSeed !== undefined ? { lootSeed: c.lootSeed } : {}),
          ...(c.lootGenerated !== undefined ? { lootGenerated: c.lootGenerated } : {}),
        });
      } else {
        out.push({
          type: 'furnace',
          pos: { ...c.pos },
          input: cloneStack(c.input),
          fuel: cloneStack(c.fuel),
          output: cloneStack(c.output),
          burnTime: c.burnTime,
          burnTimeMax: c.burnTimeMax,
          smeltProgress: c.smeltProgress,
          smeltTimeMax: c.smeltTimeMax,
        });
      }
    }
    return out;
  }

  loadAll(records: StoredContainer[]): void {
    this.containers.clear();
    for (const rec of records) {
      const key = containerKey(rec.pos.x, rec.pos.y, rec.pos.z);
      if (rec.type === 'chest') {
        this.containers.set(key, {
          type: 'chest',
          pos: { ...rec.pos },
          slots: rec.slots.map(cloneStack),
          lootSeed: rec.lootSeed,
          lootGenerated: rec.lootGenerated,
        });
      } else {
        this.containers.set(key, {
          type: 'furnace',
          pos: { ...rec.pos },
          input: cloneStack(rec.input),
          fuel: cloneStack(rec.fuel),
          output: cloneStack(rec.output),
          burnTime: rec.burnTime,
          burnTimeMax: rec.burnTimeMax,
          smeltProgress: rec.smeltProgress,
          smeltTimeMax: rec.smeltTimeMax || BALANCE.furnace.smeltTicks,
        });
      }
    }
  }
}
