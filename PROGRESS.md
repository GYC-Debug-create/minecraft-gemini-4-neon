# Project Progress (PROGRESS.md)

## Environment
- **OS**: Windows
- **Node.js**: `v22.23.5` (`C:\Users\Administrator\AppData\Local\pi-node\current\node.exe`)
- **npm**: `10.9.9`
- **GPU**: Intel(R) Iris(R) Xe Graphics
- **Browser E2E**: Chromium (system Chrome via Playwright with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`)
- **Repository**: Git on branch `main`

## Current Milestone
- **Active**: **M7 — Menus, Settings, HUD, F3 Debug Overlay, & IndexedDB Saves**
- **Status**: Starting M7 (M0–M6 completed, verified, and committed)

## Milestone Status (M0 – M8)

| Milestone | Status | Evidence |
|---|---|---|
| **M0 Architecture** | **DONE** | `npm run build`, `npm test` (5/5), `npm run e2e` (1/1), `docs/screenshots/M0-smoke.png`, commit `4b6779b` |
| **M1 Rendering World** | **DONE** | `npm run build`, `npm test` (10/10), `npm run e2e` (2/2), `docs/screenshots/M1-world.png`, commit `f247a32` |
| **M2 Player & Interaction** | **DONE** | `npm run build`, `npm test` (16/16), `npm run e2e` (3/3), `docs/screenshots/M2-interaction.png`, commit `f728065` |
| **M3 Lighting & Sky** | **DONE** | `npm run build`, `npm test` (20/20), `npm run e2e` (4/4), `docs/screenshots/M3-{noon,dusk,midnight,cave-torch}.png`, commit `394b2b3` |
| **M4 Item System** | **DONE** | `npm run build`, `npm test` (24/24), `npm run e2e` (5/5), `docs/screenshots/M4-crafting.png`, commit `0895f33` |
| **M5 Survival & Villages** | **DONE** | `npm run build`, `npm test` (27/27), `npm run e2e` (6/6), `docs/screenshots/M5-village.png`, commit `85be1ac` |
| **M6 Mobs** | **DONE** | `npm run build` (2.03s), `npm test` (31/31 incl. `mobs.test.ts`: spawn light >= 7 blocked, A* wall avoidance & maxNodes cap, i-frames/knockback/sunburn/drops), `npm run e2e` (7/7 incl. `m6-mobs.spec.ts`: midnight open-field spawn, Oak Blade combat kill+drop, player-built sealed 5×5 torch-lit hut survives full night w/ 0 interior spawns), `docs/screenshots/M6-mobs.png` |
| **M7 UI & Saves** | **In Progress** | — |
| **M8 Polish** | Pending | — |

## Completed Subtasks
- **[M0–M5]** Core architecture, worker terrain/mesher/atlas, physics/raycast, lighting/sky/water, inventory/crafting/containers, survival/farming/villages (`4b6779b`..`85be1ac`).
- **[M6.1]** Implemented `src/entities/Pathfinding.ts` (bounded voxel grid A* with obstacle avoidance, 1-block step-up, safe drops, spider wall-climb, strict `maxNodes` cap).
- **[M6.2]** Implemented `src/entities/Mob.ts` (3 passive: Meadow Boar, Woolhorn Ram, Crested Fowl; 3 hostile: Ash Husk, Hollow Archer with parabolic arrows, Gloom Spider wall-climbing & day-neutral/night-hostile; sunlight burning, knockback, i-frames, drops), `src/entities/MobSpawner.ts` (strict light threshold < 7 rule, despawn > 64), and `src/entities/MobRenderer.ts` (original procedural 3D articulated voxel models).
- **[M6.3]** Integrated M6 into `src/engine/Game.ts`, fixed `attack()` tick isolation so mobs don't get extra AI ticks during player attack drop-settle, and verified `tests/unit/mobs.test.ts` (4/4) + `tests/e2e/m6-mobs.spec.ts` (pass, `docs/screenshots/M6-mobs.png`).

## Blockers
- None.

## Next Step (M7 — UI, Menus, Settings, F3, & IndexedDB Saves)
1. Implement `src/storage/schema.ts` & `src/storage/SaveManager.ts`:
   - Versioned IndexedDB persistence (`stoneroot-db`, `CURRENT_SAVE_VERSION = 2`):
     - Stores: `worlds` (world metadata, seed, worldTime, player state, inventory, armor, spawnPoint, containers, schema version), `chunks` (keyed by `${worldId}:${cx},${cz}`, storing ONLY modified chunks with `blocks`, `meta`, `biomes`), `settings` (renderDistance, fov, mouseSensitivity, volume).
     - Pure migration pipeline (`migrateWorldSave(raw)`) supporting v1 -> v2 cleanly; on unmigratable/corrupt future/unknown version returns `{ ok: false, reason }` so UI warns clearly and starts fresh without crashing!
   - Auto-save every 30s + save on pause / quit / `beforeunload` / `window.__game.saveNow()`.
   - When loading chunks from Worker on a continued world, overlay saved modified chunks from IndexedDB BEFORE lighting & meshing!
2. Implement polished original UI modules:
   - `src/ui/Menus.ts`: Original **Stoneroot** Main Menu (SVG pixel crest logo, New World with optional Seed input, Continue World button showing saved seed/day if a save exists, Settings panel with sliders for Render Distance 4–12, FOV 60–105, Mouse Sensitivity 0.2–2.5, Master Volume 0–100%), Pause Menu (`Esc`: Resume, Save & Quit to Menu, Settings), Save migration notice banner.
   - `src/ui/HUD.ts`: Polished visual HUD (Hearts row, Hunger row, Oxygen bubbles when submerged, Armor shield icons, Hotbar with durability bars & item name toast, Hurt vignette, Underwater blue tint).
   - `src/ui/DebugOverlay.ts`: Toggleable `F3` Debug Panel (FPS, JS frame ms, XYZ coords, Chunk coord, Facing N/S/E/W + yaw/pitch, Biome name, Sky/Block Light, Loaded Chunks, Draw Calls & Triangles).
3. **Zero-Regression Compatibility Note for M0–M6 E2E**:
   - Normal visitors at `/` see the Main Menu (`mode === 'menu'`), while URL `/?seed=...` (used by M1–M6 E2E tests!) auto-starts that seed straight into `'playing'`, AND `m0-smoke.spec.ts` visiting `/` sees `ready() === true` (or starts/renders live 3D background camera on main menu!). Even better: render the live animated 3D world canvas behind the translucent Main Menu (or start menu with live WebGL world preview!) so `/` ALREADY renders crisp WebGL terrain behind the title screen AND `m0-smoke` stays 100% green!!
4. Add `tests/unit/storage.test.ts` (using `fake-indexeddb`: save/load modified chunks + player + inventory + containers + settings, v1 -> v2 schema migration, corrupt/unknown version safe fallback without crash) and `tests/e2e/m7-ui-saves.spec.ts` (modify terrain + place item in inventory + place item in chest -> `saveNow()` -> `page.reload()` -> click/call Continue World -> assert terrain, inventory, AND chest contents match 100%; change settings -> reload -> verify settings persist; toggle F3 & verify debug panel visible; capture `docs/screenshots/M7-ui-save.png`).
5. Run `npm run build`, `npm test`, `npm run e2e`, inspect screenshot, update `PROGRESS.md`, commit M7.
