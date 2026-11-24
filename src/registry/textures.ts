/**
 * Shared pure-data texture atlas index and UV registry.
 * Safe to import in both Web Workers (Mesher) and Main Thread (TextureAtlas).
 */
export const TILE_SIZE = 16;
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 8;
export const ATLAS_WIDTH = ATLAS_COLS * TILE_SIZE;  // 128
export const ATLAS_HEIGHT = ATLAS_ROWS * TILE_SIZE; // 128

export const ATLAS_TILES = [
  'stone',
  'cobblestone',
  'dirt',
  'grass_top',
  'grass_side',
  'sand',
  'sandstone_top',
  'sandstone_side',
  'gravel',
  'snow',
  'snow_side',
  'ice',
  'bedrock',
  'coal_ore',
  'iron_ore',
  'gold_ore',
  'prismite_ore',
  'oak_log_top',
  'oak_log_side',
  'birch_log_top',
  'birch_log_side',
  'pine_log_top',
  'pine_log_side',
  'oak_leaves',
  'birch_leaves',
  'pine_leaves',
  'oak_planks',
  'birch_planks',
  'pine_planks',
  'glass',
  'water',
  'tall_grass',
  'flower_red',
  'flower_yellow',
  'dry_scrub',
  'workbench_top',
  'workbench_side',
  'furnace_top',
  'furnace_front',
  'chest_top',
  'chest_front',
  'torch',
  'bed_top',
  'bed_side',
  'door_bottom',
  'door_top',
  'ladder',
  'farmland_dry',
  'farmland_wet',
  'crop_0',
  'crop_1',
  'crop_2',
  'crop_3',
  'dirt_path_top',
  'dirt_path_side',
  'snow_brick',
] as const;

export type TileName = (typeof ATLAS_TILES)[number];

const TILE_INDEX_MAP = new Map<string, number>();
ATLAS_TILES.forEach((name, idx) => TILE_INDEX_MAP.set(name, idx));

export interface TileUV {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

const UV_CACHE = new Map<string, TileUV>();

export function getTileIndex(name: string): number {
  return TILE_INDEX_MAP.get(name) ?? 0;
}

/**
 * Returns WebGL UV rectangle (flipY = true in Three.js CanvasTexture, so row 0 is at top v=[1-step, 1]).
 */
export function getTileUV(name: string): TileUV {
  let cached = UV_CACHE.get(name);
  if (cached) return cached;

  const idx = getTileIndex(name);
  const col = idx % ATLAS_COLS;
  const row = Math.floor(idx / ATLAS_COLS);
  const eps = 0.0005;

  const u0 = col / ATLAS_COLS + eps;
  const u1 = (col + 1) / ATLAS_COLS - eps;
  // Canvas row 0 is at top; with flipY=true in Three.js, v=1 is top and v=0 is bottom
  const v1 = 1 - row / ATLAS_ROWS - eps;
  const v0 = 1 - (row + 1) / ATLAS_ROWS + eps;

  cached = { u0, v0, u1, v1 };
  UV_CACHE.set(name, cached);
  return cached;
}
