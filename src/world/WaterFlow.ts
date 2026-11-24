import { BALANCE } from '../config/balance';
import { BlockPos } from '../core/types';
import { BlockId, BlockRegistry } from '../registry/blocks';
import { World } from './World';

const HORIZ: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Simple finite water flow simulation.
 * Water meta encoding:
 *   0 = source block (natural ocean/river or placed source)
 *   1..maxSpreadDistance = horizontal flowing distance from source
 *   8 = falling vertical water (resets horizontal spread to 1 upon landing)
 */
export class WaterFlowSystem {
  private readonly queue: BlockPos[] = [];
  private readonly queuedKeys = new Set<string>();
  private tickCounter = 0;

  enqueueArea(x: number, y: number, z: number): void {
    const offsets: ReadonlyArray<readonly [number, number, number]> = [
      [0, 0, 0],
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    for (const [dx, dy, dz] of offsets) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      const k = `${nx},${ny},${nz}`;
      if (!this.queuedKeys.has(k)) {
        this.queuedKeys.add(k);
        this.queue.push({ x: nx, y: ny, z: nz });
      }
    }
  }

  tick(world: World): void {
    this.tickCounter++;
    if (this.tickCounter % BALANCE.water.flowTickInterval !== 0) return;

    const maxDist = BALANCE.water.maxSpreadDistance;
    const budget = Math.min(this.queue.length, 48);

    for (let i = 0; i < budget; i++) {
      const pos = this.queue.shift()!;
      const k = `${pos.x},${pos.y},${pos.z}`;
      this.queuedKeys.delete(k);

      if (pos.y <= 1 || pos.y >= 126) continue;
      const id = world.getBlock(pos.x, pos.y, pos.z);
      if (id !== BlockId.Water) continue;

      const meta = world.getMeta(pos.x, pos.y, pos.z);

      // If non-source flowing water, verify it still has a valid feeder
      if (meta > 0) {
        const aboveIsWater = world.getBlock(pos.x, pos.y + 1, pos.z) === BlockId.Water;
        let bestFeeder = 99;
        if (aboveIsWater) {
          bestFeeder = 0;
        } else {
          for (const [dx, dz] of HORIZ) {
            const nid = world.getBlock(pos.x + dx, pos.y, pos.z + dz);
            if (nid === BlockId.Water) {
              const nm = world.getMeta(pos.x + dx, pos.y, pos.z + dz);
              const eff = nm === 8 ? 0 : nm;
              if (eff < bestFeeder) bestFeeder = eff;
            }
          }
        }
        const desiredMeta = aboveIsWater ? 8 : bestFeeder + 1;
        if (desiredMeta > maxDist && !aboveIsWater) {
          // Drain away
          world.setBlock(pos.x, pos.y, pos.z, BlockId.Air, 0);
          this.enqueueArea(pos.x, pos.y, pos.z);
          continue;
        } else if (desiredMeta !== meta) {
          world.setMeta(pos.x, pos.y, pos.z, desiredMeta);
          this.enqueueArea(pos.x, pos.y, pos.z);
        }
      }

      // 1. Flow straight down if replaceable/air below
      const below = world.getBlock(pos.x, pos.y - 1, pos.z);
      if (this.canFlowInto(below)) {
        world.setBlock(pos.x, pos.y - 1, pos.z, BlockId.Water, 8);
        this.enqueueArea(pos.x, pos.y - 1, pos.z);
        continue; // Prefer flowing downward first
      }

      // 2. If resting on non-water solid ground, spread horizontally up to maxSpreadDistance
      if (below !== BlockId.Water) {
        const effectiveDist = meta === 8 ? 0 : meta;
        const nextDist = effectiveDist + 1;
        if (nextDist <= maxDist) {
          for (const [dx, dz] of HORIZ) {
            const nx = pos.x + dx;
            const nz = pos.z + dz;
            const nb = world.getBlock(nx, pos.y, nz);
            if (this.canFlowInto(nb)) {
              world.setBlock(nx, pos.y, nz, BlockId.Water, nextDist);
              this.enqueueArea(nx, pos.y, nz);
            } else if (nb === BlockId.Water) {
              const nm = world.getMeta(nx, pos.y, nz);
              if (nm > nextDist && nm !== 8) {
                world.setMeta(nx, pos.y, nz, nextDist);
                this.enqueueArea(nx, pos.y, nz);
              }
            }
          }
        }
      }
    }
  }

  private canFlowInto(id: BlockId): boolean {
    if (id === BlockId.Air) return true;
    if (id === BlockId.Water) return false;
    return BlockRegistry.isReplaceable(id) && !BlockRegistry.get(id).solid;
  }
}
