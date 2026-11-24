import { BALANCE } from '../config/balance';
import { CHUNK_SIZE, DAY_LENGTH_TICKS, FIXED_DT, HOTBAR_SIZE } from '../config/constants';
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
import { ArrowEntity } from '../entities/Projectile';
import { ARMOR_SLOTS, createItemStack, Inventory } from '../player/Inventory';
import { doesBlockIntersectPlayer, stepPhysics } from '../player/Physics';
import { Player } from '../player/Player';
import { lookDirection, RaycastHit, raycastVoxel } from '../player/Raycast';
import { BlockId, BlockRegistry } from '../registry/blocks';
import { ItemId, ItemRegistry } from '../registry/items';
import { ContainerManager } from '../systems/ContainerManager';
import { craftRecipeFromInventory } from '../systems/CraftingSystem';
import { InventoryUI } from '../ui/InventoryUI';
import { chunkKey, worldToChunkCoord } from '../world/Chunk';
import { GravityBlockSystem } from '../world/GravityBlocks';
import { propagateCrossChunkLight, updateLightingAt } from '../world/Lighting';
import { extractNeighborSlices } from '../world/Mesher';
import { findSafeSpawn } from '../world/TerrainGenerator';
import { WaterFlowSystem } from '../world/WaterFlow';
import { World } from '../world/World';
import { InputManager } from './InputManager';
import { Renderer } from './Renderer';
import { WorldWorkerClient } from './WorldWorkerClient';

export class Game {
  readonly events = new EventBus();
  readonly entities: EntitySystem;
  readonly renderer: Renderer;
  readonly entityRenderer: EntityRenderer;
  readonly input: InputManager;
  readonly gravityBlocks = new GravityBlockSystem();
  readonly waterFlow = new WaterFlowSystem();
  readonly containers = new ContainerManager();
  readonly inventoryUI: InventoryUI;
  world: World;
  worker: WorldWorkerClient;
  player: Player;

  private mode: GameMode = 'playing';
  private worldId = 'world-default';
  private worldTime = 6000;
  private settings: GameSettings = { ...BALANCE.defaults };
  private spawnChunkGrounded = false;
  private currentTarget: RaycastHit | null = null;
  private prevRightMouse = false;
  private placeCooldownSec = 0;

  // Chunk streaming state
  private readonly inflightGen = new Set<string>();
  private readonly inflightMesh = new Set<string>();
  private readonly remeshAgainAfterInflight = new Set<string>();
  private readonly priorityRemeshQueue: Array<{ cx: number; cz: number }> = [];
  private readonly remeshQueue: Array<{ cx: number; cz: number }> = [];
  private readonly remeshQueuedSet = new Set<string>();
  private readonly maxInflightGen = 4;
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

  // HUD elements
  private readonly hudInfoEl: HTMLDivElement;
  private readonly crosshairEl: HTMLDivElement;
  private readonly hotbarEl: HTMLDivElement;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement, initialSeed: number | string = 1337) {
    const seedNum = stringToSeed(initialSeed);
    this.world = new World(seedNum, this.events);
    this.entities = new EntitySystem(this.events);
    this.renderer = new Renderer(canvas, this.settings.fov);
    this.renderer.setHandVisible(true);
    this.entityRenderer = new EntityRenderer(this.renderer.entityGroup, this.renderer.atlas);
    this.input = new InputManager(canvas);
    this.worker = new WorldWorkerClient(seedNum);

    const spawn = findSafeSpawn(seedNum);
    this.player = new Player({ x: spawn.x + 0.5, y: spawn.y + 0.05, z: spawn.z + 0.5 });

    // Info HUD
    this.hudInfoEl = document.createElement('div');
    this.hudInfoEl.style.cssText =
      'position:absolute;top:12px;left:12px;padding:8px 12px;background:rgba(18,22,28,0.72);' +
      'border:1px solid rgba(240,235,225,0.2);border-radius:6px;font-size:12px;line-height:1.45;' +
      'font-family:ui-monospace,Consolas,monospace;color:#f0ebe1;pointer-events:none;';
    uiRoot.appendChild(this.hudInfoEl);

    // Crosshair
    this.crosshairEl = document.createElement('div');
    this.crosshairEl.style.cssText =
      'position:absolute;top:50%;left:50%;width:18px;height:18px;transform:translate(-50%,-50%);' +
      'pointer-events:none;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.88);' +
      'font-size:18px;font-weight:700;text-shadow:0 0 3px rgba(0,0,0,0.85);';
    this.crosshairEl.textContent = '+';
    uiRoot.appendChild(this.crosshairEl);

    // Hotbar
    this.hotbarEl = document.createElement('div');
    this.hotbarEl.style.cssText =
      'position:absolute;bottom:14px;left:50%;transform:translateX(-50%);display:flex;gap:4px;' +
      'padding:4px;background:rgba(18,22,28,0.78);border:1px solid rgba(240,235,225,0.25);border-radius:6px;';
    uiRoot.appendChild(this.hotbarEl);

    // Inventory / Workbench / Furnace / Chest UI
    this.inventoryUI = new InventoryUI(
      uiRoot,
      this.renderer.atlas,
      () => this.player.inventory,
      () => this.containers,
      () => {
        this.syncHeldItemVisual();
        this.renderHotbar();
        this.events.emit('inventory:changed', {});
      },
      () => {
        this.events.emit('container:closed', {});
      }
    );

    this.renderHotbar();

    canvas.addEventListener('click', () => {
      if (this.mode === 'playing' && !this.inventoryUI.isOpen() && !this.input.isPointerLocked()) {
        this.input.requestPointerLock();
      }
    });

    this.events.on('chunk:dirty', ({ cx, cz }) => {
      this.enqueueRemesh(cx, cz, true);
    });

    this.events.on('block:changed', ({ x, y, z, oldId, newId }) => {
      updateLightingAt(this.world, x, y, z, oldId, newId);
      this.gravityBlocks.enqueueColumnCheck(x, y, z);
      this.waterFlow.enqueueArea(x, y, z);
    });

    attachDebugAPI(this.createDebugAPI());
    this.isReady = true;
    this.startLoop();
  }

  async startNewWorld(seedInput?: number | string, name?: string): Promise<void> {
    const seed =
      seedInput !== undefined ? stringToSeed(seedInput) : Math.floor(Math.random() * 0xffffffff) >>> 0;
    this.worldId = name || `world-${seed}`;
    this.world.clear();
    this.entities.clear();
    this.entityRenderer.clear();
    this.containers.clear();
    this.inventoryUI.close();
    this.renderer.clearAllChunks();
    this.inflightGen.clear();
    this.inflightMesh.clear();
    this.remeshAgainAfterInflight.clear();
    this.priorityRemeshQueue.length = 0;
    this.remeshQueue.length = 0;
    this.remeshQueuedSet.clear();

    this.world = new World(seed, this.events);
    this.worker.resetSeed(seed);
    this.worldTime = 6000;
    this.spawnChunkGrounded = false;

    const spawn = findSafeSpawn(seed);
    this.player = new Player({ x: spawn.x + 0.5, y: spawn.y + 0.05, z: spawn.z + 0.5 });
    this.mode = 'playing';
    this.syncHeldItemVisual();
    this.renderHotbar();
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

      this.streamChunks();
      this.processRemeshQueue();

      const eye = this.player.getEyePosition();
      this.renderer.setCamera(eye, this.player.yaw, this.player.pitch);
      this.renderer.updateEnvironment(
        this.worldTime,
        this.settings.renderDistance,
        eye,
        this.player.headInWater
      );

      this.entityRenderer.sync(this.entities.all(), now / 1000);

      const horizSpeed = Math.hypot(this.player.vel.x, this.player.vel.z);
      this.renderer.updateHandAnimation(rawDt, horizSpeed, this.player.onGround);

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
    // Toggle inventory with E, close with Escape
    if (this.input.consumePress('KeyE')) {
      if (this.inventoryUI.isOpen()) {
        this.inventoryUI.close();
      } else if (this.mode === 'playing') {
        this.input.exitPointerLock();
        this.inventoryUI.open('inventory');
      }
    }

    if (this.input.consumePress('Escape')) {
      if (this.inventoryUI.isOpen()) {
        this.inventoryUI.close();
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
        onHitEntity: () => false, // Mob damage wired in M6
      }
    );
    this.entities.add(arrow);
    this.player.inventory.damageSelectedTool(1);
    this.renderer.triggerHandSwing();
    this.syncHeldItemVisual();
    this.renderHotbar();
    return true;
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

    if (chunkLoaded || this.player.flying) {
      const forward = uiOpen ? 0 : (this.input.isDown('KeyW') ? 1 : 0) - (this.input.isDown('KeyS') ? 1 : 0);
      const strafe = uiOpen ? 0 : (this.input.isDown('KeyD') ? 1 : 0) - (this.input.isDown('KeyA') ? 1 : 0);

      stepPhysics(
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

    // Raycast targeted block
    const eye = this.player.getEyePosition();
    const dir = lookDirection(this.player.yaw, this.player.pitch);
    this.currentTarget = raycastVoxel(this.world, eye, dir, BALANCE.player.reachDistance);

    if (!uiOpen) {
      // Mining progression
      if (this.input.isLeftMouseDown() && this.currentTarget) {
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
    }

    this.player.mining.elapsedSec += dt;
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
      this.player.resetMining();

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

      // Toggle wooden doors
      if (hit.blockId === BlockId.WoodDoorBottom || hit.blockId === BlockId.WoodDoorTop) {
        const baseY = hit.blockId === BlockId.WoodDoorTop ? hit.pos.y - 1 : hit.pos.y;
        const curMeta = this.world.getMeta(hit.pos.x, baseY, hit.pos.z);
        const nextMeta = curMeta ^ 1;
        this.world.setMeta(hit.pos.x, baseY, hit.pos.z, nextMeta);
        if (this.world.getBlock(hit.pos.x, baseY + 1, hit.pos.z) === BlockId.WoodDoorTop) {
          this.world.setMeta(hit.pos.x, baseY + 1, hit.pos.z, nextMeta);
        }
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
    this.hotbarEl.innerHTML = '';
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const cell = document.createElement('div');
      const selected = i === this.player.selectedSlot;
      cell.style.cssText =
        `width:40px;height:40px;position:relative;display:flex;align-items:center;justify-content:center;` +
        `border-radius:4px;background:${selected ? 'rgba(220,195,130,0.28)' : 'rgba(10,12,16,0.58)'};` +
        `border:2px solid ${selected ? '#e6c56e' : 'rgba(240,235,225,0.18)'};`;
      const stack = this.player.inventory.slots[i];
      if (stack && stack.count > 0) {
        const def = ItemRegistry.get(stack.itemId);
        if (def) {
          const img = document.createElement('img');
          img.src = this.renderer.atlas.getItemIcon(def.icon);
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

  private streamChunks(): void {
    const pcx = worldToChunkCoord(this.player.pos.x);
    const pcz = worldToChunkCoord(this.player.pos.z);
    const radius = Math.max(2, Math.min(12, Math.round(this.settings.renderDistance)));
    const radiusSq = radius * radius;
    const unloadRadiusSq = (radius + 2) * (radius + 2);

    for (const { cx, cz } of this.world.getLoadedChunkCoords()) {
      const dx = cx - pcx;
      const dz = cz - pcz;
      if (dx * dx + dz * dz > unloadRadiusSq) {
        this.world.unloadChunk(cx, cz);
        this.renderer.removeChunkMesh(cx, cz);
      }
    }

    if (this.inflightGen.size >= this.maxInflightGen) return;

    const candidates: Array<{ cx: number; cz: number; d2: number }> = [];
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > radiusSq) continue;
        const cx = pcx + dx;
        const cz = pcz + dz;
        const k = chunkKey(cx, cz);
        if (this.world.hasChunk(cx, cz) || this.inflightGen.has(k)) continue;
        candidates.push({ cx, cz, d2 });
      }
    }
    candidates.sort((a, b) => a.d2 - b.d2);

    for (const cand of candidates) {
      if (this.inflightGen.size >= this.maxInflightGen) break;
      const k = chunkKey(cand.cx, cand.cz);
      this.inflightGen.add(k);
      const genWorld = this.world;

      this.worker
        .generateChunk(cand.cx, cand.cz)
        .then(({ chunk, mesh }) => {
          this.inflightGen.delete(k);
          if (this.disposed || this.world !== genWorld) return;

          const curPcx = worldToChunkCoord(this.player.pos.x);
          const curPcz = worldToChunkCoord(this.player.pos.z);
          if ((cand.cx - curPcx) ** 2 + (cand.cz - curPcz) ** 2 > unloadRadiusSq) return;

          this.world.setChunk(chunk);
          propagateCrossChunkLight(this.world, cand.cx, cand.cz);
          this.renderer.setChunkMesh(cand.cx, cand.cz, mesh);

          this.enqueueRemesh(cand.cx, cand.cz);
          this.enqueueRemesh(cand.cx + 1, cand.cz);
          this.enqueueRemesh(cand.cx - 1, cand.cz);
          this.enqueueRemesh(cand.cx, cand.cz + 1);
          this.enqueueRemesh(cand.cx, cand.cz - 1);
        })
        .catch(() => {
          this.inflightGen.delete(k);
        });
    }
  }

  private processRemeshQueue(): void {
    while (
      (this.priorityRemeshQueue.length > 0 || this.remeshQueue.length > 0) &&
      this.inflightMesh.size < this.maxInflightMesh
    ) {
      const next =
        this.priorityRemeshQueue.length > 0
          ? this.priorityRemeshQueue.shift()!
          : this.remeshQueue.shift()!;
      const k = chunkKey(next.cx, next.cz);
      this.remeshQueuedSet.delete(k);

      const chunk = this.world.getChunk(next.cx, next.cz);
      if (!chunk) continue;
      if (this.inflightMesh.has(k)) {
        this.remeshAgainAfterInflight.add(k);
        continue;
      }

      this.inflightMesh.add(k);
      const genWorld = this.world;
      const neighbors = extractNeighborSlices(this.world, next.cx, next.cz);
      chunk.dirty = false;

      this.worker
        .meshChunk(next.cx, next.cz, chunk.blocks, chunk.light, chunk.meta, neighbors)
        .then((mesh) => {
          this.inflightMesh.delete(k);
          if (this.disposed || this.world !== genWorld || !this.world.hasChunk(next.cx, next.cz)) return;
          this.renderer.setChunkMesh(next.cx, next.cz, mesh);
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

  private updateHudText(): void {
    const biome = this.world.getBiome(this.player.pos.x, this.player.pos.z);
    const stats = this.renderer.getRenderStats();
    const targetText = this.currentTarget
      ? `Target: ${BlockRegistry.get(this.currentTarget.blockId).name} (${this.currentTarget.pos.x},${this.currentTarget.pos.y},${this.currentTarget.pos.z})`
      : 'Target: None';
    const eye = this.player.getEyePosition();
    const skyL = this.world.getSkyLight(eye.x, eye.y, eye.z);
    const blkL = this.world.getBlockLight(eye.x, eye.y, eye.z);
    const held = this.player.inventory.getSelected();
    const heldName = held ? ItemRegistry.get(held.itemId)?.name ?? '' : 'Empty';
    this.hudInfoEl.textContent =
      `STONEROOT | Seed ${this.world.seed} | Biome: ${BIOME_NAMES[biome]} | ` +
      `XYZ: ${this.player.pos.x.toFixed(1)}, ${this.player.pos.y.toFixed(1)}, ${this.player.pos.z.toFixed(1)} | ` +
      `Light: S${skyL}/B${blkL} | Held: ${heldName} | ${targetText} | Calls: ${stats.drawCalls}`;
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
      loadedChunks: this.world.getLoadedChunkCoords().length,
    };
  }

  private createDebugAPI(): IGameDebugAPI {
    return {
      ready: () => this.isReady,
      getMode: () => this.mode,
      startNewWorld: (seed, name) => this.startNewWorld(seed, name),
      continueWorld: async () => {
        this.mode = 'playing';
      },
      saveNow: async () => {},
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
        this.renderer.triggerHandSwing();
        return false;
      },
      craft: (recipeId, useWorkbench = false) => {
        const hasBench = useWorkbench && this.isNearWorkbench();
        const ok = craftRecipeFromInventory(this.player.inventory, recipeId, hasBench);
        if (ok) {
          this.syncHeldItemVisual();
          this.renderHotbar();
          this.inventoryUI.refresh();
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
        this.spawnChunkGrounded = true;
      },
      setSpawnPoint: (x, y, z) => {
        this.player.spawnPoint = { x, y, z };
      },
      advanceTime: (ticks) => {
        this.worldTime += ticks;
        // Also advance furnaces proportionally during accelerated time
        if (ticks > 0) this.containers.tickFurnaces(Math.min(ticks, 4000));
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
          loadedChunks: this.world.getLoadedChunkCoords().length,
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
        this.settings = { ...this.settings, ...partial };
        if (partial.fov !== undefined) this.renderer.setFov(partial.fov);
      },
      getSettings: () => ({ ...this.settings }),
    };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.inventoryUI.dispose();
    this.entityRenderer.dispose();
    this.input.dispose();
    this.worker.dispose();
    this.renderer.dispose();
  }
}

export { CHUNK_SIZE };
