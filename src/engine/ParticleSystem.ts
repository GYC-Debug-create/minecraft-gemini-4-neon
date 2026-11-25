import * as THREE from 'three';
import { EventBus, GameEventMap } from '../core/events';
import { Vec3 } from '../core/types';
import { BlockId, BlockRegistry } from '../registry/blocks';

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  scale: number;
  gravity: number;
  age: number;
  maxAge: number;
  r: number;
  g: number;
  b: number;
}

const MAX_PARTICLES = 256;

/**
 * Pooled single-draw-call Three.js InstancedMesh voxel particle system
 * for mining chips, block destruction bursts, water splashes, and embers.
 */
export class ParticleSystem {
  private readonly mesh: THREE.InstancedMesh;
  private readonly particles: Particle[] = [];
  private readonly unsubs: Array<() => void> = [];

  // Reusable scratch objects (zero per-frame allocations)
  private readonly dummyMatrix = new THREE.Matrix4();
  private readonly dummyPos = new THREE.Vector3();
  private readonly dummyQuat = new THREE.Quaternion();
  private readonly dummyEuler = new THREE.Euler();
  private readonly dummyScale = new THREE.Vector3();
  private readonly dummyColor = new THREE.Color();

  constructor(parent: THREE.Object3D, events?: EventBus<GameEventMap>) {
    const geo = new THREE.BoxGeometry(0.11, 0.11, 0.11);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_PARTICLES);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    parent.add(this.mesh);

    if (events) {
      this.unsubs.push(
        events.on('particles:burst', (payload) => {
          this.burst(payload.pos, payload.kind ?? 'break', payload.blockId, payload.color, payload.count);
        })
      );
    }
  }

  burst(
    pos: Vec3,
    kind: 'break' | 'dig' | 'splash' | 'ember',
    blockId?: BlockId,
    explicitColor?: number,
    explicitCount?: number
  ): void {
    let baseHex = explicitColor ?? 0xb8a082;
    if (explicitColor === undefined && blockId !== undefined) {
      baseHex = BlockRegistry.get(blockId).particleColor;
    } else if (kind === 'splash' && explicitColor === undefined) {
      baseHex = 0x7fd4f2;
    } else if (kind === 'ember' && explicitColor === undefined) {
      baseHex = 0xffa43b;
    }

    const count =
      explicitCount ??
      (kind === 'break' ? 12 : kind === 'splash' ? 12 : kind === 'dig' ? 4 : 3);

    const baseR = ((baseHex >> 16) & 0xff) / 255;
    const baseG = ((baseHex >> 8) & 0xff) / 255;
    const baseB = (baseHex & 0xff) / 255;

    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) {
        this.particles.shift();
      }
      const shade = 0.82 + Math.random() * 0.32;
      const spread = kind === 'break' ? 0.42 : kind === 'splash' ? 0.35 : 0.28;
      const speedH = kind === 'break' ? 2.6 : kind === 'splash' ? 2.2 : kind === 'dig' ? 1.8 : 0.6;
      const speedV =
        kind === 'splash'
          ? 2.8 + Math.random() * 2.2
          : kind === 'ember'
          ? 0.9 + Math.random() * 0.9
          : 1.5 + Math.random() * 2.4;

      this.particles.push({
        x: pos.x + (Math.random() - 0.5) * spread * 2,
        y: pos.y + (Math.random() - 0.5) * spread * 1.4,
        z: pos.z + (Math.random() - 0.5) * spread * 2,
        vx: (Math.random() - 0.5) * speedH * 2,
        vy: speedV,
        vz: (Math.random() - 0.5) * speedH * 2,
        rx: Math.random() * Math.PI,
        ry: Math.random() * Math.PI,
        scale:
          kind === 'break'
            ? 0.8 + Math.random() * 0.75
            : kind === 'splash'
            ? 0.65 + Math.random() * 0.55
            : 0.55 + Math.random() * 0.45,
        gravity: kind === 'ember' ? -0.6 : kind === 'splash' ? 11.5 : 15.0,
        age: 0,
        maxAge:
          kind === 'break'
            ? 0.48 + Math.random() * 0.25
            : kind === 'splash'
            ? 0.42 + Math.random() * 0.22
            : 0.3 + Math.random() * 0.16,
        r: Math.min(1, baseR * shade),
        g: Math.min(1, baseG * shade),
        b: Math.min(1, baseB * shade),
      });
    }
  }

  update(dt: number): void {
    const n = this.particles.length;
    if (n === 0) {
      if (this.mesh.visible) {
        this.mesh.count = 0;
        this.mesh.visible = false;
      }
      return;
    }

    let writeIdx = 0;
    for (let i = 0; i < n; i++) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.maxAge) continue;

      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vx *= 0.96;
      p.vz *= 0.96;
      p.rx += dt * 6;
      p.ry += dt * 5;

      const lifeRatio = 1 - p.age / p.maxAge;
      const sc = p.scale * (0.35 + lifeRatio * 0.65);

      this.dummyPos.set(p.x, p.y, p.z);
      this.dummyEuler.set(p.rx, p.ry, 0);
      this.dummyQuat.setFromEuler(this.dummyEuler);
      this.dummyScale.set(sc, sc, sc);
      this.dummyMatrix.compose(this.dummyPos, this.dummyQuat, this.dummyScale);
      this.mesh.setMatrixAt(writeIdx, this.dummyMatrix);

      this.dummyColor.setRGB(p.r, p.g, p.b);
      this.mesh.setColorAt(writeIdx, this.dummyColor);

      this.particles[writeIdx] = p;
      writeIdx++;
    }

    this.particles.length = writeIdx;
    this.mesh.count = writeIdx;
    this.mesh.visible = writeIdx > 0;
    if (writeIdx > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) {
        this.mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  getActiveCount(): number {
    return this.particles.length;
  }

  clear(): void {
    this.particles.length = 0;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.unsubs.length = 0;
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
