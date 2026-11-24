import { BALANCE } from '../config/balance';
import { CHUNK_SIZE, DAY_LENGTH_TICKS, FIXED_DT } from '../config/constants';
import { EventBus } from '../core/events';
import { stringToSeed } from '../core/rng';
import {
  BIOME_NAMES,
  GameMode,
  GameSettings,
  GameStateSnapshot,
  IGameDebugAPI,
  PerfMetricsSnapshot,
  Vec3,
} from '../core/types';
import { attachDebugAPI } from '../debug/DebugAPI';
import { EntitySystem } from '../entities/EntitySystem';
import { BlockId } from '../registry/blocks';
import { chunkKey, worldToChunkCoord } from '../world/Chunk';
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
  world: World;
  worker: WorldWorkerClient;

  private mode: GameMode = 'playing';
  private worldId = 'world-default';
  private worldTime = 6000; // Noon by default
  private settings: GameSettings = { ...BALANCE.defaults };

  // Camera / player transform (expanded in M2 into full Player class)
  private playerPos: Vec3 = { x: 0, y: 82, z: 0 };
  private playerVel: Vec3 = { x: 0, y: 0, z: 0 };
  private yaw = 0;
  private pitch = -0.25;
  private flying = true;
  private spawnPoint: Vec3 = { x: 0, y: 82, z: 0 };

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

  // Lightweight M1 HUD banner
  private readonly hudInfoEl: HTMLDivElement;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement, initialSeed: number | string = 1337) {
    const seedNum = stringToSeed(initialSeed);
    this.world = new World(seedNum, this.events);
    this.entities = new EntitySystem(this.events);
    this.renderer = new Renderer(canvas, this.settings.fov);
    this.input = new InputManager(canvas);
    this.worker = new WorldWorkerClient(seedNum);

    // Compute safe initial spawn above terrain
    const spawn = findSafeSpawn(seedNum);
    this.spawnPoint = { x: spawn.x + 0.5, y: spawn.y + 12, z: spawn.z + 0.5 };
    this.playerPos = { ...this.spawnPoint };

    this.hudInfoEl = document.createElement('div');
    this.hudInfoEl.style.cssText =
      'position:absolute;top:12px;left:12px;padding:8px 12px;background:rgba(18,22,28,0.72);' +
      'border:1px solid rgba(240,235,225,0.2);border-radius:6px;font-size:12px;line-height:1.45;' +
      'font-family:ui-monospace,Consolas,monospace;color:#f0ebe1;pointer-events:none;';
    uiRoot.appendChild(this.hudInfoEl);

    canvas.addEventListener('click', () => {
      if (this.mode === 'playing' && !this.input.isPointerLocked()) {
        this.input.requestPointerLock();
      }
    });

    this.events.on('chunk:dirty', ({ cx, cz }) => {
      this.enqueueRemesh(cx, cz);
    });

    attachDebugAPI(this.createDebugAPI());
    this.isReady = true;
    this.startLoop();
  }

  async startNewWorld(seedInput?: number | string, name?: string): Promise<void> {
    const seed = seedInput !== undefined ? stringToSeed(seedInput) : Math.floor(Math.random() * 0xffffffff) >>> 0;
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

    const spawn = findSafeSpawn(seed);
    this.spawnPoint = { x: spawn.x + 0.5, y: spawn.y + (this.flying ? 12 : 2), z: spawn.z + 0.5 };
    this.playerPos = { ...this.spawnPoint };
    this.playerVel = { x: 0, y: 0, z: 0 };
    this.mode = 'playing';
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

      this.handleCameraMouse();

      this.accumulator += rawDt;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < 4) {
        this.stepFixed(FIXED_DT);
        this.accumulator -= FIXED_DT;
        steps++;
      }

      this.streamChunks();
      this.processRemeshQueue();

      this.renderer.setCamera(this.playerPos, this.yaw, this.pitch);
      this.renderer.updateEnvironment(this.worldTime, this.settings.renderDistance, this.playerPos, false);

      const jsBeforeRender = performance.now();
      this.renderer.render();
      // Track pure JS frame time (excluding GPU submit/stall when possible)
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

  private handleCameraMouse(): void {
    const { dx, dy } = this.input.consumeMouseDelta();
    if (dx !== 0 || dy !== 0) {
      const sens = 0.0022 * this.settings.mouseSensitivity;
      this.yaw -= dx * sens;
      this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch - dy * sens));
    }
  }

  private stepFixed(dt: number): void {
    if (this.mode !== 'playing') return;

    this.worldTime = (this.worldTime + 1) % (DAY_LENGTH_TICKS * 10000);

    // Free-fly camera movement for M1
    const forward = (this.input.isDown('KeyW') ? 1 : 0) - (this.input.isDown('KeyS') ? 1 : 0);
    const strafe = (this.input.isDown('KeyD') ? 1 : 0) - (this.input.isDown('KeyA') ? 1 : 0);
    const vertical = (this.input.isDown('Space') ? 1 : 0) - (this.input.isSneakingInput() ? 1 : 0);

    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    let mx = -sinY * forward + cosY * strafe;
    let mz = -cosY * forward - sinY * strafe;
    const len = Math.hypot(mx, mz);
    if (len > 0.001) {
      mx /= len;
      mz /= len;
    }

    const speed = this.input.isSprintingInput() ? BALANCE.player.flySpeed * 1.8 : BALANCE.player.flySpeed;
    this.playerVel.x = mx * speed;
    this.playerVel.y = vertical * speed * 0.75;
    this.playerVel.z = mz * speed;

    this.playerPos.x += this.playerVel.x * dt;
    this.playerPos.y = Math.max(2, Math.min(126, this.playerPos.y + this.playerVel.y * dt));
    this.playerPos.z += this.playerVel.z * dt;

    this.entities.update(dt);
    this.input.clearPressedFrame();
  }

  private streamChunks(): void {
    const pcx = worldToChunkCoord(this.playerPos.x);
    const pcz = worldToChunkCoord(this.playerPos.z);
    const radius = Math.max(2, Math.min(12, Math.round(this.settings.renderDistance)));
    const radiusSq = radius * radius;
    const unloadRadiusSq = (radius + 2) * (radius + 2);

    // Unload distant chunks
    for (const { cx, cz } of this.world.getLoadedChunkCoords()) {
      const dx = cx - pcx;
      const dz = cz - pcz;
      if (dx * dx + dz * dz > unloadRadiusSq) {
        this.world.unloadChunk(cx, cz);
        this.renderer.removeChunkMesh(cx, cz);
      }
    }

    if (this.inflightGen.size >= this.maxInflightGen) return;

    // Collect missing chunks within radius sorted nearest-first
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

          // Discard if player flew far away before worker finished
          const curPcx = worldToChunkCoord(this.playerPos.x);
          const curPcz = worldToChunkCoord(this.playerPos.z);
          if ((cand.cx - curPcx) ** 2 + (cand.cz - curPcz) ** 2 > unloadRadiusSq) return;

          this.world.setChunk(chunk);
          this.renderer.setChunkMesh(cand.cx, cand.cz, mesh);

          // Queue remesh for this chunk and adjacent already-loaded neighbors so cross-chunk faces & AO stitch seamlessly
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
    const biome = this.world.getBiome(this.playerPos.x, this.playerPos.z);
    const stats = this.renderer.getRenderStats();
    const wStats = this.worker.getStats();
    this.hudInfoEl.textContent =
      `STONEROOT | Seed ${this.world.seed} | Biome: ${BIOME_NAMES[biome]} | ` +
      `XYZ: ${this.playerPos.x.toFixed(1)}, ${this.playerPos.y.toFixed(1)}, ${this.playerPos.z.toFixed(1)} | ` +
      `Chunks: ${this.world.getLoadedChunkCoords().length} | ` +
      `Calls: ${stats.drawCalls} | Tris: ${stats.triangles} | ` +
      `Gen: ${wStats.chunkGenAvgMs.toFixed(1)}ms | Mesh: ${wStats.chunkMeshAvgMs.toFixed(1)}ms`;
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
        this.yaw = yaw;
        this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
      },
      setKey: (code, down) => this.input.setVirtualKey(code, down),
      releaseAllKeys: () => this.input.releaseAllVirtualKeys(),
      setFlying: (enabled) => {
        this.flying = enabled;
      },
      selectHotbar: () => {},
      mineBlock: async () => ({ broken: false, blockId: BlockId.Air, pos: null }),
      placeBlock: () => false,
      interact: () => false,
      useItem: async () => false,
      attack: () => false,
      craft: () => false,
      moveSlot: () => false,
      openContainerAt: () => false,
      closeContainer: () => {},
      getOpenContainer: () => null,
      teleport: (x, y, z) => {
        this.playerPos = { x, y, z };
        this.playerVel = { x: 0, y: 0, z: 0 };
      },
      setSpawnPoint: (x, y, z) => {
        this.spawnPoint = { x, y, z };
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
        const biome = this.world.getBiome(this.playerPos.x, this.playerPos.z);
        return {
          mode: this.mode,
          worldId: this.worldId,
          seed: this.world.seed,
          worldTime: this.worldTime,
          dayCount: Math.floor(this.worldTime / DAY_LENGTH_TICKS),
          biome,
          biomeName: BIOME_NAMES[biome],
          player: {
            pos: { ...this.playerPos },
            vel: { ...this.playerVel },
            yaw: this.yaw,
            pitch: this.pitch,
            onGround: false,
            inWater: false,
            headInWater: false,
            sneaking: this.input.isSneakingInput(),
            sprinting: this.input.isSprintingInput(),
            flying: this.flying,
            health: BALANCE.player.maxHealth,
            maxHealth: BALANCE.player.maxHealth,
            hunger: BALANCE.player.maxHunger,
            maxHunger: BALANCE.player.maxHunger,
            saturation: 10,
            oxygen: BALANCE.player.maxOxygen,
            maxOxygen: BALANCE.player.maxOxygen,
            armorDefense: 0,
            selectedSlot: 0,
            spawnPoint: { ...this.spawnPoint },
            dead: false,
            deathCount: 0,
          },
          openContainer: null,
          loadedChunks: this.world.getLoadedChunkCoords().length,
        };
      },
      getInventory: () => ({
        selectedSlot: 0,
        slots: new Array(36).fill(null),
        armor: { helmet: null, chestplate: null, leggings: null, boots: null },
      }),
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
