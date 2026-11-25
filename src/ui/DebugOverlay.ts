import { DAY_LENGTH_TICKS } from '../config/constants';
import { BIOME_NAMES, BiomeId, PerfMetricsSnapshot, PlayerStateSnapshot } from '../core/types';
import { worldToChunkCoord } from '../world/Chunk';

export interface DebugOverlayData {
  seed: number;
  worldTime: number;
  biome: BiomeId;
  skyLight: number;
  blockLight: number;
  targetText: string;
  entityCount: number;
  player: PlayerStateSnapshot;
  perf: PerfMetricsSnapshot;
}

function getCardinalFacing(yaw: number): string {
  // yaw = 0 faces North (-Z), PI/2 faces West (-X), PI faces South (+Z), -PI/2 faces East (+X)
  const norm = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const deg = (norm * 180) / Math.PI;
  if (deg >= 315 || deg < 45) return 'North (-Z)';
  if (deg >= 45 && deg < 135) return 'West (-X)';
  if (deg >= 135 && deg < 225) return 'South (+Z)';
  return 'East (+X)';
}

export class DebugOverlay {
  private readonly el: HTMLDivElement;
  private visible = false;

  constructor(uiRoot: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'f3-debug-overlay';
    this.el.style.cssText =
      'position:absolute;top:12px;left:12px;display:none;padding:10px 14px;' +
      'background:rgba(14,18,24,0.82);border:1px solid rgba(232,207,142,0.32);border-radius:6px;' +
      'font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.5;color:#eef2f7;' +
      'pointer-events:none;z-index:18;min-width:290px;white-space:pre;';
    uiRoot.appendChild(this.el);
  }

  isVisible(): boolean {
    return this.visible;
  }

  toggle(): boolean {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
    return this.visible;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.el.style.display = v ? 'block' : 'none';
  }

  update(data: DebugOverlayData): void {
    if (!this.visible) return;
    const p = data.player;
    const bx = Math.floor(p.pos.x);
    const by = Math.floor(p.pos.y);
    const bz = Math.floor(p.pos.z);
    const cx = worldToChunkCoord(bx);
    const cz = worldToChunkCoord(bz);
    const yawDeg = (((p.yaw * 180) / Math.PI) % 360).toFixed(1);
    const pitchDeg = ((p.pitch * 180) / Math.PI).toFixed(1);
    const day = Math.floor(data.worldTime / DAY_LENGTH_TICKS) + 1;
    const tod = Math.floor(data.worldTime % DAY_LENGTH_TICKS);

    this.el.textContent = [
      `STONEROOT [F3 Debug]`,
      `FPS: ${data.perf.fps} | JS: ${data.perf.avgFrameJsMs.toFixed(2)}ms (max ${data.perf.maxFrameJsMs.toFixed(2)}ms)`,
      `XYZ: ${p.pos.x.toFixed(2)}, ${p.pos.y.toFixed(2)}, ${p.pos.z.toFixed(2)}`,
      `Block: ${bx}, ${by}, ${bz} | Chunk: (${cx}, ${cz})`,
      `Facing: ${getCardinalFacing(p.yaw)} (${yawDeg}° / ${pitchDeg}°)`,
      `Biome: ${BIOME_NAMES[data.biome]} | Seed: ${data.seed}`,
      `Light: Sky ${data.skyLight} / Block ${data.blockLight} | Day ${day} (${tod})`,
      `Target: ${data.targetText}`,
      `Chunks: ${data.perf.loadedChunks} | Calls: ${data.perf.drawCalls} | Tris: ${data.perf.triangles}`,
      `Worker Gen: ${data.perf.chunkGenAvgMs.toFixed(1)}ms | Mesh: ${data.perf.chunkMeshAvgMs.toFixed(1)}ms | Ent: ${data.entityCount}`,
    ].join('\n');
  }
}
