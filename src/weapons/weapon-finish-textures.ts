/**
 * Deterministic weapon-surface texture synthesis for the wood furniture and
 * parkerized steel viewmodel materials.
 *
 * This module is pure pixel math: no THREE, no canvas, no runtime state, no
 * Math.random. It is called once per texel during the single build of the
 * shared viewmodel textures (see viewmodel-materials.ts) and never per frame.
 *
 * Finish mode:
 * - default: the improved wood/steel surfaces below.
 * - `?weapon-finish=canary`: viewmodel-materials.ts keeps its legacy inline
 *   formulas, preserving the byte-exact baseline for same-camera A/B capture.
 *
 * Design notes (UV study, weapons/viewmodel.ts factories):
 * - Wood lives on RoundedBoxGeometry/BoxGeometry furniture whose dominant ±x
 *   faces map u along the barrel axis. Grain rings and open pores therefore
 *   elongate along u: pores use low frequency along u and high across v.
 * - Parkerized steel replaces the legacy periodic machining sine with
 *   nonperiodic phosphate mottle, crystal grain, broad blotch and sparse pits.
 * - Terms are mean-neutral so the palette, repeat and profile fields keep
 *   their existing values; the visible change is map content only.
 */

export type WeaponSurfaceKind = 'wood' | 'steel';

export interface WeaponSurfacePixel {
  albedo: number;
  roughness: number;
  height: number;
}

const TAU = Math.PI * 2;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Small deterministic integer hash; identical constants to viewmodel-materials. */
function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x ^ seed, 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ Math.imul(y, 0x27d4eb2d), 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

function smoothNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uy;
}

function octaveNoise(x: number, y: number, seed: number): number {
  return smoothNoise(x, y, seed) * 0.62
    + smoothNoise(x * 2.03, y * 2.03, seed + 17) * 0.25
    + smoothNoise(x * 4.11, y * 4.11, seed + 41) * 0.13;
}

// Wood tuning. PORE coverage/threshold trade off streak sparsity against how
// strongly the matte grooves read at hip distance.
const WOOD_RING_CYCLES = 7.0;
const WOOD_RING_WARP = 8.5;
const WOOD_RING_WARP_BROAD = 2.5;
const WOOD_RING_PLATEAU = 1.5;
const WOOD_PORE_THRESHOLD = 0.6;
const WOOD_PORE_GAIN = 3.8;
const WOOD_PORE_MEAN_ESTIMATE = 0.14;
const WOOD_PORE_DARKEN = 0.6;
const WOOD_PORE_ROUGHNESS = 0.45;
const WOOD_PORE_DEPTH = 0.5;

// Parkerized steel tuning. Mottle frequencies sit in phosphate-crystal scale
// at the existing repeat=2; pits stay under ~5% coverage.
const STEEL_MOTTLE_FREQ = 40;
const STEEL_CRYSTAL_FREQ = 80;
const STEEL_BLOTCH_FREQ = 6;
const STEEL_PIT_THRESHOLD = 0.955;
const STEEL_PIT_GAIN = 22;
const STEEL_PIT_MEAN_ESTIMATE = 0.018;

function woodPixel(roughnessBase: number, u: number, v: number, x: number, y: number): WeaponSurfacePixel {
  // Legacy seeds from viewmodel-materials ('WoodFurniture'.length = 13).
  const n = octaveNoise(u * 7, v * 7, 1313);
  const fibre = octaveNoise(u * 11, v * 90, 4507);
  const patch = octaveNoise(u * 2.2, v * 1.7, 4603);

  // Growth rings: lines parallel to u (they vary across v), nonperiodic via
  // strong multi-scale warp, plateau-compressed so they never zebra.
  const warp = (octaveNoise(u * 1.6, v * 3.2, 4103) - 0.5) * WOOD_RING_WARP
    + (octaveNoise(u * 0.8, v * 1.1, 4129) - 0.5) * WOOD_RING_WARP_BROAD;
  const ringRaw = 0.5 + 0.5 * Math.sin(v * TAU * WOOD_RING_CYCLES + warp);
  const ring = clamp01((ringRaw - 0.5) * WOOD_RING_PLATEAU + 0.5);

  // Open pores: thin streaks elongated along the barrel axis, sparse by
  // threshold. They are a surface feature first: matte and grooved.
  const poreRaw = octaveNoise(u * 5.5, v * 46, 4409);
  const pore = clamp01((poreRaw - WOOD_PORE_THRESHOLD) * WOOD_PORE_GAIN);
  const poreShade = 0.5 + (WOOD_PORE_MEAN_ESTIMATE - pore) * WOOD_PORE_DARKEN;

  const albedo = 0.30 * ring
    + 0.24 * poreShade
    + 0.24 * n
    + 0.14 * fibre
    + 0.08 * patch;
  const roughness = roughnessBase
    + pore * WOOD_PORE_ROUGHNESS - WOOD_PORE_MEAN_ESTIMATE * WOOD_PORE_ROUGHNESS
    + (0.5 - ring) * 0.07
    + (fibre - 0.5) * 0.06;
  const height = 0.48
    + (ring - 0.5) * 0.10
    - pore * WOOD_PORE_DEPTH + WOOD_PORE_MEAN_ESTIMATE * WOOD_PORE_DEPTH
    + (fibre - 0.5) * 0.06;

  return {
    // Same anti-banding dither as the legacy path.
    albedo: clamp01(albedo + (hash2(x, y, 7331) - 0.5) * 0.018),
    roughness: clamp01(roughness),
    height: clamp01(height),
  };
}

function steelPixel(roughnessBase: number, u: number, v: number, x: number, y: number): WeaponSurfacePixel {
  // Legacy seeds from viewmodel-materials ('ParkerizedSteel'.length = 15).
  const n = octaveNoise(u * 7, v * 7, 1515);

  // Phosphate crystallisation: two nonperiodic patch scales plus a broad
  // tonal blotch. No periodic machining stripes survive under parkerizing.
  const mottle = octaveNoise(u * STEEL_MOTTLE_FREQ, v * STEEL_MOTTLE_FREQ, 5501);
  const crystal = octaveNoise(u * STEEL_CRYSTAL_FREQ, v * STEEL_CRYSTAL_FREQ, 5689);
  const blotch = octaveNoise(u * STEEL_BLOTCH_FREQ, v * STEEL_BLOTCH_FREQ, 5821);

  // Sparse per-texel pits: darker, rougher, slightly recessed.
  const pit = clamp01((hash2(x, y, 5923) - STEEL_PIT_THRESHOLD) * STEEL_PIT_GAIN);

  const albedo = 0.34 * n
    + 0.30 * mottle
    + 0.16 * crystal
    + 0.12 * blotch
    + 0.08 * (0.5 + (STEEL_PIT_MEAN_ESTIMATE - pit) * 0.5);
  const roughness = roughnessBase
    + (mottle - 0.5) * 0.16
    + (crystal - 0.5) * 0.08
    + pit * 0.22 - STEEL_PIT_MEAN_ESTIMATE * 0.22
    + (blotch - 0.5) * 0.04;
  const height = 0.49
    + (mottle - 0.5) * 0.10
    + (crystal - 0.5) * 0.06
    - pit * 0.38 + STEEL_PIT_MEAN_ESTIMATE * 0.38;

  return {
    albedo: clamp01(albedo + (hash2(x, y, 7331) - 0.5) * 0.018),
    roughness: clamp01(roughness),
    height: clamp01(height),
  };
}

/**
 * Improved wood/parkerized pixel for viewmodel-materials.ts. Returns the same
 * shape as its legacy materialPixel branches.
 */
export function weaponSurfacePixel(
  kind: WeaponSurfaceKind,
  roughnessBase: number,
  u: number,
  v: number,
  x: number,
  y: number,
): WeaponSurfacePixel {
  return kind === 'wood'
    ? woodPixel(roughnessBase, u, v, x, y)
    : steelPixel(roughnessBase, u, v, x, y);
}

let override: 'default' | 'canary' | null = null;
let cachedCanary: boolean | null = null;

/**
 * True when the baseline weapon finish is requested via
 * `?weapon-finish=canary`. Mirrors the environment-flags query convention.
 */
export function isWeaponFinishCanaryRequested(): boolean {
  if (override !== null) return override === 'canary';
  if (cachedCanary !== null) return cachedCanary;
  cachedCanary = false;
  if (typeof window !== 'undefined' && window.location && window.location.search) {
    cachedCanary = (new URLSearchParams(window.location.search).get('weapon-finish') ?? '').toLowerCase() === 'canary';
  }
  return cachedCanary;
}

/** Test/monitoring override, mirroring setEnvironmentFlagsOverride semantics. */
export function setWeaponFinishOverride(mode: 'default' | 'canary' | null): void {
  override = mode;
}
