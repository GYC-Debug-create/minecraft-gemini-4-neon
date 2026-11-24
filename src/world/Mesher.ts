import { CHUNK_SIZE, WORLD_HEIGHT } from '../config/constants';
import { BlockId, BlockRegistry } from '../registry/blocks';
import { getTileUV, type TileUV } from '../registry/textures';
import type { IWorld } from './World';
import type { ChunkMeshData, MeshBuffers, NeighborSlices } from './worker/protocol';

const SLICE_SIZE = WORLD_HEIGHT * CHUNK_SIZE; // 128 * 16 = 2048
const AO_CURVE = [1.0, 0.84, 0.68, 0.5] as const;

const WATER_TOP_HEIGHT = 0.88;
const DOOR_THICKNESS = 0.18;
const LADDER_INSET = 0.06;
const TORCH_HALF_WIDTH = 0.09; // width 0.18
const TORCH_HEIGHT = 0.65;

// Precomputed flat block property tables for zero-allocation hot-loop lookups
const ALL_BLOCKS = BlockRegistry.all();
let maxBlockId = 0;
for (const def of ALL_BLOCKS) {
  if (def.id > maxBlockId) maxBlockId = def.id;
}
const TABLE_SIZE = maxBlockId + 1;

const IS_OPAQUE_FULL = new Uint8Array(TABLE_SIZE);
const IS_LIGHT_OPAQUE = new Uint8Array(TABLE_SIZE);
const IS_TRANSPARENT = new Uint8Array(TABLE_SIZE);
const IS_TRANSLUCENT = new Uint8Array(TABLE_SIZE);
const IS_CUTOUT = new Uint8Array(TABLE_SIZE);
const IS_CROSS = new Uint8Array(TABLE_SIZE);
const BLOCK_HEIGHT = new Float32Array(TABLE_SIZE);

const FALLBACK_UV: TileUV = getTileUV('stone');
const UV_TOP: TileUV[] = new Array<TileUV>(TABLE_SIZE).fill(FALLBACK_UV);
const UV_BOTTOM: TileUV[] = new Array<TileUV>(TABLE_SIZE).fill(FALLBACK_UV);
const UV_SIDE: TileUV[] = new Array<TileUV>(TABLE_SIZE).fill(FALLBACK_UV);

for (const def of ALL_BLOCKS) {
  const id = def.id;
  IS_OPAQUE_FULL[id] = !def.transparent && def.height >= 1.0 ? 1 : 0;
  IS_LIGHT_OPAQUE[id] = def.lightOpacity >= 15 ? 1 : 0;
  IS_TRANSPARENT[id] = def.transparent ? 1 : 0;
  IS_TRANSLUCENT[id] = def.translucent ? 1 : 0;
  IS_CUTOUT[id] = def.cutout ? 1 : 0;
  IS_CROSS[id] = def.crossBillboard ? 1 : 0;
  BLOCK_HEIGHT[id] = def.height;
  UV_TOP[id] = getTileUV(def.textures.top);
  UV_BOTTOM[id] = getTileUV(def.textures.bottom);
  UV_SIDE[id] = getTileUV(def.textures.side);
}

interface CornerSpec {
  dx: number;
  dy: number;
  dz: number;
  s1x: number;
  s1y: number;
  s1z: number;
  s2x: number;
  s2y: number;
  s2z: number;
  cx: number;
  cy: number;
  cz: number;
  uMax: 0 | 1;
  vMax: 0 | 1;
}

interface FaceSpec {
  readonly id: number; // 0=+Y, 1=-Y, 2=+Z, 3=-Z, 4=+X, 5=-X
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly shade: number;
  readonly isSide: boolean;
  readonly corners: readonly [CornerSpec, CornerSpec, CornerSpec, CornerSpec];
}

// All 6 cube faces verified for strictly CCW winding against outward normals in Three.js RH coordinates
const FACES: readonly FaceSpec[] = [
  // 0: +Y (Top)
  {
    id: 0,
    nx: 0,
    ny: 1,
    nz: 0,
    shade: 1.0,
    isSide: false,
    corners: [
      { dx: 0, dy: 1, dz: 1, s1x: -1, s1y: 0, s1z: 0, s2x: 0, s2y: 0, s2z: 1, cx: -1, cy: 0, cz: 1, uMax: 0, vMax: 0 },
      { dx: 1, dy: 1, dz: 1, s1x: 1, s1y: 0, s1z: 0, s2x: 0, s2y: 0, s2z: 1, cx: 1, cy: 0, cz: 1, uMax: 1, vMax: 0 },
      { dx: 1, dy: 1, dz: 0, s1x: 1, s1y: 0, s1z: 0, s2x: 0, s2y: 0, s2z: -1, cx: 1, cy: 0, cz: -1, uMax: 1, vMax: 1 },
      { dx: 0, dy: 1, dz: 0, s1x: -1, s1y: 0, s1z: 0, s2x: 0, s2y: 0, s2z: -1, cx: -1, cy: 0, cz: -1, uMax: 0, vMax: 1 },
    ],
  },
  // 1: -Y (Bottom)
  {
    id: 1,
    nx: 0,
    ny: -1,
    nz: 0,
    shade: 0.6,
    isSide: false,
    corners: [
      { dx: 0, dy: 0, dz: 0, s1x: -1, s1y: 0, s1z: 0, s2x: 0, s2y: 0, s2z: -1, cx: -1, cy: 0, cz: -1, uMax: 0, vMax: 0 },
      { dx: 1, dy: 0, dz: 0, s1x: 1, s1y: 0, s1z: 0, s2x: 0, s2y: 0, s2z: -1, cx: 1, cy: 0, cz: -1, uMax: 1, vMax: 0 },
      { dx: 1, dy: 0, dz: 1, s1x: 1, s1y: 0, s1z: 0, s2x: 0, s2y: 0, s2z: 1, cx: 1, cy: 0, cz: 1, uMax: 1, vMax: 1 },
      { dx: 0, dy: 0, dz: 1, s1x: -1, s1y: 0, s1z: 0, s2x: 0, s2y: 0, s2z: 1, cx: -1, cy: 0, cz: 1, uMax: 0, vMax: 1 },
    ],
  },
  // 2: +Z (South)
  {
    id: 2,
    nx: 0,
    ny: 0,
    nz: 1,
    shade: 0.9,
    isSide: true,
    corners: [
      { dx: 0, dy: 0, dz: 1, s1x: -1, s1y: 0, s1z: 0, s2x: 0, s2y: -1, s2z: 0, cx: -1, cy: -1, cz: 0, uMax: 0, vMax: 0 },
      { dx: 1, dy: 0, dz: 1, s1x: 1, s1y: 0, s1z: 0, s2x: 0, s2y: -1, s2z: 0, cx: 1, cy: -1, cz: 0, uMax: 1, vMax: 0 },
      { dx: 1, dy: 1, dz: 1, s1x: 1, s1y: 0, s1z: 0, s2x: 0, s2y: 1, s2z: 0, cx: 1, cy: 1, cz: 0, uMax: 1, vMax: 1 },
      { dx: 0, dy: 1, dz: 1, s1x: -1, s1y: 0, s1z: 0, s2x: 0, s2y: 1, s2z: 0, cx: -1, cy: 1, cz: 0, uMax: 0, vMax: 1 },
    ],
  },
  // 3: -Z (North)
  {
    id: 3,
    nx: 0,
    ny: 0,
    nz: -1,
    shade: 0.9,
    isSide: true,
    corners: [
      { dx: 1, dy: 0, dz: 0, s1x: 1, s1y: 0, s1z: 0, s2x: 0, s2y: -1, s2z: 0, cx: 1, cy: -1, cz: 0, uMax: 0, vMax: 0 },
      { dx: 0, dy: 0, dz: 0, s1x: -1, s1y: 0, s1z: 0, s2x: 0, s2y: -1, s2z: 0, cx: -1, cy: -1, cz: 0, uMax: 1, vMax: 0 },
      { dx: 0, dy: 1, dz: 0, s1x: -1, s1y: 0, s1z: 0, s2x: 0, s2y: 1, s2z: 0, cx: -1, cy: 1, cz: 0, uMax: 1, vMax: 1 },
      { dx: 1, dy: 1, dz: 0, s1x: 1, s1y: 0, s1z: 0, s2x: 0, s2y: 1, s2z: 0, cx: 1, cy: 1, cz: 0, uMax: 0, vMax: 1 },
    ],
  },
  // 4: +X (East)
  {
    id: 4,
    nx: 1,
    ny: 0,
    nz: 0,
    shade: 0.82,
    isSide: true,
    corners: [
      { dx: 1, dy: 0, dz: 1, s1x: 0, s1y: 0, s1z: 1, s2x: 0, s2y: -1, s2z: 0, cx: 0, cy: -1, cz: 1, uMax: 0, vMax: 0 },
      { dx: 1, dy: 0, dz: 0, s1x: 0, s1y: 0, s1z: -1, s2x: 0, s2y: -1, s2z: 0, cx: 0, cy: -1, cz: -1, uMax: 1, vMax: 0 },
      { dx: 1, dy: 1, dz: 0, s1x: 0, s1y: 0, s1z: -1, s2x: 0, s2y: 1, s2z: 0, cx: 0, cy: 1, cz: -1, uMax: 1, vMax: 1 },
      { dx: 1, dy: 1, dz: 1, s1x: 0, s1y: 0, s1z: 1, s2x: 0, s2y: 1, s2z: 0, cx: 0, cy: 1, cz: 1, uMax: 0, vMax: 1 },
    ],
  },
  // 5: -X (West)
  {
    id: 5,
    nx: -1,
    ny: 0,
    nz: 0,
    shade: 0.82,
    isSide: true,
    corners: [
      { dx: 0, dy: 0, dz: 0, s1x: 0, s1y: 0, s1z: -1, s2x: 0, s2y: -1, s2z: 0, cx: 0, cy: -1, cz: -1, uMax: 0, vMax: 0 },
      { dx: 0, dy: 0, dz: 1, s1x: 0, s1y: 0, s1z: 1, s2x: 0, s2y: -1, s2z: 0, cx: 0, cy: -1, cz: 1, uMax: 1, vMax: 0 },
      { dx: 0, dy: 1, dz: 1, s1x: 0, s1y: 0, s1z: 1, s2x: 0, s2y: 1, s2z: 0, cx: 0, cy: 1, cz: 1, uMax: 1, vMax: 1 },
      { dx: 0, dy: 1, dz: 0, s1x: 0, s1y: 0, s1z: -1, s2x: 0, s2y: 1, s2z: 0, cx: 0, cy: 1, cz: -1, uMax: 0, vMax: 1 },
    ],
  },
];

/**
 * Dynamically-growing typed array accumulator for chunk geometry buckets.
 * Reused across buildChunkMesh invocations to minimize GC churn; `.build()` always returns
 * freshly-sliced, tightly-sized transferable buffers.
 */
class GeometryBuilder {
  private positions: Float32Array;
  private normals: Float32Array;
  private uvs: Float32Array;
  private colors: Float32Array;
  private indices: Uint32Array;
  private vertCap: number;
  private idxCap: number;
  vertCount = 0;
  idxCount = 0;

  constructor(initialQuads: number) {
    this.vertCap = initialQuads * 4;
    this.idxCap = initialQuads * 6;
    this.positions = new Float32Array(this.vertCap * 3);
    this.normals = new Float32Array(this.vertCap * 3);
    this.uvs = new Float32Array(this.vertCap * 2);
    this.colors = new Float32Array(this.vertCap * 3);
    this.indices = new Uint32Array(this.idxCap);
  }

  reset(): void {
    this.vertCount = 0;
    this.idxCount = 0;
  }

  private ensureCapacity(addVerts: number, addIndices: number): void {
    if (this.vertCount + addVerts > this.vertCap) {
      let newCap = Math.max(this.vertCap * 2, this.vertCount + addVerts);
      if (newCap < 256) newCap = 256;
      const pos = new Float32Array(newCap * 3);
      pos.set(this.positions.subarray(0, this.vertCount * 3));
      this.positions = pos;

      const norm = new Float32Array(newCap * 3);
      norm.set(this.normals.subarray(0, this.vertCount * 3));
      this.normals = norm;

      const uv = new Float32Array(newCap * 2);
      uv.set(this.uvs.subarray(0, this.vertCount * 2));
      this.uvs = uv;

      const col = new Float32Array(newCap * 3);
      col.set(this.colors.subarray(0, this.vertCount * 3));
      this.colors = col;

      this.vertCap = newCap;
    }

    if (this.idxCount + addIndices > this.idxCap) {
      let newCap = Math.max(this.idxCap * 2, this.idxCount + addIndices);
      if (newCap < 384) newCap = 384;
      const idx = new Uint32Array(newCap);
      idx.set(this.indices.subarray(0, this.idxCount));
      this.indices = idx;
      this.idxCap = newCap;
    }
  }

  pushVertex(
    px: number,
    py: number,
    pz: number,
    nx: number,
    ny: number,
    nz: number,
    u: number,
    v: number,
    r: number,
    g: number,
    b: number
  ): void {
    const v3 = this.vertCount * 3;
    const v2 = this.vertCount * 2;
    this.positions[v3] = px;
    this.positions[v3 + 1] = py;
    this.positions[v3 + 2] = pz;
    this.normals[v3] = nx;
    this.normals[v3 + 1] = ny;
    this.normals[v3 + 2] = nz;
    this.uvs[v2] = u;
    this.uvs[v2 + 1] = v;
    this.colors[v3] = r;
    this.colors[v3 + 1] = g;
    this.colors[v3 + 2] = b;
    this.vertCount++;
  }

  pushQuad(
    x0: number,
    y0: number,
    z0: number,
    u0: number,
    v0: number,
    r0: number,
    g0: number,
    b0: number,
    x1: number,
    y1: number,
    z1: number,
    u1: number,
    v1: number,
    r1: number,
    g1: number,
    b1: number,
    x2: number,
    y2: number,
    z2: number,
    u2: number,
    v2: number,
    r2: number,
    g2: number,
    b2: number,
    x3: number,
    y3: number,
    z3: number,
    u3: number,
    v3: number,
    r3: number,
    g3: number,
    b3: number,
    nx: number,
    ny: number,
    nz: number,
    flipDiag: boolean
  ): void {
    this.ensureCapacity(4, 6);
    const base = this.vertCount;
    this.pushVertex(x0, y0, z0, nx, ny, nz, u0, v0, r0, g0, b0);
    this.pushVertex(x1, y1, z1, nx, ny, nz, u1, v1, r1, g1, b1);
    this.pushVertex(x2, y2, z2, nx, ny, nz, u2, v2, r2, g2, b2);
    this.pushVertex(x3, y3, z3, nx, ny, nz, u3, v3, r3, g3, b3);

    const i = this.idxCount;
    if (flipDiag) {
      this.indices[i] = base + 1;
      this.indices[i + 1] = base + 2;
      this.indices[i + 2] = base + 3;
      this.indices[i + 3] = base + 1;
      this.indices[i + 4] = base + 3;
      this.indices[i + 5] = base;
    } else {
      this.indices[i] = base;
      this.indices[i + 1] = base + 1;
      this.indices[i + 2] = base + 2;
      this.indices[i + 3] = base;
      this.indices[i + 4] = base + 2;
      this.indices[i + 5] = base + 3;
    }
    this.idxCount += 6;
  }

  pushUniformQuad(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
    x3: number,
    y3: number,
    z3: number,
    nx: number,
    ny: number,
    nz: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    sky: number,
    blk: number,
    shade: number
  ): void {
    this.pushQuad(
      x0, y0, z0, u0, v0, sky, blk, shade,
      x1, y1, z1, u1, v0, sky, blk, shade,
      x2, y2, z2, u1, v1, sky, blk, shade,
      x3, y3, z3, u0, v1, sky, blk, shade,
      nx, ny, nz,
      false
    );
  }

  build(): MeshBuffers {
    if (this.vertCount === 0) {
      return {
        positions: new Float32Array(0),
        normals: new Float32Array(0),
        uvs: new Float32Array(0),
        colors: new Float32Array(0),
        indices: new Uint32Array(0),
      };
    }
    return {
      positions: this.positions.slice(0, this.vertCount * 3),
      normals: this.normals.slice(0, this.vertCount * 3),
      uvs: this.uvs.slice(0, this.vertCount * 2),
      colors: this.colors.slice(0, this.vertCount * 3),
      indices: this.indices.slice(0, this.idxCount),
    };
  }
}

const opaqueBuilder = new GeometryBuilder(2048);
const cutoutBuilder = new GeometryBuilder(512);
const translucentBuilder = new GeometryBuilder(256);

/**
 * Extracts 1-voxel edge slices (2048 bytes each: `(y << 4) | localEdge`) for loaded
 * +X, -X, +Z, -Z neighbor chunks so meshing produces seamless cross-chunk culling, AO, and lighting.
 */
export function extractNeighborSlices(world: IWorld, cx: number, cz: number): NeighborSlices {
  const slices: NeighborSlices = {};

  const pxChunk = world.getChunk(cx + 1, cz);
  if (pxChunk) {
    const b = new Uint8Array(SLICE_SIZE);
    const l = new Uint8Array(SLICE_SIZE);
    const srcB = pxChunk.blocks;
    const srcL = pxChunk.light;
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      const dstRow = y << 4;
      const srcY = y << 8;
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const srcIdx = srcY | (lz << 4); // lx = 0
        b[dstRow | lz] = srcB[srcIdx];
        l[dstRow | lz] = srcL[srcIdx];
      }
    }
    slices.pxBlocks = b;
    slices.pxLight = l;
  }

  const nxChunk = world.getChunk(cx - 1, cz);
  if (nxChunk) {
    const b = new Uint8Array(SLICE_SIZE);
    const l = new Uint8Array(SLICE_SIZE);
    const srcB = nxChunk.blocks;
    const srcL = nxChunk.light;
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      const dstRow = y << 4;
      const srcY = y << 8;
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const srcIdx = srcY | (lz << 4) | 15; // lx = 15
        b[dstRow | lz] = srcB[srcIdx];
        l[dstRow | lz] = srcL[srcIdx];
      }
    }
    slices.nxBlocks = b;
    slices.nxLight = l;
  }

  const pzChunk = world.getChunk(cx, cz + 1);
  if (pzChunk) {
    const b = new Uint8Array(SLICE_SIZE);
    const l = new Uint8Array(SLICE_SIZE);
    const srcB = pzChunk.blocks;
    const srcL = pzChunk.light;
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      const dstRow = y << 4;
      const srcY = y << 8; // lz = 0
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const srcIdx = srcY | lx;
        b[dstRow | lx] = srcB[srcIdx];
        l[dstRow | lx] = srcL[srcIdx];
      }
    }
    slices.pzBlocks = b;
    slices.pzLight = l;
  }

  const nzChunk = world.getChunk(cx, cz - 1);
  if (nzChunk) {
    const b = new Uint8Array(SLICE_SIZE);
    const l = new Uint8Array(SLICE_SIZE);
    const srcB = nzChunk.blocks;
    const srcL = nzChunk.light;
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      const dstRow = y << 4;
      const srcY = (y << 8) | (15 << 4); // lz = 15
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const srcIdx = srcY | lx;
        b[dstRow | lx] = srcB[srcIdx];
        l[dstRow | lx] = srcL[srcIdx];
      }
    }
    slices.nzBlocks = b;
    slices.nzLight = l;
  }

  return slices;
}

function emitBox(
  builder: GeometryBuilder,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  uvTop: TileUV,
  uvBottom: TileUV,
  uvFrontBack: TileUV,
  uvLeftRight: TileUV,
  sky: number,
  blk: number,
  emitTop: boolean,
  emitBottom: boolean,
  sideShadeTop = 1.0,
  sideShadeZ = 0.9,
  sideShadeX = 0.82,
  sideShadeBottom = 0.6
): void {
  // +Y
  if (emitTop) {
    builder.pushUniformQuad(
      x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0,
      0, 1, 0,
      uvTop.u0, uvTop.v0, uvTop.u1, uvTop.v1,
      sky, blk, sideShadeTop
    );
  }
  // -Y
  if (emitBottom) {
    builder.pushUniformQuad(
      x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1,
      0, -1, 0,
      uvBottom.u0, uvBottom.v0, uvBottom.u1, uvBottom.v1,
      sky, blk, sideShadeBottom
    );
  }
  // +Z
  builder.pushUniformQuad(
    x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
    0, 0, 1,
    uvFrontBack.u0, uvFrontBack.v0, uvFrontBack.u1, uvFrontBack.v1,
    sky, blk, sideShadeZ
  );
  // -Z
  builder.pushUniformQuad(
    x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0,
    0, 0, -1,
    uvFrontBack.u0, uvFrontBack.v0, uvFrontBack.u1, uvFrontBack.v1,
    sky, blk, sideShadeZ
  );
  // +X
  builder.pushUniformQuad(
    x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1,
    1, 0, 0,
    uvLeftRight.u0, uvLeftRight.v0, uvLeftRight.u1, uvLeftRight.v1,
    sky, blk, sideShadeX
  );
  // -X
  builder.pushUniformQuad(
    x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0,
    -1, 0, 0,
    uvLeftRight.u0, uvLeftRight.v0, uvLeftRight.u1, uvLeftRight.v1,
    sky, blk, sideShadeX
  );
}

/**
 * Builds opaque, cutout, and translucent geometry buffers for a chunk in chunk-local space
 * `[0..16, 0..128, 0..16]` with face culling, smooth 4-corner lighting, and vertex AO.
 */
export function buildChunkMesh(
  cx: number,
  cz: number,
  blocks: Uint8Array,
  light: Uint8Array,
  meta: Uint8Array,
  neighbors?: NeighborSlices
): ChunkMeshData {
  void cx;
  void cz;
  const t0 = performance.now();

  opaqueBuilder.reset();
  cutoutBuilder.reset();
  translucentBuilder.reset();

  const pxBlocks = neighbors?.pxBlocks;
  const nxBlocks = neighbors?.nxBlocks;
  const pzBlocks = neighbors?.pzBlocks;
  const nzBlocks = neighbors?.nzBlocks;
  const pxLight = neighbors?.pxLight;
  const nxLight = neighbors?.nxLight;
  const pzLight = neighbors?.pzLight;
  const nzLight = neighbors?.nzLight;

  const sampleBlock = (x: number, y: number, z: number): number => {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    if (x >= 0 && x < CHUNK_SIZE) {
      if (z >= 0 && z < CHUNK_SIZE) {
        return blocks[(y << 8) | (z << 4) | x];
      }
      if (z === CHUNK_SIZE) return pzBlocks ? pzBlocks[(y << 4) | x] : 0;
      if (z === -1) return nzBlocks ? nzBlocks[(y << 4) | x] : 0;
      return 0;
    }
    if (z >= 0 && z < CHUNK_SIZE) {
      if (x === CHUNK_SIZE) return pxBlocks ? pxBlocks[(y << 4) | z] : 0;
      if (x === -1) return nxBlocks ? nxBlocks[(y << 4) | z] : 0;
    }
    return 0;
  };

  const sampleLight = (x: number, y: number, z: number): number => {
    if (y >= WORLD_HEIGHT) return 0xf0;
    if (y < 0) return 0x00;

    if (x >= 0 && x < CHUNK_SIZE) {
      if (z >= 0 && z < CHUNK_SIZE) {
        return light[(y << 8) | (z << 4) | x];
      }
      if (z === CHUNK_SIZE) {
        if (pzLight) return pzLight[(y << 4) | x];
        const idx = (y << 8) | (15 << 4) | x;
        return IS_LIGHT_OPAQUE[blocks[idx]] ? 0xf0 : light[idx];
      }
      if (z === -1) {
        if (nzLight) return nzLight[(y << 4) | x];
        const idx = (y << 8) | x;
        return IS_LIGHT_OPAQUE[blocks[idx]] ? 0xf0 : light[idx];
      }
      return 0xf0;
    }

    if (z >= 0 && z < CHUNK_SIZE) {
      if (x === CHUNK_SIZE) {
        if (pxLight) return pxLight[(y << 4) | z];
        const idx = (y << 8) | (z << 4) | 15;
        return IS_LIGHT_OPAQUE[blocks[idx]] ? 0xf0 : light[idx];
      }
      if (x === -1) {
        if (nxLight) return nxLight[(y << 4) | z];
        const idx = (y << 8) | (z << 4);
        return IS_LIGHT_OPAQUE[blocks[idx]] ? 0xf0 : light[idx];
      }
      return 0xf0;
    }

    // Diagonal corner where both X and Z are outside [0..15]:
    // inherit from adjacent cardinal slice (or corner interior cell) to prevent cave skylight leaks.
    const cxEdge = x < 0 ? 0 : 15;
    const czEdge = z < 0 ? 0 : 15;
    const xSliceL = x < 0 ? nxLight : pxLight;
    const xSliceB = x < 0 ? nxBlocks : pxBlocks;
    const zSliceL = z < 0 ? nzLight : pzLight;
    const zSliceB = z < 0 ? nzBlocks : pzBlocks;

    if (xSliceL && (!xSliceB || !IS_LIGHT_OPAQUE[xSliceB[(y << 4) | czEdge]])) {
      return xSliceL[(y << 4) | czEdge];
    }
    if (zSliceL && (!zSliceB || !IS_LIGHT_OPAQUE[zSliceB[(y << 4) | cxEdge]])) {
      return zSliceL[(y << 4) | cxEdge];
    }
    const cornerIdx = (y << 8) | (czEdge << 4) | cxEdge;
    return IS_LIGHT_OPAQUE[blocks[cornerIdx]] ? 0xf0 : light[cornerIdx];
  };

  // Scratch arrays for 4 corners of the currently emitted cube face (no per-face heap allocs)
  const vSky = new Float32Array(4);
  const vBlk = new Float32Array(4);
  const vAo = new Float32Array(4);
  const vColB = new Float32Array(4);

  const emitCubeFace = (
    builder: GeometryBuilder,
    face: FaceSpec,
    x: number,
    y0: number,
    y1: number,
    z: number,
    sampleOx: number,
    sampleOy: number,
    sampleOz: number,
    faceLightByte: number,
    uv: TileUV,
    vBot: number,
    vTop: number
  ): void => {
    const faceSky = (faceLightByte >> 4) & 0x0f;
    const faceBlk = faceLightByte & 0x0f;
    const corners = face.corners;
    const faceShade = face.shade;

    for (let i = 0; i < 4; i++) {
      const c = corners[i];
      const s1x = sampleOx + c.s1x;
      const s1y = sampleOy + c.s1y;
      const s1z = sampleOz + c.s1z;
      const s2x = sampleOx + c.s2x;
      const s2y = sampleOy + c.s2y;
      const s2z = sampleOz + c.s2z;
      const crx = sampleOx + c.cx;
      const cry = sampleOy + c.cy;
      const crz = sampleOz + c.cz;

      const b1 = sampleBlock(s1x, s1y, s1z);
      const b2 = sampleBlock(s2x, s2y, s2z);
      const bc = sampleBlock(crx, cry, crz);

      const s1Occ = IS_OPAQUE_FULL[b1];
      const s2Occ = IS_OPAQUE_FULL[b2];
      const cOcc = IS_OPAQUE_FULL[bc];

      const bothSidesOcc = s1Occ !== 0 && s2Occ !== 0;
      const occluders = bothSidesOcc ? 3 : s1Occ + s2Occ + cOcc;
      const ao = AO_CURVE[occluders];

      let skySum = faceSky;
      let blkSum = faceBlk;
      let count = 1;

      if (IS_LIGHT_OPAQUE[b1] === 0) {
        const l1 = sampleLight(s1x, s1y, s1z);
        skySum += (l1 >> 4) & 0x0f;
        blkSum += l1 & 0x0f;
        count++;
      }
      if (IS_LIGHT_OPAQUE[b2] === 0) {
        const l2 = sampleLight(s2x, s2y, s2z);
        skySum += (l2 >> 4) & 0x0f;
        blkSum += l2 & 0x0f;
        count++;
      }
      if (!bothSidesOcc && IS_LIGHT_OPAQUE[bc] === 0) {
        const lc = sampleLight(crx, cry, crz);
        skySum += (lc >> 4) & 0x0f;
        blkSum += lc & 0x0f;
        count++;
      }

      const inv = 1 / (count * 15);
      vSky[i] = skySum * inv;
      vBlk[i] = blkSum * inv;
      vAo[i] = ao;
      vColB[i] = ao * faceShade;
    }

    // Flip quad triangulation diagonal to prevent anisotropic AO interpolation artifacts
    const diag02 = vAo[0] + vAo[2];
    const diag13 = vAo[1] + vAo[3];
    const flipDiag =
      diag02 < diag13 ||
      (diag02 === diag13 &&
        vSky[0] + vBlk[0] + vSky[2] + vBlk[2] < vSky[1] + vBlk[1] + vSky[3] + vBlk[3]);

    const c0 = corners[0];
    const c1 = corners[1];
    const c2 = corners[2];
    const c3 = corners[3];

    builder.pushQuad(
      x + c0.dx, c0.dy === 1 ? y1 : y0, z + c0.dz, c0.uMax === 1 ? uv.u1 : uv.u0, c0.vMax === 1 ? vTop : vBot, vSky[0], vBlk[0], vColB[0],
      x + c1.dx, c1.dy === 1 ? y1 : y0, z + c1.dz, c1.uMax === 1 ? uv.u1 : uv.u0, c1.vMax === 1 ? vTop : vBot, vSky[1], vBlk[1], vColB[1],
      x + c2.dx, c2.dy === 1 ? y1 : y0, z + c2.dz, c2.uMax === 1 ? uv.u1 : uv.u0, c2.vMax === 1 ? vTop : vBot, vSky[2], vBlk[2], vColB[2],
      x + c3.dx, c3.dy === 1 ? y1 : y0, z + c3.dz, c3.uMax === 1 ? uv.u1 : uv.u0, c3.vMax === 1 ? vTop : vBot, vSky[3], vBlk[3], vColB[3],
      face.nx, face.ny, face.nz,
      flipDiag
    );
  };

  for (let y = 0; y < WORLD_HEIGHT; y++) {
    const yOff = y << 8;
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const yzOff = yOff | (z << 4);
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const idx = yzOff | x;
        const id = blocks[idx];
        if (id === BlockId.Air) continue;

        // 1. Torch: crisp slender 3D centered column (width 0.18, height 0.65) in cutout bucket
        if (id === BlockId.Torch) {
          const lByte = light[idx];
          const sky = ((lByte >> 4) & 0x0f) / 15;
          const blk = Math.max((lByte & 0x0f) / 15, 14 / 15);
          const uv = UV_SIDE[id];
          const du = uv.u1 - uv.u0;
          const dv = uv.v1 - uv.v0;

          // Center 2-pixel column of 16x16 torch tile (cols 7..8, rows 2..15 = full shaft + collar + flame)
          const uMid0 = uv.u0 + du * 0.4375;
          const uMid1 = uv.u0 + du * 0.5625;
          const sideUv: TileUV = {
            u0: uMid0,
            u1: uMid1,
            v0: uv.v0,
            v1: uv.v0 + dv * 0.875,
          };
          const topUv: TileUV = {
            u0: uMid0,
            u1: uMid1,
            v0: uv.v0 + dv * 0.6875,
            v1: uv.v0 + dv * 0.8125,
          };
          const botUv: TileUV = {
            u0: uMid0,
            u1: uMid1,
            v0: uv.v0,
            v1: uv.v0 + dv * 0.125,
          };

          const belowId = sampleBlock(x, y - 1, z);
          emitBox(
            cutoutBuilder,
            x + 0.5 - TORCH_HALF_WIDTH,
            y,
            z + 0.5 - TORCH_HALF_WIDTH,
            x + 0.5 + TORCH_HALF_WIDTH,
            y + TORCH_HEIGHT,
            z + 0.5 + TORCH_HALF_WIDTH,
            topUv,
            botUv,
            sideUv,
            sideUv,
            sky,
            blk,
            true,
            IS_OPAQUE_FULL[belowId] === 0,
            1.0,
            0.96,
            0.92,
            0.7
          );
          continue;
        }

        // 2. Ladder: flat quad inset on attached solid wall in cutout bucket
        if (id === BlockId.Ladder) {
          const lByte = light[idx];
          const sky = ((lByte >> 4) & 0x0f) / 15;
          const blk = (lByte & 0x0f) / 15;
          const uv = UV_SIDE[id];
          const m = meta[idx];

          // Determine wall side: explicit meta (1=-Z, 2=+Z, 3=-X, 4=+X) or auto-detect adjacent solid wall
          let attach = m;
          if (attach < 1 || attach > 4) {
            if (IS_OPAQUE_FULL[sampleBlock(x, y, z - 1)] !== 0) attach = 1;
            else if (IS_OPAQUE_FULL[sampleBlock(x, y, z + 1)] !== 0) attach = 2;
            else if (IS_OPAQUE_FULL[sampleBlock(x - 1, y, z)] !== 0) attach = 3;
            else if (IS_OPAQUE_FULL[sampleBlock(x + 1, y, z)] !== 0) attach = 4;
            else attach = 1;
          }

          if (attach === 1) {
            const lz = z + LADDER_INSET;
            cutoutBuilder.pushUniformQuad(
              x, y, lz, x + 1, y, lz, x + 1, y + 1, lz, x, y + 1, lz,
              0, 0, 1,
              uv.u0, uv.v0, uv.u1, uv.v1,
              sky, blk, 0.9
            );
          } else if (attach === 2) {
            const lz = z + 1 - LADDER_INSET;
            cutoutBuilder.pushUniformQuad(
              x + 1, y, lz, x, y, lz, x, y + 1, lz, x + 1, y + 1, lz,
              0, 0, -1,
              uv.u0, uv.v0, uv.u1, uv.v1,
              sky, blk, 0.9
            );
          } else if (attach === 3) {
            const lx = x + LADDER_INSET;
            cutoutBuilder.pushUniformQuad(
              lx, y, z + 1, lx, y, z, lx, y + 1, z, lx, y + 1, z + 1,
              1, 0, 0,
              uv.u0, uv.v0, uv.u1, uv.v1,
              sky, blk, 0.82
            );
          } else {
            const lx = x + 1 - LADDER_INSET;
            cutoutBuilder.pushUniformQuad(
              lx, y, z, lx, y, z + 1, lx, y + 1, z + 1, lx, y + 1, z,
              -1, 0, 0,
              uv.u0, uv.v0, uv.u1, uv.v1,
              sky, blk, 0.82
            );
          }
          continue;
        }

        // 3. Timber Door (Bottom & Top): thin panel (0.18), rotated 90 deg when open ((meta & 1) === 1)
        if (id === BlockId.WoodDoorBottom || id === BlockId.WoodDoorTop) {
          const lByte = light[idx];
          const sky = ((lByte >> 4) & 0x0f) / 15;
          const blk = (lByte & 0x0f) / 15;
          const m = meta[idx];
          const isOpen = (m & 1) === 1;
          const explicitFacing = (m >> 1) & 3;

          // Match wall orientation across both top and bottom halves of a door
          const wallY =
            id === BlockId.WoodDoorTop && sampleBlock(x, y - 1, z) === BlockId.WoodDoorBottom
              ? y - 1
              : y;

          let facing = explicitFacing;
          if (facing === 0) {
            const zWall =
              IS_OPAQUE_FULL[sampleBlock(x, wallY, z - 1)] !== 0 ||
              IS_OPAQUE_FULL[sampleBlock(x, wallY, z + 1)] !== 0;
            const xWall =
              IS_OPAQUE_FULL[sampleBlock(x - 1, wallY, z)] !== 0 ||
              IS_OPAQUE_FULL[sampleBlock(x + 1, wallY, z)] !== 0;
            if (zWall && !xWall) {
              facing = 1; // Doorway runs along X; closed panel spans Z
            }
          }

          // Rotate 90 degrees when open: 0(-Z) -> 1(-X) -> 2(+Z) -> 3(+X) -> 0(-Z)
          const panelSide = (facing + (isOpen ? 1 : 0)) & 3;

          let bx0 = x;
          let bx1 = x + 1;
          let bz0 = z;
          let bz1 = z + 1;
          let wideAlongX = true;

          if (panelSide === 0) {
            bz1 = z + DOOR_THICKNESS;
            wideAlongX = true;
          } else if (panelSide === 1) {
            bx1 = x + DOOR_THICKNESS;
            wideAlongX = false;
          } else if (panelSide === 2) {
            bz0 = z + 1 - DOOR_THICKNESS;
            wideAlongX = true;
          } else {
            bx0 = x + 1 - DOOR_THICKNESS;
            wideAlongX = false;
          }

          const uv = UV_SIDE[id];
          const du = uv.u1 - uv.u0;
          const dv = uv.v1 - uv.v0;
          const thinSideUv: TileUV = {
            u0: uv.u0,
            u1: uv.u0 + du * DOOR_THICKNESS,
            v0: uv.v0,
            v1: uv.v1,
          };
          const capUv: TileUV = {
            u0: uv.u0,
            u1: uv.u1,
            v0: uv.v0,
            v1: uv.v0 + dv * DOOR_THICKNESS,
          };

          const aboveId = sampleBlock(x, y + 1, z);
          const belowId = sampleBlock(x, y - 1, z);
          const emitTop = !(id === BlockId.WoodDoorBottom && aboveId === BlockId.WoodDoorTop);
          const emitBottom = !(id === BlockId.WoodDoorTop && belowId === BlockId.WoodDoorBottom);

          emitBox(
            cutoutBuilder,
            bx0, y, bz0,
            bx1, y + 1, bz1,
            capUv,
            capUv,
            wideAlongX ? uv : thinSideUv,
            wideAlongX ? thinSideUv : uv,
            sky,
            blk,
            emitTop,
            emitBottom
          );
          continue;
        }

        // 4. Cross-billboard plants (TallGrass, Wildflowers, DryScrub, Crops) in cutout bucket
        if (IS_CROSS[id] !== 0) {
          const lByte = light[idx];
          const sky = ((lByte >> 4) & 0x0f) / 15;
          const blk = (lByte & 0x0f) / 15;
          const uv = UV_SIDE[id];

          const belowId = sampleBlock(x, y - 1, z);
          const yBase =
            belowId === BlockId.Farmland || belowId === BlockId.FarmlandWet ? y - 0.06 : y;
          const yTop = yBase + 1.0;

          const x0 = x + 0.15;
          const x1 = x + 0.85;
          const z0 = z + 0.15;
          const z1 = z + 0.85;
          const botShade = 0.86;
          const topShade = 1.0;

          // Diagonal 1: (x0, z0) -> (x1, z1)
          cutoutBuilder.pushQuad(
            x0, yBase, z0, uv.u0, uv.v0, sky, blk, botShade,
            x1, yBase, z1, uv.u1, uv.v0, sky, blk, botShade,
            x1, yTop, z1, uv.u1, uv.v1, sky, blk, topShade,
            x0, yTop, z0, uv.u0, uv.v1, sky, blk, topShade,
            0, 1, 0,
            false
          );
          // Diagonal 2: (x1, z0) -> (x0, z1)
          cutoutBuilder.pushQuad(
            x1, yBase, z0, uv.u0, uv.v0, sky, blk, botShade,
            x0, yBase, z1, uv.u1, uv.v0, sky, blk, botShade,
            x0, yTop, z1, uv.u1, uv.v1, sky, blk, topShade,
            x1, yTop, z0, uv.u0, uv.v1, sky, blk, topShade,
            0, 1, 0,
            false
          );
          continue;
        }

        // 5. Standard cube / partial-height / cutout leaves / translucent (Water, Glass, Ice)
        const isTranslucent = IS_TRANSLUCENT[id] !== 0;
        const isCutout = IS_CUTOUT[id] !== 0;
        const isWater = id === BlockId.Water;
        const builder = isTranslucent
          ? translucentBuilder
          : isCutout
            ? cutoutBuilder
            : opaqueBuilder;

        const aboveIsWater = isWater && sampleBlock(x, y + 1, z) === BlockId.Water;
        const height = isWater ? (aboveIsWater ? 1.0 : WATER_TOP_HEIGHT) : BLOCK_HEIGHT[id];
        const isFullHeight = height >= 1.0;
        const isHalfHeight = !isWater && height <= 0.6;
        const y0 = y;
        const y1 = y + height;

        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const nx = x + face.nx;
          const ny = y + face.ny;
          const nz = z + face.nz;
          const nid = sampleBlock(nx, ny, nz);

          // Determine face culling
          let faceY0 = y0;
          let faceY1 = y1;

          if (isWater) {
            if (f === 0) {
              // Top face of water: only cull if water directly above
              if (aboveIsWater) continue;
            } else if (f === 1) {
              // Bottom face of water
              if (nid === BlockId.Water || IS_OPAQUE_FULL[nid] !== 0) continue;
            } else {
              // Side face of water
              if (IS_OPAQUE_FULL[nid] !== 0) continue;
              if (nid === BlockId.Water) {
                // Waterfall edge next to recessed water surface: render top 0.12 strip only
                if (aboveIsWater && sampleBlock(nx, y + 1, nz) !== BlockId.Water) {
                  faceY0 = y + WATER_TOP_HEIGHT;
                  faceY1 = y + 1.0;
                } else {
                  continue;
                }
              }
            }
          } else if (isTranslucent) {
            // Glass / Ice: skip faces adjacent to same block ID or opaque full-height blocks
            if (nid === id || IS_OPAQUE_FULL[nid] !== 0) continue;
          } else if (isCutout) {
            // Leaves: render faces unless adjacent to opaque full-height blocks
            if (IS_OPAQUE_FULL[nid] !== 0) continue;
          } else {
            // Opaque full or partial-height block (StoneSlab, Bed, Farmland, DirtPath)
            if (f === 0) {
              // Top face: only cull if full-height and neighbor above is opaque full-height
              if (isFullHeight && IS_OPAQUE_FULL[nid] !== 0) continue;
            } else if (f === 1) {
              // Bottom face: cull against opaque full-height or bedrock floor at y=0
              if (IS_OPAQUE_FULL[nid] !== 0) continue;
              if (y === 0 && id === BlockId.Bedrock) continue;
            } else {
              // Side face
              if (IS_OPAQUE_FULL[nid] !== 0) continue;
              if (!isFullHeight) {
                if (
                  nid === id ||
                  (IS_TRANSPARENT[nid] === 0 && BLOCK_HEIGHT[nid] >= height)
                ) {
                  continue;
                }
              }
            }
          }

          // Select face texture UV and vertical crop for partial-height side faces
          const uv = f === 0 ? UV_TOP[id] : f === 1 ? UV_BOTTOM[id] : UV_SIDE[id];
          let vBot = uv.v0;
          const vTop = uv.v1;
          if (face.isSide && id !== BlockId.Bed) {
            const span = faceY1 - faceY0;
            if (span < 1.0) {
              vBot = uv.v1 - (uv.v1 - uv.v0) * span;
            }
          }

          // Determine smooth-lighting & AO sampling origin plane
          let sampleOx = nx;
          let sampleOy = ny;
          let sampleOz = nz;
          let faceLightByte: number;

          if (f === 0 && isHalfHeight && IS_LIGHT_OPAQUE[id] === 0) {
            // Top face of slab/bed sits inside (x, y, z): sample in plane y for accurate wall AO & ceiling light
            sampleOx = x;
            sampleOy = y;
            sampleOz = z;
            faceLightByte = light[idx];
          } else if (f === 0 && isWater && !aboveIsWater && IS_LIGHT_OPAQUE[nid] !== 0) {
            // Recessed water surface directly beneath an opaque overhang
            sampleOx = x;
            sampleOy = y;
            sampleOz = z;
            faceLightByte = light[idx];
          } else if (IS_LIGHT_OPAQUE[nid] !== 0) {
            // Exposed strip next to an opaque partial-height neighbor (e.g. Farmland / DirtPath)
            faceLightByte = sampleLight(nx, ny + 1, nz);
          } else {
            faceLightByte = sampleLight(nx, ny, nz);
          }

          emitCubeFace(
            builder,
            face,
            x,
            faceY0,
            faceY1,
            z,
            sampleOx,
            sampleOy,
            sampleOz,
            faceLightByte,
            uv,
            vBot,
            vTop
          );
        }
      }
    }
  }

  return {
    opaque: opaqueBuilder.build(),
    cutout: cutoutBuilder.build(),
    translucent: translucentBuilder.build(),
    meshMs: performance.now() - t0,
  };
}
