# Project Progress (PROGRESS.md)

## Environment
- **OS**: Windows
- **Node.js**: `v22.23.5` (`C:\Users\Administrator\AppData\Local\pi-node\current\node.exe`)
- **npm**: `10.9.9`
- **GPU**: Intel(R) Iris(R) Xe Graphics
- **Browser E2E**: Chromium (system Chrome via Playwright with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`)
- **Repository**: Git on branch `main`

## Current Milestone
- **Active**: **M8 — Polish, Procedural Audio, Particles, Performance Optimization & Final Report**
- **Status**: Starting M8 (M0–M7 completed, verified, and committed)

## Milestone Status (M0 – M8)

| Milestone | Status | Evidence |
|---|---|---|
| **M0 Architecture** | **DONE** | `npm run build`, `npm test` (5/5), `npm run e2e` (1/1), `docs/screenshots/M0-smoke.png`, commit `4b6779b` |
| **M1 Rendering World** | **DONE** | `npm run build`, `npm test` (10/10), `npm run e2e` (2/2), `docs/screenshots/M1-world.png`, commit `f247a32` |
| **M2 Player & Interaction** | **DONE** | `npm run build`, `npm test` (16/16), `npm run e2e` (3/3), `docs/screenshots/M2-interaction.png`, commit `f728065` |
| **M3 Lighting & Sky** | **DONE** | `npm run build`, `npm test` (20/20), `npm run e2e` (4/4), `docs/screenshots/M3-{noon,dusk,midnight,cave-torch}.png`, commit `394b2b3` |
| **M4 Item System** | **DONE** | `npm run build`, `npm test` (24/24), `npm run e2e` (5/5), `docs/screenshots/M4-crafting.png`, commit `0895f33` |
| **M5 Survival & Villages** | **DONE** | `npm run build`, `npm test` (27/27), `npm run e2e` (6/6), `docs/screenshots/M5-village.png`, commit `85be1ac` |
| **M6 Mobs** | **DONE** | `npm run build`, `npm test` (31/31), `npm run e2e` (7/7), `docs/screenshots/M6-mobs.png`, commit `81f9974` |
| **M7 UI & Saves** | **DONE** | `npm run build` (2.07s), `npm test` (33/33 incl. `storage.test.ts`: IndexedDB save/load + v1→v2 migration + corrupt fallback), `npm run e2e` (8/8 incl. `m7-ui-saves.spec.ts`: Main Menu, Settings persistence, terrain + inventory + chest full reload round-trip, F3 debug overlay), `docs/screenshots/M7-{main-menu,ui-save}.png` |
| **M8 Polish** | **In Progress** | — |

## Completed Subtasks
- **[M0–M6]** Core architecture, worker terrain/mesher/atlas, physics/raycast, lighting/sky/water, inventory/crafting/containers, survival/farming/villages, mobs/pathfinding/combat (`4b6779b`..`81f9974`).
- **[M7.1]** Implemented `src/storage/schema.ts` & `src/storage/SaveManager.ts` (versioned IndexedDB `stoneroot-saves` storing worlds, modified chunks only, and settings + v1→v2 migration + non-crashing corrupt-save fallback + 30s auto-save & `beforeunload` save).
- **[M7.2]** Implemented `src/ui/Menus.ts` (original Stoneroot SVG emblem Main Menu over live 3D rotating terrain, Seed input, Continue World, Pause Menu, Settings modal, Death screen), `src/ui/HUD.ts` (hearts, hunger, oxygen, armor, hotbar with durability & item toast, hurt/water overlays), and `src/ui/DebugOverlay.ts` (`F3` telemetry panel).
- **[M7.3]** Added `tests/unit/storage.test.ts` (2 tests) & `tests/e2e/m7-ui-saves.spec.ts` (pass); visually verified `M7-main-menu.png` & `M7-ui-save.png`; full regression 33/33 unit + 8/8 E2E green.

## Blockers
- None.

## Next Step (M8 — Polish, Audio, Particles, Performance & Final Report)
1. Implement procedural WebAudio synthesizer (`src/engine/AudioEngine.ts`) and wire footsteps, dig, break, place, melee hit, hurt, bow twang, eat, splash, and UI sounds obeying Settings volume.
2. Implement Three.js voxel particle bursts (`src/engine/ParticleSystem.ts`) for mining chips, block breaking, and water splashes, plus subtle first-person walk camera bob & hand polish.
3. Build `tests/e2e/m8-perf.spec.ts` to benchmark SPEC §4 metrics at render distance 8 (chunk gen+mesh ms, draw calls, triangles, avg JS frame ms `< 8ms`, max chunk-crossing JS frame ms, plus real-GPU check if available) and optimize any hot paths so JS frame times stay smooth.
4. Regenerate README crafting/smelting tables (`npm run docs:recipes`), update `ARCHITECTURE.md` & `README.md`, run full single-pass verification (`npm run build`, `npm test`, `npm run e2e`), write `docs/FINAL_REPORT.md`, and commit M8.
