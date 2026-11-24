import type { BlockPos, Vec3 } from './types';
import type { BlockId } from '../registry/blocks';

export interface GameEventMap {
  'block:changed': { x: number; y: number; z: number; oldId: BlockId; newId: BlockId };
  'chunk:loaded': { cx: number; cz: number };
  'chunk:dirty': { cx: number; cz: number };
  'player:damaged': { amount: number; source: string; health: number };
  'player:died': { pos: Vec3; cause: string };
  'player:respawned': { pos: Vec3 };
  'entity:spawned': { id: number; kind: string };
  'entity:killed': { id: number; kind: string; pos: Vec3 };
  'inventory:changed': Record<string, never>;
  'container:opened': { type: 'workbench' | 'furnace' | 'chest'; pos: BlockPos };
  'container:closed': Record<string, never>;
  'world:saved': { worldId: string; timestamp: number };
  'sound:play': { name: string; volume?: number; pitch?: number };
  'particles:burst': { pos: Vec3; blockId?: BlockId; color?: number; count?: number; kind?: 'break' | 'dig' | 'splash' | 'ember' };
}

type Listener<T> = (payload: T) => void;

export class EventBus<TMap extends object = GameEventMap> {
  private listeners = new Map<keyof TMap, Set<Listener<unknown>>>();

  on<K extends keyof TMap>(event: K, listener: Listener<TMap[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<unknown>);
    return () => this.off(event, listener);
  }

  off<K extends keyof TMap>(event: K, listener: Listener<TMap[K]>): void {
    this.listeners.get(event)?.delete(listener as Listener<unknown>);
  }

  emit<K extends keyof TMap>(event: K, payload: TMap[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      (listener as Listener<TMap[K]>)(payload);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
