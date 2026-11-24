export interface MeshBuffers {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** RGB vertex attributes: R = skyLight [0..1], G = blockLight [0..1], B = AO * faceShade [0..1] */
  colors: Float32Array;
  indices: Uint32Array;
}

export interface ChunkMeshData {
  opaque: MeshBuffers;
  cutout: MeshBuffers;
  translucent: MeshBuffers;
  meshMs: number;
}

/**
 * Optional 1-voxel neighbor slices along chunk borders for seamless face culling, AO, and smooth lighting.
 * Each slice is indexed by `(y << 4) | localAlongEdge` (size = 128 * 16 = 2048).
 */
export interface NeighborSlices {
  pxBlocks?: Uint8Array; // neighbor at cx + 1, lx = 0
  nxBlocks?: Uint8Array; // neighbor at cx - 1, lx = 15
  pzBlocks?: Uint8Array; // neighbor at cz + 1, lz = 0
  nzBlocks?: Uint8Array; // neighbor at cz - 1, lz = 15
  pxLight?: Uint8Array;
  nxLight?: Uint8Array;
  pzLight?: Uint8Array;
  nzLight?: Uint8Array;
}

export type WorkerRequest =
  | { type: 'init'; seed: number }
  | { type: 'generateChunk'; requestId: number; cx: number; cz: number }
  | {
      type: 'meshChunk';
      requestId: number;
      cx: number;
      cz: number;
      blocks: Uint8Array;
      light: Uint8Array;
      meta: Uint8Array;
      neighbors?: NeighborSlices;
    };

export type WorkerResponse =
  | {
      type: 'chunkGenerated';
      requestId: number;
      cx: number;
      cz: number;
      blocks: Uint8Array;
      light: Uint8Array;
      meta: Uint8Array;
      biomes: Uint8Array;
      mesh: ChunkMeshData;
      genMs: number;
    }
  | {
      type: 'chunkMeshed';
      requestId: number;
      cx: number;
      cz: number;
      mesh: ChunkMeshData;
    }
  | {
      type: 'error';
      requestId: number;
      message: string;
    };

export function collectMeshTransferables(mesh: ChunkMeshData): Transferable[] {
  const out: Transferable[] = [];
  for (const bucket of [mesh.opaque, mesh.cutout, mesh.translucent]) {
    out.push(
      bucket.positions.buffer,
      bucket.normals.buffer,
      bucket.uvs.buffer,
      bucket.colors.buffer,
      bucket.indices.buffer
    );
  }
  return out;
}
