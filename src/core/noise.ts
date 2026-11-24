import { SeededRNG } from './rng';

const GRAD2: ReadonlyArray<readonly [number, number]> = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

const GRAD3: ReadonlyArray<readonly [number, number, number]> = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Deterministic 2D & 3D gradient Perlin noise with fBM helpers.
 * Zero external dependencies and guaranteed deterministic per seed.
 */
export class NoiseGenerator {
  private readonly perm: Uint8Array;

  constructor(seed: number) {
    const rng = new SeededRNG(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
    }
  }

  noise2D(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const X = xi & 255;
    const Y = yi & 255;
    const xf = x - xi;
    const yf = y - yi;
    const u = fade(xf);
    const v = fade(yf);

    const p = this.perm;
    const aa = p[p[X] + Y] & 7;
    const ab = p[p[X] + Y + 1] & 7;
    const ba = p[p[X + 1] + Y] & 7;
    const bb = p[p[X + 1] + Y + 1] & 7;

    const gAA = GRAD2[aa];
    const gBA = GRAD2[ba];
    const gAB = GRAD2[ab];
    const gBB = GRAD2[bb];

    const n00 = gAA[0] * xf + gAA[1] * yf;
    const n10 = gBA[0] * (xf - 1) + gBA[1] * yf;
    const n01 = gAB[0] * xf + gAB[1] * (yf - 1);
    const n11 = gBB[0] * (xf - 1) + gBB[1] * (yf - 1);

    return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
  }

  noise3D(x: number, y: number, z: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const X = xi & 255;
    const Y = yi & 255;
    const Z = zi & 255;
    const xf = x - xi;
    const yf = y - yi;
    const zf = z - zi;
    const u = fade(xf);
    const v = fade(yf);
    const w = fade(zf);

    const p = this.perm;
    const A = p[X] + Y;
    const AA = p[A] + Z;
    const AB = p[A + 1] + Z;
    const B = p[X + 1] + Y;
    const BA = p[B] + Z;
    const BB = p[B + 1] + Z;

    const dot = (hash: number, dx: number, dy: number, dz: number): number => {
      const g = GRAD3[hash % 12];
      return g[0] * dx + g[1] * dy + g[2] * dz;
    };

    const x00 = lerp(dot(p[AA], xf, yf, zf), dot(p[BA], xf - 1, yf, zf), u);
    const x10 = lerp(dot(p[AB], xf, yf - 1, zf), dot(p[BB], xf - 1, yf - 1, zf), u);
    const x01 = lerp(dot(p[AA + 1], xf, yf, zf - 1), dot(p[BA + 1], xf - 1, yf, zf - 1), u);
    const x11 = lerp(dot(p[AB + 1], xf, yf - 1, zf - 1), dot(p[BB + 1], xf - 1, yf - 1, zf - 1), u);

    return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
  }

  fbm2D(x: number, y: number, octaves = 4, persistence = 0.5, lacunarity = 2.0): number {
    let total = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxAmp = 0;
    for (let i = 0; i < octaves; i++) {
      total += this.noise2D(x * frequency, y * frequency) * amplitude;
      maxAmp += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }
    return total / maxAmp;
  }

  fbm3D(x: number, y: number, z: number, octaves = 3, persistence = 0.5, lacunarity = 2.0): number {
    let total = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxAmp = 0;
    for (let i = 0; i < octaves; i++) {
      total += this.noise3D(x * frequency, y * frequency, z * frequency) * amplitude;
      maxAmp += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }
    return total / maxAmp;
  }
}
