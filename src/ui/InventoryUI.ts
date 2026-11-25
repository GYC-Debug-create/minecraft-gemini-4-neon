import { CHEST_SIZE, HOTBAR_SIZE, TOTAL_INVENTORY_SIZE } from '../config/constants';
import { getDisplayName, uiText } from '../core/i18n';
import { ArmorSlot, BlockPos, ItemStack } from '../core/types';
import { ItemRegistry } from '../registry/items';
import { TextureAtlas } from '../engine/TextureAtlas';
import { ARMOR_SLOTS, cloneStack, createItemStack, Inventory } from '../player/Inventory';
import {
  ChestContainer,
  ContainerManager,
  FurnaceContainer,
} from '../systems/ContainerManager';
import {
  consumeCraftingGrid,
  craftRecipeFromInventory,
  getCraftableRecipes,
  matchCraftingGrid,
} from '../systems/CraftingSystem';

export type OpenScreenKind = 'none' | 'inventory' | 'workbench' | 'furnace' | 'chest';

export interface ActiveContainerScreen {
  kind: OpenScreenKind;
  pos?: BlockPos;
}

export class InventoryUI {
  private readonly overlay: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly cursorEl: HTMLDivElement;
  private readonly atlas: TextureAtlas;
  private readonly getInventory: () => Inventory;
  private readonly getContainers: () => ContainerManager;
  private readonly onChanged: () => void;
  private readonly onClosed: () => void;

  private active: ActiveContainerScreen = { kind: 'none' };
  private cursorStack: ItemStack | null = null;
  private craftGrid: Array<ItemStack | null> = new Array(9).fill(null);

  constructor(
    uiRoot: HTMLElement,
    atlas: TextureAtlas,
    getInventory: () => Inventory,
    getContainers: () => ContainerManager,
    onChanged: () => void,
    onClosed: () => void
  ) {
    this.atlas = atlas;
    this.getInventory = getInventory;
    this.getContainers = getContainers;
    this.onChanged = onChanged;
    this.onClosed = onClosed;

    this.overlay = document.createElement('div');
    this.overlay.style.cssText =
      'position:absolute;inset:0;display:none;align-items:center;justify-content:center;' +
      'background:rgba(10,13,18,0.62);pointer-events:auto;z-index:20;';
    this.overlay.addEventListener('contextmenu', (e) => e.preventDefault());

    this.panel = document.createElement('div');
    this.panel.style.cssText =
      'background:#232830;border:2px solid #596370;border-radius:10px;padding:16px 18px;' +
      'color:#f0ebe1;box-shadow:0 16px 40px rgba(0,0,0,0.55);min-width:520px;max-width:740px;' +
      'font-family:"Segoe UI",system-ui,sans-serif;';
    this.overlay.appendChild(this.panel);

    this.cursorEl = document.createElement('div');
    this.cursorEl.style.cssText =
      'position:fixed;pointer-events:none;z-index:100;display:none;transform:translate(-50%,-50%);';
    document.body.appendChild(this.cursorEl);

    window.addEventListener('mousemove', (e) => {
      if (this.cursorStack) {
        this.cursorEl.style.left = `${e.clientX}px`;
        this.cursorEl.style.top = `${e.clientY}px`;
      }
    });

    uiRoot.appendChild(this.overlay);
  }

  getActive(): ActiveContainerScreen {
    return this.active;
  }

  isOpen(): boolean {
    return this.active.kind !== 'none';
  }

  open(kind: OpenScreenKind, pos?: BlockPos): void {
    if (kind === 'none') {
      this.close();
      return;
    }
    this.returnCraftAndCursorToInventory();
    this.active = { kind, pos: pos ? { ...pos } : undefined };
    this.craftGrid = new Array(kind === 'workbench' ? 9 : 4).fill(null);
    this.overlay.style.display = 'flex';
    this.render();
  }

  close(): void {
    if (!this.isOpen()) return;
    this.returnCraftAndCursorToInventory();
    this.active = { kind: 'none' };
    this.overlay.style.display = 'none';
    this.cursorEl.style.display = 'none';
    this.onChanged();
    this.onClosed();
  }

  refresh(): void {
    if (this.isOpen()) this.render();
  }

  private returnCraftAndCursorToInventory(): void {
    const inv = this.getInventory();
    if (this.cursorStack) {
      inv.addStack(this.cursorStack);
      this.cursorStack = null;
    }
    for (let i = 0; i < this.craftGrid.length; i++) {
      if (this.craftGrid[i]) {
        inv.addStack(this.craftGrid[i]!);
        this.craftGrid[i] = null;
      }
    }
  }

  private render(): void {
    const inv = this.getInventory();
    this.panel.innerHTML = '';

    const t = uiText();
    // Header
    const header = document.createElement('div');
    header.style.cssText =
      'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;' +
      'border-bottom:1px solid rgba(240,235,225,0.14);padding-bottom:8px;';
    const titles: Record<OpenScreenKind, string> = {
      none: '',
      inventory: t.screenInventory,
      workbench: t.screenWorkbench,
      furnace: t.screenFurnace,
      chest: t.screenChest,
    };
    const title = document.createElement('div');
    title.textContent = titles[this.active.kind];
    title.style.cssText = 'font-size:16px;font-weight:700;letter-spacing:0.3px;color:#e8cf8e;';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = t.closeEsc;
    closeBtn.style.cssText =
      'background:#373f4b;color:#f0ebe1;border:1px solid #5c6675;border-radius:4px;' +
      'padding:4px 10px;cursor:pointer;font-size:12px;';
    closeBtn.onclick = () => this.close();
    header.append(title, closeBtn);
    this.panel.appendChild(header);

    // Top section based on active container
    const topSection = document.createElement('div');
    topSection.style.cssText = 'display:flex;gap:18px;align-items:flex-start;margin-bottom:14px;';

    if (this.active.kind === 'inventory' || this.active.kind === 'workbench') {
      const gridSize: 2 | 3 = this.active.kind === 'workbench' ? 3 : 2;

      if (this.active.kind === 'inventory') {
        // Armor column
        const armorCol = document.createElement('div');
        armorCol.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
        const armorTitle = document.createElement('div');
        armorTitle.textContent = t.armorLabel(inv.getTotalArmorDefense());
        armorTitle.style.cssText = 'font-size:11px;color:#b8c0cc;margin-bottom:2px;';
        armorCol.appendChild(armorTitle);

        for (const slot of ARMOR_SLOTS) {
          armorCol.appendChild(
            this.makeSlotEl(
              inv.armor[slot],
              (e) => this.handleSlotClick(
                () => inv.armor[slot],
                (v) => { inv.armor[slot] = v; },
                e,
                (s) => ItemRegistry.get(s.itemId)?.armorSlot === slot
              ),
              t.armorSlotShort[slot]
            )
          );
        }
        topSection.appendChild(armorCol);
      }

      // Crafting Grid + Output
      const craftBox = document.createElement('div');
      craftBox.style.cssText = 'display:flex;align-items:center;gap:14px;';
      const gridEl = document.createElement('div');
      gridEl.style.cssText = `display:grid;grid-template-columns:repeat(${gridSize},42px);gap:4px;`;
      for (let i = 0; i < gridSize * gridSize; i++) {
        gridEl.appendChild(
          this.makeSlotEl(this.craftGrid[i], (e) =>
            this.handleSlotClick(
              () => this.craftGrid[i],
              (v) => { this.craftGrid[i] = v; },
              e
            )
          )
        );
      }

      const arrow = document.createElement('div');
      arrow.textContent = '→';
      arrow.style.cssText = 'font-size:20px;color:#d6b872;font-weight:700;';

      const match = matchCraftingGrid(this.craftGrid, gridSize);
      const outEl = this.makeSlotEl(match ? match.output : null, (e) => {
        if (!match) return;
        e.preventDefault();
        if (e.shiftKey) {
          // Craft as many as possible directly into inventory
          let guard = 0;
          while (guard++ < 64) {
            const m = matchCraftingGrid(this.craftGrid, gridSize);
            if (!m || m.recipe.id !== match.recipe.id) break;
            const rem = inv.addStack(cloneStack(m.output)!);
            if (rem > 0) break;
            consumeCraftingGrid(this.craftGrid);
          }
        } else {
          if (!this.cursorStack) {
            this.cursorStack = cloneStack(match.output);
            consumeCraftingGrid(this.craftGrid);
          } else if (
            this.cursorStack.itemId === match.output.itemId &&
            this.cursorStack.durability === undefined &&
            this.cursorStack.count + match.output.count <=
              (ItemRegistry.get(this.cursorStack.itemId)?.maxStack ?? 64)
          ) {
            this.cursorStack.count += match.output.count;
            consumeCraftingGrid(this.craftGrid);
          }
        }
        this.onChanged();
        this.render();
      });
      outEl.style.borderColor = match ? '#e6c56e' : 'rgba(240,235,225,0.22)';

      craftBox.append(gridEl, arrow, outEl);
      topSection.appendChild(craftBox);

      // Quick-craft craftable recipes sidebar (uses real inventory items only!)
      const recipeList = document.createElement('div');
      recipeList.style.cssText =
        'flex:1;max-height:148px;overflow-y:auto;background:rgba(12,15,20,0.45);' +
        'border:1px solid rgba(240,235,225,0.14);border-radius:6px;padding:6px;';
      const rTitle = document.createElement('div');
      rTitle.textContent = t.quickCraft;
      rTitle.style.cssText = 'font-size:11px;color:#b8c0cc;margin-bottom:5px;';
      recipeList.appendChild(rTitle);

      const craftables = getCraftableRecipes(inv, this.active.kind === 'workbench');
      if (craftables.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = t.quickCraftEmpty;
        empty.style.cssText = 'font-size:11px;color:#7e8794;';
        recipeList.appendChild(empty);
      } else {
        const btnWrap = document.createElement('div');
        btnWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
        for (const r of craftables) {
          const def = ItemRegistry.get(r.output.itemId);
          if (!def) continue;
          const itemLabel = getDisplayName(def.key, def.name);
          const btn = document.createElement('button');
          btn.title = t.craftTooltip(itemLabel, r.output.count);
          btn.style.cssText =
            'display:flex;align-items:center;gap:4px;padding:3px 6px;background:#2f3743;' +
            'border:1px solid #596370;border-radius:4px;color:#f0ebe1;cursor:pointer;font-size:11px;';
          const img = document.createElement('img');
          img.src = this.atlas.getItemIcon(def.icon);
          img.style.cssText = 'width:18px;height:18px;image-rendering:pixelated;';
          const lbl = document.createElement('span');
          lbl.textContent = r.output.count > 1 ? `${itemLabel} ×${r.output.count}` : itemLabel;
          btn.append(img, lbl);
          btn.onclick = () => {
            craftRecipeFromInventory(inv, r.id, this.active.kind === 'workbench');
            this.onChanged();
            this.render();
          };
          btnWrap.appendChild(btn);
        }
        recipeList.appendChild(btnWrap);
      }
      topSection.appendChild(recipeList);
    } else if (this.active.kind === 'furnace' && this.active.pos) {
      const f = this.getContainers().getOrCreateFurnace(
        this.active.pos.x,
        this.active.pos.y,
        this.active.pos.z
      );
      topSection.appendChild(this.renderFurnaceSection(f));
    } else if (this.active.kind === 'chest' && this.active.pos) {
      const c = this.getContainers().getOrCreateChest(
        this.active.pos.x,
        this.active.pos.y,
        this.active.pos.z
      );
      topSection.appendChild(this.renderChestSection(c));
    }

    this.panel.appendChild(topSection);

    // Main Inventory (27 slots)
    const invLabel = document.createElement('div');
    invLabel.textContent = t.backpack;
    invLabel.style.cssText = 'font-size:11px;color:#b8c0cc;margin-bottom:4px;';
    this.panel.appendChild(invLabel);

    const mainGrid = document.createElement('div');
    mainGrid.style.cssText = 'display:grid;grid-template-columns:repeat(9,42px);gap:4px;margin-bottom:10px;';
    for (let i = HOTBAR_SIZE; i < TOTAL_INVENTORY_SIZE; i++) {
      mainGrid.appendChild(
        this.makeSlotEl(inv.slots[i], (e) => this.handleInventorySlotClick(i, e))
      );
    }
    this.panel.appendChild(mainGrid);

    // Hotbar (9 slots)
    const hotLabel = document.createElement('div');
    hotLabel.textContent = t.hotbarLabel;
    hotLabel.style.cssText = 'font-size:11px;color:#b8c0cc;margin-bottom:4px;';
    this.panel.appendChild(hotLabel);

    const hotGrid = document.createElement('div');
    hotGrid.style.cssText = 'display:grid;grid-template-columns:repeat(9,42px);gap:4px;';
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const el = this.makeSlotEl(inv.slots[i], (e) => this.handleInventorySlotClick(i, e));
      if (i === inv.selectedSlot) el.style.borderColor = '#e6c56e';
      hotGrid.appendChild(el);
    }
    this.panel.appendChild(hotGrid);

    this.renderCursor();
  }

  private renderFurnaceSection(f: FurnaceContainer): HTMLElement {
    const t = uiText();
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:16px;';

    const leftCol = document.createElement('div');
    leftCol.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px;';
    const inSlot = this.makeSlotEl(f.input, (e) =>
      this.handleSlotClick(
        () => f.input,
        (v) => { f.input = v; },
        e
      ),
      t.furnaceInput
    );
    const burnPct = f.burnTimeMax > 0 ? Math.round((f.burnTime / f.burnTimeMax) * 100) : 0;
    const flame = document.createElement('div');
    flame.textContent = burnPct > 0 ? `🔥 ${burnPct}%` : '🔥';
    flame.style.cssText = `font-size:12px;color:${burnPct > 0 ? '#f59f3d' : '#6c7582'};`;
    const fuelSlot = this.makeSlotEl(f.fuel, (e) =>
      this.handleSlotClick(
        () => f.fuel,
        (v) => { f.fuel = v; },
        e
      ),
      t.furnaceFuel
    );
    leftCol.append(inSlot, flame, fuelSlot);

    const progPct = f.smeltTimeMax > 0 ? Math.round((f.smeltProgress / f.smeltTimeMax) * 100) : 0;
    const progBar = document.createElement('div');
    progBar.style.cssText = 'width:84px;height:14px;background:#14181e;border:1px solid #4e5866;border-radius:4px;overflow:hidden;';
    const progFill = document.createElement('div');
    progFill.style.cssText = `width:${progPct}%;height:100%;background:#e6a83c;transition:width 0.1s;`;
    progBar.appendChild(progFill);

    const outSlot = this.makeSlotEl(f.output, (e) => {
      if (!f.output) return;
      if (e.shiftKey) {
        const rem = this.getInventory().addStack(f.output);
        if (rem <= 0) f.output = null;
        else f.output.count = rem;
        this.onChanged();
        this.render();
      } else {
        this.handleSlotClick(
          () => f.output,
          (v) => { f.output = v; },
          e,
          () => false // output slot is take-only
        );
      }
    }, t.furnaceOutput);

    wrap.append(leftCol, progBar, outSlot);
    return wrap;
  }

  private renderChestSection(c: ChestContainer): HTMLElement {
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(9,42px);gap:4px;';
    for (let i = 0; i < CHEST_SIZE; i++) {
      grid.appendChild(
        this.makeSlotEl(c.slots[i], (e) => {
          if (e.shiftKey && c.slots[i]) {
            const rem = this.getInventory().addStack(c.slots[i]!);
            if (rem <= 0) c.slots[i] = null;
            else c.slots[i]!.count = rem;
            this.onChanged();
            this.render();
          } else {
            this.handleSlotClick(
              () => c.slots[i],
              (v) => { c.slots[i] = v; },
              e
            );
          }
        })
      );
    }
    return grid;
  }

  private handleInventorySlotClick(index: number, e: MouseEvent): void {
    const inv = this.getInventory();
    if (e.shiftKey) {
      e.preventDefault();
      // Shift-click into open chest/furnace or within inventory
      const src = inv.slots[index];
      if (!src) return;
      if (this.active.kind === 'chest' && this.active.pos) {
        const chest = this.getContainers().getOrCreateChest(
          this.active.pos.x,
          this.active.pos.y,
          this.active.pos.z
        );
        for (let i = 0; i < CHEST_SIZE; i++) {
          if (!chest.slots[i]) {
            chest.slots[i] = cloneStack(src);
            inv.slots[index] = null;
            this.onChanged();
            this.render();
            return;
          }
        }
      } else if (this.active.kind === 'furnace' && this.active.pos) {
        const f = this.getContainers().getOrCreateFurnace(
          this.active.pos.x,
          this.active.pos.y,
          this.active.pos.z
        );
        const def = ItemRegistry.get(src.itemId);
        if (def?.fuelTicks && !f.fuel) {
          f.fuel = cloneStack(src);
          inv.slots[index] = null;
          this.onChanged();
          this.render();
          return;
        }
        if (!f.input) {
          f.input = cloneStack(src);
          inv.slots[index] = null;
          this.onChanged();
          this.render();
          return;
        }
      }
      inv.shiftQuickTransfer(index);
      this.onChanged();
      this.render();
      return;
    }

    this.handleSlotClick(
      () => inv.slots[index],
      (v) => { inv.slots[index] = v; },
      e
    );
  }

  private handleSlotClick(
    getSlot: () => ItemStack | null,
    setSlot: (s: ItemStack | null) => void,
    e: MouseEvent,
    canAccept?: (s: ItemStack) => boolean
  ): void {
    e.preventDefault();
    const isRight = e.button === 2;
    const slot = getSlot();

    if (!this.cursorStack) {
      if (!slot) return;
      if (isRight) {
        const take = Math.ceil(slot.count / 2);
        this.cursorStack = createItemStack(slot.itemId, take, slot.durability);
        const left = slot.count - take;
        setSlot(left > 0 ? createItemStack(slot.itemId, left, slot.durability) : null);
      } else {
        this.cursorStack = cloneStack(slot);
        setSlot(null);
      }
    } else {
      if (canAccept && !canAccept(this.cursorStack)) return;
      const cur = this.cursorStack;
      const def = ItemRegistry.get(cur.itemId);
      const maxStack = def?.maxStack ?? 64;

      if (isRight) {
        if (!slot) {
          setSlot(createItemStack(cur.itemId, 1, cur.durability));
          cur.count--;
          if (cur.count <= 0) this.cursorStack = null;
        } else if (
          slot.itemId === cur.itemId &&
          slot.durability === undefined &&
          cur.durability === undefined &&
          slot.count < maxStack
        ) {
          slot.count++;
          cur.count--;
          if (cur.count <= 0) this.cursorStack = null;
        }
      } else {
        if (!slot) {
          setSlot(cloneStack(cur));
          this.cursorStack = null;
        } else if (
          slot.itemId === cur.itemId &&
          slot.durability === undefined &&
          cur.durability === undefined &&
          slot.count < maxStack
        ) {
          const move = Math.min(cur.count, maxStack - slot.count);
          slot.count += move;
          cur.count -= move;
          if (cur.count <= 0) this.cursorStack = null;
        } else {
          // Swap
          const prev = cloneStack(slot);
          setSlot(cloneStack(cur));
          this.cursorStack = prev;
        }
      }
    }

    this.onChanged();
    this.render();
  }

  private makeSlotEl(
    stack: ItemStack | null,
    onMouseDown: (e: MouseEvent) => void,
    placeholder?: string
  ): HTMLDivElement {
    const cell = document.createElement('div');
    cell.style.cssText =
      'width:42px;height:42px;position:relative;display:flex;align-items:center;justify-content:center;' +
      'background:#151920;border:1px solid #485260;border-radius:4px;cursor:pointer;';
    cell.addEventListener('mousedown', onMouseDown);

    if (stack && stack.count > 0) {
      const def = ItemRegistry.get(stack.itemId);
      if (def) {
        const itemLabel = getDisplayName(def.key, def.name);
        cell.title =
          stack.durability !== undefined && def.durability
            ? `${itemLabel} (${stack.durability}/${def.durability})`
            : itemLabel;
        const img = document.createElement('img');
        img.src = this.atlas.getItemIcon(def.icon);
        img.style.cssText = 'width:28px;height:28px;image-rendering:pixelated;pointer-events:none;';
        cell.appendChild(img);

        if (stack.count > 1) {
          const cnt = document.createElement('span');
          cnt.textContent = String(stack.count);
          cnt.style.cssText =
            'position:absolute;right:3px;bottom:1px;font-size:11px;font-weight:700;' +
            'color:#fff;text-shadow:1px 1px 1px #000;pointer-events:none;';
          cell.appendChild(cnt);
        }

        if (stack.durability !== undefined && def.durability && stack.durability < def.durability) {
          const frac = Math.max(0, Math.min(1, stack.durability / def.durability));
          const barBg = document.createElement('div');
          barBg.style.cssText =
            'position:absolute;left:4px;right:4px;bottom:3px;height:3px;background:#090b0e;pointer-events:none;';
          const barFill = document.createElement('div');
          barFill.style.cssText = `width:${Math.round(frac * 100)}%;height:100%;background:${
            frac > 0.5 ? '#66c25b' : frac > 0.25 ? '#e0b341' : '#d64c44'
          };`;
          barBg.appendChild(barFill);
          cell.appendChild(barBg);
        }
      }
    } else if (placeholder) {
      const ph = document.createElement('span');
      ph.textContent = placeholder;
      ph.style.cssText = 'font-size:10px;color:#5a6370;pointer-events:none;';
      cell.appendChild(ph);
    }

    return cell;
  }

  private renderCursor(): void {
    if (!this.cursorStack) {
      this.cursorEl.style.display = 'none';
      return;
    }
    const def = ItemRegistry.get(this.cursorStack.itemId);
    if (!def) {
      this.cursorEl.style.display = 'none';
      return;
    }
    this.cursorEl.style.display = 'block';
    this.cursorEl.innerHTML = '';
    const img = document.createElement('img');
    img.src = this.atlas.getItemIcon(def.icon);
    img.style.cssText = 'width:32px;height:32px;image-rendering:pixelated;';
    this.cursorEl.appendChild(img);
    if (this.cursorStack.count > 1) {
      const cnt = document.createElement('span');
      cnt.textContent = String(this.cursorStack.count);
      cnt.style.cssText =
        'position:absolute;right:-4px;bottom:-2px;font-size:12px;font-weight:700;color:#fff;text-shadow:1px 1px 1px #000;';
      this.cursorEl.appendChild(cnt);
    }
  }

  dispose(): void {
    this.cursorEl.remove();
  }
}

export type { ArmorSlot };
