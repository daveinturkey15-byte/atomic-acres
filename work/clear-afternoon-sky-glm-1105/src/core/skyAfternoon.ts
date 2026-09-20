/**
 * Clear-afternoon sky BACKGROUND candidate (?sky=afternoon).
 * Owned by work/clear-afternoon-sky-glm-1105; see RECEIPT.md there for the
 * physical derivation, orientation receipt and acceptance contract.
 *
 * WHAT IT IS
 * One deterministic equirectangular DataTexture baked on the CPU at init
 * (before the first frame), installed as scene.background while the TSL dome
 * mesh (named 'sky') is hidden for this load. scene.environment - the
 * atmosphere's baked env map that drives PBR reflections and skylight - is
 * NEVER touched: background and environment lighting stay separate systems.
 *
 * PHYSICAL MODEL (single-scatter intuition; documented constants; no random):
 * - Rayleigh: optical air mass grows toward the horizon, so the saturated blue
 *   zenith pales into a bright hazy horizon. The visible gradient IS the
 *   air-mass curve: vertical term pow(0.7) over a ramp from the horizon up.
 * - Mie forward scatter: a Henyey-Greenstein lobe (g = 0.9, peak-normalized)
 *   plus a compact 0.53-degree disc, aligned EXACTLY to the live
 *   DirectionalLight that casts the shadows (wiring passes its normalized
 *   direction, so preset/time-of-day changes stay consistent).
 * - Desert dust: a warm tint concentrated at the sun's azimuth within ~24
 *   degrees of the horizon, plus a pale band hugging the horizon line (~2
 *   degree scale) - "hazy pale distance" without touching fog.
 * - Below the horizon the field fades to a dusty ground colour; map geometry
 *   covers it, it only keeps the seam clean.
 *
 * CONTRACT (asserted in test/contract-test.ts):
 * - create() does NOT enable anything: default OFF.
 * - enable()/disable() swap scene.background and dome visibility and restore
 *   BOTH exactly; enable() after disable() reuses the same texture instance
 *   (no reallocation, no second upload).
 * - dispose() restores if enabled, frees the texture once, and is idempotent;
 *   every entry point after dispose() throws AfternoonSkyDisposedError (the
 *   late-arrival / zombie-background guard).
 * - No per-frame work after enable: bake and upload happen once at init; the
 *   frame loop only samples the finished texture.
 */
import * as THREE from 'three';
import { PAL } from './palette';

/** Thrown by any call after dispose() - the late-arrival / zombie-state guard. */
export class AfternoonSkyDisposedError extends Error {
  constructor() {
    super('AfternoonSky: call after dispose()');
    this.name = 'AfternoonSkyDisposedError';
  }
}

export interface AfternoonSkyOptions {
  scene: THREE.Scene;
  /** Unit vector TOWARD the sun in world space. Pass the live shadow-casting light's direction. */
  sunDir: THREE.Vector3;
  /** Equirect width in px (height is width/2). Default 2048 (the 2K bound). */
  size?: number;
}

export interface AfternoonSkyHandle {
  enable(): void;
  disable(): void;
  readonly enabled: boolean;
  readonly disposed: boolean;
  /** The one owned background texture. Throws AfternoonSkyDisposedError after dispose(). */
  readonly texture: THREE.DataTexture;
  dispose(): void;
}

const TAU = Math.PI * 2;

/** sRGB transfer function, channel-wise, to a byte. Called once per channel in the bake. */
function srgbByte(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, (c * 255 + 0.5) | 0));
}

/**
 * Bake the clear-afternoon sky into one RGBA8 equirect texture.
 * Row 0 is the BOTTOM (-Y): three's equirectUv maps v = asin(dir.y)/PI + 0.5.
 * Column u = atan2(dir.z, dir.x)/TAU + 0.5, so azimuth is seamless by
 * construction (wrapS = Repeat). Deterministic: a pure function of
 * (sunDir, size, palette) - no Math.random, no time, no GPU.
 */
function bakeAfternoonEquirect(sunDir: THREE.Vector3, width: number): THREE.DataTexture {
  const height = width >> 1;
  const data = new Uint8Array(width * height * 4);

  // Palette family converted ONCE, here: THREE.Color(hex) performs the single
  // sRGB->linear conversion (the atmosphere.ts rule); the bake stays linear.
  const zen = new THREE.Color(PAL.skyAfternoonTop);
  const hor = new THREE.Color(PAL.skyAfternoonHorizon);
  const dust = new THREE.Color(PAL.skyAfternoonDust);
  const gnd = new THREE.Color(PAL.skyAfternoonGround);
  const sunC = new THREE.Color(PAL.skyAfternoonSun);

  const sx = sunDir.x;
  const sy = sunDir.y;
  const sz = sunDir.z;
  // Sun disc: 0.53 deg diameter, soft edge 0.286..0.424 deg, compared through
  // cos thresholds so the 2M-pixel loop never calls acos. cos decreases toward
  // larger angles, so cIn (smaller angle) > cOut.
  const cOut = Math.cos(0.0074);
  const cIn = Math.cos(0.005);
  const cRange = cIn - cOut;
  // Mie lobe: Henyey-Greenstein g = 0.9, peak-normalized - numerator is the
  // denominator's value at gamma = 0, so hg = 1 at the disc centre.
  const HG_G = 0.9;
  const HG_G2 = HG_G * HG_G;
  const HG_NUMER = 1 + HG_G2 - 2 * HG_G;

  let o = 0;
  for (let j = 0; j < height; j++) {
    const elev = ((j + 0.5) / height - 0.5) * Math.PI;
    const sinE = Math.sin(elev);
    const cosE = Math.cos(elev);
    // air-mass style vertical ramp: 0 at the horizon, 1 overhead
    const k = Math.pow(Math.min(1, Math.max(0, (sinE + 0.03) * 2.2)), 0.7);
    const baseR = hor.r * (1 - k) + zen.r * k;
    const baseG = hor.g * (1 - k) + zen.g * k;
    const baseB = hor.b * (1 - k) + zen.b * k;
    // warm dust confined to a low band (gone by ~23 deg elevation)
    const lowSky = Math.pow(Math.max(0, Math.min(1, 1 - sinE * 2.5)), 2);
    // pale haze band hugging the horizon line (~2 deg scale)
    const band = Math.exp(-Math.abs(sinE) / 0.035) * 0.18;
    // below-horizon fade: seam hygiene only, geometry covers it
    const gm = sinE < 0 ? Math.min(1, -sinE * 5) : 0;
    for (let i = 0; i < width; i++) {
      const phi = ((i + 0.5) / width - 0.5) * TAU;
      const cx = Math.cos(phi);
      const cz = Math.sin(phi);
      const hdot = cx * sx + cz * sz; // horizontal projection of the sun dot
      const dot = sinE * sy + cosE * hdot;
      // warm dust toward the sun's azimuth
      const cosAz = Math.max(0, hdot / (cosE > 1e-4 ? cosE : 1e-4));
      const w = cosAz * cosAz * cosAz * lowSky * 0.55;
      // tight forward halo + compact disc (disc smoothstep over the cos window)
      const hg = Math.pow(HG_NUMER / (1 + HG_G2 - 2 * HG_G * dot), 1.5);
      const discT = Math.min(1, Math.max(0, (dot - cOut) / cRange));
      const disc = discT * discT * (3 - 2 * discT);
      const sunGain = hg * 0.06 + disc * 1.4;
      let r = baseR + dust.r * w + sunC.r * sunGain + hor.r * band;
      let g = baseG + dust.g * w + sunC.g * sunGain + hor.g * band;
      let b = baseB + dust.b * w + sunC.b * sunGain + hor.b * band;
      if (gm > 0) {
        r += (gnd.r - r) * gm;
        g += (gnd.g - g) * gm;
        b += (gnd.b - b) * gm;
      }
      data[o++] = srgbByte(r);
      data[o++] = srgbByte(g);
      data[o++] = srgbByte(b);
      data[o++] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping; // seamless in azimuth by construction
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter; // DataTexture defaults to Nearest - override
  tex.minFilter = THREE.LinearFilter; // no mipmap generation: one upload, both backends
  tex.needsUpdate = true;
  return tex;
}

/**
 * Create the candidate. Allocation (the bake) happens HERE, once - the caller
 * enables it before the first frame or never. Nothing in this module runs
 * per-frame: after enable(), rendering only samples the finished texture.
 */
export function createAfternoonSky(options: AfternoonSkyOptions): AfternoonSkyHandle {
  const scene = options.scene;
  const size = options.size ?? 2048;
  if (size < 2 || (size & (size - 1)) !== 0) {
    throw new RangeError('AfternoonSky: size must be a power of two >= 2');
  }
  const sunDir = options.sunDir.clone().normalize();

  let tex: THREE.DataTexture | null = bakeAfternoonEquirect(sunDir, size);
  let enabled = false;
  let disposed = false;
  let originalBackground: THREE.Color | THREE.Texture | null = null;
  let dome: THREE.Object3D | null = null;
  let domeWasVisible = true;

  const api: AfternoonSkyHandle = {
    enable() {
      if (disposed || tex === null) throw new AfternoonSkyDisposedError();
      if (enabled) return;
      originalBackground = scene.background;
      dome = scene.getObjectByName('sky');
      domeWasVisible = dome ? dome.visible : true;
      scene.background = tex;
      if (dome) dome.visible = false; // committed before the first frame by the wiring contract
      enabled = true;
    },
    disable() {
      if (!enabled || disposed) return;
      scene.background = originalBackground;
      if (dome) dome.visible = domeWasVisible;
      enabled = false;
    },
    dispose() {
      if (disposed) return; // idempotent
      if (enabled) api.disable();
      if (tex) tex.dispose();
      tex = null;
      disposed = true;
    },
    get enabled() {
      return enabled;
    },
    get disposed() {
      return disposed;
    },
    get texture() {
      if (tex === null) throw new AfternoonSkyDisposedError();
      return tex;
    },
  };
  return api;
}
