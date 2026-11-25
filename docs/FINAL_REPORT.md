# Stoneroot — Final Delivery Report

**Project**: Stoneroot (Original Browser-Based First-Person Voxel Survival Sandbox)  
**Repository**: `d:\Minecraft-geimini` (branch `main`)  
**Tech Stack**: TypeScript (`strict`), Vite 6, Three.js (rendering only), Web Worker, IndexedDB, Vitest, Playwright + Chromium  
**Environment**: Windows, Node.js `v22.23.5`, npm `10.9.9`, Intel(R) Iris(R) Xe Graphics

---

## 1. Executive Summary

All nine milestones (**M0 through M8**) defined in `docs/SPEC.md` have been completed, integrated, visually inspected via automated screenshots, and verified in a single unbroken regression pass:

- `npm run docs:recipes` — **PASS** (`README.md` crafting & smelting reference synchronized from `src/registry/recipes.ts`)
- `npm run build` (`tsc --noEmit && vite build`) — **PASS** (`2.10s`, 0 TypeScript errors)
- `npm test` (Vitest) — **PASS** (**9/9 test files, 35/35 unit tests**)
- `npm run e2e` (Playwright headless Chromium + SwiftShader) — **PASS** (**9/9 E2E specs, M0–M8 in one run**, 0 console/page errors)
- **Originality**: 100% original title (**Stoneroot**), procedural SVG emblem, unified warm-earthy 16×16 Canvas pixel-art textures (56 block tiles + 10 break crack stages + 78 item icons), 13 WebAudio-synthesized SFX cues, rare gem (**Prismite**), passive mobs (**Meadow Boar**, **Woolhorn Ram**, **Crested Fowl**), and hostile mobs (**Ash Husk**, **Hollow Archer**, **Gloom Spider**). Zero external art or audio assets downloaded.
- **Scope Discipline**: All Section 3.2 out-of-scope features (other dimensions, bosses, teleport items, redstone, enchanting, brewing, villager NPCs/trading, dungeons/temples, multiplayer, achievements, commands, mods) were strictly excluded and documented in `DECISIONS.md`.

---

## 2. Milestone Completion & Verification Evidence

| Milestone | Scope Summary | Verification Evidence | Screenshots | Git Commit |
|---|---|---|---|---|
| **M0 Architecture** | Directory layout, `World`/`Chunk`/`BlockRegistry`/`ItemRegistry`/`EventBus`/`EntitySystem`/`DebugAPI`, Vite + Vitest + Playwright scaffolding, `docs/SPEC.md` saved verbatim | `build`, `tests/unit/core.test.ts` (5 tests), `tests/e2e/m0-smoke.spec.ts` | `docs/screenshots/M0-smoke.png` | `4b6779b` |
| **M1 Rendering World** | Web Worker terrain gen (6 biomes, 3D caves, depth-stratified ores, 3 tree types, flora), face-culled mesher + smooth lighting/AO, procedural 16×16 Canvas texture atlas, free-fly camera | `build`, `tests/unit/terrain.test.ts` (5 tests: bit-identical seed determinism, ores, biomes, mesher), `tests/e2e/m1-world.spec.ts` | `docs/screenshots/M1-world.png` | `f247a32` |
| **M2 Player & Interaction** | Substepped swept AABB collision (high-speed fall, wall slide, 0.5-block `StoneSlab` step-up, sneak edge guard, swim, ladders), DDA raycast, block outline, break cracks, Sand/Gravel gravity, `window.__game` | `build`, `tests/unit/physics.test.ts` (6 tests), `tests/e2e/m2-interaction.spec.ts` (5s wall-walk no-clip + dig/place world assertions) | `docs/screenshots/M2-interaction.png` | `f728065` |
| **M3 Lighting, Sky & Water** | BFS sky + block light propagation, cross-chunk border light, incremental block-change lighting, zenith-to-horizon sky dome + sun/moon/stars/clouds/fog, finite water flow, priority remesh queue | `build`, `tests/unit/lighting.test.ts` (4 tests: enclosed room=0, torch distance decay, incremental ceiling break/reseal, water spread), `tests/e2e/m3-lighting.spec.ts` (incl. warm cave-torch brightness pixel check) | `docs/screenshots/M3-{noon,dusk,midnight,cave-torch}.png` | `394b2b3` |
| **M4 Item System** | 9+27+4 inventory, stacking/durability, drag/right-click split/Shift transfer, 2×2 & 3×3 shaped/mirrored/shapeless crafting, Workbench, Furnace (fuel/smelt), Chest, 4 tool tiers × 5 tools, Bow+Arrow, Armor, Dropped items | `build`, `tests/unit/inventory.test.ts` (4 tests), `tests/e2e/m4-progression.spec.ts` (**pure player actions only**: chop tree → planks → workbench → wood pick → stone → stone pick + furnace → iron ore → smelt → **Iron Pickaxe**) | `docs/screenshots/M4-crafting.png` | `0895f33` |
| **M5 Survival, Farming & Villages** | Health/hunger/saturation/oxygen, fall/drown/starve damage & respawn, food, Camp Bed (spawn + skip night), Hoe tilling, farmland hydration, crop growth stages & Bonemeal, deterministic cross-chunk biome villages (Plains/Desert/Snow) with lazy first-open chest loot | `build`, `tests/unit/village_survival.test.ts` (3 tests: bit-identical cross-chunk village determinism, survival vitals, farming), `tests/e2e/m5-survival-village.spec.ts` (fall/drown/starve death + respawn, crop growth + harvest, village chest loot) | `docs/screenshots/M5-village.png` | `85be1ac` |
| **M6 Mobs, AI & Combat** | 3 passive + 3 hostile original voxel mobs, bounded voxel grid A* pathfinding (with spider wall-climb & `maxNodes` cap), ranged parabolic skeleton arrows, sunlight burning, knockback, i-frames, light `< 7` hostile spawn rule | `build`, `tests/unit/mobs.test.ts` (4 tests: light >= 7 spawn blocked, A* obstacle avoidance, `maxNodes` cap, i-frames/knockback/sunburn/drops), `tests/e2e/m6-mobs.spec.ts` (midnight spawn, Oak Blade kill+drop, player-built sealed 5×5 lit hut survives full night with 0 interior spawns) | `docs/screenshots/M6-mobs.png` | `81f9974` |
| **M7 UI, F3 & IndexedDB Saves** | Versioned IndexedDB (`stoneroot-saves`, schema v2, modified-chunk-only persistence, pure v1→v2 migration + non-crashing corrupt fallback), auto-save & `beforeunload`, Main/Pause/Settings/Death menus, HUD vitals & hotbar, F3 debug overlay | `build`, `tests/unit/storage.test.ts` (2 tests: save/load + v1→v2 migration + corrupt fallback), `tests/e2e/m7-ui-saves.spec.ts` (settings persist across reload; terrain edit + inventory + chest split-half storage match 100% after `page.reload()` + Continue World; F3 panel verified) | `docs/screenshots/M7-{main-menu,ui-save}.png` | `37298ab` |
| **M8 Polish, Audio, Particles & Perf** | 13 procedural WebAudio SFX (`AudioEngine.ts`), 256-instance single-draw-call `InstancedMesh` voxel particles (`ParticleSystem.ts`), forearm+tunic first-person hand & walk camera bobbing, Render Distance 8 optimization & full regression | `docs:recipes`, `build`, `npm test` (35/35 incl. `tests/unit/audio_particles.test.ts`), `npm run e2e` (9/9 incl. `tests/e2e/m8-perf.spec.ts`), real GPU FPS probe | `docs/screenshots/M8-final.png` | *(M8 final commit)* |

---

## 3. Performance Measurements (SPEC Section 4)

All required Section 4 metrics were measured at **Render Distance 8** (`197` loaded chunks around spawn on seed `1337`, `1280×720` viewport), both in headless Chromium + SwiftShader (`tests/e2e/m8-perf.spec.ts`) and on the host's real hardware GPU (`Intel(R) Iris(R) Xe Graphics`, ANGLE Direct3D11).

### 3.1 Optimization Impact (Headless Chromium + SwiftShader, Render Distance 8)

| Metric | Pre-Optimization (Initial M8 Probe) | **Post-Optimization (Final Single-Pass Run)** | SPEC §4 Target |
|---|---:|---:|---|
| Loaded Chunks | `197` | **`197`** | Render Distance 8 |
| Draw Calls (RD 8) | `196` | **`270`** | Measured |
| Triangles (RD 8) | `698,622` | **`1,065,868`** | Measured |
| Single Chunk Generation (Worker avg) | `8.49 ms` | **`11.91 ms`** *(includes Worker-side village chest lookup + init light)* | Off main thread |
| Single Chunk Meshing (Worker avg) | `12.62 ms` | **`13.52 ms`** | Off main thread |
| **Main-Thread JS Frame Avg (Steady, excl. GPU)** | `9.05 ms` *(FAIL)* | **`0.94 ms`** *(p95 `1.30 ms`, max `2.60 ms`)* | **`< 8.0 ms` (PASS)** |
| **Main-Thread JS Frame Avg (Crossing 14 Chunks)** | `32.67 ms` *(FAIL)* | **`2.77 ms`** *(p95 `6.50 ms`)* | **`< 8.0 ms` (PASS)** |
| **Main-Thread JS Frame Max (Crossing 14 Chunks)** | `72.50 ms` | **`7.40 ms`** *(9.8× reduction)* | Recorded (`< 8.0 ms`) |
| Software-Rendered FPS (SwiftShader reference) | `4 FPS` | **`4–6 FPS`** | Reference only |

### 3.2 Real Hardware GPU Measurement (Render Distance 8)

Executed in Chromium with ANGLE Direct3D11 on `ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)` against the production bundle (`vite preview` at `1280×720`, Render Distance `8`, `197` loaded chunks, `262–270` draw calls, `~798k–841k` triangles):

- **Measured Real GPU FPS**: **`60 FPS` (6/6 consecutive windows locked at 60 FPS VSync)** — exceeds the SPEC §4 target (`≥ 55 FPS`) even on integrated laptop graphics.
- **Measured Main-Thread JS Frame Time on Real GPU**: **`0.18 – 0.65 ms`** steady-state average.

---

## 4. Known Issues & Technical Debt

Zero blocking bugs remain (`ISSUES.md` has 0 open blocking bugs). Non-blocking technical debt documented in `ISSUES.md`:

1. **[ENV-001 / ENV-002] Host Environment Notes (Resolved)**: Default `D:\node.exe` is `v16.20.2` (resolved by prepending `v22.23.5` to `PATH`); global `~/.npmrc` pointed to an unreachable mirror (resolved via project-local `.npmrc` pinning `registry.npmjs.org`).
2. **[TECH-001] Unsplit Vendor Bundle (~735 kB raw / ~198 kB gzip)**: Three.js is bundled in the main chunk, triggering Vite's 500 kB advisory; splitting Three.js via `manualChunks` would improve caching on repeat visits.
3. **[TECH-002] Single Web Worker Instance**: Terrain generation, lighting initialization, and chunk meshing run in one dedicated Worker (`~25.4 ms` combined per chunk). A 2–4 Worker pool would parallelize cold-start loading at high render distances.
4. **[TECH-003] Face-Culled Meshing (vs. Greedy Meshing)**: Neighbor face culling with smooth 4-corner lighting & vertex AO already achieves locked `60 FPS` on Intel Iris Xe at Render Distance 8 (`~0.8–1.0M` tris), so full greedy quad merging was left as future GPU headroom work.
5. **[TECH-004] Single-Slot Continue World UX**: IndexedDB persists worlds by `worldId` and Continue World resumes the most recent save; a multi-world list/delete manager is omitted to keep UI concise.
6. **[TECH-005] Simplified Finite Water**: Follows SPEC §3.1 ("源头 + 有限扩散即可"); water spreads finitely without horizontal entity currents or 2×2 infinite source refills.

---

## 5. Process Retrospective

### 5.1 Key Engineering Difficulties & Reworks

1. **Environment Bootstrapping (M0 — 2 early snags)**
   - The host's default `node` binary was `v16.20.2`, failing Vite 6 and Vitest immediately; locating the pre-installed `v22.23.5` binary and pinning `.npmrc` to `registry.npmjs.org` unblocked the entire pipeline cleanly.
   - `worldToLocalCoord(-16)` initially returned `-0` via modulo arithmetic (breaking `Object.is` in Vitest); replaced with bitwise `Math.floor(v) & 15`.
2. **M3 Underground Cave Torch Rendered Pure Black Despite Valid Light Telemetry (1 major rework — caught by visual inspection!)**
   - `m3-lighting.spec.ts` reported `Light: S0 / B11` after placing a torch underground, yet visually inspecting `docs/screenshots/M3-cave-torch.png` revealed a completely black cave wall.
   - **Root cause**: Two compounding bugs in `Game.ts`: (a) player block-edit remeshes entered the back of the same FIFO `remeshQueue` behind ~80 background chunk-load neighbor remeshes; (b) `processRemeshQueue()` silently dropped dirty notifications if the target chunk was already `inflightMesh`.
   - **Fix**: Introduced dual-priority queues (`priorityRemeshQueue` vs `remeshQueue`) + `remeshAgainAfterInflight` set, and added a real canvas pixel-brightness assertion to `m3-lighting.spec.ts` so visual regressions can never pass silently.
3. **M5 & M6 Test Interaction & Combat Reworks (2 reworks)**
   - Adding M6 hostile mobs initially broke M5's starvation E2E test because the long starvation wait crossed into night and mobs killed the player before hunger hit 0; fixed test framing to stay in daytime during starvation verification.
   - In M6, `window.__game.attack()` stepped the full `EntitySystem` 16 ticks to let dropped items settle — inadvertently granting mobs 16 free AI/attack ticks per player punch! Fixed `attack()` to settle only `dropped_item` entities.
   - Building a completely sealed 5×5 roofed hut using pure player raycast placement in `m6-mobs.spec.ts` took 2 iterations to eliminate roof gaps (caused by placing blocks from inside overlapping player AABBs); leveling the floor first and raycasting side faces from below achieved `missingShell === 0`, `sky === 0`, `block >= 12`, and `0` interior hostile spawns.
4. **M7 Save Round-Trip Edge Cases (2 quick test fixes)**
   - Placing a Chest on a surface column with `TallGrass` replaced the grass in-place (`y = 64`) rather than stacking at `y = 65`; updated solid-surface detection in `m7-ui-saves.spec.ts`.
   - Waiting 600ms for the F3 overlay screenshot *after* `saveNow()` let a dropped Dirt entity magnetize into slot 0 and get saved on `beforeunload` — actually proving `beforeunload` auto-save worked, and resolved by snapshotting `invBefore` + `saveNow()` immediately before `page.reload()`.
5. **M8 Render Distance 8 Profiling & Real Bottleneck Discovery (3 iterations — biggest payoff!)**
   - First time-slicing pass introduced a subtle infinite duplicate-gen loop (`inflightGen.delete(k)` fired before `completedGenQueue` inserted the chunk into `World`, causing `streamChunks()` to re-request the same chunks). Fixed with `completedGenSet`.
   - Initial RD 8 measurement failed the `< 8 ms` JS budget (`9.05 ms` steady avg, `32.67 ms` crossing avg, `72.5 ms` crossing max). Profiling immediately exposed three true culprits:
     1. `FarmingSystem.runGrowthPass()` scanned all `197 × 32,768 = 6.45M` blocks on the main thread (`~25 ms` spikes) → fixed with `Chunk.hasFarmBlocks` (`< 0.05 ms`).
     2. `propagateCrossChunkLight()` pushed all `~8,000` already-lit `sky = 15` border air voxels into BFS with string-keyed `World` lookups (`~20 ms/chunk`) → fixed with direct flat-array seam differential checking (`< 0.15 ms/chunk`) + 52-bit integer `World` chunk keys. (Note: our first integer key used `2^27 × 2^28 = 2^55 > Number.MAX_SAFE_INTEGER`, immediately caught on the next benchmark run and corrected to `2^25 × 2^26 = 2^52`.)
     3. Main-thread `getVillageChestsInChunk()` and `geo.computeBoundingSphere()` during chunk upload → moved village chest discovery into the Web Worker and assigned exact constant local chunk bounding spheres.
   - Final result: steady JS dropped **9.6×** (`9.05 ms → 0.94 ms`), chunk-crossing max JS dropped **9.8×** (`72.5 ms → 7.40 ms`), and real Intel Iris Xe GPU achieved **locked 60 FPS** at Render Distance 8.

### 5.2 Deliberately Simplified / Downgraded Approaches

- **Face-Culled Meshing instead of Full Greedy Meshing**: Kept `Mesher.ts` clean, bug-free across 4-corner smooth light + vertex AO + non-cubic shapes (slabs, doors, torches, ladders, billboards), and verified locked `60 FPS` on integrated GPU at RD 8 without needing greedy quad splitting.
- **Finite Water Spread without Fluid Simulation**: Implemented deterministic source + 7-block horizontal spread + vertical fall + drain (per SPEC §3.1), avoiding unstable infinite-ocean flooding.
- **Shader-Uniform Day/Night Lighting**: Packed `(smoothSky, smoothBlock, ao * faceShade)` into vertex colors so sunrise/noon/dusk/midnight sky and torch transitions run in O(1) GPU uniforms with zero per-frame chunk remeshing.

### 5.3 Subagent Orchestration Lessons

- In **M1**, delegating `TextureAtlas` and `TerrainGenerator`+`Mesher` to two `module-implementer` subagents produced high-quality code, **but** both subagents ran ~12 minutes on `inherit` reasoning effort because they autonomously wrote throwaway pixel/performance audit scripts outside their assigned file scope. We rejected/removed the temporary audit scripts before integration and verified directly via our own build + unit + E2E tests.
- Based on that feedback, for **M2–M8** we kept tight direct orchestration over tightly coupled simulation/renderer/Game modules, ensuring every milestone stayed strictly scoped, fast, zero-regression, and verified end-to-end with visual screenshot checks before every commit.
