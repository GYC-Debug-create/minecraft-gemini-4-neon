import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/config/constants';
import {
  CollisionWorld,
  doesBlockIntersectPlayer,
  PhysicsBody,
  stepPhysics,
} from '../../src/player/Physics';
import { lookDirection, raycastVoxel } from '../../src/player/Raycast';
import { BlockId } from '../../src/registry/blocks';

class MockWorld implements CollisionWorld {
  private blocks = new Map<string, BlockId>();
  private metas = new Map<string, number>();

  set(x: number, y: number, z: number, id: BlockId, meta = 0): void {
    const k = `${x},${y},${z}`;
    if (id === BlockId.Air) {
      this.blocks.delete(k);
      this.metas.delete(k);
    } else {
      this.blocks.set(k, id);
      this.metas.set(k, meta);
    }
  }

  fillFloor(y: number, minX: number, maxX: number, minZ: number, maxZ: number, id = BlockId.Stone): void {
    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        this.set(x, y, z, id);
      }
    }
  }

  getBlock(x: number, y: number, z: number): BlockId {
    return this.blocks.get(`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`) ?? BlockId.Air;
  }

  getMeta(x: number, y: number, z: number): number {
    return this.metas.get(`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`) ?? 0;
  }
}

function makeBody(x: number, y: number, z: number): PhysicsBody {
  return {
    pos: { x, y, z },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    width: 0.6,
    height: 1.8,
    onGround: false,
    inWater: false,
    headInWater: false,
    onLadder: false,
    flying: false,
    sneaking: false,
    sprinting: false,
  };
}

describe('M2 Player Physics & DDA Raycast', () => {
  it('high-speed fall never tunnels through a 1-block-thick floor', () => {
    const world = new MockWorld();
    world.fillFloor(10, -5, 5, -5, 5, BlockId.Stone);

    const body = makeBody(0.5, 90, 0.5);
    body.vel.y = -55; // extreme downward speed

    let landed = false;
    for (let i = 0; i < 100; i++) {
      const res = stepPhysics(
        world,
        body,
        { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false },
        FIXED_DT
      );
      if (res.landed) landed = true;
    }

    expect(landed).toBe(true);
    expect(body.onGround).toBe(true);
    expect(body.pos.y).toBeCloseTo(11.0, 2);
  });

  it('diagonal movement against a wall slides smoothly without clipping through', () => {
    const world = new MockWorld();
    world.fillFloor(10, -25, 25, -25, 25, BlockId.Stone);
    // Solid wall along z = -2 (blocking -Z movement at z < -1)
    for (let x = -25; x <= 25; x++) {
      for (let y = 11; y <= 14; y++) {
        world.set(x, y, -2, BlockId.Cobblestone);
      }
    }

    const body = makeBody(0.5, 11.0, 0.5);
    body.onGround = true;
    // yaw = 0 faces -Z; forward + strafe right moves diagonally toward (-Z, +X)
    for (let i = 0; i < 60; i++) {
      stepPhysics(
        world,
        body,
        { forward: 1, strafe: 1, jump: false, sneak: false, sprint: false },
        FIXED_DT
      );
    }

    // Must not penetrate past z = -1 + halfWidth (-0.7)
    expect(body.pos.z).toBeGreaterThanOrEqual(-0.71);
    // Must have slid smoothly along +X!
    expect(body.pos.x).toBeGreaterThan(5.0);
  });

  it('automatically steps up onto a 0.5-block StoneSlab', () => {
    const world = new MockWorld();
    world.fillFloor(10, -5, 5, -10, 5, BlockId.Stone);
    // Place a platform of 0.5-high StoneSlabs at z in [-4..-1]
    for (let z = -4; z <= -1; z++) {
      for (let x = -2; x <= 2; x++) {
        world.set(x, 11, z, BlockId.StoneSlab);
      }
    }

    const body = makeBody(0.5, 11.0, 0.8);
    body.onGround = true;

    for (let i = 0; i < 15; i++) {
      stepPhysics(
        world,
        body,
        { forward: 1, strafe: 0, jump: false, sneak: false, sprint: false },
        FIXED_DT
      );
    }

    // Should have stepped onto the 0.5-block slab at y = 11.5 cleanly without jumping
    expect(body.pos.z).toBeLessThan(0);
    expect(body.pos.z).toBeGreaterThan(-4);
    expect(body.pos.y).toBeCloseTo(11.5, 2);
  });

  it('sneaking prevents walking off a ledge', () => {
    const world = new MockWorld();
    // 3x3 island at y = 10 (z in [-1..1])
    world.fillFloor(10, -1, 1, -1, 1, BlockId.Stone);

    const body = makeBody(0.5, 11.0, 0.5);
    body.onGround = true;

    // Hold forward + sneak for 3 seconds
    for (let i = 0; i < 60; i++) {
      stepPhysics(
        world,
        body,
        { forward: 1, strafe: 0, jump: false, sneak: true, sprint: false },
        FIXED_DT
      );
    }

    expect(body.pos.y).toBeCloseTo(11.0, 2);
    expect(body.onGround).toBe(true);
    expect(body.pos.z).toBeGreaterThanOrEqual(-1.35);
  });

  it('DDA raycast hits target block with exact face normal and adjacent placement coordinate', () => {
    const world = new MockWorld();
    world.set(0, 64, -3, BlockId.OakLog);

    const origin = { x: 0.5, y: 64.5, z: 0.5 };
    const dir = lookDirection(0, 0); // pure -Z
    const hit = raycastVoxel(world, origin, dir, 5.0);

    expect(hit).not.toBeNull();
    expect(hit!.pos).toEqual({ x: 0, y: 64, z: -3 });
    expect(hit!.normal).toEqual({ x: 0, y: 0, z: 1 });
    expect(hit!.adjacent).toEqual({ x: 0, y: 64, z: -2 });
    expect(hit!.blockId).toBe(BlockId.OakLog);
  });

  it('doesBlockIntersectPlayer blocks placing a solid cube inside player AABB', () => {
    const playerPos = { x: 2.5, y: 65.0, z: 2.5 };
    expect(doesBlockIntersectPlayer(2, 65, 2, 1.0, playerPos)).toBe(true);
    expect(doesBlockIntersectPlayer(2, 66, 2, 1.0, playerPos)).toBe(true);
    expect(doesBlockIntersectPlayer(2, 64, 2, 1.0, playerPos)).toBe(false);
    expect(doesBlockIntersectPlayer(4, 65, 2, 1.0, playerPos)).toBe(false);
  });
});
