import { BALANCE } from '../config/balance';
import { CHUNK_SIZE, CURRENT_SAVE_VERSION, DAY_LENGTH_TICKS, FIXED_DT } from '../config/constants';
import { EventBus } from '../core/events';
import { stringToSeed } from '../core/rng';
import {
  BIOME_NAMES,
  BlockPos,
  ContainerSnapshot,
  GameMode,
  GameSettings,
  GameStateSnapshot,
  IGameDebugAPI,
  InventorySnapshot,
  ItemStack,
  PerfMetricsSnapshot,
  SlotRef,
  ToolTier,
  Vec3,
} from '../core/types';
import { attachDebugAPI } from '../debug/DebugAPI';
import { DroppedItemEntity } from '../entities/DroppedItem';
import { EntityRenderer } from '../entities/EntityRenderer';
import { EntitySystem } from '../entities/EntitySystem';
import { isHostileMobKind, isPassiveMobKind, MobContext, MobEntity } from '../entities/Mob';
import { animateMobVisual, createMobMesh } from '../entities/MobRenderer';
import { isDaytimeTick, MobSpawner } from '../entities/MobSpawner';
import { ArrowEntity } from '../entities/Projectile';
import { ARMOR_SLOTS, createItemStack, Inventory } from '../player/Inventory';
import { doesBlockIntersectPlayer, stepPhysics } from '../player/Physics';
import { Player } from '../player/Player';
import { lookDirection, RaycastHit, raycastVoxel } from '../player/Raycast';
import { BlockId, BlockRegistry } from '../registry/blocks';
import { ItemId, ItemRegistry } from '../registry/items';
import { SaveManager } from '../storage/SaveManager';
import { sanitizeSettings, WorldSaveV2 } from '../storage/schema';
import { ContainerManager } from '../systems/ContainerManager';
import { craftRecipeFromInventory } from '../systems/CraftingSystem';
import { FarmingSystem } from '../systems/FarmingSystem';
import { SurvivalSystem } from '../systems/SurvivalSystem';
import { DebugOverlay } from '../ui/DebugOverlay';
import { HUD } from '../ui/HUD';
import { InventoryUI } from '../ui/InventoryUI';
import { Menus } from '../ui/Menus';
import { Chunk, chunkKey, SerializedChunk, worldToChunkCoord } from '../world/Chunk';
import { GravityBlockSystem } from '../world/GravityBlocks';
import { initializeChunkLight, propagateCrossChunkLight, updateLightingAt } from '../world/Lighting';
import { extractNeighborSlices } from '../world/Mesher';
import { findSafeSpawn, TerrainGenerator } from '../world/TerrainGenerator';
import { findNearestVillage } from '../world/VillageGenerator';
import { WaterFlowSystem } from '../world/WaterFlow';
import { World } from '../world/World';
import { ChunkMeshData } from '../world/worker/protocol';
import { AudioEngine } from './AudioEngine';
import { InputManager } from './InputManager';
import { ParticleSystem } from './ParticleSystem';
import { Renderer } from './Renderer';
import { WorldWorkerClient } from './WorldWorkerClient';

export class Game {
  readonly events = new EventBus();
  readonly entities: EntitySystem;
  readonly renderer: Renderer;
  readonly entityRenderer: EntityRenderer;
  readonly audio: AudioEngine;
  readonly particles: ParticleSystem;
  readonly input: InputManager;
  readonly gravityBlocks = new GravityBlockSystem();
  readonly waterFlow = new WaterFlowSystem();
  readonly containers = new ContainerManager();
  readonly survival = new SurvivalSystem();
  readonly farming = new FarmingSystem();
  readonly saveManager = new SaveManager();
  readonly hud: HUD;
  readonly debugOverlay: DebugOverlay;
  readonly menus: Menus;
  readonly inventoryUI: InventoryUI;
  world: World;
  worker: WorldWorkerClient;
  player: Player;
  mobSpawner: MobSpawner;
  private terrainSampler: TerrainGenerator;
  private prevLeftMouse = false;

  private mode: GameMode = 'menu';
  private worldId = 'world-default';
  private worldName = 'Stoneroot World';
  private worldTime = 6000;
  private settings: GameSettings = { ...BALANCE.defaults };
  private spawnChunkGrounded = false;
  private currentTarget: RaycastHit | null = null;
  private prevRightMouse = false;
  private placeCooldownSec = 0;
  private savedChunksCache = new Map<string, SerializedChunk>();
  private lastAutoSaveMs = 0;
  private saveInProgress = false;
  private footstepDistAccum = 0;
  private prevInWater = false;
  private digEffectTimer = 0;

  // Chunk streaming & budgeted integration state
  private readonly inflightGen = new Set<string>();
  private readonly inflightMesh = new Set<string>();
  private readonly remeshAgainAfterInflight = new Set<string>();
  private readonly priorityRemeshQueue: Array<{ cx: number; cz: number }> = [];
  private readonly remeshQueue: Array<{ cx: number; cz: number }> = [];
  private readonly remeshQueuedSet = new Set<string>();
  private readonly completedGenQueue: Array<{
    cx: number;
    cz: number;
    chunk: Chunk;
    mesh: ChunkMeshData;
    villageChests: Array<{ x: number; y: number; z: number; lootSeed: number }>;
  }> = [];
  private readonly completedGenSet = new Set<string>();
  private readonly completedMeshQueue: Array<{ cx: number; cz: number; mesh: ChunkMeshData; priority: boolean }> = [];
  private cachedSpiralRadius = -1;
  private cachedSpiralOffsets: Array<{ dx: number; dz: number; d2: number }> = [];
  private lastUnloadPcx = Number.NaN;
  private lastUnloadPcz = Number.NaN;
  private lastUnloadRadius = -1;
  private readonly maxInflightGen = 6;
  private readonly maxInflightMesh = 4;

  // Timing & perf stats
  private rafId = 0;
  private lastFrameTs = 0;
  private accumulator = 0;
  private frameJsMs = 0;
  private frameJsHistory: number[] = [];
  private maxFrameJsMs = 0;
  private fps = 60;
  private fpsFrames = 0;
  private fpsWindowStart = 0;
  private isReady = false;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement, initialSeedParam: string | null = null) {
    const startDirect = initialSeedParam !== null && initialSeedParam.trim().length > 0;
    const seedNum = stringToSeed(startDirect ? initialSeedParam : 1337);
    this.worldId = `world-${seedNum}`;
    this.world = new World(seedNum, this.events);
    this.terrainSampler = new TerrainGenerator(seedNum);
    this.mobSpawner = new MobSpawner(seedNum);
    this.entities = new EntitySystem(this.events);
    this.renderer = new Renderer(canvas, this.settings.fov);
    this.renderer.setHandVisible(startDirect);
    this.entityRenderer = new EntityRenderer(this.renderer.entityGroup, this.renderer.atlas);
    this.audio = new AudioEngine(this.events);
    this.audio.setVolume(this.settings.volume);
    this.particles = new ParticleSystem(this.renderer.scene, this.events);
    this.input = new InputManager(canvas);
    this.worker = new WorldWorkerClient(seedNum);

    const spawn = findSafeSpawn(seedNum);
    this.player = new Player({ x: spawn.x + 0.5, y: spawn.y + 0.05, z: spawn.z + 0.5 });

    // Modular M7 UI: HUD, F3 DebugOverlay, Menus, InventoryUI
    this.hud = new HUD(uiRoot, this.renderer.atlas);
    this.debugOverlay = new DebugOverlay(uiRoot);
    this.menus = new Menus(uiRoot, this.settings, {
      onNewWorld: (seedText) => {
        void this.startNewWorld(seedText || undefined);
      },
      onContinueWorld: () => {
        void this.continueWorld();
      },
      onResume: () => this.resumeGame(),
      onSaveNow: () => {
        void this.saveNow();
      },
      onQuitToMenu: () => {
        void this.quitToMenu();
      },
      onRespawn: () => this.respawnPlayer(),
      onSettingsChanged: (next) => this.applySettings(next, true),
    });

    this.inventoryUI = new InventoryUI(
      uiRoot,
      this.renderer.atlas,
      () => this.player.inventory,
      () => this.containers,
      () => {
        this.syncHeldItemVisual();
        this.renderHotbar();
        this.renderVitals();
        this.events.emit('inventory:changed', {});
      },
      () => {
        this.events.emit('container:closed', {});
      }
    );

    if (startDirect) {
      this.mode = 'playing';
      this.menus.hideAll();
      this.hud.setVisible(true);
    } else {
      this.mode = 'menu';
      this.menus.showMainMenu();
      this.hud.setVisible(false);
    }

    this.renderHotbar();
    this.renderVitals();

    canvas.addEventListener('click', () => {
      this.audio.unlock();
      if (this.mode === 'playing' && !this.inventoryUI.isOpen() && !this.input.isPointerLocked()) {
        this.input.requestPointerLock();
      }
    });
    window.addEventListener('keydown', () => this.audio.unlock(), { once: true });

    this.events.on('chunk:dirty', ({ cx, cz }) => {
      this.enqueueRemesh(cx, cz, true);
    });

    this.events.on('block:changed', ({ x, y, z, oldId, newId }) => {
      updateLightingAt(this.world, x, y, z, oldId, newId);
      this.gravityBlocks.enqueueColumnCheck(x, y, z);
      this.waterFlow.enqueueArea(x, y, z);
    });

    attachDebugAPI(this.createDebugAPI());
    void this.initPersistence();
    this.startLoop();
  }

  private async initPersistence(): Promise<void> {
    try {
      const loadedSettings = await this.saveManager.loadSettings();
      this.applySettings(loadedSettings, false);
      const summary = await this.saveManager.getLatestWorldSummary();
      this.menus.setSavedWorldSummary(summary);
    } catch {
      // Proceed cleanly with defaults
    }
    this.isReady = true;
  }

  applySettings(partial: Partial<GameSettings>, persist = true): void {
    this.settings = sanitizeSettings({ ...this.settings, ...partial });
    this.renderer.setFov(this.settings.fov);
    this.audio.setVolume(this.settings.volume);
    this.menus.updateSettingsValues(this.settings);
    if (persist) {
      void this.saveManager.saveSettings(this.settings);
    }
  }

  async startNewWorld(seedInput?: number | string, name?: string): Promise<void> {
    const seed =
      seedInput !== undefined && String(seedInput).trim().length > 0
        ? stringToSeed(seedInput)
        : Math.floor(Math.random() * 0xffffffff) >>> 0;
    this.worldId = name || `world-${seed}-${Date.now()}`;
    this.worldName = name || `Stoneroot (${seed})`;
    this.savedChunksCache.clear();
    this.resetWorldState(seed);

    const spawn = findSafeSpawn(seed);
    this.player = new Player({ x: spawn.x + 0.5, y: spawn.y + 0.05, z: spawn.z + 0.5 });
    this.mode = 'playing';
    this.menus.hideAll();
    this.menus.showMainWarning(null);
    this.hud.setVisible(true);
    this.renderer.setHandVisible(true);
    this.syncHeldItemVisual();
    this.renderHotbar();
    this.renderVitals();
    this.lastAutoSaveMs = performance.now();
  }

  async continueWorld(): Promise<void> {
    const res = await this.saveManager.loadLatestWorld();
    if (!res.ok) {
      if (!res.empty) {
        this.menus.showMainWarning(`Save could not be loaded (${res.reason}). Starting a fresh world.`);
        await this.startNewWorld(1337);
      }
      return;
    }

    const save = res.world;
    this.worldId = save.worldId;
    this.worldName = save.name;
    this.savedChunksCache = res.chunks;
    this.resetWorldState(save.seed);

    this.worldTime = save.worldTime;
    this.spawnChunkGrounded = true; // Preserve exact saved player coordinates
    this.player = new Player(save.player.spawnPoint);
    this.player.pos = { ...save.player.pos };
    this.player.yaw = save.player.yaw;
    this.player.pitch = save.player.pitch;
    this.player.health = save.player.health;
    this.player.hunger = save.player.hunger;
    this.player.saturation = save.player.saturation;
    this.player.oxygen = save.player.oxygen;
    this.player.deathCount = save.player.deathCount;
    this.player.fallPeakY = save.player.pos.y;
    this.player.inventory.loadFromSnapshot(save.player.inventory);
    this.containers.loadAll(save.containers);

    this.mode = 'playing';
    this.menus.hideAll();
    this.menus.showMainWarning(null);
    this.hud.setVisible(true);
    this.renderer.setHandVisible(true);
    this.syncHeldItemVisual();
    this.renderHotbar();
    this.renderVitals();
    this.lastAutoSaveMs = performance.now();

    if (res.migrated) {
      this.hud.showNotice('Legacy world save upgraded to latest format.');
    }
    // Immediately hydrate any saved modified chunks around player so getBlock() is instant!
    this.streamChunks();
  }

  private resetWorldState(seed: number): void {
    this.world.clear();
    this.entities.clear();
    this.entityRenderer.clear();
    this.particles.clear();
    this.containers.clear();
    this.inventoryUI.close();
    this.renderer.clearAllChunks();
    this.inflightGen.clear();
    this.inflightMesh.clear();
    this.remeshAgainAfterInflight.clear();
    this.priorityRemeshQueue.length = 0;
    this.remeshQueue.length = 0;
    this.remeshQueuedSet.clear();
    this.completedGenQueue.length = 0;
    this.completedGenSet.clear();
    this.completedMeshQueue.length = 0;
    this.lastUnloadPcx = Number.NaN;
    this.lastUnloadPcz = Number.NaN;
    this.lastUnloadRadius = -1;
    this.prevInWater = false;
    this.footstepDistAccum = 0;

    this.world = new World(seed, this.events);
    this.terrainSampler = new TerrainGenerator(seed);
    this.mobSpawner = new MobSpawner(seed);
    this.worker.resetSeed(seed);
    this.worldTime = 6000;
    this.spawnChunkGrounded = false;
    this.survival.resetTimers();
  }

  async saveNow(): Promise<void> {
    if (this.mode === 'menu' || this.saveInProgress) return;
    this.saveInProgress = true;
    try {
      // Merge currently loaded modified chunks into savedChunksCache
      for (const chunk of this.world.getModifiedChunks()) {
        this.savedChunksCache.set(chunkKey(chunk.cx, chunk.cz), chunk.serialize());
      }
      const savePayload: WorldSaveV2 = {
        version: CURRENT_SAVE_VERSION,
        worldId: this.worldId,
        name: this.worldName,
        seed: this.world.seed,
        worldTime: this.worldTime,
        savedAt: Date.now(),
        player: {
          pos: { ...this.player.pos },
          yaw: this.player.yaw,
          pitch: this.player.pitch,
          health: this.player.health,
          hunger: this.player.hunger,
          saturation: this.player.saturation,
          oxygen: this.player.oxygen,
          spawnPoint: { ...this.player.spawnPoint },
          deathCount: this.player.deathCount,
          inventory: this.player.inventory.toSnapshot(),
        },
        containers: this.containers.serializeAll(),
      };
      await this.saveManager.saveWorld(savePayload, Array.from(this.savedChunksCache.values()));
      this.lastAutoSaveMs = performance.now();
      this.menus.setSavedWorldSummary({
        worldId: savePayload.worldId,
        name: savePayload.name,
        seed: savePayload.seed,
        worldTime: savePayload.worldTime,
        savedAt: savePayload.savedAt,
      });
      this.hud.showNotice('World saved');
      this.events.emit('world:saved', { worldId: this.worldId, timestamp: savePayload.savedAt });
    } finally {
      this.saveInProgress = false;
    }
  }

  pauseGame(): void {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.inventoryUI.close();
    this.input.exitPointerLock();
    this.menus.showPauseMenu();
    void this.saveNow();
  }

  resumeGame(): void {
    if (this.mode !== 'paused') return;
    this.mode = 'playing';
    this.menus.hideAll();
  }

  async quitToMenu(): Promise<void> {
    if (this.mode === 'playing' || this.mode === 'paused') {
      await this.saveNow();
    }
    this.inventoryUI.close();
    this.input.exitPointerLock();
    this.mode = 'menu';
    this.hud.setVisible(false);
    this.renderer.setHandVisible(false);
    this.menus.showMainMenu();
  }

  private handlePlayerDeath(cause: string): void {
    this.mode = 'dead';
    this.inventoryUI.close();
    this.input.exitPointerLock();
    const dropped = this.player.inventory.extractAllItems();
    for (const stack of dropped) {
      this.spawnDroppedItem(
        { x: this.player.pos.x, y: this.player.pos.y + 0.6, z: this.player.pos.z },
        stack
      );
    }
    this.menus.showDeathScreen(cause);
    this.syncHeldItemVisual();
    this.renderHotbar();
    this.renderVitals();
  }

  respawnPlayer(): void {
    if (!this.player.dead && this.mode !== 'dead') return;
    this.survival.respawnPlayer(this.player, this.events);
    this.menus.hideAll();
    this.mode = 'playing';
    this.syncHeldItemVisual();
    this.renderHotbar();
    this.renderVitals();
  }

  private enqueueRemesh(cx: number, cz: number, priority = false): void {
    const k = chunkKey(cx, cz);
    if (!this.world.hasChunk(cx, cz)) return;
    if (this.inflightMesh.has(k)) {
      this.remeshAgainAfterInflight.add(k);
      return;
    }
    if (this.remeshQueuedSet.has(k)) {
      if (priority) {
        this.priorityRemeshQueue.push({ cx, cz });
      }
      return;
    }
    this.remeshQueuedSet.add(k);
    if (priority) {
      this.priorityRemeshQueue.push({ cx, cz });
    } else {
      this.remeshQueue.push({ cx, cz });
    }
  }

  private startLoop(): void {
    this.lastFrameTs = performance.now();
    this.fpsWindowStart = this.lastFrameTs;

    const tick = (now: number): void => {
      if (this.disposed) return;
      this.rafId = requestAnimationFrame(tick);

      const jsStart = performance.now();
      const rawDt = Math.min(0.1, Math.max(0.001, (now - this.lastFrameTs) / 1000));
      this.lastFrameTs = now;

      this.handleUIAndLookInput();

      this.accumulator += rawDt;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < 4) {
        this.stepFixed(FIXED_DT);
        this.accumulator -= FIXED_DT;
        steps++;
      }

      this.drainCompletedWorkerResults(jsStart);
      this.streamChunks();
      this.processRemeshQueue(jsStart);

      const eye =
        this.mode === 'menu'
          ? { x: this.player.pos.x, y: this.player.pos.y + 18, z: this.player.pos.z }
          : this.player.getEyePosition();
      const camYaw = this.mode === 'menu' ? (now * 0.00012) % (Math.PI * 2) : this.player.yaw;
      const camPitch = this.mode === 'menu' ? -0.34 : this.player.pitch;
      const horizSpeed = Math.hypot(this.player.vel.x, this.player.vel.z);
      this.renderer.updateHandAnimation(rawDt, horizSpeed, this.player.onGround && !this.player.flying);
      this.renderer.setCamera(eye, camYaw, camPitch, this.mode === 'playing' && !this.player.flying);
      this.renderer.updateEnvironment(
        this.worldTime,
        this.settings.renderDistance,
        eye,
        this.mode !== 'menu' && this.player.headInWater
      );

      this.particles.update(rawDt);

      const allEnts = this.entities.all();
      this.entityRenderer.sync(allEnts, now / 1000, (e) => {
        if (isHostileMobKind(e.kind) || isPassiveMobKind(e.kind)) {
          return createMobMesh(e.kind);
        }
        return null;
      });
      for (const e of allEnts) {
        if (e instanceof MobEntity) {
          const obj = this.entityRenderer.getObject(e.id);
          if (obj) animateMobVisual(e, obj);
        }
      }

      // Update HUD screen overlays (hurt flash, underwater tint, toast timers)
      this.hud.updateEffects(this.player);

      // Auto-save every 30s during active gameplay
      if (this.mode === 'playing' && now - this.lastAutoSaveMs > 30_000) {
        this.lastAutoSaveMs = now;
        void this.saveNow();
      }

      // Update selection box & break overlay
      if (this.currentTarget && !this.inventoryUI.isOpen()) {
        const h = BlockRegistry.getHeight(this.currentTarget.blockId) || 1.0;
        this.renderer.setTargetBlock(this.currentTarget.pos, h);
      } else {
        this.renderer.setTargetBlock(null);
      }

      if (this.player.mining.target && this.player.mining.requiredSec > 0) {
        const progress = Math.min(1, this.player.mining.elapsedSec / this.player.mining.requiredSec);
        const h = BlockRegistry.getHeight(this.player.mining.blockId) || 1.0;
        this.renderer.setBreakOverlay(this.player.mining.target, progress, h);
      } else {
        this.renderer.setBreakOverlay(null, 0);
      }

      const jsBeforeRender = performance.now();
      this.renderer.render();
      const jsMs = jsBeforeRender - jsStart;
      this.frameJsMs = jsMs;
      this.frameJsHistory.push(jsMs);
      if (this.frameJsHistory.length > 120) this.frameJsHistory.shift();
      if (jsMs > this.maxFrameJsMs) this.maxFrameJsMs = jsMs;

      this.fpsFrames++;
      if (now - this.fpsWindowStart >= 500) {
        this.fps = Math.round((this.fpsFrames * 1000) / (now - this.fpsWindowStart));
        this.fpsFrames = 0;
        this.fpsWindowStart = now;
        this.updateHudText();
        if (this.inventoryUI.getActive().kind === 'furnace') {
          this.inventoryUI.refresh();
        }
      }
    };

    this.rafId = requestAnimationFrame(tick);
  }

  private handleUIAndLookInput(): void {
    // Toggle F3 debug overlay anytime
    if (this.input.consumePress('F3')) {
      this.debugOverlay.toggle();
      this.updateHudText();
    }

    if (this.mode === 'menu' || this.mode === 'dead') {
      this.input.consumeMouseDelta();
      this.input.consumeWheelDelta();
      return;
    }

    // Escape closes inventory or toggles Pause Menu
    if (this.input.consumePress('Escape')) {
      if (this.inventoryUI.isOpen()) {
        this.inventoryUI.close();
      } else if (this.mode === 'playing') {
        this.pauseGame();
      } else if (this.mode === 'paused') {
        this.resumeGame();
      }
      return;
    }

    if (this.mode === 'paused') {
      this.input.consumeMouseDelta();
      this.input.consumeWheelDelta();
      return;
    }

    // Toggle inventory with E
    if (this.input.consumePress('KeyE')) {
      if (this.inventoryUI.isOpen()) {
        this.inventoryUI.close();
      } else {
        this.input.exitPointerLock();
        this.inventoryUI.open('inventory');
      }
    }

    // Q drops 1 held item
    if (!this.inventoryUI.isOpen() && this.input.consumePress('KeyQ')) {
      this.dropSelectedItem();
    }

    if (this.inventoryUI.isOpen()) {
      this.input.consumeMouseDelta();
      this.input.consumeWheelDelta();
      return;
    }

    const { dx, dy } = this.input.consumeMouseDelta();
    if (dx !== 0 || dy !== 0) {
      const sens = 0.0022 * this.settings.mouseSensitivity;
      this.player.yaw -= dx * sens;
      this.player.pitch = Math.max(
        -Math.PI / 2 + 0.01,
        Math.min(Math.PI / 2 - 0.01, this.player.pitch - dy * sens)
      );
    }

    const wheel = this.input.consumeWheelDelta();
    if (wheel !== 0) {
      this.selectHotbar((this.player.selectedSlot + wheel + 9) % 9);
    }

    for (let i = 1; i <= 9; i++) {
      if (this.input.consumePress(`Digit${i}`)) {
        this.selectHotbar(i - 1);
      }
    }
  }

  selectHotbar(slot: number): void {
    const clamped = Math.max(0, Math.min(8, Math.floor(slot)));
    if (clamped !== this.player.selectedSlot) {
      this.player.selectedSlot = clamped;
      this.syncHeldItemVisual();
      this.renderHotbar();
      const held = this.player.inventory.getSelected();
      if (held) {
        this.hud.showHeldItemName(ItemRegistry.get(held.itemId)?.name ?? null);
      }
    }
  }

  private syncHeldItemVisual(): void {
    const stack = this.player.inventory.getSelected();
    if (!stack) {
      this.renderer.setHeldItemIcon(null);
    } else {
      const def = ItemRegistry.get(stack.itemId);
      this.renderer.setHeldItemIcon(def?.icon ?? null);
    }
  }

  spawnDroppedItem(pos: Vec3, stack: ItemStack, vel?: Vec3, pickupDelayTicks?: number): DroppedItemEntity {
    const id = this.entities.allocateId();
    const v = vel ?? {
      x: (Math.random() - 0.5) * 2.2,
      y: 3.2,
      z: (Math.random() - 0.5) * 2.2,
    };
    const drop = new DroppedItemEntity(
      id,
      pos,
      v,
      stack,
      {
        world: this.world,
        getPlayerPos: () => this.player.pos,
        onPickup: (s) => {
          const rem = this.player.inventory.addStack(s);
          this.syncHeldItemVisual();
          this.renderHotbar();
          this.events.emit('sound:play', { name: 'pickup', volume: 0.5 });
          this.events.emit('inventory:changed', {});
          return rem;
        },
        getNearbyDrops: () => this.entities.byKind('dropped_item') as DroppedItemEntity[],
      },
      pickupDelayTicks
    );
    this.entities.add(drop);
    return drop;
  }

  dropSelectedItem(): boolean {
    const popped = this.player.inventory.consumeSelected(1);
    if (!popped) return false;
    const eye = this.player.getEyePosition();
    const dir = lookDirection(this.player.yaw, this.player.pitch);
    this.spawnDroppedItem(
      { x: eye.x + dir.x * 0.7, y: eye.y - 0.2, z: eye.z + dir.z * 0.7 },
      popped,
      { x: dir.x * 5.0, y: Math.max(1.8, dir.y * 4.5 + 1.5), z: dir.z * 5.0 },
      24
    );
    this.syncHeldItemVisual();
    this.renderHotbar();
    return true;
  }

  firePlayerBow(chargeSec: number): boolean {
    const held = this.player.inventory.getSelected();
    if (!held) return false;
    const def = ItemRegistry.get(held.itemId);
    if (!def?.isBow) return false;
    if (!this.player.inventory.consumeItem(ItemId.Arrow, 1)) return false;

    const ratio = Math.max(0.15, Math.min(1, chargeSec / BALANCE.tools.bowMaxChargeSec));
    const speed =
      BALANCE.tools.bowMinSpeed + (BALANCE.tools.bowMaxSpeed - BALANCE.tools.bowMinSpeed) * ratio;
    const damage = Math.round(
      BALANCE.tools.bowMinDamage + (BALANCE.tools.bowMaxDamage - BALANCE.tools.bowMinDamage) * ratio
    );

    const eye = this.player.getEyePosition();
    const dir = lookDirection(this.player.yaw, this.player.pitch);
    const arrow = new ArrowEntity(
      this.entities.allocateId(),
      { x: eye.x + dir.x * 0.5, y: eye.y + dir.y * 0.5, z: eye.z + dir.z * 0.5 },
      { x: dir.x * speed, y: dir.y * speed + 1.2, z: dir.z * speed },
      damage,
      'player',
      0,
      {
        world: this.world,
        onHitEntity: (arr, pos) => this.handleArrowHit(arr, pos),
      }
    );
    this.entities.add(arrow);
    this.player.inventory.damageSelectedTool(1);
    this.renderer.triggerHandSwing();
    this.events.emit('sound:play', { name: 'bow', volume: 0.8 });
    this.syncHeldItemVisual();
    this.renderHotbar();
    return true;
  }

  private getMobContext(): MobContext {
    return {
      world: this.world,
      getPlayerPos: () => this.player.pos,
      isPlayerAlive: () => !this.player.dead && !this.player.flying,
      isDaytime: () => isDaytimeTick(this.worldTime),
      onDamagePlayer: (amount, source, knockbackDir) => {
        const hit = this.survival.damagePlayer(
          this.player,
          this.events,
          amount,
          source,
          { onPlayerDied: (cause) => this.handlePlayerDeath(cause) },
          false,
          false
        );
        if (hit && !this.player.dead) {
          const len = Math.hypot(knockbackDir.x, knockbackDir.z) || 1;
          this.player.vel.x += (knockbackDir.x / len) * 5.2;
          this.player.vel.z += (knockbackDir.z / len) * 5.2;
          this.player.vel.y = Math.max(this.player.vel.y, 3.6);
          this.renderVitals();
        }
      },
      onShootArrow: (origin, vel, damage, shooterId) => {
        const arrow = new ArrowEntity(
          this.entities.allocateId(),
          origin,
          vel,
          damage,
          'mob',
          shooterId,
          {
            world: this.world,
            onHitEntity: (arr, pos) => this.handleArrowHit(arr, pos),
          }
        );
        this.entities.add(arrow);
        this.events.emit('sound:play', { name: 'bow', volume: 0.65 });
      },
      onMobDied: (mob, drops) => {
        this.events.emit('entity:killed', { id: mob.id, kind: mob.kind, pos: { ...mob.pos } });
        for (const stack of drops) {
          this.spawnDroppedItem(
            { x: mob.pos.x, y: mob.pos.y + 0.5, z: mob.pos.z },
            stack
          );
        }
      },
    };
  }

  private handleArrowHit(arrow: ArrowEntity, pos: Vec3): boolean {
    if (arrow.owner === 'player') {
      for (const e of this.entities.all()) {
        if (!(e instanceof MobEntity) || !e.alive) continue;
        const hw = e.width * 0.65;
        if (
          Math.abs(pos.x - e.pos.x) <= hw &&
          Math.abs(pos.z - e.pos.z) <= hw &&
          pos.y >= e.pos.y &&
          pos.y <= e.pos.y + e.height + 0.15
        ) {
          e.takeDamage(arrow.damage, { x: arrow.vel.x, y: 0, z: arrow.vel.z }, true);
          this.events.emit('sound:play', { name: 'hit', volume: 0.75 });
          return true;
        }
      }
    } else if (arrow.owner === 'mob' && !this.player.dead && !this.player.flying) {
      const hw = this.player.width * 0.65;
      if (
        Math.abs(pos.x - this.player.pos.x) <= hw &&
        Math.abs(pos.z - this.player.pos.z) <= hw &&
        pos.y >= this.player.pos.y &&
        pos.y <= this.player.pos.y + this.player.height
      ) {
        this.survival.damagePlayer(
          this.player,
          this.events,
          arrow.damage,
          'bone_archer',
          { onPlayerDied: (c) => this.handlePlayerDeath(c) },
          false,
          false
        );
        this.renderVitals();
        return true;
      }
    }
    return false;
  }

  /**
   * Player melee attack along crosshair ray against closest MobEntity within reach.
   */
  attackTargetedMob(): boolean {
    if (this.player.dead || this.player.attackCooldownTicks > 0) return false;
    this.renderer.triggerHandSwing();
    this.player.attackCooldownTicks = BALANCE.player.attackCooldownTicks;

    const eye = this.player.getEyePosition();
    const dir = lookDirection(this.player.yaw, this.player.pitch);
    const maxDist = 4.5;

    let bestMob: MobEntity | null = null;
    let bestDist = maxDist;

    for (const e of this.entities.all()) {
      if (!(e instanceof MobEntity) || !e.alive) continue;
      // Vector from eye to mob center
      const cx = e.pos.x - eye.x;
      const cy = e.pos.y + e.height * 0.5 - eye.y;
      const cz = e.pos.z - eye.z;
      const proj = cx * dir.x + cy * dir.y + cz * dir.z;
      if (proj < 0 || proj > bestDist) continue;
      // Closest point on ray to mob center
      const px = eye.x + dir.x * proj;
      const py = eye.y + dir.y * proj;
      const pz = eye.z + dir.z * proj;
      const hitRadius = Math.max(e.width * 0.85, 0.72);
      const horizErr = Math.hypot(px - e.pos.x, pz - e.pos.z);
      const vertOk = py >= e.pos.y - 0.35 && py <= e.pos.y + e.height + 0.35;
      if (horizErr <= hitRadius && vertOk) {
        bestDist = proj;
        bestMob = e;
      }
    }

    if (!bestMob) return false;

    const held = this.player.inventory.getSelected();
    const def = held ? ItemRegistry.get(held.itemId) : undefined;
    const damage = def?.attackDamage ?? BALANCE.player.attackDamageHand;

    const hit = bestMob.takeDamage(damage, { x: dir.x, y: 0, z: dir.z }, true);
    if (hit) {
      if (def?.durability) {
        this.player.inventory.damageSelectedTool(1);
        this.syncHeldItemVisual();
        this.renderHotbar();
      }
      this.events.emit('sound:play', { name: 'hit', volume: 0.8 });
    }
    return hit;
  }

  private stepFixed(dt: number): void {
    if (this.mode !== 'playing') return;

    this.worldTime = (this.worldTime + 1) % (DAY_LENGTH_TICKS * 10000);
    if (this.placeCooldownSec > 0) this.placeCooldownSec = Math.max(0, this.placeCooldownSec - dt);

    const pcx = worldToChunkCoord(this.player.pos.x);
    const pcz = worldToChunkCoord(this.player.pos.z);
    const chunkLoaded = this.world.hasChunk(pcx, pcz);

    if (chunkLoaded && !this.spawnChunkGrounded) {
      this.spawnChunkGrounded = true;
      if (!this.player.flying) {
        const sx = Math.floor(this.player.pos.x);
        const sz = Math.floor(this.player.pos.z);
        const topY = this.world.getTopSolidY(sx, sz);
        if (this.player.pos.y < topY + 1) {
          this.player.pos.y = topY + 1.02;
        }
        const tx = sx + 2;
        const tz = sz;
        if (this.world.hasChunk(worldToChunkCoord(tx), worldToChunkCoord(tz))) {
          const ty = this.world.getTopSolidY(tx, tz) + 1;
          if (
            this.world.getBlock(tx, ty, tz) === BlockId.Air &&
            !BlockRegistry.isLiquid(this.world.getBlock(tx, ty - 1, tz))
          ) {
            this.world.setBlock(tx, ty, tz, BlockId.Torch, 0, false);
          }
        }
      }
    }

    const uiOpen = this.inventoryUI.isOpen();

    let stepRes = {
      landed: false,
      impactSpeed: 0,
      horizontalDistance: 0,
      collidedX: false,
      collidedZ: false,
    };
    const jumped = !uiOpen && this.input.isDown('Space') && this.player.onGround && !this.player.inWater;

    if (chunkLoaded || this.player.flying) {
      const forward = uiOpen ? 0 : (this.input.isDown('KeyW') ? 1 : 0) - (this.input.isDown('KeyS') ? 1 : 0);
      const strafe = uiOpen ? 0 : (this.input.isDown('KeyD') ? 1 : 0) - (this.input.isDown('KeyA') ? 1 : 0);

      stepRes = stepPhysics(
        this.world,
        this.player,
        {
          forward,
          strafe,
          jump: !uiOpen && this.input.isDown('Space'),
          sneak: !uiOpen && this.input.isSneakingInput(),
          sprint: !uiOpen && this.input.isSprintingInput(),
        },
        dt,
        this.player.hunger >= BALANCE.survival.hungerSprintMinHunger
      );
    }

    this.survival.tick(this.player, stepRes, jumped, dt, this.events, {
      onPlayerDied: (cause) => this.handlePlayerDeath(cause),
    });

    // Procedural footsteps & water splash particles/audio
    if (!this.player.flying && !this.player.dead) {
      if (!this.prevInWater && this.player.inWater) {
        this.events.emit('sound:play', { name: 'splash', volume: 0.78 });
        this.events.emit('particles:burst', {
          pos: { x: this.player.pos.x, y: this.player.pos.y + 0.55, z: this.player.pos.z },
          kind: 'splash',
          count: 14,
        });
      }
      this.prevInWater = this.player.inWater;

      if (this.player.onGround && !this.player.inWater && stepRes.horizontalDistance > 0.001) {
        this.footstepDistAccum += stepRes.horizontalDistance;
        if (this.footstepDistAccum >= 1.75) {
          this.footstepDistAccum = 0;
          this.events.emit('sound:play', { name: 'step', volume: this.player.sneaking ? 0.16 : 0.42 });
        }
      }
    }

    if (this.player.dead) {
      this.input.clearPressedFrame();
      return;
    }

    // Raycast targeted block
    const eye = this.player.getEyePosition();
    const dir = lookDirection(this.player.yaw, this.player.pitch);
    this.currentTarget = raycastVoxel(this.world, eye, dir, BALANCE.player.reachDistance);

    if (!uiOpen) {
      // Left-click edge attacks mob in crosshair if in melee range, else mines targeted block
      const leftDown = this.input.isLeftMouseDown();
      if (leftDown && !this.prevLeftMouse) {
        if (this.attackTargetedMob()) {
          this.player.resetMining();
        }
      }
      this.prevLeftMouse = leftDown;

      // Mining progression
      if (leftDown && this.currentTarget) {
        this.stepMining(this.currentTarget, dt);
      } else {
        this.player.resetMining();
      }

      // Right-click: Bow charge OR interact/place
      const rightDown = this.input.isRightMouseDown();
      const heldStack = this.player.inventory.getSelected();
      const heldDef = heldStack ? ItemRegistry.get(heldStack.itemId) : undefined;

      if (heldDef?.isBow) {
        if (rightDown) {
          this.player.chargingBow = true;
          this.player.bowChargeSec = Math.min(BALANCE.tools.bowMaxChargeSec, this.player.bowChargeSec + dt);
        } else if (this.player.chargingBow) {
          this.firePlayerBow(this.player.bowChargeSec);
          this.player.chargingBow = false;
          this.player.bowChargeSec = 0;
        }
      } else {
        this.player.chargingBow = false;
        this.player.bowChargeSec = 0;
        if (rightDown && !this.prevRightMouse && this.placeCooldownSec <= 0) {
          this.interactOrPlace();
          this.placeCooldownSec = 0.2;
        }
      }
      this.prevRightMouse = rightDown;
    }

    this.containers.tickFurnaces(1);
    this.farming.tick(this.world, 1);
    this.mobSpawner.tick(this.world, this.player.pos, this.entities, this.worldTime, this.getMobContext(), 1);
    this.gravityBlocks.tick(this.world);
    this.waterFlow.tick(this.world);
    this.entities.update(dt);
    this.input.clearPressedFrame();
  }

  private getHeldToolInfo(): { toolType: string | null; toolTier: ToolTier; speed: number } {
    const held = this.player.inventory.getSelected();
    if (!held) return { toolType: null, toolTier: ToolTier.None, speed: BALANCE.mining.handSpeedMultiplier };
    const def = ItemRegistry.get(held.itemId);
    if (!def || !def.toolType) {
      return { toolType: null, toolTier: ToolTier.None, speed: BALANCE.mining.handSpeedMultiplier };
    }
    return {
      toolType: def.toolType,
      toolTier: def.toolTier ?? ToolTier.None,
      speed: def.miningSpeed ?? BALANCE.mining.handSpeedMultiplier,
    };
  }

  private computeBreakTime(blockId: BlockId): number {
    const def = BlockRegistry.get(blockId);
    if (def.hardness < 0) return Infinity;
    if (def.hardness <= 0.05) return 0.05;

    const tool = this.getHeldToolInfo();
    const matchesType = def.toolType !== null && tool.toolType === def.toolType;
    const meetsTier = tool.toolTier >= def.minToolTier;

    if (def.minToolTier > ToolTier.None && (!matchesType || !meetsTier)) {
      return def.hardness * BALANCE.mining.wrongToolMultiplier;
    }
    if (matchesType) {
      return Math.max(0.08, def.hardness / tool.speed);
    }
    return def.hardness;
  }

  private canDropFromBlock(blockId: BlockId): boolean {
    const def = BlockRegistry.get(blockId);
    if (def.minToolTier <= ToolTier.None) return true;
    const tool = this.getHeldToolInfo();
    return def.toolType !== null && tool.toolType === def.toolType && tool.toolTier >= def.minToolTier;
  }

  private stepMining(hit: RaycastHit, dt: number): { broken: boolean; blockId: BlockId; pos: BlockPos } {
    const def = BlockRegistry.get(hit.blockId);
    if (def.hardness < 0) {
      this.player.resetMining();
      return { broken: false, blockId: hit.blockId, pos: hit.pos };
    }

    const cur = this.player.mining.target;
    if (!cur || cur.x !== hit.pos.x || cur.y !== hit.pos.y || cur.z !== hit.pos.z) {
      this.player.mining.target = { ...hit.pos };
      this.player.mining.blockId = hit.blockId;
      this.player.mining.elapsedSec = 0;
      this.player.mining.requiredSec = this.computeBreakTime(hit.blockId);
      this.digEffectTimer = 0.16;
    }

    this.player.mining.elapsedSec += dt;
    this.digEffectTimer += dt;
    if (this.digEffectTimer >= 0.22 && this.player.mining.elapsedSec < this.player.mining.requiredSec) {
      this.digEffectTimer = 0;
      this.renderer.triggerHandSwing();
      this.events.emit('sound:play', { name: 'dig', volume: 0.55 });
      this.events.emit('particles:burst', {
        pos: {
          x: hit.pos.x + 0.5 + hit.normal.x * 0.52,
          y: hit.pos.y + 0.5 + hit.normal.y * 0.52,
          z: hit.pos.z + 0.5 + hit.normal.z * 0.52,
        },
        blockId: hit.blockId,
        kind: 'dig',
        count: 4,
      });
    }

    if (this.player.mining.elapsedSec >= this.player.mining.requiredSec) {
      const brokenId = hit.blockId;
      const brokenPos = { ...hit.pos };
      const shouldDrop = this.canDropFromBlock(brokenId);

      // Handle two-block wooden door pair cleanly
      if (brokenId === BlockId.WoodDoorBottom) {
        if (this.world.getBlock(brokenPos.x, brokenPos.y + 1, brokenPos.z) === BlockId.WoodDoorTop) {
          this.world.setBlock(brokenPos.x, brokenPos.y + 1, brokenPos.z, BlockId.Air);
        }
      } else if (brokenId === BlockId.WoodDoorTop) {
        if (this.world.getBlock(brokenPos.x, brokenPos.y - 1, brokenPos.z) === BlockId.WoodDoorBottom) {
          this.world.setBlock(brokenPos.x, brokenPos.y - 1, brokenPos.z, BlockId.Air);
        }
      }

      this.world.setBlock(brokenPos.x, brokenPos.y, brokenPos.z, BlockId.Air);
      this.renderer.triggerHandSwing();
      this.events.emit('sound:play', { name: 'break', volume: 0.85 });
      this.events.emit('particles:burst', {
        pos: { x: brokenPos.x + 0.5, y: brokenPos.y + 0.5, z: brokenPos.z + 0.5 },
        blockId: brokenId,
        kind: 'break',
        count: 14,
      });
      this.player.resetMining();
      this.survival.addMiningExhaustion();

      // Wear tool durability when mining non-instant blocks
      if (def.hardness > 0.05) {
        this.player.inventory.damageSelectedTool(1);
        this.syncHeldItemVisual();
        this.renderHotbar();
      }

      const dropCenter = { x: brokenPos.x + 0.5, y: brokenPos.y + 0.4, z: brokenPos.z + 0.5 };

      // Drop container contents if chest or furnace was broken
      if (brokenId === BlockId.Chest || brokenId === BlockId.Furnace) {
        const extraDrops = this.containers.extractDropsOnBreak(brokenPos.x, brokenPos.y, brokenPos.z);
        for (const st of extraDrops) {
          this.spawnDroppedItem(dropCenter, st);
        }
      }

      // Drop block loot if tool tier requirement met
      if (shouldDrop) {
        if (brokenId === BlockId.TallGrass) {
          if (Math.random() < BALANCE.farming.tallGrassSeedChance) {
            this.spawnDroppedItem(dropCenter, createItemStack(ItemId.GrainSeeds, 1));
          }
        } else if (brokenId === BlockId.OakLeaves || brokenId === BlockId.BirchLeaves) {
          if (Math.random() < 0.08) {
            this.spawnDroppedItem(dropCenter, createItemStack(ItemId.Apple, 1));
          }
        } else if (brokenId === BlockId.CropStage3) {
          this.spawnDroppedItem(dropCenter, createItemStack(ItemId.Wheat, 1));
          const seedCnt =
            BALANCE.farming.seedDropMin +
            Math.floor(Math.random() * (BALANCE.farming.seedDropMax - BALANCE.farming.seedDropMin + 1));
          this.spawnDroppedItem(dropCenter, createItemStack(ItemId.GrainSeeds, seedCnt));
        } else if (def.dropItemKey) {
          const dropItem = ItemRegistry.getByKey(def.dropItemKey);
          if (dropItem) {
            this.spawnDroppedItem(dropCenter, createItemStack(dropItem.id, def.dropCount));
          }
        }
      }

      return { broken: true, blockId: brokenId, pos: brokenPos };
    }

    return { broken: false, blockId: hit.blockId, pos: hit.pos };
  }

  openContainerAt(x: number, y: number, z: number): boolean {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const dist = Math.hypot(
      ix + 0.5 - this.player.pos.x,
      iy + 0.5 - (this.player.pos.y + 1),
      iz + 0.5 - this.player.pos.z
    );
    if (dist > BALANCE.player.reachDistance + 2.0) return false;

    const id = this.world.getBlock(ix, iy, iz);
    if (id === BlockId.Workbench) {
      this.input.exitPointerLock();
      this.inventoryUI.open('workbench', { x: ix, y: iy, z: iz });
      this.events.emit('container:opened', { type: 'workbench', pos: { x: ix, y: iy, z: iz } });
      return true;
    }
    if (id === BlockId.Furnace) {
      this.containers.getOrCreateFurnace(ix, iy, iz);
      this.input.exitPointerLock();
      this.inventoryUI.open('furnace', { x: ix, y: iy, z: iz });
      this.events.emit('container:opened', { type: 'furnace', pos: { x: ix, y: iy, z: iz } });
      return true;
    }
    if (id === BlockId.Chest) {
      this.containers.getOrCreateChest(ix, iy, iz);
      this.input.exitPointerLock();
      this.inventoryUI.open('chest', { x: ix, y: iy, z: iz });
      this.events.emit('container:opened', { type: 'chest', pos: { x: ix, y: iy, z: iz } });
      return true;
    }
    return false;
  }

  interactOrPlace(): boolean {
    const eye = this.player.getEyePosition();
    const dir = lookDirection(this.player.yaw, this.player.pitch);
    const hit = raycastVoxel(this.world, eye, dir, BALANCE.player.reachDistance);

    if (hit && !this.player.sneaking) {
      // Interact with container blocks
      if (
        hit.blockId === BlockId.Workbench ||
        hit.blockId === BlockId.Furnace ||
        hit.blockId === BlockId.Chest
      ) {
        return this.openContainerAt(hit.pos.x, hit.pos.y, hit.pos.z);
      }

      // Interact with Camp Bed: set spawn point & skip night to dawn
      if (hit.blockId === BlockId.Bed) {
        const res = this.survival.useBed(this.player, hit.pos.x, hit.pos.y, hit.pos.z, this.worldTime);
        this.worldTime = res.newWorldTime;
        return true;
      }

      // Toggle wooden doors
      if (hit.blockId === BlockId.WoodDoorBottom || hit.blockId === BlockId.WoodDoorTop) {
        const baseY = hit.blockId === BlockId.WoodDoorTop ? hit.pos.y - 1 : hit.pos.y;
        const curMeta = this.world.getMeta(hit.pos.x, baseY, hit.pos.z);
        const nextMeta = curMeta ^ 1;
        this.world.setMeta(hit.pos.x, baseY, hit.pos.z, nextMeta);
        if (this.world.getBlock(hit.pos.x, baseY + 1, hit.pos.z) === BlockId.WoodDoorTop) {
          this.world.setMeta(hit.pos.x, baseY + 1, hit.pos.z, nextMeta);
        }
        this.events.emit('sound:play', { name: 'door', volume: 0.65 });
        return true;
      }
    }

    const held = this.player.inventory.getSelected();
    const heldDef = held ? ItemRegistry.get(held.itemId) : undefined;

    // Hoe tilling dirt/grass into farmland
    if (hit && heldDef?.toolType === 'hoe') {
      if (this.farming.tillSoil(this.world, hit.pos.x, hit.pos.y, hit.pos.z)) {
        this.player.inventory.damageSelectedTool(1);
        this.renderer.triggerHandSwing();
        this.events.emit('sound:play', { name: 'dig', volume: 0.65 });
        this.syncHeldItemVisual();
        this.renderHotbar();
        return true;
      }
    }

    // Bonemeal accelerates crop growth
    if (hit && heldDef?.isBonemeal) {
      if (this.farming.applyBonemeal(this.world, hit.pos.x, hit.pos.y, hit.pos.z)) {
        this.player.inventory.consumeSelected(1);
        this.renderer.triggerHandSwing();
        this.events.emit('sound:play', { name: 'craft', volume: 0.55 });
        this.syncHeldItemVisual();
        this.renderHotbar();
        return true;
      }
    }

    // Eat food when hungry
    if (heldDef?.foodRestore && this.player.hunger < this.player.maxHunger) {
      if (this.survival.eatSelectedFood(this.player, this.events)) {
        this.renderer.triggerHandSwing();
        this.events.emit('sound:play', { name: 'eat', volume: 0.72 });
        this.syncHeldItemVisual();
        this.renderHotbar();
        this.renderVitals();
        return true;
      }
    }

    return this.placeSelectedBlock();
  }

  placeSelectedBlock(): boolean {
    const eye = this.player.getEyePosition();
    const dir = lookDirection(this.player.yaw, this.player.pitch);
    const hit = raycastVoxel(this.world, eye, dir, BALANCE.player.reachDistance);
    if (!hit) return false;

    const stack = this.player.inventory.getSelected();
    if (!stack || stack.count <= 0) return false;
    const itemDef = ItemRegistry.get(stack.itemId);
    if (!itemDef || itemDef.placesBlock === undefined) return false;

    const placeBlockId = itemDef.placesBlock;
    const hitDef = BlockRegistry.get(hit.blockId);
    const targetPos = hitDef.replaceable ? hit.pos : hit.adjacent;

    const existing = this.world.getBlock(targetPos.x, targetPos.y, targetPos.z);
    if (!BlockRegistry.isReplaceable(existing) && existing !== BlockId.Air) return false;

    // Crops can only be planted on Farmland / FarmlandWet
    if (placeBlockId === BlockId.CropStage0) {
      const below = this.world.getBlock(targetPos.x, targetPos.y - 1, targetPos.z);
      if (below !== BlockId.Farmland && below !== BlockId.FarmlandWet) return false;
    }

    // Two-block wooden door needs air above as well
    if (placeBlockId === BlockId.WoodDoorBottom) {
      const above = this.world.getBlock(targetPos.x, targetPos.y + 1, targetPos.z);
      if (above !== BlockId.Air) return false;
    }

    const placeDef = BlockRegistry.get(placeBlockId);
    if (
      placeDef.solid &&
      doesBlockIntersectPlayer(targetPos.x, targetPos.y, targetPos.z, placeDef.height, this.player.pos)
    ) {
      return false;
    }

    const consumed = this.player.inventory.consumeSelected(1);
    if (!consumed) return false;

    const placed = this.world.setBlock(targetPos.x, targetPos.y, targetPos.z, placeBlockId);
    if (placed) {
      if (placeBlockId === BlockId.WoodDoorBottom) {
        this.world.setBlock(targetPos.x, targetPos.y + 1, targetPos.z, BlockId.WoodDoorTop);
      } else if (placeBlockId === BlockId.Furnace) {
        this.containers.getOrCreateFurnace(targetPos.x, targetPos.y, targetPos.z);
      } else if (placeBlockId === BlockId.Chest) {
        this.containers.getOrCreateChest(targetPos.x, targetPos.y, targetPos.z);
      }
      this.renderer.triggerHandSwing();
      this.events.emit('sound:play', { name: 'place', volume: 0.72 });
      this.syncHeldItemVisual();
      this.renderHotbar();
      this.events.emit('inventory:changed', {});
    }
    return placed;
  }

  private isNearWorkbench(): boolean {
    if (this.inventoryUI.getActive().kind === 'workbench') return true;
    const px = Math.floor(this.player.pos.x);
    const py = Math.floor(this.player.pos.y);
    const pz = Math.floor(this.player.pos.z);
    for (let dy = -3; dy <= 4; dy++) {
      for (let dz = -5; dz <= 5; dz++) {
        for (let dx = -5; dx <= 5; dx++) {
          if (this.world.getBlock(px + dx, py + dy, pz + dz) === BlockId.Workbench) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private resolveSlotAccessor(
    ref: SlotRef
  ): {
    get: () => ItemStack | null;
    set: (s: ItemStack | null) => void;
    canAccept?: (s: ItemStack) => boolean;
  } | null {
    const inv = this.player.inventory;
    if (ref.location === 'inventory') {
      if (ref.index < 0 || ref.index >= inv.slots.length) return null;
      return {
        get: () => inv.slots[ref.index],
        set: (v) => { inv.slots[ref.index] = v; },
      };
    }
    if (ref.location === 'armor') {
      const slot = ARMOR_SLOTS[ref.index];
      if (!slot) return null;
      return {
        get: () => inv.armor[slot],
        set: (v) => { inv.armor[slot] = v; },
        canAccept: (s) => ItemRegistry.get(s.itemId)?.armorSlot === slot,
      };
    }

    const active = this.inventoryUI.getActive();
    if (!active.pos) return null;

    if (ref.location === 'chest' && active.kind === 'chest') {
      const chest = this.containers.getOrCreateChest(active.pos.x, active.pos.y, active.pos.z);
      if (ref.index < 0 || ref.index >= chest.slots.length) return null;
      return {
        get: () => chest.slots[ref.index],
        set: (v) => { chest.slots[ref.index] = v; },
      };
    }

    if (active.kind === 'furnace') {
      const f = this.containers.getOrCreateFurnace(active.pos.x, active.pos.y, active.pos.z);
      if (ref.location === 'furnace_input') {
        return { get: () => f.input, set: (v) => { f.input = v; } };
      }
      if (ref.location === 'furnace_fuel') {
        return { get: () => f.fuel, set: (v) => { f.fuel = v; } };
      }
      if (ref.location === 'furnace_output') {
        return { get: () => f.output, set: (v) => { f.output = v; }, canAccept: () => false };
      }
    }

    return null;
  }

  private getOpenContainerSnapshot(): ContainerSnapshot | null {
    const active = this.inventoryUI.getActive();
    if (active.kind === 'none' || active.kind === 'inventory' || !active.pos) return null;
    if (active.kind === 'workbench') {
      return { type: 'workbench', pos: { ...active.pos } };
    }
    if (active.kind === 'chest') {
      const c = this.containers.getOrCreateChest(active.pos.x, active.pos.y, active.pos.z);
      return this.containers.toSnapshot(c);
    }
    if (active.kind === 'furnace') {
      const f = this.containers.getOrCreateFurnace(active.pos.x, active.pos.y, active.pos.z);
      return this.containers.toSnapshot(f);
    }
    return null;
  }

  private renderHotbar(): void {
    this.hud.renderHotbar(this.player);
  }

  private getSpiralOffsets(radius: number): Array<{ dx: number; dz: number; d2: number }> {
    if (this.cachedSpiralRadius === radius) return this.cachedSpiralOffsets;
    const radiusSq = radius * radius;
    const offsets: Array<{ dx: number; dz: number; d2: number }> = [];
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 <= radiusSq) offsets.push({ dx, dz, d2 });
      }
    }
    offsets.sort((a, b) => a.d2 - b.d2);
    this.cachedSpiralRadius = radius;
    this.cachedSpiralOffsets = offsets;
    return offsets;
  }

  private drainCompletedWorkerResults(jsStart: number): void {
    const budgetMs = 2.6;

    // 1. Always upload priority player-edit meshes immediately (zero latency for digging/placing/torches)
    let nonPriorityUploaded = 0;
    for (let i = 0; i < this.completedMeshQueue.length; ) {
      const item = this.completedMeshQueue[i];
      if (!item.priority) {
        if (nonPriorityUploaded >= 2 || performance.now() - jsStart >= budgetMs) {
          i++;
          continue;
        }
        nonPriorityUploaded++;
      }
      this.completedMeshQueue.splice(i, 1);
      if (this.world.hasChunk(item.cx, item.cz)) {
        this.renderer.setChunkMesh(item.cx, item.cz, item.mesh);
      }
    }

    // 2. Time-slice newly generated chunk integration (world insert + cross-chunk light + initial upload)
    const radius = Math.max(2, Math.min(12, Math.round(this.settings.renderDistance)));
    const unloadRadiusSq = (radius + 2) * (radius + 2);
    const curPcx = worldToChunkCoord(this.player.pos.x);
    const curPcz = worldToChunkCoord(this.player.pos.z);

    let integrated = 0;
    while (this.completedGenQueue.length > 0 && integrated < 4) {
      if (integrated > 0 && performance.now() - jsStart >= budgetMs) break;
      const item = this.completedGenQueue.shift()!;
      const k = chunkKey(item.cx, item.cz);
      this.completedGenSet.delete(k);
      if ((item.cx - curPcx) ** 2 + (item.cz - curPcz) ** 2 > unloadRadiusSq) continue;

      const lateSaved = this.savedChunksCache.get(k);
      if (lateSaved) {
        const restored = Chunk.deserialize(lateSaved);
        initializeChunkLight(restored);
        this.world.setChunk(restored);
        propagateCrossChunkLight(this.world, item.cx, item.cz);
        this.enqueueRemesh(item.cx, item.cz, true);
        integrated++;
        continue;
      }

      this.world.setChunk(item.chunk);
      for (const vc of item.villageChests) {
        this.containers.registerVillageChest(vc.x, vc.y, vc.z, vc.lootSeed);
      }
      propagateCrossChunkLight(this.world, item.cx, item.cz);
      this.renderer.setChunkMesh(item.cx, item.cz, item.mesh);

      // Deduplicated seam-culling remesh queued once neighbors arrive
      this.enqueueRemesh(item.cx, item.cz);
      this.enqueueRemesh(item.cx + 1, item.cz);
      this.enqueueRemesh(item.cx - 1, item.cz);
      this.enqueueRemesh(item.cx, item.cz + 1);
      this.enqueueRemesh(item.cx, item.cz - 1);
      integrated++;
    }
  }

  private streamChunks(): void {
    const pcx = worldToChunkCoord(this.player.pos.x);
    const pcz = worldToChunkCoord(this.player.pos.z);
    const radius = Math.max(2, Math.min(12, Math.round(this.settings.renderDistance)));
    const unloadRadiusSq = (radius + 2) * (radius + 2);

    // Only scan for unloading when player crosses a chunk boundary or changes render distance
    if (pcx !== this.lastUnloadPcx || pcz !== this.lastUnloadPcz || radius !== this.lastUnloadRadius) {
      this.lastUnloadPcx = pcx;
      this.lastUnloadPcz = pcz;
      this.lastUnloadRadius = radius;
      for (const { cx, cz } of this.world.getLoadedChunkCoords()) {
        const dx = cx - pcx;
        const dz = cz - pcz;
        if (dx * dx + dz * dz > unloadRadiusSq) {
          const chunk = this.world.getChunk(cx, cz);
          if (chunk?.modified) {
            this.savedChunksCache.set(chunkKey(cx, cz), chunk.serialize());
          }
          this.world.unloadChunk(cx, cz);
          this.renderer.removeChunkMesh(cx, cz);
        }
      }
    }

    if (this.inflightGen.size >= this.maxInflightGen && this.savedChunksCache.size === 0) return;

    const spiral = this.getSpiralOffsets(radius);
    let savedRestored = 0;

    for (let i = 0; i < spiral.length; i++) {
      const off = spiral[i];
      const cx = pcx + off.dx;
      const cz = pcz + off.dz;
      const k = chunkKey(cx, cz);
      if (this.world.hasChunk(cx, cz) || this.inflightGen.has(k) || this.completedGenSet.has(k)) continue;

      // Restore previously saved modified chunk immediately instead of overwriting with fresh terrain
      const saved = this.savedChunksCache.get(k);
      if (saved) {
        if (savedRestored >= 4) continue;
        const chunk = Chunk.deserialize(saved);
        initializeChunkLight(chunk);
        this.world.setChunk(chunk);
        propagateCrossChunkLight(this.world, cx, cz);
        this.enqueueRemesh(cx, cz, true);
        this.enqueueRemesh(cx + 1, cz);
        this.enqueueRemesh(cx - 1, cz);
        this.enqueueRemesh(cx, cz + 1);
        this.enqueueRemesh(cx, cz - 1);
        savedRestored++;
        continue;
      }

      if (this.inflightGen.size >= this.maxInflightGen) break;
      this.inflightGen.add(k);
      const genWorld = this.world;

      this.worker
        .generateChunk(cx, cz)
        .then(({ chunk, mesh, villageChests }) => {
          this.inflightGen.delete(k);
          if (this.disposed || this.world !== genWorld) return;
          if (!this.completedGenSet.has(k)) {
            this.completedGenSet.add(k);
            this.completedGenQueue.push({ cx, cz, chunk, mesh, villageChests });
          }
        })
        .catch(() => {
          this.inflightGen.delete(k);
        });
    }
  }

  private processRemeshQueue(jsStart = performance.now()): void {
    let backgroundDispatched = 0;
    while (
      (this.priorityRemeshQueue.length > 0 || this.remeshQueue.length > 0) &&
      this.inflightMesh.size < this.maxInflightMesh
    ) {
      const isPriority = this.priorityRemeshQueue.length > 0;
      if (!isPriority) {
        // Prioritize finishing active terrain generation bursts first so chunks don't get seam-remeshed 4x!
        if (this.inflightGen.size > 1 || this.completedGenQueue.length > 0) break;
        if (backgroundDispatched >= 1 || performance.now() - jsStart >= 2.8) {
          break;
        }
      }
      const next = isPriority ? this.priorityRemeshQueue.shift()! : this.remeshQueue.shift()!;
      const k = chunkKey(next.cx, next.cz);
      this.remeshQueuedSet.delete(k);

      const chunk = this.world.getChunk(next.cx, next.cz);
      if (!chunk) continue;
      if (this.inflightMesh.has(k)) {
        this.remeshAgainAfterInflight.add(k);
        continue;
      }

      this.inflightMesh.add(k);
      if (!isPriority) backgroundDispatched++;
      const genWorld = this.world;
      const neighbors = extractNeighborSlices(this.world, next.cx, next.cz);
      chunk.dirty = false;

      this.worker
        .meshChunk(next.cx, next.cz, chunk.blocks, chunk.light, chunk.meta, neighbors)
        .then((mesh) => {
          this.inflightMesh.delete(k);
          if (this.disposed || this.world !== genWorld || !this.world.hasChunk(next.cx, next.cz)) return;
          this.completedMeshQueue.push({ cx: next.cx, cz: next.cz, mesh, priority: isPriority });
          if (this.remeshAgainAfterInflight.has(k)) {
            this.remeshAgainAfterInflight.delete(k);
            this.enqueueRemesh(next.cx, next.cz, true);
          }
        })
        .catch(() => {
          this.inflightMesh.delete(k);
        });
    }
  }

  private renderVitals(): void {
    this.hud.renderVitals(this.player);
  }

  private updateHudText(): void {
    this.renderVitals();
    if (!this.debugOverlay.isVisible()) return;
    const biome = this.world.getBiome(this.player.pos.x, this.player.pos.z);
    const targetText = this.currentTarget
      ? `${BlockRegistry.get(this.currentTarget.blockId).name} (${this.currentTarget.pos.x},${this.currentTarget.pos.y},${this.currentTarget.pos.z})`
      : 'None';
    const eye = this.player.getEyePosition();
    this.debugOverlay.update({
      seed: this.world.seed,
      worldTime: this.worldTime,
      biome,
      skyLight: this.world.getSkyLight(eye.x, eye.y, eye.z),
      blockLight: this.world.getBlockLight(eye.x, eye.y, eye.z),
      targetText,
      entityCount: this.entities.count(),
      player: this.player.toSnapshot(),
      perf: this.getPerfMetrics(),
    });
  }

  getPerfMetrics(): PerfMetricsSnapshot {
    const rStats = this.renderer.getRenderStats();
    const wStats = this.worker.getStats();
    const avgJs =
      this.frameJsHistory.length > 0
        ? this.frameJsHistory.reduce((a, b) => a + b, 0) / this.frameJsHistory.length
        : 0;
    return {
      fps: this.fps,
      frameJsMs: this.frameJsMs,
      avgFrameJsMs: avgJs,
      maxFrameJsMs: this.maxFrameJsMs,
      chunkGenAvgMs: wStats.chunkGenAvgMs,
      chunkMeshAvgMs: wStats.chunkMeshAvgMs,
      drawCalls: rStats.drawCalls,
      triangles: rStats.triangles,
      loadedChunks: this.world.getLoadedChunkCount(),
    };
  }

  private createDebugAPI(): IGameDebugAPI {
    return {
      ready: () => this.isReady,
      getMode: () => this.mode,
      startNewWorld: (seed, name) => this.startNewWorld(seed, name),
      continueWorld: () => this.continueWorld(),
      saveNow: () => this.saveNow(),
      setLook: (yaw, pitch) => {
        this.player.yaw = yaw;
        this.player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
      },
      setKey: (code, down) => this.input.setVirtualKey(code, down),
      releaseAllKeys: () => this.input.releaseAllVirtualKeys(),
      setFlying: (enabled) => {
        this.player.flying = enabled;
        this.player.vel.y = 0;
      },
      selectHotbar: (slot) => this.selectHotbar(slot),
      mineBlock: async (maxMs = 8000) => {
        const eye = this.player.getEyePosition();
        const dir = lookDirection(this.player.yaw, this.player.pitch);
        const hit = raycastVoxel(this.world, eye, dir, BALANCE.player.reachDistance);
        if (!hit) return { broken: false, blockId: BlockId.Air, pos: null };

        const maxSteps = Math.max(1, Math.ceil(maxMs / (FIXED_DT * 1000)));
        for (let i = 0; i < maxSteps; i++) {
          const curHit = raycastVoxel(
            this.world,
            this.player.getEyePosition(),
            lookDirection(this.player.yaw, this.player.pitch),
            BALANCE.player.reachDistance
          );
          if (!curHit) return { broken: false, blockId: BlockId.Air, pos: null };
          const res = this.stepMining(curHit, FIXED_DT);
          if (res.broken) {
            // Advance simulation briefly so popped DroppedItem within magnet range settles & is naturally picked up
            for (let t = 0; t < 24; t++) {
              this.entities.update(FIXED_DT);
            }
            return res;
          }
        }
        return { broken: false, blockId: hit.blockId, pos: hit.pos };
      },
      placeBlock: () => this.placeSelectedBlock(),
      interact: () => this.interactOrPlace(),
      useItem: async (chargeMs = 900) => {
        const held = this.player.inventory.getSelected();
        if (!held) return false;
        const def = ItemRegistry.get(held.itemId);
        if (def?.isBow) {
          return this.firePlayerBow(chargeMs / 1000);
        }
        return this.interactOrPlace();
      },
      attack: () => {
        const hit = this.attackTargetedMob();
        if (hit) {
          // Only settle dropped_item entities briefly (never grant mobs extra AI/attack ticks!)
          for (let t = 0; t < 16; t++) {
            for (const d of this.entities.byKind('dropped_item')) {
              d.update(FIXED_DT);
            }
          }
        }
        return hit;
      },
      craft: (recipeId, useWorkbench = false) => {
        const hasBench = useWorkbench && this.isNearWorkbench();
        const ok = craftRecipeFromInventory(this.player.inventory, recipeId, hasBench);
        if (ok) {
          this.syncHeldItemVisual();
          this.renderHotbar();
          this.inventoryUI.refresh();
          this.events.emit('sound:play', { name: 'craft', volume: 0.6 });
          this.events.emit('inventory:changed', {});
        }
        return ok;
      },
      moveSlot: (from, to, half = false) => {
        const src = this.resolveSlotAccessor(from);
        const dst = this.resolveSlotAccessor(to);
        if (!src || !dst) return false;
        const ok = Inventory.transferBetween(src.get, src.set, dst.get, dst.set, half, dst.canAccept);
        if (ok) {
          this.syncHeldItemVisual();
          this.renderHotbar();
          this.inventoryUI.refresh();
          this.events.emit('sound:play', { name: 'ui', volume: 0.45 });
          this.events.emit('inventory:changed', {});
        }
        return ok;
      },
      openContainerAt: (x, y, z) => this.openContainerAt(x, y, z),
      closeContainer: () => this.inventoryUI.close(),
      getOpenContainer: () => this.getOpenContainerSnapshot(),
      teleport: (x, y, z) => {
        this.player.pos = { x, y, z };
        this.player.vel = { x: 0, y: 0, z: 0 };
        this.player.fallPeakY = y;
        this.spawnChunkGrounded = true;
      },
      setSpawnPoint: (x, y, z) => {
        this.player.spawnPoint = { x, y, z };
      },
      respawn: () => {
        this.respawnPlayer();
      },
      findNearestVillage: () => {
        const v = findNearestVillage(
          this.world.seed,
          (x, z) => this.terrainSampler.sampleBiome(x, z),
          (x, z) => this.terrainSampler.sampleHeight(x, z),
          this.player.pos.x,
          this.player.pos.z,
          8
        );
        if (!v) return null;
        return {
          centerX: v.centerX,
          centerZ: v.centerZ,
          baseY: v.baseY,
          biome: v.biome,
          houseCount: v.houses.length,
          farmCount: v.farms.length,
          chests: v.chests.map((c) => ({ x: c.x, y: c.y, z: c.z })),
        };
      },
      advanceTime: (ticks) => {
        if (ticks <= 0) {
          this.worldTime += ticks;
          return;
        }
        // Step time in chunks so midnight mob spawning & survival checks run accurately during accelerated time
        const stepSize = 200;
        let remaining = ticks;
        while (remaining > 0) {
          const chunkTicks = Math.min(remaining, stepSize);
          this.worldTime += chunkTicks;
          this.containers.tickFurnaces(Math.min(chunkTicks, 400));
          this.farming.tick(this.world, chunkTicks);
          if (!this.player.flying && !this.player.dead) {
            this.mobSpawner.tick(
              this.world,
              this.player.pos,
              this.entities,
              this.worldTime,
              this.getMobContext(),
              chunkTicks
            );
            // Step living mobs briefly so threats outside/inside interact realistically
            for (let m = 0; m < 10; m++) {
              this.entities.update(FIXED_DT);
            }
          }
          remaining -= chunkTicks;
        }
      },
      stepSimulation: (ticks) => {
        for (let i = 0; i < ticks; i++) {
          this.stepFixed(FIXED_DT);
        }
      },
      getState: (): GameStateSnapshot => {
        const biome = this.world.getBiome(this.player.pos.x, this.player.pos.z);
        return {
          mode: this.mode,
          worldId: this.worldId,
          seed: this.world.seed,
          worldTime: this.worldTime,
          dayCount: Math.floor(this.worldTime / DAY_LENGTH_TICKS),
          biome,
          biomeName: BIOME_NAMES[biome],
          player: this.player.toSnapshot(),
          openContainer: this.getOpenContainerSnapshot(),
          loadedChunks: this.world.getLoadedChunkCount(),
        };
      },
      getInventory: (): InventorySnapshot => this.player.inventory.toSnapshot(),
      getBlock: (x, y, z) => this.world.getBlock(x, y, z),
      getLight: (x, y, z) => ({
        sky: this.world.getSkyLight(x, y, z),
        block: this.world.getBlockLight(x, y, z),
      }),
      getEntities: () => this.entities.snapshots(),
      getPerfMetrics: () => this.getPerfMetrics(),
      setSettings: (partial) => {
        this.applySettings(partial, true);
      },
      getSettings: () => ({ ...this.settings }),
    };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.inventoryUI.dispose();
    this.entityRenderer.dispose();
    this.particles.dispose();
    this.audio.dispose();
    this.input.dispose();
    this.worker.dispose();
    this.renderer.dispose();
    void this.saveManager.close();
  }
}

export { CHUNK_SIZE };
