import { HOTBAR_SIZE } from '../config/constants';
import { ItemRegistry } from '../registry/items';
import { TextureAtlas } from '../engine/TextureAtlas';
import { Player } from '../player/Player';

export class HUD {
  private readonly root: HTMLDivElement;
  private readonly crosshairEl: HTMLDivElement;
  private readonly hurtOverlayEl: HTMLDivElement;
  private readonly waterOverlayEl: HTMLDivElement;
  private readonly vitalsWrap: HTMLDivElement;
  private readonly itemToastEl: HTMLDivElement;
  private readonly hotbarEl: HTMLDivElement;
  private readonly noticeEl: HTMLDivElement;
  private readonly atlas: TextureAtlas;

  private lastToastTime = 0;
  private lastNoticeTime = 0;

  constructor(uiRoot: HTMLElement, atlas: TextureAtlas) {
    this.atlas = atlas;

    this.root = document.createElement('div');
    this.root.id = 'game-hud';
    this.root.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:10;';
    uiRoot.appendChild(this.root);

    // Underwater subtle blue filter
    this.waterOverlayEl = document.createElement('div');
    this.waterOverlayEl.style.cssText =
      'position:absolute;inset:0;background:rgba(28,88,128,0.36);opacity:0;transition:opacity 0.15s;';
    this.root.appendChild(this.waterOverlayEl);

    // Hurt crimson vignette
    this.hurtOverlayEl = document.createElement('div');
    this.hurtOverlayEl.style.cssText =
      'position:absolute;inset:0;background:radial-gradient(circle,rgba(200,28,28,0) 40%,rgba(200,28,28,0.68) 100%);opacity:0;transition:opacity 0.08s;';
    this.root.appendChild(this.hurtOverlayEl);

    // Crosshair
    this.crosshairEl = document.createElement('div');
    this.crosshairEl.style.cssText =
      'position:absolute;top:50%;left:50%;width:20px;height:20px;transform:translate(-50%,-50%);' +
      'display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.9);' +
      'font-size:19px;font-weight:700;text-shadow:0 0 3px rgba(0,0,0,0.9);';
    this.crosshairEl.textContent = '+';
    this.root.appendChild(this.crosshairEl);

    // System notification banner (top-center)
    this.noticeEl = document.createElement('div');
    this.noticeEl.style.cssText =
      'position:absolute;top:16px;left:50%;transform:translateX(-50%);padding:6px 14px;' +
      'background:rgba(18,22,28,0.85);border:1px solid rgba(230,197,110,0.45);border-radius:6px;' +
      'font-size:12px;color:#f3dfb0;opacity:0;transition:opacity 0.25s;';
    this.root.appendChild(this.noticeEl);

    // Held item toast above vitals
    this.itemToastEl = document.createElement('div');
    this.itemToastEl.style.cssText =
      'position:absolute;bottom:108px;left:50%;transform:translateX(-50%);padding:3px 10px;' +
      'background:rgba(18,22,28,0.72);border-radius:4px;font-size:12px;color:#f5ead2;' +
      'opacity:0;transition:opacity 0.3s;letter-spacing:0.2px;';
    this.root.appendChild(this.itemToastEl);

    // Vitals container (Hearts, Armor, Hunger, Oxygen)
    this.vitalsWrap = document.createElement('div');
    this.vitalsWrap.style.cssText =
      'position:absolute;bottom:66px;left:50%;transform:translateX(-50%);width:404px;' +
      'display:flex;flex-direction:column;gap:3px;';
    this.root.appendChild(this.vitalsWrap);

    // 9-slot Hotbar
    this.hotbarEl = document.createElement('div');
    this.hotbarEl.style.cssText =
      'position:absolute;bottom:12px;left:50%;transform:translateX(-50%);display:flex;gap:4px;' +
      'padding:4px;background:rgba(18,22,28,0.82);border:2px solid rgba(110,122,138,0.5);border-radius:7px;' +
      'box-shadow:0 6px 20px rgba(0,0,0,0.45);';
    this.root.appendChild(this.hotbarEl);
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'block' : 'none';
  }

  showNotice(text: string): void {
    this.noticeEl.textContent = text;
    this.noticeEl.style.opacity = '1';
    this.lastNoticeTime = performance.now();
  }

  showHeldItemName(name: string | null): void {
    if (!name) return;
    this.itemToastEl.textContent = name;
    this.itemToastEl.style.opacity = '1';
    this.lastToastTime = performance.now();
  }

  updateEffects(player: Player): void {
    this.hurtOverlayEl.style.opacity =
      player.hurtFlashSec > 0 ? String(Math.min(1, player.hurtFlashSec * 2.8)) : '0';
    this.waterOverlayEl.style.opacity = player.headInWater ? '1' : '0';

    const now = performance.now();
    if (this.lastToastTime > 0 && now - this.lastToastTime > 1800) {
      this.itemToastEl.style.opacity = '0';
      this.lastToastTime = 0;
    }
    if (this.lastNoticeTime > 0 && now - this.lastNoticeTime > 3200) {
      this.noticeEl.style.opacity = '0';
      this.lastNoticeTime = 0;
    }
  }

  renderVitals(player: Player): void {
    const hp = Math.ceil(player.health);
    const hung = Math.ceil(player.hunger);
    const armor = player.armorDefense;
    const o2 = Math.ceil(player.oxygen);

    const buildPips = (val: number, max: number, fullColor: string, halfColor: string, emptyColor: string, sym: string): string => {
      const count = Math.ceil(max / 2);
      let html = '';
      for (let i = 0; i < count; i++) {
        const threshold = (i + 1) * 2;
        const col = val >= threshold ? fullColor : val === threshold - 1 ? halfColor : emptyColor;
        html += `<span style="color:${col};font-size:13px;line-height:1;text-shadow:1px 1px 1px #000">${sym}</span>`;
      }
      return html;
    };

    let topRow = '';
    if (armor > 0 || player.headInWater || o2 < player.maxOxygen) {
      const armorHtml = armor > 0 ? `<div>${buildPips(armor, 20, '#b7cadc', '#7c92a6', '#2a303a', '◆')}</div>` : '<div></div>';
      const o2Html =
        player.headInWater || o2 < player.maxOxygen
          ? `<div>${buildPips(o2, player.maxOxygen, '#5cc9f5', '#3489b0', '#1d2d3b', '●')}</div>`
          : '<div></div>';
      topRow = `<div style="display:flex;justify-content:space-between;align-items:center;">${armorHtml}${o2Html}</div>`;
    }

    const heartsHtml = buildPips(hp, player.maxHealth, '#df4848', '#b8685a', '#2e2226', '♥');
    const hungerHtml = buildPips(hung, player.maxHunger, '#df9f44', '#a87634', '#2e2720', '●');
    const mainRow = `<div style="display:flex;justify-content:space-between;align-items:center;"><div>${heartsHtml}</div><div>${hungerHtml}</div></div>`;

    this.vitalsWrap.innerHTML = topRow + mainRow;
  }

  renderHotbar(player: Player): void {
    this.hotbarEl.innerHTML = '';
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const cell = document.createElement('div');
      const selected = i === player.selectedSlot;
      cell.style.cssText =
        `width:40px;height:40px;position:relative;display:flex;align-items:center;justify-content:center;` +
        `border-radius:4px;background:${selected ? 'rgba(232,202,126,0.28)' : 'rgba(10,12,16,0.62)'};` +
        `border:2px solid ${selected ? '#ecc86e' : 'rgba(240,235,225,0.16)'};`;

      const idxEl = document.createElement('span');
      idxEl.textContent = String(i + 1);
      idxEl.style.cssText =
        'position:absolute;left:3px;top:1px;font-size:9px;color:rgba(240,235,225,0.45);';
      cell.appendChild(idxEl);

      const stack = player.inventory.slots[i];
      if (stack && stack.count > 0) {
        const def = ItemRegistry.get(stack.itemId);
        if (def) {
          const img = document.createElement('img');
          img.src = this.atlas.getItemIcon(def.icon);
          img.style.cssText = 'width:28px;height:28px;image-rendering:pixelated;';
          cell.appendChild(img);

          if (stack.count > 1) {
            const countEl = document.createElement('span');
            countEl.textContent = String(stack.count);
            countEl.style.cssText =
              'position:absolute;right:3px;bottom:1px;font-size:11px;font-weight:700;color:#fff;text-shadow:1px 1px 1px #000;';
            cell.appendChild(countEl);
          }

          if (stack.durability !== undefined && def.durability && stack.durability < def.durability) {
            const frac = Math.max(0, Math.min(1, stack.durability / def.durability));
            const barBg = document.createElement('div');
            barBg.style.cssText = 'position:absolute;left:4px;right:4px;bottom:2px;height:3px;background:#080a0d;';
            const barFill = document.createElement('div');
            barFill.style.cssText = `width:${Math.round(frac * 100)}%;height:100%;background:${
              frac > 0.5 ? '#66c25b' : frac > 0.25 ? '#e0b341' : '#d64c44'
            };`;
            barBg.appendChild(barFill);
            cell.appendChild(barBg);
          }
        }
      }
      this.hotbarEl.appendChild(cell);
    }
  }
}
