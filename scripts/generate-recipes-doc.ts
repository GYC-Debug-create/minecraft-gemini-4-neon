import fs from 'node:fs';
import path from 'node:path';
import { ItemRegistry } from '../src/registry/items';
import { CRAFTING_RECIPES, IngredientMatcher, SMELTING_RECIPES } from '../src/registry/recipes';

function formatMatcher(m: IngredientMatcher): string {
  if (m.kind === 'tag') {
    return m.tag === 'planks' ? 'Any Planks' : 'Any Log';
  }
  return ItemRegistry.get(m.itemId)?.name ?? `Item#${m.itemId}`;
}

export function generateRecipesMarkdown(): string {
  const lines: string[] = [];
  lines.push('### Crafting Recipes');
  lines.push('');
  lines.push('| Output | Station | Pattern / Ingredients |');
  lines.push('|---|---|---|');

  for (const recipe of CRAFTING_RECIPES) {
    const outName = ItemRegistry.get(recipe.output.itemId)?.name ?? `Item#${recipe.output.itemId}`;
    const outLabel = recipe.output.count > 1 ? `${outName} ×${recipe.output.count}` : outName;
    const station = recipe.requiresWorkbench ? 'Crafting Bench (3×3)' : 'Hand (2×2)';

    if (recipe.kind === 'shapeless') {
      const ing = recipe.ingredients.map(formatMatcher).join(' + ');
      lines.push(`| **${outLabel}** | ${station} | Shapeless: ${ing} |`);
    } else {
      const legend = Object.entries(recipe.key)
        .map(([k, v]) => `\`${k}\`=${formatMatcher(v)}`)
        .join(', ');
      const pat = recipe.pattern.map((row) => `\`${row.replace(/ /g, '·')}\``).join(' / ');
      lines.push(`| **${outLabel}** | ${station} | ${pat} (${legend}) |`);
    }
  }

  lines.push('');
  lines.push('### Smelting & Cooking (Stone Kiln)');
  lines.push('');
  lines.push('| Input | Output |');
  lines.push('|---|---|');
  for (const s of SMELTING_RECIPES) {
    const inName = ItemRegistry.get(s.input)?.name ?? `Item#${s.input}`;
    const outName = ItemRegistry.get(s.output)?.name ?? `Item#${s.output}`;
    lines.push(`| ${inName} | **${outName}** ×${s.outputCount} |`);
  }
  return lines.join('\n');
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]).endsWith('generate-recipes-doc.ts');
if (isDirectRun) {
  const md = generateRecipesMarkdown();
  const readmePath = path.resolve('README.md');
  const startMarker = '<!-- RECIPES:START -->';
  const endMarker = '<!-- RECIPES:END -->';
  if (fs.existsSync(readmePath)) {
    const content = fs.readFileSync(readmePath, 'utf-8');
    if (content.includes(startMarker) && content.includes(endMarker)) {
      const updated = content.replace(
        new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`),
        `${startMarker}\n${md}\n${endMarker}`
      );
      fs.writeFileSync(readmePath, updated, 'utf-8');
      console.log('Updated crafting recipes in README.md');
    } else {
      console.log(md);
    }
  } else {
    console.log(md);
  }
}
