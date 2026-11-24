import type { BlockId } from '../registry/blocks';
import type { ItemId } from '../registry/items';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface BlockPos {
  x: number;
  y: number;
  z: number;
}

export interface ChunkCoord {
  cx: number;
  cz: number;
}

export const enum BiomeId {
  Plains = 0,
  Forest = 1,
  Desert = 2,
  Snow = 3,
  Ocean = 4,
  Mountains = 5,
}

export const BIOME_NAMES: Record<BiomeId, string> = {
  [BiomeId.Plains]: 'Meadow Plains',
  [BiomeId.Forest]: 'Timber Forest',
  [BiomeId.Desert]: 'Sunscorch Desert',
  [BiomeId.Snow]: 'Frost Tundra',
  [BiomeId.Ocean]: 'Azure Sea',
  [BiomeId.Mountains]: 'Highland Crags',
};

export const enum FaceDir {
  Top = 0,    // +Y
  Bottom = 1, // -Y
  North = 2,  // -Z
  South = 3,  // +Z
  East = 4,   // +X
  West = 5,   // -X
}

export const enum ToolType {
  Pickaxe = 'pickaxe',
  Axe = 'axe',
  Shovel = 'shovel',
  Sword = 'sword',
  Hoe = 'hoe',
}

export const enum ToolTier {
  None = 0,
  Wood = 1,
  Stone = 2,
  Iron = 3,
  Prismite = 4,
}

export type ArmorSlot = 'helmet' | 'chestplate' | 'leggings' | 'boots';

export interface ItemStack {
  itemId: ItemId;
  count: number;
  durability?: number;
}

export type SlotLocation =
  | 'inventory'
  | 'armor'
  | 'craft'
  | 'chest'
  | 'furnace_input'
  | 'furnace_fuel'
  | 'furnace_output';

export interface SlotRef {
  location: SlotLocation;
  index: number;
}

export type GameMode = 'menu' | 'playing' | 'paused' | 'dead';

export interface GameSettings {
  renderDistance: number;
  fov: number;
  mouseSensitivity: number;
  volume: number;
}

export interface PlayerStateSnapshot {
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  onGround: boolean;
  inWater: boolean;
  headInWater: boolean;
  sneaking: boolean;
  sprinting: boolean;
  flying: boolean;
  health: number;
  maxHealth: number;
  hunger: number;
  maxHunger: number;
  saturation: number;
  oxygen: number;
  maxOxygen: number;
  armorDefense: number;
  selectedSlot: number;
  spawnPoint: Vec3;
  dead: boolean;
  deathCount: number;
}

export interface InventorySnapshot {
  selectedSlot: number;
  slots: Array<ItemStack | null>;
  armor: Record<ArmorSlot, ItemStack | null>;
}

export interface ContainerSnapshot {
  type: 'workbench' | 'furnace' | 'chest';
  pos: BlockPos;
  slots?: Array<ItemStack | null>;
  furnace?: {
    input: ItemStack | null;
    fuel: ItemStack | null;
    output: ItemStack | null;
    burnTime: number;
    burnTimeMax: number;
    smeltProgress: number;
    smeltTimeMax: number;
  };
}

export interface EntitySnapshot {
  id: number;
  kind: string;
  pos: Vec3;
  health?: number;
  itemId?: ItemId;
  count?: number;
}

export interface PerfMetricsSnapshot {
  fps: number;
  frameJsMs: number;
  avgFrameJsMs: number;
  maxFrameJsMs: number;
  chunkGenAvgMs: number;
  chunkMeshAvgMs: number;
  drawCalls: number;
  triangles: number;
  loadedChunks: number;
}

export interface GameStateSnapshot {
  mode: GameMode;
  worldId: string;
  seed: number;
  worldTime: number;
  dayCount: number;
  biome: BiomeId;
  biomeName: string;
  player: PlayerStateSnapshot;
  openContainer: ContainerSnapshot | null;
  loadedChunks: number;
}

export interface IGameDebugAPI {
  ready(): boolean;
  getMode(): GameMode;
  startNewWorld(seed?: number | string, name?: string): Promise<void>;
  continueWorld(): Promise<void>;
  saveNow(): Promise<void>;
  setLook(yaw: number, pitch: number): void;
  setKey(code: string, down: boolean): void;
  releaseAllKeys(): void;
  setFlying(enabled: boolean): void;
  selectHotbar(slot: number): void;
  mineBlock(maxMs?: number): Promise<{ broken: boolean; blockId: BlockId; pos: BlockPos | null }>;
  placeBlock(): boolean;
  interact(): boolean;
  useItem(chargeMs?: number): Promise<boolean>;
  attack(): boolean;
  craft(recipeId: string, useWorkbench?: boolean): boolean;
  moveSlot(from: SlotRef, to: SlotRef, half?: boolean): boolean;
  openContainerAt(x: number, y: number, z: number): boolean;
  closeContainer(): void;
  getOpenContainer(): ContainerSnapshot | null;
  teleport(x: number, y: number, z: number): void;
  setSpawnPoint(x: number, y: number, z: number): void;
  advanceTime(ticks: number): void;
  stepSimulation(ticks: number): void;
  getState(): GameStateSnapshot;
  getInventory(): InventorySnapshot;
  getBlock(x: number, y: number, z: number): BlockId;
  getLight(x: number, y: number, z: number): { sky: number; block: number };
  getEntities(): EntitySnapshot[];
  getPerfMetrics(): PerfMetricsSnapshot;
  setSettings(partial: Partial<GameSettings>): void;
  getSettings(): GameSettings;
}

declare global {
  interface Window {
    __game?: IGameDebugAPI;
  }
}
