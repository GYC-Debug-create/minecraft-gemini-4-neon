# Project Progress (PROGRESS.md)

## Environment
- **OS**: Windows
- **Node.js**: `v22.23.5` (`C:\Users\Administrator\AppData\Local\pi-node\current\node.exe`)
- **npm**: `10.9.9`
- **GPU**: Intel(R) Iris(R) Xe Graphics
- **Browser E2E**: Chromium (system Chrome via Playwright with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`)
- **Repository**: Git on branch `main`

## Current Milestone
- **Active**: **M3 — Lighting, Sky, & Water**
- **Status**: Starting M3 (M0, M1, M2 completed, verified, and committed)

## Milestone Status (M0 – M8)

| Milestone | Status | Evidence |
|---|---|---|
| **M0 Architecture** | **DONE** | `npm run build` (1.26s), `npm test` (5/5), `npm run e2e` (1/1), `docs/screenshots/M0-smoke.png`, commit `4b6779b` |
| **M1 Rendering World** | **DONE** | `npm run build` (1.72s), `npm test` (10/10), `npm run e2e` (2/2), `docs/screenshots/M1-world.png`, commit `f247a32` |
| **M2 Player & Interaction** | **DONE** | `npm run build` (1.71s), `npm test` (16/16 incl. `physics.test.ts` high-speed fall/wall-slide/0.5-slab/sneak-guard/DDA/AABB-place), `npm run e2e` (3/3 incl. `m2-interaction.spec.ts` 5s wall-walk no-clip + dig/place world verify), `docs/screenshots/M2-interaction.png` |
| **M3 Lighting & Sky** | **In Progress** | — |
| **M4 Item System** | Pending | — |
| **M5 Survival & Villages** | Pending | — |
| **M6 Mobs** | Pending | — |
| **M7 UI & Saves** | Pending | — |
| **M8 Polish** | Pending | — |

## Completed Subtasks
- **[M0]** Architecture, registries, build/test/e2e scaffold (`4b6779b`).
- **[M1]** Worker terrain generation, procedural 16×16 atlas, AO mesher, free-fly world renderer (`f247a32`).
- **[M2.1]** Implemented `src/player/Physics.ts` (swept/substepped AABB, wall slide, 0.5-block slab step-up, sneak edge guard, swimming, ladder climbing, placement intersection guard), `src/player/Raycast.ts` (Amanatides-Woo DDA), `src/player/Player.ts`, and `src/world/GravityBlocks.ts` (Sand/Gravel falling).
- **[M2.2]** Integrated Player, DDA raycast, selection wireframe, progressive break cracks, dig/place, hotbar selection, and `window.__game` into `src/engine/Game.ts`.
- **[M2.3]** Verified M2 via `tests/unit/physics.test.ts` (6/6 pass) and `tests/e2e/m2-interaction.spec.ts` (pass, screenshot `docs/screenshots/M2-interaction.png`).

## Blockers
- None.

## Next Step (M3 — Lighting, Sky, & Water)
1. Implement `src/world/Lighting.ts`:
   - Full BFS sky-light propagation (`recomputeChunkLighting`, cross-chunk border propagation, sunlight = 15 straight down through opacity=0 columns, attenuated by `lightOpacity` through water/leaves/ice, horizontal & upward BFS decay -1 per block).
   - Full BFS block-light propagation (torches = 14, prismite ore = 3; decay -1 per step in 6 directions).
   - Incremental lighting updates (`updateLightingAt(world, x, y, z, oldId, newId)`): handles placing opaque blocks (removes sky/block light via dark-BFS removal queue + re-floods neighbors), breaking opaque blocks (propagates neighbor sky/block light into newly opened cavity & straight down sky columns!), placing light emitters (torch), and removing light emitters!
   - Marks all chunks touched by light propagation dirty so meshes update cleanly!
2. Implement `src/world/WaterFlow.ts`:
   - Finite water spread (source `meta === 0` flows down freely and horizontally up to `BALANCE.water.maxSpreadDistance = 5` steps with `meta = distance`; draining when source removed).
3. Integrate `Lighting` and `WaterFlow` into `src/world/World.ts`, `src/world/worker/world.worker.ts`, and `src/engine/Game.ts`, plus polish sky gradient dome (horizon glow at sunrise/sunset, starry night sky, crisp sun/moon/clouds, fog matched to sky color!). Also double-check Mesher border slice lighting so there are zero chunk-border light seams!
4. Add `tests/unit/lighting.test.ts` (enclosed sealed room skyLight === 0, torch light decays linearly by Manhattan distance from 14 down to 0, breaking ceiling/wall incrementally floods sky light into enclosed room, placing/breaking torch updates block light incrementally, water finite flow).
5. Add `tests/e2e/m3-lighting.spec.ts` capturing all 4 required screenshots: `docs/screenshots/M3-noon.png`, `docs/screenshots/M3-dusk.png`, `docs/screenshots/M3-midnight.png`, `docs/screenshots/M3-cave-torch.png` (proving noon bright, dusk warm sunset, midnight genuinely dark, cave lit warmly by a placed/naturally lit torch!).
6. Run `npm run build`, `npm test`, `npm run e2e`, inspect all 4 screenshots, update `PROGRESS.md`, commit M3.
