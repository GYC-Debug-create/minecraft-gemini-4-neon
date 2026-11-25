import { BALANCE } from '../config/balance';
import { DAY_LENGTH_TICKS, WORLD_HEIGHT } from '../config/constants';
import { SeededRNG } from '../core/rng';
import { Vec3 } from '../core/types';
import { BlockId, BlockRegistry } from '../registry/blocks';
import { worldToChunkCoord } from '../world/Chunk';
import { World } from '../world/World';
import { EntitySystem } from './EntitySystem';
import { HostileMobKind, isHostileMobKind, isPassiveMobKind, MobContext, MobEntity, PassiveMobKind } from './Mob';

export function isDaytimeTick(worldTime: number): boolean {
  const tod = ((worldTime % DAY_LENGTH_TICKS) + DAY_LENGTH_TICKS) % DAY_LENGTH_TICKS;
  // 0..12000 = sunrise..dusk (day), 12000..23400 = night
  return tod < 12000 || tod >= 23400;
}

/**
 * Computes effective light at (x, y, z) for hostile mob spawning.
 * At night, outdoor sky light contributes 0, while torch block light STILL protects lit rooms!
 */
export function getEffectiveSpawnLight(
  world: World,
  x: number,
  y: number,
  z: number,
  isDaytime: boolean
): number {
  const blockLight = world.getBlockLight(x, y, z);
  const skyLight = isDaytime ? world.getSkyLight(x, y, z) : 0;
  return Math.max(blockLight, skyLight);
}

/**
 * Pure spawn rule check (unit-tested for SPEC M6 gate: light >= threshold NEVER spawns hostile mobs!).
 */
export function canHostileSpawnAt(
  world: World,
  x: number,
  y: number,
  z: number,
  isDaytime: boolean
): boolean {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  if (iy < 2 || iy >= WORLD_HEIGHT - 3) return false;
  if (!world.hasChunk(worldToChunkCoord(ix), worldToChunkCoord(iz))) return false;

  // Hard light gate: NEVER spawn if effective light >= hostileMaxLight (7)
  if (getEffectiveSpawnLight(world, ix, iy, iz, isDaytime) >= BALANCE.mobs.hostileMaxLight) {
    return false;
  }

  const floor = world.getBlock(ix, iy - 1, iz);
  if (
    !BlockRegistry.isSolid(floor, world.getMeta(ix, iy - 1, iz)) ||
    floor === BlockId.Bedrock ||
    floor === BlockId.OakLeaves ||
    floor === BlockId.BirchLeaves ||
    floor === BlockId.PineLeaves ||
    floor === BlockId.Glass
  ) {
    return false;
  }

  const b0 = world.getBlock(ix, iy, iz);
  const b1 = world.getBlock(ix, iy + 1, iz);
  if (b0 !== BlockId.Air || b1 !== BlockId.Air) return false;

  return true;
}

export function canPassiveSpawnAt(
  world: World,
  x: number,
  y: number,
  z: number,
  isDaytime: boolean
): boolean {
  if (!isDaytime) return false;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  if (iy < 55 || iy >= WORLD_HEIGHT - 3) return false;
  if (!world.hasChunk(worldToChunkCoord(ix), worldToChunkCoord(iz))) return false;

  if (world.getSkyLight(ix, iy, iz) < 10) return false;
  const floor = world.getBlock(ix, iy - 1, iz);
  if (floor !== BlockId.Grass && floor !== BlockId.SnowGrass) return false;
  return world.getBlock(ix, iy, iz) === BlockId.Air && world.getBlock(ix, iy + 1, iz) === BlockId.Air;
}

const HOSTILE_KINDS: readonly HostileMobKind[] = ['husk', 'bone_archer', 'gloom_spider'];
const PASSIVE_KINDS: readonly PassiveMobKind[] = ['boar', 'ram', 'fowl'];

export class MobSpawner {
  private tickCounter = 0;
  private readonly rng: SeededRNG;

  constructor(seed: number) {
    this.rng = new SeededRNG((seed ^ 0x9e3779b9) >>> 0);
  }

  tick(
    world: World,
    playerPos: Vec3,
    entities: EntitySystem,
    worldTime: number,
    ctx: MobContext,
    elapsedTicks = 1
  ): void {
    // Despawn mobs outside despawnDist
    let hostileCount = 0;
    let passiveCount = 0;
    for (const e of entities.all()) {
      if (!e.alive) continue;
      if (!isHostileMobKind(e.kind) && !isPassiveMobKind(e.kind)) continue;
      const dist = Math.hypot(e.pos.x - playerPos.x, e.pos.z - playerPos.z);
      if (dist > BALANCE.mobs.despawnDist) {
        e.alive = false;
        continue;
      }
      if (isHostileMobKind(e.kind)) hostileCount++;
      else passiveCount++;
    }

    this.tickCounter += elapsedTicks;
    if (this.tickCounter < BALANCE.mobs.spawnIntervalTicks) return;

    const rounds = Math.min(24, Math.floor(this.tickCounter / BALANCE.mobs.spawnIntervalTicks));
    this.tickCounter -= rounds * BALANCE.mobs.spawnIntervalTicks;
    const isDay = isDaytimeTick(worldTime);

    for (let r = 0; r < rounds; r++) {
      if (hostileCount < BALANCE.mobs.maxHostileCount) {
        if (this.trySpawnHostile(world, playerPos, entities, isDay, ctx)) {
          hostileCount++;
        }
      }
      if (isDay && passiveCount < BALANCE.mobs.maxPassiveCount) {
        if (this.trySpawnPassive(world, playerPos, entities, ctx)) {
          passiveCount++;
        }
      }
    }
  }

  private trySpawnHostile(
    world: World,
    playerPos: Vec3,
    entities: EntitySystem,
    isDay: boolean,
    ctx: MobContext
  ): boolean {
    for (let tries = 0; tries < 14; tries++) {
      const angle = this.rng.range(0, Math.PI * 2);
      const dist = this.rng.range(BALANCE.mobs.minSpawnDist, BALANCE.mobs.maxSpawnDist);
      const wx = Math.floor(playerPos.x + Math.cos(angle) * dist);
      const wz = Math.floor(playerPos.z + Math.sin(angle) * dist);
      if (!world.hasChunk(worldToChunkCoord(wx), worldToChunkCoord(wz))) continue;

      // Try surface first at night, or cave levels near player Y
      const candidatesY: number[] = [];
      if (!isDay) {
        const topY = world.getTopSolidY(wx, wz) + 1;
        candidatesY.push(topY);
      }
      const py = Math.floor(playerPos.y);
      candidatesY.push(py, py - 4, py + 4);

      for (const wy of candidatesY) {
        if (canHostileSpawnAt(world, wx, wy, wz, isDay)) {
          const kind = this.rng.pick(HOSTILE_KINDS);
          const id = entities.allocateId();
          const mob = new MobEntity(id, kind, { x: wx + 0.5, y: wy + 0.02, z: wz + 0.5 }, ctx);
          entities.add(mob);
          return true;
        }
      }
    }
    return false;
  }

  private trySpawnPassive(
    world: World,
    playerPos: Vec3,
    entities: EntitySystem,
    ctx: MobContext
  ): boolean {
    for (let tries = 0; tries < 8; tries++) {
      const angle = this.rng.range(0, Math.PI * 2);
      const dist = this.rng.range(16, 40);
      const wx = Math.floor(playerPos.x + Math.cos(angle) * dist);
      const wz = Math.floor(playerPos.z + Math.sin(angle) * dist);
      if (!world.hasChunk(worldToChunkCoord(wx), worldToChunkCoord(wz))) continue;

      const wy = world.getTopSolidY(wx, wz) + 1;
      if (canPassiveSpawnAt(world, wx, wy, wz, true)) {
        const kind = this.rng.pick(PASSIVE_KINDS);
        const id = entities.allocateId();
        const mob = new MobEntity(id, kind, { x: wx + 0.5, y: wy + 0.02, z: wz + 0.5 }, ctx);
        entities.add(mob);
        return true;
      }
    }
    return false;
  }
}
