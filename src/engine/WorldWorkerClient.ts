import { Chunk } from '../world/Chunk';
import {
  ChunkMeshData,
  NeighborSlices,
  WorkerRequest,
  WorkerResponse,
} from '../world/worker/protocol';

export interface GeneratedChunkResult {
  chunk: Chunk;
  mesh: ChunkMeshData;
  genMs: number;
}

export class WorldWorkerClient {
  private worker: Worker;
  private nextRequestId = 1;
  private readonly pendingGen = new Map<
    number,
    { resolve: (r: GeneratedChunkResult) => void; reject: (e: Error) => void }
  >();
  private readonly pendingMesh = new Map<
    number,
    { resolve: (m: ChunkMeshData) => void; reject: (e: Error) => void }
  >();

  private genMsSum = 0;
  private genCount = 0;
  private meshMsSum = 0;
  private meshCount = 0;

  constructor(seed: number) {
    this.worker = new Worker(new URL('../world/worker/world.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => this.onMessage(ev.data);
    this.worker.onerror = (ev) => {
      console.error('[WorldWorker] error:', ev.message);
    };
    this.init(seed);
  }

  init(seed: number): void {
    const req: WorkerRequest = { type: 'init', seed };
    this.worker.postMessage(req);
  }

  resetSeed(seed: number): void {
    // Reject stale requests cleanly
    for (const [, p] of this.pendingGen) p.reject(new Error('Seed reset'));
    for (const [, p] of this.pendingMesh) p.reject(new Error('Seed reset'));
    this.pendingGen.clear();
    this.pendingMesh.clear();
    this.genMsSum = 0;
    this.genCount = 0;
    this.meshMsSum = 0;
    this.meshCount = 0;
    this.init(seed);
  }

  generateChunk(cx: number, cz: number): Promise<GeneratedChunkResult> {
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pendingGen.set(requestId, { resolve, reject });
      const req: WorkerRequest = { type: 'generateChunk', requestId, cx, cz };
      this.worker.postMessage(req);
    });
  }

  meshChunk(
    cx: number,
    cz: number,
    blocks: Uint8Array,
    light: Uint8Array,
    meta: Uint8Array,
    neighbors?: NeighborSlices
  ): Promise<ChunkMeshData> {
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pendingMesh.set(requestId, { resolve, reject });
      // Copy chunk buffers before sending so main thread retains authoritative data
      const bCopy = new Uint8Array(blocks);
      const lCopy = new Uint8Array(light);
      const mCopy = new Uint8Array(meta);
      const transferables: Transferable[] = [bCopy.buffer, lCopy.buffer, mCopy.buffer];
      if (neighbors) {
        if (neighbors.pxBlocks) transferables.push(neighbors.pxBlocks.buffer);
        if (neighbors.nxBlocks) transferables.push(neighbors.nxBlocks.buffer);
        if (neighbors.pzBlocks) transferables.push(neighbors.pzBlocks.buffer);
        if (neighbors.nzBlocks) transferables.push(neighbors.nzBlocks.buffer);
        if (neighbors.pxLight) transferables.push(neighbors.pxLight.buffer);
        if (neighbors.nxLight) transferables.push(neighbors.nxLight.buffer);
        if (neighbors.pzLight) transferables.push(neighbors.pzLight.buffer);
        if (neighbors.nzLight) transferables.push(neighbors.nzLight.buffer);
      }
      const req: WorkerRequest = {
        type: 'meshChunk',
        requestId,
        cx,
        cz,
        blocks: bCopy,
        light: lCopy,
        meta: mCopy,
        neighbors,
      };
      this.worker.postMessage(req, transferables);
    });
  }

  getStats(): { chunkGenAvgMs: number; chunkMeshAvgMs: number } {
    return {
      chunkGenAvgMs: this.genCount > 0 ? this.genMsSum / this.genCount : 0,
      chunkMeshAvgMs: this.meshCount > 0 ? this.meshMsSum / this.meshCount : 0,
    };
  }

  dispose(): void {
    this.worker.terminate();
    this.pendingGen.clear();
    this.pendingMesh.clear();
  }

  private onMessage(msg: WorkerResponse): void {
    if (msg.type === 'chunkGenerated') {
      const pending = this.pendingGen.get(msg.requestId);
      if (!pending) return;
      this.pendingGen.delete(msg.requestId);
      this.genMsSum += msg.genMs;
      this.genCount++;
      this.meshMsSum += msg.mesh.meshMs;
      this.meshCount++;
      const chunk = new Chunk(msg.cx, msg.cz, msg.blocks, msg.light, msg.meta, msg.biomes);
      chunk.dirty = false;
      pending.resolve({ chunk, mesh: msg.mesh, genMs: msg.genMs });
    } else if (msg.type === 'chunkMeshed') {
      const pending = this.pendingMesh.get(msg.requestId);
      if (!pending) return;
      this.pendingMesh.delete(msg.requestId);
      this.meshMsSum += msg.mesh.meshMs;
      this.meshCount++;
      pending.resolve(msg.mesh);
    } else if (msg.type === 'error') {
      const err = new Error(msg.message);
      const pg = this.pendingGen.get(msg.requestId);
      if (pg) {
        this.pendingGen.delete(msg.requestId);
        pg.reject(err);
      }
      const pm = this.pendingMesh.get(msg.requestId);
      if (pm) {
        this.pendingMesh.delete(msg.requestId);
        pm.reject(err);
      }
    }
  }
}
