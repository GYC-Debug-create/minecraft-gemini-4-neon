import { EventBus } from '../core/events';
import { EntitySnapshot, Vec3 } from '../core/types';

export type EntityKind =
  | 'dropped_item'
  | 'arrow'
  | 'boar'
  | 'ram'
  | 'fowl'
  | 'husk'
  | 'bone_archer'
  | 'gloom_spider';

export interface Entity {
  readonly id: number;
  readonly kind: EntityKind;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  width: number;
  height: number;
  alive: boolean;
  ageTicks: number;
  update(dt: number): void;
  toSnapshot(): EntitySnapshot;
}

export class EntitySystem {
  private nextId = 1;
  private readonly entities = new Map<number, Entity>();
  private readonly events: EventBus;

  constructor(events: EventBus = new EventBus()) {
    this.events = events;
  }

  allocateId(): number {
    return this.nextId++;
  }

  add(entity: Entity): void {
    this.entities.set(entity.id, entity);
    this.events.emit('entity:spawned', { id: entity.id, kind: entity.kind });
  }

  remove(id: number): void {
    this.entities.delete(id);
  }

  get(id: number): Entity | undefined {
    return this.entities.get(id);
  }

  all(): Entity[] {
    return Array.from(this.entities.values());
  }

  byKind(kind: EntityKind): Entity[] {
    const out: Entity[] = [];
    for (const e of this.entities.values()) {
      if (e.kind === kind && e.alive) out.push(e);
    }
    return out;
  }

  count(): number {
    return this.entities.size;
  }

  clear(): void {
    this.entities.clear();
  }

  update(dt: number): void {
    for (const entity of Array.from(this.entities.values())) {
      if (!entity.alive) {
        this.entities.delete(entity.id);
        continue;
      }
      entity.ageTicks++;
      entity.update(dt);
      if (!entity.alive) {
        this.entities.delete(entity.id);
      }
    }
  }

  snapshots(): EntitySnapshot[] {
    const out: EntitySnapshot[] = [];
    for (const e of this.entities.values()) {
      if (e.alive) out.push(e.toSnapshot());
    }
    return out;
  }
}
