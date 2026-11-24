import * as THREE from 'three';
import { BALANCE } from './config/balance';
import { EventBus } from './core/events';
import { BiomeId, BIOME_NAMES, GameMode, GameSettings, IGameDebugAPI } from './core/types';
import { attachDebugAPI } from './debug/DebugAPI';
import { EntitySystem } from './entities/EntitySystem';
import { BlockId } from './registry/blocks';
import { Chunk } from './world/Chunk';
import { World } from './world/World';

function bootstrapM0(): void {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  const uiRoot = document.getElementById('ui-root');
  if (!canvas || !uiRoot) {
    throw new Error('Missing #game-canvas or #ui-root');
  }

  const events = new EventBus();
  const world = new World(1337, events);
  const entities = new EntitySystem(events);
  // Seed one initial chunk for M0 scaffold sanity
  const initialChunk = new Chunk(0, 0);
  initialChunk.setBlock(0, 64, 0, BlockId.Grass);
  world.setChunk(initialChunk);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x7fb4d8);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 256);
  camera.position.set(3.2, 2.4, 3.8);
  camera.lookAt(0, 0, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.7);
  const sun = new THREE.DirectionalLight(0xfff4d6, 0.9);
  sun.position.set(5, 10, 7);
  scene.add(ambient, sun);

  // M0 architecture smoke cube (replaced by full chunked voxel world in M1)
  const geometry = new THREE.BoxGeometry(1.5, 1.5, 1.5);
  const material = new THREE.MeshLambertMaterial({ color: 0x5d8a47 });
  const cube = new THREE.Mesh(geometry, material);
  scene.add(cube);

  const banner = document.createElement('div');
  banner.style.cssText =
    'position:absolute;top:16px;left:16px;padding:10px 14px;background:rgba(20,24,30,0.78);' +
    'border:1px solid rgba(240,235,225,0.22);border-radius:6px;font-size:13px;letter-spacing:0.4px;';
  banner.textContent = 'STONEROOT — M0 Architecture Scaffold Ready';
  uiRoot.appendChild(banner);

  let settings: GameSettings = { ...BALANCE.defaults };
  let mode: GameMode = 'playing';
  let worldTime = 6000;
  let yaw = 0;
  let pitch = 0;
  const playerPos = { x: 0, y: 66, z: 0 };
  const spawnPoint = { x: 0, y: 66, z: 0 };

  const debugAPI: IGameDebugAPI = {
    ready: () => true,
    getMode: () => mode,
    startNewWorld: async () => {
      mode = 'playing';
    },
    continueWorld: async () => {
      mode = 'playing';
    },
    saveNow: async () => {},
    setLook: (y, p) => {
      yaw = y;
      pitch = p;
    },
    setKey: () => {},
    releaseAllKeys: () => {},
    setFlying: () => {},
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
      playerPos.x = x;
      playerPos.y = y;
      playerPos.z = z;
    },
    setSpawnPoint: (x, y, z) => {
      spawnPoint.x = x;
      spawnPoint.y = y;
      spawnPoint.z = z;
    },
    advanceTime: (ticks) => {
      worldTime += ticks;
    },
    stepSimulation: (ticks) => {
      for (let i = 0; i < ticks; i++) entities.update(0.05);
    },
    getState: () => ({
      mode,
      worldId: 'm0-scaffold',
      seed: world.seed,
      worldTime,
      dayCount: Math.floor(worldTime / 24000),
      biome: BiomeId.Plains,
      biomeName: BIOME_NAMES[BiomeId.Plains],
      player: {
        pos: { ...playerPos },
        vel: { x: 0, y: 0, z: 0 },
        yaw,
        pitch,
        onGround: true,
        inWater: false,
        headInWater: false,
        sneaking: false,
        sprinting: false,
        flying: false,
        health: 20,
        maxHealth: 20,
        hunger: 20,
        maxHunger: 20,
        saturation: 10,
        oxygen: 20,
        maxOxygen: 20,
        armorDefense: 0,
        selectedSlot: 0,
        spawnPoint: { ...spawnPoint },
        dead: false,
        deathCount: 0,
      },
      openContainer: null,
      loadedChunks: world.getLoadedChunkCoords().length,
    }),
    getInventory: () => ({
      selectedSlot: 0,
      slots: new Array(36).fill(null),
      armor: { helmet: null, chestplate: null, leggings: null, boots: null },
    }),
    getBlock: (x, y, z) => world.getBlock(x, y, z),
    getLight: (x, y, z) => ({ sky: world.getSkyLight(x, y, z), block: world.getBlockLight(x, y, z) }),
    getEntities: () => entities.snapshots(),
    getPerfMetrics: () => ({
      fps: 60,
      frameJsMs: 0.5,
      avgFrameJsMs: 0.5,
      maxFrameJsMs: 1.0,
      chunkGenAvgMs: 0,
      chunkMeshAvgMs: 0,
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      loadedChunks: world.getLoadedChunkCoords().length,
    }),
    setSettings: (partial) => {
      settings = { ...settings, ...partial };
    },
    getSettings: () => ({ ...settings }),
  };

  attachDebugAPI(debugAPI);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  });

  const animate = (): void => {
    requestAnimationFrame(animate);
    cube.rotation.y += 0.01;
    cube.rotation.x += 0.005;
    renderer.render(scene, camera);
  };
  animate();
}

bootstrapM0();
