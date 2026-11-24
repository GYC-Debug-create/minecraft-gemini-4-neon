import { BALANCE } from '../config/balance';
import { CHUNK_SIZE, DAY_LENGTH_TICKS, FIXED_DT } from '../config/constants';
import { EventBus } from '../core/events';
import { stringToSeed } from '../core/rng';
import {
  BIOME_NAMES,
  BlockPos,
  GameMode,
  GameSettings,
  GameStateSnapshot,
  IGameDebugAPI,
  InventorySnapshot,
  PerfMetricsSnapshot,
  ToolTier,
} from '../core/types';
import { attachDebugAPI } from '../debug/DebugAPI';
import { EntitySystem } from '../entities/EntitySystem';
import { doesBlockIntersectPlayer, stepPhysics } from '../player/Physics';
import { Player } from '../player/Player';
import { lookDirection, RaycastHit, raycastVoxel } from '../player/Raycast';
import { BlockId, BlockRegistry } from '../registry/blocks';
import { ItemId, ItemRegistry } from '../registry/items';
import { chunkKey, worldToChunkCoord } from '../world/Chunk';
import { GravityBlockSystem } from '../world/GravityBlocks';
import { extractNeighborSlices } from '../world/Mesher';
import { findSafeSpawn } from '../world/TerrainGenerator';
import { World } from '../world/World';
import { InputManager } from './InputManager';
import { Renderer } from './Renderer';
import { WorldWorkerClient } from './WorldWorkerClient';

export class Game {
  readonly events = new EventBus();
  readonly entities: EntitySystem;
  readonly renderer: Renderer;
  readonly input: InputManager;
  readonly gravityBlocks = new GravityBlockSystem();
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

  // Minimal M2 HUD elements (expanded into full HUD in M7)
  private readonly hudInfoEl: HTMLDivElement;
  private readonly crosshairEl: HTMLDivElement;
  private readonly hotbarEl: HTMLDivElement;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement, initialSeed: number | string = 1337) {
    const seedNum = stringToSeed(initialSeed);
    this.world = new World(seedNum, this.events);
    this.entities = new EntitySystem(this.events);
    this.renderer = new Renderer(canvas, this.settings.fov);
    this.renderer.setHandVisible(true);
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

    // Compact Hotbar preview
    this.hotbarEl = document.createElement('div');
    this.hotbarEl.style.cssText =
      'position:absolute;bottom:14px;left:50%;transform:translateX(-50%);display:flex;gap:4px;' +
      'padding:4px;background:rgba(18,22,28,0.75);border:1px solid rgba(240,235,225,0.25);border-radius:6px;';
    uiRoot.appendChild(this.hotbarEl);
    this.renderHotbar();

    canvas.addEventListener('click', () => {
      if (this.mode === 'playing' && !this.input.isPointerLocked()) {
        this.input.requestPointerLock();
      }
    });

    this.events.on('chunk:dirty', ({ cx, cz }) => {
      this.enqueueRemesh(cx, cz);
    });

    this.events.on('block:changed', ({ x, y, z }) => {
      this.gravityBlocks.enqueueColumnCheck(x, y, z);
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
    this.renderer.clearAllChunks();
    this.inflightGen.clear();
    this.inflightMesh.clear();
    this.remeshQueue.length = 0;
    this.remeshQueuedSet.clear();

    this.world = new World(seed, this.events);
    this.worker.resetSeed(seed);
    this.worldTime = 6000;
    this.spawnChunkGrounded = false;

    const spawn = findSafeSpawn(seed);
    this.player = new Player({ x: spawn.x + 0.5, y: spawn.y + 0.05, z: spawn.z + 0.5 });
    this.mode = 'playing';
    this.renderHotbar();
  }

  private enqueueRemesh(cx: number, cz: number): void {
    const k = chunkKey(cx, cz);
    if (this.remeshQueuedSet.has(k) || !this.world.hasChunk(cx, cz)) return;
    this.remeshQueuedSet.add(k);
    this.remeshQueue.push({ cx, cz });
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

      this.handleLookAndHotbarInput();

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

      const horizSpeed = Math.hypot(this.player.vel.x, this.player.vel.z);
      this.renderer.updateHandAnimation(rawDt, horizSpeed, this.player.onGround);

      // Update selection box & break overlay
      if (this.currentTarget) {
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
      }
    };

    this.rafId = requestAnimationFrame(tick);
  }

  private handleLookAndHotbarInput(): void {
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
    const pocket = this.player.pocketBlocks[this.player.selectedSlot];
    if (!pocket) {
      this.renderer.setHeldItemIcon(null);
    } else {
      const def = BlockRegistry.get(pocket.blockId);
      this.renderer.setHeldItemIcon(def.textures.side);
    }
  }

  private stepFixed(dt: number): void {
    if (this.mode !== 'playing') return;

    this.worldTime = (this.worldTime + 1) % (DAY_LENGTH_TICKS * 10000);
    if (this.placeCooldownSec > 0) this.placeCooldownSec = Math.max(0, this.placeCooldownSec - dt);

    const pcx = worldToChunkCoord(this.player.pos.x);
    const pcz = worldToChunkCoord(this.player.pos.z);
    const chunkLoaded = this.world.hasChunk(pcx, pcz);

    // Ground player cleanly once spawn chunk finishes generating
    if (chunkLoaded && !this.spawnChunkGrounded) {
      this.spawnChunkGrounded = true;
      if (!this.player.flying) {
        const topY = this.world.getTopSolidY(Math.floor(this.player.pos.x), Math.floor(this.player.pos.z));
        if (this.player.pos.y < topY + 1) {
          this.player.pos.y = topY + 1.02;
        }
      }
    }

    if (chunkLoaded || this.player.flying) {
      const forward = (this.input.isDown('KeyW') ? 1 : 0) - (this.input.isDown('KeyS') ? 1 : 0);
      const strafe = (this.input.isDown('KeyD') ? 1 : 0) - (this.input.isDown('KeyA') ? 1 : 0);

      stepPhysics(
        this.world,
        this.player,
        {
          forward,
          strafe,
          jump: this.input.isDown('Space'),
          sneak: this.input.isSneakingInput(),
          sprint: this.input.isSprintingInput(),
        },
        dt,
        this.player.hunger >= BALANCE.survival.hungerSprintMinHunger
      );
    }

    // Raycast targeted block
    const eye = this.player.getEyePosition();
    const dir = lookDirection(this.player.yaw, this.player.pitch);
    this.currentTarget = raycastVoxel(this.world, eye, dir, BALANCE.player.reachDistance);

    // Mining progression when left mouse held
    if (this.input.isLeftMouseDown() && this.currentTarget) {
      this.stepMining(this.currentTarget, dt);
    } else {
      this.player.resetMining();
    }

    // Block placement on right click edge
    const rightDown = this.input.isRightMouseDown();
    if (rightDown && !this.prevRightMouse && this.placeCooldownSec <= 0) {
      this.placeSelectedBlock();
      this.placeCooldownSec = 0.2;
    }
    this.prevRightMouse = rightDown;

    this.gravityBlocks.tick(this.world);
    this.entities.update(dt);
    this.input.clearPressedFrame();
  }

  private computeBreakTime(blockId: BlockId): number {
    const def = BlockRegistry.get(blockId);
    if (def.hardness < 0) return Infinity;
    if (def.hardness <= 0.05) return 0.05;
    // In M2 hand only (M4 incorporates tool type & tier speed multipliers)
    const needsTool = def.minToolTier > ToolTier.None;
    return needsTool ? def.hardness * BALANCE.mining.wrongToolMultiplier : def.hardness;
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
      this.world.setBlock(brokenPos.x, brokenPos.y, brokenPos.z, BlockId.Air);
      this.renderer.triggerHandSwing();
      this.player.resetMining();

      // Award drop only if player meets minimum tool tier (hand = ToolTier.None)
      if (def.minToolTier <= ToolTier.None && def.dropItemKey) {
        const dropItem = ItemRegistry.getByKey(def.dropItemKey);
        if (dropItem?.placesBlock !== undefined) {
          this.player.addPocketBlock(dropItem.placesBlock);
          this.syncHeldItemVisual();
          this.renderHotbar();
        }
      }
      return { broken: true, blockId: brokenId, pos: brokenPos };
    }

    return { broken: false, blockId: hit.blockId, pos: hit.pos };
  }

  placeSelectedBlock(): boolean {
    const eye = this.player.getEyePosition();
    const dir = lookDirection(this.player.yaw, this.player.pitch);
    const hit = raycastVoxel(this.world, eye, dir, BALANCE.player.reachDistance);
    if (!hit) return false;

    const slot = this.player.pocketBlocks[this.player.selectedSlot];
    if (!slot || slot.count <= 0) return false;

    const placeBlockId = slot.blockId;
    const hitDef = BlockRegistry.get(hit.blockId);
    const targetPos = hitDef.replaceable ? hit.pos : hit.adjacent;

    const existing = this.world.getBlock(targetPos.x, targetPos.y, targetPos.z);
    if (!BlockRegistry.isReplaceable(existing) && existing !== BlockId.Air) return false;

    const placeDef = BlockRegistry.get(placeBlockId);
    if (
      placeDef.solid &&
      doesBlockIntersectPlayer(targetPos.x, targetPos.y, targetPos.z, placeDef.height, this.player.pos)
    ) {
      return false;
    }

    const consumed = this.player.consumeSelectedPocketBlock();
    if (consumed === null) return false;

    const placed = this.world.setBlock(targetPos.x, targetPos.y, targetPos.z, consumed);
    if (placed) {
      this.renderer.triggerHandSwing();
      this.syncHeldItemVisual();
      this.renderHotbar();
    }
    return placed;
  }

  private renderHotbar(): void {
    this.hotbarEl.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const cell = document.createElement('div');
      const selected = i === this.player.selectedSlot;
      cell.style.cssText =
        `width:40px;height:40px;position:relative;display:flex;align-items:center;justify-content:center;` +
        `border-radius:4px;background:${selected ? 'rgba(220,195,130,0.28)' : 'rgba(10,12,16,0.55)'};` +
        `border:2px solid ${selected ? '#e6c56e' : 'rgba(240,235,225,0.18)'};`;
      const pocket = this.player.pocketBlocks[i];
      if (pocket && pocket.count > 0) {
        const def = BlockRegistry.get(pocket.blockId);
        const img = document.createElement('img');
        img.src = this.renderer.atlas.getItemIcon(def.textures.side);
        img.style.cssText = 'width:28px;height:28px;image-rendering:pixelated;';
        cell.appendChild(img);

        const countEl = document.createElement('span');
        countEl.textContent = String(pocket.count);
        countEl.style.cssText =
          'position:absolute;right:3px;bottom:1px;font-size:11px;font-weight:700;color:#fff;text-shadow:1px 1px 1px #000;';
        cell.appendChild(countEl);
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
    while (this.remeshQueue.length > 0 && this.inflightMesh.size < this.maxInflightMesh) {
      const next = this.remeshQueue.shift()!;
      const k = chunkKey(next.cx, next.cz);
      this.remeshQueuedSet.delete(k);

      const chunk = this.world.getChunk(next.cx, next.cz);
      if (!chunk || this.inflightMesh.has(k)) continue;

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
        })
        .catch(() => {
          this.inflightMesh.delete(k);
        });
    }
  }

  private updateHudText(): void {
    const biome = this.world.getBiome(this.player.pos.x, this.player.pos.z);
    const stats = this.renderer.getRenderStats();
    const wStats = this.worker.getStats();
    const targetText = this.currentTarget
      ? `Target: ${BlockRegistry.get(this.currentTarget.blockId).name} (${this.currentTarget.pos.x},${this.currentTarget.pos.y},${this.currentTarget.pos.z})`
      : 'Target: None';
    this.hudInfoEl.textContent =
      `STONEROOT | Seed ${this.world.seed} | Biome: ${BIOME_NAMES[biome]} | ` +
      `XYZ: ${this.player.pos.x.toFixed(1)}, ${this.player.pos.y.toFixed(1)}, ${this.player.pos.z.toFixed(1)} | ` +
      `${targetText} | Chunks: ${this.world.getLoadedChunkCoords().length} | ` +
      `Calls: ${stats.drawCalls} | Gen: ${wStats.chunkGenAvgMs.toFixed(1)}ms`;
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
      mineBlock: async (maxMs = 6000) => {
        // Simulates holding left-click to mine the block currently under the crosshair
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
          if (res.broken) return res;
        }
        return { broken: false, blockId: hit.blockId, pos: hit.pos };
      },
      placeBlock: () => this.placeSelectedBlock(),
      interact: () => this.placeSelectedBlock(),
      useItem: async () => this.placeSelectedBlock(),
      attack: () => {
        this.renderer.triggerHandSwing();
        return false;
      },
      craft: () => false,
      moveSlot: () => false,
      openContainerAt: () => false,
      closeContainer: () => {},
      getOpenContainer: () => null,
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
          openContainer: null,
          loadedChunks: this.world.getLoadedChunkCoords().length,
        };
      },
      getInventory: (): InventorySnapshot => {
        const slots = new Array(36).fill(null);
        for (let i = 0; i < 9; i++) {
          const p = this.player.pocketBlocks[i];
          if (p) {
            const def = BlockRegistry.get(p.blockId);
            const item = def.dropItemKey ? ItemRegistry.getByKey(def.dropItemKey) : ItemRegistry.getByKey(def.key);
            slots[i] = { itemId: item ? item.id : ItemId.Dirt, count: p.count };
          }
        }
        return {
          selectedSlot: this.player.selectedSlot,
          slots,
          armor: { helmet: null, chestplate: null, leggings: null, boots: null },
        };
      },
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
    this.input.dispose();
    this.worker.dispose();
    this.renderer.dispose();
  }
}

export { CHUNK_SIZE };
