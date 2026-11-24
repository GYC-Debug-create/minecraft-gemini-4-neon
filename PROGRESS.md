# Project Progress (PROGRESS.md)

## Environment
- **OS**: Windows
- **Node.js**: `v22.23.5` (`C:\Users\Administrator\AppData\Local\pi-node\current\node.exe`)
- **npm**: `10.9.9`
- **GPU**: Intel(R) Iris(R) Xe Graphics
- **Browser E2E**: Chromium (system Chrome via Playwright with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`)
- **Repository**: Git on branch `main`

## Current Milestone
- **Active**: **M4 — Item System (Inventory, Drops, Crafting, Tools, Furnace, Chest)**
- **Status**: Starting M4 (M0–M3 completed, verified, and committed)

## Milestone Status (M0 – M8)

| Milestone | Status | Evidence |
|---|---|---|
| **M0 Architecture** | **DONE** | `npm run build`, `npm test` (5/5), `npm run e2e` (1/1), `docs/screenshots/M0-smoke.png`, commit `4b6779b` |
| **M1 Rendering World** | **DONE** | `npm run build`, `npm test` (10/10), `npm run e2e` (2/2), `docs/screenshots/M1-world.png`, commit `f247a32` |
| **M2 Player & Interaction** | **DONE** | `npm run build`, `npm test` (16/16), `npm run e2e` (3/3), `docs/screenshots/M2-interaction.png`, commit `f728065` |
| **M3 Lighting & Sky** | **DONE** | `npm run build` (1.90s), `npm test` (20/20 incl. `lighting.test.ts` enclosed=0, torch decay across chunks, incremental roof break/reseal, finite water flow), `npm run e2e` (4/4 incl. `m3-lighting.spec.ts` + warm cave pixel check), screenshots `M3-noon.png`, `M3-dusk.png`, `M3-midnight.png`, `M3-cave-torch.png` |
| **M4 Item System** | **In Progress** | — |
| **M5 Survival & Villages** | Pending | — |
| **M6 Mobs** | Pending | — |
| **M7 UI & Saves** | Pending | — |
| **M8 Polish** | Pending | — |

## Completed Subtasks
- **[M0–M2]** Core architecture, worker terrain/mesher/atlas, physics/raycast/interaction (`4b6779b`, `f247a32`, `f728065`).
- **[M3.1]** Implemented `src/world/Lighting.ts` (intra-chunk worker BFS, cross-chunk border light exchange, incremental sky & block light removal/flood updates).
- **[M3.2]** Implemented `src/world/WaterFlow.ts` (finite spread water + vertical falls + draining when source removed).
- **[M3.3]** Upgraded `src/engine/Renderer.ts` with zenith-to-horizon sunset/night gradient sky dome, night starfield, clouds, sun/moon orbit, and sky-matched fog.
- **[M3.4]** Fixed remesh FIFO starvation & dropped in-flight edit remeshes in `src/engine/Game.ts` via priority remesh queue + `remeshAgainAfterInflight` tracking (caught by visually inspecting `M3-cave-torch.png`!).
- **[M3.5]** Verified M3 via `tests/unit/lighting.test.ts` (4/4) and `tests/e2e/m3-lighting.spec.ts` (all 4 screenshots visually inspected and verified).

## Blockers
- None.

## Next Step (M4 — Item System)
1. Implement pure item/crafting/container modules:
   - `src/player/Inventory.ts`: 9 hotbar + 27 main + 4 armor slots, stack merging (max 64, tools/armor max 1 with durability), drag/swap, right-click half-split, Shift quick-transfer between hotbar/main/container, durability wear & break, drop-all-on-death helper, serialization.
   - `src/systems/CraftingSystem.ts`: Pure 2×2 and 3×3 trimmed-bounding-box shaped + shapeless matcher against `CRAFTING_RECIPES` (`src/registry/recipes.ts`), `craftRecipeFromInventory` helper for workbench/hand crafting, and interactive crafting grid output preview + consume!
   - `src/systems/ContainerManager.ts`: Stores persistent world containers (`furnace`, `chest`) keyed by `"x,y,z"`; ticks active furnaces (fuel burn, smelt progress, output stacking); supports lazy village chest loot seeding (ready for M5) and serialization (ready for M7).
   - `src/entities/DroppedItem.ts`: Physical dropped item entity (pop impulse, gravity/ground settle, gentle bob & Y-rotation, stack merge with nearby same-item drops, magnet pickup into player inventory, 5-min despawn).
   - `src/entities/Projectile.ts`: Charged parabolic `ArrowEntity` (charge ratio -> velocity & damage, voxel collision, entity hit hook for M6).
2. Implement `src/ui/InventoryUI.ts`: Clean, playable DOM modal for Inventory (`E`, 2×2 crafting + armor), Crafting Bench (`3×3` crafting + quick-craft recipe list), Stone Kiln (`input`/`fuel`/`output` + flame & progress bars), and Timber Chest (`27` slots), supporting drag/click-pickup, right-click half-split, and Shift quick-transfer!
3. Integrate full Inventory, DroppedItems (rendered as 3D rotating pixel sprites/mini-blocks in `Renderer`), tool-type & tier mining speed + wrong-tool drop gate + tool durability wear, Q-drop, Bow charging + arrow firing, Workbench/Furnace/Chest placement & interaction, and M4 `window.__game` (`craft`, `moveSlot`, `openContainerAt`, `closeContainer`, `getOpenContainer`, `useItem`) into `src/engine/Game.ts`.
4. Add `tests/unit/inventory.test.ts` (stacking, durability, drag/split/shift-transfer, 2×2 & 3×3 shaped/shapeless crafting, furnace smelting + fuel) and `tests/e2e/m4-progression.spec.ts` (pure player-only survival loop: punch tree -> planks -> sticks -> workbench -> wood pickaxe -> stone -> stone pickaxe & furnace -> coal & iron ore -> smelt iron -> iron pickaxe; verify Iron Pickaxe in inventory + capture `docs/screenshots/M4-crafting.png`).
5. Run `npm run build`, `npm test`, `npm run e2e`, inspect screenshot, update `PROGRESS.md`, commit M4.
