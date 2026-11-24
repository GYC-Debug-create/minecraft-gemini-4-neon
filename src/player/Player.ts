import { BALANCE } from '../config/balance';
import { BlockPos, PlayerStateSnapshot, Vec3 } from '../core/types';
import { BlockId } from '../registry/blocks';
import { Inventory } from './Inventory';
import { PhysicsBody } from './Physics';

export interface MiningState {
  target: BlockPos | null;
  blockId: BlockId;
  elapsedSec: number;
  requiredSec: number;
}

export class Player implements PhysicsBody {
  pos: Vec3;
  vel: Vec3 = { x: 0, y: 0, z: 0 };
  yaw = 0;
  pitch = 0;
  readonly width = BALANCE.player.width;
  readonly height = BALANCE.player.height;

  onGround = false;
  inWater = false;
  headInWater = false;
  onLadder = false;
  flying = false;
  sneaking = false;
  sprinting = false;

  health: number = BALANCE.player.maxHealth;
  maxHealth: number = BALANCE.player.maxHealth;
  hunger: number = BALANCE.player.maxHunger;
  maxHunger: number = BALANCE.player.maxHunger;
  saturation = 5;
  oxygen: number = BALANCE.player.maxOxygen;
  maxOxygen: number = BALANCE.player.maxOxygen;

  spawnPoint: Vec3;
  dead = false;
  deathCount = 0;
  invincibilityTicks = 0;
  hurtFlashSec = 0;
  attackCooldownTicks = 0;
  fallPeakY: number;
  bowChargeSec = 0;
  chargingBow = false;

  readonly inventory = new Inventory();

  mining: MiningState = {
    target: null,
    blockId: BlockId.Air,
    elapsedSec: 0,
    requiredSec: 1,
  };

  constructor(spawn: Vec3) {
    this.pos = { ...spawn };
    this.spawnPoint = { ...spawn };
    this.fallPeakY = spawn.y;
  }

  get selectedSlot(): number {
    return this.inventory.selectedSlot;
  }

  set selectedSlot(slot: number) {
    this.inventory.selectHotbar(slot);
  }

  get armorDefense(): number {
    return this.inventory.getTotalArmorDefense();
  }

  getEyePosition(): Vec3 {
    const eyeH = this.sneaking ? BALANCE.player.sneakEyeHeight : BALANCE.player.eyeHeight;
    return { x: this.pos.x, y: this.pos.y + eyeH, z: this.pos.z };
  }

  resetMining(): void {
    this.mining.target = null;
    this.mining.blockId = BlockId.Air;
    this.mining.elapsedSec = 0;
    this.mining.requiredSec = 1;
  }

  toSnapshot(): PlayerStateSnapshot {
    return {
      pos: { ...this.pos },
      vel: { ...this.vel },
      yaw: this.yaw,
      pitch: this.pitch,
      onGround: this.onGround,
      inWater: this.inWater,
      headInWater: this.headInWater,
      sneaking: this.sneaking,
      sprinting: this.sprinting,
      flying: this.flying,
      health: this.health,
      maxHealth: this.maxHealth,
      hunger: this.hunger,
      maxHunger: this.maxHunger,
      saturation: this.saturation,
      oxygen: this.oxygen,
      maxOxygen: this.maxOxygen,
      armorDefense: this.armorDefense,
      selectedSlot: this.inventory.selectedSlot,
      spawnPoint: { ...this.spawnPoint },
      dead: this.dead,
      deathCount: this.deathCount,
    };
  }
}
