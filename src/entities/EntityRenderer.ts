import * as THREE from 'three';
import { ItemRegistry } from '../registry/items';
import { TextureAtlas } from '../engine/TextureAtlas';
import { DroppedItemEntity } from './DroppedItem';
import { Entity } from './EntitySystem';
import { ArrowEntity } from './Projectile';

export class EntityRenderer {
  private readonly group: THREE.Group;
  private readonly atlas: TextureAtlas;
  private readonly meshes = new Map<number, THREE.Object3D>();
  private readonly itemTextures = new Map<string, THREE.Texture>();

  constructor(entityGroup: THREE.Group, atlas: TextureAtlas) {
    this.group = entityGroup;
    this.atlas = atlas;
  }

  private getItemTexture(iconKey: string): THREE.Texture {
    let tex = this.itemTextures.get(iconKey);
    if (tex) return tex;
    const img = new Image();
    img.src = this.atlas.getItemIcon(iconKey);
    tex = new THREE.Texture(img);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    img.onload = () => {
      tex!.needsUpdate = true;
    };
    this.itemTextures.set(iconKey, tex);
    return tex;
  }

  private createDroppedItemMesh(entity: DroppedItemEntity): THREE.Object3D {
    const def = ItemRegistry.get(entity.stack.itemId);
    const iconKey = def?.icon ?? 'stone';
    const tex = this.getItemTexture(iconKey);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
    });
    const isBlock = def?.placesBlock !== undefined;
    const geo = isBlock ? new THREE.BoxGeometry(0.28, 0.28, 0.28) : new THREE.PlaneGeometry(0.36, 0.36);
    const mesh = new THREE.Mesh(geo, mat);
    return mesh;
  }

  private createArrowMesh(): THREE.Object3D {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.05, 0.65),
      new THREE.MeshLambertMaterial({ color: 0x9c7649 })
    );
    const tip = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.09, 0.14),
      new THREE.MeshLambertMaterial({ color: 0x8f979e })
    );
    tip.position.z = -0.35;
    const fletch = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.14, 0.12),
      new THREE.MeshLambertMaterial({ color: 0xefe9de })
    );
    fletch.position.z = 0.28;
    g.add(shaft, tip, fletch);
    return g;
  }

  sync(entities: readonly Entity[], nowSec: number, customFactory?: (e: Entity) => THREE.Object3D | null): void {
    const seen = new Set<number>();

    for (const e of entities) {
      if (!e.alive) continue;
      seen.add(e.id);

      let obj = this.meshes.get(e.id);
      if (!obj) {
        if (e.kind === 'dropped_item') {
          obj = this.createDroppedItemMesh(e as DroppedItemEntity);
        } else if (e.kind === 'arrow') {
          obj = this.createArrowMesh();
        } else if (customFactory) {
          obj = customFactory(e) ?? undefined;
        }
        if (obj) {
          this.group.add(obj);
          this.meshes.set(e.id, obj);
        }
      }

      if (!obj) continue;

      if (e.kind === 'dropped_item') {
        const bob = Math.sin(nowSec * 3.5 + e.id) * 0.07;
        obj.position.set(e.pos.x, e.pos.y + 0.2 + bob, e.pos.z);
        obj.rotation.y = e.yaw;
      } else if (e.kind === 'arrow') {
        const arrow = e as ArrowEntity;
        obj.position.set(arrow.pos.x, arrow.pos.y, arrow.pos.z);
        obj.rotation.order = 'YXZ';
        obj.rotation.y = arrow.yaw;
        obj.rotation.x = arrow.pitch;
      } else {
        obj.position.set(e.pos.x, e.pos.y, e.pos.z);
        obj.rotation.y = e.yaw;
      }
    }

    // Remove dead entities
    for (const [id, obj] of this.meshes) {
      if (!seen.has(id)) {
        this.group.remove(obj);
        obj.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
            else if (child.material instanceof THREE.Material) child.material.dispose();
          }
        });
        this.meshes.delete(id);
      }
    }
  }

  getObject(id: number): THREE.Object3D | undefined {
    return this.meshes.get(id);
  }

  clear(): void {
    this.sync([], 0);
  }

  dispose(): void {
    this.clear();
    for (const tex of this.itemTextures.values()) tex.dispose();
    this.itemTextures.clear();
  }
}
