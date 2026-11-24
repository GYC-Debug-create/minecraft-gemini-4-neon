import { BALANCE } from '../config/balance';
import { Vec3 } from '../core/types';
import { BlockId, BlockRegistry } from '../registry/blocks';

/** Minimal read-only voxel query interface so Physics can be unit-tested without full World/Three.js */
export interface CollisionWorld {
  getBlock(x: number, y: number, z: number): BlockId;
  getMeta(x: number, y: number, z: number): number;
  hasChunk?(cx: number, cz: number): boolean;
}

export interface MoveInput {
  forward: number;  // -1..1
  strafe: number;   // -1..1
  jump: boolean;
  sneak: boolean;
  sprint: boolean;
  flyUp?: boolean;
  flyDown?: boolean;
}

export interface PhysicsBody {
  pos: Vec3;        // feet center (x, y, z)
  vel: Vec3;
  yaw: number;
  width: number;
  height: number;
  onGround: boolean;
  inWater: boolean;
  headInWater: boolean;
  onLadder: boolean;
  flying: boolean;
  sneaking: boolean;
  sprinting: boolean;
}

export interface StepResult {
  landed: boolean;
  impactSpeed: number;
  horizontalDistance: number;
  collidedX: boolean;
  collidedZ: boolean;
}

const EPS = 1e-4;

export function getBlockCollisionHeight(world: CollisionWorld, bx: number, by: number, bz: number): number {
  const id = world.getBlock(bx, by, bz);
  if (id === BlockId.Air) return 0;
  const meta = world.getMeta(bx, by, bz);
  if (!BlockRegistry.isSolid(id, meta)) return 0;
  return BlockRegistry.getHeight(id);
}

/** Returns true if an entity AABB centered at (px, py..py+height, pz) overlaps any solid voxel */
export function collidesAt(
  world: CollisionWorld,
  px: number,
  py: number,
  pz: number,
  width: number,
  height: number
): boolean {
  const hw = width * 0.5;
  const minX = Math.floor(px - hw + EPS);
  const maxX = Math.floor(px + hw - EPS);
  const minY = Math.floor(py + EPS);
  const maxY = Math.floor(py + height - EPS);
  const minZ = Math.floor(pz - hw + EPS);
  const maxZ = Math.floor(pz + hw - EPS);

  for (let by = minY; by <= maxY; by++) {
    for (let bz = minZ; bz <= maxZ; bz++) {
      for (let bx = minX; bx <= maxX; bx++) {
        const bh = getBlockCollisionHeight(world, bx, by, bz);
        if (bh <= 0) continue;
        const blockTop = by + bh;
        if (py + EPS < blockTop && py + height - EPS > by) {
          return true;
        }
      }
    }
  }
  return false;
}

/** Prevents placing a solid block overlapping the player's bounding box */
export function doesBlockIntersectPlayer(
  bx: number,
  by: number,
  bz: number,
  blockHeight: number,
  playerPos: Vec3,
  width = BALANCE.player.width,
  height = BALANCE.player.height
): boolean {
  if (blockHeight <= 0) return false;
  const hw = width * 0.5;
  const pMinX = playerPos.x - hw;
  const pMaxX = playerPos.x + hw;
  const pMinY = playerPos.y;
  const pMaxY = playerPos.y + height;
  const pMinZ = playerPos.z - hw;
  const pMaxZ = playerPos.z + hw;

  return (
    pMaxX > bx + EPS &&
    pMinX < bx + 1 - EPS &&
    pMaxY > by + EPS &&
    pMinY < by + blockHeight - EPS &&
    pMaxZ > bz + EPS &&
    pMinZ < bz + 1 - EPS
  );
}

export function isWaterAt(world: CollisionWorld, x: number, y: number, z: number): boolean {
  return BlockRegistry.isLiquid(world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)));
}

export function isClimbableAt(world: CollisionWorld, x: number, y: number, z: number): boolean {
  const b = world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
  return BlockRegistry.get(b).climbable;
}

/** Checks if standing at (px, py, pz) has solid ground immediately below feet */
function hasGroundBelow(
  world: CollisionWorld,
  px: number,
  py: number,
  pz: number,
  width: number
): boolean {
  return collidesAt(world, px, py - 0.08, pz, width, 0.2);
}

/**
 * Resolves a single axis displacement with substepping so high speeds never tunnel through blocks.
 */
function moveAxisY(world: CollisionWorld, body: PhysicsBody, dy: number): { hitGround: boolean; hitCeil: boolean } {
  if (Math.abs(dy) < 1e-7) return { hitGround: false, hitCeil: false };
  const maxStep = 0.2;
  const steps = Math.max(1, Math.ceil(Math.abs(dy) / maxStep));
  const step = dy / steps;

  for (let i = 0; i < steps; i++) {
    const nextY = body.pos.y + step;
    if (collidesAt(world, body.pos.x, nextY, body.pos.z, body.width, body.height)) {
      if (step < 0) {
        // Snap cleanly to highest solid surface intersecting footprints
        body.pos.y = snapToGroundTop(world, body.pos.x, nextY, body.pos.z, body.width, body.pos.y);
        body.vel.y = 0;
        return { hitGround: true, hitCeil: false };
      } else {
        // Snap cleanly below ceiling
        body.pos.y = Math.floor(nextY + body.height) - body.height - EPS;
        body.vel.y = 0;
        return { hitGround: false, hitCeil: true };
      }
    }
    body.pos.y = nextY;
  }
  return { hitGround: false, hitCeil: false };
}

function snapToGroundTop(
  world: CollisionWorld,
  px: number,
  testY: number,
  pz: number,
  width: number,
  prevY: number
): number {
  const hw = width * 0.5;
  const minX = Math.floor(px - hw + EPS);
  const maxX = Math.floor(px + hw - EPS);
  const minZ = Math.floor(pz - hw + EPS);
  const maxZ = Math.floor(pz + hw - EPS);
  const minY = Math.floor(testY);
  const maxY = Math.floor(prevY + 0.05);

  let highestTop = testY;
  let found = false;
  for (let by = minY; by <= maxY; by++) {
    for (let bz = minZ; bz <= maxZ; bz++) {
      for (let bx = minX; bx <= maxX; bx++) {
        const bh = getBlockCollisionHeight(world, bx, by, bz);
        if (bh <= 0) continue;
        const top = by + bh;
        if (top <= prevY + 0.06 && (!found || top > highestTop)) {
          highestTop = top;
          found = true;
        }
      }
    }
  }
  return found ? highestTop : prevY;
}

/**
 * Resolves horizontal X or Z movement with optional 0.5-block step-up and sneak edge-guard.
 */
function moveAxisHorizontal(
  world: CollisionWorld,
  body: PhysicsBody,
  axis: 'x' | 'z',
  delta: number,
  allowStepUp: boolean,
  sneakEdgeGuard: boolean
): boolean {
  if (Math.abs(delta) < 1e-7) return false;
  const maxStep = 0.2;
  const steps = Math.max(1, Math.ceil(Math.abs(delta) / maxStep));
  const step = delta / steps;
  let collided = false;

  for (let i = 0; i < steps; i++) {
    const nx = axis === 'x' ? body.pos.x + step : body.pos.x;
    const nz = axis === 'z' ? body.pos.z + step : body.pos.z;

    if (sneakEdgeGuard && !hasGroundBelow(world, nx, body.pos.y, nz, body.width)) {
      if (axis === 'x') body.vel.x = 0;
      else body.vel.z = 0;
      collided = true;
      break;
    }

    if (!collidesAt(world, nx, body.pos.y, nz, body.width, body.height)) {
      body.pos.x = nx;
      body.pos.z = nz;
      continue;
    }

    // Attempt step-up (e.g. onto 0.5-block StoneSlab)
    let stepped = false;
    if (allowStepUp) {
      const stepHeight = BALANCE.player.stepHeight;
      // Find lowest clearance height up to stepHeight
      const tryHeights = [0.26, 0.51, stepHeight];
      for (const sh of tryHeights) {
        if (sh > stepHeight) continue;
        if (
          !collidesAt(world, body.pos.x, body.pos.y + sh, body.pos.z, body.width, body.height) &&
          !collidesAt(world, nx, body.pos.y + sh, nz, body.width, body.height)
        ) {
          // Snap down onto exact slab surface
          const snappedY = snapToGroundTop(world, nx, body.pos.y, nz, body.width, body.pos.y + sh);
          if (snappedY <= body.pos.y + stepHeight + EPS && !collidesAt(world, nx, snappedY, nz, body.width, body.height)) {
            body.pos.x = nx;
            body.pos.y = snappedY;
            body.pos.z = nz;
            stepped = true;
            break;
          }
        }
      }
    }

    if (!stepped) {
      if (axis === 'x') body.vel.x = 0;
      else body.vel.z = 0;
      collided = true;
      break;
    }
  }

  return collided;
}

/**
 * Advances a PhysicsBody by `dt` seconds with swept/substepped AABB resolution.
 */
export function stepPhysics(
  world: CollisionWorld,
  body: PhysicsBody,
  input: MoveInput,
  dt: number,
  canSprint = true
): StepResult {
  const startX = body.pos.x;
  const startZ = body.pos.z;

  // Water & ladder detection
  const feetWater = isWaterAt(world, body.pos.x, body.pos.y + 0.15, body.pos.z);
  const waistWater = isWaterAt(world, body.pos.x, body.pos.y + 0.85, body.pos.z);
  const eyeY = body.pos.y + (body.sneaking ? BALANCE.player.sneakEyeHeight : BALANCE.player.eyeHeight);
  body.inWater = feetWater || waistWater;
  body.headInWater = isWaterAt(world, body.pos.x, eyeY, body.pos.z);
  body.onLadder =
    isClimbableAt(world, body.pos.x, body.pos.y + 0.2, body.pos.z) ||
    isClimbableAt(world, body.pos.x, body.pos.y + 1.1, body.pos.z);

  body.sneaking = input.sneak && !body.flying;
  body.sprinting = input.sprint && input.forward > 0 && !body.sneaking && canSprint && !body.inWater;

  // Compute desired horizontal direction from yaw (yaw=0 looks toward -Z)
  const sinY = Math.sin(body.yaw);
  const cosY = Math.cos(body.yaw);
  let dirX = -sinY * input.forward + cosY * input.strafe;
  let dirZ = -cosY * input.forward - sinY * input.strafe;
  const len = Math.hypot(dirX, dirZ);
  if (len > 1e-5) {
    dirX /= len;
    dirZ /= len;
  }

  if (body.flying) {
    const flySpeed = input.sprint ? BALANCE.player.flySpeed * 1.8 : BALANCE.player.flySpeed;
    const vert = (input.jump || input.flyUp ? 1 : 0) - (input.sneak || input.flyDown ? 1 : 0);
    body.vel.x = dirX * flySpeed;
    body.vel.y = vert * flySpeed * 0.75;
    body.vel.z = dirZ * flySpeed;
    body.pos.x += body.vel.x * dt;
    body.pos.y = Math.max(1, Math.min(126, body.pos.y + body.vel.y * dt));
    body.pos.z += body.vel.z * dt;
    body.onGround = false;
    return {
      landed: false,
      impactSpeed: 0,
      horizontalDistance: Math.hypot(body.pos.x - startX, body.pos.z - startZ),
      collidedX: false,
      collidedZ: false,
    };
  }

  let moveSpeed: number = BALANCE.player.walkSpeed;
  if (body.inWater) moveSpeed = BALANCE.player.swimSpeed;
  else if (body.sneaking) moveSpeed = BALANCE.player.sneakSpeed;
  else if (body.sprinting) moveSpeed = BALANCE.player.sprintSpeed;

  body.vel.x = dirX * moveSpeed;
  body.vel.z = dirZ * moveSpeed;

  // Vertical acceleration
  const preVelY = body.vel.y;
  const wasOnGround = body.onGround;

  if (body.onLadder) {
    if (input.jump) body.vel.y = 4.0;
    else if (body.sneaking) body.vel.y = 0;
    else if (input.forward > 0) body.vel.y = 3.6;
    else body.vel.y = -2.2;
  } else if (body.inWater) {
    if (input.jump) {
      body.vel.y = Math.min(BALANCE.player.swimUpVelocity, body.vel.y + 18 * dt);
    } else {
      body.vel.y = Math.max(-3.5, body.vel.y - BALANCE.player.waterGravity * dt);
    }
  } else {
    if (input.jump && body.onGround) {
      body.vel.y = BALANCE.player.jumpVelocity;
      body.onGround = false;
    } else {
      body.vel.y = Math.max(-BALANCE.player.terminalVelocity, body.vel.y - BALANCE.player.gravity * dt);
    }
  }

  // Resolve horizontal X and Z independently (enables clean wall sliding)
  const allowStepUp = body.onGround && !body.inWater;
  const sneakEdgeGuard = body.sneaking && body.onGround;
  const collidedX = moveAxisHorizontal(world, body, 'x', body.vel.x * dt, allowStepUp, sneakEdgeGuard);
  const collidedZ = moveAxisHorizontal(world, body, 'z', body.vel.z * dt, allowStepUp, sneakEdgeGuard);

  // Resolve vertical Y
  const yRes = moveAxisY(world, body, body.vel.y * dt);
  if (yRes.hitGround) {
    body.onGround = true;
  } else if (body.vel.y > 0) {
    body.onGround = false;
  } else {
    body.onGround = hasGroundBelow(world, body.pos.x, body.pos.y, body.pos.z, body.width);
  }

  const landed = !wasOnGround && body.onGround && preVelY < 0;
  const impactSpeed = landed ? Math.abs(preVelY) : 0;

  return {
    landed,
    impactSpeed,
    horizontalDistance: Math.hypot(body.pos.x - startX, body.pos.z - startZ),
    collidedX,
    collidedZ,
  };
}
