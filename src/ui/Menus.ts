import { DAY_LENGTH_TICKS } from '../config/constants';
import { GameSettings } from '../core/types';

export interface WorldSummary {
  worldId: string;
  name: string;
  seed: number;
  worldTime: number;
  savedAt: number;
}

export interface MenuCallbacks {
  onNewWorld: (seed: string) => void;
  onContinueWorld: () => void;
  onResume: () => void;
  onSaveNow: () => void;
  onQuitToMenu: () => void;
  onRespawn: () => void;
  onSettingsChanged: (settings: GameSettings) => void;
}

export class Menus {
  private readonly mainMenuEl: HTMLDivElement;
  private readonly pauseMenuEl: HTMLDivElement;
  private readonly settingsModalEl: HTMLDivElement;
  private readonly deathOverlayEl: HTMLDivElement;
  private readonly deathCauseEl: HTMLDivElement;
  private readonly seedInput: HTMLInputElement;
  private readonly continueBtn: HTMLButtonElement;
  private readonly continueMetaEl: HTMLDivElement;
  private readonly mainWarningEl: HTMLDivElement;

  private readonly callbacks: MenuCallbacks;
  private currentSettings: GameSettings;
  private settingsReturnTarget: 'main' | 'pause' = 'main';

  constructor(uiRoot: HTMLElement, initialSettings: GameSettings, callbacks: MenuCallbacks) {
    this.callbacks = callbacks;
    this.currentSettings = { ...initialSettings };

    // --- 1. Main Menu ---
    this.mainMenuEl = document.createElement('div');
    this.mainMenuEl.id = 'main-menu';
    this.mainMenuEl.style.cssText =
      'position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;' +
      'background:linear-gradient(180deg,rgba(14,18,26,0.58) 0%,rgba(14,18,26,0.84) 100%);pointer-events:auto;z-index:30;';

    const card = document.createElement('div');
    card.style.cssText =
      'width:400px;max-width:92vw;padding:28px 30px;background:rgba(24,29,37,0.92);' +
      'border:2px solid #697485;border-radius:12px;box-shadow:0 20px 55px rgba(0,0,0,0.6);' +
      'display:flex;flex-direction:column;gap:14px;align-items:stretch;';

    // Original Stoneroot Pixel-Crystal Crest Logo (inline SVG)
    const logoWrap = document.createElement('div');
    logoWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px;margin-bottom:6px;';
    logoWrap.innerHTML = `
      <svg width="56" height="56" viewBox="0 0 16 16" style="image-rendering:pixelated;border-radius:8px;border:2px solid #8a95a6">
        <rect width="16" height="16" fill="#5d8a47"/>
        <rect y="5" width="16" height="11" fill="#6f5339"/>
        <rect x="2" y="5" width="3" height="2" fill="#5d8a47"/>
        <rect x="9" y="5" width="4" height="3" fill="#4f783b"/>
        <rect x="5" y="8" width="6" height="6" fill="#586069"/>
        <rect x="6" y="9" width="4" height="4" fill="#45c8b8"/>
        <rect x="7" y="10" width="2" height="2" fill="#a2f5ea"/>
      </svg>
      <div style="font-size:30px;font-weight:900;letter-spacing:3px;color:#eed497;text-shadow:0 3px 0 #1b2028">STONEROOT</div>
      <div style="font-size:12px;letter-spacing:1.4px;color:#9da8b8;text-transform:uppercase">Voxel Survival Sandbox</div>
    `;

    this.mainWarningEl = document.createElement('div');
    this.mainWarningEl.style.cssText =
      'display:none;padding:8px 10px;background:rgba(165,54,44,0.28);border:1px solid #d46559;' +
      'border-radius:6px;font-size:12px;color:#ffd5cf;';

    this.continueBtn = this.makeButton('Continue World', '#4d8a64', '#f6fbf7');
    this.continueBtn.id = 'btn-continue-world';
    this.continueBtn.disabled = true;
    this.continueBtn.style.opacity = '0.45';
    this.continueBtn.onclick = () => this.callbacks.onContinueWorld();

    this.continueMetaEl = document.createElement('div');
    this.continueMetaEl.style.cssText = 'font-size:11px;color:#9da8b8;text-align:center;margin-top:-8px;';
    this.continueMetaEl.textContent = 'No saved world yet';

    const divider = document.createElement('div');
    divider.style.cssText = 'height:1px;background:rgba(240,235,225,0.14);margin:2px 0;';

    this.seedInput = document.createElement('input');
    this.seedInput.id = 'input-world-seed';
    this.seedInput.type = 'text';
    this.seedInput.placeholder = 'World Seed (optional, e.g. 1337)';
    this.seedInput.style.cssText =
      'padding:10px 12px;background:#14181e;color:#f0ebe1;border:1px solid #596370;' +
      'border-radius:6px;font-size:13px;outline:none;';

    const newWorldBtn = this.makeButton('Create New World', '#d6a44b', '#151920');
    newWorldBtn.id = 'btn-new-world';
    newWorldBtn.onclick = () => this.callbacks.onNewWorld(this.seedInput.value.trim());

    const settingsBtn = this.makeButton('Settings', '#363f4c', '#eef2f7');
    settingsBtn.id = 'btn-main-settings';
    settingsBtn.onclick = () => this.openSettings('main');

    card.append(
      logoWrap,
      this.mainWarningEl,
      this.continueBtn,
      this.continueMetaEl,
      divider,
      this.seedInput,
      newWorldBtn,
      settingsBtn
    );
    this.mainMenuEl.appendChild(card);
    uiRoot.appendChild(this.mainMenuEl);

    // --- 2. Pause Menu ---
    this.pauseMenuEl = document.createElement('div');
    this.pauseMenuEl.id = 'pause-menu';
    this.pauseMenuEl.style.cssText =
      'position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;' +
      'background:rgba(12,16,22,0.68);pointer-events:auto;z-index:28;';

    const pCard = document.createElement('div');
    pCard.style.cssText =
      'width:320px;padding:24px;background:#202630;border:2px solid #5e6a7a;border-radius:10px;' +
      'display:flex;flex-direction:column;gap:10px;box-shadow:0 16px 40px rgba(0,0,0,0.55);';
    const pTitle = document.createElement('div');
    pTitle.textContent = 'Game Paused';
    pTitle.style.cssText = 'font-size:20px;font-weight:800;color:#eed497;text-align:center;margin-bottom:6px;';

    const resumeBtn = this.makeButton('Resume Game', '#d6a44b', '#151920');
    resumeBtn.onclick = () => this.callbacks.onResume();
    const saveBtn = this.makeButton('Save World', '#3e6f56', '#f2faf5');
    saveBtn.onclick = () => this.callbacks.onSaveNow();
    const pSettingsBtn = this.makeButton('Settings', '#363f4c', '#eef2f7');
    pSettingsBtn.onclick = () => this.openSettings('pause');
    const quitBtn = this.makeButton('Save & Main Menu', '#6d3939', '#fbeeee');
    quitBtn.onclick = () => this.callbacks.onQuitToMenu();

    pCard.append(pTitle, resumeBtn, saveBtn, pSettingsBtn, quitBtn);
    this.pauseMenuEl.appendChild(pCard);
    uiRoot.appendChild(this.pauseMenuEl);

    // --- 3. Settings Modal ---
    this.settingsModalEl = document.createElement('div');
    this.settingsModalEl.id = 'settings-modal';
    this.settingsModalEl.style.cssText =
      'position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;' +
      'background:rgba(10,13,18,0.75);pointer-events:auto;z-index:34;';
    uiRoot.appendChild(this.settingsModalEl);
    this.renderSettingsModal();

    // --- 4. Death Screen ---
    this.deathOverlayEl = document.createElement('div');
    this.deathOverlayEl.id = 'death-overlay';
    this.deathOverlayEl.style.cssText =
      'position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;' +
      'gap:14px;background:rgba(68,14,14,0.78);pointer-events:auto;z-index:35;color:#f6ece8;';
    const deathTitle = document.createElement('div');
    deathTitle.textContent = 'You Perished';
    deathTitle.style.cssText = 'font-size:34px;font-weight:800;letter-spacing:1px;';
    this.deathCauseEl = document.createElement('div');
    this.deathCauseEl.style.cssText = 'font-size:14px;color:#e4c4bc;';
    const respawnBtn = this.makeButton('Respawn at Camp', '#d6a44b', '#14181e');
    respawnBtn.style.width = '220px';
    respawnBtn.onclick = () => this.callbacks.onRespawn();
    const deathMenuBtn = this.makeButton('Main Menu', '#363f4c', '#eef2f7');
    deathMenuBtn.style.width = '220px';
    deathMenuBtn.onclick = () => this.callbacks.onQuitToMenu();
    this.deathOverlayEl.append(deathTitle, this.deathCauseEl, respawnBtn, deathMenuBtn);
    uiRoot.appendChild(this.deathOverlayEl);
  }

  private makeButton(label: string, bg: string, fg: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText =
      `padding:10px 16px;background:${bg};color:${fg};border:1px solid rgba(255,255,255,0.16);` +
      'border-radius:6px;font-size:14px;font-weight:700;cursor:pointer;letter-spacing:0.3px;';
    return btn;
  }

  setSavedWorldSummary(summary: WorldSummary | null): void {
    if (!summary) {
      this.continueBtn.disabled = true;
      this.continueBtn.style.opacity = '0.45';
      this.continueBtn.style.cursor = 'not-allowed';
      this.continueMetaEl.textContent = 'No saved world yet';
      return;
    }
    this.continueBtn.disabled = false;
    this.continueBtn.style.opacity = '1';
    this.continueBtn.style.cursor = 'pointer';
    const day = Math.floor(summary.worldTime / DAY_LENGTH_TICKS) + 1;
    this.continueMetaEl.textContent = `Saved Seed: ${summary.seed} · Day ${day}`;
  }

  showMainWarning(message: string | null): void {
    if (!message) {
      this.mainWarningEl.style.display = 'none';
      return;
    }
    this.mainWarningEl.textContent = message;
    this.mainWarningEl.style.display = 'block';
  }

  showMainMenu(): void {
    this.mainMenuEl.style.display = 'flex';
    this.pauseMenuEl.style.display = 'none';
    this.settingsModalEl.style.display = 'none';
    this.deathOverlayEl.style.display = 'none';
  }

  showPauseMenu(): void {
    this.mainMenuEl.style.display = 'none';
    this.pauseMenuEl.style.display = 'flex';
    this.settingsModalEl.style.display = 'none';
    this.deathOverlayEl.style.display = 'none';
  }

  showDeathScreen(cause: string): void {
    this.deathCauseEl.textContent = `Cause: ${cause}`;
    this.deathOverlayEl.style.display = 'flex';
    this.pauseMenuEl.style.display = 'none';
    this.mainMenuEl.style.display = 'none';
    this.settingsModalEl.style.display = 'none';
  }

  hideAll(): void {
    this.mainMenuEl.style.display = 'none';
    this.pauseMenuEl.style.display = 'none';
    this.settingsModalEl.style.display = 'none';
    this.deathOverlayEl.style.display = 'none';
  }

  updateSettingsValues(settings: GameSettings): void {
    this.currentSettings = { ...settings };
    this.renderSettingsModal();
  }

  openSettings(returnTo: 'main' | 'pause'): void {
    this.settingsReturnTarget = returnTo;
    this.mainMenuEl.style.display = 'none';
    this.pauseMenuEl.style.display = 'none';
    this.renderSettingsModal();
    this.settingsModalEl.style.display = 'flex';
  }

  private renderSettingsModal(): void {
    this.settingsModalEl.innerHTML = '';
    const card = document.createElement('div');
    card.style.cssText =
      'width:380px;max-width:92vw;padding:24px;background:#202630;border:2px solid #5e6a7a;' +
      'border-radius:10px;display:flex;flex-direction:column;gap:14px;color:#f0ebe1;';

    const title = document.createElement('div');
    title.textContent = 'Settings';
    title.style.cssText = 'font-size:20px;font-weight:800;color:#eed497;text-align:center;';
    card.appendChild(title);

    const addSlider = (
      id: string,
      label: string,
      min: number,
      max: number,
      step: number,
      val: number,
      fmt: (v: number) => string,
      onChange: (v: number) => void
    ): void => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
      const head = document.createElement('div');
      head.style.cssText = 'display:flex;justify-content:space-between;font-size:13px;';
      const lbl = document.createElement('span');
      lbl.textContent = label;
      const valSpan = document.createElement('span');
      valSpan.textContent = fmt(val);
      valSpan.style.color = '#e6c56e';
      head.append(lbl, valSpan);

      const input = document.createElement('input');
      input.id = id;
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(val);
      input.oninput = () => {
        const next = Number(input.value);
        valSpan.textContent = fmt(next);
        onChange(next);
      };
      row.append(head, input);
      card.appendChild(row);
    };

    addSlider('setting-render-dist', 'Render Distance', 3, 12, 1, this.currentSettings.renderDistance, (v) => `${v} chunks`, (v) => {
      this.currentSettings.renderDistance = v;
      this.callbacks.onSettingsChanged({ ...this.currentSettings });
    });
    addSlider('setting-fov', 'Field of View (FOV)', 55, 105, 1, this.currentSettings.fov, (v) => `${v}°`, (v) => {
      this.currentSettings.fov = v;
      this.callbacks.onSettingsChanged({ ...this.currentSettings });
    });
    addSlider('setting-sens', 'Mouse Sensitivity', 0.2, 2.5, 0.05, this.currentSettings.mouseSensitivity, (v) => `${v.toFixed(2)}×`, (v) => {
      this.currentSettings.mouseSensitivity = v;
      this.callbacks.onSettingsChanged({ ...this.currentSettings });
    });
    addSlider('setting-volume', 'Master Volume', 0, 1, 0.05, this.currentSettings.volume, (v) => `${Math.round(v * 100)}%`, (v) => {
      this.currentSettings.volume = v;
      this.callbacks.onSettingsChanged({ ...this.currentSettings });
    });

    const backBtn = this.makeButton('Done', '#d6a44b', '#14181e');
    backBtn.id = 'btn-settings-done';
    backBtn.onclick = () => {
      if (this.settingsReturnTarget === 'main') this.showMainMenu();
      else this.showPauseMenu();
    };
    card.appendChild(backBtn);
    this.settingsModalEl.appendChild(card);
  }
}
