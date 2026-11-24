import { BALANCE } from '../config/balance';
import { BlockPos, PlayerStateSnapshot, Vec3 } from '../core/types';
import { BlockId } from '../registry/blocks';
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
  armorDefense = 0;

  spawnPoint: Vec3;
  dead = false;
  deathCount = 0;
  invincibilityTicks = 0;
  hurtFlashSec = 0;
  attackCooldownTicks = 0;

  selectedSlot = 0;
  /** Lightweight block pocket for M2 prior to full M4 Inventory replacement */
  pocketBlocks: Array<{ blockId: BlockId; count: number } | null> = new Array(9).fill(null);

  mining: MiningState = {
    target: null,
    blockId: BlockId.Air,
    elapsedSec: 0,
    requiredSec: 1,
  };

  constructor(spawn: Vec3) {
    this.pos = { ...spawn };
    this.spawnPoint = { ...spawn };
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

  addPocketBlock(blockId: BlockId): void {
    for (let i = 0; i < this.pocketBlocks.length; i++) {
      const slot = this.pocketBlocks[i];
      if (slot && slot.blockId === blockId && slot.count < 64) {
        slot.count++;
        return;
      }
    }
    for (let i = 0; i < this.pocketBlocks.length; i++) {
      if (!this.pocketBlocks[i]) {
        this.pocketBlocks[i] = { blockId, count: 1 };
        return;
      }
    }
  }

  consumeSelectedPocketBlock(): BlockId | null {
    const slot = this.pocketBlocks[this.selectedSlot];
    if (!slot || slot.count <= 0) return null;
    const id = slot.blockId;
    slot.count--;
    if (slot.count <= 0) {
      this.pocketBlocks[this.selectedSlot] = null;
    }
    return id;
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
      selectedSlot: this.selectedSlot,
      spawnPoint: { ...this.spawnPoint },
      dead: this.dead,
      deathCount: this.deathCount,
    };
  }
}
