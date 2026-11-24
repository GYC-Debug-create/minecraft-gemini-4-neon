import { ItemStack } from '../core/types';
import { ItemId } from '../registry/items';
import {
  CRAFTING_RECIPES,
  CraftingRecipe,
  findRecipeById,
  IngredientMatcher,
  matchesIngredient,
  ShapedRecipe,
  ShapelessRecipe,
} from '../registry/recipes';
import { createItemStack, Inventory } from '../player/Inventory';

export interface CraftMatchResult {
  recipe: CraftingRecipe;
  output: ItemStack;
}

/**
 * Trims empty outer rows and columns from a gridSize x gridSize crafting grid.
 */
function trimGrid(
  grid: ReadonlyArray<ItemStack | null>,
  gridSize: number
): { width: number; height: number; cells: Array<ItemId | null> } {
  let minR = gridSize;
  let maxR = -1;
  let minC = gridSize;
  let maxC = -1;

  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      const s = grid[r * gridSize + c];
      if (s && s.count > 0) {
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
    }
  }

  if (maxR < minR) {
    return { width: 0, height: 0, cells: [] };
  }

  const height = maxR - minR + 1;
  const width = maxC - minC + 1;
  const cells: Array<ItemId | null> = new Array(width * height).fill(null);

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const s = grid[(minR + r) * gridSize + (minC + c)];
      cells[r * width + c] = s && s.count > 0 ? s.itemId : null;
    }
  }

  return { width, height, cells };
}

function matchShaped(
  recipe: ShapedRecipe,
  trimmed: { width: number; height: number; cells: Array<ItemId | null> }
): boolean {
  const patHeight = recipe.pattern.length;
  const patWidth = Math.max(...recipe.pattern.map((row) => row.length));
  if (trimmed.height !== patHeight || trimmed.width !== patWidth) return false;

  // Test both normal and horizontally mirrored pattern (genre-standard convenience for axes/hoes/bows!)
  for (const mirrored of [false, true]) {
    let ok = true;
    for (let r = 0; r < patHeight && ok; r++) {
      const row = recipe.pattern[r];
      for (let c = 0; c < patWidth; c++) {
        const patCol = mirrored ? patWidth - 1 - c : c;
        const ch = patCol < row.length ? row[patCol] : ' ';
        const matcher: IngredientMatcher | null = ch === ' ' ? null : recipe.key[ch] ?? null;
        const item = trimmed.cells[r * patWidth + c];
        if (!matchesIngredient(item, matcher)) {
          ok = false;
          break;
        }
      }
    }
    if (ok) return true;
  }
  return false;
}

function matchShapeless(
  recipe: ShapelessRecipe,
  grid: ReadonlyArray<ItemStack | null>
): boolean {
  const present: ItemId[] = [];
  for (const s of grid) {
    if (s && s.count > 0) present.push(s.itemId);
  }
  if (present.length !== recipe.ingredients.length) return false;

  // Backtracking match (supports tag + exact item matchers cleanly; max 9 slots so instantaneous)
  const used = new Uint8Array(present.length);
  const assign = (idx: number): boolean => {
    if (idx === recipe.ingredients.length) return true;
    const matcher = recipe.ingredients[idx];
    for (let i = 0; i < present.length; i++) {
      if (used[i]) continue;
      if (matchesIngredient(present[i], matcher)) {
        used[i] = 1;
        if (assign(idx + 1)) return true;
        used[i] = 0;
      }
    }
    return false;
  };
  return assign(0);
}

/**
 * Matches a 2x2 (gridSize=2) or 3x3 (gridSize=3) crafting grid against all recipes.
 */
export function matchCraftingGrid(
  grid: ReadonlyArray<ItemStack | null>,
  gridSize: 2 | 3
): CraftMatchResult | null {
  const trimmed = trimGrid(grid, gridSize);
  if (trimmed.cells.length === 0) return null;

  for (const recipe of CRAFTING_RECIPES) {
    if (gridSize === 2 && recipe.requiresWorkbench) continue;
    const matched =
      recipe.kind === 'shaped'
        ? matchShaped(recipe, trimmed)
        : matchShapeless(recipe, grid);
    if (matched) {
      return {
        recipe,
        output: createItemStack(recipe.output.itemId, recipe.output.count),
      };
    }
  }
  return null;
}

/**
 * Consumes 1 unit from each non-empty slot in `grid` after crafting.
 */
export function consumeCraftingGrid(grid: Array<ItemStack | null>): void {
  for (let i = 0; i < grid.length; i++) {
    const s = grid[i];
    if (!s) continue;
    s.count--;
    if (s.count <= 0) grid[i] = null;
  }
}

/** Extracts required ingredient matchers from any crafting recipe */
export function getRecipeRequirements(recipe: CraftingRecipe): IngredientMatcher[] {
  if (recipe.kind === 'shapeless') return [...recipe.ingredients];
  const reqs: IngredientMatcher[] = [];
  for (const row of recipe.pattern) {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch !== ' ' && recipe.key[ch]) {
        reqs.push(recipe.key[ch]);
      }
    }
  }
  return reqs;
}

export function canCraftRecipeFromInventory(
  inv: Inventory,
  recipe: CraftingRecipe,
  hasWorkbench: boolean
): boolean {
  if (recipe.requiresWorkbench && !hasWorkbench) return false;
  const reqs = getRecipeRequirements(recipe);

  // Clone counts by slot to simulate consumption cleanly
  const simCounts = inv.slots.map((s) => (s ? s.count : 0));
  for (const matcher of reqs) {
    let found = false;
    for (let i = 0; i < inv.slots.length; i++) {
      const s = inv.slots[i];
      if (!s || simCounts[i] <= 0) continue;
      if (matchesIngredient(s.itemId, matcher)) {
        simCounts[i]--;
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

/**
 * Crafts `recipeId` using ONLY legitimate items currently inside `inv` (respecting 2x2 vs 3x3 workbench gate).
 * Places crafted output into inventory (fails cleanly without consuming ingredients if inventory is completely full).
 */
export function craftRecipeFromInventory(
  inv: Inventory,
  recipeId: string,
  hasWorkbench: boolean
): boolean {
  const recipe = findRecipeById(recipeId);
  if (!recipe) return false;
  if (!canCraftRecipeFromInventory(inv, recipe, hasWorkbench)) return false;

  const reqs = getRecipeRequirements(recipe);

  // Build rollback snapshot in case output doesn't fit
  const backup = inv.toSnapshot();
  for (const matcher of reqs) {
    const ok = inv.consumeWhere((id) => matchesIngredient(id, matcher), 1);
    if (!ok) {
      inv.loadFromSnapshot(backup);
      return false;
    }
  }

  const leftover = inv.addStack(createItemStack(recipe.output.itemId, recipe.output.count));
  if (leftover > 0) {
    inv.loadFromSnapshot(backup);
    return false;
  }

  return true;
}

export function getCraftableRecipes(inv: Inventory, hasWorkbench: boolean): CraftingRecipe[] {
  return CRAFTING_RECIPES.filter((r) => canCraftRecipeFromInventory(inv, r, hasWorkbench));
}
