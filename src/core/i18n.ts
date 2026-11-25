import { BiomeId, Language } from './types';

let currentLang: Language = 'zh';

export function getLanguage(): Language {
  return currentLang;
}

export function setLanguage(lang: Language): void {
  currentLang = lang;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title = lang === 'zh' ? '石根 STONEROOT — 体素生存沙盒' : 'Stoneroot — Voxel Survival Sandbox';
  }
}

const UI_STRINGS = {
  zh: {
    gameTitle: '石根 STONEROOT',
    gameSubtitle: '原创第一人称体素生存沙盒',
    continueWorld: '继续世界',
    noSavedWorld: '暂无已保存的世界',
    savedMeta: (seed: number, day: number) => `已存种子：${seed} · 第 ${day} 天`,
    seedPlaceholder: '世界种子（可选，留空随机，如 1337）',
    createNewWorld: '创建新世界',
    settings: '设置',
    langSwitchBtn: '🌐 English',
    gamePaused: '游戏暂停',
    resumeGame: '继续游戏',
    saveWorld: '保存世界',
    saveAndMainMenu: '保存并返回主菜单',
    languageLabel: '界面语言',
    renderDistance: '视距',
    chunksUnit: (v: number) => `${v} 区块`,
    fov: '视野 (FOV)',
    mouseSensitivity: '鼠标灵敏度',
    masterVolume: '主音量',
    done: '完成',
    youPerished: '你已阵亡',
    causePrefix: (cause: string) => `死因：${cause}`,
    respawnAtCamp: '在营地重生',
    mainMenu: '返回主菜单',
    screenInventory: '随身背包与徒手合成 (2×2)',
    screenWorkbench: '工艺台 (3×3)',
    screenFurnace: '石窑熔炉',
    screenChest: '木质储物箱',
    closeEsc: '关闭 [Esc]',
    armorLabel: (def: number) => `护甲 (${def})`,
    quickCraft: '快捷合成',
    quickCraftEmpty: '采集木材、石头或矿石以解锁配方。',
    craftTooltip: (name: string, count: number) => `合成 ${name} ×${count}`,
    backpack: '背包',
    hotbarLabel: '快捷栏 (1–9)',
    furnaceInput: '原料',
    furnaceFuel: '燃料',
    furnaceOutput: '产出',
    worldSaved: '世界已保存',
    legacyUpgraded: '旧版存档已自动升级为最新格式。',
    saveLoadFailed: (reason: string) => `存档加载失败（${reason}），已为你开启新世界。`,
    bedUsedNight: '已设置重生点，一觉睡到黎明！',
    bedUsedDay: '已将此处设为新的重生点。',
    none: '无',
    armorSlotShort: {
      helmet: '头',
      chestplate: '胸',
      leggings: '腿',
      boots: '脚',
    },
    facing: {
      north: '北 (-Z)',
      west: '西 (-X)',
      south: '南 (+Z)',
      east: '东 (+X)',
    },
  },
  en: {
    gameTitle: 'STONEROOT',
    gameSubtitle: 'Voxel Survival Sandbox',
    continueWorld: 'Continue World',
    noSavedWorld: 'No saved world yet',
    savedMeta: (seed: number, day: number) => `Saved Seed: ${seed} · Day ${day}`,
    seedPlaceholder: 'World Seed (optional, e.g. 1337)',
    createNewWorld: 'Create New World',
    settings: 'Settings',
    langSwitchBtn: '🌐 中文',
    gamePaused: 'Game Paused',
    resumeGame: 'Resume Game',
    saveWorld: 'Save World',
    saveAndMainMenu: 'Save & Main Menu',
    languageLabel: 'Language',
    renderDistance: 'Render Distance',
    chunksUnit: (v: number) => `${v} chunks`,
    fov: 'Field of View (FOV)',
    mouseSensitivity: 'Mouse Sensitivity',
    masterVolume: 'Master Volume',
    done: 'Done',
    youPerished: 'You Perished',
    causePrefix: (cause: string) => `Cause: ${cause}`,
    respawnAtCamp: 'Respawn at Camp',
    mainMenu: 'Main Menu',
    screenInventory: 'Satchel & Hand Crafting (2×2)',
    screenWorkbench: 'Crafting Bench (3×3)',
    screenFurnace: 'Stone Kiln',
    screenChest: 'Timber Chest',
    closeEsc: 'Close [Esc]',
    armorLabel: (def: number) => `Armor (${def})`,
    quickCraft: 'Quick Craft',
    quickCraftEmpty: 'Gather wood, stone, or ore to unlock recipes.',
    craftTooltip: (name: string, count: number) => `Craft ${name} ×${count}`,
    backpack: 'Backpack',
    hotbarLabel: 'Hotbar (1–9)',
    furnaceInput: 'Ore',
    furnaceFuel: 'Fuel',
    furnaceOutput: 'Out',
    worldSaved: 'World saved',
    legacyUpgraded: 'Legacy world save upgraded to latest format.',
    saveLoadFailed: (reason: string) => `Save could not be loaded (${reason}). Starting a fresh world.`,
    bedUsedNight: 'Spawn point set — rested until dawn!',
    bedUsedDay: 'Spawn point set at camp bed.',
    none: 'None',
    armorSlotShort: {
      helmet: 'H',
      chestplate: 'C',
      leggings: 'L',
      boots: 'B',
    },
    facing: {
      north: 'North (-Z)',
      west: 'West (-X)',
      south: 'South (+Z)',
      east: 'East (+X)',
    },
  },
} as const;

export function uiText() {
  return UI_STRINGS[currentLang];
}

const BIOME_ZH: Record<BiomeId, string> = {
  [BiomeId.Plains]: '草甸平原',
  [BiomeId.Forest]: '翠木森林',
  [BiomeId.Desert]: '烈日沙漠',
  [BiomeId.Snow]: '冰霜苔原',
  [BiomeId.Ocean]: '碧蓝海洋',
  [BiomeId.Mountains]: '高地峰峦',
};

const BIOME_EN: Record<BiomeId, string> = {
  [BiomeId.Plains]: 'Meadow Plains',
  [BiomeId.Forest]: 'Timber Forest',
  [BiomeId.Desert]: 'Sunscorch Desert',
  [BiomeId.Snow]: 'Frost Tundra',
  [BiomeId.Ocean]: 'Azure Sea',
  [BiomeId.Mountains]: 'Highland Crags',
};

export function getBiomeDisplayName(biome: BiomeId): string {
  return currentLang === 'zh' ? BIOME_ZH[biome] : BIOME_EN[biome];
}

const DEATH_CAUSE_ZH: Record<string, string> = {
  fall: '从高处摔落',
  drown: '在水中溺亡',
  starve: '极度饥饿',
  husk: '被灰烬行尸击败',
  bone_archer: '被骸骨弓手射杀',
  gloom_spider: '被幽影巨蛛咬伤',
};

const DEATH_CAUSE_EN: Record<string, string> = {
  fall: 'Fell from a high place',
  drown: 'Drowned underwater',
  starve: 'Starved to death',
  husk: 'Slain by an Ash Husk',
  bone_archer: 'Shot by a Hollow Archer',
  gloom_spider: 'Slain by a Gloom Spider',
};

export function getDeathCauseDisplayName(cause: string): string {
  const map = currentLang === 'zh' ? DEATH_CAUSE_ZH : DEATH_CAUSE_EN;
  return map[cause] ?? cause;
}

const NAME_ZH_BY_KEY: Record<string, string> = {
  // Blocks
  air: '空气',
  stone: '石头',
  cobblestone: '圆石',
  dirt: '泥土',
  grass: '草甸草皮',
  sand: '沙丘细沙',
  sandstone: '砂岩',
  smooth_sandstone: '雕纹砂岩',
  gravel: '砂砾',
  snow_block: '积雪块',
  snow_grass: '霜雪草皮',
  ice: '冰川冰',
  bedrock: '深层基岩',
  coal_ore: '煤矿脉',
  iron_ore: '铁矿脉',
  gold_ore: '金矿脉',
  prismite_ore: '棱晶宝石矿脉',
  oak_log: '橡木原木',
  birch_log: '银桦原木',
  pine_log: '霜松原木',
  oak_leaves: '橡树枝叶',
  birch_leaves: '银桦枝叶',
  pine_leaves: '霜松针叶',
  oak_planks: '橡木木板',
  birch_planks: '银桦木板',
  pine_planks: '霜松木板',
  glass: '透明玻璃',
  water: '水',
  tall_grass: '野草',
  wildflower_red: '赤焰野花',
  wildflower_yellow: '向阳黄花',
  dry_scrub: '荒漠枯灌',
  workbench: '工艺台',
  furnace: '石窑熔炉',
  chest: '木质储物箱',
  torch: '松脂火把',
  bed: '营地床',
  wood_door: '木门',
  wood_door_top: '木门',
  ladder: '木梯',
  farmland: '耕地',
  farmland_wet: '湿润耕地',
  crop_0: '谷物幼芽',
  crop_1: '生长期谷物',
  crop_2: '抽穗谷物',
  crop_3: '成熟金穗',
  stone_slab: '石台阶',
  dirt_path: '夯土小径',
  snow_brick: '霜雪砖',

  // Materials
  stick: '木棍',
  coal: '煤块',
  raw_iron: '粗铁矿',
  iron_ingot: '铁锭',
  raw_gold: '粗金矿',
  gold_ingot: '金锭',
  prismite_gem: '棱晶宝石',
  grain_seeds: '谷物种子',
  wheat: '黄金谷穗',
  leather: '鞣制皮革',
  wool: '绵羊毛毡',
  feather: '羽冠羽毛',
  bone: '空心兽骨',
  silk_thread: '洞穴蛛丝',
  bonemeal: '骨粉',
  arrow: '羽箭',

  // Foods
  apple: '果园苹果',
  bread: '炉烤面包',
  raw_pork: '生野猪肉',
  cooked_pork: '炙烤野猪肉',
  raw_mutton: '生羊肉',
  cooked_mutton: '香煎羊肉',
  raw_fowl: '生禽肉',
  cooked_fowl: '烤冠鸡',
  rotten_flesh: '灰烬肉干',

  // Tools
  wood_pickaxe: '橡木镐',
  wood_axe: '橡木斧',
  wood_shovel: '橡木锹',
  wood_sword: '橡木剑',
  wood_hoe: '橡木锄',
  stone_pickaxe: '石镐',
  stone_axe: '石斧',
  stone_shovel: '石锹',
  stone_sword: '石剑',
  stone_hoe: '石锄',
  iron_pickaxe: '铁镐',
  iron_axe: '铁斧',
  iron_shovel: '铁锹',
  iron_sword: '铁阔剑',
  iron_hoe: '铁锄',
  prismite_pickaxe: '棱晶镐',
  prismite_axe: '棱晶斧',
  prismite_shovel: '棱晶锹',
  prismite_sword: '棱晶利刃',
  prismite_hoe: '棱晶锄',
  bow: '反曲弓',

  // Armor
  leather_helmet: '皮帽',
  leather_chestplate: '皮甲上衣',
  leather_leggings: '皮护腿',
  leather_boots: '皮靴',
  iron_helmet: '铁盔',
  iron_chestplate: '铁胸甲',
  iron_leggings: '铁护腿',
  iron_boots: '铁战靴',
};

export function getDisplayName(key: string, fallbackEn: string): string {
  if (currentLang === 'zh') {
    return NAME_ZH_BY_KEY[key] ?? fallbackEn;
  }
  return fallbackEn;
}
