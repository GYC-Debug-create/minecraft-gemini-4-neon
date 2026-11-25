import { CHUNK_AREA, CHUNK_SIZE, CHUNK_VOLUME, WORLD_HEIGHT } from '../config/constants';
import { BiomeId } from '../core/types';
import { BlockId } from '../registry/blocks';

export function chunkIndex(lx: number, y: number, lz: number): number {
  return (y << 8) | (lz << 4) | lx;
}

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export function worldToChunkCoord(v: number): number {
  return Math.floor(v / CHUNK_SIZE);
}

export function worldToLocalCoord(v: number): number {
  return Math.floor(v) & (CHUNK_SIZE - 1);
}

export interface SerializedChunk {
  cx: number;
  cz: number;
  blocks: Uint8Array;
  meta: Uint8Array;
  biomes: Uint8Array;
}

export class Chunk {
  readonly cx: number;
  readonly cz: number;
  readonly blocks: Uint8Array;
  readonly light: Uint8Array; // high 4 bits = skyLight (0..15), low 4 bits = blockLight (0..15)
  readonly meta: Uint8Array;
  readonly biomes: Uint8Array; // 16*16 biome IDs

  dirty = true;
  modified = false;
  lightInitialized = false;
  hasFarmBlocks = false;

  constructor(
    cx: number,
    cz: number,
    blocks?: Uint8Array,
    light?: Uint8Array,
    meta?: Uint8Array,
    biomes?: Uint8Array
  ) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = blocks ?? new Uint8Array(CHUNK_VOLUME);
    this.light = light ?? new Uint8Array(CHUNK_VOLUME);
    this.meta = meta ?? new Uint8Array(CHUNK_VOLUME);
    this.biomes = biomes ?? new Uint8Array(CHUNK_AREA);
  }

  getBlock(lx: number, y: number, lz: number): BlockId {
    if (y < 0 || y >= WORLD_HEIGHT || lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) {
      return BlockId.Air;
    }
    return this.blocks[chunkIndex(lx, y, lz)] as BlockId;
  }

  setBlock(lx: number, y: number, lz: number, id: BlockId, meta = 0): void {
    if (y < 0 || y >= WORLD_HEIGHT || lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) {
      return;
    }
    const idx = chunkIndex(lx, y, lz);
    this.blocks[idx] = id;
    this.meta[idx] = meta;
    if (id >= BlockId.Farmland && id <= BlockId.CropStage2) {
      this.hasFarmBlocks = true;
    }
    this.dirty = true;
  }

  getMeta(lx: number, y: number, lz: number): number {
    if (y < 0 || y >= WORLD_HEIGHT || lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) {
      return 0;
    }
    return this.meta[chunkIndex(lx, y, lz)];
  }

  setMeta(lx: number, y: number, lz: number, meta: number): void {
    if (y < 0 || y >= WORLD_HEIGHT || lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) {
      return;
    }
    this.meta[chunkIndex(lx, y, lz)] = meta;
    this.dirty = true;
  }

  getSkyLight(lx: number, y: number, lz: number): number {
    if (y >= WORLD_HEIGHT) return 15;
    if (y < 0 || lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return 0;
    return (this.light[chunkIndex(lx, y, lz)] >> 4) & 0x0f;
  }

  setSkyLight(lx: number, y: number, lz: number, value: number): void {
    if (y < 0 || y >= WORLD_HEIGHT || lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return;
    const idx = chunkIndex(lx, y, lz);
    this.light[idx] = (this.light[idx] & 0x0f) | ((value & 0x0f) << 4);
  }

  getBlockLight(lx: number, y: number, lz: number): number {
    if (y < 0 || y >= WORLD_HEIGHT || lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return 0;
    return this.light[chunkIndex(lx, y, lz)] & 0x0f;
  }

  setBlockLight(lx: number, y: number, lz: number, value: number): void {
    if (y < 0 || y >= WORLD_HEIGHT || lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return;
    const idx = chunkIndex(lx, y, lz);
    this.light[idx] = (this.light[idx] & 0xf0) | (value & 0x0f);
  }

  getBiome(lx: number, lz: number): BiomeId {
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return BiomeId.Plains;
    return this.biomes[(lz << 4) | lx] as BiomeId;
  }

  setBiome(lx: number, lz: number, biome: BiomeId): void {
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return;
    this.biomes[(lz << 4) | lx] = biome;
  }

  serialize(): SerializedChunk {
    return {
      cx: this.cx,
      cz: this.cz,
      blocks: new Uint8Array(this.blocks),
      meta: new Uint8Array(this.meta),
      biomes: new Uint8Array(this.biomes),
    };
  }

  static deserialize(data: SerializedChunk): Chunk {
    const blocks = new Uint8Array(data.blocks);
    const chunk = new Chunk(
      data.cx,
      data.cz,
      blocks,
      new Uint8Array(CHUNK_VOLUME),
      new Uint8Array(data.meta),
      new Uint8Array(data.biomes)
    );
    chunk.modified = true;
    chunk.dirty = true;
    for (let i = 0; i < blocks.length; i++) {
      const id = blocks[i];
      if (id >= BlockId.Farmland && id <= BlockId.CropStage2) {
        chunk.hasFarmBlocks = true;
        break;
      }
    }
    return chunk;
  }
}
