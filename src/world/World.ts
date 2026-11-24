import { CHUNK_SIZE, WORLD_HEIGHT } from '../config/constants';
import { EventBus } from '../core/events';
import { BiomeId, ChunkCoord } from '../core/types';
import { BlockId, BlockRegistry } from '../registry/blocks';
import { Chunk, chunkKey, worldToChunkCoord, worldToLocalCoord } from './Chunk';

export interface IWorld {
  readonly seed: number;
  getBlock(x: number, y: number, z: number): BlockId;
  setBlock(x: number, y: number, z: number, id: BlockId, meta?: number, markModified?: boolean): boolean;
  getMeta(x: number, y: number, z: number): number;
  setMeta(x: number, y: number, z: number, meta: number): void;
  getSkyLight(x: number, y: number, z: number): number;
  getBlockLight(x: number, y: number, z: number): number;
  getLight(x: number, y: number, z: number): number;
  getBiome(x: number, z: number): BiomeId;
  getChunk(cx: number, cz: number): Chunk | undefined;
  setChunk(chunk: Chunk): void;
  unloadChunk(cx: number, cz: number): void;
  getLoadedChunkCoords(): ChunkCoord[];
}

export class World implements IWorld {
  readonly seed: number;
  readonly events: EventBus;
  private readonly chunks = new Map<string, Chunk>();

  constructor(seed: number, events: EventBus = new EventBus()) {
    this.seed = seed >>> 0;
    this.events = events;
  }

  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }

  hasChunk(cx: number, cz: number): boolean {
    return this.chunks.has(chunkKey(cx, cz));
  }

  setChunk(chunk: Chunk): void {
    this.chunks.set(chunkKey(chunk.cx, chunk.cz), chunk);
    this.events.emit('chunk:loaded', { cx: chunk.cx, cz: chunk.cz });
  }

  unloadChunk(cx: number, cz: number): void {
    this.chunks.delete(chunkKey(cx, cz));
  }

  clear(): void {
    this.chunks.clear();
  }

  getLoadedChunks(): IterableIterator<Chunk> {
    return this.chunks.values();
  }

  getLoadedChunkCoords(): ChunkCoord[] {
    const out: ChunkCoord[] = [];
    for (const c of this.chunks.values()) {
      out.push({ cx: c.cx, cz: c.cz });
    }
    return out;
  }

  getModifiedChunks(): Chunk[] {
    const out: Chunk[] = [];
    for (const c of this.chunks.values()) {
      if (c.modified) out.push(c);
    }
    return out;
  }

  getBlock(x: number, y: number, z: number): BlockId {
    const iy = Math.floor(y);
    if (iy < 0 || iy >= WORLD_HEIGHT) return BlockId.Air;
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const chunk = this.getChunk(worldToChunkCoord(ix), worldToChunkCoord(iz));
    if (!chunk) return BlockId.Air;
    return chunk.getBlock(worldToLocalCoord(ix), iy, worldToLocalCoord(iz));
  }

  setBlock(x: number, y: number, z: number, id: BlockId, meta = 0, markModified = true): boolean {
    const iy = Math.floor(y);
    if (iy < 0 || iy >= WORLD_HEIGHT) return false;
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const cx = worldToChunkCoord(ix);
    const cz = worldToChunkCoord(iz);
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return false;

    const lx = worldToLocalCoord(ix);
    const lz = worldToLocalCoord(iz);
    const oldId = chunk.getBlock(lx, iy, lz);
    const oldMeta = chunk.getMeta(lx, iy, lz);
    if (oldId === id && oldMeta === meta) return false;

    chunk.setBlock(lx, iy, lz, id, meta);
    if (markModified) chunk.modified = true;

    this.markDirtyWithNeighbors(cx, cz, lx, lz);
    this.events.emit('block:changed', { x: ix, y: iy, z: iz, oldId, newId: id });
    return true;
  }

  getMeta(x: number, y: number, z: number): number {
    const iy = Math.floor(y);
    if (iy < 0 || iy >= WORLD_HEIGHT) return 0;
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const chunk = this.getChunk(worldToChunkCoord(ix), worldToChunkCoord(iz));
    if (!chunk) return 0;
    return chunk.getMeta(worldToLocalCoord(ix), iy, worldToLocalCoord(iz));
  }

  setMeta(x: number, y: number, z: number, meta: number): void {
    const iy = Math.floor(y);
    if (iy < 0 || iy >= WORLD_HEIGHT) return;
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const cx = worldToChunkCoord(ix);
    const cz = worldToChunkCoord(iz);
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return;
    const lx = worldToLocalCoord(ix);
    const lz = worldToLocalCoord(iz);
    chunk.setMeta(lx, iy, lz, meta);
    chunk.modified = true;
    this.markDirtyWithNeighbors(cx, cz, lx, lz);
  }

  getSkyLight(x: number, y: number, z: number): number {
    const iy = Math.floor(y);
    if (iy >= WORLD_HEIGHT) return 15;
    if (iy < 0) return 0;
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const chunk = this.getChunk(worldToChunkCoord(ix), worldToChunkCoord(iz));
    if (!chunk) return 15;
    return chunk.getSkyLight(worldToLocalCoord(ix), iy, worldToLocalCoord(iz));
  }

  setSkyLight(x: number, y: number, z: number, value: number): void {
    const iy = Math.floor(y);
    if (iy < 0 || iy >= WORLD_HEIGHT) return;
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const cx = worldToChunkCoord(ix);
    const cz = worldToChunkCoord(iz);
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return;
    chunk.setSkyLight(worldToLocalCoord(ix), iy, worldToLocalCoord(iz), value);
    chunk.dirty = true;
  }

  getBlockLight(x: number, y: number, z: number): number {
    const iy = Math.floor(y);
    if (iy < 0 || iy >= WORLD_HEIGHT) return 0;
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const chunk = this.getChunk(worldToChunkCoord(ix), worldToChunkCoord(iz));
    if (!chunk) return 0;
    return chunk.getBlockLight(worldToLocalCoord(ix), iy, worldToLocalCoord(iz));
  }

  setBlockLight(x: number, y: number, z: number, value: number): void {
    const iy = Math.floor(y);
    if (iy < 0 || iy >= WORLD_HEIGHT) return;
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const cx = worldToChunkCoord(ix);
    const cz = worldToChunkCoord(iz);
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return;
    chunk.setBlockLight(worldToLocalCoord(ix), iy, worldToLocalCoord(iz), value);
    chunk.dirty = true;
  }

  getLight(x: number, y: number, z: number): number {
    return Math.max(this.getSkyLight(x, y, z), this.getBlockLight(x, y, z));
  }

  getBiome(x: number, z: number): BiomeId {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const chunk = this.getChunk(worldToChunkCoord(ix), worldToChunkCoord(iz));
    if (!chunk) return BiomeId.Plains;
    return chunk.getBiome(worldToLocalCoord(ix), worldToLocalCoord(iz));
  }

  isSolidAt(x: number, y: number, z: number): boolean {
    const id = this.getBlock(x, y, z);
    const meta = this.getMeta(x, y, z);
    return BlockRegistry.isSolid(id, meta);
  }

  getTopSolidY(x: number, z: number): number {
    for (let y = WORLD_HEIGHT - 2; y >= 1; y--) {
      const id = this.getBlock(x, y, z);
      if (id !== BlockId.Air && !BlockRegistry.get(id).replaceable && !BlockRegistry.isLiquid(id)) {
        return y;
      }
    }
    return 64;
  }

  private markDirtyWithNeighbors(cx: number, cz: number, lx: number, lz: number): void {
    const mark = (ncx: number, ncz: number): void => {
      const c = this.getChunk(ncx, ncz);
      if (c) {
        c.dirty = true;
        this.events.emit('chunk:dirty', { cx: ncx, cz: ncz });
      }
    };
    mark(cx, cz);
    if (lx === 0) mark(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) mark(cx + 1, cz);
    if (lz === 0) mark(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) mark(cx, cz + 1);
  }
}
