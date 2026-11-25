import { BALANCE } from '../config/balance';
import { CHUNK_SIZE, WORLD_HEIGHT } from '../config/constants';
import { BlockId, BlockRegistry } from '../registry/blocks';
import { World } from '../world/World';

export class FarmingSystem {
  private tickCounter = 0;

  /**
   * Tills Dirt or Grass into Farmland (or FarmlandWet if near water) when block above is Air.
   */
  tillSoil(world: World, x: number, y: number, z: number): boolean {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const id = world.getBlock(ix, iy, iz);
    if (id !== BlockId.Dirt && id !== BlockId.Grass) return false;
    if (world.getBlock(ix, iy + 1, iz) !== BlockId.Air) return false;

    const wet = this.hasNearbyWater(world, ix, iy, iz);
    return world.setBlock(ix, iy, iz, wet ? BlockId.FarmlandWet : BlockId.Farmland);
  }

  /**
   * Applies Bonemeal to immediately advance a crop by up to 2 stages.
   */
  applyBonemeal(world: World, x: number, y: number, z: number): boolean {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const id = world.getBlock(ix, iy, iz);
    if (id === BlockId.CropStage0) return world.setBlock(ix, iy, iz, BlockId.CropStage2);
    if (id === BlockId.CropStage1 || id === BlockId.CropStage2) {
      return world.setBlock(ix, iy, iz, BlockId.CropStage3);
    }
    return false;
  }

  hasNearbyWater(world: World, x: number, y: number, z: number): boolean {
    const r = BALANCE.farming.farmlandHydrationRadius;
    for (let dy = 0; dy <= 1; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (world.getBlock(x + dx, y + dy, z + dz) === BlockId.Water) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Advances crop growth and farmland hydration across loaded chunks.
   * Called both incrementally in normal simulation and in batches by advanceTime(ticks).
   */
  tick(world: World, elapsedTicks = 1): void {
    this.tickCounter += elapsedTicks;
    const interval = BALANCE.farming.cropGrowthIntervalTicks;
    if (this.tickCounter < interval) return;

    const rounds = Math.min(12, Math.floor(this.tickCounter / interval));
    this.tickCounter -= rounds * interval;

    for (let r = 0; r < rounds; r++) {
      this.runGrowthPass(world);
    }
  }

  private runGrowthPass(world: World): void {
    for (const chunk of world.getLoadedChunks()) {
      if (!chunk.hasFarmBlocks) continue;
      const baseX = chunk.cx * CHUNK_SIZE;
      const baseZ = chunk.cz * CHUNK_SIZE;
      const blocks = chunk.blocks;

      for (let idx = 0; idx < blocks.length; idx++) {
        const id = blocks[idx] as BlockId;
        if (
          id !== BlockId.Farmland &&
          id !== BlockId.FarmlandWet &&
          id !== BlockId.CropStage0 &&
          id !== BlockId.CropStage1 &&
          id !== BlockId.CropStage2
        ) {
          continue;
        }

        const y = idx >> 8;
        const lz = (idx >> 4) & 15;
        const lx = idx & 15;
        const wx = baseX + lx;
        const wz = baseZ + lz;

        if (id === BlockId.Farmland || id === BlockId.FarmlandWet) {
          const wet = this.hasNearbyWater(world, wx, y, wz);
          if (wet && id === BlockId.Farmland) {
            world.setBlock(wx, y, wz, BlockId.FarmlandWet);
          } else if (!wet && id === BlockId.FarmlandWet) {
            world.setBlock(wx, y, wz, BlockId.Farmland);
          }
        } else if (BlockRegistry.isCrop(id)) {
          // Requires some light (>= 7) to grow
          if (world.getLight(wx, y, wz) < 7 && world.getSkyLight(wx, Math.min(WORLD_HEIGHT - 1, y + 1), wz) < 7) {
            continue;
          }
          const below = world.getBlock(wx, y - 1, wz);
          const chance =
            below === BlockId.FarmlandWet
              ? BALANCE.farming.cropGrowthChanceWet
              : BALANCE.farming.cropGrowthChanceDry;
          if (Math.random() < chance) {
            world.setBlock(wx, y, wz, (id + 1) as BlockId);
          }
        }
      }
    }
  }
}
