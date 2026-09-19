/**
 * turf-material.ts — procedural fine-mown turf maps for the lawn surface.
 *
 * Replaces the current bright marbled lawn look (flat PAL.lawn fill + soft
 * radial blotches, see materials.ts) with a muted, fine-grained mown-turf
 * read: olive/brown blade-scale variation, one axis of soft wide mow bands,
 * and a modest baked normal that stays moire-free under trilinear mips at
 * gameplay range.
 *
 * Wiring contract (materials.ts owns the material):
 * the lawn material is built as
 *   wetStd({ map, roughness: 1, roughnessMap, normalMap, normalScale 0.4 }, 0.5)
 * Swapping ONLY the three texture bindings `lawnTex` / `lawnRough` /
 * `lawnNormal` for the fields of `createTurfTextures()` preserves every
 * wetStd behavior: the roughness map stores ABSOLUTE roughness (~0.94, like
 * the current `R(0.95)` canvas), the material keeps `roughness: 1` so map
 * texels stay absolute, and the WETNESS node keeps multiplying it at k=0.5.
 * Three.js reads roughnessMap from the GREEN channel, so every channel here
 * carries the same value (same convention as the grayscale canvas it replaces).
 * `buildMaterials()` registers one disposer for this whole set and passes
 * `ownMaps=false` to the lawn wetStd call, so the three maps have one teardown
 * owner and the cache cannot return disposed textures after a rebuild.
 *
 * Determinism: every value is a pure function of (x, y, SEED) through an
 * integer hash — no Math.random(), no Date, no DOM/canvas. Identical bytes on
 * every machine and every launch. Generation happens ONCE at factory call
 * (scene build time); nothing allocates per frame, no geometry/draw/light is
 * added, and the map slots already exist on the lawn material, so the shader
 * program count does not change.
 *
 * Colours: anchors come from PAL (lawn / lawnLight / dirt); the muted base
 * and dry-blade tones are interpolations, so the surface stays inside the
 * authored palette families. No external assets; the PolyHaven sparse_grass
 * set stays rejected (it read as bare soil, 2026-09-17).
 */
import * as THREE from 'three';
import { PAL } from './palette';

/** Fixed module seed ('turf'). Change = new deterministic world. */
const SEED = 0x74757266;

const ALBEDO_SIZE = 512;
const DETAIL_SIZE = 256;
/** ground.ts uses UV_LAWN=96 world metres per UV: 48 repeats = a 2m tile. */
const REPEAT = 48;

// ---- surface design constants (one candidate; tune here only) -------------
const MOW_BANDS = 4; // four 0.5m bands per 2m tile
const BAND_LIFT = 0.07; // +/- luminance of a mow band
const BAND_HUE = 0.1; // light band pulls toward lawnLight by this much
const DRY_MEAN = 0.24; // mean dry-blade mix (0..1 toward the dry tone)
const DRY_CAP = 0.62; // never full soil: green coverage everywhere, no bald patches
const LUM_CLUMP = 0.08; // +/- luminance from ~0.28 m tuft-scale noise
const LUM_MID = 0.05; // +/- luminance from ~9 cm patches
const LUM_GRAIN = 0.045; // +/- luminance from ~1.56 cm grain (kills the smooth read)
const ROUGH_BASE = 0.94; // absolute matte, mirrors the old 0.95/0.92 scheme, softer
const ROUGH_GRAIN = 0.02; // +/- blade-scale roughness
const ROUGH_MID = 0.03; // +/- patch-scale roughness
const ROUGH_BAND = 0.03; // light (laid-over) stripe reads slightly smoother
const NORMAL_STRENGTH = 1.0; // height-field slope multiplier (RMS slope ~0.20: modest)
const NORMAL_SLOPE_CLAMP = 0.35; // max baked xy slope; modest => no moire

type RGB = [number, number, number];

/** Per-channel sRGB lerp of two packed hex anchors (muted authored ramp, small range). */
function channelMix(aHex: number, bHex: number, t: number): RGB {
  const a: RGB = [(aHex >>> 16) & 255, (aHex >>> 8) & 255, aHex & 255];
  const b: RGB = [(bHex >>> 16) & 255, (bHex >>> 8) & 255, bHex & 255];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Muted base green: the palette lawn pulled toward dirt so it stops glowing. */
const BASE: RGB = channelMix(PAL.lawn, PAL.dirt, 0.18);
/** Dry olive-brown blade tone, still green-dominant at DRY_CAP. */
const DRY: RGB = channelMix(PAL.lawnLight, PAL.dirt, 0.62);
/** Palette light-stripe anchor. */
const LIGHT: RGB = [(PAL.lawnLight >>> 16) & 255, (PAL.lawnLight >>> 8) & 255, PAL.lawnLight & 255];

/** 32-bit integer hash -> [0,1). Pure, machine-independent. */
function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ seed) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Tileable value noise: `period` integer cycles across the tile, quintic fade. */
function vnoise(px: number, py: number, period: number, seed: number): number {
  const xi = Math.floor(px);
  const yi = Math.floor(py);
  const fx = px - xi;
  const fy = py - yi;
  const qx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const qy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const w = (n: number): number => ((n % period) + period) % period;
  const x0 = w(xi);
  const x1 = w(xi + 1);
  const y0 = w(yi);
  const y1 = w(yi + 1);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * qx + (c - a) * qy + (a - b - c + d) * qx * qy;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** Soft mow-band profile on u: integer sine periods, seamless by construction. */
function bandAt(u: number): number {
  const phase = 2 * Math.PI * MOW_BANDS * u;
  return 0.5 + 0.5 * Math.sin(phase);
}

// Octave seeds are distinct so editing one layer never shifts the others.
const SEED_CLUMP = SEED ^ 0x11;
const SEED_MID = SEED ^ 0x2b;
const SEED_FINE = SEED ^ 0x57;
const SEED_GRAIN = SEED ^ 0x7f;

/**
 * Albedo, sRGB-encoded bytes (texture declares SRGBColorSpace so the GPU
 * decodes once at sample time). Blending happens on the encoded values, which
 * is fine for a muted authored ramp of this range.
 */
function albedoData(): Uint8Array {
  const s = ALBEDO_SIZE;
  const data = new Uint8Array(s * s * 4);
  for (let y = 0; y < s; y++) {
    const v = (y + 0.5) / s;
    for (let x = 0; x < s; x++) {
      const u = (x + 0.5) / s;
      const clump = vnoise(u * 8, v * 8, 8, SEED_CLUMP);
      const mid = vnoise(u * 24, v * 24, 24, SEED_MID);
      const fine = vnoise(u * 64, v * 64, 64, SEED_FINE);
      const grain = vnoise(u * 128, v * 128, 128, SEED_GRAIN);
      const band = bandAt(u);

      let dry =
        DRY_MEAN +
        0.42 * (fine - 0.5) * 2 +
        0.3 * (mid - 0.5) * 2 +
        0.2 * (clump - 0.5) * 2;
      dry = Math.max(0, Math.min(1, dry)) * DRY_CAP;

      const lift =
        LUM_CLUMP * (clump - 0.5) * 2 +
        LUM_MID * (mid - 0.5) * 2 +
        LUM_GRAIN * (grain - 0.5) * 2 +
        BAND_LIFT * (band - 0.5) * 2;

      let r = BASE[0] + (DRY[0] - BASE[0]) * dry;
      let g = BASE[1] + (DRY[1] - BASE[1]) * dry;
      let b = BASE[2] + (DRY[2] - BASE[2]) * dry;

      const hue = BAND_HUE * (band - 0.5) * 2;
      r += (LIGHT[0] - r) * hue;
      g += (LIGHT[1] - g) * hue;
      b += (LIGHT[2] - b) * hue;

      r *= 1 + lift;
      g *= 1 + lift;
      b *= 1 + lift;

      const k = (y * s + x) * 4;
      data[k] = clampByte(r);
      data[k + 1] = clampByte(g);
      data[k + 2] = clampByte(b);
      data[k + 3] = 255;
    }
  }
  return data;
}

/** Absolute roughness in ALL four channels (three samples the .g channel). */
function roughnessData(): Uint8Array {
  const s = DETAIL_SIZE;
  const data = new Uint8Array(s * s * 4);
  for (let y = 0; y < s; y++) {
    const v = (y + 0.5) / s;
    for (let x = 0; x < s; x++) {
      const u = (x + 0.5) / s;
      const clump = vnoise(u * 8, v * 8, 8, SEED_CLUMP);
      const mid = vnoise(u * 24, v * 24, 24, SEED_MID);
      const fine = vnoise(u * 64, v * 64, 64, SEED_FINE);
      const band = bandAt(u);
      const r =
        ROUGH_BASE +
        ROUGH_MID * (mid - 0.5) * 2 +
        ROUGH_GRAIN * (fine - 0.5) * 2 -
        ROUGH_BAND * (band - 0.5) * 2 +
        0.012 * (clump - 0.5) * 2;
      const b = clampByte(r * 255);
      const k = (y * s + x) * 4;
      data[k] = b;
      data[k + 1] = b;
      data[k + 2] = b;
      data[k + 3] = b;
    }
  }
  return data;
}

/**
 * Tangent-space normal map from a wrapped height field (toroidal central
 * differences, so any RepeatWrapping factor tiles). Slopes are clamped and
 * modest: the fine nap is there for grazing angles, not for silhouettes,
 * which keeps mip-minified normal variation from shimmering (moire).
 */
function normalData(): Uint8Array {
  const s = DETAIL_SIZE;
  const h = new Float32Array(s * s);
  for (let y = 0; y < s; y++) {
    const v = (y + 0.5) / s;
    for (let x = 0; x < s; x++) {
      const u = (x + 0.5) / s;
      const clump = vnoise(u * 8, v * 8, 8, SEED_CLUMP);
      const fine = vnoise(u * 64, v * 64, 64, SEED_FINE);
      const grain = vnoise(u * 128, v * 128, 128, SEED_GRAIN);
      h[y * s + x] = 0.15 * clump + 0.55 * fine + 0.3 * grain;
    }
  }
  const data = new Uint8Array(s * s * 4);
  const clamp2 = NORMAL_SLOPE_CLAMP * NORMAL_SLOPE_CLAMP;
  for (let y = 0; y < s; y++) {
    const yn = (y + s - 1) % s;
    const yp = (y + 1) % s;
    for (let x = 0; x < s; x++) {
      const xn = (x + s - 1) % s;
      const xp = (x + 1) % s;
      let nx = -(h[y * s + xp] - h[y * s + xn]) * NORMAL_STRENGTH;
      let ny = -(h[yp * s + x] - h[yn * s + x]) * NORMAL_STRENGTH;
      const m2 = nx * nx + ny * ny;
      if (m2 > clamp2) {
        const f = NORMAL_SLOPE_CLAMP / Math.sqrt(m2);
        nx *= f;
        ny *= f;
      }
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const k = (y * s + x) * 4;
      data[k] = clampByte((nx * 0.5 + 0.5) * 255);
      data[k + 1] = clampByte((ny * 0.5 + 0.5) * 255);
      data[k + 2] = clampByte((nz * 0.5 + 0.5) * 255);
      data[k + 3] = 255;
    }
  }
  return data;
}

/** Mirrors materials.ts tex()/dataTex() conventions on a DataTexture. */
function dataTexture(
  data: Uint8Array,
  size: number,
  srgb: boolean,
  anisotropy: number,
): THREE.DataTexture {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(REPEAT, REPEAT);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  // Match the CanvasTexture UV orientation replaced by this candidate.
  t.flipY = true;
  t.anisotropy = anisotropy;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

export interface TurfTextureSet {
  /** Albedo, sRGB, 512x512, repeat 48 (2m tile at UV_LAWN=96). */
  lawnTex: THREE.DataTexture;
  /** Absolute roughness (~0.94 matte), all channels equal, 256x256, repeat 48. */
  lawnRough: THREE.DataTexture;
  /** Tangent-space normal, slopes clamped to +/-0.35, 256x256, repeat 48. */
  lawnNormal: THREE.DataTexture;
}

let cached: TurfTextureSet | null = null;

/** Build (once) the turf texture set. Cached: later calls return the same set. */
export function createTurfTextures(): TurfTextureSet {
  if (cached) return cached;
  cached = {
    lawnTex: dataTexture(albedoData(), ALBEDO_SIZE, true, 8),
    lawnRough: dataTexture(roughnessData(), DETAIL_SIZE, false, 4),
    lawnNormal: dataTexture(normalData(), DETAIL_SIZE, false, 4),
  };
  return cached;
}

/** Free GPU resources and drop the cache. Safe to call more than once. */
export function disposeTurfTextures(set: TurfTextureSet): void {
  set.lawnTex.dispose();
  set.lawnRough.dispose();
  set.lawnNormal.dispose();
  if (cached === set) cached = null;
}

export interface TurfTextureStats {
  albedo: { size: number; bytes: number; colorSpace: string };
  roughness: { size: number; bytes: number; colorSpace: string };
  normal: { size: number; bytes: number; colorSpace: string };
  /** CPU-side texel bytes for the three maps. */
  cpuBytes: number;
  /** GPU-side estimate including a full mip chain (4/3x). */
  gpuBytesWithMips: number;
  repeat: number;
  deterministicSeed: number;
}

export function turfTextureStats(set: TurfTextureSet): TurfTextureStats {
  const entry = (t: THREE.DataTexture, size: number) => ({
    size,
    bytes: size * size * 4,
    colorSpace: t.colorSpace,
  });
  const albedo = entry(set.lawnTex, ALBEDO_SIZE);
  const roughness = entry(set.lawnRough, DETAIL_SIZE);
  const normal = entry(set.lawnNormal, DETAIL_SIZE);
  const cpuBytes = albedo.bytes + roughness.bytes + normal.bytes;
  return {
    albedo,
    roughness,
    normal,
    cpuBytes,
    gpuBytesWithMips: Math.round((cpuBytes * 4) / 3),
    repeat: set.lawnTex.repeat.x,
    deterministicSeed: SEED,
  };
}

// ---------------------------------------------------------------------------
// CPU verification. These checks read properties OF THE PRODUCED DATA (value
// ranges, unit-length normals, wrap-around seam deltas, byte-identical
// regeneration). They do not re-derive the generator's math.
// ---------------------------------------------------------------------------

export interface TurfCheck {
  name: string;
  pass: boolean;
  detail: string;
}

/** Value-range and encoding sanity for all three maps. */
export function checkTurfRanges(set: TurfTextureSet): TurfCheck[] {
  const checks: TurfCheck[] = [];

  const d = set.lawnTex.image as unknown as { data: Uint8Array };
  const ch = [0, 0, 0].map(() => ({ min: 255, max: 0, sum: 0 }));
  for (let i = 0; i < d.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = d.data[i + c];
      const s = ch[c];
      if (v < s.min) s.min = v;
      if (v > s.max) s.max = v;
      s.sum += v;
    }
  }
  const n = d.data.length / 4;
  const mean = ch.map((s) => s.sum / n);
  const minAll = Math.min(ch[0].min, ch[1].min, ch[2].min);
  const maxAll = Math.max(ch[0].max, ch[1].max, ch[2].max);
  checks.push({
    name: 'range:albedo-green-dominant',
    pass: mean[1] > mean[0] && mean[0] > mean[2],
    detail: `mean rgb (${mean.map((m) => m.toFixed(1)).join(', ')}) — turf must stay G>R>B`,
  });
  checks.push({
    name: 'range:albedo-no-black-no-clip',
    pass: minAll >= 10 && maxAll <= 252,
    detail: `channel min ${minAll}, max ${maxAll} (need >=10 / <=252: no bald black, no blowout)`,
  });

  const r = set.lawnRough.image as unknown as { data: Uint8Array };
  let rMin = 1;
  let rMax = 0;
  let rSum = 0;
  let channelsEqual = true;
  for (let i = 0; i < r.data.length; i += 4) {
    const b = r.data[i];
    if (r.data[i + 1] !== b || r.data[i + 2] !== b || r.data[i + 3] !== b) channelsEqual = false;
    const v = b / 255;
    if (v < rMin) rMin = v;
    if (v > rMax) rMax = v;
    rSum += v;
  }
  const rMean = rSum / (r.data.length / 4);
  checks.push({
    name: 'range:roughness-bounds',
    pass: rMin >= 0.55 && rMax <= 1 && rMean >= 0.88 && rMean <= 0.98,
    detail: `min ${rMin.toFixed(3)}, max ${rMax.toFixed(3)}, mean ${rMean.toFixed(3)} (matte ~0.94, wetStd multiplies down)`,
  });
  checks.push({
    name: 'range:roughness-green-channel-carries-value',
    pass: channelsEqual,
    detail: 'all four channels identical (three.js samples roughnessMap.g)',
  });

  const nm = set.lawnNormal.image as unknown as { data: Uint8Array };
  let maxLenErr = 0;
  let maxSlope = 0;
  let zSum = 0;
  const ncount = nm.data.length / 4;
  for (let i = 0; i < nm.data.length; i += 4) {
    const nx = (nm.data[i] / 255) * 2 - 1;
    const ny = (nm.data[i + 1] / 255) * 2 - 1;
    const nz = (nm.data[i + 2] / 255) * 2 - 1;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    const err = Math.abs(len - 1);
    if (err > maxLenErr) maxLenErr = err;
    const slope = Math.sqrt(nx * nx + ny * ny);
    if (slope > maxSlope) maxSlope = slope;
    zSum += nz;
  }
  const meanZ = zSum / ncount;
  checks.push({
    name: 'range:normal-unit-and-modest',
    pass: maxLenErr <= 0.02 && maxSlope <= 0.4 && meanZ >= 0.98,
    detail: `max |len-1| ${maxLenErr.toFixed(4)} (quantized unit), max xy slope ${maxSlope.toFixed(3)} (modest => no moire), mean z ${meanZ.toFixed(4)}`,
  });

  return checks;
}

/**
 * Seam continuity: the wrap-around edge delta must be statistically the same
 * as an interior neighbor delta. A ratio near 1 means the tile is seamless at
 * any repeat; a large ratio means visible grid lines.
 */
export function checkTurfSeams(set: TurfTextureSet): TurfCheck[] {
  const seamCheck = (name: string, t: THREE.DataTexture): TurfCheck => {
    const img = t.image as unknown as { data: Uint8Array; width: number };
    const data = img.data;
    const s = img.width;
    const val = (x: number, y: number): number => {
      const k = (y * s + x) * 4;
      return (data[k] + data[k + 1] + data[k + 2]) / 3;
    };
    let seamH = 0;
    let seamV = 0;
    for (let i = 0; i < s; i++) {
      seamH += Math.abs(val(0, i) - val(s - 1, i));
      seamV += Math.abs(val(i, 0) - val(i, s - 1));
    }
    seamH /= s;
    seamV /= s;
    let intSum = 0;
    let count = 0;
    for (let y = 0; y < s; y += 4) {
      for (let x = 0; x < s - 1; x += 4) {
        intSum += Math.abs(val(x, y) - val(x + 1, y));
        count++;
      }
    }
    const interior = intSum / Math.max(1, count);
    const ratioH = seamH / Math.max(interior, 1e-6);
    const ratioV = seamV / Math.max(interior, 1e-6);
    // Absolute headroom is anchored to the texture's OWN interior delta (a
    // high-frequency normal map legitimately runs ~8-level neighbor deltas);
    // the seam must not exceed it by a visible margin.
    const pass =
      ratioH < 1.4 && ratioV < 1.4 && seamH < interior + 3 && seamV < interior + 3;
    return {
      name,
      pass,
      detail: `seam H ${seamH.toFixed(2)} / V ${seamV.toFixed(2)} levels vs interior ${interior.toFixed(2)} (ratios ${ratioH.toFixed(2)}, ${ratioV.toFixed(2)}; need <1.4 and <interior+3)`,
    };
  };
  return [
    seamCheck('seam:albedo', set.lawnTex),
    seamCheck('seam:roughness', set.lawnRough),
    seamCheck('seam:normal', set.lawnNormal),
  ];
}

/**
 * Determinism: regenerate every map through the pure generators and require
 * byte-identical buffers. Catches any accidental Math.random/order dependence.
 */
export function checkTurfDeterminism(set: TurfTextureSet): TurfCheck {
  const same = (fresh: Uint8Array, t: THREE.DataTexture): boolean => {
    const img = t.image as unknown as { data: Uint8Array };
    if (img.data.length !== fresh.length) return false;
    for (let i = 0; i < fresh.length; i++) {
      if (img.data[i] !== fresh[i]) return false;
    }
    return true;
  };
  const ok =
    same(albedoData(), set.lawnTex) &&
    same(roughnessData(), set.lawnRough) &&
    same(normalData(), set.lawnNormal);
  return {
    name: 'determinism:byte-identical-regeneration',
    pass: ok,
    detail: ok
      ? `regenerated ${(turfTextureStats(set).cpuBytes / 1024).toFixed(0)} KiB identical (seed 0x${SEED.toString(16)})`
      : 'regenerated buffers differ — generation is not deterministic',
  };
}
