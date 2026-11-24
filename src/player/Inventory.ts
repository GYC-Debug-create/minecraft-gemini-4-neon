import { BALANCE } from '../config/balance';
import { HOTBAR_SIZE, TOTAL_INVENTORY_SIZE } from '../config/constants';
import { ArmorSlot, InventorySnapshot, ItemStack } from '../core/types';
import { ItemId, ItemRegistry } from '../registry/items';

export const ARMOR_SLOTS: readonly ArmorSlot[] = ['helmet', 'chestplate', 'leggings', 'boots'];

export function cloneStack(stack: ItemStack | null): ItemStack | null {
  if (!stack) return null;
  return {
    itemId: stack.itemId,
    count: stack.count,
    ...(stack.durability !== undefined ? { durability: stack.durability } : {}),
  };
}

export function createItemStack(itemId: ItemId, count = 1, durability?: number): ItemStack {
  const def = ItemRegistry.get(itemId);
  const maxStack = def?.maxStack ?? 64;
  const clamped = Math.max(1, Math.min(maxStack, count));
  const dur = durability !== undefined ? durability : def?.durability;
  return {
    itemId,
    count: clamped,
    ...(dur !== undefined ? { durability: dur } : {}),
  };
}

export function canStacksMerge(a: ItemStack | null, b: ItemStack | null): boolean {
  if (!a || !b) return false;
  if (a.itemId !== b.itemId) return false;
  const def = ItemRegistry.get(a.itemId);
  if (!def || def.maxStack <= 1) return false;
  return a.durability === undefined && b.durability === undefined;
}

export class Inventory {
  readonly slots: Array<ItemStack | null> = new Array(TOTAL_INVENTORY_SIZE).fill(null);
  readonly armor: Record<ArmorSlot, ItemStack | null> = {
    helmet: null,
    chestplate: null,
    leggings: null,
    boots: null,
  };
  selectedSlot = 0;

  getSelected(): ItemStack | null {
    return this.slots[this.selectedSlot];
  }

  selectHotbar(slot: number): void {
    this.selectedSlot = ((Math.floor(slot) % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
  }

  /**
   * Attempts to add `stack` into inventory (hotbar first, then main), mutating or returning leftover count.
   * Returns remaining unadded count (0 means fully added).
   */
  addItem(itemId: ItemId, count = 1, durability?: number): number {
    const def = ItemRegistry.get(itemId);
    if (!def || count <= 0) return count;
    const maxStack = def.maxStack;
    let remaining = count;

    // 1. Merge into existing compatible stacks
    if (maxStack > 1 && durability === undefined) {
      for (let i = 0; i < TOTAL_INVENTORY_SIZE && remaining > 0; i++) {
        const cur = this.slots[i];
        if (cur && cur.itemId === itemId && cur.count < maxStack) {
          const take = Math.min(remaining, maxStack - cur.count);
          cur.count += take;
          remaining -= take;
        }
      }
    }

    // 2. Fill empty slots (hotbar 0..8 first, then main 9..35)
    for (let i = 0; i < TOTAL_INVENTORY_SIZE && remaining > 0; i++) {
      if (this.slots[i] === null) {
        const take = Math.min(remaining, maxStack);
        this.slots[i] = createItemStack(itemId, take, durability);
        remaining -= take;
      }
    }

    return remaining;
  }

  addStack(stack: ItemStack): number {
    return this.addItem(stack.itemId, stack.count, stack.durability);
  }

  countItem(itemId: ItemId): number {
    let total = 0;
    for (const s of this.slots) {
      if (s && s.itemId === itemId) total += s.count;
    }
    return total;
  }

  countTag(tag: 'planks' | 'logs'): number {
    let total = 0;
    for (const s of this.slots) {
      if (!s) continue;
      if (tag === 'planks' && ItemRegistry.isPlank(s.itemId)) total += s.count;
      if (tag === 'logs' && ItemRegistry.isLog(s.itemId)) total += s.count;
    }
    return total;
  }

  /** Removes `count` items matching `predicate`. Returns true if full amount was removed. */
  consumeWhere(predicate: (itemId: ItemId) => boolean, count: number): boolean {
    let available = 0;
    for (const s of this.slots) {
      if (s && predicate(s.itemId)) available += s.count;
    }
    if (available < count) return false;

    let rem = count;
    for (let i = 0; i < TOTAL_INVENTORY_SIZE && rem > 0; i++) {
      const s = this.slots[i];
      if (!s || !predicate(s.itemId)) continue;
      const take = Math.min(rem, s.count);
      s.count -= take;
      rem -= take;
      if (s.count <= 0) this.slots[i] = null;
    }
    return true;
  }

  consumeItem(itemId: ItemId, count = 1): boolean {
    return this.consumeWhere((id) => id === itemId, count);
  }

  consumeSelected(count = 1): ItemStack | null {
    const s = this.slots[this.selectedSlot];
    if (!s || s.count < count) return null;
    const popped = createItemStack(s.itemId, count, s.durability);
    s.count -= count;
    if (s.count <= 0) this.slots[this.selectedSlot] = null;
    return popped;
  }

  /** Damages the currently held tool by `amount`. Returns true if the tool broke. */
  damageSelectedTool(amount = 1): boolean {
    const s = this.slots[this.selectedSlot];
    if (!s || s.durability === undefined) return false;
    s.durability -= amount;
    if (s.durability <= 0) {
      this.slots[this.selectedSlot] = null;
      return true;
    }
    return false;
  }

  /** Damages all equipped armor pieces by `amount`. */
  damageArmor(amount = 1): void {
    for (const slot of ARMOR_SLOTS) {
      const piece = this.armor[slot];
      if (!piece || piece.durability === undefined) continue;
      piece.durability -= amount;
      if (piece.durability <= 0) {
        this.armor[slot] = null;
      }
    }
  }

  getTotalArmorDefense(): number {
    let total = 0;
    for (const slot of ARMOR_SLOTS) {
      const piece = this.armor[slot];
      if (!piece) continue;
      const def = ItemRegistry.get(piece.itemId);
      if (def?.armorDefense) total += def.armorDefense;
    }
    return total;
  }

  getArmorDamageMultiplier(): number {
    const def = this.getTotalArmorDefense();
    const reduction = Math.min(
      BALANCE.armor.maxDamageReductionFraction,
      def * BALANCE.armor.reductionPerDefensePoint
    );
    return 1 - reduction;
  }

  /**
   * Moves or swaps items between two arbitrary slot accessors.
   * If `half` is true (right-click split), moves ceil(from.count / 2) into an empty or compatible target.
   */
  static transferBetween(
    getFrom: () => ItemStack | null,
    setFrom: (s: ItemStack | null) => void,
    getTo: () => ItemStack | null,
    setTo: (s: ItemStack | null) => void,
    half = false,
    canAcceptTo?: (s: ItemStack) => boolean
  ): boolean {
    const src = getFrom();
    if (!src) return false;
    if (canAcceptTo && !canAcceptTo(src)) return false;

    const dst = getTo();

    if (half) {
      const moveCount = Math.ceil(src.count / 2);
      if (!dst) {
        setTo(createItemStack(src.itemId, moveCount, src.durability));
        const left = src.count - moveCount;
        setFrom(left > 0 ? createItemStack(src.itemId, left, src.durability) : null);
        return true;
      }
      if (canStacksMerge(src, dst)) {
        const maxStack = ItemRegistry.get(dst.itemId)?.maxStack ?? 64;
        const space = maxStack - dst.count;
        const move = Math.min(moveCount, space);
        if (move <= 0) return false;
        dst.count += move;
        setTo(dst);
        const left = src.count - move;
        setFrom(left > 0 ? createItemStack(src.itemId, left, src.durability) : null);
        return true;
      }
      return false;
    }

    // Full transfer / merge / swap
    if (!dst) {
      setTo(cloneStack(src));
      setFrom(null);
      return true;
    }

    if (canStacksMerge(src, dst)) {
      const maxStack = ItemRegistry.get(dst.itemId)?.maxStack ?? 64;
      const space = maxStack - dst.count;
      if (space > 0) {
        const move = Math.min(src.count, space);
        dst.count += move;
        setTo(dst);
        const left = src.count - move;
        setFrom(left > 0 ? createItemStack(src.itemId, left, src.durability) : null);
        return true;
      }
    }

    // Swap
    setTo(cloneStack(src));
    setFrom(cloneStack(dst));
    return true;
  }

  /** Shift-click quick-transfer within inventory (hotbar <-> main, or armor equip if armor item) */
  shiftQuickTransfer(index: number): boolean {
    const src = this.slots[index];
    if (!src) return false;

    // If it's an armor piece and its armor slot is empty, equip immediately!
    const def = ItemRegistry.get(src.itemId);
    if (def?.armorSlot && this.armor[def.armorSlot] === null) {
      this.armor[def.armorSlot] = cloneStack(src);
      this.slots[index] = null;
      return true;
    }

    const fromHotbar = index < HOTBAR_SIZE;
    const rangeStart = fromHotbar ? HOTBAR_SIZE : 0;
    const rangeEnd = fromHotbar ? TOTAL_INVENTORY_SIZE : HOTBAR_SIZE;

    const maxStack = def?.maxStack ?? 64;
    let movedAny = false;

    // 1. Merge into matching stacks
    if (maxStack > 1 && src.durability === undefined) {
      for (let i = rangeStart; i < rangeEnd && src.count > 0; i++) {
        const dst = this.slots[i];
        if (dst && dst.itemId === src.itemId && dst.count < maxStack) {
          const take = Math.min(src.count, maxStack - dst.count);
          dst.count += take;
          src.count -= take;
          movedAny = true;
        }
      }
    }

    // 2. Place remaining into first empty slot in target range
    if (src.count > 0) {
      for (let i = rangeStart; i < rangeEnd; i++) {
        if (this.slots[i] === null) {
          this.slots[i] = cloneStack(src);
          src.count = 0;
          movedAny = true;
          break;
        }
      }
    }

    if (src.count <= 0) {
      this.slots[index] = null;
    }
    return movedAny;
  }

  /** Empties all slots & armor and returns all item stacks (for death drops). */
  extractAllItems(): ItemStack[] {
    const out: ItemStack[] = [];
    for (let i = 0; i < TOTAL_INVENTORY_SIZE; i++) {
      if (this.slots[i]) {
        out.push(this.slots[i]!);
        this.slots[i] = null;
      }
    }
    for (const slot of ARMOR_SLOTS) {
      if (this.armor[slot]) {
        out.push(this.armor[slot]!);
        this.armor[slot] = null;
      }
    }
    return out;
  }

  clear(): void {
    this.slots.fill(null);
    for (const slot of ARMOR_SLOTS) this.armor[slot] = null;
    this.selectedSlot = 0;
  }

  toSnapshot(): InventorySnapshot {
    return {
      selectedSlot: this.selectedSlot,
      slots: this.slots.map(cloneStack),
      armor: {
        helmet: cloneStack(this.armor.helmet),
        chestplate: cloneStack(this.armor.chestplate),
        leggings: cloneStack(this.armor.leggings),
        boots: cloneStack(this.armor.boots),
      },
    };
  }

  loadFromSnapshot(snap: InventorySnapshot): void {
    this.clear();
    this.selectedSlot = Math.max(0, Math.min(HOTBAR_SIZE - 1, snap.selectedSlot || 0));
    for (let i = 0; i < Math.min(TOTAL_INVENTORY_SIZE, snap.slots.length); i++) {
      this.slots[i] = cloneStack(snap.slots[i]);
    }
    if (snap.armor) {
      for (const slot of ARMOR_SLOTS) {
        this.armor[slot] = cloneStack(snap.armor[slot] ?? null);
      }
    }
  }
}
