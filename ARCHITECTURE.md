# Stoneroot Architecture (ARCHITECTURE.md)

This document defines the module boundaries, data structures, and public interfaces of **Stoneroot**. Any breaking interface change MUST be updated here before delegating or implementing dependent modules.

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                             Main Thread                                 │
│  ┌───────────┐  ┌──────────┐  ┌──────────────┐  ┌────────────────────┐ │
│  │ UIManager │  │ InputMgr │  │ DebugAPI     │  │ SaveManager        │ │
│  │ HUD/Menus │  │ Keys/Ptr │  │ window.__game│  │ IndexedDB + Migrat │ │
│  └─────┬─────┘  └────┬─────┘  └──────┬───────┘  └─────────┬──────────┘ │
│        └─────────────┴───────────────┼────────────────────┘            │
│                                      ▼                                 │
│                             ┌─────────────────┐                        │
│                             │   Game (Loop)   │◄── EventBus            │
│                             └─┬───┬───┬───┬───┘                        │
│       ┌───────────────────────┘   │   │   └───────────────────┐        │
│       ▼                           ▼   ▼                       ▼        │
│  ┌──────────┐               ┌───────────┐              ┌────────────┐  │
│  │  World   │               │  Player   │              │  Entities  │  │
│  │ Chunks   │               │ Physics   │              │ Mobs/Items │  │
│  │ Lighting │               │ Raycast   │              │ Arrows/A*  │  │
│  │ Systems  │               │ Inventory │              └─────┬──────┘  │
│  └────┬─────┘               └─────┬─────┘                    │         │
│       │                           ▼                          ▼         │
│       │                    ┌──────────────────────────────────────┐    │
│       │                    │  Renderer (Three.js) + TextureAtlas  │    │
│       │                    │  Particles + Sky/Fog + AudioEngine   │    │
│       │                    └──────────────────────────────────────┘    │
└───────┼────────────────────────────────────────────────────────────────┘
        │ postMessage (Transferable ArrayBuffers)
┌───────▼────────────────────────────────────────────────────────────────┐
│                     Web Worker (world.worker.ts)                       │
│  TerrainGenerator + VillageGenerator + Lighting + Mesher               │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Directory Structure & Module Responsibilities

| Path | Responsibility |
|---|---|
| `src/config/constants.ts` | Immutable world geometry constants (`CHUNK_SIZE = 16`, `WORLD_HEIGHT = 128`, `SEA_LEVEL = 56`, `MAX_LIGHT = 15`, tick rate `20 Hz`). |
| `src/config/balance.ts` | Centralized tunable gameplay values (mining speeds, physics, damage, hunger, oxygen, spawn rates, crop growth, furnace smelt/fuel times, armor reduction, village spacing). |
| `src/core/types.ts` | Shared primitive types (`Vec3`, `BlockPos`, `ChunkCoord`, `BiomeId`, `FaceDir`, `ToolType`, `ToolTier`, `ArmorSlot`, `ItemStack`, `PlayerStateSnapshot`, `WorldSettings`). |
| `src/core/events.ts` | Strongly-typed `EventBus<GameEventMap>` decoupling simulation systems from rendering, audio, UI, and persistence. |
| `src/core/rng.ts` | Deterministic seeded PRNG (`SeededRNG`, `hash2D`, `hash3D`, `stringToSeed`). |
| `src/core/noise.ts` | Deterministic 2D & 3D simplex/value noise and fractal Brownian motion (`Noise2D`, `Noise3D`). |
| `src/registry/blocks.ts` | `BlockId` enum + `BlockRegistry` (`getBlock`, `getAllBlocks`, `isSolid`, `isTransparent`, `isLiquid`, `getLightEmission`, `getBlockBounds`). |
| `src/registry/items.ts` | `ItemId` enum + `ItemRegistry` (`getItem`, `getAllItems`, `blockToItem`, `itemToBlock`). |
| `src/registry/recipes.ts` | Crafting recipes (2×2 / 3×3 shaped & shapeless), smelting recipes, and fuel definitions. Single source of truth for runtime and `README.md` recipe table generation. |
| `src/registry/loot.ts` | Village chest loot tables and mob drop tables. |
| `src/registry/textures.ts` | Pure-data 8×8 tile atlas index (`ATLAS_TILES`) and UV lookup (`getTileUV`) shared by Web Worker `Mesher` and main-thread `TextureAtlas`. |
| `src/world/Chunk.ts` | `Chunk` data container: `blocks: Uint8Array(32768)`, `light: Uint8Array(32768)`, `meta: Uint8Array(32768)`, `biomes: Uint8Array(256)`, dirty/modified flags, serialization helpers. |
| `src/world/World.ts` | Manages active `Chunk` map, block/meta/light/biome getters & setters, neighbor notifications, falling block & water flow & crop growth queues, container state registry (`ContainerRecord`). |
| `src/world/Lighting.ts` | Pure BFS sky-light and block-light propagation and incremental updates when blocks change. |
| `src/world/TerrainGenerator.ts` | Deterministic heightmap, 6-biome climate system, 3D cave carving, depth-stratified ores, trees, flora, water, and village stamping. |
| `src/world/VillageGenerator.ts` | Pure deterministic cross-chunk village planner (`getVillageForRegion`, `getVillagesOverlappingChunk`) and block stamper. |
| `src/world/Mesher.ts` | Builds chunk render buffers (`opaque`, `cutout`, `translucent`) with face culling, smooth 4-corner lighting, and vertex AO. |
| `src/world/worker/protocol.ts` | Typed worker request/response messages (`generateChunk`, `meshChunk`) with Transferable buffer lists. |
| `src/world/worker/world.worker.ts` | Worker entry point executing terrain gen + initial lighting + meshing off the main thread. |
| `src/player/Physics.ts` | Pure swept/substepped AABB collision (high-speed fall, wall sliding, 0.5-block step-up, sneak edge guard, swimming, ladders). |
| `src/player/Raycast.ts` | Pure Amanatides-Woo 3D DDA voxel raycaster. |
| `src/player/Inventory.ts` | 9 hotbar + 27 main + 4 armor + crafting grid state, stack manipulation, drag/split/shift-transfer, durability wear. |
| `src/player/Player.ts` | Player entity state (position, velocity, look, vitals, mining progress, bow draw, spawn point, hurt timer). |
| `src/entities/EntitySystem.ts` | Entity registry & ECS-lite base interfaces (`Entity`, `EntityKind`, `EntityManager`) hosting dropped items, arrows, passive mobs, and hostile mobs. |
| `src/entities/Pathfinding.ts` | Bounded grid A* pathfinder for voxel terrain (handles 1-block jumps, drops, wall-climb option for spiders). |
| `src/systems/CraftingSystem.ts` | Pure 2×2 & 3×3 shaped/shapeless recipe matching and consumption. |
| `src/systems/ContainerManager.ts` | Furnace simulation ticks, Chest storage & lazy village loot generation on first open, Workbench, Bed, Door logic. |
| `src/systems/SurvivalSystem.ts` | Hunger, saturation, natural regen, starvation, drowning, fall damage, armor mitigation, death drops & respawn. |
| `src/systems/FarmingSystem.ts` | Hoe tilling, farmland hydration, crop stage ticks, bonemeal, harvesting. |
| `src/engine/TextureAtlas.ts` | Procedural 16×16 Canvas pixel-art block/item/break-crack texture generator and UV registry. |
| `src/engine/Renderer.ts` | Three.js WebGLRenderer wrapper: chunk meshes, sky/sun/moon/clouds/fog, selection box, break crack mesh, first-person hand/held item, mobs/items/arrows, particles, frame timing metrics. |
| `src/engine/InputManager.ts` | Keyboard, mouse, pointer-lock, wheel, and virtual input state (used by `window.__game`). |
| `src/engine/AudioEngine.ts` | Procedural WebAudio SFX synthesizer with volume control. |
| `src/engine/ParticleSystem.ts` | Dig, break, splash, torch ember particles. |
| `src/engine/Game.ts` | Master controller: fixed-timestep simulation loop, worker pool bridge, state transitions, auto-save trigger. |
| `src/storage/schema.ts` | Versioned IndexedDB save schemas (`CURRENT_SAVE_VERSION`) and pure migration pipeline. |
| `src/storage/SaveManager.ts` | IndexedDB persistence for world metadata, modified chunks, player, containers, time, and user settings. |
| `src/ui/Menus.ts` | Main Menu (original SVG emblem, seed input, Continue World), Pause Menu, Settings Modal, Death Screen, save-migration banner. |
| `src/ui/HUD.ts` | Crosshair, Hearts/Hunger/Armor/Oxygen pip bars, 9-slot Hotbar with durability bars, held-item & system toasts, hurt/underwater overlays. |
| `src/ui/DebugOverlay.ts` | Toggleable `F3` telemetry overlay (FPS, JS frame ms, XYZ, chunk, facing, biome, sky/block light, draw calls, triangles, worker timings). |
| `src/ui/InventoryUI.ts` | Interactive Inventory (2×2 crafting), Workbench (3×3 crafting), Furnace (fuel/smelt progress), and Chest UI with drag, right-click split, and Shift quick-transfer. |
| `src/debug/DebugAPI.ts` | Exposes `window.__game` in dev/test builds (or `?debug=1`) with strict player-simulation operations + read-only telemetry. |

---

## 3. Core Frozen Interfaces (M0 Contract)

### 3.1 `IWorld` (`src/world/World.ts`)
```ts
export interface IWorld {
  readonly seed: number;
  getBlock(x: number, y: number, z: number): BlockId;
  setBlock(x: number, y: number, z: number, id: BlockId, meta?: number): boolean;
  getMeta(x: number, y: number, z: number): number;
  setMeta(x: number, y: number, z: number, meta: number): void;
  getSkyLight(x: number, y: number, z: number): number;
  getBlockLight(x: number, y: number, z: number): number;
  getLight(x: number, y: number, z: number): number; // max(sky, block)
  getBiome(x: number, z: number): BiomeId;
  getChunk(cx: number, cz: number): Chunk | undefined;
  setChunk(chunk: Chunk): void;
  unloadChunk(cx: number, cz: number): void;
  getLoadedChunkCoords(): ChunkCoord[];
}
```

### 3.2 `BlockDefinition` (`src/registry/blocks.ts`)
```ts
export interface BlockDefinition {
  id: BlockId;
  key: string;
  name: string;
  solid: boolean;
  transparent: boolean;
  liquid: boolean;
  cutout: boolean;
  translucent: boolean;
  gravity: boolean;
  climbable: boolean;
  replaceable: boolean;
  hardness: number;         // seconds base break time; -1 = unbreakable
  toolType: ToolType | null;
  minToolTier: ToolTier;    // minimum tier required for drop (ToolTier.None = hand works)
  dropItem: ItemId | null;
  dropCount: number;
  lightEmission: number;    // 0..15
  lightOpacity: number;     // 0..15 (15 = opaque, 1 = leaves/water, 0 = air)
  height: number;           // 1.0 normal block, 0.5 slab, etc.
  textures: { top: string; bottom: string; side: string };
}
```

### 3.3 `ItemDefinition` (`src/registry/items.ts`)
```ts
export interface ItemDefinition {
  id: ItemId;
  key: string;
  name: string;
  maxStack: number;         // 64 for normal items, 1 for tools/armor/bows
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
  fuelTicks?: number;       // 20 ticks = 1 sec
  isBow?: boolean;
  isArrow?: boolean;
  isBonemeal?: boolean;
}
```

### 3.4 `EventBus` (`src/core/events.ts`)
Events emitted across systems:
- `block:changed` `{ x, y, z, oldId, newId }`
- `chunk:loaded` `{ cx, cz }`
- `chunk:dirty` `{ cx, cz }`
- `player:damaged` `{ amount, source, health }`
- `player:died` `{ pos, cause }`
- `player:respawned` `{ pos }`
- `entity:spawned` `{ id, kind }`
- `entity:killed` `{ id, kind, pos }`
- `inventory:changed` `{}`
- `container:opened` `{ type, pos }`
- `container:closed` `{}`
- `world:saved` `{ worldId, timestamp }`
- `sound:play` `{ name, volume?, pitch? }`
- `particles:burst` `{ pos, blockId?, color?, count?, kind? }`

### 3.5 `IGameDebugAPI` (`window.__game`, `src/debug/DebugAPI.ts`)
Available in dev/test builds. Strictly simulates normal player actions — NEVER directly injects items into inventory:
```ts
export interface IGameDebugAPI {
  ready(): boolean;
  getMode(): GameMode;
  startNewWorld(seed?: number | string, name?: string): Promise<void>;
  continueWorld(): Promise<void>;
  saveNow(): Promise<void>;
  setLook(yaw: number, pitch: number): void;
  setKey(code: string, down: boolean): void;
  releaseAllKeys(): void;
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
```
