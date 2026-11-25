# Project Progress (PROGRESS.md)

## Environment
- **OS**: Windows
- **Node.js**: `v22.23.5` (`C:\Users\Administrator\AppData\Local\pi-node\current\node.exe`)
- **npm**: `10.9.9`
- **GPU**: Intel(R) Iris(R) Xe Graphics
- **Browser E2E**: Chromium (system Chrome via Playwright with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`)
- **Repository**: Git on branch `main`

## Current Milestone
- **Active**: **M6 — Mobs, A* Pathfinding, Combat, & Spawning**
- **Status**: Starting M6 (M0–M5 completed, verified, and committed)

## Milestone Status (M0 – M8)

| Milestone | Status | Evidence |
|---|---|---|
| **M0 Architecture** | **DONE** | `npm run build`, `npm test` (5/5), `npm run e2e` (1/1), `docs/screenshots/M0-smoke.png`, commit `4b6779b` |
| **M1 Rendering World** | **DONE** | `npm run build`, `npm test` (10/10), `npm run e2e` (2/2), `docs/screenshots/M1-world.png`, commit `f247a32` |
| **M2 Player & Interaction** | **DONE** | `npm run build`, `npm test` (16/16), `npm run e2e` (3/3), `docs/screenshots/M2-interaction.png`, commit `f728065` |
| **M3 Lighting & Sky** | **DONE** | `npm run build`, `npm test` (20/20), `npm run e2e` (4/4), `docs/screenshots/M3-{noon,dusk,midnight,cave-torch}.png`, commit `394b2b3` |
| **M4 Item System** | **DONE** | `npm run build`, `npm test` (24/24), `npm run e2e` (5/5), `docs/screenshots/M4-crafting.png`, commit `0895f33` |
| **M5 Survival & Villages** | **DONE** | `npm run build` (2.04s), `npm test` (27/27 incl. `village_survival.test.ts`), `npm run e2e` (6/6 incl. `m5-survival-village.spec.ts`: fall/drown/starve death+respawn, accelerated crop growth & harvest, village chest loot), `docs/screenshots/M5-village.png` |
| **M6 Mobs** | **In Progress** | — |
| **M7 UI & Saves** | Pending | — |
| **M8 Polish** | Pending | — |

## Completed Subtasks
- **[M0–M4]** Architecture, worker terrain/mesher/atlas, physics/raycast, lighting/sky/water, inventory/crafting/containers (`4b6779b`..`0895f33`).
- **[M5.1]** Implemented `src/systems/SurvivalSystem.ts` (fall damage, hunger/saturation/regen/starvation, drowning, armor reduction, food eating, bed spawn/sleep, death drops & respawn).
- **[M5.2]** Implemented `src/systems/FarmingSystem.ts` (hoe tilling, farmland hydration near water, crop growth stages 0–3, bonemeal).
- **[M5.3]** Implemented deterministic cross-chunk `src/world/VillageGenerator.ts` (Plains/Desert/Snow palettes, central well, terrain-adapted road, 4–8 terrain-seated houses with doors/windows/torches/beds/workbenches/furnaces/chests, 1–2 irrigated farms, lazy first-open chest loot).
- **[M5.4]** Verified M5 via `tests/unit/village_survival.test.ts` (3/3) and `tests/e2e/m5-survival-village.spec.ts` (pass, visually inspected `docs/screenshots/M5-village.png`).

## Blockers
- None.

## Next Step (M6 — Mobs, A* Pathfinding, Combat, & Spawning)
1. Implement `src/entities/Pathfinding.ts`:
   - Pure bounded 3D voxel grid A* pathfinder (`findPath(world, start, goal, opts)`), respecting `maxNodes` (`BALANCE.mobs.pathfindMaxNodes = 160`), 1-block step-up, safe drop-down (<= 3 blocks), wall-climb support for `Gloom Spider`, and obstacle avoidance!
2. Implement `src/entities/Mob.ts` and `src/entities/MobSpawner.ts`:
   - 3 original passive mobs: **Meadow Boar** (`boar`), **Woolhorn Ram** (`ram`), **Crested Fowl** (`fowl`) — wander, flee when hit, drop raw meat / leather / wool / feathers.
   - 3 original hostile mobs (100% original color palette & silhouettes):
     - **Ash Husk** (`husk`): melee chaser using A*, burns in direct daytime sky light (`skyLight >= 13 && daytime`), drops Rotten Flesh.
     - **Hollow Archer** (`bone_archer`): standoff ranged combat (~10 blocks), fires visible parabolic `ArrowEntity` projectiles at player, burns in direct daytime sky light, drops Bone & Arrows.
     - **Gloom Spider** (`gloom_spider`): climbs vertical walls toward player, neutral during bright daylight unless provoked, hostile at night or in dark caves, drops Silk Thread.
   - Combat mechanics: player melee attack (`Left Click` / `window.__game.attack()`), sword/tool attack damage, bow arrow hits on mobs AND skeleton arrows hitting player (with armor mitigation!), knockback impulse, hit invincibility frames (`i-frames`), red damage flash on mob mesh!
   - Spawning & despawning (`MobSpawner.ts`):
     - Pure testable `canHostileSpawnAt(world, x, y, z, isDaytime)` rule: **NEVER spawns if effective light >= threshold (`hostileMaxLight = 7`)** (uses `max(blockLight, effectiveSkyLight)` where `effectiveSkyLight` is `skyLight` during daytime and `0` at night so torches inside a 5×5 hut ALWAYS block hostile spawns even at midnight!).
     - Also verifies solid floor + 2 air clearance + minimum safe distance (`minSpawnDist`) from player (or inside closed roofed rooms, torches keep every floor block >= 8 light -> 0 interior spawns!).
     - Passive mobs spawn in daylight on Grass/SnowGrass; hostile mobs spawn in dark caves or outdoors at night; far mobs beyond `despawnDist (64)` despawn cleanly.
3. Implement `src/entities/MobRenderer.ts`:
   - Procedural articulated original voxel Three.js models for all 6 mobs (walk limb animation, hurt flash tint, burning flame cubes when sun-burning!).
4. Integrate Mobs, MobSpawner, MobRenderer, melee & arrow combat into `src/engine/Game.ts`.
5. Add `tests/unit/mobs.test.ts` (light >= threshold NEVER allows hostile spawn; A* navigates around solid U-wall obstacle; A* respects `maxNodes` search budget cap; combat knockback/i-frames/drops) and `tests/e2e/m6-mobs.spec.ts` (open field midnight 2 min -> hostile mobs appear nearby; enclosed 5×5 lit hut with torch survives full night with player alive & 0 mobs inside hut; kill mob & verify drops collected!).
6. Run `npm run build`, `npm test`, `npm run e2e`, capture & inspect `docs/screenshots/M6-mobs.png`, update `PROGRESS.md`, commit M6.
