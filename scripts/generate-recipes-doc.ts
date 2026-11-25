import fs from 'node:fs';
import path from 'node:path';
import { getDisplayName, setLanguage } from '../src/core/i18n';
import type { Language } from '../src/core/types';
import { ItemRegistry } from '../src/registry/items';
import { CRAFTING_RECIPES, IngredientMatcher, SMELTING_RECIPES } from '../src/registry/recipes';

function itemLabel(itemId: number, lang: Language): string {
  const def = ItemRegistry.get(itemId);
  if (!def) return `Item#${itemId}`;
  return lang === 'zh' ? getDisplayName(def.key, def.name) : def.name;
}

function formatMatcher(m: IngredientMatcher, lang: Language): string {
  if (m.kind === 'tag') {
    if (lang === 'zh') {
      return m.tag === 'planks' ? '任意木板' : '任意原木';
    }
    return m.tag === 'planks' ? 'Any Planks' : 'Any Log';
  }
  return itemLabel(m.itemId, lang);
}

export function generateRecipesMarkdown(lang: Language = 'en'): string {
  setLanguage(lang);
  const lines: string[] = [];

  if (lang === 'zh') {
    lines.push('### 合成配方');
    lines.push('');
    lines.push('| 产出物品 | 合成站 | 摆放方式 / 所需材料 |');
    lines.push('|---|---|---|');
  } else {
    lines.push('### Crafting Recipes');
    lines.push('');
    lines.push('| Output | Station | Pattern / Ingredients |');
    lines.push('|---|---|---|');
  }

  for (const recipe of CRAFTING_RECIPES) {
    const outName = itemLabel(recipe.output.itemId, lang);
    const outLabel = recipe.output.count > 1 ? `${outName} ×${recipe.output.count}` : outName;
    const station =
      lang === 'zh'
        ? recipe.requiresWorkbench
          ? '工艺台 (3×3)'
          : '徒手 (2×2)'
        : recipe.requiresWorkbench
          ? 'Crafting Bench (3×3)'
          : 'Hand (2×2)';

    if (recipe.kind === 'shapeless') {
      const ing = recipe.ingredients.map((m) => formatMatcher(m, lang)).join(' + ');
      const prefix = lang === 'zh' ? '无序：' : 'Shapeless: ';
      lines.push(`| **${outLabel}** | ${station} | ${prefix}${ing} |`);
    } else {
      const legend = Object.entries(recipe.key)
        .map(([k, v]) => `\`${k}\`=${formatMatcher(v, lang)}`)
        .join('，'.slice(0, lang === 'zh' ? 1 : 0) || ', ');
      const pat = recipe.pattern.map((row) => `\`${row.replace(/ /g, '·')}\``).join(' / ');
      lines.push(`| **${outLabel}** | ${station} | ${pat} (${legend}) |`);
    }
  }

  lines.push('');
  if (lang === 'zh') {
    lines.push('### 熔炉冶炼与烹饪（石窑熔炉）');
    lines.push('');
    lines.push('| 原料 | 产出 |');
    lines.push('|---|---|');
  } else {
    lines.push('### Smelting & Cooking (Stone Kiln)');
    lines.push('');
    lines.push('| Input | Output |');
    lines.push('|---|---|');
  }

  for (const s of SMELTING_RECIPES) {
    const inName = itemLabel(s.input, lang);
    const outName = itemLabel(s.output, lang);
    lines.push(`| ${inName} | **${outName}** ×${s.outputCount} |`);
  }
  return lines.join('\n');
}

function syncFile(filePath: string, lang: Language): void {
  const startMarker = '<!-- RECIPES:START -->';
  const endMarker = '<!-- RECIPES:END -->';
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf-8');
  if (!content.includes(startMarker) || !content.includes(endMarker)) return;
  const md = generateRecipesMarkdown(lang);
  const updated = content.replace(
    new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`),
    `${startMarker}\n${md}\n${endMarker}`
  );
  fs.writeFileSync(filePath, updated, 'utf-8');
  console.log(`Updated crafting recipes in ${path.basename(filePath)} (${lang})`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]).endsWith('generate-recipes-doc.ts');
if (isDirectRun) {
  syncFile(path.resolve('README.md'), 'zh');
  syncFile(path.resolve('README.en.md'), 'en');
}
