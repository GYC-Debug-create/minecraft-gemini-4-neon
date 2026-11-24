import { EntitySnapshot, Vec3 } from '../core/types';
import { BlockRegistry } from '../registry/blocks';
import { CollisionWorld } from '../player/Physics';
import { Entity } from './EntitySystem';

export interface ArrowContext {
  world: CollisionWorld;
  onHitEntity: (arrow: ArrowEntity, pos: Vec3) => boolean;
}

export class ArrowEntity implements Entity {
  readonly id: number;
  readonly kind = 'arrow' as const;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  readonly width = 0.25;
  readonly height = 0.25;
  readonly damage: number;
  readonly owner: 'player' | 'mob';
  readonly ownerId: number;
  alive = true;
  ageTicks = 0;
  stuck = false;

  private readonly ctx: ArrowContext;

  constructor(
    id: number,
    pos: Vec3,
    vel: Vec3,
    damage: number,
    owner: 'player' | 'mob',
    ownerId: number,
    ctx: ArrowContext
  ) {
    this.id = id;
    this.pos = { ...pos };
    this.vel = { ...vel };
    this.damage = damage;
    this.owner = owner;
    this.ownerId = ownerId;
    this.ctx = ctx;
    this.yaw = Math.atan2(-vel.x, -vel.z);
    this.pitch = Math.atan2(vel.y, Math.hypot(vel.x, vel.z));
  }

  update(dt: number): void {
    if (!this.alive) return;
    if (this.ageTicks > 300) {
      this.alive = false;
      return;
    }
    if (this.stuck) return;

    // Parabolic gravity & slight drag
    this.vel.y -= 16.5 * dt;
    this.vel.x *= 0.992;
    this.vel.z *= 0.992;

    const steps = 4;
    const subDt = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.pos.x += this.vel.x * subDt;
      this.pos.y += this.vel.y * subDt;
      this.pos.z += this.vel.z * subDt;

      if (this.ctx.onHitEntity(this, this.pos)) {
        this.alive = false;
        return;
      }

      const b = this.ctx.world.getBlock(
        Math.floor(this.pos.x),
        Math.floor(this.pos.y),
        Math.floor(this.pos.z)
      );
      if (BlockRegistry.isSolid(b)) {
        this.stuck = true;
        this.vel.x = 0;
        this.vel.y = 0;
        this.vel.z = 0;
        return;
      }
    }

    this.yaw = Math.atan2(-this.vel.x, -this.vel.z);
    this.pitch = Math.atan2(this.vel.y, Math.hypot(this.vel.x, this.vel.z));
  }

  toSnapshot(): EntitySnapshot {
    return {
      id: this.id,
      kind: this.kind,
      pos: { ...this.pos },
    };
  }
}
