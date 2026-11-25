import { BALANCE } from '../config/balance';
import { CURRENT_SAVE_VERSION } from '../config/constants';
import { GameSettings, InventorySnapshot, Vec3 } from '../core/types';
import { StoredContainer } from '../systems/ContainerManager';

export interface SavedPlayerData {
  pos: Vec3;
  yaw: number;
  pitch: number;
  health: number;
  hunger: number;
  saturation: number;
  oxygen: number;
  spawnPoint: Vec3;
  deathCount: number;
  inventory: InventorySnapshot;
}

export interface WorldSaveV2 {
  version: typeof CURRENT_SAVE_VERSION;
  worldId: string;
  name: string;
  seed: number;
  worldTime: number;
  savedAt: number;
  player: SavedPlayerData;
  containers: StoredContainer[];
}

export interface ChunkSaveRecord {
  key: string; // `${worldId}:${cx},${cz}`
  worldId: string;
  cx: number;
  cz: number;
  blocks: Uint8Array;
  meta: Uint8Array;
  biomes: Uint8Array;
}

export interface SettingsSaveRecord {
  id: 'user-settings';
  version: number;
  settings: GameSettings;
}

export type MigrationResult =
  | { ok: true; data: WorldSaveV2; migrated: boolean }
  | { ok: false; reason: string };

function isValidVec3(v: unknown): v is Vec3 {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.x === 'number' &&
    Number.isFinite(o.x) &&
    typeof o.y === 'number' &&
    Number.isFinite(o.y) &&
    typeof o.z === 'number' &&
    Number.isFinite(o.z)
  );
}

/**
 * Pure versioned save validator & migrator.
 * - v1 -> v2: upgrades missing armor/oxygen/deathCount/containers fields smoothly.
 * - unknown/corrupt versions: returns `{ ok: false, reason }` without throwing so caller can warn & start fresh.
 */
export function migrateWorldSave(raw: unknown): MigrationResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'Save record is empty or corrupted.' };
  }
  const rec = raw as Record<string, unknown>;
  const ver = rec.version;
  if (typeof ver !== 'number') {
    return { ok: false, reason: 'Save format missing version field.' };
  }
  if (ver > CURRENT_SAVE_VERSION) {
    return {
      ok: false,
      reason: `Save version v${ver} is newer than supported v${CURRENT_SAVE_VERSION}.`,
    };
  }
  if (ver < 1) {
    return { ok: false, reason: `Unsupported legacy save version v${ver}.` };
  }

  if (typeof rec.seed !== 'number' || !Number.isFinite(rec.seed)) {
    return { ok: false, reason: 'Save record missing valid world seed.' };
  }
  const pRaw = rec.player as Record<string, unknown> | undefined;
  if (!pRaw || !isValidVec3(pRaw.pos)) {
    return { ok: false, reason: 'Save record missing valid player position.' };
  }

  const invRaw = (pRaw.inventory as Partial<InventorySnapshot> | undefined) ?? {};
  const slots = Array.isArray(invRaw.slots) ? invRaw.slots : new Array(36).fill(null);
  while (slots.length < 36) slots.push(null);

  const migratedPlayer: SavedPlayerData = {
    pos: { x: pRaw.pos.x, y: pRaw.pos.y, z: pRaw.pos.z },
    yaw: typeof pRaw.yaw === 'number' ? pRaw.yaw : 0,
    pitch: typeof pRaw.pitch === 'number' ? pRaw.pitch : 0,
    health: typeof pRaw.health === 'number' ? pRaw.health : BALANCE.player.maxHealth,
    hunger: typeof pRaw.hunger === 'number' ? pRaw.hunger : BALANCE.player.maxHunger,
    saturation: typeof pRaw.saturation === 'number' ? pRaw.saturation : 5,
    oxygen: typeof pRaw.oxygen === 'number' ? pRaw.oxygen : BALANCE.player.maxOxygen,
    spawnPoint: isValidVec3(pRaw.spawnPoint)
      ? { x: pRaw.spawnPoint.x, y: pRaw.spawnPoint.y, z: pRaw.spawnPoint.z }
      : { x: pRaw.pos.x, y: pRaw.pos.y, z: pRaw.pos.z },
    deathCount: typeof pRaw.deathCount === 'number' ? pRaw.deathCount : 0,
    inventory: {
      selectedSlot: typeof invRaw.selectedSlot === 'number' ? invRaw.selectedSlot : 0,
      slots: slots.slice(0, 36),
      armor: {
        helmet: invRaw.armor?.helmet ?? null,
        chestplate: invRaw.armor?.chestplate ?? null,
        leggings: invRaw.armor?.leggings ?? null,
        boots: invRaw.armor?.boots ?? null,
      },
    },
  };

  const data: WorldSaveV2 = {
    version: CURRENT_SAVE_VERSION,
    worldId: typeof rec.worldId === 'string' && rec.worldId ? rec.worldId : `world-${rec.seed}`,
    name: typeof rec.name === 'string' && rec.name ? rec.name : 'Stoneroot World',
    seed: rec.seed >>> 0,
    worldTime: typeof rec.worldTime === 'number' ? rec.worldTime : 6000,
    savedAt: typeof rec.savedAt === 'number' ? rec.savedAt : Date.now(),
    player: migratedPlayer,
    containers: Array.isArray(rec.containers) ? (rec.containers as StoredContainer[]) : [],
  };

  return { ok: true, data, migrated: ver !== CURRENT_SAVE_VERSION };
}

export function sanitizeSettings(raw: Partial<GameSettings> | undefined): GameSettings {
  const clamp = (v: unknown, lo: number, hi: number, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
  const out: GameSettings = {
    renderDistance: Math.round(clamp(raw?.renderDistance, 3, 12, BALANCE.defaults.renderDistance)),
    fov: Math.round(clamp(raw?.fov, 55, 110, BALANCE.defaults.fov)),
    mouseSensitivity: Number(clamp(raw?.mouseSensitivity, 0.2, 2.5, BALANCE.defaults.mouseSensitivity).toFixed(2)),
    volume: Number(clamp(raw?.volume, 0, 1, BALANCE.defaults.volume).toFixed(2)),
  };
  if (raw?.language === 'zh' || raw?.language === 'en') {
    out.language = raw.language;
  }
  return out;
}
