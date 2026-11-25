import { BALANCE } from '../config/balance';
import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from '../config/constants';
import { hash2D, hash3D, SeededRNG } from '../core/rng';
import { BiomeId } from '../core/types';
import { BlockId } from '../registry/blocks';
import { Chunk } from './Chunk';

export type BiomeSampler = (wx: number, wz: number) => BiomeId;
export type HeightSampler = (wx: number, wz: number) => number;

export interface VillagePalette {
  pillar: BlockId;
  wall: BlockId;
  foundation: BlockId;
  roof: BlockId;
  floor: BlockId;
  path: BlockId;
  farmBorder: BlockId;
}

export interface VillageHousePlan {
  x: number;
  z: number;
  width: number;
  depth: number;
  wallHeight: number;
  baseY: number;
  doorSide: 'north' | 'south';
  hasBed: boolean;
  hasWorkbench: boolean;
  hasFurnace: boolean;
  hasChest: boolean;
  chestPos?: { x: number; y: number; z: number; lootSeed: number };
}

export interface VillageFarmPlan {
  x: number;
  z: number;
  width: number;
  depth: number;
  baseY: number;
}

export interface VillagePlan {
  regionX: number;
  regionZ: number;
  centerX: number;
  centerZ: number;
  baseY: number;
  biome: BiomeId;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  palette: VillagePalette;
  houses: VillageHousePlan[];
  farms: VillageFarmPlan[];
  chests: Array<{ x: number; y: number; z: number; lootSeed: number }>;
}

const REGION_BLOCKS = BALANCE.village.regionSizeChunks * CHUNK_SIZE; // 256
const VILLAGE_SALT = 0x51a9e73b;

function getPaletteForBiome(biome: BiomeId): VillagePalette {
  if (biome === BiomeId.Desert) {
    return {
      pillar: BlockId.SmoothSandstone,
      wall: BlockId.Sandstone,
      foundation: BlockId.Sandstone,
      roof: BlockId.SmoothSandstone,
      floor: BlockId.Sandstone,
      path: BlockId.SmoothSandstone,
      farmBorder: BlockId.Sandstone,
    };
  }
  if (biome === BiomeId.Snow) {
    return {
      pillar: BlockId.PineLog,
      wall: BlockId.PinePlanks,
      foundation: BlockId.SnowBrick,
      roof: BlockId.SnowBrick,
      floor: BlockId.PinePlanks,
      path: BlockId.Gravel,
      farmBorder: BlockId.PineLog,
    };
  }
  // Plains default
  return {
    pillar: BlockId.OakLog,
    wall: BlockId.OakPlanks,
    foundation: BlockId.Cobblestone,
    roof: BlockId.OakPlanks,
    floor: BlockId.OakPlanks,
    path: BlockId.DirtPath,
    farmBorder: BlockId.OakLog,
  };
}

function isVillageBiome(biome: BiomeId): boolean {
  return biome === BiomeId.Plains || biome === BiomeId.Desert || biome === BiomeId.Snow;
}

function sampleFootprintBaseY(
  x0: number,
  z0: number,
  w: number,
  d: number,
  sampleHeight: HeightSampler
): number {
  const h1 = sampleHeight(x0, z0);
  const h2 = sampleHeight(x0 + w - 1, z0);
  const h3 = sampleHeight(x0, z0 + d - 1);
  const h4 = sampleHeight(x0 + w - 1, z0 + d - 1);
  const hc = sampleHeight(x0 + (w >> 1), z0 + (d >> 1));
  const avg = Math.round((h1 + h2 + h3 + h4 + hc) / 5);
  return Math.max(SEA_LEVEL + 2, Math.min(WORLD_HEIGHT - 16, avg));
}

/**
 * Pure deterministic cross-chunk village planner for macro-region (rx, rz).
 * Because it depends ONLY on (seed, rx, rz, sampleBiome, sampleHeight), any chunk overlapping
 * this village computes the exact same VillagePlan regardless of load order.
 */
export function getVillageForRegion(
  regionX: number,
  regionZ: number,
  seed: number,
  sampleBiome: BiomeSampler,
  sampleHeight: HeightSampler
): VillagePlan | null {
  const rHash = hash2D(seed ^ VILLAGE_SALT, regionX, regionZ);
  const rng = new SeededRNG(rHash);

  if (rng.next() > BALANCE.village.spawnChance) return null;

  const centerX = regionX * REGION_BLOCKS + rng.int(56, REGION_BLOCKS - 56);
  const centerZ = regionZ * REGION_BLOCKS + rng.int(56, REGION_BLOCKS - 56);

  const biome = sampleBiome(centerX, centerZ);
  if (!isVillageBiome(biome)) return null;

  const centerY = sampleHeight(centerX, centerZ);
  if (centerY < SEA_LEVEL + 2 || centerY > 88) return null;

  const palette = getPaletteForBiome(biome);
  const houseCount = rng.int(BALANCE.village.minHouses, BALANCE.village.maxHouses); // 4..8
  const farmCount = rng.int(BALANCE.village.minFarms, BALANCE.village.maxFarms); // 1..2

  const houses: VillageHousePlan[] = [];
  const farms: VillageFarmPlan[] = [];
  const chests: Array<{ x: number; y: number; z: number; lootSeed: number }> = [];

  // Pre-defined orderly slots along the main east-west road (Z = centerZ) so buildings never overlap
  const candidatePlots: Array<{ dx: number; dz: number; doorSide: 'north' | 'south' }> = [
    { dx: -20, dz: -10, doorSide: 'south' },
    { dx: -10, dz: -10, doorSide: 'south' },
    { dx: 6, dz: -10, doorSide: 'south' },
    { dx: 16, dz: -10, doorSide: 'south' },
    { dx: -20, dz: 5, doorSide: 'north' },
    { dx: -10, dz: 5, doorSide: 'north' },
    { dx: 6, dz: 5, doorSide: 'north' },
    { dx: 16, dz: 5, doorSide: 'north' },
  ];

  // Deterministically shuffle candidate plots
  for (let i = candidatePlots.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const tmp = candidatePlots[i];
    candidatePlots[i] = candidatePlots[j];
    candidatePlots[j] = tmp;
  }

  for (let i = 0; i < houseCount && i < candidatePlots.length; i++) {
    const plot = candidatePlots[i];
    const width = rng.int(6, 7);
    const depth = rng.int(6, 7);
    const wallHeight = rng.int(3, 4);
    const hx = centerX + plot.dx;
    const hz = centerZ + plot.dz;
    const baseY = sampleFootprintBaseY(hx, hz, width, depth, sampleHeight);

    const hasChest = i === 0 || (i === 3 && rng.chance(0.55));
    const hasBed = i % 2 === 0 || rng.chance(0.6);
    const hasWorkbench = i === 1 || rng.chance(0.45);
    const hasFurnace = i === 2 || rng.chance(0.45);

    const house: VillageHousePlan = {
      x: hx,
      z: hz,
      width,
      depth,
      wallHeight,
      baseY,
      doorSide: plot.doorSide,
      hasBed,
      hasWorkbench,
      hasFurnace,
      hasChest,
    };

    if (hasChest) {
      const cx = hx + width - 2;
      const cy = baseY + 1;
      const cz = plot.doorSide === 'south' ? hz + 1 : hz + depth - 2;
      const lootSeed = hash3D(seed ^ 0x1007c4, cx, cy, cz);
      house.chestPos = { x: cx, y: cy, z: cz, lootSeed };
      chests.push(house.chestPos);
    }

    houses.push(house);
  }

  // Place 1–2 fenced crop farms near the ends of the road (never overlapping houses)
  const farmOffsets: ReadonlyArray<readonly [number, number]> = [
    [-29, -3],
    [25, -3],
  ];
  for (let i = 0; i < farmCount && i < farmOffsets.length; i++) {
    const fx = centerX + farmOffsets[i][0];
    const fz = centerZ + farmOffsets[i][1];
    const fw = 7;
    const fd = 7;
    const baseY = sampleFootprintBaseY(fx, fz, fw, fd, sampleHeight);
    farms.push({ x: fx, z: fz, width: fw, depth: fd, baseY });
  }

  return {
    regionX,
    regionZ,
    centerX,
    centerZ,
    baseY: centerY,
    biome,
    minX: centerX - 34,
    maxX: centerX + 34,
    minZ: centerZ - 18,
    maxZ: centerZ + 18,
    palette,
    houses,
    farms,
    chests,
  };
}

/** Returns all VillagePlans whose bounding box overlaps chunk (cx, cz). */
export function getVillagesOverlappingChunk(
  cx: number,
  cz: number,
  seed: number,
  sampleBiome: BiomeSampler,
  sampleHeight: HeightSampler
): VillagePlan[] {
  const cMinX = cx * CHUNK_SIZE;
  const cMaxX = cMinX + CHUNK_SIZE - 1;
  const cMinZ = cz * CHUNK_SIZE;
  const cMaxZ = cMinZ + CHUNK_SIZE - 1;

  const rx0 = Math.floor((cMinX - 36) / REGION_BLOCKS);
  const rx1 = Math.floor((cMaxX + 36) / REGION_BLOCKS);
  const rz0 = Math.floor((cMinZ - 24) / REGION_BLOCKS);
  const rz1 = Math.floor((cMaxZ + 24) / REGION_BLOCKS);

  const out: VillagePlan[] = [];
  for (let rz = rz0; rz <= rz1; rz++) {
    for (let rx = rx0; rx <= rx1; rx++) {
      const plan = getVillageForRegion(rx, rz, seed, sampleBiome, sampleHeight);
      if (!plan) continue;
      if (plan.maxX < cMinX || plan.minX > cMaxX || plan.maxZ < cMinZ || plan.minZ > cMaxZ) {
        continue;
      }
      out.push(plan);
    }
  }
  return out;
}

/** Helper to locate the nearest deterministic village for gameplay exploration or tests */
export function findNearestVillage(
  seed: number,
  sampleBiome: BiomeSampler,
  sampleHeight: HeightSampler,
  originX = 0,
  originZ = 0,
  maxRegionRadius = 6
): VillagePlan | null {
  const orx = Math.floor(originX / REGION_BLOCKS);
  const orz = Math.floor(originZ / REGION_BLOCKS);
  let best: VillagePlan | null = null;
  let bestDistSq = Infinity;

  for (let r = 0; r <= maxRegionRadius; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
        const plan = getVillageForRegion(orx + dx, orz + dz, seed, sampleBiome, sampleHeight);
        if (!plan) continue;
        const distSq = (plan.centerX - originX) ** 2 + (plan.centerZ - originZ) ** 2;
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          best = plan;
        }
      }
    }
    if (best) return best;
  }
  return best;
}

/** Returns village chests located inside chunk (cx, cz) for lazy loot registration */
export function getVillageChestsInChunk(
  cx: number,
  cz: number,
  seed: number,
  sampleBiome: BiomeSampler,
  sampleHeight: HeightSampler
): Array<{ x: number; y: number; z: number; lootSeed: number }> {
  const plans = getVillagesOverlappingChunk(cx, cz, seed, sampleBiome, sampleHeight);
  const cMinX = cx * CHUNK_SIZE;
  const cMaxX = cMinX + CHUNK_SIZE - 1;
  const cMinZ = cz * CHUNK_SIZE;
  const cMaxZ = cMinZ + CHUNK_SIZE - 1;
  const result: Array<{ x: number; y: number; z: number; lootSeed: number }> = [];

  for (const plan of plans) {
    for (const ch of plan.chests) {
      if (ch.x >= cMinX && ch.x <= cMaxX && ch.z >= cMinZ && ch.z <= cMaxZ) {
        result.push(ch);
      }
    }
  }
  return result;
}

/**
 * Stamps all overlapping villages deterministically into `chunk`.
 */
export function stampVillagesIntoChunk(
  chunk: Chunk,
  seed: number,
  sampleBiome: BiomeSampler,
  sampleHeight: HeightSampler
): void {
  const plans = getVillagesOverlappingChunk(chunk.cx, chunk.cz, seed, sampleBiome, sampleHeight);
  if (plans.length === 0) return;

  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;

  const setIfInChunk = (wx: number, wy: number, wz: number, id: BlockId, meta = 0): void => {
    if (wy < 1 || wy >= WORLD_HEIGHT - 1) return;
    const lx = wx - baseX;
    const lz = wz - baseZ;
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return;
    chunk.setBlock(lx, wy, lz, id, meta);
  };

  const getIfInChunk = (wx: number, wy: number, wz: number): BlockId => {
    if (wy < 0 || wy >= WORLD_HEIGHT) return BlockId.Air;
    const lx = wx - baseX;
    const lz = wz - baseZ;
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return BlockId.Air;
    return chunk.getBlock(lx, wy, lz);
  };

  const fillFoundationDown = (wx: number, fromY: number, wz: number, mat: BlockId): void => {
    const lx = wx - baseX;
    const lz = wz - baseZ;
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return;
    for (let y = fromY; y >= Math.max(4, fromY - 12); y--) {
      const existing = chunk.getBlock(lx, y, lz);
      if (
        existing !== BlockId.Air &&
        existing !== BlockId.Water &&
        existing !== BlockId.TallGrass &&
        existing !== BlockId.WildflowerRed &&
        existing !== BlockId.WildflowerYellow &&
        existing !== BlockId.DryScrub &&
        existing !== BlockId.OakLeaves &&
        existing !== BlockId.BirchLeaves &&
        existing !== BlockId.PineLeaves
      ) {
        break;
      }
      chunk.setBlock(lx, y, lz, mat, 0);
    }
  };

  for (const plan of plans) {
    const pal = plan.palette;

    // 1. Main road (East-West along centerZ - 1 .. centerZ + 1, X from centerX - 24 .. centerX + 24)
    for (let wx = plan.centerX - 24; wx <= plan.centerX + 24; wx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const wz = plan.centerZ + dz;
        const lx = wx - baseX;
        const lz = wz - baseZ;
        if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) continue;
        // Leave space for central well at centerX - 2 .. centerX + 2
        if (Math.abs(wx - plan.centerX) <= 2 && Math.abs(dz) <= 2) continue;

        const h = Math.max(SEA_LEVEL + 1, sampleHeight(wx, wz));
        setIfInChunk(wx, h, wz, pal.path);
        fillFoundationDown(wx, h - 1, wz, pal.foundation);
        // Clear flora/trees directly above road
        for (let cy = h + 1; cy <= h + 4; cy++) {
          const cur = getIfInChunk(wx, cy, wz);
          if (cur !== BlockId.Air) setIfInChunk(wx, cy, wz, BlockId.Air);
        }
      }
    }

    // 2. Central Well (4x4 at centerX - 2 .. centerX + 1, centerZ - 2 .. centerZ + 1)
    const wellX = plan.centerX - 2;
    const wellZ = plan.centerZ - 2;
    const wellY = sampleFootprintBaseY(wellX, wellZ, 4, 4, sampleHeight);
    for (let dz = 0; dz < 4; dz++) {
      for (let dx = 0; dx < 4; dx++) {
        const wx = wellX + dx;
        const wz = wellZ + dz;
        const isEdge = dx === 0 || dx === 3 || dz === 0 || dz === 3;
        const isCorner = (dx === 0 || dx === 3) && (dz === 0 || dz === 3);

        // Foundation & basin floor
        setIfInChunk(wx, wellY - 2, wz, pal.foundation);
        fillFoundationDown(wx, wellY - 3, wz, pal.foundation);

        if (isEdge) {
          setIfInChunk(wx, wellY - 1, wz, pal.foundation);
          setIfInChunk(wx, wellY, wz, pal.foundation);
          setIfInChunk(wx, wellY + 1, wz, pal.foundation);
          setIfInChunk(wx, wellY + 2, wz, isCorner ? pal.pillar : BlockId.Air);
          setIfInChunk(wx, wellY + 3, wz, isCorner ? pal.pillar : BlockId.Air);
        } else {
          setIfInChunk(wx, wellY - 1, wz, BlockId.Water, 0);
          setIfInChunk(wx, wellY, wz, BlockId.Water, 0);
          setIfInChunk(wx, wellY + 1, wz, BlockId.Air);
          setIfInChunk(wx, wellY + 2, wz, BlockId.Air);
          setIfInChunk(wx, wellY + 3, wz, BlockId.Air);
        }
        // Canopy roof
        setIfInChunk(wx, wellY + 4, wz, pal.roof);
        setIfInChunk(wx, wellY + 5, wz, BlockId.Air);
      }
    }

    // 3. Houses (4..8 original biome-adapted cottages)
    for (const h of plan.houses) {
      const doorX = h.x + Math.floor(h.width / 2);
      const doorZ = h.doorSide === 'south' ? h.z + h.depth - 1 : h.z;
      const frontStepZ = h.doorSide === 'south' ? doorZ + 1 : doorZ - 1;

      for (let dz = 0; dz < h.depth; dz++) {
        for (let dx = 0; dx < h.width; dx++) {
          const wx = h.x + dx;
          const wz = h.z + dz;
          const isEdgeX = dx === 0 || dx === h.width - 1;
          const isEdgeZ = dz === 0 || dz === h.depth - 1;
          const isWall = isEdgeX || isEdgeZ;
          const isCorner = isEdgeX && isEdgeZ;

          // Floor + solid foundation downward so house NEVER floats
          setIfInChunk(wx, h.baseY, wz, isWall ? pal.foundation : pal.floor);
          fillFoundationDown(wx, h.baseY - 1, wz, pal.foundation);

          // Interior & walls
          for (let wy = 1; wy <= h.wallHeight; wy++) {
            const y = h.baseY + wy;
            if (!isWall) {
              setIfInChunk(wx, y, wz, BlockId.Air);
            } else if (wx === doorX && wz === doorZ && (wy === 1 || wy === 2)) {
              setIfInChunk(wx, y, wz, wy === 1 ? BlockId.WoodDoorBottom : BlockId.WoodDoorTop, 0);
            } else if (isCorner) {
              setIfInChunk(wx, y, wz, pal.pillar);
            } else if (wy === 2 && ((isEdgeZ && dx === 2) || (isEdgeX && dz === Math.floor(h.depth / 2)))) {
              setIfInChunk(wx, y, wz, BlockId.Glass);
            } else {
              setIfInChunk(wx, y, wz, pal.wall);
            }
          }

          // Clear overhead mountain/tree overhang above roof so house NEVER gets buried
          const roofBaseY = h.baseY + h.wallHeight + 1;
          const inset = Math.min(dx, h.width - 1 - dx, dz, h.depth - 1 - dz);
          const roofLayers = plan.biome === BiomeId.Desert ? 1 : Math.min(2, inset + 1);
          for (let ry = 0; ry < roofLayers; ry++) {
            setIfInChunk(wx, roofBaseY + ry, wz, ry === 0 && isWall ? pal.pillar : pal.roof);
          }
          // Desert decorative parapet corner crenellations
          if (plan.biome === BiomeId.Desert && isCorner) {
            setIfInChunk(wx, roofBaseY + 1, wz, pal.roof);
          }
          for (let clearY = roofBaseY + roofLayers; clearY <= roofBaseY + 5; clearY++) {
            if (getIfInChunk(wx, clearY, wz) !== BlockId.Air) {
              setIfInChunk(wx, clearY, wz, BlockId.Air);
            }
          }
        }
      }

      // Clear doorway entrance step
      setIfInChunk(doorX, h.baseY, frontStepZ, pal.path);
      fillFoundationDown(doorX, h.baseY - 1, frontStepZ, pal.foundation);
      setIfInChunk(doorX, h.baseY + 1, frontStepZ, BlockId.Air);
      setIfInChunk(doorX, h.baseY + 2, frontStepZ, BlockId.Air);

      // Interior Torch (illuminates house nicely at night!)
      const backZ = h.doorSide === 'south' ? h.z + 1 : h.z + h.depth - 2;
      setIfInChunk(h.x + Math.floor(h.width / 2), h.baseY + 1, backZ, BlockId.Torch);

      // Interior furnishings (Bed, Workbench, Furnace, Chest)
      if (h.hasBed) {
        setIfInChunk(h.x + 1, h.baseY + 1, backZ, BlockId.Bed);
      }
      if (h.hasWorkbench) {
        setIfInChunk(h.x + 1, h.baseY + 1, h.doorSide === 'south' ? h.z + 2 : h.z + h.depth - 3, BlockId.Workbench);
      }
      if (h.hasFurnace) {
        setIfInChunk(h.x + h.width - 2, h.baseY + 1, h.doorSide === 'south' ? h.z + 2 : h.z + h.depth - 3, BlockId.Furnace);
      }
      if (h.hasChest && h.chestPos) {
        setIfInChunk(h.chestPos.x, h.chestPos.y, h.chestPos.z, BlockId.Chest);
      }
    }

    // 4. Farms (1..2 irrigated grain plots with growing & ripe crops)
    for (const f of plan.farms) {
      const midX = f.x + Math.floor(f.width / 2);
      for (let dz = 0; dz < f.depth; dz++) {
        for (let dx = 0; dx < f.width; dx++) {
          const wx = f.x + dx;
          const wz = f.z + dz;
          const isBorder = dx === 0 || dx === f.width - 1 || dz === 0 || dz === f.depth - 1;

          fillFoundationDown(wx, f.baseY - 1, wz, pal.foundation);
          for (let cy = f.baseY + 2; cy <= f.baseY + 5; cy++) {
            setIfInChunk(wx, cy, wz, BlockId.Air);
          }

          if (isBorder) {
            setIfInChunk(wx, f.baseY, wz, pal.farmBorder);
            setIfInChunk(wx, f.baseY + 1, wz, BlockId.Air);
          } else if (wx === midX) {
            setIfInChunk(wx, f.baseY, wz, BlockId.Water, 0);
            setIfInChunk(wx, f.baseY + 1, wz, BlockId.Air);
          } else {
            setIfInChunk(wx, f.baseY, wz, BlockId.FarmlandWet);
            const stage = ((wx + wz) & 1) === 0 ? BlockId.CropStage3 : BlockId.CropStage2;
            setIfInChunk(wx, f.baseY + 1, wz, stage);
          }
        }
      }
    }
  }
}
