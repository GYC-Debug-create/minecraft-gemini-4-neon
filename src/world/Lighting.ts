import { CHUNK_SIZE, MAX_LIGHT, WORLD_HEIGHT } from '../config/constants';
import { BlockId, BlockRegistry } from '../registry/blocks';
import { Chunk, chunkIndex, chunkKey, worldToChunkCoord, worldToLocalCoord } from './Chunk';
import { World } from './World';

const DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

function getOpacity(id: BlockId): number {
  return BlockRegistry.getLightOpacity(id);
}

function getEmission(id: BlockId): number {
  return BlockRegistry.getLightEmission(id);
}

/**
 * Fast intra-chunk sky-light and block-light BFS initialization.
 * Safe to run inside Web Worker immediately after terrain generation.
 */
export function initializeChunkLight(chunk: Chunk): void {
  chunk.light.fill(0);

  const skyQ: number[] = [];
  const blockQ: number[] = [];

  // 1. Direct vertical sky-light columns + scan block light emitters
  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      let sky = MAX_LIGHT;
      for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
        const idx = chunkIndex(lx, y, lz);
        const id = chunk.blocks[idx] as BlockId;
        const opacity = getOpacity(id);
        const emit = getEmission(id);

        if (emit > 0) {
          chunk.light[idx] = (chunk.light[idx] & 0xf0) | (emit & 0x0f);
          blockQ.push(lx, y, lz);
        }

        if (sky > 0) {
          if (opacity >= MAX_LIGHT) {
            sky = 0;
          } else {
            if (opacity > 0) {
              sky = Math.max(0, sky - opacity);
            }
            if (sky > 0) {
              chunk.light[idx] = (chunk.light[idx] & 0x0f) | ((sky & 0x0f) << 4);
              skyQ.push(lx, y, lz);
            }
          }
        }
      }
    }
  }

  // 2. Intra-chunk BFS for sky light (horizontal/up/down attenuation)
  let head = 0;
  while (head < skyQ.length) {
    const x = skyQ[head++];
    const y = skyQ[head++];
    const z = skyQ[head++];
    const curSky = chunk.getSkyLight(x, y, z);
    if (curSky <= 1) continue;

    for (let d = 0; d < 6; d++) {
      const nx = x + DIRS[d][0];
      const ny = y + DIRS[d][1];
      const nz = z + DIRS[d][2];
      if (nx < 0 || nx >= CHUNK_SIZE || nz < 0 || nz >= CHUNK_SIZE || ny < 0 || ny >= WORLD_HEIGHT) {
        continue;
      }
      const nId = chunk.getBlock(nx, ny, nz);
      const op = getOpacity(nId);
      if (op >= MAX_LIGHT) continue;
      // Direct sunlight (15) moving straight down through opacity=0 stays 15
      const stepCost = d === 3 && curSky === MAX_LIGHT && op === 0 ? 0 : Math.max(1, op);
      const nextSky = curSky - stepCost;
      if (nextSky > chunk.getSkyLight(nx, ny, nz)) {
        chunk.setSkyLight(nx, ny, nz, nextSky);
        skyQ.push(nx, ny, nz);
      }
    }
  }

  // 3. Intra-chunk BFS for block light
  head = 0;
  while (head < blockQ.length) {
    const x = blockQ[head++];
    const y = blockQ[head++];
    const z = blockQ[head++];
    const curBlk = chunk.getBlockLight(x, y, z);
    if (curBlk <= 1) continue;

    for (let d = 0; d < 6; d++) {
      const nx = x + DIRS[d][0];
      const ny = y + DIRS[d][1];
      const nz = z + DIRS[d][2];
      if (nx < 0 || nx >= CHUNK_SIZE || nz < 0 || nz >= CHUNK_SIZE || ny < 0 || ny >= WORLD_HEIGHT) {
        continue;
      }
      const nId = chunk.getBlock(nx, ny, nz);
      const op = getOpacity(nId);
      if (op >= MAX_LIGHT) continue;
      const nextBlk = curBlk - Math.max(1, op);
      if (nextBlk > chunk.getBlockLight(nx, ny, nz)) {
        chunk.setBlockLight(nx, ny, nz, nextBlk);
        blockQ.push(nx, ny, nz);
      }
    }
  }

  chunk.lightInitialized = true;
}

function markTouched(world: World, touched: Set<string>, wx: number, wz: number): void {
  const cx = worldToChunkCoord(wx);
  const cz = worldToChunkCoord(wz);
  const key = chunkKey(cx, cz);
  if (!touched.has(key)) {
    touched.add(key);
    const c = world.getChunk(cx, cz);
    if (c) {
      c.dirty = true;
    }
  }
  const lx = worldToLocalCoord(wx);
  const lz = worldToLocalCoord(wz);
  const markEdge = (ncx: number, ncz: number): void => {
    const nk = chunkKey(ncx, ncz);
    if (!touched.has(nk)) {
      const nc = world.getChunk(ncx, ncz);
      if (nc) {
        touched.add(nk);
        nc.dirty = true;
      }
    }
  };
  if (lx === 0) markEdge(cx - 1, cz);
  if (lx === CHUNK_SIZE - 1) markEdge(cx + 1, cz);
  if (lz === 0) markEdge(cx, cz - 1);
  if (lz === CHUNK_SIZE - 1) markEdge(cx, cz + 1);
}

function emitDirtyTouched(world: World, touched: Set<string>): void {
  for (const key of touched) {
    const [cxStr, czStr] = key.split(',');
    world.events.emit('chunk:dirty', { cx: Number(cxStr), cz: Number(czStr) });
  }
}

function floodSkyLight(world: World, queue: number[], touched: Set<string>): void {
  let head = 0;
  while (head < queue.length) {
    const x = queue[head++];
    const y = queue[head++];
    const z = queue[head++];
    const curSky = world.getSkyLight(x, y, z);
    if (curSky <= 0) continue;

    for (let d = 0; d < 6; d++) {
      const nx = x + DIRS[d][0];
      const ny = y + DIRS[d][1];
      const nz = z + DIRS[d][2];
      if (ny < 0 || ny >= WORLD_HEIGHT) continue;
      if (!world.hasChunk(worldToChunkCoord(nx), worldToChunkCoord(nz))) continue;

      const nId = world.getBlock(nx, ny, nz);
      const op = getOpacity(nId);
      if (op >= MAX_LIGHT) continue;

      const stepCost = d === 3 && curSky === MAX_LIGHT && op === 0 ? 0 : Math.max(1, op);
      const nextSky = curSky - stepCost;
      if (nextSky > world.getSkyLight(nx, ny, nz)) {
        world.setSkyLight(nx, ny, nz, nextSky);
        markTouched(world, touched, nx, nz);
        if (nextSky > 1 || (d === 3 && nextSky === MAX_LIGHT)) {
          queue.push(nx, ny, nz);
        }
      }
    }
  }
}

function floodBlockLight(world: World, queue: number[], touched: Set<string>): void {
  let head = 0;
  while (head < queue.length) {
    const x = queue[head++];
    const y = queue[head++];
    const z = queue[head++];
    const curBlk = world.getBlockLight(x, y, z);
    if (curBlk <= 1) continue;

    for (let d = 0; d < 6; d++) {
      const nx = x + DIRS[d][0];
      const ny = y + DIRS[d][1];
      const nz = z + DIRS[d][2];
      if (ny < 0 || ny >= WORLD_HEIGHT) continue;
      if (!world.hasChunk(worldToChunkCoord(nx), worldToChunkCoord(nz))) continue;

      const nId = world.getBlock(nx, ny, nz);
      const op = getOpacity(nId);
      if (op >= MAX_LIGHT) continue;

      const nextBlk = curBlk - Math.max(1, op);
      if (nextBlk > world.getBlockLight(nx, ny, nz)) {
        world.setBlockLight(nx, ny, nz, nextBlk);
        markTouched(world, touched, nx, nz);
        if (nextBlk > 1) {
          queue.push(nx, ny, nz);
        }
      }
    }
  }
}

/**
 * Recomputes sky & block light across all currently loaded chunks in a World.
 * Ideal for unit tests, initial multi-chunk setups, and save loading.
 */
export function recomputeWorldLighting(world: World): void {
  const skyQ: number[] = [];
  const blockQ: number[] = [];
  const touched = new Set<string>();

  for (const chunk of world.getLoadedChunks()) {
    chunk.light.fill(0);
    const baseX = chunk.cx * CHUNK_SIZE;
    const baseZ = chunk.cz * CHUNK_SIZE;

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        let sky = MAX_LIGHT;
        for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
          const id = chunk.getBlock(lx, y, lz);
          const op = getOpacity(id);
          const emit = getEmission(id);

          if (emit > 0) {
            chunk.setBlockLight(lx, y, lz, emit);
            blockQ.push(baseX + lx, y, baseZ + lz);
          }

          if (sky > 0) {
            if (op >= MAX_LIGHT) {
              sky = 0;
            } else {
              if (op > 0) sky = Math.max(0, sky - op);
              if (sky > 0) {
                chunk.setSkyLight(lx, y, lz, sky);
                skyQ.push(baseX + lx, y, baseZ + lz);
              }
            }
          }
        }
      }
    }
    chunk.lightInitialized = true;
    chunk.dirty = true;
  }

  floodSkyLight(world, skyQ, touched);
  floodBlockLight(world, blockQ, touched);
  emitDirtyTouched(world, touched);
}

/**
 * Exchanges boundary sky/block light between chunk (cx, cz) and its loaded 4 neighbors.
 */
export function propagateCrossChunkLight(world: World, cx: number, cz: number): void {
  const chunk = world.getChunk(cx, cz);
  if (!chunk) return;
  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;
  const skyQ: number[] = [];
  const blockQ: number[] = [];
  const touched = new Set<string>();

  const seedEdge = (wx: number, wz: number): void => {
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      if (world.getSkyLight(wx, y, wz) > 1) skyQ.push(wx, y, wz);
      if (world.getBlockLight(wx, y, wz) > 1) blockQ.push(wx, y, wz);
    }
  };

  // Seed this chunk's border columns + adjacent neighbor border columns
  for (let i = 0; i < CHUNK_SIZE; i++) {
    seedEdge(baseX, baseZ + i);
    seedEdge(baseX + CHUNK_SIZE - 1, baseZ + i);
    seedEdge(baseX + i, baseZ);
    seedEdge(baseX + i, baseZ + CHUNK_SIZE - 1);

    if (world.hasChunk(cx - 1, cz)) seedEdge(baseX - 1, baseZ + i);
    if (world.hasChunk(cx + 1, cz)) seedEdge(baseX + CHUNK_SIZE, baseZ + i);
    if (world.hasChunk(cx, cz - 1)) seedEdge(baseX + i, baseZ - 1);
    if (world.hasChunk(cx, cz + 1)) seedEdge(baseX + i, baseZ + CHUNK_SIZE);
  }

  floodSkyLight(world, skyQ, touched);
  floodBlockLight(world, blockQ, touched);
  emitDirtyTouched(world, touched);
}

/**
 * Incrementally updates both sky light and block light after a single voxel changes from oldId -> newId.
 */
export function updateLightingAt(
  world: World,
  x: number,
  y: number,
  z: number,
  oldId: BlockId,
  newId: BlockId
): void {
  if (y < 0 || y >= WORLD_HEIGHT) return;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  if (!world.hasChunk(worldToChunkCoord(ix), worldToChunkCoord(iz))) return;

  const touched = new Set<string>();
  const oldOpacity = getOpacity(oldId);
  const newOpacity = getOpacity(newId);
  const oldEmit = getEmission(oldId);
  const newEmit = getEmission(newId);

  // --- 1. Incremental Sky Light ---
  const skyAddQ: number[] = [];
  if (newOpacity > oldOpacity) {
    // Block became more opaque: remove sky light at (ix, iy, iz) and any cells fed by it
    const curSky = world.getSkyLight(ix, iy, iz);
    if (curSky > 0) {
      const remQ: number[] = [ix, iy, iz, curSky];
      world.setSkyLight(ix, iy, iz, 0);
      markTouched(world, touched, ix, iz);

      let head = 0;
      while (head < remQ.length) {
        const rx = remQ[head++];
        const ry = remQ[head++];
        const rz = remQ[head++];
        const oldVal = remQ[head++];

        for (let d = 0; d < 6; d++) {
          const nx = rx + DIRS[d][0];
          const ny = ry + DIRS[d][1];
          const nz = rz + DIRS[d][2];
          if (ny < 0 || ny >= WORLD_HEIGHT) continue;
          if (!world.hasChunk(worldToChunkCoord(nx), worldToChunkCoord(nz))) continue;

          const nVal = world.getSkyLight(nx, ny, nz);
          if (nVal === 0) continue;

          // Clear direct sunlight column below (d === 3, oldVal === 15, nVal === 15) OR strictly lower decayed cells
          if ((d === 3 && oldVal === MAX_LIGHT && nVal === MAX_LIGHT) || nVal < oldVal) {
            world.setSkyLight(nx, ny, nz, 0);
            markTouched(world, touched, nx, nz);
            remQ.push(nx, ny, nz, nVal);
          } else if (nVal >= oldVal) {
            skyAddQ.push(nx, ny, nz);
          }
        }
      }

      // If new block is translucent (e.g. leaves/water, opacity 1..14), re-seed from neighbors
      if (newOpacity < MAX_LIGHT) {
        for (let d = 0; d < 6; d++) {
          const nx = ix + DIRS[d][0];
          const ny = iy + DIRS[d][1];
          const nz = iz + DIRS[d][2];
          if (ny >= 0 && ny < WORLD_HEIGHT && world.getSkyLight(nx, ny, nz) > 0) {
            skyAddQ.push(nx, ny, nz);
          }
        }
      }
      floodSkyLight(world, skyAddQ, touched);
    }
  } else if (newOpacity < oldOpacity) {
    // Block became more transparent (e.g. broken): pull light from above and all 6 neighbors
    const aboveSky = iy + 1 >= WORLD_HEIGHT ? MAX_LIGHT : world.getSkyLight(ix, iy + 1, iz);
    if (aboveSky === MAX_LIGHT && newOpacity === 0) {
      // Direct sky column opens straight down!
      let cy = iy;
      let sky = MAX_LIGHT;
      while (cy >= 0 && sky > 0) {
        const op = getOpacity(world.getBlock(ix, cy, iz));
        if (op >= MAX_LIGHT) break;
        if (op > 0) sky = Math.max(0, sky - op);
        if (sky > world.getSkyLight(ix, cy, iz)) {
          world.setSkyLight(ix, cy, iz, sky);
          markTouched(world, touched, ix, iz);
          skyAddQ.push(ix, cy, iz);
        }
        cy--;
      }
    }

    // Seed from all 6 neighbors so side sky light floods into newly dug wall/tunnel
    for (let d = 0; d < 6; d++) {
      const nx = ix + DIRS[d][0];
      const ny = iy + DIRS[d][1];
      const nz = iz + DIRS[d][2];
      if (ny < 0 || ny >= WORLD_HEIGHT) continue;
      if (world.getSkyLight(nx, ny, nz) > 0) {
        skyAddQ.push(nx, ny, nz);
      }
    }
    floodSkyLight(world, skyAddQ, touched);
  }

  // --- 2. Incremental Block Light ---
  const blkAddQ: number[] = [];
  const curBlk = world.getBlockLight(ix, iy, iz);
  const needRemoveBlk = (oldEmit > newEmit && curBlk > newEmit) || (newOpacity >= MAX_LIGHT && curBlk > 0 && newEmit === 0);

  if (needRemoveBlk) {
    const remQ: number[] = [ix, iy, iz, curBlk];
    world.setBlockLight(ix, iy, iz, 0);
    markTouched(world, touched, ix, iz);

    let head = 0;
    while (head < remQ.length) {
      const rx = remQ[head++];
      const ry = remQ[head++];
      const rz = remQ[head++];
      const oldVal = remQ[head++];

      for (let d = 0; d < 6; d++) {
        const nx = rx + DIRS[d][0];
        const ny = ry + DIRS[d][1];
        const nz = rz + DIRS[d][2];
        if (ny < 0 || ny >= WORLD_HEIGHT) continue;
        if (!world.hasChunk(worldToChunkCoord(nx), worldToChunkCoord(nz))) continue;

        const nVal = world.getBlockLight(nx, ny, nz);
        if (nVal === 0) continue;

        const nEmit = getEmission(world.getBlock(nx, ny, nz));
        if (nVal < oldVal && nEmit === 0) {
          world.setBlockLight(nx, ny, nz, 0);
          markTouched(world, touched, nx, nz);
          remQ.push(nx, ny, nz, nVal);
        } else {
          // Another light source or higher-lit neighbor re-seeds boundary
          blkAddQ.push(nx, ny, nz);
        }
      }
    }
  }

  if (newEmit > 0) {
    if (newEmit > world.getBlockLight(ix, iy, iz)) {
      world.setBlockLight(ix, iy, iz, newEmit);
      markTouched(world, touched, ix, iz);
    }
    blkAddQ.push(ix, iy, iz);
  } else if (newOpacity < oldOpacity) {
    // Opened wall may admit nearby torchlight
    for (let d = 0; d < 6; d++) {
      const nx = ix + DIRS[d][0];
      const ny = iy + DIRS[d][1];
      const nz = iz + DIRS[d][2];
      if (ny >= 0 && ny < WORLD_HEIGHT && world.getBlockLight(nx, ny, nz) > 1) {
        blkAddQ.push(nx, ny, nz);
      }
    }
  }

  if (blkAddQ.length > 0) {
    floodBlockLight(world, blkAddQ, touched);
  }

  emitDirtyTouched(world, touched);
}
