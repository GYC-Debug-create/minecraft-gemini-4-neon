/**
 * Centralized gameplay & simulation balance numbers for Stoneroot.
 * All tuning values live here per SPEC §0.
 */
export const BALANCE = {
  player: {
    width: 0.6,
    height: 1.8,
    eyeHeight: 1.62,
    sneakEyeHeight: 1.35,
    walkSpeed: 4.3,
    sprintSpeed: 5.8,
    sneakSpeed: 1.8,
    swimSpeed: 2.8,
    flySpeed: 14.0,
    jumpVelocity: 8.6,
    swimUpVelocity: 4.2,
    gravity: 26.0,
    waterGravity: 5.0,
    terminalVelocity: 60.0,
    stepHeight: 0.55,
    reachDistance: 5.0,
    maxHealth: 20,
    maxHunger: 20,
    maxSaturation: 20,
    maxOxygen: 20,
    invincibilityTicks: 10, // 0.5s
    fallDamageSafeHeight: 3.5,
    fallDamagePerBlock: 1.0,
    attackDamageHand: 1,
    attackCooldownTicks: 8,
  },

  survival: {
    // Hunger drain per action/tick
    hungerDrainIdlePerSec: 0.008,
    hungerDrainWalkPerMeter: 0.012,
    hungerDrainSprintPerMeter: 0.06,
    hungerDrainJump: 0.05,
    hungerDrainMine: 0.02,
    hungerRegenMinHunger: 18,
    hungerRegenIntervalTicks: 60, // 3s
    hungerSprintMinHunger: 6,
    starveIntervalTicks: 80, // 4s when hunger == 0
    starveDamage: 1,
    oxygenDrainPerSec: 2.0,
    oxygenRecoverPerSec: 8.0,
    drownIntervalTicks: 20, // 1s when oxygen == 0
    drownDamage: 2,
    sunBurnIntervalTicks: 20,
    sunBurnDamage: 2,
  },

  mining: {
    wrongToolMultiplier: 3.5,
    handSpeedMultiplier: 1.0,
    toolSpeedByTier: {
      0: 1.0, // None
      1: 2.2, // Wood
      2: 4.0, // Stone
      3: 6.2, // Iron
      4: 9.0, // Prismite
    } as Record<number, number>,
  },

  tools: {
    durabilityByTier: {
      1: 60,   // Wood
      2: 132,  // Stone
      3: 251,  // Iron
      4: 780,  // Prismite
    } as Record<number, number>,
    bowDurability: 384,
    bowMaxChargeSec: 1.0,
    bowMinSpeed: 14,
    bowMaxSpeed: 38,
    bowMinDamage: 2,
    bowMaxDamage: 9,
  },

  armor: {
    leatherDefense: { helmet: 1, chestplate: 3, leggings: 2, boots: 1 },
    ironDefense: { helmet: 2, chestplate: 6, leggings: 5, boots: 2 },
    leatherDurability: { helmet: 55, chestplate: 80, leggings: 75, boots: 65 },
    ironDurability: { helmet: 165, chestplate: 240, leggings: 225, boots: 195 },
    maxDamageReductionFraction: 0.8,
    reductionPerDefensePoint: 0.04,
  },

  furnace: {
    smeltTicks: 160, // 8s per item (at 20 TPS)
    fuelTicks: {
      stick: 100,
      oak_planks: 300,
      birch_planks: 300,
      pine_planks: 300,
      oak_log: 300,
      birch_log: 300,
      pine_log: 300,
      coal: 1600,
    } as Record<string, number>,
  },

  farming: {
    cropGrowthIntervalTicks: 600, // 30s per growth attempt
    cropGrowthChanceDry: 0.35,
    cropGrowthChanceWet: 0.85,
    farmlandHydrationRadius: 4,
    wheatDropMin: 1,
    wheatDropMax: 1,
    seedDropMin: 1,
    seedDropMax: 3,
    tallGrassSeedChance: 0.2,
  },

  water: {
    maxSpreadDistance: 5,
    flowTickInterval: 5,
  },

  drops: {
    pickupRadius: 1.6,
    magnetRadius: 2.8,
    mergeRadius: 1.5,
    pickupDelayTicks: 8,
    despawnTicks: 6000, // 5 min
  },

  mobs: {
    hostileMaxLight: 7,
    spawnIntervalTicks: 40,
    maxHostileCount: 16,
    maxPassiveCount: 12,
    minSpawnDist: 14,
    maxSpawnDist: 44,
    despawnDist: 64,
    pathfindMaxNodes: 160,
    pathfindRepathTicks: 15,
    knockbackHorizontal: 6.5,
    knockbackVertical: 4.2,
    husk: { maxHealth: 20, speed: 2.6, damage: 3, attackRange: 1.9, aggroRange: 22, attackCooldownTicks: 22 },
    bone_archer: { maxHealth: 18, speed: 2.7, damage: 3, preferredRange: 10, aggroRange: 24, shootCooldownTicks: 38 },
    gloom_spider: { maxHealth: 16, speed: 3.4, damage: 2, attackRange: 1.8, aggroRange: 20, attackCooldownTicks: 18 },
    boar: { maxHealth: 10, speed: 2.2, fleeSpeed: 3.8 },
    ram: { maxHealth: 10, speed: 2.0, fleeSpeed: 3.5 },
    fowl: { maxHealth: 6, speed: 2.4, fleeSpeed: 4.0 },
  },

  village: {
    regionSizeChunks: 16, // 256x256 blocks per village candidate region
    spawnChance: 0.45,
    minHouses: 4,
    maxHouses: 8,
    minFarms: 1,
    maxFarms: 2,
  },

  defaults: {
    renderDistance: 8,
    fov: 75,
    mouseSensitivity: 1.0,
    volume: 0.7,
  },
} as const;
