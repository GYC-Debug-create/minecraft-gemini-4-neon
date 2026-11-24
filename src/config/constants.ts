export const CHUNK_SIZE = 16;
export const CHUNK_SIZE_SHIFT = 4;
export const CHUNK_MASK = CHUNK_SIZE - 1;
export const WORLD_HEIGHT = 128;
export const CHUNK_VOLUME = CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE; // 32768
export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE; // 256

export const SEA_LEVEL = 56;
export const MAX_LIGHT = 15;

export const TICK_RATE = 20;
export const FIXED_DT = 1 / TICK_RATE;
export const DAY_LENGTH_TICKS = 24_000; // 20 real minutes at 20 TPS

export const HOTBAR_SIZE = 9;
export const MAIN_INVENTORY_SIZE = 27;
export const TOTAL_INVENTORY_SIZE = HOTBAR_SIZE + MAIN_INVENTORY_SIZE; // 36
export const CHEST_SIZE = 27;
export const DEFAULT_MAX_STACK = 64;

export const CURRENT_SAVE_VERSION = 2;
