import { BALANCE } from '../config/balance';
import { DAY_LENGTH_TICKS } from '../config/constants';
import { EventBus } from '../core/events';
import { ItemRegistry } from '../registry/items';
import { StepResult } from '../player/Physics';
import { Player } from '../player/Player';

export interface SurvivalCallbacks {
  onPlayerDied: (cause: string) => void;
}

export class SurvivalSystem {
  private regenTimerTicks = 0;
  private starveTimerTicks = 0;
  private drownTimerTicks = 0;
  private exhaustion = 0;

  resetTimers(): void {
    this.regenTimerTicks = 0;
    this.starveTimerTicks = 0;
    this.drownTimerTicks = 0;
    this.exhaustion = 0;
  }

  addMiningExhaustion(): void {
    this.exhaustion += BALANCE.survival.hungerDrainMine;
  }

  /**
   * Applies damage to the player with optional armor reduction and invincibility frames.
   */
  damagePlayer(
    player: Player,
    events: EventBus,
    amount: number,
    source: string,
    callbacks: SurvivalCallbacks,
    bypassArmor = false,
    bypassIframes = false
  ): boolean {
    if (player.dead || player.flying || amount <= 0) return false;
    if (!bypassIframes && player.invincibilityTicks > 0) return false;

    let finalDamage = amount;
    if (!bypassArmor) {
      finalDamage = Math.max(0.5, amount * player.inventory.getArmorDamageMultiplier());
      if (player.inventory.getTotalArmorDefense() > 0) {
        player.inventory.damageArmor(1);
      }
    }

    player.health = Math.max(0, player.health - finalDamage);
    player.hurtFlashSec = 0.35;
    if (!bypassIframes) {
      player.invincibilityTicks = BALANCE.player.invincibilityTicks;
    }

    events.emit('player:damaged', { amount: finalDamage, source, health: player.health });
    events.emit('sound:play', { name: 'hurt', volume: 0.9 });

    if (player.health <= 0) {
      player.dead = true;
      player.deathCount++;
      player.vel.x = 0;
      player.vel.y = 0;
      player.vel.z = 0;
      events.emit('player:died', { pos: { ...player.pos }, cause: source });
      callbacks.onPlayerDied(source);
    }

    return true;
  }

  /**
   * Attempts to eat the currently selected hotbar food item. Returns true if consumed.
   */
  eatSelectedFood(player: Player, events: EventBus): boolean {
    if (player.dead || player.hunger >= player.maxHunger) return false;
    const held = player.inventory.getSelected();
    if (!held) return false;
    const def = ItemRegistry.get(held.itemId);
    if (!def?.foodRestore) return false;

    const consumed = player.inventory.consumeSelected(1);
    if (!consumed) return false;

    player.hunger = Math.min(player.maxHunger, player.hunger + def.foodRestore);
    player.saturation = Math.min(
      player.hunger,
      player.saturation + (def.saturationRestore ?? def.foodRestore * 0.6)
    );
    events.emit('sound:play', { name: 'eat', volume: 0.7 });
    events.emit('inventory:changed', {});
    return true;
  }

  /**
   * Respawns a dead player at their spawnPoint with restored vitals.
   */
  respawnPlayer(player: Player, events: EventBus): void {
    player.dead = false;
    player.health = player.maxHealth;
    player.hunger = player.maxHunger;
    player.saturation = 5;
    player.oxygen = player.maxOxygen;
    player.invincibilityTicks = 20;
    player.hurtFlashSec = 0;
    player.pos = { ...player.spawnPoint };
    player.vel = { x: 0, y: 0, z: 0 };
    player.fallPeakY = player.pos.y;
    this.resetTimers();
    events.emit('player:respawned', { pos: { ...player.pos } });
  }

  /**
   * Uses a Camp Bed: always sets respawn point; if nighttime, advances worldTime to dawn.
   * Returns `{ slept, newWorldTime }`.
   */
  useBed(
    player: Player,
    bedX: number,
    bedY: number,
    bedZ: number,
    worldTime: number
  ): { slept: boolean; newWorldTime: number } {
    player.spawnPoint = { x: bedX + 0.5, y: bedY + 0.65, z: bedZ + 0.5 };
    const tod = ((worldTime % DAY_LENGTH_TICKS) + DAY_LENGTH_TICKS) % DAY_LENGTH_TICKS;
    if (tod >= 11800 && tod <= 23500) {
      const nextDayBase = Math.floor(worldTime / DAY_LENGTH_TICKS) * DAY_LENGTH_TICKS + DAY_LENGTH_TICKS;
      return { slept: true, newWorldTime: nextDayBase + 800 };
    }
    return { slept: false, newWorldTime: worldTime };
  }

  /**
   * Ticks survival mechanics once per fixed 20Hz simulation step.
   */
  tick(
    player: Player,
    stepResult: StepResult,
    jumped: boolean,
    dt: number,
    events: EventBus,
    callbacks: SurvivalCallbacks
  ): void {
    if (player.invincibilityTicks > 0) player.invincibilityTicks--;
    if (player.hurtFlashSec > 0) player.hurtFlashSec = Math.max(0, player.hurtFlashSec - dt);
    if (player.attackCooldownTicks > 0) player.attackCooldownTicks--;

    if (player.dead || player.flying) {
      player.fallPeakY = player.pos.y;
      return;
    }

    // 1. Fall damage tracking
    if (player.inWater || player.onLadder) {
      player.fallPeakY = player.pos.y;
    } else if (!player.onGround) {
      if (player.pos.y > player.fallPeakY) {
        player.fallPeakY = player.pos.y;
      }
    } else {
      if (stepResult.landed) {
        const fallDist = player.fallPeakY - player.pos.y;
        if (fallDist > BALANCE.player.fallDamageSafeHeight) {
          const dmg = Math.ceil((fallDist - BALANCE.player.fallDamageSafeHeight) * BALANCE.player.fallDamagePerBlock);
          this.damagePlayer(player, events, dmg, 'fall', callbacks, true, true);
        }
      }
      player.fallPeakY = player.pos.y;
    }

    if (player.dead) return;

    // 2. Hunger & Exhaustion
    const drainRate = player.sprinting
      ? BALANCE.survival.hungerDrainSprintPerMeter
      : BALANCE.survival.hungerDrainWalkPerMeter;
    this.exhaustion += stepResult.horizontalDistance * drainRate + BALANCE.survival.hungerDrainIdlePerSec * dt;
    if (jumped) this.exhaustion += BALANCE.survival.hungerDrainJump;

    if (this.exhaustion >= 0.4) {
      const chunks = Math.floor(this.exhaustion / 0.4);
      this.exhaustion -= chunks * 0.4;
      const loss = chunks * 0.25;
      if (player.saturation > 0) {
        player.saturation = Math.max(0, player.saturation - loss);
      } else {
        player.hunger = Math.max(0, player.hunger - loss);
      }
    }

    // Natural HP regen when well-fed
    if (player.hunger >= BALANCE.survival.hungerRegenMinHunger && player.health < player.maxHealth) {
      this.regenTimerTicks++;
      if (this.regenTimerTicks >= BALANCE.survival.hungerRegenIntervalTicks) {
        this.regenTimerTicks = 0;
        player.health = Math.min(player.maxHealth, player.health + 1);
        this.exhaustion += 0.35;
      }
    } else {
      this.regenTimerTicks = 0;
    }

    // Starvation damage when hunger hits 0
    if (player.hunger <= 0) {
      this.starveTimerTicks++;
      if (this.starveTimerTicks >= BALANCE.survival.starveIntervalTicks) {
        this.starveTimerTicks = 0;
        this.damagePlayer(player, events, BALANCE.survival.starveDamage, 'starvation', callbacks, true, true);
      }
    } else {
      this.starveTimerTicks = 0;
    }

    if (player.dead) return;

    // 3. Oxygen & Drowning
    if (player.headInWater) {
      player.oxygen = Math.max(0, player.oxygen - BALANCE.survival.oxygenDrainPerSec * dt);
      if (player.oxygen <= 0) {
        this.drownTimerTicks++;
        if (this.drownTimerTicks >= BALANCE.survival.drownIntervalTicks) {
          this.drownTimerTicks = 0;
          this.damagePlayer(player, events, BALANCE.survival.drownDamage, 'drowning', callbacks, true, true);
        }
      }
    } else {
      player.oxygen = Math.min(player.maxOxygen, player.oxygen + BALANCE.survival.oxygenRecoverPerSec * dt);
      this.drownTimerTicks = 0;
    }
  }
}
