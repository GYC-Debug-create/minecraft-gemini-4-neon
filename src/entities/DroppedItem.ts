import { BALANCE } from '../config/balance';
import { EntitySnapshot, ItemStack, Vec3 } from '../core/types';
import { BlockRegistry } from '../registry/blocks';
import { ItemRegistry } from '../registry/items';
import { canStacksMerge, cloneStack } from '../player/Inventory';
import { CollisionWorld } from '../player/Physics';
import { Entity } from './EntitySystem';

export interface DroppedItemContext {
  world: CollisionWorld;
  getPlayerPos: () => Vec3;
  onPickup: (stack: ItemStack) => number; // returns remaining count
  getNearbyDrops: () => DroppedItemEntity[];
}

export class DroppedItemEntity implements Entity {
  readonly id: number;
  readonly kind = 'dropped_item' as const;
  pos: Vec3;
  vel: Vec3;
  yaw = 0;
  readonly width = 0.35;
  readonly height = 0.35;
  alive = true;
  ageTicks = 0;
  stack: ItemStack;
  pickupDelayTicks: number;

  private readonly ctx: DroppedItemContext;

  constructor(
    id: number,
    pos: Vec3,
    vel: Vec3,
    stack: ItemStack,
    ctx: DroppedItemContext,
    pickupDelayTicks: number = BALANCE.drops.pickupDelayTicks
  ) {
    this.id = id;
    this.pos = { ...pos };
    this.vel = { ...vel };
    this.stack = cloneStack(stack)!;
    this.ctx = ctx;
    this.pickupDelayTicks = pickupDelayTicks;
  }

  update(dt: number): void {
    if (!this.alive) return;

    if (this.ageTicks >= BALANCE.drops.despawnTicks) {
      this.alive = false;
      return;
    }

    this.yaw += dt * 2.2;

    // Gravity & simple voxel ground/wall settle
    this.vel.y = Math.max(-22, this.vel.y - 18 * dt);

    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    const curY = Math.floor(this.pos.y + 0.1);
    if (!BlockRegistry.isSolid(this.ctx.world.getBlock(Math.floor(nx), curY, Math.floor(this.pos.z)))) {
      this.pos.x = nx;
    } else {
      this.vel.x = 0;
    }
    if (!BlockRegistry.isSolid(this.ctx.world.getBlock(Math.floor(this.pos.x), curY, Math.floor(nz)))) {
      this.pos.z = nz;
    } else {
      this.vel.z = 0;
    }

    const ny = this.pos.y + this.vel.y * dt;
    const belowId = this.ctx.world.getBlock(Math.floor(this.pos.x), Math.floor(ny), Math.floor(this.pos.z));
    if (this.vel.y <= 0 && BlockRegistry.isSolid(belowId)) {
      const h = BlockRegistry.getHeight(belowId);
      const top = Math.floor(ny) + h;
      if (ny <= top + 0.05) {
        this.pos.y = top + 0.02;
        this.vel.y = 0;
        this.vel.x *= 0.72;
        this.vel.z *= 0.72;
      } else {
        this.pos.y = ny;
      }
    } else {
      this.pos.y = Math.max(1, ny);
      this.vel.x *= 0.96;
      this.vel.z *= 0.96;
    }

    // Merge with nearby identical dropped stacks periodically
    if (this.ageTicks % 6 === 0) {
      const def = ItemRegistry.get(this.stack.itemId);
      const maxStack = def?.maxStack ?? 64;
      if (maxStack > 1 && this.stack.count < maxStack) {
        for (const other of this.ctx.getNearbyDrops()) {
          if (other === this || !other.alive || other.id < this.id) continue;
          if (!canStacksMerge(this.stack, other.stack)) continue;
          const dist = Math.hypot(
            other.pos.x - this.pos.x,
            other.pos.y - this.pos.y,
            other.pos.z - this.pos.z
          );
          if (dist <= BALANCE.drops.mergeRadius) {
            const take = Math.min(other.stack.count, maxStack - this.stack.count);
            if (take > 0) {
              this.stack.count += take;
              other.stack.count -= take;
              if (other.stack.count <= 0) other.alive = false;
            }
          }
        }
      }
    }

    // Magnet pull & pickup into player inventory
    if (this.pickupDelayTicks > 0) {
      this.pickupDelayTicks--;
      return;
    }

    const p = this.ctx.getPlayerPos();
    const dx = p.x - this.pos.x;
    const dy = p.y + 0.85 - this.pos.y;
    const dz = p.z - this.pos.z;
    const dist = Math.hypot(dx, dy, dz);

    if (dist <= BALANCE.drops.pickupRadius) {
      const leftover = this.ctx.onPickup(this.stack);
      if (leftover <= 0) {
        this.alive = false;
      } else {
        this.stack.count = leftover;
      }
      return;
    }

    if (dist <= BALANCE.drops.magnetRadius && dist > 0.01) {
      const pull = 9.5;
      this.vel.x = (dx / dist) * pull;
      this.vel.y = (dy / dist) * pull;
      this.vel.z = (dz / dist) * pull;
    }
  }

  toSnapshot(): EntitySnapshot {
    return {
      id: this.id,
      kind: this.kind,
      pos: { ...this.pos },
      itemId: this.stack.itemId,
      count: this.stack.count,
    };
  }
}
