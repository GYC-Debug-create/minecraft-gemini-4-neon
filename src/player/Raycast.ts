import { BlockPos, Vec3 } from '../core/types';
import { BlockId, BlockRegistry } from '../registry/blocks';
import { CollisionWorld } from './Physics';

export interface RaycastHit {
  pos: BlockPos;
  adjacent: BlockPos;
  normal: BlockPos;
  blockId: BlockId;
  distance: number;
}

/** Computes unit forward direction vector from yaw (0 = -Z) and pitch (+up, -down) */
export function lookDirection(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return {
    x: -Math.sin(yaw) * cp,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cp,
  };
}

/**
 * Exact Amanatides-Woo 3D DDA voxel raycast.
 * Ignores Air and Water; hits solid blocks and interactable cutout blocks (grass, flowers, torches, crops, doors, ladders).
 */
export function raycastVoxel(
  world: CollisionWorld,
  origin: Vec3,
  dir: Vec3,
  maxDistance: number
): RaycastHit | null {
  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (len < 1e-8) return null;
  const dx = dir.x / len;
  const dy = dir.y / len;
  const dz = dir.z / len;

  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;

  let tMaxX =
    stepX > 0 ? (x + 1 - origin.x) * tDeltaX : stepX < 0 ? (origin.x - x) * tDeltaX : Infinity;
  let tMaxY =
    stepY > 0 ? (y + 1 - origin.y) * tDeltaY : stepY < 0 ? (origin.y - y) * tDeltaY : Infinity;
  let tMaxZ =
    stepZ > 0 ? (z + 1 - origin.z) * tDeltaZ : stepZ < 0 ? (origin.z - z) * tDeltaZ : Infinity;

  let nx = 0;
  let ny = 0;
  let nz = 0;
  let t = 0;

  for (let iter = 0; iter < 128 && t <= maxDistance; iter++) {
    const id = world.getBlock(x, y, z);
    if (id !== BlockId.Air && !BlockRegistry.isLiquid(id)) {
      const def = BlockRegistry.get(id);
      const hitY = origin.y + dy * t;
      // For partial height blocks (e.g. StoneSlab 0.5), verify the ray intersects below block top
      const hitSubHeight = def.height >= 0.99 || hitY <= y + def.height + 0.02 || (dy < 0 && origin.y >= y + def.height);
      if (hitSubHeight) {
        return {
          pos: { x, y, z },
          normal: { x: nx, y: ny, z: nz },
          adjacent: { x: x + nx, y: y + ny, z: z + nz },
          blockId: id,
          distance: t,
        };
      }
    }

    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
      t = tMaxX;
      tMaxX += tDeltaX;
      x += stepX;
      nx = -stepX;
      ny = 0;
      nz = 0;
    } else if (tMaxY <= tMaxZ) {
      t = tMaxY;
      tMaxY += tDeltaY;
      y += stepY;
      nx = 0;
      ny = -stepY;
      nz = 0;
    } else {
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      z += stepZ;
      nx = 0;
      ny = 0;
      nz = -stepZ;
    }
  }

  return null;
}
