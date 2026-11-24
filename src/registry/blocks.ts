import { ToolTier, ToolType } from '../core/types';
import type { ItemId } from './items';

export const enum BlockId {
  Air = 0,
  Stone = 1,
  Cobblestone = 2,
  Dirt = 3,
  Grass = 4,
  Sand = 5,
  Sandstone = 6,
  SmoothSandstone = 7,
  Gravel = 8,
  SnowBlock = 9,
  SnowGrass = 10,
  Ice = 11,
  Bedrock = 12,
  CoalOre = 13,
  IronOre = 14,
  GoldOre = 15,
  PrismiteOre = 16,
  OakLog = 17,
  BirchLog = 18,
  PineLog = 19,
  OakLeaves = 20,
  BirchLeaves = 21,
  PineLeaves = 22,
  OakPlanks = 23,
  BirchPlanks = 24,
  PinePlanks = 25,
  Glass = 26,
  Water = 27,
  TallGrass = 28,
  WildflowerRed = 29,
  WildflowerYellow = 30,
  DryScrub = 31,
  Workbench = 32,
  Furnace = 33,
  Chest = 34,
  Torch = 35,
  Bed = 36,
  WoodDoorBottom = 37,
  WoodDoorTop = 38,
  Ladder = 39,
  Farmland = 40,
  FarmlandWet = 41,
  CropStage0 = 42,
  CropStage1 = 43,
  CropStage2 = 44,
  CropStage3 = 45,
  StoneSlab = 46,
  DirtPath = 47,
  SnowBrick = 48,
}

export interface BlockDefinition {
  id: BlockId;
  key: string;
  name: string;
  solid: boolean;
  transparent: boolean;
  liquid: boolean;
  cutout: boolean;
  translucent: boolean;
  crossBillboard: boolean;
  gravity: boolean;
  climbable: boolean;
  replaceable: boolean;
  hardness: number; // base break time in seconds; -1 = unbreakable
  toolType: ToolType | null;
  minToolTier: ToolTier;
  dropItemKey: string | null; // resolved via ItemRegistry to avoid circular import init issues
  dropCount: number;
  lightEmission: number; // 0..15
  lightOpacity: number;  // 0..15
  height: number;        // 1.0 full block, 0.5 slab/bed, etc.
  textures: {
    top: string;
    bottom: string;
    side: string;
  };
  /** Optional custom tint/fallback color for particles & minimap */
  particleColor: number;
}

type BlockInput = Partial<Omit<BlockDefinition, 'textures'>> & {
  id: BlockId;
  key: string;
  name: string;
  textures: { top: string; bottom: string; side: string } | string;
};

function makeBlock(input: BlockInput): BlockDefinition {
  const tex =
    typeof input.textures === 'string'
      ? { top: input.textures, bottom: input.textures, side: input.textures }
      : input.textures;

  const isTransparent = input.transparent ?? false;
  return {
    id: input.id,
    key: input.key,
    name: input.name,
    solid: input.solid ?? true,
    transparent: isTransparent,
    liquid: input.liquid ?? false,
    cutout: input.cutout ?? false,
    translucent: input.translucent ?? false,
    crossBillboard: input.crossBillboard ?? false,
    gravity: input.gravity ?? false,
    climbable: input.climbable ?? false,
    replaceable: input.replaceable ?? false,
    hardness: input.hardness ?? 1.0,
    toolType: input.toolType ?? null,
    minToolTier: input.minToolTier ?? ToolTier.None,
    dropItemKey: input.dropItemKey === undefined ? input.key : input.dropItemKey,
    dropCount: input.dropCount ?? 1,
    lightEmission: input.lightEmission ?? 0,
    lightOpacity: input.lightOpacity ?? (isTransparent ? 0 : 15),
    height: input.height ?? 1.0,
    textures: tex,
    particleColor: input.particleColor ?? 0x8b8680,
  };
}

const BLOCK_LIST: BlockDefinition[] = [
  makeBlock({
    id: BlockId.Air,
    key: 'air',
    name: 'Air',
    solid: false,
    transparent: true,
    replaceable: true,
    hardness: 0,
    dropItemKey: null,
    lightOpacity: 0,
    height: 0,
    textures: 'air',
  }),
  makeBlock({
    id: BlockId.Stone,
    key: 'stone',
    name: 'Stone',
    hardness: 1.5,
    toolType: ToolType.Pickaxe,
    minToolTier: ToolTier.Wood,
    dropItemKey: 'cobblestone',
    textures: 'stone',
    particleColor: 0x7c8288,
  }),
  makeBlock({
    id: BlockId.Cobblestone,
    key: 'cobblestone',
    name: 'Cobblestone',
    hardness: 2.0,
    toolType: ToolType.Pickaxe,
    minToolTier: ToolTier.Wood,
    textures: 'cobblestone',
    particleColor: 0x6f757a,
  }),
  makeBlock({
    id: BlockId.Dirt,
    key: 'dirt',
    name: 'Dirt',
    hardness: 0.6,
    toolType: ToolType.Shovel,
    textures: 'dirt',
    particleColor: 0x7d5a3c,
  }),
  makeBlock({
    id: BlockId.Grass,
    key: 'grass',
    name: 'Meadow Turf',
    hardness: 0.7,
    toolType: ToolType.Shovel,
    dropItemKey: 'dirt',
    textures: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' },
    particleColor: 0x5d8a47,
  }),
  makeBlock({
    id: BlockId.Sand,
    key: 'sand',
    name: 'Dune Sand',
    hardness: 0.6,
    toolType: ToolType.Shovel,
    gravity: true,
    textures: 'sand',
    particleColor: 0xd8c38a,
  }),
  makeBlock({
    id: BlockId.Sandstone,
    key: 'sandstone',
    name: 'Sandstone',
    hardness: 1.2,
    toolType: ToolType.Pickaxe,
    minToolTier: ToolTier.Wood,
    textures: { top: 'sandstone_top', bottom: 'sandstone_top', side: 'sandstone_side' },
    particleColor: 0xc9b078,
  }),
  makeBlock({
    id: BlockId.SmoothSandstone,
    key: 'smooth_sandstone',
    name: 'Carved Sandstone',
    hardness: 1.4,
    toolType: ToolType.Pickaxe,
    minToolTier: ToolTier.Wood,
    textures: 'sandstone_top',
    particleColor: 0xd1b983,
  }),
  makeBlock({
    id: BlockId.Gravel,
    key: 'gravel',
    name: 'Gravel',
    hardness: 0.7,
    toolType: ToolType.Shovel,
    gravity: true,
    textures: 'gravel',
    particleColor: 0x86817b,
  }),
  makeBlock({
    id: BlockId.SnowBlock,
    key: 'snow_block',
    name: 'Packed Snow',
    hardness: 0.5,
    toolType: ToolType.Shovel,
    textures: 'snow',
    particleColor: 0xe6eff5,
  }),
  makeBlock({
    id: BlockId.SnowGrass,
    key: 'snow_grass',
    name: 'Frost Turf',
    hardness: 0.7,
    toolType: ToolType.Shovel,
    dropItemKey: 'dirt',
    textures: { top: 'snow', bottom: 'dirt', side: 'snow_side' },
    particleColor: 0xd9e6ef,
  }),
  makeBlock({
    id: BlockId.Ice,
    key: 'ice',
    name: 'Glacier Ice',
    hardness: 0.8,
    toolType: ToolType.Pickaxe,
    transparent: true,
    translucent: true,
    lightOpacity: 2,
    dropItemKey: null,
    textures: 'ice',
    particleColor: 0x93c5e6,
  }),
  makeBlock({
    id: BlockId.Bedrock,
    key: 'bedrock',
    name: 'Deepstone',
    hardness: -1,
    dropItemKey: null,
    textures: 'bedrock',
    particleColor: 0x2d3036,
  }),
  makeBlock({
    id: BlockId.CoalOre,
    key: 'coal_ore',
    name: 'Coal Seam',
    hardness: 2.2,
    toolType: ToolType.Pickaxe,
    minToolTier: ToolTier.Wood,
    dropItemKey: 'coal',
    textures: 'coal_ore',
    particleColor: 0x3b3d42,
  }),
  makeBlock({
    id: BlockId.IronOre,
    key: 'iron_ore',
    name: 'Iron Vein',
    hardness: 2.8,
    toolType: ToolType.Pickaxe,
    minToolTier: ToolTier.Stone,
    dropItemKey: 'raw_iron',
    textures: 'iron_ore',
    particleColor: 0xb68b6b,
  }),
  makeBlock({
    id: BlockId.GoldOre,
    key: 'gold_ore',
    name: 'Gold Vein',
    hardness: 3.0,
    toolType: ToolType.Pickaxe,
    minToolTier: ToolTier.Iron,
    dropItemKey: 'raw_gold',
    textures: 'gold_ore',
    particleColor: 0xdcb44a,
  }),
  makeBlock({
    id: BlockId.PrismiteOre,
    key: 'prismite_ore',
    name: 'Prismite Crystal Vein',
    hardness: 3.6,
    toolType: ToolType.Pickaxe,
    minToolTier: ToolTier.Iron,
    dropItemKey: 'prismite_gem',
    lightEmission: 3,
    textures: 'prismite_ore',
    particleColor: 0x45c8b8,
  }),
  makeBlock({
    id: BlockId.OakLog,
    key: 'oak_log',
    name: 'Oak Timber',
    hardness: 1.5,
    toolType: ToolType.Axe,
    textures: { top: 'oak_log_top', bottom: 'oak_log_top', side: 'oak_log_side' },
    particleColor: 0x6c4c2f,
  }),
  makeBlock({
    id: BlockId.BirchLog,
    key: 'birch_log',
    name: 'Silverwood Log',
    hardness: 1.4,
    toolType: ToolType.Axe,
    textures: { top: 'birch_log_top', bottom: 'birch_log_top', side: 'birch_log_side' },
    particleColor: 0xc8c0ae,
  }),
  makeBlock({
    id: BlockId.PineLog,
    key: 'pine_log',
    name: 'Frostpine Log',
    hardness: 1.6,
    toolType: ToolType.Axe,
    textures: { top: 'pine_log_top', bottom: 'pine_log_top', side: 'pine_log_side' },
    particleColor: 0x523426,
  }),
  makeBlock({
    id: BlockId.OakLeaves,
    key: 'oak_leaves',
    name: 'Oak Canopy',
    hardness: 0.3,
    transparent: true,
    cutout: true,
    lightOpacity: 1,
    dropItemKey: null,
    textures: 'oak_leaves',
    particleColor: 0x487638,
  }),
  makeBlock({
    id: BlockId.BirchLeaves,
    key: 'birch_leaves',
    name: 'Silverwood Leaves',
    hardness: 0.3,
    transparent: true,
    cutout: true,
    lightOpacity: 1,
    dropItemKey: null,
    textures: 'birch_leaves',
    particleColor: 0x709648,
  }),
  makeBlock({
    id: BlockId.PineLeaves,
    key: 'pine_leaves',
    name: 'Frostpine Needles',
    hardness: 0.3,
    transparent: true,
    cutout: true,
    lightOpacity: 1,
    dropItemKey: null,
    textures: 'pine_leaves',
    particleColor: 0x2f5a4a,
  }),
  makeBlock({
    id: BlockId.OakPlanks,
    key: 'oak_planks',
    name: 'Oak Planks',
    hardness: 1.4,
    toolType: ToolType.Axe,
    textures: 'oak_planks',
    particleColor: 0x9c7649,
  }),
  makeBlock({
    id: BlockId.BirchPlanks,
    key: 'birch_planks',
    name: 'Silverwood Planks',
    hardness: 1.4,
    toolType: ToolType.Axe,
    textures: 'birch_planks',
    particleColor: 0xcab98c,
  }),
  makeBlock({
    id: BlockId.PinePlanks,
    key: 'pine_planks',
    name: 'Frostpine Planks',
    hardness: 1.4,
    toolType: ToolType.Axe,
    textures: 'pine_planks',
    particleColor: 0x734d34,
  }),
  makeBlock({
    id: BlockId.Glass,
    key: 'glass',
    name: 'Clear Glass',
    hardness: 0.4,
    transparent: true,
    translucent: true,
    lightOpacity: 0,
    dropItemKey: null,
    textures: 'glass',
    particleColor: 0xcde7f0,
  }),
  makeBlock({
    id: BlockId.Water,
    key: 'water',
    name: 'Water',
    solid: false,
    transparent: true,
    translucent: true,
    liquid: true,
    replaceable: true,
    hardness: -1,
    dropItemKey: null,
    lightOpacity: 2,
    textures: 'water',
    particleColor: 0x3a7ca5,
  }),
  makeBlock({
    id: BlockId.TallGrass,
    key: 'tall_grass',
    name: 'Wild Grass',
    solid: false,
    transparent: true,
    cutout: true,
    crossBillboard: true,
    replaceable: true,
    hardness: 0.05,
    dropItemKey: null, // seeds handled by farming/drop hook
    textures: 'tall_grass',
    particleColor: 0x5c8c42,
  }),
  makeBlock({
    id: BlockId.WildflowerRed,
    key: 'wildflower_red',
    name: 'Ember Poppy',
    solid: false,
    transparent: true,
    cutout: true,
    crossBillboard: true,
    replaceable: true,
    hardness: 0.05,
    dropItemKey: null,
    textures: 'flower_red',
    particleColor: 0xd04b43,
  }),
  makeBlock({
    id: BlockId.WildflowerYellow,
    key: 'wildflower_yellow',
    name: 'Sunpetal Bloom',
    solid: false,
    transparent: true,
    cutout: true,
    crossBillboard: true,
    replaceable: true,
    hardness: 0.05,
    dropItemKey: null,
    textures: 'flower_yellow',
    particleColor: 0xe3bd46,
  }),
  makeBlock({
    id: BlockId.DryScrub,
    key: 'dry_scrub',
    name: 'Desert Scrub',
    solid: false,
    transparent: true,
    cutout: true,
    crossBillboard: true,
    replaceable: true,
    hardness: 0.05,
    dropItemKey: 'stick',
    textures: 'dry_scrub',
    particleColor: 0x8f7748,
  }),
  makeBlock({
    id: BlockId.Workbench,
    key: 'workbench',
    name: 'Crafting Bench',
    hardness: 1.8,
    toolType: ToolType.Axe,
    textures: { top: 'workbench_top', bottom: 'oak_planks', side: 'workbench_side' },
    particleColor: 0x8c6239,
  }),
  makeBlock({
    id: BlockId.Furnace,
    key: 'furnace',
    name: 'Stone Kiln',
    hardness: 2.5,
    toolType: ToolType.Pickaxe,
    minToolTier: ToolTier.Wood,
    textures: { top: 'furnace_top', bottom: 'cobblestone', side: 'furnace_front' },
    particleColor: 0x666b70,
  }),
  makeBlock({
    id: BlockId.Chest,
    key: 'chest',
    name: 'Timber Chest',
    hardness: 1.8,
    toolType: ToolType.Axe,
    textures: { top: 'chest_top', bottom: 'oak_planks', side: 'chest_front' },
    particleColor: 0x9b6d3c,
  }),
  makeBlock({
    id: BlockId.Torch,
    key: 'torch',
    name: 'Pitch Torch',
    solid: false,
    transparent: true,
    cutout: true,
    crossBillboard: true,
    hardness: 0.05,
    lightEmission: 14,
    lightOpacity: 0,
    textures: 'torch',
    particleColor: 0xf2a63b,
  }),
  makeBlock({
    id: BlockId.Bed,
    key: 'bed',
    name: 'Camp Bed',
    hardness: 0.6,
    transparent: true,
    height: 0.56,
    textures: { top: 'bed_top', bottom: 'oak_planks', side: 'bed_side' },
    particleColor: 0xb24a3e,
  }),
  makeBlock({
    id: BlockId.WoodDoorBottom,
    key: 'wood_door',
    name: 'Timber Door',
    hardness: 1.5,
    toolType: ToolType.Axe,
    transparent: true,
    cutout: true,
    lightOpacity: 0,
    textures: 'door_bottom',
    particleColor: 0x8c643b,
  }),
  makeBlock({
    id: BlockId.WoodDoorTop,
    key: 'wood_door_top',
    name: 'Timber Door',
    hardness: 1.5,
    toolType: ToolType.Axe,
    transparent: true,
    cutout: true,
    lightOpacity: 0,
    dropItemKey: 'wood_door',
    textures: 'door_top',
    particleColor: 0x8c643b,
  }),
  makeBlock({
    id: BlockId.Ladder,
    key: 'ladder',
    name: 'Wood Ladder',
    solid: false,
    transparent: true,
    cutout: true,
    crossBillboard: true,
    climbable: true,
    hardness: 0.4,
    toolType: ToolType.Axe,
    textures: 'ladder',
    particleColor: 0x9c7649,
  }),
  makeBlock({
    id: BlockId.Farmland,
    key: 'farmland',
    name: 'Tilled Soil',
    hardness: 0.6,
    toolType: ToolType.Shovel,
    dropItemKey: 'dirt',
    height: 0.94,
    textures: { top: 'farmland_dry', bottom: 'dirt', side: 'dirt' },
    particleColor: 0x6b4c30,
  }),
  makeBlock({
    id: BlockId.FarmlandWet,
    key: 'farmland_wet',
    name: 'Hydrated Soil',
    hardness: 0.6,
    toolType: ToolType.Shovel,
    dropItemKey: 'dirt',
    height: 0.94,
    textures: { top: 'farmland_wet', bottom: 'dirt', side: 'dirt' },
    particleColor: 0x4b331e,
  }),
  makeBlock({
    id: BlockId.CropStage0,
    key: 'crop_0',
    name: 'Grain Sprout',
    solid: false,
    transparent: true,
    cutout: true,
    crossBillboard: true,
    hardness: 0.05,
    dropItemKey: 'grain_seeds',
    textures: 'crop_0',
    particleColor: 0x6f9e42,
  }),
  makeBlock({
    id: BlockId.CropStage1,
    key: 'crop_1',
    name: 'Young Grain',
    solid: false,
    transparent: true,
    cutout: true,
    crossBillboard: true,
    hardness: 0.05,
    dropItemKey: 'grain_seeds',
    textures: 'crop_1',
    particleColor: 0x7ea644,
  }),
  makeBlock({
    id: BlockId.CropStage2,
    key: 'crop_2',
    name: 'Tall Grain',
    solid: false,
    transparent: true,
    cutout: true,
    crossBillboard: true,
    hardness: 0.05,
    dropItemKey: 'grain_seeds',
    textures: 'crop_2',
    particleColor: 0xb2ad47,
  }),
  makeBlock({
    id: BlockId.CropStage3,
    key: 'crop_3',
    name: 'Ripe Golden Grain',
    solid: false,
    transparent: true,
    cutout: true,
    crossBillboard: true,
    hardness: 0.05,
    dropItemKey: 'wheat',
    textures: 'crop_3',
    particleColor: 0xdab94c,
  }),
  makeBlock({
    id: BlockId.StoneSlab,
    key: 'stone_slab',
    name: 'Stone Slab',
    hardness: 1.5,
    toolType: ToolType.Pickaxe,
    minToolTier: ToolTier.Wood,
    transparent: true,
    lightOpacity: 0,
    height: 0.5,
    textures: 'stone',
    particleColor: 0x80868c,
  }),
  makeBlock({
    id: BlockId.DirtPath,
    key: 'dirt_path',
    name: 'Packed Trail',
    hardness: 0.6,
    toolType: ToolType.Shovel,
    dropItemKey: 'dirt',
    height: 0.94,
    textures: { top: 'dirt_path_top', bottom: 'dirt', side: 'dirt_path_side' },
    particleColor: 0x9b8257,
  }),
  makeBlock({
    id: BlockId.SnowBrick,
    key: 'snow_brick',
    name: 'Frost Brick',
    hardness: 1.4,
    toolType: ToolType.Pickaxe,
    minToolTier: ToolTier.Wood,
    textures: 'snow_brick',
    particleColor: 0xc8dbe8,
  }),
];

const byId = new Map<BlockId, BlockDefinition>();
const byKey = new Map<string, BlockDefinition>();

for (const def of BLOCK_LIST) {
  byId.set(def.id, def);
  byKey.set(def.key, def);
}

export const BlockRegistry = {
  get(id: BlockId): BlockDefinition {
    return byId.get(id) ?? byId.get(BlockId.Air)!;
  },
  getByKey(key: string): BlockDefinition | undefined {
    return byKey.get(key);
  },
  all(): readonly BlockDefinition[] {
    return BLOCK_LIST;
  },
  isSolid(id: BlockId, meta = 0): boolean {
    if (id === BlockId.WoodDoorBottom || id === BlockId.WoodDoorTop) {
      // bit 0 = open flag
      return (meta & 1) === 0;
    }
    return this.get(id).solid;
  },
  isTransparent(id: BlockId): boolean {
    return this.get(id).transparent;
  },
  isLiquid(id: BlockId): boolean {
    return this.get(id).liquid;
  },
  isReplaceable(id: BlockId): boolean {
    return this.get(id).replaceable;
  },
  getLightEmission(id: BlockId): number {
    return this.get(id).lightEmission;
  },
  getLightOpacity(id: BlockId): number {
    return this.get(id).lightOpacity;
  },
  getHeight(id: BlockId): number {
    return this.get(id).height;
  },
  isCrop(id: BlockId): boolean {
    return (
      id === BlockId.CropStage0 ||
      id === BlockId.CropStage1 ||
      id === BlockId.CropStage2 ||
      id === BlockId.CropStage3
    );
  },
};

export type BlockDropResolver = (blockId: BlockId) => ItemId | null;
