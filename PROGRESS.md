# Project Progress (PROGRESS.md)

## Environment
- **OS**: Windows
- **Node.js**: `v22.23.5` (`C:\Users\Administrator\AppData\Local\pi-node\current\node.exe`)
- **npm**: `10.9.9`
- **GPU**: Intel(R) Iris(R) Xe Graphics
- **Browser E2E**: Chromium (system Chrome via Playwright with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`)
- **Repository**: Git initialized on branch `main`

## Current Milestone
- **Active**: **M1 — World Generation & Rendering**
- **Status**: Starting M1 (M0 completed and verified)

## Milestone Status (M0 – M8)

| Milestone | Status | Evidence |
|---|---|---|
| **M0 Architecture** | **DONE** | `npm run build` (1.26s, 0 TS errors), `npm test` (`tests/unit/core.test.ts` 5/5 pass), `npm run e2e` (`tests/e2e/m0-smoke.spec.ts` 1/1 pass), `docs/screenshots/M0-smoke.png`, `ARCHITECTURE.md` |
| **M1 Rendering World** | **In Progress** | — |
| **M2 Player & Interaction** | Pending | — |
| **M3 Lighting & Sky** | Pending | — |
| **M4 Item System** | Pending | — |
| **M5 Survival & Villages** | Pending | — |
| **M6 Mobs** | Pending | — |
| **M7 UI & Saves** | Pending | — |
| **M8 Polish** | Pending | — |

## Completed Subtasks
- **[M0.1]** Saved verbatim specification to `docs/SPEC.md` (read-only).
- **[M0.2]** Authored `ARCHITECTURE.md`, `DECISIONS.md`, `ISSUES.md`, `README.md`, and `scripts/generate-recipes-doc.ts`.
- **[M0.3]** Configured Vite + TypeScript strict + Three.js + Vitest + Playwright (`package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `.npmrc`).
- **[M0.4]** Implemented core interfaces and registries: `src/config/constants.ts`, `src/config/balance.ts`, `src/core/{types,events,rng,noise}.ts`, `src/registry/{blocks,items,recipes,loot}.ts`, `src/world/{Chunk,World}.ts`, `src/entities/EntitySystem.ts`, `src/debug/DebugAPI.ts`, `src/main.ts`.
- **[M0.5]** Verified M0 with `tests/unit/core.test.ts` (5/5 pass) and `tests/e2e/m0-smoke.spec.ts` (1/1 pass, screenshot `docs/screenshots/M0-smoke.png`).

## Blockers
- None.

## Next Step (M1 — World Generation & Rendering)
1. Freeze M1 Worker protocol (`src/world/worker/protocol.ts`) and Texture Atlas UV table (`src/engine/TextureAtlas.ts`) contracts in `ARCHITECTURE.md`.
2. Dispatch parallel module implementation:
   - `src/engine/TextureAtlas.ts`: Procedural 16×16 pixel-art atlas for every block texture + item icons + 10-stage break-crack overlay textures (uniform original earthy pixel palette, shaded textures, zero flat solid fills).
   - `src/world/TerrainGenerator.ts`: Deterministic 6-biome terrain (Plains, Forest, Desert, Snow, Ocean/Beach, Mountains), natural transitions, 3D noise caves, depth-stratified ores (Coal, Iron, Gold, Prismite), 3 tree types (Oak, Silverwood/Birch, Frostpine), flora (tall grass, wildflowers, dry scrub), water bodies.
   - `src/world/Mesher.ts` + `src/world/worker/protocol.ts` + `src/world/worker/world.worker.ts`: Face-culled chunk mesher with smooth 4-corner vertex AO & lighting colors (prepared for M3 sky/block light), separate opaque / cutout / translucent geometry buffers, cross-billboards & half-slab heights, Web Worker execution with transferable ArrayBuffers.
3. Implement `src/engine/Renderer.ts`, `src/engine/InputManager.ts`, and `src/engine/Game.ts` (M1 free-fly camera + infinite chunk streaming around camera + worker pool + perf timing counters).
4. Write `tests/unit/terrain.test.ts` (same seed -> identical chunks, different seeds -> different chunks, biome/ore/cave coverage) and `tests/e2e/m1-world.spec.ts` (fly around infinite terrain, verify chunk streaming & textured WebGL rendering, save `docs/screenshots/M1-world.png`).
5. Run `npm run build`, `npm test`, `npm run e2e`, inspect `docs/screenshots/M1-world.png`, update `PROGRESS.md`, commit M1.
