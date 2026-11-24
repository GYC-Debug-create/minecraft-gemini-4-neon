import { initializeChunkLight } from '../Lighting';
import { buildChunkMesh } from '../Mesher';
import { TerrainGenerator } from '../TerrainGenerator';
import {
  collectMeshTransferables,
  type WorkerRequest,
  type WorkerResponse,
} from './protocol';

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

let generator: TerrainGenerator | null = null;

workerScope.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const msg = event.data;
  const requestId = 'requestId' in msg ? msg.requestId : -1;

  try {
    switch (msg.type) {
      case 'init': {
        generator = new TerrainGenerator(msg.seed);
        return;
      }

      case 'generateChunk': {
        if (!generator) {
          throw new Error('World worker received generateChunk before init');
        }

        const t0 = performance.now();
        const chunk = generator.generateChunk(msg.cx, msg.cz);
        initializeChunkLight(chunk);
        const genMs = performance.now() - t0;

        const mesh = buildChunkMesh(
          msg.cx,
          msg.cz,
          chunk.blocks,
          chunk.light,
          chunk.meta
        );

        const response: WorkerResponse = {
          type: 'chunkGenerated',
          requestId: msg.requestId,
          cx: msg.cx,
          cz: msg.cz,
          blocks: chunk.blocks,
          light: chunk.light,
          meta: chunk.meta,
          biomes: chunk.biomes,
          mesh,
          genMs,
        };

        const transferables: Transferable[] = [
          chunk.blocks.buffer,
          chunk.light.buffer,
          chunk.meta.buffer,
          chunk.biomes.buffer,
          ...collectMeshTransferables(mesh),
        ];

        workerScope.postMessage(response, transferables);
        return;
      }

      case 'meshChunk': {
        const mesh = buildChunkMesh(
          msg.cx,
          msg.cz,
          msg.blocks,
          msg.light,
          msg.meta,
          msg.neighbors
        );

        const response: WorkerResponse = {
          type: 'chunkMeshed',
          requestId: msg.requestId,
          cx: msg.cx,
          cz: msg.cz,
          mesh,
        };

        workerScope.postMessage(response, collectMeshTransferables(mesh));
        return;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorResponse: WorkerResponse = {
      type: 'error',
      requestId,
      message,
    };
    workerScope.postMessage(errorResponse);
  }
};
