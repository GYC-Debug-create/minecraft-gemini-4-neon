import { BlockPos } from '../core/types';
import { BlockId, BlockRegistry } from '../registry/blocks';
import { World } from './World';

/**
 * Handles falling gravity blocks (Sand, Gravel) whenever a supporting block beneath is removed or placed nearby.
 */
export class GravityBlockSystem {
  private readonly queue: BlockPos[] = [];
  private readonly queuedKeys = new Set<string>();
  private tickCounter = 0;

  enqueueColumnCheck(x: number, y: number, z: number): void {
    // Check block itself and blocks directly above it
    for (let dy = 0; dy <= 1; dy++) {
      const ny = y + dy;
      const key = `${x},${ny},${z}`;
      if (!this.queuedKeys.has(key)) {
        this.queuedKeys.add(key);
        this.queue.push({ x, y: ny, z });
      }
    }
  }

  tick(world: World): void {
    this.tickCounter++;
    if (this.tickCounter % 3 !== 0) return;

    const batchSize = Math.min(this.queue.length, 32);
    for (let i = 0; i < batchSize; i++) {
      const pos = this.queue.shift()!;
      const key = `${pos.x},${pos.y},${pos.z}`;
      this.queuedKeys.delete(key);

      if (pos.y <= 1) continue;
      const id = world.getBlock(pos.x, pos.y, pos.z);
      if (!BlockRegistry.get(id).gravity) continue;

      const below = world.getBlock(pos.x, pos.y - 1, pos.z);
      if (below === BlockId.Air || BlockRegistry.isLiquid(below) || BlockRegistry.isReplaceable(below)) {
        world.setBlock(pos.x, pos.y, pos.z, BlockId.Air);
        world.setBlock(pos.x, pos.y - 1, pos.z, id);
        // Continue checking fallen block AND block that was above its old position
        this.enqueueColumnCheck(pos.x, pos.y - 1, pos.z);
        this.enqueueColumnCheck(pos.x, pos.y + 1, pos.z);
      }
    }
  }
}
