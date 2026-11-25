import { CHUNK_AREA, CHUNK_SIZE, MAX_LIGHT, SEA_LEVEL, WORLD_HEIGHT } from '../config/constants';
import { NoiseGenerator } from '../core/noise';
import { hash2D, hash3D, SeededRNG } from '../core/rng';
import { BiomeId } from '../core/types';
import { BlockId, BlockRegistry } from '../registry/blocks';
import { Chunk, chunkIndex, worldToChunkCoord, worldToLocalCoord } from './Chunk';
import { stampVillagesIntoChunk } from './VillageGenerator';

export interface ClimateSample {
  continental: number;
  temp: number;
  humidity: number;
  mountain: number;
}

interface ColumnSample {
  climate: ClimateSample;
  biome: BiomeId;
  height: number;
}

const enum TreeKind {
  Oak = 0,
  Birch = 1,
  Pine = 2,
}

const MAX_TERRAIN_HEIGHT = WORLD_HEIGHT - 15; // 113 (strictly below WORLD_HEIGHT - 14 = 114)
const MIN_TERRAIN_HEIGHT = 6;

const CAVE_MIN_Y = 6;
const CAVE_MAX_Y = 58;
const CAVE_GRID_XZ = 9; // 0, 2, 4, ..., 16
const CAVE_GRID_Y = 28; // 6, 8, 10, ..., 60
const CHEESE_GRID_XZ = 5; // 0, 4, 8, 12, 16
const CHEESE_GRID_Y = 15; // 4, 8, 12, ..., 60

const TREE_CELL_SIZE = 5;
const TREE_PAD = 3;

// Fast flat lookup tables for initial lighting pass
const BLOCK_OPACITY = new Uint8Array(256);
const BLOCK_EMISSION = new Uint8Array(256);
const BLOCK_SOLID = new Uint8Array(256);
for (const def of BlockRegistry.all()) {
  BLOCK_OPACITY[def.id] = def.lightOpacity;
  BLOCK_EMISSION[def.id] = def.lightEmission;
  BLOCK_SOLID[def.id] = def.solid ? 1 : 0;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function caveIdx(gx: number, gy: number, gz: number): number {
  return (gy * CAVE_GRID_XZ + gz) * CAVE_GRID_XZ + gx;
}

function cheeseIdx(gx: number, gy: number, gz: number): number {
  return (gy * CHEESE_GRID_XZ + gz) * CHEESE_GRID_XZ + gx;
}

function isTreeReplaceable(id: BlockId): boolean {
  return (
    id === BlockId.Air ||
    id === BlockId.TallGrass ||
    id === BlockId.WildflowerRed ||
    id === BlockId.WildflowerYellow ||
    id === BlockId.DryScrub
  );
}

function isLogReplaceable(id: BlockId): boolean {
  return (
    isTreeReplaceable(id) ||
    id === BlockId.OakLeaves ||
    id === BlockId.BirchLeaves ||
    id === BlockId.PineLeaves
  );
}

export class TerrainGenerator {
  readonly seed: number;

  private readonly continental: NoiseGenerator;
  private readonly elevation: NoiseGenerator;
  private readonly detail: NoiseGenerator;
  private readonly temp: NoiseGenerator;
  private readonly humidity: NoiseGenerator;
  private readonly caveA: NoiseGenerator;
  private readonly caveB: NoiseGenerator;
  private readonly ore: NoiseGenerator;

  private readonly bedrockSeed: number;
  private readonly surfaceSeed: number;
  private readonly oreSeed: number;
  private readonly treeSeed: number;
  private readonly treeDetailSeed: number;
  private readonly floraSeed: number;

  // Reusable per-chunk scratch buffers (overwritten completely on every generateChunk call)
  private readonly colHeights = new Uint8Array(CHUNK_AREA);
  private readonly caveGridA = new Float32Array(CAVE_GRID_XZ * CAVE_GRID_Y * CAVE_GRID_XZ);
  private readonly caveGridB = new Float32Array(CAVE_GRID_XZ * CAVE_GRID_Y * CAVE_GRID_XZ);
  private readonly cheeseGrid = new Float32Array(CHEESE_GRID_XZ * CHEESE_GRID_Y * CHEESE_GRID_XZ);

  constructor(seed: number) {
    this.seed = seed >>> 0;

    this.continental = new NoiseGenerator(hash2D(this.seed, 101, 1));
    this.elevation = new NoiseGenerator(hash2D(this.seed, 202, 2));
    this.detail = new NoiseGenerator(hash2D(this.seed, 303, 3));
    this.temp = new NoiseGenerator(hash2D(this.seed, 404, 4));
    this.humidity = new NoiseGenerator(hash2D(this.seed, 505, 5));
    this.caveA = new NoiseGenerator(hash2D(this.seed, 606, 6));
    this.caveB = new NoiseGenerator(hash2D(this.seed, 707, 7));
    this.ore = new NoiseGenerator(hash2D(this.seed, 808, 8));

    this.bedrockSeed = hash2D(this.seed, 909, 11);
    this.surfaceSeed = hash2D(this.seed, 1010, 12);
    this.oreSeed = hash2D(this.seed, 1111, 13);
    this.treeSeed = hash2D(this.seed, 1212, 14);
    this.treeDetailSeed = hash2D(this.seed, 1313, 15);
    this.floraSeed = hash2D(this.seed, 1414, 16);
  }

  sampleClimate(wx: number, wz: number): ClimateSample {
    const cRaw = this.continental.fbm2D(wx * 0.0024, wz * 0.0024, 3, 0.5, 2.0);
    const continental = clamp(cRaw * 2.15, -1, 1);

    const tRaw = this.temp.fbm2D(wx * 0.0028, wz * 0.0028, 3, 0.5, 2.0);
    const temp = clamp(0.5 + tRaw * 1.35, 0, 1);

    const hRaw = this.humidity.fbm2D(wx * 0.003, wz * 0.003, 3, 0.5, 2.0);
    const humidity = clamp(0.5 + hRaw * 1.35, 0, 1);

    const mRaw = this.elevation.fbm2D(wx * 0.0032 + 53.1, wz * 0.0032 - 27.4, 3, 0.5, 2.0);
    const mountain = clamp(0.5 + mRaw * 1.45, 0, 1);

    return { continental, temp, humidity, mountain };
  }

  private classifyBiome(climate: ClimateSample): BiomeId {
    if (climate.continental < -0.25) {
      return BiomeId.Ocean;
    }

    const inland = smoothstep(-0.2, 0.12, climate.continental);
    const effectiveMountain = climate.mountain * inland;
    if (effectiveMountain > 0.63) {
      return BiomeId.Mountains;
    }

    if (climate.temp < 0.34) {
      return BiomeId.Snow;
    }

    if (climate.temp > 0.61 && climate.humidity < 0.66) {
      return BiomeId.Desert;
    }

    if (climate.humidity >= 0.49) {
      return BiomeId.Forest;
    }

    return BiomeId.Plains;
  }

  private computeHeight(wx: number, wz: number, climate: ClimateSample): number {
    const { continental, temp, humidity, mountain } = climate;

    const e1 = this.elevation.fbm2D(wx * 0.0085, wz * 0.0085, 4, 0.5, 2.0);
    const e2 = this.detail.fbm2D(wx * 0.025, wz * 0.025, 3, 0.5, 2.0);

    // Ridged noise for crisp alpine peaks
    const ridgeN = 1 - Math.abs(this.elevation.noise2D(wx * 0.014 + 31.7, wz * 0.014 - 19.3));
    const ridge = ridgeN * ridgeN;

    // Gentle rolling desert dunes
    const duneWave = Math.sin(wx * 0.055 + wz * 0.032 + e1 * 3.2);

    // Smooth climate weights (no abrupt jumps across biome borders)
    const landMask = smoothstep(-0.28, -0.02, continental);
    const oceanDepth = smoothstep(-0.24, -0.88, continental);
    const inland = smoothstep(-0.2, 0.12, continental);

    const snowW = smoothstep(0.41, 0.27, temp);
    const desertW = smoothstep(0.54, 0.68, temp) * smoothstep(0.74, 0.58, humidity);
    const tempRem = Math.max(0.0001, 1 - snowW - desertW);
    const humidSplit = smoothstep(0.41, 0.57, humidity);
    const forestW = tempRem * humidSplit;
    const plainsW = tempRem * (1 - humidSplit);
    const weightSum = snowW + desertW + forestW + plainsW;

    // Characteristic elevations per biome
    const plainsH = 62.2 + e1 * 5.2 + e2 * 2.0; // ~59..68
    const forestH = 64.2 + e1 * 6.8 + e2 * 2.6; // ~60..71
    const desertH = 63.0 + e1 * 4.8 + duneWave * 2.3 + e2 * 1.3; // ~59..70
    const snowH = 65.8 + e1 * 7.8 + e2 * 2.8; // ~61..74

    const landBase =
      (plainsH * plainsW + forestH * forestW + desertH * desertW + snowH * snowW) / weightSum;

    // Smooth mountain rise from foothills to alpine peaks
    const effectiveMountain = mountain * inland;
    const foothill = smoothstep(0.49, 0.64, effectiveMountain);
    const alpine = smoothstep(0.61, 0.96, effectiveMountain);

    const foothillTarget = 72.2 + e1 * 4.0 + e2 * 2.1;
    const baseWithFoothills = lerp(landBase, foothillTarget, foothill);
    const peakBoost = alpine * (20.0 + ridge * 17.5) + foothill * ridge * 2.8;
    const inlandHeight = baseWithFoothills + peakBoost;

    // Ocean floor elevation (~36..54) rising gently toward sandy beaches around SEA_LEVEL (56)
    const shoreDamp = lerp(0.55, 1.0, oceanDepth);
    const oceanH = 53.0 - oceanDepth * 15.0 + (e1 * 4.2 + e2 * 1.8) * shoreDamp;

    let h = lerp(oceanH, inlandHeight, landMask);

    // Softly compress very high peaks so terrain stays naturally below WORLD_HEIGHT - 14 (114)
    if (h > 101) {
      h = 101 + Math.tanh((h - 101) / 9.0) * 7.5;
    }

    return clamp(Math.round(h), MIN_TERRAIN_HEIGHT, MAX_TERRAIN_HEIGHT);
  }

  private sampleColumn(wx: number, wz: number): ColumnSample {
    const climate = this.sampleClimate(wx, wz);
    const biome = this.classifyBiome(climate);
    const height = this.computeHeight(wx, wz, climate);
    return { climate, biome, height };
  }

  sampleBiome(wx: number, wz: number): BiomeId {
    return this.classifyBiome(this.sampleClimate(wx, wz));
  }

  sampleHeight(wx: number, wz: number): number {
    const climate = this.sampleClimate(wx, wz);
    return this.computeHeight(wx, wz, climate);
  }

  generateChunk(cx: number, cz: number): Chunk {
    const chunk = new Chunk(cx, cz);
    const blocks = chunk.blocks;
    const biomes = chunk.biomes;
    const baseX = cx * CHUNK_SIZE;
    const baseZ = cz * CHUNK_SIZE;

    const colHeights = this.colHeights;
    let maxSurfaceY = 0;

    // 1. Heightmap, biomes, bedrock, stone, subsurface, surface, water/ice
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wz = baseZ + lz;
      const rowOff = lz << 4;
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = baseX + lx;
        const colIdx = rowOff | lx;

        const climate = this.sampleClimate(wx, wz);
        const biome = this.classifyBiome(climate);
        const surfaceY = this.computeHeight(wx, wz, climate);

        colHeights[colIdx] = surfaceY;
        biomes[colIdx] = biome;
        if (surfaceY > maxSurfaceY) maxSurfaceY = surfaceY;

        // Bedrock base (y = 0 always, deterministic scatter at y = 1..2)
        const bedHash = hash2D(this.bedrockSeed, wx, wz);
        blocks[colIdx] = BlockId.Bedrock; // y = 0
        blocks[(1 << 8) | colIdx] = (bedHash & 3) !== 0 ? BlockId.Bedrock : BlockId.Stone;
        blocks[(2 << 8) | colIdx] = ((bedHash >>> 4) & 3) === 0 ? BlockId.Bedrock : BlockId.Stone;

        // Fill Stone up to surfaceY
        for (let y = 3; y <= surfaceY; y++) {
          blocks[(y << 8) | colIdx] = BlockId.Stone;
        }

        // Apply biome-appropriate surface & subsurface layers
        const surfHash = hash2D(this.surfaceSeed, wx, wz);
        if (surfaceY < SEA_LEVEL) {
          // Underwater floor
          const deepFloor = surfaceY <= SEA_LEVEL - 5;
          const floorPatch = this.detail.noise2D(wx * 0.06, wz * 0.06);
          const floorBlock =
            deepFloor && floorPatch > -0.05 ? BlockId.Gravel : BlockId.Sand;
          const floorDepth = Math.min(3, surfaceY - 2);
          for (let d = 0; d < floorDepth; d++) {
            blocks[((surfaceY - d) << 8) | colIdx] = floorBlock;
          }
          if (biome === BiomeId.Desert && surfaceY >= 6) {
            blocks[((surfaceY - 3) << 8) | colIdx] = BlockId.Sandstone;
          }

          // Water up to SEA_LEVEL
          for (let y = surfaceY + 1; y <= SEA_LEVEL; y++) {
            blocks[(y << 8) | colIdx] = BlockId.Water;
          }

          // Shallow frozen ocean edge & cold ponds in/bordering Snow biome
          const frozenWater =
            biome === BiomeId.Snow ||
            (biome === BiomeId.Ocean && climate.temp < 0.34 && surfaceY >= SEA_LEVEL - 8);
          if (frozenWater) {
            blocks[(SEA_LEVEL << 8) | colIdx] = BlockId.Ice;
          }
        } else {
          // Dry land
          const isBeach =
            surfaceY <= SEA_LEVEL + 2 &&
            biome !== BiomeId.Snow &&
            biome !== BiomeId.Mountains;

          if (biome === BiomeId.Desert || isBeach) {
            const sandDepth = biome === BiomeId.Desert ? 3 + (surfHash & 1) : 3;
            for (let d = 0; d < sandDepth && surfaceY - d >= 3; d++) {
              blocks[((surfaceY - d) << 8) | colIdx] = BlockId.Sand;
            }
            const sandstoneDepth = biome === BiomeId.Desert ? 3 : 2;
            for (
              let d = sandDepth;
              d < sandDepth + sandstoneDepth && surfaceY - d >= 3;
              d++
            ) {
              blocks[((surfaceY - d) << 8) | colIdx] = BlockId.Sandstone;
            }
          } else if (biome === BiomeId.Plains || biome === BiomeId.Forest) {
            blocks[(surfaceY << 8) | colIdx] = BlockId.Grass;
            for (let d = 1; d <= 3 && surfaceY - d >= 3; d++) {
              blocks[((surfaceY - d) << 8) | colIdx] = BlockId.Dirt;
            }
          } else if (biome === BiomeId.Snow) {
            const snowDrift = surfaceY >= 71 || (surfaceY >= 68 && (surfHash & 3) === 0);
            blocks[(surfaceY << 8) | colIdx] = snowDrift
              ? BlockId.SnowBlock
              : BlockId.SnowGrass;
            for (let d = 1; d <= 3 && surfaceY - d >= 3; d++) {
              blocks[((surfaceY - d) << 8) | colIdx] =
                snowDrift && d === 1 ? BlockId.SnowBlock : BlockId.Dirt;
            }
          } else if (biome === BiomeId.Mountains) {
            if (surfaceY >= 90) {
              const capDepth = surfaceY >= 96 ? 3 : 2;
              for (let d = 0; d < capDepth && surfaceY - d >= 3; d++) {
                blocks[((surfaceY - d) << 8) | colIdx] = BlockId.SnowBlock;
              }
            } else if (surfaceY >= 87) {
              blocks[(surfaceY << 8) | colIdx] =
                (surfHash & 1) === 0 ? BlockId.SnowBlock : BlockId.SnowGrass;
              blocks[((surfaceY - 1) << 8) | colIdx] = BlockId.Dirt;
            } else if (surfaceY >= 79) {
              // Rocky highland crags with gravel talus pockets
              const talus = this.detail.noise2D(wx * 0.08 + 12.4, wz * 0.08 - 7.1);
              if (talus > 0.28) {
                blocks[(surfaceY << 8) | colIdx] = BlockId.Gravel;
                blocks[((surfaceY - 1) << 8) | colIdx] = BlockId.Gravel;
              }
              // Else exposed Stone already placed
            } else {
              // Lower mountain slopes
              blocks[(surfaceY << 8) | colIdx] =
                climate.temp < 0.37 ? BlockId.SnowGrass : BlockId.Grass;
              for (let d = 1; d <= 2 && surfaceY - d >= 3; d++) {
                blocks[((surfaceY - d) << 8) | colIdx] = BlockId.Dirt;
              }
            }
          } else {
            // Ocean biome tiny above-sea islets
            if (climate.temp < 0.34) {
              blocks[(surfaceY << 8) | colIdx] = BlockId.SnowGrass;
              for (let d = 1; d <= 2 && surfaceY - d >= 3; d++) {
                blocks[((surfaceY - d) << 8) | colIdx] = BlockId.Dirt;
              }
            } else {
              for (let d = 0; d < 3 && surfaceY - d >= 3; d++) {
                blocks[((surfaceY - d) << 8) | colIdx] = BlockId.Sand;
              }
            }
          }
        }
      }
    }

    // 2. 3D noise caves (dual spaghetti tunnels + cheese caverns)
    this.carveCaves(blocks, baseX, baseZ, maxSurfaceY);

    // 3. Depth-stratified ore clusters inside Stone
    this.generateOres(blocks, cx, cz, baseX, baseZ, maxSurfaceY);

    // 4. Cross-chunk consistent trees (Oak, Birch, Pine)
    this.stampTrees(blocks, biomes, baseX, baseZ);

    // 5. Surface flora (TallGrass, Wildflowers, DryScrub)
    this.stampFlora(blocks, biomes, baseX, baseZ);

    // 5b. Deterministic cross-chunk biome villages (houses, road, farms, well, chests)
    stampVillagesIntoChunk(
      chunk,
      this.seed,
      (x, z) => this.sampleBiome(x, z),
      (x, z) => this.sampleHeight(x, z)
    );

    // 6. Initial vertical column sky-light + emitting block light pass
    this.computeInitialLight(chunk);

    chunk.dirty = true;
    return chunk;
  }

  private carveCaves(
    blocks: Uint8Array,
    baseX: number,
    baseZ: number,
    maxSurfaceY: number
  ): void {
    const upperY = Math.min(CAVE_MAX_Y, maxSurfaceY - 1);
    if (upperY < CAVE_MIN_Y) return;

    const gridA = this.caveGridA;
    const gridB = this.caveGridB;
    const cheese = this.cheeseGrid;

    const maxGy = Math.min(CAVE_GRID_Y - 1, ((upperY - CAVE_MIN_Y) >> 1) + 1);
    const caveA = this.caveA;
    const caveB = this.caveB;

    // Sample dual 3D noise on a chunk-aligned 2x2x2 lattice for seamless cross-chunk tunnels
    for (let gy = 0; gy <= maxGy; gy++) {
      const y = CAVE_MIN_Y + (gy << 1);
      const ny = y * 0.062;
      for (let gz = 0; gz < CAVE_GRID_XZ; gz++) {
        const nz = (baseZ + (gz << 1)) * 0.045;
        for (let gx = 0; gx < CAVE_GRID_XZ; gx++) {
          const nx = (baseX + (gx << 1)) * 0.045;
          const idx = caveIdx(gx, gy, gz);
          gridA[idx] = caveA.noise3D(nx, ny, nz);
          gridB[idx] = caveB.noise3D(nx + 43.1, ny - 17.7, nz + 29.3);
        }
      }
    }

    // Sample lower-frequency 3D cheese cavern noise on a chunk-aligned 4x4x4 lattice
    const maxCheeseY = Math.min(CHEESE_GRID_Y - 1, ((upperY - 4) >> 2) + 1);
    for (let cy = 0; cy <= maxCheeseY; cy++) {
      const ny = (4 + (cy << 2)) * 0.036;
      for (let cz = 0; cz < CHEESE_GRID_XZ; cz++) {
        const nz = (baseZ + (cz << 2)) * 0.025 + 89.1;
        for (let cx = 0; cx < CHEESE_GRID_XZ; cx++) {
          const nx = (baseX + (cx << 2)) * 0.025 + 137.3;
          cheese[cheeseIdx(cx, cy, cz)] = caveA.noise3D(nx, ny, nz);
        }
      }
    }

    const colHeights = this.colHeights;

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const gz = lz >> 1;
      const fz = (lz & 1) * 0.5;
      const cz = lz >> 2;
      const cfz = (lz & 3) * 0.25;
      const rowOff = lz << 4;

      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const colIdx = rowOff | lx;
        const surfaceY = colHeights[colIdx];

        // Protect ocean floors (never carve y >= SEA_LEVEL - 3 when underwater, nor top 3 blocks of seafloor)
        // and protect low coastal beaches from leaking ocean water into caves
        let colMaxY: number;
        if (surfaceY < SEA_LEVEL) {
          colMaxY = Math.min(upperY, SEA_LEVEL - 4, surfaceY - 3);
        } else if (surfaceY <= SEA_LEVEL + 2) {
          colMaxY = Math.min(upperY, SEA_LEVEL - 4);
        } else {
          colMaxY = Math.min(upperY, surfaceY - 1);
        }
        if (colMaxY < CAVE_MIN_Y) continue;

        const gx = lx >> 1;
        const fx = (lx & 1) * 0.5;
        const cx = lx >> 2;
        const cfx = (lx & 3) * 0.25;

        for (let y = CAVE_MIN_Y; y <= colMaxY; y++) {
          const vIdx = (y << 8) | colIdx;
          const existing = blocks[vIdx] as BlockId;
          if (existing === BlockId.Bedrock || existing === BlockId.Water || existing === BlockId.Air) {
            continue;
          }

          // Trilinear interpolation of dual spaghetti noise
          const ry = y - CAVE_MIN_Y;
          const gy = ry >> 1;
          const fy = (ry & 1) * 0.5;

          const i000 = caveIdx(gx, gy, gz);
          const i100 = i000 + 1;
          const i010 = i000 + CAVE_GRID_XZ;
          const i110 = i010 + 1;
          const yStride = CAVE_GRID_XZ * CAVE_GRID_XZ;
          const i001 = i000 + yStride;
          const i101 = i100 + yStride;
          const i011 = i010 + yStride;
          const i111 = i110 + yStride;

          const a00 = lerp(gridA[i000], gridA[i100], fx);
          const a10 = lerp(gridA[i010], gridA[i110], fx);
          const a01 = lerp(gridA[i001], gridA[i101], fx);
          const a11 = lerp(gridA[i011], gridA[i111], fx);
          const a = lerp(lerp(a00, a10, fz), lerp(a01, a11, fz), fy);

          // Gentle depth fade near bedrock floor & shallow ceiling
          let depthFactor = 1.0;
          if (y < 10) {
            depthFactor = 0.5 + ((y - CAVE_MIN_Y) / 4) * 0.5;
          } else if (y > 50) {
            depthFactor = 1.0 - ((y - 50) / 8) * 0.35;
          }

          const spagThresh = 0.0095 * depthFactor;
          const aSq = a * a;
          let carve = false;
          if (aSq < spagThresh) {
            const b00 = lerp(gridB[i000], gridB[i100], fx);
            const b10 = lerp(gridB[i010], gridB[i110], fx);
            const b01 = lerp(gridB[i001], gridB[i101], fx);
            const b11 = lerp(gridB[i011], gridB[i111], fx);
            const b = lerp(lerp(b00, b10, fz), lerp(b01, b11, fz), fy);
            carve = aSq + b * b < spagThresh;
          }

          if (!carve) {
            // Trilinear interpolation of cheese cavern noise
            const cry = y - 4;
            const cy = cry >> 2;
            const cfy = (cry & 3) * 0.25;
            const c000 = cheeseIdx(cx, cy, cz);
            const c100 = c000 + 1;
            const c010 = c000 + CHEESE_GRID_XZ;
            const c110 = c010 + 1;
            const cyStride = CHEESE_GRID_XZ * CHEESE_GRID_XZ;
            const c001 = c000 + cyStride;
            const c101 = c100 + cyStride;
            const c011 = c010 + cyStride;
            const c111 = c110 + cyStride;

            const ch00 = lerp(cheese[c000], cheese[c100], cfx);
            const ch10 = lerp(cheese[c010], cheese[c110], cfx);
            const ch01 = lerp(cheese[c001], cheese[c101], cfx);
            const ch11 = lerp(cheese[c011], cheese[c111], cfx);
            const ch = lerp(lerp(ch00, ch10, cfz), lerp(ch01, ch11, cfz), cfy);

            if (ch > 0.40 + (1 - depthFactor) * 0.12) {
              carve = true;
            }
          }

          if (carve) {
            blocks[vIdx] = BlockId.Air;
          }
        }
      }
    }
  }

  private generateOres(
    blocks: Uint8Array,
    cx: number,
    cz: number,
    baseX: number,
    baseZ: number,
    maxSurfaceY: number
  ): void {
    // CoalOre: y = 8..74 (generous clusters)
    this.placeOreVeins(blocks, cx, cz, baseX, baseZ, BlockId.CoalOre, 1, 18, 8, Math.min(74, maxSurfaceY), 5, 10, -0.5);

    // IronOre: y = 6..62 (solid veins, with guaranteed reachable veins in y = 46..60)
    this.placeOreVeins(blocks, cx, cz, baseX, baseZ, BlockId.IronOre, 2, 11, 6, Math.min(58, maxSurfaceY), 4, 8, -0.45);
    this.placeOreVeins(blocks, cx, cz, baseX, baseZ, BlockId.IronOre, 3, 5, 46, Math.min(62, maxSurfaceY), 4, 7, -0.5);

    // GoldOre: y = 4..32
    this.placeOreVeins(blocks, cx, cz, baseX, baseZ, BlockId.GoldOre, 4, 6, 4, Math.min(32, maxSurfaceY), 3, 6, -0.35);

    // PrismiteOre: y = 4..20 (rare deep crystalline clusters)
    this.placeOreVeins(blocks, cx, cz, baseX, baseZ, BlockId.PrismiteOre, 5, 2, 4, Math.min(20, maxSurfaceY), 2, 5, -0.18);
  }

  private placeOreVeins(
    blocks: Uint8Array,
    cx: number,
    cz: number,
    baseX: number,
    baseZ: number,
    oreBlock: BlockId,
    salt: number,
    attempts: number,
    minY: number,
    maxY: number,
    minSize: number,
    maxSize: number,
    veinNoiseThreshold: number
  ): void {
    if (maxY < minY) return;
    const rng = new SeededRNG(hash3D(this.oreSeed, cx, salt, cz));

    for (let a = 0; a < attempts; a++) {
      let lx = rng.int(0, CHUNK_SIZE - 1);
      let y = rng.int(minY, maxY);
      let lz = rng.int(0, CHUNK_SIZE - 1);

      // Regional 3D ore vein modulation
      const n = this.ore.noise3D(
        (baseX + lx) * 0.045 + salt * 19.3,
        y * 0.075,
        (baseZ + lz) * 0.045 - salt * 11.7
      );
      if (n < veinNoiseThreshold) continue;

      const size = rng.int(minSize, maxSize);
      for (let s = 0; s < size; s++) {
        const idx = chunkIndex(lx, y, lz);
        if (blocks[idx] === BlockId.Stone) {
          blocks[idx] = oreBlock;
        }

        // Compact 3D random walk keeping clusters cohesive inside chunk and Y bounds
        const dir = rng.int(0, 5);
        if (dir === 0 && lx > 0) lx--;
        else if (dir === 1 && lx < CHUNK_SIZE - 1) lx++;
        else if (dir === 2 && lz > 0) lz--;
        else if (dir === 3 && lz < CHUNK_SIZE - 1) lz++;
        else if (dir === 4 && y > minY) y--;
        else if (dir === 5 && y < maxY) y++;
      }
    }
  }

  private stampTrees(
    blocks: Uint8Array,
    biomes: Uint8Array,
    baseX: number,
    baseZ: number
  ): void {
    const minWX = baseX - TREE_PAD;
    const maxWX = baseX + CHUNK_SIZE - 1 + TREE_PAD;
    const minWZ = baseZ - TREE_PAD;
    const maxWZ = baseZ + CHUNK_SIZE - 1 + TREE_PAD;

    const minGx = Math.floor(minWX / TREE_CELL_SIZE);
    const maxGx = Math.floor(maxWX / TREE_CELL_SIZE);
    const minGz = Math.floor(minWZ / TREE_CELL_SIZE);
    const maxGz = Math.floor(maxWZ / TREE_CELL_SIZE);

    const colHeights = this.colHeights;

    for (let gz = minGz; gz <= maxGz; gz++) {
      for (let gx = minGx; gx <= maxGx; gx++) {
        const h = hash2D(this.treeSeed, gx, gz);

        // Jittered offset in {1, 2, 3} within each 5x5 cell guarantees >= 3 blocks between trunks
        const tx = gx * TREE_CELL_SIZE + 1 + (h % 3);
        const tz = gz * TREE_CELL_SIZE + 1 + ((h >>> 4) % 3);

        if (tx < minWX || tx > maxWX || tz < minWZ || tz > maxWZ) continue;

        let biome: BiomeId;
        let surfaceY: number;

        const inChunkX = tx - baseX;
        const inChunkZ = tz - baseZ;
        if (
          inChunkX >= 0 &&
          inChunkX < CHUNK_SIZE &&
          inChunkZ >= 0 &&
          inChunkZ < CHUNK_SIZE
        ) {
          const colIdx = (inChunkZ << 4) | inChunkX;
          biome = biomes[colIdx] as BiomeId;
          surfaceY = colHeights[colIdx];
        } else {
          const sample = this.sampleColumn(tx, tz);
          biome = sample.biome;
          surfaceY = sample.height;
        }

        // Only place trees on dry land above beach level with sufficient sky headroom
        if (surfaceY <= SEA_LEVEL + 2 || surfaceY >= WORLD_HEIGHT - 12) continue;

        const chanceRoll = ((h >>> 8) & 0xffff) / 65536;
        const speciesRoll = (h >>> 24) & 0xff;
        let kind: TreeKind | null = null;

        if (biome === BiomeId.Forest) {
          if (chanceRoll < 0.62) {
            kind = speciesRoll < 174 ? TreeKind.Oak : TreeKind.Birch; // ~68% Oak, ~32% Birch
          }
        } else if (biome === BiomeId.Plains) {
          if (chanceRoll < 0.14) {
            kind = speciesRoll < 205 ? TreeKind.Oak : TreeKind.Birch; // ~80% Oak, ~20% Birch
          }
        } else if (biome === BiomeId.Snow) {
          if (chanceRoll < 0.25) {
            kind = TreeKind.Pine;
          }
        } else if (biome === BiomeId.Mountains) {
          if (surfaceY <= 84 && chanceRoll < 0.26) {
            kind = TreeKind.Pine;
          }
        }

        if (kind === null) continue;

        this.stampSingleTree(blocks, baseX, baseZ, tx, surfaceY, tz, kind);
      }
    }
  }

  private stampSingleTree(
    blocks: Uint8Array,
    baseX: number,
    baseZ: number,
    tx: number,
    groundY: number,
    tz: number,
    kind: TreeKind
  ): void {
    const h2 = hash2D(this.treeDetailSeed, tx, tz);

    const setLog = (wx: number, wy: number, wz: number, id: BlockId): void => {
      const lx = wx - baseX;
      const lz = wz - baseZ;
      if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || wy < 1 || wy >= WORLD_HEIGHT) {
        return;
      }
      const idx = chunkIndex(lx, wy, lz);
      if (isLogReplaceable(blocks[idx] as BlockId)) {
        blocks[idx] = id;
      }
    };

    const setLeaf = (wx: number, wy: number, wz: number, id: BlockId): void => {
      const lx = wx - baseX;
      const lz = wz - baseZ;
      if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || wy < 1 || wy >= WORLD_HEIGHT) {
        return;
      }
      const idx = chunkIndex(lx, wy, lz);
      if (isTreeReplaceable(blocks[idx] as BlockId)) {
        blocks[idx] = id;
      }
    };

    // Convert grass directly under trunk to dirt
    const baseLx = tx - baseX;
    const baseLz = tz - baseZ;
    if (baseLx >= 0 && baseLx < CHUNK_SIZE && baseLz >= 0 && baseLz < CHUNK_SIZE) {
      const gIdx = chunkIndex(baseLx, groundY, baseLz);
      const gBlock = blocks[gIdx] as BlockId;
      if (gBlock === BlockId.Grass || gBlock === BlockId.SnowGrass) {
        blocks[gIdx] = BlockId.Dirt;
      }
    }

    if (kind === TreeKind.Oak) {
      const trunkH = 4 + (h2 % 3); // 4..6
      const topY = groundY + trunkH;

      // Lower canopy layers (5x5 with trimmed corners)
      for (let dy = -2; dy <= -1; dy++) {
        const wy = topY + dy;
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (Math.abs(dx) === 2 && Math.abs(dz) === 2) {
              const cornerHash = hash3D(this.treeDetailSeed, tx + dx, wy, tz + dz);
              if ((cornerHash & 1) === 0) continue;
            }
            setLeaf(tx + dx, wy, tz + dz, BlockId.OakLeaves);
          }
        }
      }
      // Mid crown (3x3)
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          setLeaf(tx + dx, topY, tz + dz, BlockId.OakLeaves);
        }
      }
      // Top cross
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (Math.abs(dx) + Math.abs(dz) <= 1) {
            setLeaf(tx + dx, topY + 1, tz + dz, BlockId.OakLeaves);
          }
        }
      }
      // Trunk stamped last so logs always punch cleanly through canopy center
      for (let y = groundY + 1; y <= topY; y++) {
        setLog(tx, y, tz, BlockId.OakLog);
      }
    } else if (kind === TreeKind.Birch) {
      const trunkH = 5 + (h2 % 3); // 5..7 (taller, slenderer)
      const topY = groundY + trunkH;

      for (let dy = -2; dy <= -1; dy++) {
        const wy = topY + dy;
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
            setLeaf(tx + dx, wy, tz + dz, BlockId.BirchLeaves);
          }
        }
      }
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (Math.abs(dx) === 1 && Math.abs(dz) === 1) {
            const ch = hash3D(this.treeDetailSeed, tx + dx, topY, tz + dz);
            if ((ch & 3) === 0) continue;
          }
          setLeaf(tx + dx, topY, tz + dz, BlockId.BirchLeaves);
        }
      }
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (Math.abs(dx) + Math.abs(dz) <= 1) {
            setLeaf(tx + dx, topY + 1, tz + dz, BlockId.BirchLeaves);
          }
        }
      }
      for (let y = groundY + 1; y <= topY; y++) {
        setLog(tx, y, tz, BlockId.BirchLog);
      }
    } else {
      // Conical Pine
      const trunkH = 6 + (h2 % 4); // 6..9
      const topY = groundY + trunkH;
      const minLeafY = groundY + 2;

      // Tip
      setLeaf(tx, topY + 2, tz, BlockId.PineLeaves);
      // Spire cross
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (Math.abs(dx) + Math.abs(dz) <= 1) {
            setLeaf(tx + dx, topY + 1, tz + dz, BlockId.PineLeaves);
          }
        }
      }

      // Layered conical whorls from topY down to minLeafY
      for (let y = topY; y >= minLeafY; y--) {
        const distFromTop = topY - y;
        let radius: number;
        let maxManhattan: number;
        if (distFromTop === 0) {
          radius = 0;
          maxManhattan = 0;
        } else if (distFromTop === 1) {
          radius = 1;
          maxManhattan = 1;
        } else if (distFromTop === 2) {
          radius = 1;
          maxManhattan = 2;
        } else if (distFromTop === 3) {
          radius = 2;
          maxManhattan = 3;
        } else if (distFromTop === 4) {
          radius = 1;
          maxManhattan = 2;
        } else if (distFromTop === 5) {
          radius = 2;
          maxManhattan = 3;
        } else {
          radius = 2;
          maxManhattan = 2;
        }

        for (let dz = -radius; dz <= radius; dz++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (Math.abs(dx) + Math.abs(dz) <= maxManhattan) {
              setLeaf(tx + dx, y, tz + dz, BlockId.PineLeaves);
            }
          }
        }
      }

      for (let y = groundY + 1; y <= topY; y++) {
        setLog(tx, y, tz, BlockId.PineLog);
      }
    }
  }

  private stampFlora(
    blocks: Uint8Array,
    biomes: Uint8Array,
    baseX: number,
    baseZ: number
  ): void {
    const colHeights = this.colHeights;

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wz = baseZ + lz;
      const rowOff = lz << 4;
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const colIdx = rowOff | lx;
        const surfaceY = colHeights[colIdx];
        if (surfaceY <= SEA_LEVEL || surfaceY >= WORLD_HEIGHT - 1) continue;

        const aboveIdx = ((surfaceY + 1) << 8) | colIdx;
        if (blocks[aboveIdx] !== BlockId.Air) continue;

        const ground = blocks[(surfaceY << 8) | colIdx] as BlockId;
        const biome = biomes[colIdx] as BiomeId;
        const wx = baseX + lx;
        const fh = hash2D(this.floraSeed, wx, wz);
        const roll = (fh & 0xffff) / 65536;

        if (ground === BlockId.Grass) {
          if (biome === BiomeId.Plains) {
            if (roll < 0.16) blocks[aboveIdx] = BlockId.TallGrass;
            else if (roll < 0.184) blocks[aboveIdx] = BlockId.WildflowerRed;
            else if (roll < 0.21) blocks[aboveIdx] = BlockId.WildflowerYellow;
          } else if (biome === BiomeId.Forest) {
            if (roll < 0.12) blocks[aboveIdx] = BlockId.TallGrass;
            else if (roll < 0.134) blocks[aboveIdx] = BlockId.WildflowerRed;
            else if (roll < 0.15) blocks[aboveIdx] = BlockId.WildflowerYellow;
          } else if (biome === BiomeId.Mountains) {
            if (roll < 0.08) blocks[aboveIdx] = BlockId.TallGrass;
            else if (roll < 0.09) blocks[aboveIdx] = BlockId.WildflowerYellow;
          }
        } else if (
          ground === BlockId.Sand &&
          biome === BiomeId.Desert &&
          surfaceY > SEA_LEVEL + 1
        ) {
          if (roll < 0.035) {
            blocks[aboveIdx] = BlockId.DryScrub;
          }
        }
      }
    }
  }

  private computeInitialLight(chunk: Chunk): void {
    const blocks = chunk.blocks;
    const light = chunk.light;
    const emitters: number[] = [];

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const rowOff = lz << 4;
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const colIdx = rowOff | lx;
        let sky = MAX_LIGHT;

        for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
          const idx = (y << 8) | colIdx;
          const id = blocks[idx];
          const opacity = BLOCK_OPACITY[id];
          const emission = BLOCK_EMISSION[id];

          if (opacity >= MAX_LIGHT) {
            sky = 0;
          } else if (opacity > 0 && sky > 0) {
            sky = sky > opacity ? sky - opacity : 0;
          }

          light[idx] = (sky << 4) | emission;

          if (emission > 1) {
            emitters.push(idx);
          }
        }
      }
    }

    // Small local propagation for emitting ores (e.g. PrismiteOre emits 3 -> 2 -> 1 into cave air)
    for (let i = 0; i < emitters.length; i++) {
      const idx = emitters[i];
      const emission = light[idx] & 0x0f;
      if (emission <= 1) continue;

      const lx = idx & 0x0f;
      const lz = (idx >>> 4) & 0x0f;
      const y = idx >>> 8;
      this.propagateEmitterLight(blocks, light, lx, y, lz, emission);
    }
  }

  private propagateEmitterLight(
    blocks: Uint8Array,
    light: Uint8Array,
    sx: number,
    sy: number,
    sz: number,
    level: number
  ): void {
    const spread = (x: number, y: number, z: number, val: number): void => {
      if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) {
        return;
      }
      const idx = chunkIndex(x, y, z);
      if (BLOCK_OPACITY[blocks[idx]] >= MAX_LIGHT) return;
      const curBlockLight = light[idx] & 0x0f;
      if (curBlockLight >= val) return;
      light[idx] = (light[idx] & 0xf0) | val;

      if (val > 1) {
        const nextVal = val - 1;
        spread(x + 1, y, z, nextVal);
        spread(x - 1, y, z, nextVal);
        spread(x, y + 1, z, nextVal);
        spread(x, y - 1, z, nextVal);
        spread(x, y, z + 1, nextVal);
        spread(x, y, z - 1, nextVal);
      }
    };

    const next = level - 1;
    spread(sx + 1, sy, sz, next);
    spread(sx - 1, sy, sz, next);
    spread(sx, sy + 1, sz, next);
    spread(sx, sy - 1, sz, next);
    spread(sx, sy, sz + 1, next);
    spread(sx, sy, sz - 1, next);
  }
}

function isSafeSpawnGround(id: BlockId): boolean {
  return (
    BLOCK_SOLID[id] === 1 &&
    id !== BlockId.OakLog &&
    id !== BlockId.BirchLog &&
    id !== BlockId.PineLog &&
    id !== BlockId.OakLeaves &&
    id !== BlockId.BirchLeaves &&
    id !== BlockId.PineLeaves &&
    id !== BlockId.Ice
  );
}

function findClearColumnInChunk(
  chunk: Chunk,
  prefLx: number,
  prefLz: number,
  minGroundY: number
): { lx: number; groundY: number; lz: number } | null {
  let best: { lx: number; groundY: number; lz: number; distSq: number } | null = null;

  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      // Find top non-air block in this column (must have strictly Air above)
      let topY = -1;
      for (let y = WORLD_HEIGHT - 1; y >= minGroundY; y--) {
        const b = chunk.getBlock(lx, y, lz);
        if (b !== BlockId.Air) {
          topY = y;
          break;
        }
      }
      if (topY < minGroundY || topY > WORLD_HEIGHT - 4) continue;

      const groundBlock = chunk.getBlock(lx, topY, lz);
      if (!isSafeSpawnGround(groundBlock)) continue;

      // Ensure strictly Air for at least 3 blocks above ground (and open sky above topY)
      let clear = true;
      for (let y = topY + 1; y <= Math.min(WORLD_HEIGHT - 1, topY + 3); y++) {
        if (chunk.getBlock(lx, y, lz) !== BlockId.Air) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;

      const dx = lx - prefLx;
      const dz = lz - prefLz;
      const distSq = dx * dx + dz * dz;
      if (best === null || distSq < best.distSq) {
        best = { lx, groundY: topY, lz, distSq };
      }
    }
  }

  return best ? { lx: best.lx, groundY: best.groundY, lz: best.lz } : null;
}

/**
 * Deterministically finds a safe dry land spawn block coordinate near (0, 0),
 * favoring Plains and Forest biomes above SEA_LEVEL + 1 with strictly clear Air above ground.
 */
export function findSafeSpawn(seed: number): { x: number; y: number; z: number } {
  const gen = new TerrainGenerator(seed);
  const checkedChunks = new Set<string>();

  const tryCandidate = (
    wx: number,
    wz: number,
    minGroundY: number
  ): { x: number; y: number; z: number } | null => {
    const cx = worldToChunkCoord(wx);
    const cz = worldToChunkCoord(wz);
    const key = `${cx},${cz}`;
    if (checkedChunks.has(key)) return null;
    checkedChunks.add(key);

    const chunk = gen.generateChunk(cx, cz);
    const spot = findClearColumnInChunk(
      chunk,
      worldToLocalCoord(wx),
      worldToLocalCoord(wz),
      minGroundY
    );
    if (!spot) return null;

    return {
      x: cx * CHUNK_SIZE + spot.lx,
      y: spot.groundY + 1,
      z: cz * CHUNK_SIZE + spot.lz,
    };
  };

  // Pass 1: Spiral search near (0, 0) favoring Plains & Forest dry land
  const maxRings = 96; // up to radius ~384 blocks in 4-block steps
  const step = 4;

  for (let pass = 0; pass < 3; pass++) {
    checkedChunks.clear();
    const minY = pass < 2 ? SEA_LEVEL + 2 : SEA_LEVEL + 1;
    const maxY = pass === 0 ? 74 : pass === 1 ? 84 : MAX_TERRAIN_HEIGHT - 4;

    // Check origin first
    const originBiome = gen.sampleBiome(0, 0);
    const originH = gen.sampleHeight(0, 0);
    const originMatch =
      originH >= minY &&
      originH <= maxY &&
      (pass === 0
        ? originBiome === BiomeId.Plains || originBiome === BiomeId.Forest
        : pass === 1
          ? originBiome !== BiomeId.Ocean
          : true);

    if (originMatch) {
      const found = tryCandidate(0, 0, minY);
      if (found) return found;
    }

    for (let ring = 1; ring <= maxRings; ring++) {
      const r = ring * step;
      for (let i = -ring; i <= ring; i++) {
        const coords: ReadonlyArray<readonly [number, number]> =
          i === -ring || i === ring
            ? [
                [i * step, -r],
                [i * step, r],
              ]
            : [
                [i * step, -r],
                [i * step, r],
                [-r, i * step],
                [r, i * step],
              ];

        for (let k = 0; k < coords.length; k++) {
          const wx = coords[k][0];
          const wz = coords[k][1];
          const biome = gen.sampleBiome(wx, wz);

          if (pass === 0 && biome !== BiomeId.Plains && biome !== BiomeId.Forest) continue;
          if (pass === 1 && biome === BiomeId.Ocean) continue;

          const h = gen.sampleHeight(wx, wz);
          if (h < minY || h > maxY) continue;

          const found = tryCandidate(wx, wz, minY);
          if (found) return found;
        }
      }
    }
  }

  // Absolute deterministic fallback at (0, 0)
  const fallbackY = Math.max(SEA_LEVEL + 1, gen.sampleHeight(0, 0) + 1);
  return { x: 0, y: fallbackY, z: 0 };
}
