import { BALANCE } from '../config/balance';
import { SeededRNG } from '../core/rng';
import { BlockPos, EntitySnapshot, Vec3 } from '../core/types';
import { BlockId, BlockRegistry } from '../registry/blocks';
import { rollMobDrops } from '../registry/loot';
import { ItemStack } from '../core/types';
import { PhysicsBody, stepPhysics } from '../player/Physics';
import { World } from '../world/World';
import { Entity } from './EntitySystem';
import { findPath } from './Pathfinding';

export type PassiveMobKind = 'boar' | 'ram' | 'fowl';
export type HostileMobKind = 'husk' | 'bone_archer' | 'gloom_spider';
export type MobKind = PassiveMobKind | HostileMobKind;

export function isHostileMobKind(kind: string): kind is HostileMobKind {
  return kind === 'husk' || kind === 'bone_archer' || kind === 'gloom_spider';
}

export function isPassiveMobKind(kind: string): kind is PassiveMobKind {
  return kind === 'boar' || kind === 'ram' || kind === 'fowl';
}

export interface MobContext {
  world: World;
  getPlayerPos: () => Vec3;
  isPlayerAlive: () => boolean;
  isDaytime: () => boolean;
  onDamagePlayer: (amount: number, source: string, knockbackDir: Vec3) => void;
  onShootArrow: (origin: Vec3, vel: Vec3, damage: number, shooterId: number) => void;
  onMobDied: (mob: MobEntity, drops: ItemStack[]) => void;
}

interface MobSpec {
  maxHealth: number;
  width: number;
  height: number;
  speed: number;
  hostile: boolean;
  burnsInSun: boolean;
  canClimb: boolean;
  ranged: boolean;
  aggroRange: number;
  attackRange: number;
  damage: number;
  attackCooldownTicks: number;
}

const MOB_SPECS: Record<MobKind, MobSpec> = {
  boar: {
    maxHealth: BALANCE.mobs.boar.maxHealth,
    width: 0.75,
    height: 0.85,
    speed: BALANCE.mobs.boar.speed,
    hostile: false,
    burnsInSun: false,
    canClimb: false,
    ranged: false,
    aggroRange: 0,
    attackRange: 0,
    damage: 0,
    attackCooldownTicks: 20,
  },
  ram: {
    maxHealth: BALANCE.mobs.ram.maxHealth,
    width: 0.75,
    height: 1.05,
    speed: BALANCE.mobs.ram.speed,
    hostile: false,
    burnsInSun: false,
    canClimb: false,
    ranged: false,
    aggroRange: 0,
    attackRange: 0,
    damage: 0,
    attackCooldownTicks: 20,
  },
  fowl: {
    maxHealth: BALANCE.mobs.fowl.maxHealth,
    width: 0.5,
    height: 0.65,
    speed: BALANCE.mobs.fowl.speed,
    hostile: false,
    burnsInSun: false,
    canClimb: false,
    ranged: false,
    aggroRange: 0,
    attackRange: 0,
    damage: 0,
    attackCooldownTicks: 20,
  },
  husk: {
    maxHealth: BALANCE.mobs.husk.maxHealth,
    width: 0.65,
    height: 1.85,
    speed: BALANCE.mobs.husk.speed,
    hostile: true,
    burnsInSun: true,
    canClimb: false,
    ranged: false,
    aggroRange: BALANCE.mobs.husk.aggroRange,
    attackRange: BALANCE.mobs.husk.attackRange,
    damage: BALANCE.mobs.husk.damage,
    attackCooldownTicks: BALANCE.mobs.husk.attackCooldownTicks,
  },
  bone_archer: {
    maxHealth: BALANCE.mobs.bone_archer.maxHealth,
    width: 0.6,
    height: 1.85,
    speed: BALANCE.mobs.bone_archer.speed,
    hostile: true,
    burnsInSun: true,
    canClimb: false,
    ranged: true,
    aggroRange: BALANCE.mobs.bone_archer.aggroRange,
    attackRange: BALANCE.mobs.bone_archer.preferredRange,
    damage: BALANCE.mobs.bone_archer.damage,
    attackCooldownTicks: BALANCE.mobs.bone_archer.shootCooldownTicks,
  },
  gloom_spider: {
    maxHealth: BALANCE.mobs.gloom_spider.maxHealth,
    width: 1.05,
    height: 0.85,
    speed: BALANCE.mobs.gloom_spider.speed,
    hostile: true,
    burnsInSun: false,
    canClimb: true,
    ranged: false,
    aggroRange: BALANCE.mobs.gloom_spider.aggroRange,
    attackRange: BALANCE.mobs.gloom_spider.attackRange,
    damage: BALANCE.mobs.gloom_spider.damage,
    attackCooldownTicks: BALANCE.mobs.gloom_spider.attackCooldownTicks,
  },
};

export class MobEntity implements Entity, PhysicsBody {
  readonly id: number;
  readonly kind: MobKind;
  readonly spec: MobSpec;
  readonly width: number;
  readonly height: number;

  pos: Vec3;
  vel: Vec3 = { x: 0, y: 0, z: 0 };
  yaw = 0;
  onGround = false;
  inWater = false;
  headInWater = false;
  onLadder = false;
  flying = false;
  sneaking = false;
  sprinting = false;

  alive = true;
  ageTicks = 0;
  health: number;
  maxHealth: number;
  invincibilityTicks = 0;
  hurtFlashTicks = 0;
  burning = false;
  walkPhase = 0;

  private readonly ctx: MobContext;
  private readonly rng: SeededRNG;
  private path: BlockPos[] = [];
  private pathTimerTicks = 0;
  private attackCooldown = 0;
  private burnTickCounter = 0;
  private wanderAngle = 0;
  private wanderTicks = 0;
  private fleeTicks = 0;
  private provoked = false;
  private knockbackVel: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(id: number, kind: MobKind, pos: Vec3, ctx: MobContext, seed?: number) {
    this.id = id;
    this.kind = kind;
    this.spec = MOB_SPECS[kind];
    this.width = this.spec.width;
    this.height = this.spec.height;
    this.maxHealth = this.spec.maxHealth;
    this.health = this.spec.maxHealth;
    this.pos = { ...pos };
    this.ctx = ctx;
    this.rng = new SeededRNG((seed ?? id * 2654435761) >>> 0);
    this.wanderAngle = this.rng.range(0, Math.PI * 2);
  }

  takeDamage(amount: number, knockbackDir?: Vec3, fromPlayer = true): boolean {
    if (!this.alive || this.invincibilityTicks > 0 || amount <= 0) return false;
    this.health = Math.max(0, this.health - amount);
    this.invincibilityTicks = 8;
    this.hurtFlashTicks = 7;

    if (fromPlayer) {
      if (this.kind === 'gloom_spider') this.provoked = true;
      if (!this.spec.hostile) this.fleeTicks = 80;
    }

    if (knockbackDir) {
      const len = Math.hypot(knockbackDir.x, knockbackDir.z) || 1;
      this.knockbackVel.x = (knockbackDir.x / len) * BALANCE.mobs.knockbackHorizontal;
      this.knockbackVel.z = (knockbackDir.z / len) * BALANCE.mobs.knockbackHorizontal;
      this.vel.y = Math.max(this.vel.y, BALANCE.mobs.knockbackVertical);
      this.onGround = false;
    }

    if (this.health <= 0) {
      this.alive = false;
      const drops = rollMobDrops(this.kind, this.rng);
      this.ctx.onMobDied(this, drops);
    }
    return true;
  }

  private hasLineOfSight(from: Vec3, to: Vec3): boolean {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const dist = Math.hypot(dx, dy, dz);
    const steps = Math.max(2, Math.ceil(dist * 2.5));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const bx = Math.floor(from.x + dx * t);
      const by = Math.floor(from.y + dy * t);
      const bz = Math.floor(from.z + dz * t);
      const b = this.ctx.world.getBlock(bx, by, bz);
      if (b !== BlockId.Air && !BlockRegistry.isTransparent(b)) return false;
    }
    return true;
  }

  update(dt: number): void {
    if (!this.alive) return;

    if (this.invincibilityTicks > 0) this.invincibilityTicks--;
    if (this.hurtFlashTicks > 0) this.hurtFlashTicks--;
    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.fleeTicks > 0) this.fleeTicks--;

    // 1. Sunlight burning for Ash Husk & Hollow Archer
    const isDay = this.ctx.isDaytime();
    if (this.spec.burnsInSun && isDay && !this.inWater) {
      const sky = this.ctx.world.getSkyLight(this.pos.x, this.pos.y + this.height * 0.8, this.pos.z);
      if (sky >= 13) {
        this.burning = true;
        this.burnTickCounter++;
        if (this.burnTickCounter >= BALANCE.survival.sunBurnIntervalTicks) {
          this.burnTickCounter = 0;
          this.takeDamage(BALANCE.survival.sunBurnDamage, undefined, false);
          if (!this.alive) return;
        }
      } else {
        this.burning = false;
      }
    } else {
      this.burning = false;
    }

    // 2. AI decision (hostile chase / ranged / spider neutral-in-day / passive wander & flee)
    const playerPos = this.ctx.getPlayerPos();
    const dxP = playerPos.x - this.pos.x;
    const dyP = playerPos.y - this.pos.y;
    const dzP = playerPos.z - this.pos.z;
    const distToPlayer = Math.hypot(dxP, dyP, dzP);

    let desiredDirX = 0;
    let desiredDirZ = 0;
    let moveSpeed = this.spec.speed;
    let wantJump = false;

    const spiderAggressive =
      this.kind !== 'gloom_spider' ||
      this.provoked ||
      !isDay ||
      this.ctx.world.getSkyLight(this.pos.x, this.pos.y + 0.5, this.pos.z) < 8;

    const shouldChase =
      this.spec.hostile &&
      spiderAggressive &&
      this.ctx.isPlayerAlive() &&
      distToPlayer <= this.spec.aggroRange;

    if (shouldChase) {
      // Face player
      this.yaw = Math.atan2(-dxP, -dzP);

      // Recompute A* path periodically
      this.pathTimerTicks--;
      if (this.pathTimerTicks <= 0) {
        this.pathTimerTicks = BALANCE.mobs.pathfindRepathTicks;
        const res = findPath(
          this.ctx.world,
          { x: Math.floor(this.pos.x), y: Math.floor(this.pos.y), z: Math.floor(this.pos.z) },
          { x: Math.floor(playerPos.x), y: Math.floor(playerPos.y), z: Math.floor(playerPos.z) },
          {
            maxNodes: BALANCE.mobs.pathfindMaxNodes,
            canClimb: this.spec.canClimb,
            toleranceDist: this.spec.ranged ? 4 : 1,
          }
        );
        this.path = res.path;
      }

      if (this.spec.ranged) {
        // Hollow Archer standoff + bow shot
        const eyeFrom = { x: this.pos.x, y: this.pos.y + 1.5, z: this.pos.z };
        const eyeTo = { x: playerPos.x, y: playerPos.y + 1.1, z: playerPos.z };
        const hasLOS = distToPlayer <= 18 && this.hasLineOfSight(eyeFrom, eyeTo);

        if (hasLOS && distToPlayer <= 14) {
          // Strafe / back up if too close
          if (distToPlayer < 6) {
            desiredDirX = -dxP / (distToPlayer || 1);
            desiredDirZ = -dzP / (distToPlayer || 1);
          }
          if (this.attackCooldown <= 0) {
            this.attackCooldown = this.spec.attackCooldownTicks;
            const speed = 22;
            const flightTime = distToPlayer / speed;
            const aimDx = eyeTo.x - eyeFrom.x;
            const aimDy = eyeTo.y - eyeFrom.y + 0.5 * 16.5 * flightTime * flightTime;
            const aimDz = eyeTo.z - eyeFrom.z;
            const aimLen = Math.hypot(aimDx, aimDy, aimDz) || 1;
            this.ctx.onShootArrow(
              eyeFrom,
              { x: (aimDx / aimLen) * speed, y: (aimDy / aimLen) * speed, z: (aimDz / aimLen) * speed },
              this.spec.damage,
              this.id
            );
          }
        } else {
          // Close distance via A* path
          const move = this.followPath(playerPos);
          desiredDirX = move.dx;
          desiredDirZ = move.dz;
          wantJump = move.jump;
        }
      } else {
        // Melee chaser (Ash Husk & Gloom Spider)
        if (distToPlayer <= this.spec.attackRange) {
          if (this.attackCooldown <= 0) {
            this.attackCooldown = this.spec.attackCooldownTicks;
            this.ctx.onDamagePlayer(this.spec.damage, this.kind, { x: dxP, y: 0, z: dzP });
          }
        } else {
          const move = this.followPath(playerPos);
          desiredDirX = move.dx;
          desiredDirZ = move.dz;
          wantJump = move.jump;
        }
      }
    } else if (!this.spec.hostile && this.fleeTicks > 0 && distToPlayer < 16) {
      // Passive mob flees away from player
      const len = Math.hypot(dxP, dzP) || 1;
      desiredDirX = -dxP / len;
      desiredDirZ = -dzP / len;
      this.yaw = Math.atan2(-desiredDirX, -desiredDirZ);
      moveSpeed = this.spec.speed * 1.65;
    } else {
      // Casual wandering
      this.wanderTicks--;
      if (this.wanderTicks <= 0) {
        this.wanderTicks = this.rng.int(40, 110);
        if (this.rng.chance(0.4)) {
          this.wanderAngle = -1; // pause briefly
        } else {
          this.wanderAngle = this.rng.range(0, Math.PI * 2);
        }
      }
      if (this.wanderAngle >= 0) {
        desiredDirX = Math.sin(this.wanderAngle);
        desiredDirZ = Math.cos(this.wanderAngle);
        this.yaw = Math.atan2(-desiredDirX, -desiredDirZ);
        moveSpeed = this.spec.speed * 0.55;
      }
    }

    // Apply movement & knockback through shared Physics engine
    const totalVx = desiredDirX * moveSpeed + this.knockbackVel.x;
    const totalVz = desiredDirZ * moveSpeed + this.knockbackVel.z;
    this.knockbackVel.x *= 0.72;
    this.knockbackVel.z *= 0.72;
    if (Math.abs(this.knockbackVel.x) < 0.05) this.knockbackVel.x = 0;
    if (Math.abs(this.knockbackVel.z) < 0.05) this.knockbackVel.z = 0;

    // Convert desired world velocity into forward/strafe in mob's local yaw frame
    const speedMag = Math.hypot(totalVx, totalVz);
    const savedYaw = this.yaw;
    if (speedMag > 0.05) {
      this.yaw = Math.atan2(-totalVx, -totalVz);
    }

    // Scale forward so Physics walkSpeed produces our mob's exact moveSpeed
    const forwardRatio = Math.min(1.6, speedMag / BALANCE.player.walkSpeed);
    const res = stepPhysics(
      this.ctx.world,
      this,
      {
        forward: forwardRatio,
        strafe: 0,
        jump: wantJump || (this.inWater && this.rng.chance(0.5)),
        sneak: false,
        sprint: false,
      },
      dt,
      false
    );

    // Gloom Spider vertical wall-climbing when blocked horizontally while chasing!
    if (this.spec.canClimb && shouldChase && (res.collidedX || res.collidedZ)) {
      this.vel.y = 4.2;
      this.onGround = false;
    } else if (this.onGround && (res.collidedX || res.collidedZ) && speedMag > 0.4) {
      // Auto-hop over 1-block ledges when blocked
      this.vel.y = BALANCE.player.jumpVelocity * 0.92;
      this.onGround = false;
    }

    // Fowl gentle gliding fall
    if (this.kind === 'fowl' && this.vel.y < -3.0) {
      this.vel.y = -3.0;
    }

    this.yaw = savedYaw;
    if (res.horizontalDistance > 0.01) {
      this.walkPhase += res.horizontalDistance * 3.5;
    }
  }

  private followPath(targetFallback: Vec3): { dx: number; dz: number; jump: boolean } {
    while (this.path.length > 0) {
      const wp = this.path[0];
      const dist = Math.hypot(wp.x + 0.5 - this.pos.x, wp.z + 0.5 - this.pos.z);
      if (dist < 0.55 && Math.abs(wp.y - this.pos.y) <= 1.2) {
        this.path.shift();
      } else {
        break;
      }
    }

    const goal =
      this.path.length > 0
        ? { x: this.path[0].x + 0.5, y: this.path[0].y, z: this.path[0].z + 0.5 }
        : targetFallback;

    const dx = goal.x - this.pos.x;
    const dz = goal.z - this.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    return {
      dx: dx / len,
      dz: dz / len,
      jump: goal.y > this.pos.y + 0.45 && this.onGround,
    };
  }

  toSnapshot(): EntitySnapshot {
    return {
      id: this.id,
      kind: this.kind,
      pos: { ...this.pos },
      health: this.health,
    };
  }
}
