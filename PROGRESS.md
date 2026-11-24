# Project Progress (PROGRESS.md)

## Environment
- **OS**: Windows
- **Node.js**: `v22.23.5` (`C:\Users\Administrator\AppData\Local\pi-node\current\node.exe`)
- **npm**: `10.9.9`
- **GPU**: Intel(R) Iris(R) Xe Graphics
- **Browser E2E**: Chromium (system Chrome via Playwright with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`)
- **Repository**: Git on branch `main`

## Current Milestone
- **Active**: **M5 — Survival, Farming, & Villages**
- **Status**: Starting M5 (M0–M4 completed, verified, and committed)

## Milestone Status (M0 – M8)

| Milestone | Status | Evidence |
|---|---|---|
| **M0 Architecture** | **DONE** | `npm run build`, `npm test` (5/5), `npm run e2e` (1/1), `docs/screenshots/M0-smoke.png`, commit `4b6779b` |
| **M1 Rendering World** | **DONE** | `npm run build`, `npm test` (10/10), `npm run e2e` (2/2), `docs/screenshots/M1-world.png`, commit `f247a32` |
| **M2 Player & Interaction** | **DONE** | `npm run build`, `npm test` (16/16), `npm run e2e` (3/3), `docs/screenshots/M2-interaction.png`, commit `f728065` |
| **M3 Lighting & Sky** | **DONE** | `npm run build`, `npm test` (20/20), `npm run e2e` (4/4), `docs/screenshots/M3-{noon,dusk,midnight,cave-torch}.png`, commit `394b2b3` |
| **M4 Item System** | **DONE** | `npm run build` (1.70s), `npm test` (24/24 incl. `inventory.test.ts`), `npm run e2e` (5/5 incl. `m4-progression.spec.ts` pure player-action tree→Iron Pickaxe in 6.4s), `docs/screenshots/M4-crafting.png` |
| **M5 Survival & Villages** | **In Progress** | — |
| **M6 Mobs** | Pending | — |
| **M7 UI & Saves** | Pending | — |
| **M8 Polish** | Pending | — |

## Completed Subtasks
- **[M0–M3]** Architecture, worker terrain/mesher/atlas, physics/raycast/interaction, BFS lighting/sky/water (`4b6779b`, `f247a32`, `f728065`, `394b2b3`).
- **[M4.1]** Implemented `src/player/Inventory.ts` (9+27+4 armor, stack 64, tool durability, drag/split/shift transfer), `src/systems/CraftingSystem.ts` (2×2 & 3×3 shaped/mirrored/shapeless matching), `src/systems/ContainerManager.ts` (Furnace fuel/smelt + Chest + lazy village loot hook), `src/entities/DroppedItem.ts`, `src/entities/Projectile.ts`.
- **[M4.2]** Implemented `src/entities/EntityRenderer.ts` and `src/ui/InventoryUI.ts` (Inventory/Workbench/Furnace/Chest modals with pixel icons & durability bars).
- **[M4.3]** Integrated full M4 systems into `src/engine/Game.ts` and `src/player/Player.ts`; verified `tests/unit/inventory.test.ts` (4/4) and `tests/e2e/m4-progression.spec.ts` (pure player survival chain to Iron Pickaxe, visually inspected `docs/screenshots/M4-crafting.png`).

## Blockers
- None.

## Next Step (M5 — Survival, Farming, & Villages)
1. Implement `src/systems/SurvivalSystem.ts`:
   - Fall damage (`fallPeakY` tracked while airborne -> damage `(fallDist - 3.5) * 1.0` on landing unless landing in water!).
   - Hunger & saturation drain from walking/sprinting/jumping/mining/idle; natural HP regen when `hunger >= 18`; cannot sprint when `hunger < 6`; starvation damage when `hunger <= 0`.
   - Oxygen drain underwater (`headInWater`), recovery above water, drowning damage when `oxygen <= 0`.
   - Armor damage reduction (`Inventory.getArmorDamageMultiplier()`), hurt red flash + invincibility frames, eating food items (Right-click / `useItem` restores hunger & saturation).
   - Death handling: drop all inventory items at death location, set `player.dead = true`, increment `deathCount`, show Death Screen with Respawn button (plus `window.__game.respawn()` or auto-respawn hook), respawn at `spawnPoint` with full HP/hunger/oxygen!
   - Bed interaction: Right-clicking a `Bed` sets `player.spawnPoint` AND if nighttime (`worldTime % 24000 >= 12000`), skips smoothly to dawn (`worldTime` -> next sunrise `1000`)!
2. Implement `src/systems/FarmingSystem.ts`:
   - Right-click `Dirt` or `Grass` with any Hoe -> tills into `Farmland` (wearing Hoe durability by 1).
   - Farmland hydration check within 4 blocks of `Water` -> `FarmlandWet`.
   - Periodic crop growth ticks (also accelerated cleanly by `advanceTime(ticks)`!) advancing `CropStage0 -> CropStage1 -> CropStage2 -> CropStage3`.
   - Right-clicking crops with `Bonemeal` advances crop by 1–2 stages immediately!
3. Implement `src/world/VillageGenerator.ts` and integrate into `src/world/TerrainGenerator.ts` (deterministic cross-chunk!):
   - Sparse villages in `Plains`, `Desert`, and `Snow` biomes on a `16×16` chunk macro-region grid (`256×256` blocks).
   - Pure `getVillagePlanForRegion(rx, rz, seed, sampleBiome, sampleHeight)` producing:
     - 1 biome-themed central **Well** (with water!)
     - 1 **Road** (`DirtPath` / `Sandstone` / `Gravel` lane)
     - 4 to 8 original biome-styled **Houses** (solid terrain-adapted foundation columns down to ground so never floating, gentle overhead clearing so never buried, pitched roof, walls, glass windows, wooden door, interior torch, random deterministic placement of `Bed`, `Workbench`, `Furnace`, and guaranteed >= 1 `Chest` per village!)
     - 1 to 2 fenced **Farms** with hydrated `FarmlandWet`, water channel, and growing/ripe crops (`CropStage2`/`CropStage3`)!
   - Deterministic `stampVillageIntoChunk(chunk, seed, sampleBiome, sampleHeight)` called inside `TerrainGenerator.generateChunk`, plus `getVillageChestsInChunk(cx, cz, ...)` so `Game.ts` registers every village chest's lazy deterministic `lootSeed` in `ContainerManager` (loot generated ONLY on first open, then saved as a normal chest!).
4. Add `tests/unit/village_survival.test.ts` (same seed -> bit-identical village layout & cross-chunk continuity; fall/starvation/drowning/armor/food/crop growth unit tests) and `tests/e2e/m5-survival-village.spec.ts` (e2e verify starve death + respawn, drown death + respawn, fall death + respawn, accelerated crop growth & harvest, locate village & capture `docs/screenshots/M5-village.png`, open village chest & verify loot items!).
5. Run `npm run build`, `npm test`, `npm run e2e`, inspect `M5-village.png`, update `PROGRESS.md`, commit M5.
