# Design & Technical Decisions (DECISIONS.md)

## 1. Original Identity & Naming
- **Game Name**: **Stoneroot**
  - Original title, logo, UI theme (weathered parchment/slate survival aesthetic), procedural 16×16 pixel textures, and WebAudio sound effects.
- **Rare Gem**: **Prismite** (`prismite_ore`, `prismite_gem`, `prismite_*` tools) — deep underground crystalline teal-violet ore (distinct from commercial voxel games).
- **Passive Mobs**:
  - **Meadow Boar** (`boar`) — drops Raw Pork & Leather
  - **Woolhorn Ram** (`ram`) — drops Raw Mutton & Wool
  - **Crested Fowl** (`fowl`) — drops Raw Fowl & Feather
- **Hostile Mobs** (generic fantasy themes, 100% original silhouette & palette):
  - **Ash Husk** (`husk`, zombie archetype) — pale slate-ash shrouded undead with amber eyes; melee chase, burns in sunlight, drops Rotten Flesh.
  - **Hollow Archer** (`bone_archer`, skeleton archetype) — hooded ivory bone ranger with wooden recurve bow; standoff ranged combat with parabolic arrows, burns in sunlight, drops Bone & Arrow.
  - **Gloom Spider** (`gloom_spider`, giant spider archetype) — wide 8-legged burgundy/violet-striped cavern arachnid; climbs walls, neutral in daylight and hostile at night/provoked, drops Silk Thread.

## 2. Architecture & Engine Choices
- **Chunk Dimensions**: `16 × 128 × 16` (`CHUNK_SIZE = 16`, `WORLD_HEIGHT = 128`, `SEA_LEVEL = 56`).
  - Rationale: Meets `≥128` height requirement while keeping chunk memory compact (`32,768` blocks/chunk, 32KB block array + 32KB light array) so Worker generation + meshing + lighting stays very fast (< 10ms/chunk).
- **Block & Light Storage**: Flat `Uint8Array` indexed as `(y << 8) | (z << 4) | x` (x in 0..15, z in 0..15, y in 0..127).
  - Light packed into 1 byte per voxel: high nibble `(skyLight & 0x0f) << 4`, low nibble `blockLight & 0x0f`.
- **Web Worker Strategy**:
  - Terrain generation, deterministic village stamping, initial column sky-light + block-light propagation, and chunk meshing run in a dedicated Web Worker (`world.worker.ts`) communicating via transferable `ArrayBuffer`s (`Float32Array` / `Uint32Array`).
  - Main thread maintains authoritative `Chunk` data for active chunks (receiving generated chunk arrays from the worker) so synchronous player physics, raycasting, mining, placing, AI pathfinding, and incremental lighting updates happen with zero async latency, while geometry rebuilding is offloaded to the Worker!
- **Transparent / Cutout Rendering Order**:
  - Three separate geometry buckets per chunk:
    1. `opaque`: standard solid blocks (`alphaTest: 0`, `transparent: false`, depthWrite true)
    2. `cutout`: leaves, tall grass, flowers, crops, torches, ladders, doors (`alphaTest: 0.5`, `transparent: false`, `DoubleSide` for cross-billboards)
    3. `translucent`: water and glass (`transparent: true`, `depthWrite: false`, `renderOrder: 1`, back-face/culling tuned so water and glass never hide opaque terrain and sort cleanly)
- **Deterministic Cross-Chunk Villages**:
  - Villages are assigned on a `16×16` chunk macro-grid (`256×256` blocks per region) using a deterministic hash of `(worldSeed, regionX, regionZ)`.
  - Each valid region generates a complete `VillagePlan` (well, road, 4–8 houses, 1–2 farms, furnishing placements, chest loot seed) purely from the world seed and deterministic terrain height/biome sampler functions.
  - Because `VillagePlan` depends only on the seed and pure height/biome functions, any chunk intersecting the village bounding box stamps its portion of the structures identically regardless of chunk load order!
- **Step-Up / Half-Block Collision**:
  - In addition to standard 1×1×1 blocks, we include a `stone_slab` (half-height solid block, height `0.5`) so half-block step-up physics is genuinely playable, craftable, and directly testable in M2 unit tests.
- **Node.js Runtime Selection**:
  - Default `D:\node.exe` in system PATH is `v16.20.2`, which is below the SPEC requirement (`≥18`). Found pre-installed `v22.23.5` at `C:\Users\Administrator\AppData\Local\pi-node\current\node.exe`. We prepend that directory to `PATH` in our build/test commands rather than modifying global OS environment settings.
- **Spawn Waystone Torch**:
  - When a new world's initial spawn chunk finishes loading, a single Pitch Torch is placed on the ground 2 blocks beside the world's spawn point (marking the player's origin). This preserves a 100% empty starting inventory while giving players (and M3+ E2E lighting tests) an immediate natural in-world torch they can legitimately mine and relocate into caves without ever injecting items into inventory.
- **IndexedDB Save Schema & Modified-Chunk-Only Storage**:
  - Save DB (`stoneroot-saves`) stores `worlds`, `chunks`, and `settings` separately with `CURRENT_SAVE_VERSION = 2`. Only chunks where the player modified blocks are persisted in IndexedDB; unmodified terrain regenerates deterministically from the world seed. Pure migration (`migrateWorldSave`) upgrades v1 → v2 and safely rejects corrupt/future versions with a non-crashing UI warning and fresh start.
- **Main-Thread Frame Budget & Worker Offloading (M8)**:
  - To guarantee `< 8ms` main-thread JS frame time even at Render Distance 8 (`197` chunks) during rapid chunk-border crossings: (1) chunk terrain, village chest discovery, initial lighting, and meshing run in the Web Worker; (2) completed Worker payloads drain via a shared ~2.6ms/frame time-sliced queue (while priority player-edit remeshes upload immediately with zero latency); (3) `World` maps chunks using exact 52-bit integer keys + 1-slot cache (zero string allocations); (4) `propagateCrossChunkLight` diffs chunk boundary light directly on flat `Uint8Array`s so already-matching sky-15 air columns do zero BFS work; (5) `Chunk.hasFarmBlocks` lets `FarmingSystem` skip non-farm chunks in O(1); (6) `Renderer` assigns a precomputed local chunk bounding sphere (`center=(8,64,8), r=65.5`) instead of scanning all vertices on upload.
- **Procedural Audio & Pooled Particles (M8)**:
  - All 13 game sound cues (`dig`, `break`, `place`, `step`, `splash`, `hit`, `hurt`, `bow`, `eat`, `pickup`, `door`, `craft`, `ui`) are synthesized at runtime via WebAudio oscillators and filtered noise buffers (zero external files), safely degrading to no-op in headless/muted environments.
  - Dig, block-break, water-splash, and ember particles use a single 256-instance `THREE.InstancedMesh` (1 draw call total, zero per-frame allocations).
- **Root URL vs `?seed=` Entry Flow**:
  - Opening `/` displays the original **Stoneroot** Main Menu over a live orbiting 3D voxel landscape (with New World, Continue World, and Settings). Opening `/?seed=<value>` launches directly into gameplay for automated E2E scenarios and quick seed sharing.

## 3. Out-of-Scope Enforcement (SPEC §3.2)
Explicitly excluded and will not be implemented:
- Alternate dimensions (Nether/End) and Bosses
- Teleportation items
- Redstone / circuitry
- Enchanting and brewing
- Villager NPCs and trading (villages are architectural + loot chests only)
- Other structures (dungeons, temples, strongholds)
- Multiplayer, achievements, chat commands, mod loader
