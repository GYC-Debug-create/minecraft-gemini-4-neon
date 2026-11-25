# Project Progress (PROGRESS.md)

## Environment
- **OS**: Windows
- **Node.js**: `v22.23.5` (`C:\Users\Administrator\AppData\Local\pi-node\current\node.exe`)
- **npm**: `10.9.9`
- **GPU**: Intel(R) Iris(R) Xe Graphics (Direct3D11 ANGLE)
- **Browser E2E**: Chromium (system Chrome via Playwright with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`)
- **Repository**: Git on branch `main`

## Current Milestone
- **Status**: **ALL MILESTONES (M0 – M8) COMPLETED & VERIFIED**
- **Final Report**: [docs/FINAL_REPORT.md](docs/FINAL_REPORT.md)

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
| **M7 UI & Saves** | **DONE** | `npm run build`, `npm test` (33/33), `npm run e2e` (8/8), `docs/screenshots/M7-{main-menu,ui-save}.png`, commit `37298ab` |
| **M8 Polish & Perf** | **DONE** | `npm run docs:recipes`, `npm run build` (2.10s), `npm test` (35/35, 9 files), `npm run e2e` (9/9 single-pass M0–M8), `docs/screenshots/M8-final.png`, `docs/FINAL_REPORT.md` |

## Section 4 Measured Performance Metrics (Render Distance 8)

Measured in `tests/e2e/m8-perf.spec.ts` (headless Chromium + SwiftShader) and hardware GPU verification on `Intel(R) Iris(R) Xe Graphics (Direct3D11)`:

| Metric | Measured Value | Target (SPEC §4) | Status |
|---|---|---|---|
| Render Distance | `8` chunks (`197` loaded chunks) | `8` chunks | PASS |
| Single Chunk Generation (Worker avg) | `11.91 ms` (post-crossing `13.84 ms`) | Off main thread | PASS |
| Single Chunk Meshing (Worker avg) | `13.52 ms` (post-crossing `16.53 ms`) | Off main thread | PASS |
| Draw Calls (RD 8) | `270` (`262–270` on real GPU) | Measured | PASS |
| Triangles (RD 8) | `1,065,868` (`~798k–841k` on real GPU view) | Measured | PASS |
| Main-Thread JS Frame Time — Steady Avg (excl. GPU) | **`0.94 ms`** (p95 `1.30 ms`, max `2.60 ms`) | `< 8.0 ms` | **PASS** |
| Main-Thread JS Frame Time — Crossing 14 Chunk Borders | Avg **`2.77 ms`**, p95 `6.50 ms`, **Max `7.40 ms`** | Measured (`< 8 ms`) | **PASS** |
| Software FPS (SwiftShader reference only) | `4–6 FPS` | Reference only | Recorded |
| Real GPU FPS (`Intel(R) Iris(R) Xe Graphics` D3D11) | **`60 FPS`** locked (`0.18–0.65 ms` JS avg) | `≥ 55 FPS` | **PASS** |

## Completed Subtasks (M8)
- **[M8.1]** Implemented `src/engine/AudioEngine.ts` (13 procedural WebAudio SFX cues, volume control, rate-limiting, headless-safe degradation) and `src/engine/ParticleSystem.ts` (256-slot pooled single-draw-call `InstancedMesh` particles for mining chips, block breaks, water splashes, and embers) + unit tests in `tests/unit/audio_particles.test.ts`.
- **[M8.2]** Polished first-person arm (forearm + olive tunic sleeve + wrist cuff), visual-only walk camera bobbing, cached item-icon textures, zero-allocation `updateEnvironment()` color math, and dirty-checked HUD vitals/overlays.
- **[M8.3]** Profiled Render Distance 8 via `tests/e2e/m8-perf.spec.ts` and eliminated 4 main-thread bottlenecks (`FarmingSystem` `hasFarmBlocks` fast-skip, differential flat-array `propagateCrossChunkLight`, 52-bit integer `World` chunk keys, Worker-side `villageChests` + time-sliced Worker drain + constant chunk bounding sphere), cutting steady JS from `9.05ms → 0.94ms` and chunk-crossing max JS from `72.5ms → 7.40ms`.
- **[M8.4]** Measured real Intel Iris Xe GPU FPS (`60 FPS` locked at RD 8), regenerated `README.md` crafting/smelting tables (`npm run docs:recipes`), updated `ARCHITECTURE.md` / `DECISIONS.md` / `ISSUES.md`, verified full single-pass `build` + `test` (35/35) + `e2e` (9/9), and wrote `docs/FINAL_REPORT.md`.

## Blockers
- None.
