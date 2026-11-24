# Project Progress (PROGRESS.md)

## Environment
- **OS**: Windows
- **Node.js**: `v22.23.5` (`C:\Users\Administrator\AppData\Local\pi-node\current\node.exe`)
- **npm**: `10.9.9`
- **GPU**: Intel(R) Iris(R) Xe Graphics
- **Browser E2E**: Chromium (system Chrome via Playwright with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`)
- **Repository**: Git on branch `main`

## Current Milestone
- **Active**: **M2 — Player & Interaction**
- **Status**: Starting M2 (M0 and M1 completed, verified, and committed)

## Milestone Status (M0 – M8)

| Milestone | Status | Evidence |
|---|---|---|
| **M0 Architecture** | **DONE** | `npm run build` (1.26s), `npm test` (`core.test.ts` 5/5), `npm run e2e` (`m0-smoke.spec.ts` 1/1), `docs/screenshots/M0-smoke.png`, commit `4b6779b` |
| **M1 Rendering World** | **DONE** | `npm run build` (1.72s, worker bundle `39.84 kB`), `npm test` (10/10 pass incl. `terrain.test.ts`), `npm run e2e` (2/2 pass incl. `m1-world.spec.ts`), `docs/screenshots/M1-world.png`, Gen `3.4ms`/chunk, Mesh `9.3ms`/chunk |
| **M2 Player & Interaction** | **In Progress** | — |
| **M3 Lighting & Sky** | Pending | — |
| **M4 Item System** | Pending | — |
| **M5 Survival & Villages** | Pending | — |
| **M6 Mobs** | Pending | — |
| **M7 UI & Saves** | Pending | — |
| **M8 Polish** | Pending | — |

## Completed Subtasks
- **[M0.1–M0.5]** Spec saved, architecture frozen, core registries/world/entity/debug scaffold verified (`4b6779b`).
- **[M1.1]** Froze `src/registry/textures.ts` (56-tile 8×8 UV registry) and `src/world/worker/protocol.ts`.
- **[M1.2]** Implemented procedural 16×16 pixel-art `src/engine/TextureAtlas.ts` (all 56 tiles, 10 break crack stages, 78 item icon painters, alpha-cutout leaves, translucent water/glass/ice).
- **[M1.3]** Implemented deterministic 6-biome `src/world/TerrainGenerator.ts` (Plains, Forest, Desert, Snow, Ocean, Mountains, 3D caves, depth-stratified ores incl. Prismite, 3 tree species cross-chunk consistent, flora, `findSafeSpawn`).
- **[M1.4]** Implemented face-culled smooth-lit AO `src/world/Mesher.ts` + `src/world/worker/world.worker.ts` + `src/engine/WorldWorkerClient.ts`.
- **[M1.5]** Implemented Three.js `src/engine/Renderer.ts`, `src/engine/InputManager.ts`, `src/engine/Game.ts`, and verified `tests/unit/terrain.test.ts` (5/5) + `tests/e2e/m1-world.spec.ts` + visually inspected `docs/screenshots/M1-world.png`.

## Blockers
- None.

## Next Step (M2 — Player & Interaction)
1. Implement pure collision & raycast modules:
   - `src/player/Physics.ts`: Substepped swept AABB collision handling high-speed falls (no tunneling), wall sliding, 0.5-block slab step-up, sneak edge-guard (never walks off ledges while sneaking), swimming buoyancy, and ladder climbing; plus `intersectsBlockAABB` to prevent placing blocks inside the player's body.
   - `src/player/Raycast.ts`: Pure Amanatides-Woo 3D DDA voxel raycast returning `{ pos, normal, adjacent, blockId, distance }`.
   - `src/player/Player.ts`: Full player state (pos, vel, yaw, pitch, onGround, inWater, headInWater, sneaking, sprinting, flying, vitals, mining progress, spawn point, held block/tool).
   - `src/world/GravityBlocks.ts`: Sand & Gravel gravity falling simulation when unsupported blocks beneath break.
2. Integrate Player, Physics, DDA Raycast, selection box, break-crack overlay, progressive mining (hardness × tool speed), block placement (preventing placement inside player AABB), and full M2 `window.__game` (`mineBlock`, `placeBlock`, `setKey`, `setLook`, `teleport`, `getBlock`, `getState`) into `src/engine/Game.ts`.
3. Add `tests/unit/physics.test.ts` (high-speed fall, wall sliding, 0.5-block step-up, sneak edge guard, DDA raycast accuracy, placement inside player blocked) and `tests/e2e/m2-interaction.spec.ts` (walk into wall for 5s without clipping, mine 1 block and verify world data, place 1 block and verify world data, capture `docs/screenshots/M2-interaction.png`).
4. Run `npm run build`, `npm test`, `npm run e2e`, inspect screenshot, update `PROGRESS.md`, commit M2.
