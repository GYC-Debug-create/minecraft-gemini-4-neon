import { BALANCE } from '../config/balance';
import { DEFAULT_MAX_STACK } from '../config/constants';
import { ArmorSlot, ToolTier, ToolType } from '../core/types';
import { BlockId } from './blocks';

export const enum ItemId {
  None = 0,
  // Placeable blocks (1..99)
  Stone = 1,
  Cobblestone = 2,
  Dirt = 3,
  Grass = 4,
  Sand = 5,
  Sandstone = 6,
  SmoothSandstone = 7,
  Gravel = 8,
  SnowBlock = 9,
  OakLog = 10,
  BirchLog = 11,
  PineLog = 12,
  OakPlanks = 13,
  BirchPlanks = 14,
  PinePlanks = 15,
  Glass = 16,
  Workbench = 17,
  Furnace = 18,
  Chest = 19,
  Torch = 20,
  Bed = 21,
  WoodDoor = 22,
  Ladder = 23,
  StoneSlab = 24,
  SnowBrick = 25,

  // Materials & resources (100..149)
  Stick = 100,
  Coal = 101,
  RawIron = 102,
  IronIngot = 103,
  RawGold = 104,
  GoldIngot = 105,
  PrismiteGem = 106,
  GrainSeeds = 107,
  Wheat = 108,
  Leather = 109,
  Wool = 110,
  Feather = 111,
  Bone = 112,
  SilkThread = 113,
  Bonemeal = 114,
  Arrow = 115,

  // Foods (150..169)
  Apple = 150,
  Bread = 151,
  RawPork = 152,
  CookedPork = 153,
  RawMutton = 154,
  CookedMutton = 155,
  RawFowl = 156,
  CookedFowl = 157,
  RottenFlesh = 158,

  // Tools (200..239)
  WoodPickaxe = 200,
  WoodAxe = 201,
  WoodShovel = 202,
  WoodSword = 203,
  WoodHoe = 204,

  StonePickaxe = 205,
  StoneAxe = 206,
  StoneShovel = 207,
  StoneSword = 208,
  StoneHoe = 209,

  IronPickaxe = 210,
  IronAxe = 211,
  IronShovel = 212,
  IronSword = 213,
  IronHoe = 214,

  PrismitePickaxe = 215,
  PrismiteAxe = 216,
  PrismiteShovel = 217,
  PrismiteSword = 218,
  PrismiteHoe = 219,

  Bow = 220,

  // Armor (240..259)
  LeatherHelmet = 240,
  LeatherChestplate = 241,
  LeatherLeggings = 242,
  LeatherBoots = 243,

  IronHelmet = 244,
  IronChestplate = 245,
  IronLeggings = 246,
  IronBoots = 247,
}

export interface ItemDefinition {
  id: ItemId;
  key: string;
  name: string;
  maxStack: number;
  icon: string;
  placesBlock?: BlockId;
  toolType?: ToolType;
  toolTier?: ToolTier;
  durability?: number;
  attackDamage?: number;
  miningSpeed?: number;
  armorSlot?: ArmorSlot;
  armorDefense?: number;
  foodRestore?: number;
  saturationRestore?: number;
  fuelTicks?: number;
  isBow?: boolean;
  isArrow?: boolean;
  isBonemeal?: boolean;
}

function blockItem(id: ItemId, key: string, name: string, blockId: BlockId, icon: string, fuelTicks?: number): ItemDefinition {
  return { id, key, name, maxStack: DEFAULT_MAX_STACK, icon, placesBlock: blockId, fuelTicks };
}

function makeTool(
  id: ItemId,
  key: string,
  name: string,
  toolType: ToolType,
  tier: ToolTier,
  attackDamage: number
): ItemDefinition {
  return {
    id,
    key,
    name,
    maxStack: 1,
    icon: key,
    toolType,
    toolTier: tier,
    durability: BALANCE.tools.durabilityByTier[tier],
    attackDamage,
    miningSpeed: BALANCE.mining.toolSpeedByTier[tier],
  };
}

function makeArmor(
  id: ItemId,
  key: string,
  name: string,
  slot: ArmorSlot,
  defense: number,
  durability: number
): ItemDefinition {
  return {
    id,
    key,
    name,
    maxStack: 1,
    icon: key,
    armorSlot: slot,
    armorDefense: defense,
    durability,
  };
}

const ITEM_LIST: ItemDefinition[] = [
  // Placeable block items
  blockItem(ItemId.Stone, 'stone', 'Stone', BlockId.Stone, 'stone'),
  blockItem(ItemId.Cobblestone, 'cobblestone', 'Cobblestone', BlockId.Cobblestone, 'cobblestone'),
  blockItem(ItemId.Dirt, 'dirt', 'Dirt', BlockId.Dirt, 'dirt'),
  blockItem(ItemId.Grass, 'grass', 'Meadow Turf', BlockId.Grass, 'grass_side'),
  blockItem(ItemId.Sand, 'sand', 'Dune Sand', BlockId.Sand, 'sand'),
  blockItem(ItemId.Sandstone, 'sandstone', 'Sandstone', BlockId.Sandstone, 'sandstone_side'),
  blockItem(ItemId.SmoothSandstone, 'smooth_sandstone', 'Carved Sandstone', BlockId.SmoothSandstone, 'sandstone_top'),
  blockItem(ItemId.Gravel, 'gravel', 'Gravel', BlockId.Gravel, 'gravel'),
  blockItem(ItemId.SnowBlock, 'snow_block', 'Packed Snow', BlockId.SnowBlock, 'snow'),
  blockItem(ItemId.OakLog, 'oak_log', 'Oak Timber', BlockId.OakLog, 'oak_log_side', BALANCE.furnace.fuelTicks.oak_log),
  blockItem(ItemId.BirchLog, 'birch_log', 'Silverwood Log', BlockId.BirchLog, 'birch_log_side', BALANCE.furnace.fuelTicks.birch_log),
  blockItem(ItemId.PineLog, 'pine_log', 'Frostpine Log', BlockId.PineLog, 'pine_log_side', BALANCE.furnace.fuelTicks.pine_log),
  blockItem(ItemId.OakPlanks, 'oak_planks', 'Oak Planks', BlockId.OakPlanks, 'oak_planks', BALANCE.furnace.fuelTicks.oak_planks),
  blockItem(ItemId.BirchPlanks, 'birch_planks', 'Silverwood Planks', BlockId.BirchPlanks, 'birch_planks', BALANCE.furnace.fuelTicks.birch_planks),
  blockItem(ItemId.PinePlanks, 'pine_planks', 'Frostpine Planks', BlockId.PinePlanks, 'pine_planks', BALANCE.furnace.fuelTicks.pine_planks),
  blockItem(ItemId.Glass, 'glass', 'Clear Glass', BlockId.Glass, 'glass'),
  blockItem(ItemId.Workbench, 'workbench', 'Crafting Bench', BlockId.Workbench, 'workbench_top'),
  blockItem(ItemId.Furnace, 'furnace', 'Stone Kiln', BlockId.Furnace, 'furnace_front'),
  blockItem(ItemId.Chest, 'chest', 'Timber Chest', BlockId.Chest, 'chest_front'),
  blockItem(ItemId.Torch, 'torch', 'Pitch Torch', BlockId.Torch, 'torch'),
  blockItem(ItemId.Bed, 'bed', 'Camp Bed', BlockId.Bed, 'bed_top'),
  blockItem(ItemId.WoodDoor, 'wood_door', 'Timber Door', BlockId.WoodDoorBottom, 'door_top'),
  blockItem(ItemId.Ladder, 'ladder', 'Wood Ladder', BlockId.Ladder, 'ladder'),
  blockItem(ItemId.StoneSlab, 'stone_slab', 'Stone Slab', BlockId.StoneSlab, 'stone'),
  blockItem(ItemId.SnowBrick, 'snow_brick', 'Frost Brick', BlockId.SnowBrick, 'snow_brick'),

  // Materials
  { id: ItemId.Stick, key: 'stick', name: 'Timber Stick', maxStack: DEFAULT_MAX_STACK, icon: 'stick', fuelTicks: BALANCE.furnace.fuelTicks.stick },
  { id: ItemId.Coal, key: 'coal', name: 'Coal Chunk', maxStack: DEFAULT_MAX_STACK, icon: 'coal', fuelTicks: BALANCE.furnace.fuelTicks.coal },
  { id: ItemId.RawIron, key: 'raw_iron', name: 'Raw Iron Ore', maxStack: DEFAULT_MAX_STACK, icon: 'raw_iron' },
  { id: ItemId.IronIngot, key: 'iron_ingot', name: 'Iron Ingot', maxStack: DEFAULT_MAX_STACK, icon: 'iron_ingot' },
  { id: ItemId.RawGold, key: 'raw_gold', name: 'Raw Gold Ore', maxStack: DEFAULT_MAX_STACK, icon: 'raw_gold' },
  { id: ItemId.GoldIngot, key: 'gold_ingot', name: 'Gold Ingot', maxStack: DEFAULT_MAX_STACK, icon: 'gold_ingot' },
  { id: ItemId.PrismiteGem, key: 'prismite_gem', name: 'Prismite Crystal', maxStack: DEFAULT_MAX_STACK, icon: 'prismite_gem' },
  { id: ItemId.GrainSeeds, key: 'grain_seeds', name: 'Grain Seeds', maxStack: DEFAULT_MAX_STACK, icon: 'grain_seeds', placesBlock: BlockId.CropStage0 },
  { id: ItemId.Wheat, key: 'wheat', name: 'Golden Grain', maxStack: DEFAULT_MAX_STACK, icon: 'wheat' },
  { id: ItemId.Leather, key: 'leather', name: 'Tanned Hide', maxStack: DEFAULT_MAX_STACK, icon: 'leather' },
  { id: ItemId.Wool, key: 'wool', name: 'Ram Fleece', maxStack: DEFAULT_MAX_STACK, icon: 'wool' },
  { id: ItemId.Feather, key: 'feather', name: 'Crested Feather', maxStack: DEFAULT_MAX_STACK, icon: 'feather' },
  { id: ItemId.Bone, key: 'bone', name: 'Hollow Bone', maxStack: DEFAULT_MAX_STACK, icon: 'bone' },
  { id: ItemId.SilkThread, key: 'silk_thread', name: 'Cavern Silk', maxStack: DEFAULT_MAX_STACK, icon: 'silk_thread' },
  { id: ItemId.Bonemeal, key: 'bonemeal', name: 'Bone Dust', maxStack: DEFAULT_MAX_STACK, icon: 'bonemeal', isBonemeal: true },
  { id: ItemId.Arrow, key: 'arrow', name: 'Fletched Arrow', maxStack: DEFAULT_MAX_STACK, icon: 'arrow', isArrow: true },

  // Foods
  { id: ItemId.Apple, key: 'apple', name: 'Orchard Apple', maxStack: DEFAULT_MAX_STACK, icon: 'apple', foodRestore: 4, saturationRestore: 2.4 },
  { id: ItemId.Bread, key: 'bread', name: 'Hearth Bread', maxStack: DEFAULT_MAX_STACK, icon: 'bread', foodRestore: 6, saturationRestore: 6.0 },
  { id: ItemId.RawPork, key: 'raw_pork', name: 'Raw Boar Cut', maxStack: DEFAULT_MAX_STACK, icon: 'raw_pork', foodRestore: 3, saturationRestore: 1.8 },
  { id: ItemId.CookedPork, key: 'cooked_pork', name: 'Roasted Boar', maxStack: DEFAULT_MAX_STACK, icon: 'cooked_pork', foodRestore: 8, saturationRestore: 9.6 },
  { id: ItemId.RawMutton, key: 'raw_mutton', name: 'Raw Ram Cut', maxStack: DEFAULT_MAX_STACK, icon: 'raw_mutton', foodRestore: 2, saturationRestore: 1.2 },
  { id: ItemId.CookedMutton, key: 'cooked_mutton', name: 'Seared Mutton', maxStack: DEFAULT_MAX_STACK, icon: 'cooked_mutton', foodRestore: 6, saturationRestore: 7.2 },
  { id: ItemId.RawFowl, key: 'raw_fowl', name: 'Raw Fowl', maxStack: DEFAULT_MAX_STACK, icon: 'raw_fowl', foodRestore: 2, saturationRestore: 1.2 },
  { id: ItemId.CookedFowl, key: 'cooked_fowl', name: 'Roast Fowl', maxStack: DEFAULT_MAX_STACK, icon: 'cooked_fowl', foodRestore: 6, saturationRestore: 7.0 },
  { id: ItemId.RottenFlesh, key: 'rotten_flesh', name: 'Ash Jerky', maxStack: DEFAULT_MAX_STACK, icon: 'rotten_flesh', foodRestore: 3, saturationRestore: 0.6 },

  // Wood tools
  makeTool(ItemId.WoodPickaxe, 'wood_pickaxe', 'Oak Pickaxe', ToolType.Pickaxe, ToolTier.Wood, 2),
  makeTool(ItemId.WoodAxe, 'wood_axe', 'Oak Hatchet', ToolType.Axe, ToolTier.Wood, 3),
  makeTool(ItemId.WoodShovel, 'wood_shovel', 'Oak Spade', ToolType.Shovel, ToolTier.Wood, 2),
  makeTool(ItemId.WoodSword, 'wood_sword', 'Oak Blade', ToolType.Sword, ToolTier.Wood, 4),
  makeTool(ItemId.WoodHoe, 'wood_hoe', 'Oak Hoe', ToolType.Hoe, ToolTier.Wood, 1),

  // Stone tools
  makeTool(ItemId.StonePickaxe, 'stone_pickaxe', 'Stone Pickaxe', ToolType.Pickaxe, ToolTier.Stone, 3),
  makeTool(ItemId.StoneAxe, 'stone_axe', 'Stone Hatchet', ToolType.Axe, ToolTier.Stone, 4),
  makeTool(ItemId.StoneShovel, 'stone_shovel', 'Stone Spade', ToolType.Shovel, ToolTier.Stone, 2),
  makeTool(ItemId.StoneSword, 'stone_sword', 'Stone Blade', ToolType.Sword, ToolTier.Stone, 5),
  makeTool(ItemId.StoneHoe, 'stone_hoe', 'Stone Hoe', ToolType.Hoe, ToolTier.Stone, 1),

  // Iron tools
  makeTool(ItemId.IronPickaxe, 'iron_pickaxe', 'Iron Pickaxe', ToolType.Pickaxe, ToolTier.Iron, 4),
  makeTool(ItemId.IronAxe, 'iron_axe', 'Iron Hatchet', ToolType.Axe, ToolTier.Iron, 5),
  makeTool(ItemId.IronShovel, 'iron_shovel', 'Iron Spade', ToolType.Shovel, ToolTier.Iron, 3),
  makeTool(ItemId.IronSword, 'iron_sword', 'Iron Broadsword', ToolType.Sword, ToolTier.Iron, 7),
  makeTool(ItemId.IronHoe, 'iron_hoe', 'Iron Hoe', ToolType.Hoe, ToolTier.Iron, 2),

  // Prismite tools
  makeTool(ItemId.PrismitePickaxe, 'prismite_pickaxe', 'Prismite Pickaxe', ToolType.Pickaxe, ToolTier.Prismite, 5),
  makeTool(ItemId.PrismiteAxe, 'prismite_axe', 'Prismite Hatchet', ToolType.Axe, ToolTier.Prismite, 6),
  makeTool(ItemId.PrismiteShovel, 'prismite_shovel', 'Prismite Spade', ToolType.Shovel, ToolTier.Prismite, 4),
  makeTool(ItemId.PrismiteSword, 'prismite_sword', 'Prismite Edge', ToolType.Sword, ToolTier.Prismite, 9),
  makeTool(ItemId.PrismiteHoe, 'prismite_hoe', 'Prismite Hoe', ToolType.Hoe, ToolTier.Prismite, 2),

  // Bow
  {
    id: ItemId.Bow,
    key: 'bow',
    name: 'Recurve Bow',
    maxStack: 1,
    icon: 'bow',
    durability: BALANCE.tools.bowDurability,
    isBow: true,
  },

  // Leather armor
  makeArmor(ItemId.LeatherHelmet, 'leather_helmet', 'Hide Cap', 'helmet', BALANCE.armor.leatherDefense.helmet, BALANCE.armor.leatherDurability.helmet),
  makeArmor(ItemId.LeatherChestplate, 'leather_chestplate', 'Hide Tunic', 'chestplate', BALANCE.armor.leatherDefense.chestplate, BALANCE.armor.leatherDurability.chestplate),
  makeArmor(ItemId.LeatherLeggings, 'leather_leggings', 'Hide Trousers', 'leggings', BALANCE.armor.leatherDefense.leggings, BALANCE.armor.leatherDurability.leggings),
  makeArmor(ItemId.LeatherBoots, 'leather_boots', 'Hide Boots', 'boots', BALANCE.armor.leatherDefense.boots, BALANCE.armor.leatherDurability.boots),

  // Iron armor
  makeArmor(ItemId.IronHelmet, 'iron_helmet', 'Iron Helm', 'helmet', BALANCE.armor.ironDefense.helmet, BALANCE.armor.ironDurability.helmet),
  makeArmor(ItemId.IronChestplate, 'iron_chestplate', 'Iron Cuirass', 'chestplate', BALANCE.armor.ironDefense.chestplate, BALANCE.armor.ironDurability.chestplate),
  makeArmor(ItemId.IronLeggings, 'iron_leggings', 'Iron Greaves', 'leggings', BALANCE.armor.ironDefense.leggings, BALANCE.armor.ironDurability.leggings),
  makeArmor(ItemId.IronBoots, 'iron_boots', 'Iron Sabatons', 'boots', BALANCE.armor.ironDefense.boots, BALANCE.armor.ironDurability.boots),
];

const byId = new Map<ItemId, ItemDefinition>();
const byKey = new Map<string, ItemDefinition>();

for (const def of ITEM_LIST) {
  byId.set(def.id, def);
  byKey.set(def.key, def);
}

export const ItemRegistry = {
  get(id: ItemId): ItemDefinition | undefined {
    return byId.get(id);
  },
  getByKey(key: string): ItemDefinition | undefined {
    return byKey.get(key);
  },
  all(): readonly ItemDefinition[] {
    return ITEM_LIST;
  },
  getIdByKey(key: string | null): ItemId | null {
    if (!key) return null;
    return byKey.get(key)?.id ?? null;
  },
  isPlank(id: ItemId): boolean {
    return id === ItemId.OakPlanks || id === ItemId.BirchPlanks || id === ItemId.PinePlanks;
  },
  isLog(id: ItemId): boolean {
    return id === ItemId.OakLog || id === ItemId.BirchLog || id === ItemId.PineLog;
  },
};
