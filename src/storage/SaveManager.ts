import { BALANCE } from '../config/balance';
import { CURRENT_SAVE_VERSION } from '../config/constants';
import { GameSettings } from '../core/types';
import { chunkKey, SerializedChunk } from '../world/Chunk';
import {
  ChunkSaveRecord,
  migrateWorldSave,
  sanitizeSettings,
  SettingsSaveRecord,
  WorldSaveV2,
} from './schema';

const DEFAULT_DB_NAME = 'stoneroot-saves';
const DB_VERSION = 1;
const STORE_WORLDS = 'worlds';
const STORE_CHUNKS = 'chunks';
const STORE_SETTINGS = 'settings';
const LOCAL_SETTINGS_KEY = 'stoneroot:settings:v1';

export type LoadWorldResult =
  | {
      ok: true;
      world: WorldSaveV2;
      chunks: Map<string, SerializedChunk>;
      migrated: boolean;
    }
  | {
      ok: false;
      empty?: boolean;
      reason: string;
    };

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export class SaveManager {
  private readonly dbName: string;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(dbName = DEFAULT_DB_NAME) {
    this.dbName = dbName;
  }

  private openDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is unavailable in this environment'));
        return;
      }
      const req = indexedDB.open(this.dbName, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_WORLDS)) {
          db.createObjectStore(STORE_WORLDS, { keyPath: 'worldId' });
        }
        if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
          const store = db.createObjectStore(STORE_CHUNKS, { keyPath: 'key' });
          store.createIndex('byWorld', 'worldId', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
          db.createObjectStore(STORE_SETTINGS, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
    });
    return this.dbPromise;
  }

  async saveSettings(settings: GameSettings): Promise<void> {
    const clean = sanitizeSettings(settings);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(clean));
      }
    } catch {
      // Ignore storage quota errors
    }
    try {
      const db = await this.openDB();
      const tx = db.transaction(STORE_SETTINGS, 'readwrite');
      const rec: SettingsSaveRecord = {
        id: 'user-settings',
        version: CURRENT_SAVE_VERSION,
        settings: clean,
      };
      tx.objectStore(STORE_SETTINGS).put(rec);
      await txDone(tx);
    } catch {
      // Fallback already persisted in localStorage
    }
  }

  async loadSettings(): Promise<GameSettings> {
    try {
      const db = await this.openDB();
      const tx = db.transaction(STORE_SETTINGS, 'readonly');
      const rec = (await reqToPromise(
        tx.objectStore(STORE_SETTINGS).get('user-settings')
      )) as SettingsSaveRecord | undefined;
      if (rec?.settings) {
        return sanitizeSettings(rec.settings);
      }
    } catch {
      // Try localStorage fallback
    }
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(LOCAL_SETTINGS_KEY);
        if (raw) return sanitizeSettings(JSON.parse(raw) as Partial<GameSettings>);
      }
    } catch {
      // Use defaults
    }
    return { ...BALANCE.defaults };
  }

  async saveWorld(worldSave: WorldSaveV2, modifiedChunks: SerializedChunk[]): Promise<void> {
    const db = await this.openDB();
    const tx = db.transaction([STORE_WORLDS, STORE_CHUNKS], 'readwrite');
    const worldsStore = tx.objectStore(STORE_WORLDS);
    const chunksStore = tx.objectStore(STORE_CHUNKS);

    worldsStore.put({ ...worldSave, savedAt: Date.now() });

    for (const c of modifiedChunks) {
      const rec: ChunkSaveRecord = {
        key: `${worldSave.worldId}:${c.cx},${c.cz}`,
        worldId: worldSave.worldId,
        cx: c.cx,
        cz: c.cz,
        blocks: new Uint8Array(c.blocks),
        meta: new Uint8Array(c.meta),
        biomes: new Uint8Array(c.biomes),
      };
      chunksStore.put(rec);
    }

    await txDone(tx);
  }

  /** Direct low-level write used by migration tests to inject legacy/corrupt save records */
  async putRawWorldRecord(raw: Record<string, unknown>): Promise<void> {
    const db = await this.openDB();
    const tx = db.transaction(STORE_WORLDS, 'readwrite');
    tx.objectStore(STORE_WORLDS).put(raw);
    await txDone(tx);
  }

  async getLatestWorldSummary(): Promise<{ worldId: string; name: string; seed: number; worldTime: number; savedAt: number } | null> {
    try {
      const db = await this.openDB();
      const tx = db.transaction(STORE_WORLDS, 'readonly');
      const all = (await reqToPromise(tx.objectStore(STORE_WORLDS).getAll())) as Array<Record<string, unknown>>;
      if (!all || all.length === 0) return null;
      all.sort((a, b) => Number(b.savedAt ?? 0) - Number(a.savedAt ?? 0));
      const latest = all[0];
      const mig = migrateWorldSave(latest);
      if (!mig.ok) return null;
      return {
        worldId: mig.data.worldId,
        name: mig.data.name,
        seed: mig.data.seed,
        worldTime: mig.data.worldTime,
        savedAt: mig.data.savedAt,
      };
    } catch {
      return null;
    }
  }

  async loadLatestWorld(): Promise<LoadWorldResult> {
    try {
      const db = await this.openDB();
      const tx = db.transaction(STORE_WORLDS, 'readonly');
      const all = (await reqToPromise(tx.objectStore(STORE_WORLDS).getAll())) as Array<Record<string, unknown>>;
      if (!all || all.length === 0) {
        return { ok: false, empty: true, reason: 'No saved world found.' };
      }
      all.sort((a, b) => Number(b.savedAt ?? 0) - Number(a.savedAt ?? 0));
      const latestRaw = all[0];
      const mig = migrateWorldSave(latestRaw);
      if (!mig.ok) {
        return { ok: false, reason: mig.reason };
      }

      const chunks = new Map<string, SerializedChunk>();
      const ctx = db.transaction(STORE_CHUNKS, 'readonly');
      const idx = ctx.objectStore(STORE_CHUNKS).index('byWorld');
      const recs = (await reqToPromise(idx.getAll(mig.data.worldId))) as ChunkSaveRecord[];
      for (const r of recs) {
        chunks.set(chunkKey(r.cx, r.cz), {
          cx: r.cx,
          cz: r.cz,
          blocks: new Uint8Array(r.blocks),
          meta: new Uint8Array(r.meta),
          biomes: new Uint8Array(r.biomes),
        });
      }

      // Persist upgraded schema immediately if migrated from older version
      if (mig.migrated) {
        await this.saveWorld(mig.data, []);
      }

      return { ok: true, world: mig.data, chunks, migrated: mig.migrated };
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : 'Failed to load save from IndexedDB.',
      };
    }
  }

  async clearWorldChunks(worldId: string): Promise<void> {
    const db = await this.openDB();
    const tx = db.transaction(STORE_CHUNKS, 'readwrite');
    const store = tx.objectStore(STORE_CHUNKS);
    const idx = store.index('byWorld');
    const keys = (await reqToPromise(idx.getAllKeys(worldId))) as IDBValidKey[];
    for (const k of keys) store.delete(k);
    await txDone(tx);
  }

  async close(): Promise<void> {
    if (!this.dbPromise) return;
    try {
      const db = await this.dbPromise;
      db.close();
    } catch {
      // ignore
    }
    this.dbPromise = null;
  }
}
