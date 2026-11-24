import { ItemId, ItemRegistry } from './items';

export type IngredientMatcher =
  | { kind: 'item'; itemId: ItemId }
  | { kind: 'tag'; tag: 'planks' | 'logs' };

export interface ShapedRecipe {
  id: string;
  kind: 'shaped';
  pattern: string[]; // rows of characters, space = empty
  key: Record<string, IngredientMatcher>;
  output: { itemId: ItemId; count: number };
  requiresWorkbench: boolean;
  category: 'basics' | 'blocks' | 'tools' | 'combat' | 'armor' | 'food';
}

export interface ShapelessRecipe {
  id: string;
  kind: 'shapeless';
  ingredients: IngredientMatcher[];
  output: { itemId: ItemId; count: number };
  requiresWorkbench: boolean;
  category: 'basics' | 'blocks' | 'tools' | 'combat' | 'armor' | 'food';
}

export type CraftingRecipe = ShapedRecipe | ShapelessRecipe;

export interface SmeltingRecipe {
  id: string;
  input: ItemId;
  output: ItemId;
  outputCount: number;
}

const ITEM = (itemId: ItemId): IngredientMatcher => ({ kind: 'item', itemId });
const PLANKS: IngredientMatcher = { kind: 'tag', tag: 'planks' };

export function matchesIngredient(itemId: ItemId | null, matcher: IngredientMatcher | null): boolean {
  if (matcher === null) return itemId === null;
  if (itemId === null) return false;
  if (matcher.kind === 'item') return itemId === matcher.itemId;
  if (matcher.tag === 'planks') return ItemRegistry.isPlank(itemId);
  if (matcher.tag === 'logs') return ItemRegistry.isLog(itemId);
  return false;
}

function toolSet(
  prefix: string,
  material: IngredientMatcher,
  ids: { pickaxe: ItemId; axe: ItemId; shovel: ItemId; sword: ItemId; hoe: ItemId }
): ShapedRecipe[] {
  const S = ITEM(ItemId.Stick);
  return [
    {
      id: `${prefix}_pickaxe`,
      kind: 'shaped',
      pattern: ['MMM', ' S ', ' S '],
      key: { M: material, S },
      output: { itemId: ids.pickaxe, count: 1 },
      requiresWorkbench: true,
      category: 'tools',
    },
    {
      id: `${prefix}_axe`,
      kind: 'shaped',
      pattern: ['MM', 'MS', ' S'],
      key: { M: material, S },
      output: { itemId: ids.axe, count: 1 },
      requiresWorkbench: true,
      category: 'tools',
    },
    {
      id: `${prefix}_shovel`,
      kind: 'shaped',
      pattern: ['M', 'S', 'S'],
      key: { M: material, S },
      output: { itemId: ids.shovel, count: 1 },
      requiresWorkbench: true,
      category: 'tools',
    },
    {
      id: `${prefix}_sword`,
      kind: 'shaped',
      pattern: ['M', 'M', 'S'],
      key: { M: material, S },
      output: { itemId: ids.sword, count: 1 },
      requiresWorkbench: true,
      category: 'combat',
    },
    {
      id: `${prefix}_hoe`,
      kind: 'shaped',
      pattern: ['MM', ' S', ' S'],
      key: { M: material, S },
      output: { itemId: ids.hoe, count: 1 },
      requiresWorkbench: true,
      category: 'tools',
    },
  ];
}

function armorSet(
  prefix: string,
  material: IngredientMatcher,
  ids: { helmet: ItemId; chestplate: ItemId; leggings: ItemId; boots: ItemId }
): ShapedRecipe[] {
  return [
    {
      id: `${prefix}_helmet`,
      kind: 'shaped',
      pattern: ['MMM', 'M M'],
      key: { M: material },
      output: { itemId: ids.helmet, count: 1 },
      requiresWorkbench: true,
      category: 'armor',
    },
    {
      id: `${prefix}_chestplate`,
      kind: 'shaped',
      pattern: ['M M', 'MMM', 'MMM'],
      key: { M: material },
      output: { itemId: ids.chestplate, count: 1 },
      requiresWorkbench: true,
      category: 'armor',
    },
    {
      id: `${prefix}_leggings`,
      kind: 'shaped',
      pattern: ['MMM', 'M M', 'M M'],
      key: { M: material },
      output: { itemId: ids.leggings, count: 1 },
      requiresWorkbench: true,
      category: 'armor',
    },
    {
      id: `${prefix}_boots`,
      kind: 'shaped',
      pattern: ['M M', 'M M'],
      key: { M: material },
      output: { itemId: ids.boots, count: 1 },
      requiresWorkbench: true,
      category: 'armor',
    },
  ];
}

export const CRAFTING_RECIPES: readonly CraftingRecipe[] = [
  // Basic 2x2 recipes
  {
    id: 'oak_planks',
    kind: 'shapeless',
    ingredients: [ITEM(ItemId.OakLog)],
    output: { itemId: ItemId.OakPlanks, count: 4 },
    requiresWorkbench: false,
    category: 'basics',
  },
  {
    id: 'birch_planks',
    kind: 'shapeless',
    ingredients: [ITEM(ItemId.BirchLog)],
    output: { itemId: ItemId.BirchPlanks, count: 4 },
    requiresWorkbench: false,
    category: 'basics',
  },
  {
    id: 'pine_planks',
    kind: 'shapeless',
    ingredients: [ITEM(ItemId.PineLog)],
    output: { itemId: ItemId.PinePlanks, count: 4 },
    requiresWorkbench: false,
    category: 'basics',
  },
  {
    id: 'sticks',
    kind: 'shaped',
    pattern: ['P', 'P'],
    key: { P: PLANKS },
    output: { itemId: ItemId.Stick, count: 4 },
    requiresWorkbench: false,
    category: 'basics',
  },
  {
    id: 'workbench',
    kind: 'shaped',
    pattern: ['PP', 'PP'],
    key: { P: PLANKS },
    output: { itemId: ItemId.Workbench, count: 1 },
    requiresWorkbench: false,
    category: 'basics',
  },
  {
    id: 'torch',
    kind: 'shaped',
    pattern: ['C', 'S'],
    key: { C: ITEM(ItemId.Coal), S: ITEM(ItemId.Stick) },
    output: { itemId: ItemId.Torch, count: 4 },
    requiresWorkbench: false,
    category: 'basics',
  },
  {
    id: 'bonemeal',
    kind: 'shapeless',
    ingredients: [ITEM(ItemId.Bone)],
    output: { itemId: ItemId.Bonemeal, count: 3 },
    requiresWorkbench: false,
    category: 'basics',
  },

  // Utility & Building blocks (3x3)
  {
    id: 'furnace',
    kind: 'shaped',
    pattern: ['CCC', 'C C', 'CCC'],
    key: { C: ITEM(ItemId.Cobblestone) },
    output: { itemId: ItemId.Furnace, count: 1 },
    requiresWorkbench: true,
    category: 'blocks',
  },
  {
    id: 'chest',
    kind: 'shaped',
    pattern: ['PPP', 'P P', 'PPP'],
    key: { P: PLANKS },
    output: { itemId: ItemId.Chest, count: 1 },
    requiresWorkbench: true,
    category: 'blocks',
  },
  {
    id: 'bed',
    kind: 'shaped',
    pattern: ['WWW', 'PPP'],
    key: { W: ITEM(ItemId.Wool), P: PLANKS },
    output: { itemId: ItemId.Bed, count: 1 },
    requiresWorkbench: true,
    category: 'blocks',
  },
  {
    id: 'wood_door',
    kind: 'shaped',
    pattern: ['PP', 'PP', 'PP'],
    key: { P: PLANKS },
    output: { itemId: ItemId.WoodDoor, count: 3 },
    requiresWorkbench: true,
    category: 'blocks',
  },
  {
    id: 'ladder',
    kind: 'shaped',
    pattern: ['S S', 'SSS', 'S S'],
    key: { S: ITEM(ItemId.Stick) },
    output: { itemId: ItemId.Ladder, count: 3 },
    requiresWorkbench: true,
    category: 'blocks',
  },
  {
    id: 'stone_slab',
    kind: 'shaped',
    pattern: ['SSS'],
    key: { S: ITEM(ItemId.Stone) },
    output: { itemId: ItemId.StoneSlab, count: 6 },
    requiresWorkbench: true,
    category: 'blocks',
  },
  {
    id: 'cobble_slab',
    kind: 'shaped',
    pattern: ['CCC'],
    key: { C: ITEM(ItemId.Cobblestone) },
    output: { itemId: ItemId.StoneSlab, count: 6 },
    requiresWorkbench: true,
    category: 'blocks',
  },
  {
    id: 'sandstone',
    kind: 'shaped',
    pattern: ['SS', 'SS'],
    key: { S: ITEM(ItemId.Sand) },
    output: { itemId: ItemId.Sandstone, count: 2 },
    requiresWorkbench: false,
    category: 'blocks',
  },
  {
    id: 'snow_brick',
    kind: 'shaped',
    pattern: ['SS', 'SS'],
    key: { S: ITEM(ItemId.SnowBlock) },
    output: { itemId: ItemId.SnowBrick, count: 4 },
    requiresWorkbench: false,
    category: 'blocks',
  },

  // Food
  {
    id: 'bread',
    kind: 'shaped',
    pattern: ['WWW'],
    key: { W: ITEM(ItemId.Wheat) },
    output: { itemId: ItemId.Bread, count: 1 },
    requiresWorkbench: true,
    category: 'food',
  },

  // Tools (4 tiers x 5 types)
  ...toolSet('wood', PLANKS, {
    pickaxe: ItemId.WoodPickaxe,
    axe: ItemId.WoodAxe,
    shovel: ItemId.WoodShovel,
    sword: ItemId.WoodSword,
    hoe: ItemId.WoodHoe,
  }),
  ...toolSet('stone', ITEM(ItemId.Cobblestone), {
    pickaxe: ItemId.StonePickaxe,
    axe: ItemId.StoneAxe,
    shovel: ItemId.StoneShovel,
    sword: ItemId.StoneSword,
    hoe: ItemId.StoneHoe,
  }),
  ...toolSet('iron', ITEM(ItemId.IronIngot), {
    pickaxe: ItemId.IronPickaxe,
    axe: ItemId.IronAxe,
    shovel: ItemId.IronShovel,
    sword: ItemId.IronSword,
    hoe: ItemId.IronHoe,
  }),
  ...toolSet('prismite', ITEM(ItemId.PrismiteGem), {
    pickaxe: ItemId.PrismitePickaxe,
    axe: ItemId.PrismiteAxe,
    shovel: ItemId.PrismiteShovel,
    sword: ItemId.PrismiteSword,
    hoe: ItemId.PrismiteHoe,
  }),

  // Ranged combat
  {
    id: 'bow',
    kind: 'shaped',
    pattern: [' ST', 'S T', ' ST'],
    key: { S: ITEM(ItemId.Stick), T: ITEM(ItemId.SilkThread) },
    output: { itemId: ItemId.Bow, count: 1 },
    requiresWorkbench: true,
    category: 'combat',
  },
  {
    id: 'arrows_stone',
    kind: 'shaped',
    pattern: ['C', 'S', 'F'],
    key: { C: ITEM(ItemId.Cobblestone), S: ITEM(ItemId.Stick), F: ITEM(ItemId.Feather) },
    output: { itemId: ItemId.Arrow, count: 4 },
    requiresWorkbench: true,
    category: 'combat',
  },
  {
    id: 'arrows_bone',
    kind: 'shaped',
    pattern: ['B', 'S', 'F'],
    key: { B: ITEM(ItemId.Bone), S: ITEM(ItemId.Stick), F: ITEM(ItemId.Feather) },
    output: { itemId: ItemId.Arrow, count: 4 },
    requiresWorkbench: true,
    category: 'combat',
  },

  // Armor
  ...armorSet('leather', ITEM(ItemId.Leather), {
    helmet: ItemId.LeatherHelmet,
    chestplate: ItemId.LeatherChestplate,
    leggings: ItemId.LeatherLeggings,
    boots: ItemId.LeatherBoots,
  }),
  ...armorSet('iron', ITEM(ItemId.IronIngot), {
    helmet: ItemId.IronHelmet,
    chestplate: ItemId.IronChestplate,
    leggings: ItemId.IronLeggings,
    boots: ItemId.IronBoots,
  }),
];

export const SMELTING_RECIPES: readonly SmeltingRecipe[] = [
  { id: 'smelt_iron', input: ItemId.RawIron, output: ItemId.IronIngot, outputCount: 1 },
  { id: 'smelt_gold', input: ItemId.RawGold, output: ItemId.GoldIngot, outputCount: 1 },
  { id: 'smelt_glass', input: ItemId.Sand, output: ItemId.Glass, outputCount: 1 },
  { id: 'smelt_stone', input: ItemId.Cobblestone, output: ItemId.Stone, outputCount: 1 },
  { id: 'cook_pork', input: ItemId.RawPork, output: ItemId.CookedPork, outputCount: 1 },
  { id: 'cook_mutton', input: ItemId.RawMutton, output: ItemId.CookedMutton, outputCount: 1 },
  { id: 'cook_fowl', input: ItemId.RawFowl, output: ItemId.CookedFowl, outputCount: 1 },
  { id: 'charcoal_oak', input: ItemId.OakLog, output: ItemId.Coal, outputCount: 1 },
  { id: 'charcoal_birch', input: ItemId.BirchLog, output: ItemId.Coal, outputCount: 1 },
  { id: 'charcoal_pine', input: ItemId.PineLog, output: ItemId.Coal, outputCount: 1 },
];

export function findSmeltingRecipe(inputId: ItemId): SmeltingRecipe | undefined {
  return SMELTING_RECIPES.find((r) => r.input === inputId);
}

export function findRecipeById(id: string): CraftingRecipe | undefined {
  return CRAFTING_RECIPES.find((r) => r.id === id);
}
