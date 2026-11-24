import * as THREE from 'three';
import { hash2D } from '../core/rng';
import {
  ATLAS_COLS,
  ATLAS_HEIGHT,
  ATLAS_TILES,
  ATLAS_WIDTH,
  TILE_SIZE,
  type TileName,
} from '../registry/textures';

type RGBA = readonly [number, number, number, number];

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function rgb(r: number, g: number, b: number, a = 255): RGBA {
  return [clampByte(r), clampByte(g), clampByte(b), clampByte(a)];
}

function hex(color: number, alpha = 255): RGBA {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff, alpha];
}

function shade(c: RGBA, delta: number, alphaOverride?: number): RGBA {
  return [
    clampByte(c[0] + delta),
    clampByte(c[1] + delta),
    clampByte(c[2] + delta),
    alphaOverride ?? c[3],
  ];
}

function lerpRGBA(a: RGBA, b: RGBA, t: number): RGBA {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return [
    clampByte(a[0] + (b[0] - a[0]) * k),
    clampByte(a[1] + (b[1] - a[1]) * k),
    clampByte(a[2] + (b[2] - a[2]) * k),
    clampByte(a[3] + (b[3] - a[3]) * k),
  ];
}

function rand01(seed: number, x: number, y: number): number {
  return hash2D(seed, x, y) / 4294967296;
}

function wrapCoord(v: number, period: number): number {
  const m = v % period;
  return m < 0 ? m + period : m;
}

/**
 * Seamless 2D periodic value noise on a 16x16 torus.
 */
function tileValueNoise(seed: number, x: number, y: number, freq: number): number {
  const fx = (x / TILE_SIZE) * freq;
  const fy = (y / TILE_SIZE) * freq;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);

  const ix0 = wrapCoord(x0, freq);
  const ix1 = wrapCoord(x0 + 1, freq);
  const iy0 = wrapCoord(y0, freq);
  const iy1 = wrapCoord(y0 + 1, freq);

  const v00 = rand01(seed, ix0, iy0);
  const v10 = rand01(seed, ix1, iy0);
  const v01 = rand01(seed, ix0, iy1);
  const v11 = rand01(seed, ix1, iy1);

  const a = v00 + (v10 - v00) * sx;
  const b = v01 + (v11 - v01) * sx;
  return a + (b - a) * sy;
}

function tileFbm(seed: number, x: number, y: number): number {
  return (
    tileValueNoise(seed, x, y, 4) * 0.55 +
    tileValueNoise(seed + 101, x, y, 8) * 0.3 +
    rand01(seed + 211, wrapCoord(x, TILE_SIZE), wrapCoord(y, TILE_SIZE)) * 0.15
  );
}

interface VoronoiSample {
  d1: number;
  d2: number;
  dx: number;
  dy: number;
  cellHash: number;
}

/**
 * Seamless periodic Worley/Voronoi distance field for organic pebbles & rocks.
 */
function tileVoronoi(seed: number, x: number, y: number, cells: number): VoronoiSample {
  const cellSize = TILE_SIZE / cells;
  const gx = Math.floor(x / cellSize);
  const gy = Math.floor(y / cellSize);

  let d1 = 999;
  let d2 = 999;
  let bestDx = 0;
  let bestDy = 0;
  let bestHash = 0;

  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cxIdx = wrapCoord(gx + ox, cells);
      const cyIdx = wrapCoord(gy + oy, cells);
      const jx = 0.18 + rand01(seed, cxIdx * 17 + 3, cyIdx * 31 + 7) * 0.64;
      const jy = 0.18 + rand01(seed + 79, cxIdx * 23 + 5, cyIdx * 19 + 11) * 0.64;

      const px = (gx + ox + jx) * cellSize;
      const py = (gy + oy + jy) * cellSize;
      const dx = x + 0.5 - px;
      const dy = y + 0.5 - py;
      const dist = Math.hypot(dx, dy);

      if (dist < d1) {
        d2 = d1;
        d1 = dist;
        bestDx = dx;
        bestDy = dy;
        bestHash = rand01(seed + 157, cxIdx, cyIdx);
      } else if (dist < d2) {
        d2 = dist;
      }
    }
  }

  return { d1, d2, dx: bestDx, dy: bestDy, cellHash: bestHash };
}

class PixelTile {
  readonly data = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);

  set(x: number, y: number, c: RGBA): void {
    if (x < 0 || x >= TILE_SIZE || y < 0 || y >= TILE_SIZE) return;
    const i = (y * TILE_SIZE + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = c[3];
  }

  get(x: number, y: number): RGBA {
    if (x < 0 || x >= TILE_SIZE || y < 0 || y >= TILE_SIZE) return [0, 0, 0, 0];
    const i = (y * TILE_SIZE + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  blend(x: number, y: number, c: RGBA): void {
    if (x < 0 || x >= TILE_SIZE || y < 0 || y >= TILE_SIZE) return;
    const sa = c[3] / 255;
    if (sa <= 0) return;
    if (sa >= 1) {
      this.set(x, y, c);
      return;
    }
    const i = (y * TILE_SIZE + x) * 4;
    const da = this.data[i + 3] / 255;
    const outA = sa + da * (1 - sa);
    if (outA <= 0) return;
    this.data[i] = clampByte((c[0] * sa + this.data[i] * da * (1 - sa)) / outA);
    this.data[i + 1] = clampByte((c[1] * sa + this.data[i + 1] * da * (1 - sa)) / outA);
    this.data[i + 2] = clampByte((c[2] * sa + this.data[i + 2] * da * (1 - sa)) / outA);
    this.data[i + 3] = clampByte(outA * 255);
  }

  fill(c: RGBA): void {
    for (let y = 0; y < TILE_SIZE; y++) {
      for (let x = 0; x < TILE_SIZE; x++) {
        this.set(x, y, c);
      }
    }
  }

  fillRect(x: number, y: number, w: number, h: number, c: RGBA): void {
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        this.set(px, py, c);
      }
    }
  }

  drawPattern(rows: readonly string[], palette: Readonly<Record<string, RGBA>>): void {
    const h = Math.min(rows.length, TILE_SIZE);
    for (let y = 0; y < h; y++) {
      const row = rows[y];
      const w = Math.min(row.length, TILE_SIZE);
      for (let x = 0; x < w; x++) {
        const ch = row[x];
        if (ch === '.' || ch === ' ') continue;
        const c = palette[ch];
        if (c) this.set(x, y, c);
      }
    }
  }

  blitTo(ctx: CanvasRenderingContext2D, destX: number, destY: number): void {
    const img = ctx.createImageData(TILE_SIZE, TILE_SIZE);
    img.data.set(this.data);
    ctx.putImageData(img, destX, destY);
  }
}

type TilePainter = (tile: PixelTile) => void;

// ---------------------------------------------------------------------------
// Unified Warm Earthy Block Texture Painters (all 56 ATLAS_TILES)
// ---------------------------------------------------------------------------

function paintStone(tile: PixelTile, seed = 1001): void {
  const palette: readonly RGBA[] = [
    hex(0x5c6066),
    hex(0x6d7278),
    hex(0x7c8187),
    hex(0x8d9297),
    hex(0x9ea2a6),
  ];

  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      // Subtle horizontal geological stratification
      const strata = tileValueNoise(seed, x, y * 2, 4) * 0.55 + tileFbm(seed + 13, x, y) * 0.45;
      const idx = Math.min(palette.length - 1, Math.floor(strata * palette.length));
      let c = palette[idx];
      const speck = rand01(seed + 41, x, y);
      if (speck > 0.89) c = shade(c, 11);
      else if (speck < 0.1) c = shade(c, -12);
      tile.set(x, y, c);
    }
  }

  // Fine weathered hairline fissures
  const fissures: readonly (readonly [number, number])[] = [
    [2, 3], [3, 3], [4, 4], [5, 4],
    [10, 8], [11, 8], [12, 9], [13, 9],
    [4, 12], [5, 13], [6, 13],
  ];
  for (const [fx, fy] of fissures) {
    tile.set(fx, fy, shade(tile.get(fx, fy), -22));
    tile.set(fx, wrapCoord(fy + 1, TILE_SIZE), shade(tile.get(fx, wrapCoord(fy + 1, TILE_SIZE)), 12));
  }
}

function paintCobblestone(tile: PixelTile): void {
  // Hand-laid irregular rounded masonry courses with organic bevels & deep mortar
  const mortar = hex(0x3f4348);
  const mortarLight = hex(0x51555b);
  const stoneTones: readonly RGBA[] = [
    hex(0x777c82),
    hex(0x848789),
    hex(0x6f757c),
    hex(0x8b867e), // subtle warm quarry stone
    hex(0x7d838a),
    hex(0x6a7076),
  ];

  // Stone id grid (16x16), 0 = mortar
  const layout: readonly string[] = [
    '0111102222203330',
    '1111102222203333',
    '1111102222203333',
    '0111000222000330',
    '0000444000555500',
    '6604444405555550',
    '6604444405555556',
    '6000444000555506',
    '0777708888000000',
    '7777708888809990',
    '7777708888809999',
    '0777000888009999',
    '0000aaa000000990',
    'bb0aaaaa0ccccc00',
    'bb0aaaaa0ccccccb',
    'b000aaa000cccc0b',
  ];

  const isStone = (x: number, y: number): boolean => {
    const ch = layout[wrapCoord(y, TILE_SIZE)][wrapCoord(x, TILE_SIZE)];
    return ch !== '0';
  };

  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const ch = layout[y][x];
      if (ch === '0') {
        const n = rand01(2003, x, y);
        tile.set(x, y, n > 0.65 ? mortarLight : mortar);
        continue;
      }
      const id = ch.charCodeAt(0);
      const base = stoneTones[id % stoneTones.length];
      const grain = (rand01(2017, x, y) - 0.5) * 18;
      let delta = grain;

      // Top-left sunlit stone bevel, bottom-right recessed bevel
      const topMortar = !isStone(x, y - 1);
      const leftMortar = !isStone(x - 1, y);
      const bottomMortar = !isStone(x, y + 1);
      const rightMortar = !isStone(x + 1, y);

      if (topMortar) delta += 20;
      if (leftMortar) delta += 12;
      if (bottomMortar) delta -= 22;
      if (rightMortar) delta -= 14;

      tile.set(x, y, shade(base, delta));
    }
  }
}

function paintDirt(tile: PixelTile, seed = 3001): void {
  const tones: readonly RGBA[] = [
    hex(0x5c3e25),
    hex(0x6e4c2f),
    hex(0x7c5737),
    hex(0x8b6440),
    hex(0x986f49),
  ];

  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const f = tileFbm(seed, x, y);
      let c = tones[Math.min(tones.length - 1, Math.floor(f * tones.length))];
      const r = rand01(seed + 53, x, y);
      if (r > 0.93) {
        // Tiny embedded stone pebble
        c = hex(0x968e82);
      } else if (r < 0.08) {
        // Rich dark humus speck
        c = hex(0x472f1b);
      } else {
        c = shade(c, (rand01(seed + 89, x, y) - 0.5) * 14);
      }
      tile.set(x, y, c);
    }
  }
}

function paintGrassTop(tile: PixelTile): void {
  const tones: readonly RGBA[] = [
    hex(0x40682d),
    hex(0x4f7c37),
    hex(0x608f43),
    hex(0x73a34f),
    hex(0x89b55e),
  ];

  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const f = tileFbm(4001, x, y);
      const bladeBias = tileValueNoise(4051, x * 2, y, 8) * 0.35;
      const v = Math.min(0.999, f * 0.72 + bladeBias);
      let c = tones[Math.floor(v * tones.length)];
      const speck = rand01(4099, x, y);
      if (speck > 0.9) c = hex(0x9bc46b);
      else if (speck < 0.08) c = hex(0x365924);
      tile.set(x, y, c);
    }
  }
}

function paintGrassSide(tile: PixelTile): void {
  paintDirt(tile, 3001);

  // Organic scalloped grass overhang
  const depths = [4, 5, 4, 3, 4, 6, 5, 4, 3, 4, 5, 6, 4, 3, 5, 4];
  const grassDark = hex(0x3f682d);
  const grassMid = hex(0x58873d);
  const grassBright = hex(0x73a34f);
  const grassTip = hex(0x88b45d);

  for (let x = 0; x < TILE_SIZE; x++) {
    const d = depths[x];
    for (let y = 0; y < d; y++) {
      const r = rand01(4507, x, y);
      let c: RGBA;
      if (y === 0) {
        c = r > 0.45 ? grassTip : grassBright;
      } else if (y === d - 1) {
        c = r > 0.5 ? grassDark : grassMid;
      } else {
        c = r > 0.65 ? grassBright : r < 0.25 ? grassDark : grassMid;
      }
      tile.set(x, y, c);
    }
    // Cast shadow right below turf overhang
    if (d < TILE_SIZE) {
      tile.set(x, d, shade(tile.get(x, d), -26));
    }
  }
}

function paintSand(tile: PixelTile): void {
  const tones: readonly RGBA[] = [
    hex(0xc4ac72),
    hex(0xd2bc82),
    hex(0xdec990),
    hex(0xe8d6a0),
  ];

  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      // Gentle wind-blown diagonal sand dunes
      const wave = Math.sin(((x + y * 2) / TILE_SIZE) * Math.PI * 2) * 0.25 + 0.5;
      const n = tileFbm(5003, x, y);
      const v = Math.min(0.999, Math.max(0, wave * 0.45 + n * 0.55));
      let c = tones[Math.floor(v * tones.length)];
      const glint = rand01(5051, x, y);
      if (glint > 0.92) c = hex(0xf3e5b8);
      else if (glint < 0.08) c = hex(0xb3985e);
      tile.set(x, y, c);
    }
  }
}

function paintSandstoneTop(tile: PixelTile): void {
  const base = hex(0xd5be86);
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const n = (tileFbm(6007, x, y) - 0.5) * 26;
      let c = shade(base, n);
      // Carved architectural trim inset border
      if (x === 0 || y === 0) c = shade(c, 16);
      else if (x === 15 || y === 15) c = shade(c, -18);
      else if (x === 2 || y === 2) {
        if (x >= 2 && x <= 13 && y >= 2 && y <= 13) c = shade(c, -12);
      } else if (x === 13 || y === 13) {
        if (x >= 2 && x <= 13 && y >= 2 && y <= 13) c = shade(c, 10);
      }
      tile.set(x, y, c);
    }
  }
}

function paintSandstoneSide(tile: PixelTile): void {
  const bandColors: readonly RGBA[] = [
    hex(0xdcc791), // y=0 top cap
    hex(0xd3bc84),
    hex(0xc9b078),
    hex(0xb89d66), // y=3 frieze shadow
    hex(0xd9c28b), // y=4 strata light
    hex(0xd0b77f),
    hex(0xc5aa72),
    hex(0xbca068),
    hex(0xd2ba82),
    hex(0xc9b077),
    hex(0xb99e67),
    hex(0xceba84),
    hex(0xc2a76f),
    hex(0xb79b64),
    hex(0xc5aa72),
    hex(0xae925c),
  ];

  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const grain = (rand01(6113, x, y) - 0.5) * 16;
      let c = shade(bandColors[y], grain);
      // Carved upper frieze blocks (y=1..2)
      if (y === 0) c = shade(c, 10);
      if ((y === 1 || y === 2) && x % 4 === 0) c = shade(c, -22);
      if ((y === 1 || y === 2) && x % 4 === 1) c = shade(c, 10);
      // Natural rough pitting on lower rock (y >= 9)
      if (y >= 9) {
        const pit = rand01(6151, x, y);
        if (pit < 0.12) c = shade(c, -24);
        else if (pit > 0.9) c = shade(c, 14);
      }
      tile.set(x, y, c);
    }
  }
}

function paintGravel(tile: PixelTile): void {
  const pebbleTones: readonly RGBA[] = [
    hex(0x6e6a65),
    hex(0x827d77),
    hex(0x948d84),
    hex(0x75787d),
    hex(0x9e9283),
    hex(0x5e5b58),
  ];

  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const v = tileVoronoi(7001, x, y, 5);
      const edge = v.d2 - v.d1;
      if (edge < 0.35) {
        // Dark crevice between pebbles
        tile.set(x, y, hex(0x494643));
      } else {
        const base = pebbleTones[Math.floor(v.cellHash * pebbleTones.length) % pebbleTones.length];
        const lightDir = (-v.dx - v.dy) * 11;
        const micro = (rand01(7039, x, y) - 0.5) * 14;
        tile.set(x, y, shade(base, lightDir + micro));
      }
    }
  }
}

function paintSnow(tile: PixelTile): void {
  const shadow = hex(0xcbe0ef);
  const mid = hex(0xe3f0f8);
  const bright = hex(0xf4f9fd);

  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const drift = tileFbm(8009, x, y);
      let c = drift < 0.38 ? lerpRGBA(shadow, mid, drift / 0.38) : lerpRGBA(mid, bright, (drift - 0.38) / 0.62);
      const sparkle = rand01(8053, x, y);
      if (sparkle > 0.94) c = hex(0xffffff);
      else if (sparkle < 0.06) c = hex(0xbcd5e8);
      tile.set(x, y, c);
    }
  }
}

function paintSnowSide(tile: PixelTile): void {
  paintDirt(tile, 3001);
  const depths = [5, 6, 5, 4, 4, 5, 6, 7, 5, 4, 4, 5, 6, 5, 4, 5];

  for (let x = 0; x < TILE_SIZE; x++) {
    const d = depths[x];
    for (let y = 0; y < d; y++) {
      const r = rand01(8501, x, y);
      let c: RGBA;
      if (y <= 1) c = r > 0.4 ? hex(0xf6fbff) : hex(0xe8f3fa);
      else if (y === d - 1) c = r > 0.5 ? hex(0xbdd5e8) : hex(0xd1e4f2);
      else c = r > 0.65 ? hex(0xeff7fc) : hex(0xdbeaf5);
      tile.set(x, y, c);
    }
    if (d < TILE_SIZE) {
      tile.set(x, d, shade(tile.get(x, d), -28));
    }
  }
}

function paintIce(tile: PixelTile): void {
  // Translucent pale glacier blue (alpha ~195) with crystalline diagonal cracks
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const f = tileFbm(9001, x, y);
      const base = lerpRGBA(hex(0x7ebde0, 192), hex(0xafe0f7, 198), f);
      tile.set(x, y, base);
    }
  }

  // Frosty rim accent
  for (let i = 0; i < TILE_SIZE; i++) {
    tile.blend(i, 0, hex(0xdaf3ff, 120));
    tile.blend(0, i, hex(0xdaf3ff, 110));
    tile.blend(i, 15, hex(0x5c9dc4, 95));
    tile.blend(15, i, hex(0x5c9dc4, 95));
  }

  // Diagonal crystalline sheen & fracture streaks
  const gleams: readonly (readonly [number, number])[] = [
    [2, 5], [3, 4], [4, 3], [5, 2],
    [3, 6], [4, 5], [5, 4],
    [9, 13], [10, 12], [11, 11], [12, 10], [13, 9],
    [10, 13], [11, 12], [12, 11],
  ];
  for (const [gx, gy] of gleams) {
    tile.set(gx, gy, hex(0xe6f8ff, 228));
  }

  const cracks: readonly (readonly [number, number])[] = [
    [6, 6], [7, 7], [8, 7], [9, 8], [7, 8], [6, 9],
    [11, 3], [12, 4], [13, 4],
    [2, 11], [3, 12], [4, 12],
  ];
  for (const [cx, cy] of cracks) {
    tile.set(cx, cy, hex(0x5292b8, 215));
    tile.blend(cx + 1, cy, hex(0xf0fbff, 160));
  }
}

function paintBedrock(tile: PixelTile): void {
  const tones: readonly RGBA[] = [
    hex(0x181a1f),
    hex(0x252830),
    hex(0x343842),
    hex(0x464b57),
    hex(0x585e6b),
  ];

  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const v = tileVoronoi(10007, x, y, 4);
      const seam = v.d2 - v.d1;
      if (seam < 0.45) {
        tile.set(x, y, hex(0x13151a));
      } else {
        const ridge = Math.min(0.999, Math.max(0, v.cellHash * 0.6 + tileFbm(10061, x, y) * 0.4));
        let c = tones[Math.floor(ridge * tones.length)];
        const speck = rand01(10099, x, y);
        if (speck > 0.88) c = shade(c, 18);
        else if (speck < 0.14) c = shade(c, -16);
        tile.set(x, y, c);
      }
    }
  }
}

function embedOreClusters(
  tile: PixelTile,
  clusters: readonly (readonly [number, number])[],
  dark: RGBA,
  mid: RGBA,
  bright: RGBA,
  glint?: RGBA,
  glowTint?: RGBA
): void {
  for (const [cx, cy] of clusters) {
    if (glowTint) {
      for (let oy = -1; oy <= 2; oy++) {
        for (let ox = -1; ox <= 2; ox++) {
          tile.blend(cx + ox, cy + oy, glowTint);
        }
      }
    }
    tile.set(cx, cy, bright);
    tile.set(cx + 1, cy, mid);
    tile.set(cx, cy + 1, mid);
    tile.set(cx + 1, cy + 1, dark);
    if (glint) {
      tile.set(cx, cy, glint);
      tile.set(cx + 1, cy, bright);
    }
  }
}

function paintCoalOre(tile: PixelTile): void {
  paintStone(tile, 1001);
  const clusters: readonly (readonly [number, number])[] = [
    [2, 2], [4, 3], [10, 2], [7, 6], [12, 7], [3, 10], [5, 11], [10, 12],
  ];
  embedOreClusters(tile, clusters, hex(0x16181c), hex(0x262930), hex(0x3a3e47));
  // Angular coal corners
  tile.set(3, 2, hex(0x1b1d22));
  tile.set(8, 7, hex(0x181a1f));
  tile.set(11, 12, hex(0x1c1f25));
}

function paintIronOre(tile: PixelTile): void {
  paintStone(tile, 1001);
  const clusters: readonly (readonly [number, number])[] = [
    [2, 3], [9, 2], [11, 3], [5, 7], [12, 8], [3, 11], [8, 12],
  ];
  embedOreClusters(tile, clusters, hex(0x7c4f36), hex(0xb37f5c), hex(0xd9ab86), hex(0xf0d2b6));
  tile.set(6, 8, hex(0x966346));
  tile.set(10, 3, hex(0xc99672));
}

function paintGoldOre(tile: PixelTile): void {
  paintStone(tile, 1001);
  const clusters: readonly (readonly [number, number])[] = [
    [3, 2], [10, 3], [6, 6], [12, 9], [2, 10], [8, 12],
  ];
  embedOreClusters(tile, clusters, hex(0x996914), hex(0xd19c26), hex(0xf4cc4b), hex(0xfff5a8));
  tile.set(4, 3, hex(0xe3b436));
  tile.set(9, 13, hex(0xb37d1b));
}

function paintPrismiteOre(tile: PixelTile): void {
  paintStone(tile, 1001);
  // Glowing teal-violet crystal clusters (Stoneroot's signature rare gem!)
  const tealClusters: readonly (readonly [number, number])[] = [
    [2, 2], [11, 4], [5, 8], [10, 11],
  ];
  embedOreClusters(
    tile,
    tealClusters,
    hex(0x186e6b),
    hex(0x32bfa9),
    hex(0x7af7e6),
    hex(0xd8fffb),
    hex(0x35d6c5, 42)
  );

  // Violet prismatic crystal shards paired with teal facets
  const violetShards: readonly (readonly [number, number])[] = [
    [4, 3], [10, 5], [7, 9], [9, 12], [3, 12],
  ];
  for (const [vx, vy] of violetShards) {
    tile.blend(vx - 1, vy, hex(0x9566eb, 50));
    tile.blend(vx + 1, vy, hex(0x9566eb, 50));
    tile.set(vx, vy, hex(0xba8cff));
    tile.set(vx, vy + 1, hex(0x7346c4));
    tile.set(vx - 1, vy + 1, hex(0x52d9cb));
  }
}

function paintLogTop(
  tile: PixelTile,
  barkOuter: RGBA,
  barkInner: RGBA,
  sapwood: RGBA,
  ringDark: RGBA,
  ringLight: RGBA
): void {
  const cx = 7.5;
  const cy = 7.5;
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy);
      const radialNoise = (rand01(11003, x, y) - 0.5) * 14;
      const isEdge = x === 0 || x === 15 || y === 0 || y === 15;
      const isInnerRim = x === 1 || x === 14 || y === 1 || y === 14;

      if (isEdge) {
        tile.set(x, y, shade(barkOuter, radialNoise));
      } else if (isInnerRim && dist > 6.5) {
        tile.set(x, y, shade(barkInner, radialNoise));
      } else if (dist > 5.7) {
        tile.set(x, y, shade(sapwood, radialNoise));
      } else {
        const ringPhase = Math.sin(dist * 2.45);
        const base = ringPhase > 0.1 ? ringLight : ringDark;
        let c = shade(base, radialNoise * 0.8);
        if (dist < 1.3) c = shade(ringDark, -18);
        tile.set(x, y, c);
      }
    }
  }
  // Natural drying check line
  tile.set(8, 7, shade(ringDark, -20));
  tile.set(9, 7, shade(ringDark, -14));
  tile.set(10, 8, shade(ringDark, -10));
}

function paintBarkSide(
  tile: PixelTile,
  seed: number,
  dark: RGBA,
  mid: RGBA,
  ridge: RGBA,
  highlight: RGBA
): void {
  for (let x = 0; x < TILE_SIZE; x++) {
    const colBase = tileValueNoise(seed, x * 2, 0, 8);
    for (let y = 0; y < TILE_SIZE; y++) {
      const vertical = tileValueNoise(seed + 37, x * 2, y, 4);
      const n = colBase * 0.55 + vertical * 0.35 + rand01(seed + 71, x, y) * 0.1;
      let c: RGBA;
      if (n < 0.28) c = dark;
      else if (n < 0.58) c = mid;
      else if (n < 0.82) c = ridge;
      else c = highlight;

      // Occasional horizontal bark fissure break
      if (rand01(seed + 113, Math.floor(x / 2), y) > 0.93) {
        c = shade(dark, -10);
      }
      tile.set(x, y, c);
    }
  }
}

function paintBirchLogSide(tile: PixelTile): void {
  const baseTones: readonly RGBA[] = [
    hex(0xc9c1ae),
    hex(0xd8d1c0),
    hex(0xe5dfd0),
    hex(0xefeae0),
  ];

  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const f = tileValueNoise(12101, x, y * 2, 4) * 0.6 + rand01(12143, x, y) * 0.4;
      let c = baseTones[Math.min(baseTones.length - 1, Math.floor(f * baseTones.length))];
      if (x % 5 === 0) c = shade(c, -8);
      tile.set(x, y, c);
    }
  }

  // Characteristic horizontal silverwood lenticel striations & bark knots
  const marks: readonly (readonly [number, number, number])[] = [
    [1, 2, 4], [10, 1, 3], [6, 5, 5], [13, 6, 3],
    [2, 9, 5], [9, 10, 4], [4, 13, 3], [11, 14, 4],
  ];
  for (const [mx, my, len] of marks) {
    for (let i = 0; i < len; i++) {
      const px = wrapCoord(mx + i, TILE_SIZE);
      const isEdge = i === 0 || i === len - 1;
      tile.set(px, my, isEdge ? hex(0x6e6459) : hex(0x38322c));
      if (!isEdge && my + 1 < TILE_SIZE) {
        tile.set(px, my + 1, hex(0x9e9484));
      }
    }
  }
}

function paintLeaves(
  tile: PixelTile,
  seed: number,
  deep: RGBA,
  mid: RGBA,
  light: RGBA,
  tip: RGBA,
  twig: RGBA,
  mask: readonly string[]
): void {
  // Leaves use genuine alpha=0 cutout holes between leafy clusters for alphaTest: 0.5
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const ch = mask[y][x];
      if (ch === '.') {
        tile.set(x, y, [0, 0, 0, 0]);
        continue;
      }
      const r = rand01(seed, x, y);
      if (ch === 't') {
        tile.set(x, y, twig);
      } else if (ch === '3') {
        tile.set(x, y, r > 0.45 ? tip : light);
      } else if (ch === '2') {
        tile.set(x, y, r > 0.65 ? light : mid);
      } else {
        tile.set(x, y, r > 0.6 ? mid : deep);
      }
    }
  }
}

const OAK_LEAVES_MASK: readonly string[] = [
  '.232..1232..231.',
  '233211233212321.',
  '1221.122211221..',
  '.11..11t1.112321',
  '..2321.1..123321',
  '123321...122211.',
  '23221..23211t1..',
  '1211..23321.1..2',
  '.1..122211..2323',
  '...123321..23321',
  '23212221..12211.',
  '33211t1..111..12',
  '221..1..2321.233',
  '11..23213321.221',
  '..123321221..11.',
  '.122211.11..232.',
];

const BIRCH_LEAVES_MASK: readonly string[] = [
  '..32...232...32.',
  '.3321.2332..332.',
  '.221..1221..221.',
  '..1..232..1..1..',
  '232.23321232....',
  '332.1221.3321.23',
  '221..11..221.233',
  '.1..232...1..122',
  '...23321.232..1.',
  '32.1221.23321...',
  '321.11..1221.232',
  '21..232..11.2332',
  '...23321....1221',
  '23.1221.232..11.',
  '321.11.23321..23',
  '.21....1221..232',
];

const PINE_LEAVES_MASK: readonly string[] = [
  '.1321..321..132.',
  '12332123321.2321',
  '221122112211211.',
  '.1t1.11..1t1.1..',
  '..2321..12321..1',
  '1233211233211232',
  '2212212212212211',
  '.1..1t1..1..1t1.',
  '132..1..1321..1.',
  '23321..23321.132',
  '12211.12211.2332',
  '.1t1..11t1..1221',
  '..1..2321...1t1.',
  '132123321.1321..',
  '233212211233211.',
  '1221.11..122112.',
];

function paintPlanks(
  tile: PixelTile,
  seed: number,
  seam: RGBA,
  dark: RGBA,
  mid: RGBA,
  light: RGBA,
  highlight: RGBA
): void {
  const joints = [5, 11, 3, 9];
  for (let y = 0; y < TILE_SIZE; y++) {
    const board = Math.floor(y / 4);
    const ly = y % 4;
    const jointX = joints[board];
    for (let x = 0; x < TILE_SIZE; x++) {
      if (ly === 3 || x === jointX) {
        tile.set(x, y, seam);
        continue;
      }
      const grain = tileValueNoise(seed + board * 19, x, y * 3, 4);
      const micro = (rand01(seed + 97, x, y) - 0.5) * 12;
      let base = grain < 0.33 ? dark : grain < 0.7 ? mid : light;
      if (ly === 0) base = lerpRGBA(base, highlight, 0.45);
      if (ly === 2) base = shade(base, -10);
      if (x === wrapCoord(jointX + 1, TILE_SIZE)) base = shade(base, 8);

      // Small wood dowel pegs near plank joints
      if (ly === 1 && (x === wrapCoord(jointX - 1, TILE_SIZE) || x === wrapCoord(jointX + 2, TILE_SIZE))) {
        tile.set(x, y, shade(seam, 8));
      } else {
        tile.set(x, y, shade(base, micro));
      }
    }
  }
}

function paintGlass(tile: PixelTile): void {
  // Translucent clear interior (alpha ~45), crisp frosted border frame, diagonal streaks
  tile.fill(hex(0xcce8f2, 45));

  const frameOuter = hex(0xb0d3df, 228);
  const frameInner = hex(0xdbf1f8, 165);
  const frameCorner = hex(0x90b8c7, 238);

  for (let i = 0; i < TILE_SIZE; i++) {
    tile.set(i, 0, frameOuter);
    tile.set(i, 15, frameOuter);
    tile.set(0, i, frameOuter);
    tile.set(15, i, frameOuter);
  }
  tile.set(0, 0, frameCorner);
  tile.set(15, 0, frameCorner);
  tile.set(0, 15, frameCorner);
  tile.set(15, 15, frameCorner);

  for (let i = 1; i < 15; i++) {
    tile.set(i, 1, frameInner);
    tile.set(1, i, frameInner);
  }

  // Diagonal reflection highlights
  const streaks: readonly (readonly [number, number, number])[] = [
    [3, 5, 180], [4, 4, 195], [5, 3, 180],
    [3, 6, 125], [4, 5, 145], [5, 4, 145], [6, 3, 125],
    [10, 12, 165], [11, 11, 185], [12, 10, 165],
    [11, 12, 120], [12, 11, 120],
  ];
  for (const [sx, sy, a] of streaks) {
    tile.set(sx, sy, hex(0xf2fcff, a));
  }
}

function paintWater(tile: PixelTile): void {
  // Layered blue-teal ripples with semi-transparent alpha (~175/255)
  const deep = hex(0x28678f, 178);
  const mid = hex(0x3681ab, 172);
  const light = hex(0x4c9bc4, 176);
  const crest = hex(0x7ac3e0, 186);

  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const wave1 = Math.sin(((x * 1.0 + Math.sin((y / TILE_SIZE) * Math.PI * 2) * 2.2) / TILE_SIZE) * Math.PI * 2);
      const wave2 = Math.sin(((y * 2.0 + x * 0.5) / TILE_SIZE) * Math.PI * 2);
      const f = tileValueNoise(14009, x, y, 4);
      const h = (wave1 * 0.3 + wave2 * 0.35 + f * 0.7) * 0.5 + 0.32;

      let c: RGBA;
      if (h > 0.78) c = crest;
      else if (h > 0.54) c = lerpRGBA(mid, light, (h - 0.54) / 0.24);
      else c = lerpRGBA(deep, mid, Math.max(0, h / 0.54));
      tile.set(x, y, c);
    }
  }
}

function paintTallGrass(tile: PixelTile): void {
  tile.drawPattern(
    [
      '................',
      '................',
      '......l.....l...',
      '..l...g....gl...',
      '..gl..g...g.g..l',
      '...g..g..gl.g.gl',
      '.l.g.lg..g..g.g.',
      '.g.g.g.l.g..g.g.',
      '.g.d.g.g.d.lg.d.',
      '..dg.d.g.g.gd.g.',
      '..gd.d.d.d.gd.d.',
      '.l.d.dgd.d.dd.d.',
      '.g.dddgddd.dddd.',
      '..ddddgddddddd..',
      '..sdddddddddds..',
      '..ssddddddddss..',
    ],
    {
      s: hex(0x2f5422),
      d: hex(0x436f30),
      g: hex(0x5f9142),
      l: hex(0x88b85c),
    }
  );
}

function paintFlowerRed(tile: PixelTile): void {
  tile.drawPattern(
    [
      '................',
      '................',
      '......rr.rr.....',
      '.....rRrrRrr....',
      '....rRROORRrr...',
      '....rROyyORrr...',
      '.....rROORrr....',
      '......rrdr......',
      '.......gg.......',
      '.....lg.g.gl....',
      '....lgg.g.ggl...',
      '.....dd.g.dd....',
      '.......dg.......',
      '......dgd.......',
      '.......d........',
      '.......s........',
    ],
    {
      d: hex(0x3a6429),
      s: hex(0x2a4a1e),
      g: hex(0x55863b),
      l: hex(0x78aa51),
      r: hex(0x9e2120),
      R: hex(0xd13b32),
      O: hex(0xef614f),
      y: hex(0xf2c94c),
    }
  );
}

function paintFlowerYellow(tile: PixelTile): void {
  tile.drawPattern(
    [
      '................',
      '................',
      '........YY......',
      '...YY..YyyY.....',
      '..YyyY.yooY.....',
      '..yooY..YY..YY..',
      '...YY...g..YyyY.',
      '....g...g..yooY.',
      '....g..lg...YY..',
      '...lg..g...g....',
      '....gd.g..dg....',
      '.....dgd.dg.....',
      '......dgdd......',
      '......dgd.......',
      '.......d........',
      '......ss........',
    ],
    {
      s: hex(0x2c4e1f),
      d: hex(0x3e692c),
      g: hex(0x5b8d40),
      l: hex(0x80b055),
      Y: hex(0xc78f16),
      y: hex(0xebbf34),
      o: hex(0xfdf07a),
    }
  );
}

function paintDryScrub(tile: PixelTile): void {
  tile.drawPattern(
    [
      '................',
      '................',
      '................',
      '...t........t...',
      '..tb...t...bt...',
      '...b..tb...b..t.',
      '.t.b...b..b..tb.',
      '.tb.b..b.b...b..',
      '..b.d.db.b..b...',
      '...bd..d.d.db...',
      '....d..d.d.d....',
      '...sd..d.dd.....',
      '....sd.ddd......',
      '.....sddd.......',
      '......dd........',
      '.....sdds.......',
    ],
    {
      s: hex(0x4a3820),
      d: hex(0x695130),
      b: hex(0x8a6d43),
      t: hex(0xab8e5f),
    }
  );
}

function paintWorkbenchTop(tile: PixelTile): void {
  const frameDark = hex(0x57381e);
  const frameMid = hex(0x78502d);
  const boardLight = hex(0xb38754);
  const boardMid = hex(0x9e7343);
  const gridLine = hex(0x472d18);
  const stud = hex(0x6b727a);

  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const grain = (rand01(16001, x, y) - 0.5) * 14;
      if (x === 0 || x === 15 || y === 0 || y === 15) {
        tile.set(x, y, shade(frameDark, grain * 0.6));
      } else if (x === 1 || x === 14 || y === 1 || y === 14) {
        tile.set(x, y, shade(frameMid, grain * 0.7));
      } else {
        // 3x3 crafting grid lines inside x=2..13, y=2..13
        const isLine = x === 5 || x === 10 || y === 5 || y === 10;
        const isBevel = x === 6 || x === 11 || y === 6 || y === 11;
        if (isLine) {
          tile.set(x, y, gridLine);
        } else if (isBevel) {
          tile.set(x, y, shade(boardLight, 10 + grain * 0.5));
        } else {
          tile.set(x, y, shade((x + y) % 2 === 0 ? boardLight : boardMid, grain));
        }
      }
    }
  }
  // Iron corner rivets
  tile.set(1, 1, stud);
  tile.set(14, 1, stud);
  tile.set(1, 14, stud);
  tile.set(14, 14, stud);
}

function paintWorkbenchSide(tile: PixelTile): void {
  paintPlanks(tile, 16201, hex(0x5c3d22), hex(0x8a643b), hex(0x9e7548), hex(0xb38958), hex(0xc79e6c));

  // Heavy top apron overhang (y=0..3)
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const g = (rand01(16223, x, y) - 0.5) * 10;
      const base = y === 0 ? hex(0x8c6036) : y === 3 ? hex(0x472c16) : hex(0x6e4928);
      tile.set(x, y, shade(base, g));
    }
  }
  // Side frame pillars
  for (let y = 4; y < 16; y++) {
    tile.set(0, y, hex(0x5e3d21));
    tile.set(15, y, hex(0x52341b));
  }

  // Hanging hand-saw (left) & mallet/hammer (right)
  tile.drawPattern(
    [
      '................',
      '................',
      '................',
      '................',
      '................',
      '...hh......mmm..',
      '..h..h....mmMm..',
      '...hh......ww...',
      '...sS......ww...',
      '...sS......ww...',
      '...sS......ww...',
      '...sS......ww...',
      '...sS......ww...',
      '....S......dd...',
      '................',
      '................',
    ],
    {
      h: hex(0x754723),
      s: hex(0x6b737c),
      S: hex(0xc2cbd4),
      m: hex(0x5a6169),
      M: hex(0xaab4bd),
      w: hex(0x7d512a),
      d: hex(0x4f3118),
    }
  );
}

function paintFurnaceTop(tile: PixelTile): void {
  paintStone(tile, 17001);
  // Dressed stone border + central soot-rimmed chimney vent
  for (let i = 0; i < TILE_SIZE; i++) {
    tile.set(i, 0, hex(0x94999e));
    tile.set(0, i, hex(0x94999e));
    tile.set(i, 15, hex(0x4e5257));
    tile.set(15, i, hex(0x4e5257));
  }
  // Radial slab joints
  for (let i = 1; i < 6; i++) {
    tile.set(7, i, hex(0x4a4e54));
    tile.set(8, 15 - i, hex(0x4a4e54));
    tile.set(i, 8, hex(0x4a4e54));
    tile.set(15 - i, 7, hex(0x4a4e54));
  }
  // Recessed dark kiln flue
  tile.drawPattern(
    [
      '................',
      '................',
      '................',
      '................',
      '................',
      '......rrrr......',
      '.....rddddr.....',
      '.....rdccdr.....',
      '.....rdccdr.....',
      '.....rddddr.....',
      '......rrrr......',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
    {
      r: hex(0x50545a),
      d: hex(0x32353a),
      c: hex(0x1b1d21),
    }
  );
}

function paintFurnaceFront(tile: PixelTile): void {
  paintCobblestone(tile);
  // Stone kiln facade with upper damper vent & glowing arched firebox
  tile.drawPattern(
    [
      '................',
      '..llllllllllll..',
      '..sdddddddddds..',
      '..sdccccccccds..',
      '..sdddddddddds..',
      '..bbbbbbbbbbbb..',
      '.....llllll.....',
      '....lssssssl....',
      '...lscgccgcsl...',
      '...lscogogcsl...',
      '...lsceggecsl...',
      '...lseoeoeosl...',
      '...lsggggggsl...',
      '..bbbbbbbbbbbb..',
      '................',
      '................',
    ],
    {
      l: hex(0x999ea3),
      s: hex(0x52565c),
      b: hex(0x43474c),
      d: hex(0x35383d),
      c: hex(0x1b1c20),
      g: hex(0x3b3d42),
      e: hex(0xb8461c),
      o: hex(0xeb8c2f),
    }
  );
}

function paintChestTop(tile: PixelTile): void {
  paintPlanks(tile, 18001, hex(0x593a1d), hex(0x875c31), hex(0x9e6e3c), hex(0xb5814b), hex(0xc9965e));
  // Perimeter dark oak frame + riveted iron corner straps
  for (let i = 0; i < TILE_SIZE; i++) {
    tile.set(i, 0, hex(0x4f3218));
    tile.set(i, 15, hex(0x472c14));
    tile.set(0, i, hex(0x4f3218));
    tile.set(15, i, hex(0x472c14));
    tile.set(i, 1, hex(0x6b4523));
    tile.set(i, 14, hex(0x5e3b1d));
  }
  const iron = hex(0x4b5159);
  const ironHi = hex(0x858e99);
  for (const [cx, cy] of [[1, 1], [13, 1], [1, 13], [13, 13]]) {
    tile.fillRect(cx, cy, 2, 2, iron);
    tile.set(cx, cy, ironHi);
  }
}

function paintChestFront(tile: PixelTile): void {
  paintPlanks(tile, 18101, hex(0x593a1d), hex(0x855a30), hex(0x9b6b3a), hex(0xb07d47), hex(0xc7945c));
  // Dark outer frame & horizontal lid seam at y=5
  for (let i = 0; i < TILE_SIZE; i++) {
    tile.set(i, 0, hex(0x4f3218));
    tile.set(i, 15, hex(0x442a13));
    tile.set(0, i, hex(0x4f3218));
    tile.set(15, i, hex(0x442a13));
    tile.set(i, 5, hex(0x2c1b0c));
    tile.set(i, 6, hex(0x633f1f));
  }
  // Vertical forged iron reinforcement bands
  for (let y = 1; y < 15; y++) {
    if (y === 5) continue;
    tile.set(2, y, hex(0x4d535c));
    tile.set(13, y, hex(0x4d535c));
    if (y === 2 || y === 8 || y === 13) {
      tile.set(2, y, hex(0x8a939e));
      tile.set(13, y, hex(0x8a939e));
    }
  }
  // Raised brass/iron clasp lock centered over seam
  tile.drawPattern(
    [
      '................',
      '................',
      '................',
      '................',
      '......BBBB......',
      '......BGGb......',
      '......BGkb......',
      '......BGGb......',
      '......bbbb......',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
    {
      B: hex(0xebca63),
      G: hex(0xc79d38),
      b: hex(0x7d5d1b),
      k: hex(0x261d14),
    }
  );
}

function paintTorch(tile: PixelTile): void {
  tile.drawPattern(
    [
      '................',
      '.......o........',
      '......oyo.......',
      '......yfy.......',
      '.....oyfyo......',
      '......oyo.......',
      '......ccc.......',
      '......iIi.......',
      '.......wW.......',
      '.......dW.......',
      '.......wW.......',
      '.......dW.......',
      '.......wW.......',
      '.......dw.......',
      '.......wW.......',
      '.......dd.......',
    ],
    {
      o: hex(0xe86c22),
      y: hex(0xf7be38),
      f: hex(0xfffbe0),
      c: hex(0x362820),
      i: hex(0x525961),
      I: hex(0x8f99a3),
      w: hex(0x7c532e),
      W: hex(0xa87846),
      d: hex(0x5e3c1e),
    }
  );
}

function paintBedTop(tile: PixelTile): void {
  // Fully opaque camp bed top: linen pillow at top (y=0..4), folded cuff (y=5..6), quilted crimson blanket (y=7..15)
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      // Wooden frame sides
      if (x === 0 || x === 15 || y === 0 || y === 15) {
        tile.set(x, y, shade(hex(0x6e4928), (rand01(19001, x, y) - 0.5) * 12));
        continue;
      }
      if (y <= 4) {
        // Cream linen pillow
        const isBorder = x === 1 || x === 14 || y === 1 || y === 4;
        const base = isBorder ? hex(0xcfc5b0) : hex(0xede6d8);
        const crease = y === 3 && x > 3 && x < 12 ? -10 : 0;
        tile.set(x, y, shade(base, crease + (rand01(19013, x, y) - 0.5) * 10));
      } else if (y === 5 || y === 6) {
        // Folded cream-tan blanket trim
        const c = y === 5 ? hex(0xe3d8c3) : hex(0xc7baa1);
        tile.set(x, y, shade(c, (rand01(19031, x, y) - 0.5) * 8));
      } else {
        // Quilted crimson-terracotta wool blanket
        const stitch = (x + y) % 4 === 0 || (x - y + 16) % 4 === 0;
        const base = stitch ? hex(0x96372e) : hex(0xb8493d);
        const hi = y === 7 ? 14 : y === 14 ? -14 : 0;
        tile.set(x, y, shade(base, hi + (rand01(19069, x, y) - 0.5) * 10));
      }
    }
  }
}

function paintBedSide(tile: PixelTile): void {
  // Fully opaque side (Bed is in opaque bucket!)
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const g = (rand01(19201, x, y) - 0.5) * 10;
      if (y <= 5) {
        // Blanket overhang
        const base = y === 0 ? hex(0xc95a4c) : y === 5 ? hex(0x8a3129) : hex(0xb2473b);
        tile.set(x, y, shade(base, g));
      } else if (y === 6) {
        // Cream sheet hem
        tile.set(x, y, shade(hex(0xddd2bd), g));
      } else if (y <= 10) {
        // Carved oak bed frame rail
        const base = y === 7 ? hex(0x9c7143) : y === 10 ? hex(0x5c3c20) : hex(0x7d542e);
        tile.set(x, y, shade(base, g));
      } else {
        // Solid corner legs + dark recessed under-bed shadow
        const isLeg = x <= 2 || x >= 13;
        const base = isLeg ? (x === 0 || x === 13 ? hex(0x7c542e) : hex(0x5e3d1f)) : hex(0x2d2016);
        tile.set(x, y, shade(base, g * 0.6));
      }
    }
  }
}

function paintDoorBottom(tile: PixelTile): void {
  const frameDark = hex(0x593a1f);
  const frameMid = hex(0x7d5530);
  const panelMid = hex(0x9b6e41);
  const panelLight = hex(0xb08252);
  const iron = hex(0x474d54);
  const ironHi = hex(0x8f98a3);

  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const g = (rand01(20001, x, y) - 0.5) * 12;
      const isOuter = x <= 1 || x >= 14 || y >= 14 || y === 0;
      const isMullion = x === 7 || x === 8;
      if (isOuter || isMullion) {
        tile.set(x, y, shade(x === 0 || x === 15 || y === 15 ? frameDark : frameMid, g));
      } else {
        // Recessed vertical oak door panels
        const plankEdge = x === 4 || x === 11;
        const base = plankEdge ? frameDark : x === 2 || x === 9 ? panelLight : panelMid;
        tile.set(x, y, shade(base, g));
      }
    }
  }

  // Iron strap hinge on left
  tile.fillRect(1, 10, 4, 2, iron);
  tile.set(2, 10, ironHi);
  tile.set(4, 10, ironHi);

  // Forged iron door latch/handle on upper right
  tile.fillRect(11, 2, 3, 2, iron);
  tile.set(12, 2, ironHi);
  tile.set(13, 3, hex(0x2e3238));
}

function paintDoorTop(tile: PixelTile): void {
  const frameDark = hex(0x593a1f);
  const frameMid = hex(0x7d5530);
  const iron = hex(0x474d54);
  const ironHi = hex(0x8f98a3);

  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      // 2x2 cutout window panes (alpha = 0) so scenery & light show through the timber door!
      const inWindowX = (x >= 3 && x <= 6) || (x >= 9 && x <= 12);
      const inWindowY = (y >= 3 && y <= 6) || (y >= 8 && y <= 11);
      if (inWindowX && inWindowY) {
        tile.set(x, y, [0, 0, 0, 0]);
        continue;
      }
      const g = (rand01(20101, x, y) - 0.5) * 12;
      const isOuter = x === 0 || x === 15 || y === 0 || y === 15;
      const isInnerBevel = x === 2 || x === 13 || y === 2 || y === 12 || x === 7 || x === 8 || y === 7;
      const base = isOuter ? frameDark : isInnerBevel ? hex(0x6e4a29) : frameMid;
      tile.set(x, y, shade(base, g));
    }
  }

  // Upper iron strap hinge on left
  tile.fillRect(1, 3, 2, 2, iron);
  tile.set(1, 3, ironHi);
  tile.fillRect(1, 13, 4, 2, iron);
  tile.set(2, 13, ironHi);
}

function paintLadder(tile: PixelTile): void {
  tile.drawPattern(
    [
      '..lS........lS..',
      '..lS........lS..',
      '..pHHHHHHHHHHp..',
      '..pddddddddddp..',
      '..lS........lS..',
      '..lS........lS..',
      '..pHHHHHHHHHHp..',
      '..pddddddddddp..',
      '..lS........lS..',
      '..lS........lS..',
      '..pHHHHHHHHHHp..',
      '..pddddddddddp..',
      '..lS........lS..',
      '..lS........lS..',
      '..pHHHHHHHHHHp..',
      '..pddddddddddp..',
    ],
    {
      l: hex(0xb38754),
      S: hex(0x7a542e),
      H: hex(0xc29560),
      d: hex(0x6e4a26),
      p: hex(0x4a3018),
    }
  );
}

function paintFarmland(tile: PixelTile, wet: boolean): void {
  const ridgeLight = wet ? hex(0x52361f) : hex(0x8c6743);
  const ridgeMid = wet ? hex(0x442b17) : hex(0x785535);
  const trough = wet ? hex(0x28180c) : hex(0x543922);
  const sheen = wet ? hex(0x664933) : hex(0x9e7953);

  for (let y = 0; y < TILE_SIZE; y++) {
    const rowPhase = y % 4;
    for (let x = 0; x < TILE_SIZE; x++) {
      const n = (rand01(wet ? 21011 : 21001, x, y) - 0.5) * 14;
      let base: RGBA;
      if (rowPhase === 0) base = ridgeLight;
      else if (rowPhase === 1) base = ridgeMid;
      else if (rowPhase === 2) base = shade(ridgeMid, -10);
      else base = trough;

      let c = shade(base, n);
      if (rowPhase === 3 && rand01(21071, x, y) > 0.8) {
        c = sheen;
      }
      tile.set(x, y, c);
    }
  }
}

function paintCrop0(tile: PixelTile): void {
  tile.drawPattern(
    [
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '....l.......l...',
      '...lg..l...lg...',
      '....d.lg....d.l.',
      '....d..d....d.g.',
      '...sd..ds..sd.d.',
    ],
    {
      s: hex(0x365924),
      d: hex(0x4c7a31),
      g: hex(0x6ea143),
      l: hex(0x96c45c),
    }
  );
}

function paintCrop1(tile: PixelTile): void {
  tile.drawPattern(
    [
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '...l.....l......',
      '..lg..l..gl..l..',
      '...g.lg..g..gl..',
      '..lg.g..lg..g...',
      '...d.g...d..g.l.',
      '...d.d...d..d.g.',
      '..sd.ds.sd..d.d.',
      '..sddd..sdddd.d.',
      '..sddds.sddddds.',
    ],
    {
      s: hex(0x395e25),
      d: hex(0x528234),
      g: hex(0x74a644),
      l: hex(0x9ec960),
    }
  );
}

function paintCrop2(tile: PixelTile): void {
  tile.drawPattern(
    [
      '................',
      '................',
      '................',
      '....e.....e.....',
      '...ee..e..ee..e.',
      '...ye.ee..ye.ee.',
      '..l.g.ey..g..ey.',
      '..g.g..g..g..g..',
      '...dg.lg.dg.lg..',
      '...dg..g.dg..g..',
      '..ldg..d.dg..d..',
      '...dd..d.dd..d..',
      '...dd.sd.dd.sd..',
      '..sdd.sd.dd.sd..',
      '..sdddsd.dddsd..',
      '..sdddsdsdddsd..',
    ],
    {
      s: hex(0x4a692b),
      d: hex(0x668a38),
      g: hex(0x88a846),
      l: hex(0xa9bf56),
      y: hex(0xc7c258),
      e: hex(0xded56d),
    }
  );
}

function paintCrop3(tile: PixelTile): void {
  tile.drawPattern(
    [
      '................',
      '...G......G.....',
      '..GYG..G.GYG..G.',
      '..GYG.GYGGYG.GYG',
      '...GA.GYG.GA.GYG',
      '..g.A..GA..A..GA',
      '..a.a..aA..a..a.',
      '...aa.ga..aa.ga.',
      '...da..a..da..a.',
      '..lda..d..da..d.',
      '...da..d..da..d.',
      '...dd..d..dd..d.',
      '..sdd.sd..dd.sd.',
      '..sdd.sd.sdd.sd.',
      '..sdddsd.sdddsd.',
      '..sdddsd.sdddsd.',
    ],
    {
      s: hex(0x6e5c26),
      d: hex(0x947d34),
      a: hex(0xb89c40),
      g: hex(0xa89d42),
      l: hex(0xc9b24e),
      A: hex(0xc7992c),
      G: hex(0xe3bd46),
      Y: hex(0xfae27a),
    }
  );
}

function paintDirtPathTop(tile: PixelTile): void {
  const tones: readonly RGBA[] = [
    hex(0x82673f),
    hex(0x967a4d),
    hex(0xa88c5c),
    hex(0xb89c6a),
  ];

  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const f = tileFbm(22003, x, y);
      let c = tones[Math.min(tones.length - 1, Math.floor(f * tones.length))];
      const r = rand01(22051, x, y);
      if (r > 0.91) c = hex(0x9d9689); // pressed flat pebble
      else if (r < 0.08) c = hex(0x6b5231);
      tile.set(x, y, c);
    }
  }
}

function paintDirtPathSide(tile: PixelTile): void {
  paintDirt(tile, 3001);
  for (let x = 0; x < TILE_SIZE; x++) {
    const depth = rand01(22201, x, 0) > 0.5 ? 3 : 2;
    for (let y = 0; y < depth; y++) {
      const base = y === 0 ? hex(0xb39765) : hex(0x967a4c);
      tile.set(x, y, shade(base, (rand01(22247, x, y) - 0.5) * 12));
    }
    tile.set(x, depth, shade(tile.get(x, depth), -22));
  }
}

function paintSnowBrick(tile: PixelTile): void {
  const mortar = hex(0x8db0c9);
  const brickBase = hex(0xdbeaf5);
  const joints = [0, 8, 4, 12];

  for (let y = 0; y < TILE_SIZE; y++) {
    const course = Math.floor(y / 4);
    const ly = y % 4;
    const j1 = joints[course];
    const j2 = (j1 + 8) % TILE_SIZE;
    for (let x = 0; x < TILE_SIZE; x++) {
      if (ly === 3 || x === j1 || x === j2) {
        tile.set(x, y, shade(mortar, (rand01(23003, x, y) - 0.5) * 10));
        continue;
      }
      const n = (tileFbm(23051, x, y) - 0.5) * 16;
      let delta = n;
      if (ly === 0) delta += 16;
      else if (ly === 2) delta -= 12;
      if (x === wrapCoord(j1 + 1, TILE_SIZE) || x === wrapCoord(j2 + 1, TILE_SIZE)) delta += 10;
      tile.set(x, y, shade(brickBase, delta));
    }
  }
}

const TILE_PAINTERS: Record<TileName, TilePainter> = {
  stone: (t) => paintStone(t, 1001),
  cobblestone: paintCobblestone,
  dirt: (t) => paintDirt(t, 3001),
  grass_top: paintGrassTop,
  grass_side: paintGrassSide,
  sand: paintSand,
  sandstone_top: paintSandstoneTop,
  sandstone_side: paintSandstoneSide,
  gravel: paintGravel,
  snow: paintSnow,
  snow_side: paintSnowSide,
  ice: paintIce,
  bedrock: paintBedrock,
  coal_ore: paintCoalOre,
  iron_ore: paintIronOre,
  gold_ore: paintGoldOre,
  prismite_ore: paintPrismiteOre,
  oak_log_top: (t) =>
    paintLogTop(t, hex(0x4d331d), hex(0x664528), hex(0xc7a372), hex(0x8c643b), hex(0xb38756)),
  oak_log_side: (t) =>
    paintBarkSide(t, 12001, hex(0x452d19), hex(0x5f4025), hex(0x755232), hex(0x8a643e)),
  birch_log_top: (t) =>
    paintLogTop(t, hex(0xd4ccba), hex(0x524940), hex(0xe3d6b8), hex(0xb39f78), hex(0xd4c29a)),
  birch_log_side: paintBirchLogSide,
  pine_log_top: (t) =>
    paintLogTop(t, hex(0x3a2217), hex(0x523121), hex(0xb0805a), hex(0x6b432b), hex(0x946241)),
  pine_log_side: (t) =>
    paintBarkSide(t, 12503, hex(0x331d14), hex(0x4a2c1e), hex(0x613b29), hex(0x754a34)),
  oak_leaves: (t) =>
    paintLeaves(t, 13001, hex(0x2c5222), hex(0x417031), hex(0x5a8f41), hex(0x77ad54), hex(0x5c3e24), OAK_LEAVES_MASK),
  birch_leaves: (t) =>
    paintLeaves(t, 13103, hex(0x4a702c), hex(0x65903d), hex(0x84ae50), hex(0xa3c968), hex(0x8c7f6b), BIRCH_LEAVES_MASK),
  pine_leaves: (t) =>
    paintLeaves(t, 13207, hex(0x1b3b31), hex(0x295446), hex(0x3a6e5c), hex(0x528a76), hex(0x4a2d1e), PINE_LEAVES_MASK),
  oak_planks: (t) =>
    paintPlanks(t, 13501, hex(0x5e3e22), hex(0x8a643b), hex(0x9e7649), hex(0xb38a59), hex(0xc79f6d)),
  birch_planks: (t) =>
    paintPlanks(t, 13601, hex(0x8f7d58), hex(0xbaa77c), hex(0xcab98c), hex(0xd9ca9f), hex(0xe8dbb4)),
  pine_planks: (t) =>
    paintPlanks(t, 13701, hex(0x3d2416), hex(0x613e28), hex(0x734d34), hex(0x875d41), hex(0x9c7051)),
  glass: paintGlass,
  water: paintWater,
  tall_grass: paintTallGrass,
  flower_red: paintFlowerRed,
  flower_yellow: paintFlowerYellow,
  dry_scrub: paintDryScrub,
  workbench_top: paintWorkbenchTop,
  workbench_side: paintWorkbenchSide,
  furnace_top: paintFurnaceTop,
  furnace_front: paintFurnaceFront,
  chest_top: paintChestTop,
  chest_front: paintChestFront,
  torch: paintTorch,
  bed_top: paintBedTop,
  bed_side: paintBedSide,
  door_bottom: paintDoorBottom,
  door_top: paintDoorTop,
  ladder: paintLadder,
  farmland_dry: (t) => paintFarmland(t, false),
  farmland_wet: (t) => paintFarmland(t, true),
  crop_0: paintCrop0,
  crop_1: paintCrop1,
  crop_2: paintCrop2,
  crop_3: paintCrop3,
  dirt_path_top: paintDirtPathTop,
  dirt_path_side: paintDirtPathSide,
  snow_brick: paintSnowBrick,
};

// ---------------------------------------------------------------------------
// Progressive 10-Stage Break Crack Overlay Generator
// ---------------------------------------------------------------------------

interface CrackPixel {
  readonly x: number;
  readonly y: number;
  readonly stage: number;
  readonly heavy?: boolean;
}

const CRACK_NETWORK: readonly CrackPixel[] = [
  // Stage 0: initial center fracture
  { x: 7, y: 7, stage: 0 }, { x: 8, y: 7, stage: 0 }, { x: 8, y: 8, stage: 0 },
  { x: 6, y: 8, stage: 0 },
  // Stage 1: short cracks branching out
  { x: 7, y: 6, stage: 1 }, { x: 6, y: 6, stage: 1 },
  { x: 9, y: 8, stage: 1 }, { x: 9, y: 9, stage: 1 },
  { x: 6, y: 9, stage: 1 },
  // Stage 2: 3 arms extending
  { x: 5, y: 5, stage: 2 }, { x: 8, y: 5, stage: 2 },
  { x: 10, y: 9, stage: 2 }, { x: 5, y: 10, stage: 2 },
  { x: 7, y: 9, stage: 2, heavy: true },
  // Stage 3: branching forks
  { x: 4, y: 5, stage: 3 }, { x: 4, y: 4, stage: 3 },
  { x: 9, y: 5, stage: 3 }, { x: 10, y: 4, stage: 3 },
  { x: 11, y: 10, stage: 3 }, { x: 4, y: 10, stage: 3 },
  { x: 7, y: 10, stage: 3 }, { x: 8, y: 11, stage: 3 },
  // Stage 4: radiating deeper
  { x: 3, y: 3, stage: 4 }, { x: 5, y: 3, stage: 4 },
  { x: 11, y: 4, stage: 4 }, { x: 11, y: 3, stage: 4 },
  { x: 12, y: 10, stage: 4 }, { x: 11, y: 11, stage: 4 },
  { x: 3, y: 11, stage: 4 }, { x: 8, y: 12, stage: 4 },
  { x: 7, y: 8, stage: 4, heavy: true },
  // Stage 5: secondary web links & center widening
  { x: 6, y: 4, stage: 5 }, { x: 7, y: 4, stage: 5 },
  { x: 10, y: 6, stage: 5 }, { x: 11, y: 7, stage: 5 },
  { x: 12, y: 7, stage: 5 }, { x: 5, y: 7, stage: 5 },
  { x: 4, y: 8, stage: 5 }, { x: 9, y: 12, stage: 5 },
  { x: 6, y: 11, stage: 5 }, { x: 6, y: 7, stage: 5, heavy: true },
  // Stage 6: reaching near edges
  { x: 2, y: 2, stage: 6 }, { x: 2, y: 3, stage: 6 },
  { x: 12, y: 2, stage: 6 }, { x: 13, y: 2, stage: 6 },
  { x: 13, y: 11, stage: 6 }, { x: 13, y: 12, stage: 6 },
  { x: 2, y: 12, stage: 6 }, { x: 2, y: 13, stage: 6 },
  { x: 8, y: 13, stage: 6 }, { x: 7, y: 2, stage: 6 },
  { x: 8, y: 3, stage: 6 },
  // Stage 7: dense fractures & edge hits
  { x: 1, y: 2, stage: 7 }, { x: 7, y: 1, stage: 7 }, { x: 8, y: 1, stage: 7 },
  { x: 14, y: 1, stage: 7 }, { x: 13, y: 7, stage: 7 }, { x: 14, y: 8, stage: 7 },
  { x: 14, y: 12, stage: 7 }, { x: 9, y: 14, stage: 7 },
  { x: 1, y: 13, stage: 7 }, { x: 3, y: 8, stage: 7 }, { x: 2, y: 8, stage: 7 },
  { x: 9, y: 7, stage: 7, heavy: true },
  // Stage 8: shattering cross-fractures
  { x: 0, y: 1, stage: 8 }, { x: 5, y: 1, stage: 8 }, { x: 10, y: 2, stage: 8 },
  { x: 15, y: 8, stage: 8 }, { x: 14, y: 14, stage: 8 }, { x: 10, y: 14, stage: 8 },
  { x: 5, y: 13, stage: 8 }, { x: 4, y: 14, stage: 8 }, { x: 1, y: 8, stage: 8 },
  { x: 0, y: 9, stage: 8 }, { x: 4, y: 6, stage: 8 }, { x: 10, y: 11, stage: 8 },
  { x: 8, y: 6, stage: 8, heavy: true }, { x: 7, y: 11, stage: 8 },
  // Stage 9: critical fracture web across entire face
  { x: 1, y: 0, stage: 9 }, { x: 7, y: 0, stage: 9 }, { x: 14, y: 0, stage: 9 },
  { x: 15, y: 4, stage: 9 }, { x: 13, y: 5, stage: 9 }, { x: 15, y: 13, stage: 9 },
  { x: 11, y: 15, stage: 9 }, { x: 4, y: 15, stage: 9 }, { x: 0, y: 14, stage: 9 },
  { x: 0, y: 5, stage: 9 }, { x: 2, y: 5, stage: 9 }, { x: 6, y: 13, stage: 9 },
  { x: 12, y: 9, stage: 9 }, { x: 11, y: 5, stage: 9 }, { x: 5, y: 8, stage: 9, heavy: true },
  { x: 9, y: 10, stage: 9, heavy: true }, { x: 6, y: 5, stage: 9, heavy: true },
];

function createBreakStageTexture(stage: number): THREE.CanvasTexture {
  const tile = new PixelTile();
  const occupied = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const coreAlpha = clampByte(165 + stage * 9);
  const heavyAlpha = clampByte(200 + stage * 6);
  const rimAlpha = clampByte(48 + stage * 6);

  for (const px of CRACK_NETWORK) {
    if (px.stage > stage) continue;
    const isHeavy = px.heavy || (stage >= 6 && px.stage <= stage - 5);
    tile.set(px.x, px.y, rgb(14, 12, 10, isHeavy ? heavyAlpha : coreAlpha));
    occupied[px.y * TILE_SIZE + px.x] = 1;
  }

  // Subtle pale rim along cracks so they stand out on dark stone/bedrock as well as snow
  for (const px of CRACK_NETWORK) {
    if (px.stage > stage) continue;
    const rx = px.x + 1;
    const ry = px.y + 1;
    if (rx < TILE_SIZE && ry < TILE_SIZE && occupied[ry * TILE_SIZE + rx] === 0) {
      tile.blend(rx, ry, rgb(245, 240, 232, rimAlpha));
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = TILE_SIZE;
  canvas.height = TILE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to acquire 2D canvas context for break texture');
  }
  tile.blitTo(ctx, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = true;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Non-Block 16x16 Item Icon Painters (Materials, Foods, Tools, Armor)
// ---------------------------------------------------------------------------

interface TierPalette {
  readonly o: RGBA; // dark outline
  readonly d: RGBA; // shadow
  readonly m: RGBA; // midtone
  readonly l: RGBA; // highlight
  readonly s: RGBA; // specular glint / accent
}

const TOOL_TIER_PALETTES: Readonly<Record<'wood' | 'stone' | 'iron' | 'prismite', TierPalette>> = {
  wood: {
    o: hex(0x382110),
    d: hex(0x6e4826),
    m: hex(0x966b3e),
    l: hex(0xbd8f59),
    s: hex(0xd9b079),
  },
  stone: {
    o: hex(0x282b30),
    d: hex(0x555a61),
    m: hex(0x7c828a),
    l: hex(0xa2a8b0),
    s: hex(0xc8ced4),
  },
  iron: {
    o: hex(0x272d36),
    d: hex(0x67727d),
    m: hex(0xa4afb8),
    l: hex(0xd5dee6),
    s: hex(0xf5faff),
  },
  prismite: {
    o: hex(0x14333d),
    d: hex(0x22827e),
    m: hex(0x3ecbb9),
    l: hex(0x8ff7eb),
    s: hex(0xc494ff), // prism violet sheen!
  },
};

const HANDLE_PALETTE: Readonly<Record<string, RGBA>> = {
  H: hex(0x382110), // handle outline
  w: hex(0x6e4726), // handle dark
  W: hex(0x9e6f40), // handle light
  g: hex(0x5c361c), // grip wrap
};

const PICKAXE_TEMPLATE: readonly string[] = [
  '................',
  '......oooo......',
  '....oolllsoo....',
  '...olmmmmmmdo...',
  '...oooodmmdmo...',
  '........Hmdmo...',
  '.......HWomdo...',
  '......HWw.omo...',
  '.....HWw...oo...',
  '....HWw.........',
  '...HWw..........',
  '..HWw...........',
  '.HWw............',
  '.Hw.............',
  '.H..............',
  '................',
];

const AXE_TEMPLATE: readonly string[] = [
  '................',
  '.......oooo.....',
  '......olllso....',
  '.....olmmmmdo...',
  '.....olmmHmdo...',
  '......oodHWdo...',
  '.......oHWwo....',
  '......HWw.o.....',
  '.....HWw........',
  '....HWw.........',
  '...HWw..........',
  '..HWw...........',
  '.HWw............',
  '.Hw.............',
  '.H..............',
  '................',
];

const SHOVEL_TEMPLATE: readonly string[] = [
  '................',
  '...........ooo..',
  '..........olso..',
  '.........olmmdo.',
  '........olmmmdo.',
  '........ommmmdo.',
  '........omddoo..',
  '.......HWoo.....',
  '......HWw.......',
  '.....HWw........',
  '....HWw.........',
  '...HWw..........',
  '..HWw...........',
  '.HWw............',
  '.Hw.............',
  '................',
];

const SWORD_TEMPLATE: readonly string[] = [
  '................',
  '.............oo.',
  '............oso.',
  '...........olmo.',
  '..........olmdo.',
  '.........olmdo..',
  '........olmdo...',
  '.......olmdo....',
  '...oo.olmdo.....',
  '...ooolmdo......',
  '....ogmoo.......',
  '...HWWgo........',
  '..HWw.oo........',
  '.HWw............',
  '.gg.............',
  '................',
];

const HOE_TEMPLATE: readonly string[] = [
  '................',
  '.....oooooo.....',
  '....olllllso....',
  '...olmmmmmmdo...',
  '...ooodddHmdo...',
  '........HWwoo...',
  '.......HWw......',
  '......HWw.......',
  '.....HWw........',
  '....HWw.........',
  '...HWw..........',
  '..HWw...........',
  '.HWw............',
  '.Hw.............',
  '.H..............',
  '................',
];

function paintTool(
  tile: PixelTile,
  template: readonly string[],
  tier: 'wood' | 'stone' | 'iron' | 'prismite'
): void {
  const p = TOOL_TIER_PALETTES[tier];
  tile.drawPattern(template, {
    ...HANDLE_PALETTE,
    o: p.o,
    d: p.d,
    m: p.m,
    l: p.l,
    s: p.s,
  });
}

interface ArmorPalette {
  readonly o: RGBA;
  readonly d: RGBA;
  readonly m: RGBA;
  readonly l: RGBA;
  readonly b: RGBA; // buckle/trim accent
}

const ARMOR_PALETTES: Readonly<Record<'leather' | 'iron', ArmorPalette>> = {
  leather: {
    o: hex(0x361e10),
    d: hex(0x693d22),
    m: hex(0x945b35),
    l: hex(0xba7c4c),
    b: hex(0xdcb44a),
  },
  iron: {
    o: hex(0x252b33),
    d: hex(0x636e7a),
    m: hex(0x9faab5),
    l: hex(0xdbe4ec),
    b: hex(0x475059),
  },
};

const HELMET_TEMPLATE: readonly string[] = [
  '................',
  '................',
  '.....oooooo.....',
  '....olllllmo....',
  '...olllmmmmdo...',
  '...olmmmmmmdo...',
  '..oombbbbbbmoo..',
  '..ommdooodmdmo..',
  '..omdo....odmo..',
  '..omdo....odmo..',
  '..omdo....odmo..',
  '...oo......oo...',
  '................',
  '................',
  '................',
  '................',
];

const CHESTPLATE_TEMPLATE: readonly string[] = [
  '................',
  '..ooo......ooo..',
  '.olmo......omlo.',
  '.olmmooooooomlo.',
  '.olmmllllllmmlo.',
  '.ommmmmmmdmmmmo.',
  '..oommllmdmmoo..',
  '...ommmmdmmmo...',
  '...ommmmdmmmo...',
  '...ombbbbbbmo...',
  '...ommmmdmmmo...',
  '...ommmmdmmmo...',
  '...odddddmmmo...',
  '....oooooooo....',
  '................',
  '................',
];

const LEGGINGS_TEMPLATE: readonly string[] = [
  '................',
  '................',
  '...oooooooooo...',
  '...obbbllbbbo...',
  '...olmmmmmmmo...',
  '...olmmmdmmmo...',
  '...olmmd.dmmo...',
  '...olmmo.ommo...',
  '...olmmo.ommo...',
  '...ommmo.ommo...',
  '...ommmo.ommo...',
  '...ommmo.ommo...',
  '...odddo.oddo...',
  '...ooooo.oooo...',
  '................',
  '................',
];

const BOOTS_TEMPLATE: readonly string[] = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '..oooo....oooo..',
  '..olmo....omlo..',
  '..olmo....omlo..',
  '..obbo....obbo..',
  '..olmo....omlo..',
  '.oolmo....omloo.',
  '.olmmo....ommlo.',
  '.odddo....odddo.',
  '.ooooo....ooooo.',
  '................',
  '................',
];

function paintArmor(
  tile: PixelTile,
  template: readonly string[],
  tier: 'leather' | 'iron'
): void {
  const p = ARMOR_PALETTES[tier];
  tile.drawPattern(template, {
    o: p.o,
    d: p.d,
    m: p.m,
    l: p.l,
    b: p.b,
  });
}

const ITEM_ICON_PAINTERS: Readonly<Record<string, TilePainter>> = {
  // --- Materials & resources ---
  stick: (t) =>
    t.drawPattern(
      [
        '................',
        '................',
        '............oo..',
        '...........oLo..',
        '..........oLdo..',
        '.........oLdo...',
        '........oLdo....',
        '.......oLdo.....',
        '......oLdo......',
        '.....oLdo.......',
        '....oLdo........',
        '...oLdo.........',
        '..oLdo..........',
        '..odo...........',
        '..oo............',
        '................',
      ],
      { o: hex(0x3b2412), d: hex(0x6e4726), L: hex(0xa87948) }
    ),

  coal: (t) =>
    t.drawPattern(
      [
        '................',
        '................',
        '......oooo......',
        '....oohhhdoo....',
        '...ohhmmmdddo...',
        '..ohmmmmdddddo..',
        '..ommmddddkkdo..',
        '..ommdddkkkkdo..',
        '..omddddkkkkdo..',
        '...odddkkkkdo...',
        '...oddkkkkdo....',
        '....oodddoo.....',
        '......oooo......',
        '................',
        '................',
        '................',
      ],
      { o: hex(0x101216), k: hex(0x1c1f24), d: hex(0x2a2e36), m: hex(0x3e444f), h: hex(0x5b6270) }
    ),

  raw_iron: (t) =>
    t.drawPattern(
      [
        '................',
        '................',
        '.....ooooo......',
        '...oosssLLoo....',
        '..ossrLLGGsso...',
        '..osrrGGGGddso..',
        '..orrrGGddddso..',
        '..orrrddLLddso..',
        '...orrrLLGGdo...',
        '...osrrGGddo....',
        '....ossddoo.....',
        '.....ooooo......',
        '................',
        '................',
        '................',
        '................',
      ],
      {
        o: hex(0x2e2926),
        s: hex(0x696d73),
        d: hex(0x7c4e35),
        r: hex(0xa36e4d),
        L: hex(0xd19f79),
        G: hex(0xf0d2b4),
      }
    ),

  iron_ingot: (t) =>
    t.drawPattern(
      [
        '................',
        '................',
        '................',
        '.......oooo.....',
        '.....oollllo....',
        '....ollsssslo...',
        '...ollssllllmo..',
        '..ollmmllllmmdo.',
        '..ommmmmmmmdddo.',
        '..ommddddddddo..',
        '...oodddddddo...',
        '.....ooooooo....',
        '................',
        '................',
        '................',
        '................',
      ],
      { o: hex(0x293038), d: hex(0x6e7882), m: hex(0xa4afb8), l: hex(0xd4dde6), s: hex(0xf5faff) }
    ),

  raw_gold: (t) =>
    t.drawPattern(
      [
        '................',
        '................',
        '.....ooooo......',
        '...oosssGGoo....',
        '..ossyGGYYsso...',
        '..osyyYYYYddso..',
        '..oyyyYYddddso..',
        '..oyyyddGGddso..',
        '...oyyyGGYYdo...',
        '...osyyYYddo....',
        '....ossddoo.....',
        '.....ooooo......',
        '................',
        '................',
        '................',
        '................',
      ],
      {
        o: hex(0x362b14),
        s: hex(0x696d73),
        d: hex(0x946412),
        y: hex(0xc7921e),
        G: hex(0xf0c642),
        Y: hex(0xfff4a3),
      }
    ),

  gold_ingot: (t) =>
    t.drawPattern(
      [
        '................',
        '................',
        '................',
        '.......oooo.....',
        '.....oollllo....',
        '....ollsssslo...',
        '...ollssllllmo..',
        '..ollmmllllmmdo.',
        '..ommmmmmmmdddo.',
        '..ommddddddddo..',
        '...oodddddddo...',
        '.....ooooooo....',
        '................',
        '................',
        '................',
        '................',
      ],
      { o: hex(0x473008), d: hex(0xa67414), m: hex(0xd9a628), l: hex(0xf7d452), s: hex(0xfff7b8) }
    ),

  prismite_gem: (t) =>
    t.drawPattern(
      [
        '................',
        '.......oo.......',
        '......oSSo......',
        '.....oSllvo.....',
        '....oSllmmvo....',
        '...oSllmmmvVo...',
        '...oSlmmmmvVo...',
        '...oSlmmmvVVo...',
        '...oSmmmvVVdo...',
        '....ommvVVdo....',
        '....omdvVdo.....',
        '.....odddo......',
        '......odo.......',
        '.......o........',
        '................',
        '................',
      ],
      {
        o: hex(0x13333b),
        d: hex(0x1c7873),
        m: hex(0x39c9b8),
        l: hex(0x88faf0),
        S: hex(0xe3fffc),
        v: hex(0xa678f5),
        V: hex(0x6c42bd),
      }
    ),

  grain_seeds: (t) =>
    t.drawPattern(
      [
        '................',
        '................',
        '................',
        '......oo........',
        '.....olgo...oo..',
        '.....ogdo..olgo.',
        '......oo...ogdo.',
        '...oo.......oo..',
        '..olgo...oo.....',
        '..ogdo..olgo....',
        '...oo...ogdo....',
        '......oo.oo.....',
        '.....olgo.......',
        '.....ogdo.......',
        '......oo........',
        '................',
      ],
      { o: hex(0x36471f), d: hex(0x668538), g: hex(0x9cb854), l: hex(0xd9d679) }
    ),

  wheat: (t) =>
    t.drawPattern(
      [
        '................',
        '...........oo...',
        '.........oolYo..',
        '........olYGGoo.',
        '.......olYGGYlo.',
        '......olYGGYgo..',
        '.....olYGGggo...',
        '.....oGGggro....',
        '....oGgggrro....',
        '...oGgggrro.....',
        '..oGggddo.......',
        '..oggddo........',
        '.ogddo..........',
        '.oddo...........',
        '..oo............',
        '................',
      ],
      {
        o: hex(0x4a3914),
        d: hex(0x8a702c),
        g: hex(0xb5963a),
        G: hex(0xdcb844),
        Y: hex(0xf7df74),
        l: hex(0xfff3ab),
        r: hex(0xb83b32),
      }
    ),

  leather: (t) =>
    t.drawPattern(
      [
        '................',
        '................',
        '...ooo....ooo...',
        '..ollmooommllo..',
        '...olmmmmmmmo...',
        '...ommmmmmmmo...',
        '..olmmmmmmmdmo..',
        '..olmmmmmddmmo..',
        '..ommmmmddmmmo..',
        '...ommmmdmmmo...',
        '...ommmmmmmdo...',
        '..olmmddmmmddo..',
        '..ooodooodddoo..',
        '.....oo...oo....',
        '................',
        '................',
      ],
      { o: hex(0x381f10), d: hex(0x6e4023), m: hex(0x995e36), l: hex(0xbd7f4f) }
    ),

  wool: (t) =>
    t.drawPattern(
      [
        '................',
        '................',
        '.....oooooo.....',
        '...oolllllloo...',
        '..ollwwwwwllmo..',
        '..olwwwwwwlmmo..',
        '.olwwwllwwwlmmo.',
        '.olwwlmmwwllmmo.',
        '.olwwwwwwllmmmo.',
        '..olllllllmmmo..',
        '..ommlmmmmmdmo..',
        '...ommmmmddmo...',
        '....oodddddo....',
        '......ooooo.....',
        '................',
        '................',
      ],
      { o: hex(0x5c564c), d: hex(0xa89f91), m: hex(0xc9c0b1), l: hex(0xe3dcd0), w: hex(0xf7f4ed) }
    ),

  feather: (t) =>
    t.drawPattern(
      [
        '................',
        '...........ooo..',
        '.........oolwwo.',
        '........olwwwwo.',
        '.......olwwwlmo.',
        '......olwwlrmo..',
        '.....olwwlrmo...',
        '....olwwlrmo....',
        '....olwlrmo.....',
        '...olwlrmo......',
        '...ooolmo.......',
        '....oqoo........',
        '...oqo..........',
        '..oqo...........',
        '..oo............',
        '................',
      ],
      {
        o: hex(0x473d34),
        q: hex(0xc9bda9),
        m: hex(0xbfb5a6),
        l: hex(0xe0d8cb),
        w: hex(0xfaf7f0),
        r: hex(0xc98b57),
      }
    ),

  bone: (t) =>
    t.drawPattern(
      [
        '................',
        '..........ooo...',
        '.........ollwo..',
        '.........olwwoo.',
        '........oolwwwo.',
        '.......olwwmmo..',
        '......olwwmmo...',
        '.....olwwmmo....',
        '....olwwmmo.....',
        '...olwwmmo......',
        '..oolwmmo.......',
        '.olwwmoo........',
        '.olwwo..........',
        '..ommo..........',
        '...oo...........',
        '................',
      ],
      { o: hex(0x4a463e), m: hex(0xb5ae9e), l: hex(0xd9d3c3), w: hex(0xf5f2e9) }
    ),

  silk_thread: (t) =>
    t.drawPattern(
      [
        '................',
        '................',
        '.....oooooo.....',
        '....owwwwwwo....',
        '...owllmmllwo...',
        '...owlmmmmwlo...',
        '..oowwllmmwwoo..',
        '..owlmmwwllmlo..',
        '..owlmwllmwmlo..',
        '...owllllmmwo...',
        '...ommmllmmwo...',
        '....owwmmwwo....',
        '.....oooomo.....',
        '........omo.....',
        '.........oo.....',
        '................',
      ],
      { o: hex(0x494457), m: hex(0xa9a2bd), l: hex(0xd2cce3), w: hex(0xf2effa) }
    ),

  bonemeal: (t) =>
    t.drawPattern(
      [
        '................',
        '................',
        '................',
        '................',
        '.......oo.......',
        '.....oolloo.....',
        '....olwwwwlo....',
        '...olwwllwwlo...',
        '..olwwlmmllwlo..',
        '..olwwmllmwllo..',
        '.oolmllwwllmloo.',
        '.ommmmmllmmmdmo.',
        '..oooooooooooo..',
        '...oo......oo...',
        '................',
        '................',
      ],
      { o: hex(0x6e695e), d: hex(0xb8b1a2), m: hex(0xd4cec0), l: hex(0xe8e3d8), w: hex(0xfcfaf5) }
    ),

  arrow: (t) =>
    t.drawPattern(
      [
        '................',
        '...........ooo..',
        '..........ollso.',
        '..........omlso.',
        '.........omddo..',
        '........oWooo...',
        '.......oWdo.....',
        '......oWdo......',
        '.....oWdo.......',
        '....oWdo........',
        '..ooWdo.........',
        '.ofrWdo.........',
        '.offrdoo........',
        '..ofrffo........',
        '...oooff........',
        '................',
      ],
      {
        o: hex(0x2e261f),
        s: hex(0xe3ebf2),
        l: hex(0xb4bfc9),
        m: hex(0x7c868f),
        d: hex(0x634122),
        W: hex(0xa37443),
        f: hex(0xf2ece1),
        r: hex(0xc7443a),
      }
    ),

  // --- Foods ---
  apple: (t) =>
    t.drawPattern(
      [
        '................',
        '........oo......',
        '.......oSogoo...',
        '........oSgLgo..',
        '....ooooSoooo...',
        '...orRRRrrRdro..',
        '..orRssRRrrrddo.',
        '..orRsRRRrrrddo.',
        '..orRRRRrrrrddo.',
        '..orRRRRrrrrddo.',
        '..oorRRRrrrddoo.',
        '...orRRrrrrddo..',
        '...oorrrrrddo...',
        '....ooooddoo....',
        '......oooo......',
        '................',
      ],
      {
        o: hex(0x3b1313),
        S: hex(0x6b4523),
        g: hex(0x467a2e),
        L: hex(0x7cb34d),
        d: hex(0x8a1c1c),
        r: hex(0xbd2a28),
        R: hex(0xe34239),
        s: hex(0xffa899),
      }
    ),

  bread: (t) =>
    t.drawPattern(
      [
        '................',
        '................',
        '................',
        '.....oooooo.....',
        '...oolllllloo...',
        '..ollmmgmmllmo..',
        '.olmmgmmmgmmlmo.',
        '.ommggmmmggmmmo.',
        '.ommmmmmmmmmdmo.',
        '.omdddddddddmmo.',
        '..oddddddddddo..',
        '...oooooooooo...',
        '................',
        '................',
        '................',
        '................',
      ],
      { o: hex(0x472a10), d: hex(0x875623), g: hex(0x9e672b), m: hex(0xc48b41), l: hex(0xe6b96c) }
    ),

  raw_pork: (t) =>
    t.drawPattern(
      [
        '................',
        '................',
        '......ooooo.....',
        '....oofFFffo....',
        '...ofFpppppfo...',
        '..ofFppRRpppfo..',
        '..ofppRRRppffo..',
        '..ofppRRppffo...',
        '..ofppppppfo....',
        '...ofppppfo.....',
        '....ofppfo......',
        '.....oooo.......',
        '................',
        '................',
        '................',
        '................',
      ],
      { o: hex(0x522124), R: hex(0xc44b52), p: hex(0xe37c80), f: hex(0xf2b3b0), F: hex(0xfce3de) }
    ),

  cooked_pork: (t) =>
    t.drawPattern(
      [
        '................',
        '................',
        '......ooooo.....',
        '....oohHHhho....',
        '...ohHmmmmmho...',
        '..ohHmmddmmmho..',
        '..ohmmdddmmdho..',
        '..ohmmddmmddo...',
        '..ohmmdmmmmo....',
        '...ohmmmmmo.....',
        '....ohmmmo......',
        '.....oooo.......',
        '................',
        '................',
        '................',
        '................',
      ],
      { o: hex(0x36190c), d: hex(0x5e2c15), m: hex(0x8f4924), h: hex(0xb86839), H: hex(0xdca06c) }
    ),

  raw_mutton: (t) =>
    t.drawPattern(
      [
        '................',
        '................',
        '.........ooo....',
        '........owwwo...',
        '......ooowwbo...',
        '....oorRRbboo...',
        '...orRRRrrfo....',
        '..orRRpRRrfo....',
        '..orRppRRrfo....',
        '..orrRRRRrfo....',
        '...orrrrrfo.....',
        '....ooffoo......',
        '.....oooo.......',
        '................',
        '................',
        '................',
      ],
      { o: hex(0x4d1d22), r: hex(0x9e323b), R: hex(0xc94954), p: hex(0xe67c84), f: hex(0xf5c8c4), b: hex(0xc9bfa8), w: hex(0xf5f0e4) }
    ),

  cooked_mutton: (t) =>
    t.drawPattern(
      [
        '................',
        '................',
        '.........ooo....',
        '........owwwo...',
        '......ooowwbo...',
        '....oomMMbboo...',
        '...omMMMmmho....',
        '..omMMdMMmho....',
        '..omMddMMmho....',
        '..ommMMMMmho....',
        '...ommmmmho.....',
        '....oohhoo......',
        '.....oooo.......',
        '................',
        '................',
        '................',
      ],
      { o: hex(0x381a0d), d: hex(0x592914), m: hex(0x824222), M: hex(0xa85b32), h: hex(0xcf824e), b: hex(0xc4b9a1), w: hex(0xf2ece0) }
    ),

  raw_fowl: (t) =>
    t.drawPattern(
      [
        '................',
        '................',
        '......ooooo.....',
        '....oopPPPpo....',
        '...opPPssPPpo...',
        '...opPPPPPPpo...',
        '...opPPppPPpo...',
        '....oppppppo....',
        '....oopppoo.....',
        '......oBBo......',
        '......oBbo......',
        '.....oBBbbo.....',
        '......oooo......',
        '................',
        '................',
        '................',
      ],
      { o: hex(0x5e3c35), p: hex(0xd4968a), P: hex(0xebb5a7), s: hex(0xfce0d7), B: hex(0xf2ece1), b: hex(0xc9bfa8) }
    ),

  cooked_fowl: (t) =>
    t.drawPattern(
      [
        '................',
        '................',
        '......ooooo.....',
        '....oogGGGgo....',
        '...ogGGssGGgo...',
        '...ogGGGGGGgo...',
        '...ogGGddGGgo...',
        '....ogddddgo....',
        '....oodddoo.....',
        '......oBBo......',
        '......oBbo......',
        '.....oBBbbo.....',
        '......oooo......',
        '................',
        '................',
        '................',
      ],
      { o: hex(0x3d200d), d: hex(0x874b1e), g: hex(0xb56d2f), G: hex(0xd99245), s: hex(0xf7cc83), B: hex(0xf2ece1), b: hex(0xc4b89f) }
    ),

  rotten_flesh: (t) =>
    t.drawPattern(
      [
        '................',
        '................',
        '.....ooooo......',
        '....ogGGggo.....',
        '...ogGrrgggo....',
        '...oggrrGGgo....',
        '..ooggGrrggo....',
        '..ogGgrrdggo....',
        '...oggddggo.....',
        '...ooggddoo.....',
        '....oggddo......',
        '.....odddo......',
        '......ooo.......',
        '................',
        '................',
        '................',
      ],
      { o: hex(0x282e1e), d: hex(0x475237), g: hex(0x64734d), G: hex(0x859467), r: hex(0x8c5a46) }
    ),

  // --- Tools (20 tiered + bow) ---
  wood_pickaxe: (t) => paintTool(t, PICKAXE_TEMPLATE, 'wood'),
  wood_axe: (t) => paintTool(t, AXE_TEMPLATE, 'wood'),
  wood_shovel: (t) => paintTool(t, SHOVEL_TEMPLATE, 'wood'),
  wood_sword: (t) => paintTool(t, SWORD_TEMPLATE, 'wood'),
  wood_hoe: (t) => paintTool(t, HOE_TEMPLATE, 'wood'),

  stone_pickaxe: (t) => paintTool(t, PICKAXE_TEMPLATE, 'stone'),
  stone_axe: (t) => paintTool(t, AXE_TEMPLATE, 'stone'),
  stone_shovel: (t) => paintTool(t, SHOVEL_TEMPLATE, 'stone'),
  stone_sword: (t) => paintTool(t, SWORD_TEMPLATE, 'stone'),
  stone_hoe: (t) => paintTool(t, HOE_TEMPLATE, 'stone'),

  iron_pickaxe: (t) => paintTool(t, PICKAXE_TEMPLATE, 'iron'),
  iron_axe: (t) => paintTool(t, AXE_TEMPLATE, 'iron'),
  iron_shovel: (t) => paintTool(t, SHOVEL_TEMPLATE, 'iron'),
  iron_sword: (t) => paintTool(t, SWORD_TEMPLATE, 'iron'),
  iron_hoe: (t) => paintTool(t, HOE_TEMPLATE, 'iron'),

  prismite_pickaxe: (t) => paintTool(t, PICKAXE_TEMPLATE, 'prismite'),
  prismite_axe: (t) => paintTool(t, AXE_TEMPLATE, 'prismite'),
  prismite_shovel: (t) => paintTool(t, SHOVEL_TEMPLATE, 'prismite'),
  prismite_sword: (t) => paintTool(t, SWORD_TEMPLATE, 'prismite'),
  prismite_hoe: (t) => paintTool(t, HOE_TEMPLATE, 'prismite'),

  bow: (t) =>
    t.drawPattern(
      [
        '................',
        '.......ooooo....',
        '.....oolWWWoo...',
        '....olWdoooso...',
        '...olWdo..s.....',
        '..olGdo..s......',
        '..oGdo..s.......',
        '.olWo..s........',
        '.oWdo.s.........',
        '.oWdos..........',
        '.oWos...........',
        '.oWso...........',
        '.oWo............',
        '..oo............',
        '................',
        '................',
      ],
      {
        o: hex(0x382110),
        d: hex(0x694222),
        G: hex(0x523118),
        W: hex(0xa87444),
        l: hex(0xc79563),
        s: hex(0xe6e1d5),
      }
    ),

  // --- Armor (Leather & Iron) ---
  leather_helmet: (t) => paintArmor(t, HELMET_TEMPLATE, 'leather'),
  leather_chestplate: (t) => paintArmor(t, CHESTPLATE_TEMPLATE, 'leather'),
  leather_leggings: (t) => paintArmor(t, LEGGINGS_TEMPLATE, 'leather'),
  leather_boots: (t) => paintArmor(t, BOOTS_TEMPLATE, 'leather'),

  iron_helmet: (t) => paintArmor(t, HELMET_TEMPLATE, 'iron'),
  iron_chestplate: (t) => paintArmor(t, CHESTPLATE_TEMPLATE, 'iron'),
  iron_leggings: (t) => paintArmor(t, LEGGINGS_TEMPLATE, 'iron'),
  iron_boots: (t) => paintArmor(t, BOOTS_TEMPLATE, 'iron'),
};

function paintFallbackIcon(tile: PixelTile): void {
  tile.fill(hex(0x6e6253));
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      if (x === 0 || y === 0 || x === 15 || y === 15) {
        tile.set(x, y, hex(0x3d342b));
      } else if (((x >> 2) + (y >> 2)) % 2 === 0) {
        tile.set(x, y, hex(0x9c8b75));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// TextureAtlas Public Class
// ---------------------------------------------------------------------------

const ICON_OUTPUT_SIZE = 32;
const BREAK_STAGE_COUNT = 10;

export class TextureAtlas {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  readonly breakTextures: THREE.CanvasTexture[];

  private readonly tileIndexByName = new Map<string, number>();
  private readonly iconCache = new Map<string, string>();

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = ATLAS_WIDTH;
    this.canvas.height = ATLAS_HEIGHT;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to acquire 2D canvas context for TextureAtlas');
    }
    ctx.clearRect(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT);

    // Paint every registered tile into its 16x16 slot in the 8x8 atlas
    for (let idx = 0; idx < ATLAS_TILES.length; idx++) {
      const name = ATLAS_TILES[idx];
      this.tileIndexByName.set(name, idx);

      const col = idx % ATLAS_COLS;
      const row = Math.floor(idx / ATLAS_COLS);
      const tile = new PixelTile();
      TILE_PAINTERS[name](tile);
      tile.blitTo(ctx, col * TILE_SIZE, row * TILE_SIZE);
    }

    const texture = new THREE.CanvasTexture(this.canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = true;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    this.texture = texture;

    // Generate 10 progressive break-crack overlay textures
    const breakTextures: THREE.CanvasTexture[] = [];
    for (let stage = 0; stage < BREAK_STAGE_COUNT; stage++) {
      breakTextures.push(createBreakStageTexture(stage));
    }
    this.breakTextures = breakTextures;
  }

  /**
   * Returns a cached 32x32 crisp nearest-neighbor PNG data URL for any block tile name
   * or non-block item icon key defined in src/registry/items.ts.
   */
  getItemIcon(iconKey: string): string {
    const cached = this.iconCache.get(iconKey);
    if (cached !== undefined) {
      return cached;
    }

    const outCanvas = document.createElement('canvas');
    outCanvas.width = ICON_OUTPUT_SIZE;
    outCanvas.height = ICON_OUTPUT_SIZE;
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) {
      throw new Error('Failed to acquire 2D canvas context for item icon');
    }
    outCtx.imageSmoothingEnabled = false;

    const tileIdx = this.tileIndexByName.get(iconKey);
    if (tileIdx !== undefined) {
      const col = tileIdx % ATLAS_COLS;
      const row = Math.floor(tileIdx / ATLAS_COLS);
      outCtx.drawImage(
        this.canvas,
        col * TILE_SIZE,
        row * TILE_SIZE,
        TILE_SIZE,
        TILE_SIZE,
        0,
        0,
        ICON_OUTPUT_SIZE,
        ICON_OUTPUT_SIZE
      );
    } else {
      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = TILE_SIZE;
      srcCanvas.height = TILE_SIZE;
      const srcCtx = srcCanvas.getContext('2d');
      if (!srcCtx) {
        throw new Error('Failed to acquire 2D canvas context for procedural item icon');
      }

      const tile = new PixelTile();
      const painter = ITEM_ICON_PAINTERS[iconKey];
      if (painter) {
        painter(tile);
      } else {
        paintFallbackIcon(tile);
      }
      tile.blitTo(srcCtx, 0, 0);
      outCtx.drawImage(srcCanvas, 0, 0, TILE_SIZE, TILE_SIZE, 0, 0, ICON_OUTPUT_SIZE, ICON_OUTPUT_SIZE);
    }

    const url = outCanvas.toDataURL('image/png');
    this.iconCache.set(iconKey, url);
    return url;
  }

  dispose(): void {
    this.texture.dispose();
    for (const tex of this.breakTextures) {
      tex.dispose();
    }
    this.iconCache.clear();
  }
}
