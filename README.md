# Stoneroot

An original browser-based first-person voxel survival sandbox game built with TypeScript, Vite, Three.js, Web Workers, and IndexedDB.

## Quick Start

> **Note:** Requires Node.js LTS `>= 18` (verified on `v22.23.5`).

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173` in a WebGL-capable browser.

## Build & Test Commands

| Command | Description |
|---|---|
| `npm run dev` | Start Vite development server |
| `npm run build` | Type-check (`tsc --noEmit`) and build production bundle |
| `npm test` | Run Vitest unit tests |
| `npm run e2e` | Run Playwright E2E tests (headless Chromium with SwiftShader WebGL) |
| `npm run docs:recipes` | Regenerate the crafting & smelting recipe tables below from `src/registry/recipes.ts` |

## Controls

| Input | Action |
|---|---|
| `W` `A` `S` `D` | Move |
| `Space` | Jump / Swim Up |
| `Shift` | Sneak (prevents falling off ledges) |
| `Ctrl` or Double-Tap `W` | Sprint |
| `Left Click` | Mine Block / Attack |
| `Right Click` | Place Block / Interact / Eat / Draw Bow |
| `1` – `9` or Scroll Wheel | Select Hotbar Slot |
| `E` | Open / Close Inventory |
| `Q` | Drop Held Item |
| `Esc` | Pause / Close Menu |
| `F3` | Toggle Debug Overlay |

## Gameplay Loop

1. **Gather Timber**: Punch Oak, Silverwood, or Frostpine trees to gather logs.
2. **Craft Basics**: Open Inventory (`E`) to convert logs to planks, sticks, and a Crafting Bench (3×3).
3. **Mine & Upgrade**: Craft an Oak Pickaxe → mine Stone → craft Stone tools & a Stone Kiln (Furnace) → mine Coal and Iron Veins → smelt Iron Ingots → craft Iron tools and armor → mine deep Prismite Crystal Veins.
4. **Survive the Night**: Build a lit shelter with Pitch Torches or find a biome village; beware Ash Husks, Hollow Archers, and Gloom Spiders in dark areas.
5. **Farm & Sustain**: Till dirt near water with a Hoe, plant Grain Seeds from wild grass, harvest Golden Grain, bake Hearth Bread, or hunt Meadow Boars, Woolhorn Rams, and Crested Fowl.

## Crafting & Smelting Reference

<!-- RECIPES:START -->
### Crafting Recipes

| Output | Station | Pattern / Ingredients |
|---|---|---|
| **Oak Planks ×4** | Hand (2×2) | Shapeless: Oak Timber |
| **Silverwood Planks ×4** | Hand (2×2) | Shapeless: Silverwood Log |
| **Frostpine Planks ×4** | Hand (2×2) | Shapeless: Frostpine Log |
| **Timber Stick ×4** | Hand (2×2) | `P` / `P` (`P`=Any Planks) |
| **Crafting Bench** | Hand (2×2) | `PP` / `PP` (`P`=Any Planks) |
| **Pitch Torch ×4** | Hand (2×2) | `C` / `S` (`C`=Coal Chunk, `S`=Timber Stick) |
| **Bone Dust ×3** | Hand (2×2) | Shapeless: Hollow Bone |
| **Stone Kiln** | Crafting Bench (3×3) | `CCC` / `C·C` / `CCC` (`C`=Cobblestone) |
| **Timber Chest** | Crafting Bench (3×3) | `PPP` / `P·P` / `PPP` (`P`=Any Planks) |
| **Camp Bed** | Crafting Bench (3×3) | `WWW` / `PPP` (`W`=Ram Fleece, `P`=Any Planks) |
| **Timber Door ×3** | Crafting Bench (3×3) | `PP` / `PP` / `PP` (`P`=Any Planks) |
| **Wood Ladder ×3** | Crafting Bench (3×3) | `S·S` / `SSS` / `S·S` (`S`=Timber Stick) |
| **Stone Slab ×6** | Crafting Bench (3×3) | `SSS` (`S`=Stone) |
| **Stone Slab ×6** | Crafting Bench (3×3) | `CCC` (`C`=Cobblestone) |
| **Sandstone ×2** | Hand (2×2) | `SS` / `SS` (`S`=Dune Sand) |
| **Frost Brick ×4** | Hand (2×2) | `SS` / `SS` (`S`=Packed Snow) |
| **Hearth Bread** | Crafting Bench (3×3) | `WWW` (`W`=Golden Grain) |
| **Oak Pickaxe** | Crafting Bench (3×3) | `MMM` / `·S·` / `·S·` (`M`=Any Planks, `S`=Timber Stick) |
| **Oak Hatchet** | Crafting Bench (3×3) | `MM` / `MS` / `·S` (`M`=Any Planks, `S`=Timber Stick) |
| **Oak Spade** | Crafting Bench (3×3) | `M` / `S` / `S` (`M`=Any Planks, `S`=Timber Stick) |
| **Oak Blade** | Crafting Bench (3×3) | `M` / `M` / `S` (`M`=Any Planks, `S`=Timber Stick) |
| **Oak Hoe** | Crafting Bench (3×3) | `MM` / `·S` / `·S` (`M`=Any Planks, `S`=Timber Stick) |
| **Stone Pickaxe** | Crafting Bench (3×3) | `MMM` / `·S·` / `·S·` (`M`=Cobblestone, `S`=Timber Stick) |
| **Stone Hatchet** | Crafting Bench (3×3) | `MM` / `MS` / `·S` (`M`=Cobblestone, `S`=Timber Stick) |
| **Stone Spade** | Crafting Bench (3×3) | `M` / `S` / `S` (`M`=Cobblestone, `S`=Timber Stick) |
| **Stone Blade** | Crafting Bench (3×3) | `M` / `M` / `S` (`M`=Cobblestone, `S`=Timber Stick) |
| **Stone Hoe** | Crafting Bench (3×3) | `MM` / `·S` / `·S` (`M`=Cobblestone, `S`=Timber Stick) |
| **Iron Pickaxe** | Crafting Bench (3×3) | `MMM` / `·S·` / `·S·` (`M`=Iron Ingot, `S`=Timber Stick) |
| **Iron Hatchet** | Crafting Bench (3×3) | `MM` / `MS` / `·S` (`M`=Iron Ingot, `S`=Timber Stick) |
| **Iron Spade** | Crafting Bench (3×3) | `M` / `S` / `S` (`M`=Iron Ingot, `S`=Timber Stick) |
| **Iron Broadsword** | Crafting Bench (3×3) | `M` / `M` / `S` (`M`=Iron Ingot, `S`=Timber Stick) |
| **Iron Hoe** | Crafting Bench (3×3) | `MM` / `·S` / `·S` (`M`=Iron Ingot, `S`=Timber Stick) |
| **Prismite Pickaxe** | Crafting Bench (3×3) | `MMM` / `·S·` / `·S·` (`M`=Prismite Crystal, `S`=Timber Stick) |
| **Prismite Hatchet** | Crafting Bench (3×3) | `MM` / `MS` / `·S` (`M`=Prismite Crystal, `S`=Timber Stick) |
| **Prismite Spade** | Crafting Bench (3×3) | `M` / `S` / `S` (`M`=Prismite Crystal, `S`=Timber Stick) |
| **Prismite Edge** | Crafting Bench (3×3) | `M` / `M` / `S` (`M`=Prismite Crystal, `S`=Timber Stick) |
| **Prismite Hoe** | Crafting Bench (3×3) | `MM` / `·S` / `·S` (`M`=Prismite Crystal, `S`=Timber Stick) |
| **Recurve Bow** | Crafting Bench (3×3) | `·ST` / `S·T` / `·ST` (`S`=Timber Stick, `T`=Cavern Silk) |
| **Fletched Arrow ×4** | Crafting Bench (3×3) | `C` / `S` / `F` (`C`=Cobblestone, `S`=Timber Stick, `F`=Crested Feather) |
| **Fletched Arrow ×4** | Crafting Bench (3×3) | `B` / `S` / `F` (`B`=Hollow Bone, `S`=Timber Stick, `F`=Crested Feather) |
| **Hide Cap** | Crafting Bench (3×3) | `MMM` / `M·M` (`M`=Tanned Hide) |
| **Hide Tunic** | Crafting Bench (3×3) | `M·M` / `MMM` / `MMM` (`M`=Tanned Hide) |
| **Hide Trousers** | Crafting Bench (3×3) | `MMM` / `M·M` / `M·M` (`M`=Tanned Hide) |
| **Hide Boots** | Crafting Bench (3×3) | `M·M` / `M·M` (`M`=Tanned Hide) |
| **Iron Helm** | Crafting Bench (3×3) | `MMM` / `M·M` (`M`=Iron Ingot) |
| **Iron Cuirass** | Crafting Bench (3×3) | `M·M` / `MMM` / `MMM` (`M`=Iron Ingot) |
| **Iron Greaves** | Crafting Bench (3×3) | `MMM` / `M·M` / `M·M` (`M`=Iron Ingot) |
| **Iron Sabatons** | Crafting Bench (3×3) | `M·M` / `M·M` (`M`=Iron Ingot) |

### Smelting & Cooking (Stone Kiln)

| Input | Output |
|---|---|
| Raw Iron Ore | **Iron Ingot** ×1 |
| Raw Gold Ore | **Gold Ingot** ×1 |
| Dune Sand | **Clear Glass** ×1 |
| Cobblestone | **Stone** ×1 |
| Raw Boar Cut | **Roasted Boar** ×1 |
| Raw Ram Cut | **Seared Mutton** ×1 |
| Raw Fowl | **Roast Fowl** ×1 |
| Oak Timber | **Coal Chunk** ×1 |
| Silverwood Log | **Coal Chunk** ×1 |
| Frostpine Log | **Coal Chunk** ×1 |
<!-- RECIPES:END -->
