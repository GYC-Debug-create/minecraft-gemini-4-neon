import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/config/balance';
import { ItemStack } from '../../src/core/types';
import { createItemStack, Inventory } from '../../src/player/Inventory';
import { ItemId } from '../../src/registry/items';
import { ContainerManager } from '../../src/systems/ContainerManager';
import {
  consumeCraftingGrid,
  craftRecipeFromInventory,
  matchCraftingGrid,
} from '../../src/systems/CraftingSystem';

describe('M4 Inventory, Crafting & Furnace', () => {
  it('stacks up to 64, keeps tools non-stackable with durability, supports split and shift transfer', () => {
    const inv = new Inventory();
    expect(inv.addItem(ItemId.Cobblestone, 70)).toBe(0);
    expect(inv.slots[0]?.count).toBe(64);
    expect(inv.slots[1]?.count).toBe(6);

    // Right-click split half from slot 0 (64 -> 32 & 32) into slot 2
    const splitOk = Inventory.transferBetween(
      () => inv.slots[0],
      (v) => { inv.slots[0] = v; },
      () => inv.slots[2],
      (v) => { inv.slots[2] = v; },
      true
    );
    expect(splitOk).toBe(true);
    expect(inv.slots[0]?.count).toBe(32);
    expect(inv.slots[2]?.count).toBe(32);

    // Shift quick-transfer moves hotbar slot 0 into main inventory (9..35)
    expect(inv.shiftQuickTransfer(0)).toBe(true);
    expect(inv.slots[0]).toBeNull();
    expect(inv.slots[9]?.count).toBe(32);

    // Tools don't stack and wear durability until breaking
    inv.addItem(ItemId.WoodPickaxe, 1);
    inv.addItem(ItemId.WoodPickaxe, 1);
    expect(inv.slots[0]?.itemId).toBe(ItemId.WoodPickaxe);
    expect(inv.slots[0]?.count).toBe(1);
    expect(inv.slots[0]?.durability).toBe(BALANCE.tools.durabilityByTier[1]);

    inv.selectHotbar(0);
    const maxDur = inv.slots[0]!.durability!;
    for (let i = 0; i < maxDur - 1; i++) {
      expect(inv.damageSelectedTool(1)).toBe(false);
    }
    expect(inv.damageSelectedTool(1)).toBe(true);
    expect(inv.slots[0]).toBeNull();
  });

  it('matches 2x2 shapeless/shaped and 3x3 shaped recipes accurately (including mirrored patterns)', () => {
    // 2x2 shapeless: 1 OakLog -> 4 OakPlanks
    const grid2: Array<ItemStack | null> = [null, createItemStack(ItemId.OakLog, 1), null, null];
    const planksMatch = matchCraftingGrid(grid2, 2);
    expect(planksMatch?.recipe.id).toBe('oak_planks');
    expect(planksMatch?.output).toEqual({ itemId: ItemId.OakPlanks, count: 4 });

    // 2x2 shaped: 4 planks -> Workbench
    const benchGrid = [
      createItemStack(ItemId.OakPlanks, 1),
      createItemStack(ItemId.BirchPlanks, 1),
      createItemStack(ItemId.OakPlanks, 1),
      createItemStack(ItemId.PinePlanks, 1),
    ];
    expect(matchCraftingGrid(benchGrid, 2)?.recipe.id).toBe('workbench');

    // 3x3 shaped: Stone Pickaxe requires workbench (must fail on 2x2, succeed on 3x3)
    const pickGrid: Array<ItemStack | null> = [
      createItemStack(ItemId.Cobblestone, 1),
      createItemStack(ItemId.Cobblestone, 1),
      createItemStack(ItemId.Cobblestone, 1),
      null,
      createItemStack(ItemId.Stick, 1),
      null,
      null,
      createItemStack(ItemId.Stick, 1),
      null,
    ];
    const pickMatch = matchCraftingGrid(pickGrid, 3);
    expect(pickMatch?.recipe.id).toBe('stone_pickaxe');
    expect(pickMatch?.output.itemId).toBe(ItemId.StonePickaxe);

    consumeCraftingGrid(pickGrid);
    expect(pickGrid.every((s) => s === null)).toBe(true);

    // Mirrored Axe pattern on 3x3
    const mirroredAxe: Array<ItemStack | null> = [
      null,
      createItemStack(ItemId.IronIngot, 1),
      createItemStack(ItemId.IronIngot, 1),
      null,
      createItemStack(ItemId.Stick, 1),
      createItemStack(ItemId.IronIngot, 1),
      null,
      createItemStack(ItemId.Stick, 1),
      null,
    ];
    expect(matchCraftingGrid(mirroredAxe, 3)?.recipe.id).toBe('iron_axe');
  });

  it('enforces workbench gate and ingredient consumption in craftRecipeFromInventory', () => {
    const inv = new Inventory();
    inv.addItem(ItemId.OakLog, 2);

    // Without workbench: planks, sticks, workbench all succeed
    expect(craftRecipeFromInventory(inv, 'oak_planks', false)).toBe(true);
    expect(inv.countItem(ItemId.OakPlanks)).toBe(4);
    expect(craftRecipeFromInventory(inv, 'oak_planks', false)).toBe(true);
    expect(inv.countItem(ItemId.OakPlanks)).toBe(8);
    expect(craftRecipeFromInventory(inv, 'sticks', false)).toBe(true);
    expect(inv.countItem(ItemId.Stick)).toBe(4);

    // Wood pickaxe requires workbench -> fails without workbench, succeeds with workbench
    expect(craftRecipeFromInventory(inv, 'wood_pickaxe', false)).toBe(false);
    expect(craftRecipeFromInventory(inv, 'wood_pickaxe', true)).toBe(true);
    expect(inv.countItem(ItemId.WoodPickaxe)).toBe(1);
  });

  it('furnace consumes fuel and smelts RawIron into IronIngot over smeltTicks', () => {
    const containers = new ContainerManager();
    const f = containers.getOrCreateFurnace(4, 65, 4);
    f.input = createItemStack(ItemId.RawIron, 3);
    f.fuel = createItemStack(ItemId.Coal, 1);

    // Tick enough for 3 items (3 * smeltTicks + buffer)
    containers.tickFurnaces(BALANCE.furnace.smeltTicks * 3 + 20);

    expect(f.input).toBeNull();
    expect(f.fuel).toBeNull(); // 1 coal ignited (1600 burn ticks > 3*160)
    expect(f.output?.itemId).toBe(ItemId.IronIngot);
    expect(f.output?.count).toBe(3);
  });
});
