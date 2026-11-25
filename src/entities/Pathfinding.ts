import { BALANCE } from '../config/balance';
import { BlockPos } from '../core/types';
import { BlockId, BlockRegistry } from '../registry/blocks';
import { CollisionWorld } from '../player/Physics';

export interface PathfindOptions {
  maxNodes?: number;
  canClimb?: boolean;
  maxDrop?: number;
  toleranceDist?: number;
}

export interface PathfindResult {
  path: BlockPos[];
  nodesExplored: number;
  reached: boolean;
}

interface AStarNode {
  x: number;
  y: number;
  z: number;
  g: number;
  f: number;
  parent: AStarNode | null;
}

const CARDINAL: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function nodeKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function heuristic(x: number, y: number, z: number, gx: number, gy: number, gz: number): number {
  return Math.abs(x - gx) + Math.abs(y - gy) * 1.2 + Math.abs(z - gz);
}

function isPassableSpace(world: CollisionWorld, x: number, y: number, z: number): boolean {
  const b0 = world.getBlock(x, y, z);
  const b1 = world.getBlock(x, y + 1, z);
  const m0 = world.getMeta(x, y, z);
  const m1 = world.getMeta(x, y + 1, z);
  if (BlockRegistry.isSolid(b0, m0) || BlockRegistry.isSolid(b1, m1)) return false;
  if (b0 === BlockId.Water || b1 === BlockId.Water) return false;
  return true;
}

function isStandable(world: CollisionWorld, x: number, y: number, z: number): boolean {
  if (y < 2 || y > 124) return false;
  if (!isPassableSpace(world, x, y, z)) return false;
  const floor = world.getBlock(x, y - 1, z);
  const floorMeta = world.getMeta(x, y - 1, z);
  return BlockRegistry.isSolid(floor, floorMeta);
}

/**
 * Bounded voxel grid A* pathfinder.
 * Strictly honors `maxNodes` exploration cap so mob AI stays O(1) bounded per tick.
 */
export function findPath(
  world: CollisionWorld,
  startPos: BlockPos,
  goalPos: BlockPos,
  options: PathfindOptions = {}
): PathfindResult {
  const maxNodes = options.maxNodes ?? BALANCE.mobs.pathfindMaxNodes;
  const canClimb = options.canClimb ?? false;
  const maxDrop = options.maxDrop ?? 3;
  const tolerance = options.toleranceDist ?? 1;

  const sx = Math.floor(startPos.x);
  const sy = Math.floor(startPos.y);
  const sz = Math.floor(startPos.z);
  const gx = Math.floor(goalPos.x);
  const gy = Math.floor(goalPos.y);
  const gz = Math.floor(goalPos.z);

  if (Math.abs(sx - gx) + Math.abs(sz - gz) <= tolerance && Math.abs(sy - gy) <= 1) {
    return { path: [{ x: gx, y: gy, z: gz }], nodesExplored: 1, reached: true };
  }

  const startNode: AStarNode = {
    x: sx,
    y: sy,
    z: sz,
    g: 0,
    f: heuristic(sx, sy, sz, gx, gy, gz),
    parent: null,
  };

  const open: AStarNode[] = [startNode];
  const bestG = new Map<string, number>([[nodeKey(sx, sy, sz), 0]]);
  const closed = new Set<string>();

  let nodesExplored = 0;
  let closestNode: AStarNode = startNode;
  let closestH = startNode.f;

  while (open.length > 0 && nodesExplored < maxNodes) {
    // Pop lowest f-score node (small open set <= 160 so linear scan is super fast & zero-overhead)
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const cur = open[bestIdx];
    open[bestIdx] = open[open.length - 1];
    open.pop();

    const ck = nodeKey(cur.x, cur.y, cur.z);
    if (closed.has(ck)) continue;
    closed.add(ck);
    nodesExplored++;

    const hCur = heuristic(cur.x, cur.y, cur.z, gx, gy, gz);
    if (hCur < closestH) {
      closestH = hCur;
      closestNode = cur;
    }

    if (Math.abs(cur.x - gx) <= tolerance && Math.abs(cur.z - gz) <= tolerance && Math.abs(cur.y - gy) <= 1) {
      return { path: reconstructPath(cur), nodesExplored, reached: true };
    }

    // Explore 4 horizontal neighbors (flat, step-up 1, drop 1..maxDrop, or spider wall-climb)
    for (const [dx, dz] of CARDINAL) {
      const nx = cur.x + dx;
      const nz = cur.z + dz;

      // 1. Same elevation
      if (isStandable(world, nx, cur.y, nz)) {
        tryPush(open, bestG, closed, cur, nx, cur.y, nz, cur.g + 1.0, gx, gy, gz);
        continue;
      }

      // 2. Step up 1 block (needs headroom above current position too)
      if (
        !BlockRegistry.isSolid(world.getBlock(cur.x, cur.y + 2, cur.z), world.getMeta(cur.x, cur.y + 2, cur.z)) &&
        isStandable(world, nx, cur.y + 1, nz)
      ) {
        tryPush(open, bestG, closed, cur, nx, cur.y + 1, nz, cur.g + 1.35, gx, gy, gz);
        continue;
      }

      // 3. Drop down 1..maxDrop blocks (must have air at cur.y & cur.y+1 at destination)
      if (isPassableSpace(world, nx, cur.y, nz)) {
        for (let drop = 1; drop <= maxDrop; drop++) {
          const ny = cur.y - drop;
          if (ny < 2) break;
          if (isStandable(world, nx, ny, nz)) {
            tryPush(open, bestG, closed, cur, nx, ny, nz, cur.g + 1.0 + drop * 0.25, gx, gy, gz);
            break;
          }
          // Stop if hit solid ceiling/obstacle before finding standable ledge
          if (BlockRegistry.isSolid(world.getBlock(nx, ny, nz), world.getMeta(nx, ny, nz))) {
            break;
          }
        }
      }

      // 4. Spider vertical climb along solid wall
      if (canClimb && BlockRegistry.isSolid(world.getBlock(nx, cur.y, nz), world.getMeta(nx, cur.y, nz))) {
        const upY = cur.y + 1;
        if (isPassableSpace(world, cur.x, upY, cur.z)) {
          tryPush(open, bestG, closed, cur, cur.x, upY, cur.z, cur.g + 1.25, gx, gy, gz);
        }
      }
    }
  }

  // Return partial best-effort path toward closest explored node
  return {
    path: closestNode === startNode ? [] : reconstructPath(closestNode),
    nodesExplored,
    reached: false,
  };
}

function tryPush(
  open: AStarNode[],
  bestG: Map<string, number>,
  closed: Set<string>,
  parent: AStarNode,
  nx: number,
  ny: number,
  nz: number,
  g: number,
  gx: number,
  gy: number,
  gz: number
): void {
  const k = nodeKey(nx, ny, nz);
  if (closed.has(k)) return;
  const prevG = bestG.get(k);
  if (prevG !== undefined && g >= prevG) return;
  bestG.set(k, g);
  open.push({
    x: nx,
    y: ny,
    z: nz,
    g,
    f: g + heuristic(nx, ny, nz, gx, gy, gz),
    parent,
  });
}

function reconstructPath(node: AStarNode): BlockPos[] {
  const rev: BlockPos[] = [];
  let cur: AStarNode | null = node;
  while (cur && cur.parent) {
    rev.push({ x: cur.x, y: cur.y, z: cur.z });
    cur = cur.parent;
  }
  rev.reverse();
  return rev;
}
