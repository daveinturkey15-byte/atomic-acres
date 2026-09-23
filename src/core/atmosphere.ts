/**
 * Atmosphere: time of day, weather, the volumetric fog pass and the smoke volumes.
 *
 * One module owns every number that describes the air and the sun. world.ts builds the
 * sky dome, the baked env map and the light rig FROM the uniforms here; post.ts draws the
 * fog pass FROM the TSL builders here; nothing else knows a preset exists.
 *
 * THREE RULES THIS FILE IS BUILT AROUND
 *
 * 1. PASS 82 - the light SET is frozen after the first frame. A preset moves the
 *    intensity, colour and direction of the EXISTING sun / hemisphere / fill, the sky and
 *    env uniforms, the fog uniforms and the exposure. It never constructs, removes or
 *    hides a THREE.Light. `lightCount()` is exposed so a verifier can assert it.
 * 2. The fog is composited INSIDE the post chain, on linear radiance, before bloom and
 *    before the renderer's ACES + sRGB output pass. Never after the output node.
 * 3. No per-frame allocation. Every vector the frame loop touches is preallocated; the
 *    smoke uniform arrays are mutated in place; presets are frozen objects built once.
 *
 * THE FOG PASS (design, ten lines)
 *   a. Scene depth -> view position -> world ray, through uniform(camera.matrixWorld) and
 *      uniform(camera.position): the chain renders a QuadMesh, so the TSL built-ins
 *      resolve to the quad's camera, not the world's (post.ts learnt this for projInv).
 *   b. Analytic haze on view depth, FogExp2-shaped, tau = (rho * z)^2 * heightFactor -
 *      at noon heightFactor == 1 and rho == the old FogExp2 density, so the default is
 *      the old fog to the bit, only now applied AFTER AO/SSR (aerial perspective lifts
 *      distant occlusion instead of the old order darkening fogged geometry).
 *   c. heightFactor is the closed-form exponential-height integral along the ray, so
 *      morning mist pools low and thins with altitude; the sky (depth == 1) is never
 *      fogged, exactly as the dome was fog:false.
 *   d. Fog colour warms and brightens toward the sun by a forward lobe
 *      pow(max(dot(ray, sun), 0), p) * k - the in-scatter; zero at noon.
 *   e. Smoke: the contract's spheres (max 16) as two vec4 uniform arrays, raymarched in
 *      a HALF-RESOLUTION rtt() quad: per pixel the union [tEnter, tExit] of the spheres,
 *      clipped by scene depth, 24 steps with an interleaved-gradient jitter (static per
 *      pixel, so it dithers but never crawls - S8).
 *   f. Density = radial falloff (1-u^2)^2 x tiled 3D value noise (32^3 byte texture,
 *      drifting upward) x the lifetime envelope from the contract (fill 1.5 s, hold,
 *      dissolve over the last 5 s) x kind density (grenade 1.0, blast 0.6).
 *   g. Light per step = hemisphere ambient + sun * exp(-occupancy toward the centre,
 *      biased to the sun side) * Henyey-Greenstein forward lobe: single scatter with
 *      self-shadow darkening toward the core and a silver lining toward the sun.
 *   h. Output rgb = in-scatter, a = transmittance; composited full-res with a 5-tap
 *      depth-weighted upsample (edges against nearer geometry stay crisp).
 *   i. The output quad does color * T + S after the haze and before bloom.
 *   j. Cost: one extra draw (the half-res quad, marked frame-scoped so bloom's high-pass
 *      re-evaluation of its input does not march it twice); the haze is inline in the
 *      output quad and costs no draw at all.
 */
import * as THREE from 'three';
import {
  Fn,
  If,
  Loop,
  abs,
  dot,
  exp,
  float,
  fract,
  getViewPosition,
  int,
  length,
  max,
  min,
  mix,
  normalize,
  pow,
  rtt,
  screenCoordinate,
  select,
  sqrt,
  texture3D,
  time,
  uniform,
  uniformArray,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { ShaderNodeObject } from 'three/tsl';
import type { Node, TextureNode, UniformNode, UniformArrayNode, WebGPURenderer } from 'three/webgpu';
import { PAL } from './palette';
import { BOUND_X_MIN, BOUND_X_MAX, BOUND_Z } from './layout';
import { RAIN_STREAKS, buildRainMaterial, setWetness } from './materials';

type N = ShaderNodeObject<Node>;
/** @types/three's ShaderNodeObject<UniformNode<T>> is not assignable to ShaderNodeObject<Node>
 *  (an intersection quirk on `label()`), so node-typed parameters take the plain `Node` and
 *  are widened here; the uniforms keep their typed `.value`. */
const nn = (x: Node): N => x as unknown as N;
type UF = ShaderNodeObject<UniformNode<number>>;
type UC = ShaderNodeObject<UniformNode<THREE.Color>>;
type UV3 = ShaderNodeObject<UniformNode<THREE.Vector3>>;

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export const TOD_NAMES = ['noon', 'morning', 'goldenHour', 'dusk', 'overcastNoon'] as const;
export type TodName = (typeof TOD_NAMES)[number];
export const WEATHER_NAMES = ['clear', 'overcast', 'rain'] as const;
export type WeatherName = (typeof WEATHER_NAMES)[number];

/**
 * Colours are stored LINEAR, converted once here, by the same route each role took
 * before this module existed: light and fog colours are `new Color(hex)` (one sRGB ->
 * linear step), the dome / env colours are `new Color(hex).convertSRGBToLinear()` - a
 * SECOND step the original sky was tuned through. Both routes are kept per role so the
 * noon preset reproduces today's frame; the other presets are authored through them.
 */
const lightCol = (hex: number): THREE.Color => new THREE.Color(hex);
const skyCol = (hex: number): THREE.Color => new THREE.Color(hex).convertSRGBToLinear();

export interface TodPreset {
  readonly name: TodName;
  /** Unit vector toward the sun: the light, the smoke lighting and the in-scatter lobe. */
  readonly sunDir: THREE.Vector3;
  /** The dome / env glow direction. Noon keeps the historical offset from sunDir. */
  readonly skySunDir: THREE.Vector3;
  readonly sunColor: THREE.Color;
  readonly sunIntensity: number;
  readonly hemiSky: THREE.Color;
  readonly hemiGround: THREE.Color;
  readonly hemiIntensity: number;
  readonly fillColor: THREE.Color;
  readonly fillIntensity: number;
  readonly fillPos: THREE.Vector3;
  readonly skyTop: THREE.Color;
  readonly skyHorizon: THREE.Color;
  readonly skySun: THREE.Color;
  /** Dome + env glow terms (0.28 / 0.9 today) and the env-only hot disc (3.0 today). */
  readonly glowBroad: number;
  readonly glowCore: number;
  readonly envDisc: number;
  /** Multiplier on the below-horizon (paving / bounce) half of the baked env. */
  readonly envGround: number;
  readonly envIntensity: number;
  readonly fogColor: THREE.Color;
  /** FogExp2 density (per metre) - the old 0.0016 at noon. */
  readonly fogDensity: number;
  /** Exponential height falloff of the fog, metres. 1e5 == uniform (today). */
  readonly fogHeight: number;
  /** Sun in-scatter lobe strength (0..1) and its power. */
  readonly inscatter: number;
  readonly inscatterPower: number;
  readonly exposure: number;
}

const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z).normalize();

/** Today's sun tint: PAL.sunColor nudged as world.ts always did. */
const NOON_SUN = lightCol(PAL.sunColor).offsetHSL(-0.008, 0.05, -0.004);
const NOON_FILL = lightCol(PAL.skyTop).offsetHSL(0.02, 0.04, -0.02);
/**
 * Today's sun sits at world (58, 72, -92) and aims at the shadow target (cx, 0, 0), so
 * the light DIRECTION is (58 - cx, 72, -92), not (58, 72, -92). Both are kept exact:
 * the noon preset places the sun at target + sunDir * SUN_DIST, which is (58, 72, -92)
 * to the bit, and every other preset keeps the same distance so the shadow camera's
 * near/far (1..320) still bracket the map.
 */
export const SUN_TARGET = new THREE.Vector3((BOUND_X_MIN + BOUND_X_MAX) / 2, 0, 0);
const NOON_SUN_POS = new THREE.Vector3(58, 72, -92);
const SUN_DIST = NOON_SUN_POS.distanceTo(SUN_TARGET);
const NOON_SUN_DIR = NOON_SUN_POS.clone().sub(SUN_TARGET).normalize();

export const TOD_PRESETS: Readonly<Record<TodName, TodPreset>> = Object.freeze({
  noon: Object.freeze({
    name: 'noon',
    sunDir: NOON_SUN_DIR,
    skySunDir: v3(0.45, 0.55, -0.7),
    sunColor: NOON_SUN, sunIntensity: 3.35,
    hemiSky: lightCol(PAL.skyTop), hemiGround: lightCol(PAL.bounce), hemiIntensity: 0.95,
    fillColor: NOON_FILL, fillIntensity: 0.25, fillPos: new THREE.Vector3(-70, 40, 80),
    skyTop: skyCol(PAL.skyTop), skyHorizon: skyCol(PAL.skyHorizon), skySun: skyCol(PAL.sunColor),
    glowBroad: 0.28, glowCore: 0.9, envDisc: 3.0, envGround: 1.0, envIntensity: 0.9,
    fogColor: lightCol(PAL.fog), fogDensity: 0.0016, fogHeight: 1e5,
    inscatter: 0.0, inscatterPower: 8,
    exposure: 1.09,
  }),
  morning: Object.freeze({
    name: 'morning',
    sunDir: v3(0.82, 0.32, -0.47), skySunDir: v3(0.82, 0.32, -0.47),
    sunColor: lightCol(PAL.sunMorning), sunIntensity: 2.7,
    hemiSky: lightCol(PAL.skyMorningTop), hemiGround: lightCol(PAL.bounce), hemiIntensity: 0.85,
    fillColor: NOON_FILL, fillIntensity: 0.22, fillPos: new THREE.Vector3(-80, 40, 50),
    skyTop: skyCol(PAL.skyMorningTop), skyHorizon: skyCol(PAL.skyMorningHorizon), skySun: skyCol(PAL.sunMorning),
    glowBroad: 0.34, glowCore: 0.9, envDisc: 3.0, envGround: 0.9, envIntensity: 0.85,
    fogColor: lightCol(PAL.fogMorning), fogDensity: 0.0021, fogHeight: 45,
    inscatter: 0.35, inscatterPower: 6,
    exposure: 1.06,
  }),
  goldenHour: Object.freeze({
    name: 'goldenHour',
    sunDir: v3(-0.78, 0.19, -0.60), skySunDir: v3(-0.78, 0.19, -0.60),
    sunColor: lightCol(PAL.sunGolden), sunIntensity: 2.5,
    hemiSky: lightCol(PAL.skyGoldenTop), hemiGround: lightCol(PAL.bounceGolden), hemiIntensity: 0.72,
    fillColor: lightCol(PAL.skyGoldenTop), fillIntensity: 0.2, fillPos: new THREE.Vector3(75, 40, 60),
    skyTop: skyCol(PAL.skyGoldenTop), skyHorizon: skyCol(PAL.skyGoldenHorizon), skySun: skyCol(PAL.sunGoldenGlow),
    glowBroad: 0.45, glowCore: 1.0, envDisc: 3.0, envGround: 0.85, envIntensity: 0.8,
    fogColor: lightCol(PAL.fogGolden), fogDensity: 0.0022, fogHeight: 60,
    inscatter: 0.6, inscatterPower: 5,
    exposure: 1.02,
  }),
  dusk: Object.freeze({
    name: 'dusk',
    sunDir: v3(-0.85, 0.11, 0.52), skySunDir: v3(-0.85, 0.11, 0.52),
    sunColor: lightCol(PAL.sunDusk), sunIntensity: 1.3,
    hemiSky: lightCol(PAL.skyDuskFill), hemiGround: lightCol(PAL.bounceDusk), hemiIntensity: 0.45,
    fillColor: lightCol(PAL.skyDuskFill), fillIntensity: 0.1, fillPos: new THREE.Vector3(80, 40, -50),
    skyTop: skyCol(PAL.skyDuskTop), skyHorizon: skyCol(PAL.skyDuskHorizon), skySun: skyCol(PAL.sunDuskGlow),
    glowBroad: 0.55, glowCore: 1.1, envDisc: 2.0, envGround: 0.6, envIntensity: 0.5,
    fogColor: lightCol(PAL.fogDusk), fogDensity: 0.0026, fogHeight: 50,
    inscatter: 0.7, inscatterPower: 4,
    exposure: 0.96,
  }),
  overcastNoon: Object.freeze({
    name: 'overcastNoon',
    sunDir: NOON_SUN_DIR, skySunDir: v3(0.45, 0.55, -0.7),
    sunColor: lightCol(PAL.sunOvercast), sunIntensity: 1.0,
    hemiSky: lightCol(PAL.skyOvercastTop), hemiGround: lightCol(PAL.bounceOvercast), hemiIntensity: 1.75,
    fillColor: NOON_FILL, fillIntensity: 0.12, fillPos: new THREE.Vector3(-70, 40, 80),
    skyTop: skyCol(PAL.skyOvercastTop), skyHorizon: skyCol(PAL.skyOvercastHorizon), skySun: skyCol(PAL.sunOvercastGlow),
    glowBroad: 0.10, glowCore: 0.15, envDisc: 0.2, envGround: 0.95, envIntensity: 0.95,
    fogColor: lightCol(PAL.fogOvercast), fogDensity: 0.0032, fogHeight: 80,
    inscatter: 0.15, inscatterPower: 3,
    exposure: 1.05,
  }),
});

/**
 * Weather is a MODIFIER over the time-of-day row, so every preset x weather pair exists
 * without a 15-row table. `grey` is how far the sky / hemisphere / fog colours slide
 * toward the overcast greys; the scalars multiply. `shadow` drives
 * `sun.shadow.intensity`, a live uniform in r180's ShadowNode (`shadow.radius` is read
 * only by the VSM filter, so it is not the softening knob on this PCFSoft rig).
 */
export interface WeatherMod {
  readonly grey: number;
  readonly sun: number;
  readonly hemi: number;
  readonly fill: number;
  readonly glow: number;
  readonly disc: number;
  readonly fog: number;
  readonly fogHeightMax: number;
  readonly inscatter: number;
  readonly exposure: number;
  readonly shadow: number;
  readonly wetness: number;
  readonly rain: number;
}
export const WEATHER: Readonly<Record<WeatherName, WeatherMod>> = Object.freeze({
  clear: { grey: 0, sun: 1, hemi: 1, fill: 1, glow: 1, disc: 1, fog: 1, fogHeightMax: 1e5, inscatter: 1, exposure: 1, shadow: 1, wetness: 0, rain: 0 },
  overcast: { grey: 0.72, sun: 0.32, hemi: 1.7, fill: 0.6, glow: 0.3, disc: 0.1, fog: 1.9, fogHeightMax: 120, inscatter: 0.3, exposure: 0.98, shadow: 0.78, wetness: 0, rain: 0 },
  rain: { grey: 0.85, sun: 0.26, hemi: 1.55, fill: 0.5, glow: 0.25, disc: 0.05, fog: 2.4, fogHeightMax: 100, inscatter: 0.25, exposure: 0.95, shadow: 0.72, wetness: 1, rain: 1 },
});
const GREY_SUN = lightCol(PAL.sunOvercast);
const GREY_HEMI_SKY = lightCol(PAL.skyOvercastTop);
const GREY_HEMI_GROUND = lightCol(PAL.bounceOvercast);
const GREY_SKY_TOP = skyCol(PAL.skyOvercastTop);
const GREY_SKY_HORIZON = skyCol(PAL.skyOvercastHorizon);
const GREY_SKY_SUN = skyCol(PAL.sunOvercastGlow);
const GREY_FOG = lightCol(PAL.fogOvercast);
const RAIN_SKY_TOP = skyCol(PAL.skyRainTop);
const RAIN_SKY_HORIZON = skyCol(PAL.skyRainHorizon);

// ---------------------------------------------------------------------------
// Uniforms - the one set the dome, the env bake, the fog pass and the rain read
// ---------------------------------------------------------------------------

export const MAX_SMOKE = 16;

export interface AtmosphereUniforms {
  skyTop: UC; skyHorizon: UC; skySun: UC; skySunDir: UV3; glowBroad: UF; glowCore: UF;
  fogColor: UC; fogDensity: UF; fogHeight: UF; inscatter: UF; inscatterPower: UF;
  sunDir: UV3;
  /** Sun colour without intensity (the in-scatter tint) and with it (the smoke key). */
  sunTint: UC; sunLin: UC; ambientLin: UC;
  smokeCount: UF; smokeSpheres: ShaderNodeObject<UniformArrayNode>; smokeAux: ShaderNodeObject<UniformArrayNode>;
  wind: UV3; rainAmount: UF; rainTint: UC;
  /** CPU-side mirrors of the arrays above, mutated in place. */
  spheres: THREE.Vector4[]; aux: THREE.Vector4[];
}

export function createAtmosphereUniforms(): AtmosphereUniforms {
  const p = TOD_PRESETS.noon;
  const spheres: THREE.Vector4[] = [];
  const aux: THREE.Vector4[] = [];
  for (let i = 0; i < MAX_SMOKE; i++) { spheres.push(new THREE.Vector4()); aux.push(new THREE.Vector4()); }
  return {
    skyTop: uniform(p.skyTop.clone()),
    skyHorizon: uniform(p.skyHorizon.clone()),
    skySun: uniform(p.skySun.clone()),
    skySunDir: uniform(p.skySunDir.clone()),
    glowBroad: uniform(p.glowBroad),
    glowCore: uniform(p.glowCore),
    fogColor: uniform(p.fogColor.clone()),
    fogDensity: uniform(p.fogDensity),
    fogHeight: uniform(p.fogHeight),
    inscatter: uniform(p.inscatter),
    inscatterPower: uniform(p.inscatterPower),
    sunDir: uniform(p.sunDir.clone()),
    sunTint: uniform(new THREE.Color()),
    sunLin: uniform(new THREE.Color()),
    ambientLin: uniform(new THREE.Color()),
    smokeCount: uniform(0, 'int'),
    smokeSpheres: uniformArray(spheres, 'vec4'),
    smokeAux: uniformArray(aux, 'vec4'),
    wind: uniform(new THREE.Vector3(1.5, 0, 0.6)),
    rainAmount: uniform(0),
    rainTint: uniform(new THREE.Color()),
    spheres, aux,
  };
}

// ---------------------------------------------------------------------------
// The env bake - the same sky as the dome, once per preset switch
// ---------------------------------------------------------------------------

// 512x256: one-time CPU bake plus a 512 KiB upload, zero per-frame cost. 256x128
// smeared the sun glow over ~1.4 deg/texel; chrome and glazing need a tighter hot spot.
export const ENV_W = 512;
export const ENV_H = 256;

/** Well-defined smoothstep for the CPU bake (edges ascending, like the TSL sky). */
function smoothstepCpu(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const PAVING_LIN = skyCol(PAL.pavingWarm);
const BOUNCE_LIN = skyCol(PAL.bounce);
const _bakeDir = new THREE.Vector3();

/**
 * Bakes the equirect into `data` (RGBA8, ENV_W x ENV_H): the same sky ramp, sun glow
 * and horizon haze as the visible dome, plus the env-only hot disc the byte texture
 * clips to white so chrome and glass glint; below the horizon a paving -> bounce
 * gradient (grazing rays see the pale surround, steep rays the dirt) scaled by
 * envGround. Linear values (NoColorSpace): lighting input, never tone-mapped. Texel
 * (x, y) holds the radiance for the direction three samples it with:
 * u = atan(z, x)/2PI + 0.5, v = asin(y)/PI + 0.5. ~131k texels of scalar math per
 * switch; the cost is reported by `bakeMs()`.
 */
export function bakeEnvironmentInto(data: Uint8Array, e: EffectiveState): void {
  const top = e.skyTop, horizon = e.skyHorizon, sun = e.skySun;
  const d = _bakeDir;
  const sd = e.skySunDir;
  const g = e.envGround;
  for (let y = 0; y < ENV_H; y++) {
    const v = (y + 0.5) / ENV_H;
    const el = (v - 0.5) * Math.PI;
    const ce = Math.cos(el);
    const sy = Math.sin(el);
    for (let x = 0; x < ENV_W; x++) {
      const az = ((x + 0.5) / ENV_W - 0.5) * Math.PI * 2;
      d.set(ce * Math.cos(az), sy, ce * Math.sin(az));
      let r: number, gg: number, b: number;
      if (d.y < 0) {
        const t = Math.pow(Math.min(-d.y * 2.2, 1), 0.6);
        r = (PAVING_LIN.r + (BOUNCE_LIN.r - PAVING_LIN.r) * t) * g;
        gg = (PAVING_LIN.g + (BOUNCE_LIN.g - PAVING_LIN.g) * t) * g;
        b = (PAVING_LIN.b + (BOUNCE_LIN.b - PAVING_LIN.b) * t) * g;
      } else {
        const t = Math.pow(Math.min(Math.max(d.y, 0), 1), 0.85);
        r = horizon.r + (top.r - horizon.r) * t;
        gg = horizon.g + (top.g - horizon.g) * t;
        b = horizon.b + (top.b - horizon.b) * t;
        const s = Math.max(d.x * sd.x + d.y * sd.y + d.z * sd.z, 0);
        const glow = Math.pow(s, 8) * e.glowBroad + Math.pow(s, 180) * e.glowCore
          + Math.pow(s, 1500) * e.envDisc;
        r += sun.r * glow;
        gg += sun.g * glow;
        b += sun.b * glow;
        const hz = 1 - smoothstepCpu(-0.04, 0.3, d.y);
        r += (horizon.r * 1.02 - r) * hz;
        gg += (horizon.g * 1.02 - gg) * hz;
        b += (horizon.b * 1.02 - b) * hz;
      }
      const o = (y * ENV_W + x) * 4;
      data[o] = Math.min(255, Math.round(r * 255));
      data[o + 1] = Math.min(255, Math.round(gg * 255));
      data[o + 2] = Math.min(255, Math.round(b * 255));
      data[o + 3] = 255;
    }
  }
}

/** The env texture world.ts hands to the scene; the bytes are (re)filled by `apply`. */
export function createEnvironmentTexture(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array(ENV_W * ENV_H * 4), ENV_W, ENV_H, THREE.RGBAFormat);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Effective state = preset x weather, resolved into preallocated objects
// ---------------------------------------------------------------------------

export interface EffectiveState {
  sunDir: THREE.Vector3; skySunDir: THREE.Vector3;
  sunColor: THREE.Color; sunIntensity: number;
  hemiSky: THREE.Color; hemiGround: THREE.Color; hemiIntensity: number;
  fillColor: THREE.Color; fillIntensity: number; fillPos: THREE.Vector3;
  skyTop: THREE.Color; skyHorizon: THREE.Color; skySun: THREE.Color;
  glowBroad: number; glowCore: number; envDisc: number; envGround: number; envIntensity: number;
  fogColor: THREE.Color; fogDensity: number; fogHeight: number; inscatter: number; inscatterPower: number;
  exposure: number; shadowIntensity: number; wetness: number; rain: number;
}

function newEffective(): EffectiveState {
  return {
    sunDir: new THREE.Vector3(), skySunDir: new THREE.Vector3(),
    sunColor: new THREE.Color(), sunIntensity: 0,
    hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), hemiIntensity: 0,
    fillColor: new THREE.Color(), fillIntensity: 0, fillPos: new THREE.Vector3(),
    skyTop: new THREE.Color(), skyHorizon: new THREE.Color(), skySun: new THREE.Color(),
    glowBroad: 0, glowCore: 0, envDisc: 0, envGround: 1, envIntensity: 1,
    fogColor: new THREE.Color(), fogDensity: 0, fogHeight: 1e5, inscatter: 0, inscatterPower: 8,
    exposure: 1, shadowIntensity: 1, wetness: 0, rain: 0,
  };
}

export function resolveEffective(out: EffectiveState, p: TodPreset, w: WeatherMod): EffectiveState {
  const g = w.grey;
  out.sunDir.copy(p.sunDir);
  out.skySunDir.copy(p.skySunDir);
  out.sunColor.copy(p.sunColor).lerp(GREY_SUN, g);
  out.sunIntensity = p.sunIntensity * w.sun;
  out.hemiSky.copy(p.hemiSky).lerp(GREY_HEMI_SKY, g);
  out.hemiGround.copy(p.hemiGround).lerp(GREY_HEMI_GROUND, g);
  out.hemiIntensity = p.hemiIntensity * w.hemi;
  out.fillColor.copy(p.fillColor);
  out.fillIntensity = p.fillIntensity * w.fill;
  out.fillPos.copy(p.fillPos);
  out.skyTop.copy(p.skyTop).lerp(w.rain > 0 ? RAIN_SKY_TOP : GREY_SKY_TOP, g);
  out.skyHorizon.copy(p.skyHorizon).lerp(w.rain > 0 ? RAIN_SKY_HORIZON : GREY_SKY_HORIZON, g);
  out.skySun.copy(p.skySun).lerp(GREY_SKY_SUN, g);
  out.glowBroad = p.glowBroad * w.glow;
  out.glowCore = p.glowCore * w.glow;
  out.envDisc = p.envDisc * w.disc;
  out.envGround = p.envGround;
  out.envIntensity = p.envIntensity;
  out.fogColor.copy(p.fogColor).lerp(GREY_FOG, g);
  out.fogDensity = p.fogDensity * w.fog;
  out.fogHeight = Math.min(p.fogHeight, w.fogHeightMax);
  out.inscatter = p.inscatter * w.inscatter;
  out.inscatterPower = p.inscatterPower;
  out.exposure = p.exposure * w.exposure;
  out.shadowIntensity = w.shadow;
  out.wetness = w.wetness;
  out.rain = w.rain;
  return out;
}

// ---------------------------------------------------------------------------
// The smoke adapter - the contract's two events, either arrival
// ---------------------------------------------------------------------------

/** The contract shape (src/game/README.md, "The smoke contract"). Structural: any
 *  object with these fields is accepted, so the game's own event / view types pass in. */
export interface SmokeVolumeLike {
  readonly id: number;
  readonly x: number; readonly y: number; readonly z: number;
  readonly radius: number;
  readonly bornAt: number;
  readonly diesAt: number;
  readonly kind: 'grenade' | 'blast';
}
interface SmokeEventLike { readonly type: string; readonly id?: number }
export interface SmokeBusLike { on(fn: (e: SmokeEventLike) => void): void; off?(fn: (e: SmokeEventLike) => void): void }

/** Mirrors world-query.ts: fill 1.5 s, dissolve 5 s, blast is 0.6 of a grenade. */
const SMOKE_FILL_MS = 1500;
const SMOKE_DISSOLVE_MS = 5000;
const SMOKE_KIND_DENSITY = { grenade: 1.0, blast: 0.6 } as const;

interface SmokeVol { id: number; x: number; y: number; z: number; radius: number; bornAt: number; diesAt: number; kind: 'grenade' | 'blast'; seed: number }

export class SmokeAdapter {
  private readonly vols: SmokeVol[] = [];
  private source: (() => readonly SmokeVolumeLike[]) | null = null;
  private nextTestId = 1_000_000;
  private readonly listener = (e: SmokeEventLike): void => {
    if (e.type === 'smoke-volume') this.push(e as unknown as SmokeVolumeLike);
    else if (e.type === 'smoke-volume-end' && typeof e.id === 'number') this.end(e.id);
  };

  constructor(private readonly u: AtmosphereUniforms) {}

  /** A `smoke-volume` arrived (bus or direct). Replaces a volume with the same id. */
  push(v: SmokeVolumeLike): void {
    let slot = -1;
    for (let i = 0; i < this.vols.length; i++) if (this.vols[i].id === v.id) { slot = i; break; }
    if (slot === -1) {
      if (this.vols.length >= MAX_SMOKE) this.vols.shift();   // oldest goes
      this.vols.push({ id: v.id, x: v.x, y: v.y, z: v.z, radius: v.radius, bornAt: v.bornAt, diesAt: v.diesAt, kind: v.kind, seed: (v.id * 0.6180339887) % 1 });
    } else {
      const s = this.vols[slot];
      s.x = v.x; s.y = v.y; s.z = v.z; s.radius = v.radius; s.bornAt = v.bornAt; s.diesAt = v.diesAt; s.kind = v.kind;
    }
  }
  end(id: number): void {
    for (let i = 0; i < this.vols.length; i++) if (this.vols[i].id === id) { this.vols.splice(i, 1); return; }
  }
  clear(): void { this.vols.length = 0; }
  /** Push route: subscribe to a GameBus (or anything with `on`). */
  attach(bus: SmokeBusLike): () => void {
    bus.on(this.listener);
    return () => bus.off?.(this.listener);
  }
  /** Pull route: read a live list every frame (e.g. `() => client.ordnance.smokes`). */
  bind(source: (() => readonly SmokeVolumeLike[]) | null): void { this.source = source; }
  /** QA: a volume born now, from the contract's numbers (grenade 5 m / 25 s; blast 2.3 m / 5 s). */
  test(kind: 'grenade' | 'blast', x: number, y: number, z: number, radius?: number, lifeMs?: number, now = performance.now()): number {
    const id = this.nextTestId++;
    const r = radius ?? (kind === 'grenade' ? 5 : 2.3);
    const life = lifeMs ?? (kind === 'grenade' ? 25_000 : 5_000);
    this.push({ id, x, y, z, radius: r, bornAt: now, diesAt: now + life, kind });
    return id;
  }
  count(): number { return this.vols.length; }

  /**
   * Per frame: envelope -> the two uniform arrays. No allocation.
   * BOTH routes feed every frame: the bound live source (if any) first, then
   * our own pushed/test volumes. The pull route used to REPLACE the push list
   * outright, so the moment main.ts bound the (client-less, empty) live feed,
   * every QA/test volume stopped rendering and the pass read clean with three
   * volumes live (captures/_proof5). A bound-but-empty source contributes zero
   * slots now instead of shadowing the list. The source owns its records: only
   * our own list retires here.
   */
  update(now: number): void {
    let n = 0;
    if (this.source) n = this.writeList(this.source(), now, n);
    n = this.writeList(this.vols, now, n);
    // retire our own expired records (the pull route owns its own list)
    for (let i = this.vols.length - 1; i >= 0; i--) if (now >= this.vols[i].diesAt) this.vols.splice(i, 1);
    this.u.smokeCount.value = n;
  }
  /** One list's live volumes -> uniform slots from `n`. Returns the next free slot. */
  private writeList(list: readonly SmokeVolumeLike[], now: number, n: number): number {
    for (let i = 0; i < list.length && n < MAX_SMOKE; i++) {
      const v = list[i];
      if (now >= v.diesAt) continue;
      const fill = Math.min(1, Math.max(0, (now - v.bornAt) / SMOKE_FILL_MS));
      const fade = Math.min(1, Math.max(0, (v.diesAt - now) / SMOKE_DISSOLVE_MS));
      const grow = fill * fill * (3 - 2 * fill);
      // radius: 30% at birth, full at 1.5 s, swells another 35% while it thins out
      const r = v.radius * (0.3 + 0.7 * grow) * (1 + 0.35 * (1 - fade));
      const k = SMOKE_KIND_DENSITY[v.kind] * fill * fade * fade;
      if (k <= 0.001) continue;
      const seed = (v as SmokeVol).seed ?? (v.id * 0.6180339887) % 1;
      // grenade smoke sits on its centre; a blast puff lifts as it thins
      const lift = v.kind === 'blast' ? (1 - fade) * 0.8 : 0;
      this.u.spheres[n].set(v.x, v.y + lift, v.z, r);
      this.u.aux[n].set(k, seed * 37, v.kind === 'blast' ? 1 : 0, 0);
      n++;
    }
    return n;
  }
}

// ---------------------------------------------------------------------------
// Noise texture for the smoke: tiled 3D value noise, three octaves, 32^3 bytes
// ---------------------------------------------------------------------------

const NOISE_N = 32;

function makeNoiseTexture(): THREE.Data3DTexture {
  const n = NOISE_N;
  const data = new Uint8Array(n * n * n * 4);
  // lattice hash, deterministic
  const h = (x: number, y: number, z: number, s: number): number => {
    const v = Math.sin((x & (n - 1)) * 12.9898 + (y & (n - 1)) * 78.233 + (z & (n - 1)) * 37.719 + s) * 43758.5453;
    return v - Math.floor(v);
  };
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const value = (px: number, py: number, pz: number, freq: number, s: number): number => {
    const fx = (px * freq) % n, fy = (py * freq) % n, fz = (pz * freq) % n;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
    const tx = fx - x0, ty = fy - y0, tz = fz - z0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), sz = tz * tz * (3 - 2 * tz);
    const c = (dx: number, dy: number, dz: number): number => h(x0 + dx, y0 + dy, z0 + dz, s);
    return lerp(
      lerp(lerp(c(0, 0, 0), c(1, 0, 0), sx), lerp(c(0, 1, 0), c(1, 1, 0), sx), sy),
      lerp(lerp(c(0, 0, 1), c(1, 0, 1), sx), lerp(c(0, 1, 1), c(1, 1, 1), sx), sy), sz);
  };
  // frequencies 4 / 8 / 16 lattice cells per tile: integer periods, so it tiles seamlessly
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const a = value(x, y, z, 4 / n, 1.7);
    const b = value(x, y, z, 8 / n, 9.1);
    const c = value(x, y, z, 16 / n, 4.3);
    const o = ((z * n + y) * n + x) * 4;
    data[o] = Math.round(255 * Math.min(1, (a * 0.6 + b * 0.3 + c * 0.1)));
    data[o + 1] = Math.round(255 * b);
    data[o + 2] = Math.round(255 * c);
    data[o + 3] = 255;
  }
  const tex = new THREE.Data3DTexture(data, n, n, n);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// TSL: the haze and the smoke march. Built by post.ts inside the chain.
// ---------------------------------------------------------------------------

/** Interleaved gradient noise on pixel coordinates: the per-pixel step offset. */
const ign = Fn(([p]: [N]) => fract(float(52.9829189).mul(fract(dot(p, vec2(0.06711056, 0.00583715))))));

/** Extinction per metre at density 1: a 5 m grenade cloud is opaque through its core. */
const SMOKE_SIGMA = 0.9;
const SMOKE_STEPS = 24;
/** Henyey-Greenstein asymmetry for the sun lobe. */
const SMOKE_G = 0.4;

/** Loop params carry a `name` the typings do not declare; built as values, not literals. */
type LoopParams = { start: N; end: Node; type: 'int'; condition: string; name: string };
type LoopVars = Record<string, N>;
const loopOver = (end: Node, name: string): LoopParams => ({ start: int(0), end, type: 'int', condition: '<', name });

export interface AtmosphereFxInputs {
  /** Linear scene colour after AO and SSR. */
  color: Node;
  /** The scene pass depth texture node. */
  depth: ShaderNodeObject<TextureNode>;
  /** View position of this pixel (getViewPosition), and -z of it. */
  viewPos: Node;
  viewZ: Node;
  /** uniform(camera.projectionMatrixInverse) - post.ts already has one. */
  projInv: Node;
  camera: THREE.PerspectiveCamera;
  u: AtmosphereUniforms;
  /** float uniform, 1 = haze on, 0 = off (the options menu). Smoke is gameplay and never off. */
  fogOn: Node;
  /** Drawing-buffer size (CSS x pixel ratio). */
  width: number;
  height: number;
}

export interface AtmosphereFx {
  /** Colour with haze and smoke composited, still linear. */
  color: N;
  /** rgb = smoke in-scatter, a = transmittance, at full resolution. */
  smoke: N;
  /** The haze factor alone (0..1), for the ?post=fog diagnostic. */
  hazeFactor: N;
  setSize: (drawW: number, drawH: number) => void;
  dispose: () => void;
}

export function buildAtmosphereFx(inp: AtmosphereFxInputs): AtmosphereFx {
  const { u, depth, camera } = inp;
  const projInv = nn(inp.projInv);
  const camWorld = uniform(camera.matrixWorld);
  const camPos = uniform(camera.position);
  const noiseTex = makeNoiseTexture();
  const halfW = Math.max(1, Math.round(inp.width / 2));
  const halfH = Math.max(1, Math.round(inp.height / 2));
  const smokeTexel = uniform(new THREE.Vector2(1 / halfW, 1 / halfH));

  // ---- e/f/g: the march, half resolution --------------------------------
  const smokeFrag = Fn(() => {
    const suv = uv();
    const d = depth.sample(suv).r;
    const vp = getViewPosition(suv, d, projInv);
    const wp = camWorld.mul(vec4(vp, 1)).xyz;
    const toSurf = wp.sub(camPos);
    const tMax = length(toSurf);
    const rd = toSurf.div(tMax);
    const tEnter = float(1e9).toVar();
    const tExit = float(0).toVar();
    const hit = float(0).toVar();
    Loop(loopOver(u.smokeCount, 'si'), (vars) => {
      const si = (vars as unknown as LoopVars).si;
      const s = u.smokeSpheres.element(si);
      const oc = camPos.sub(s.xyz);
      const b = dot(oc, rd);
      const c = dot(oc, oc).sub(s.w.mul(s.w));
      const h = b.mul(b).sub(c);
      If(h.greaterThan(0), () => {
        const sq = sqrt(h);
        const t1 = b.negate().add(sq);
        If(t1.greaterThan(0), () => {
          const t0 = max(b.negate().sub(sq), 0);
          tEnter.assign(min(tEnter, t0));
          tExit.assign(max(tExit, t1));
          hit.assign(1);
        });
      });
    });
    tExit.assign(min(tExit, tMax));
    const result = vec4(0, 0, 0, 1).toVar();
    If(hit.greaterThan(0.5).and(tExit.greaterThan(tEnter)), () => {
      const dt = tExit.sub(tEnter).div(SMOKE_STEPS);
      const jitter = ign(screenCoordinate.xy);
      const T = float(1).toVar();
      const S = vec3(0).toVar();
      const drift = vec3(0, time.mul(0.12), 0);
      const cosTheta = dot(rd, nn(u.sunDir));
      // HG phase normalised so isotropic == 1
      const g2 = SMOKE_G * SMOKE_G;
      const phase = float(1 - g2).div(pow(float(1 + g2).sub(cosTheta.mul(2 * SMOKE_G)), 1.5));
      const sunTerm = nn(u.sunLin).mul(phase.mul(0.35).add(0.35));
      Loop(loopOver(int(SMOKE_STEPS), 'sj'), (vars) => {
        const sj = (vars as unknown as LoopVars).sj;
        const t = tEnter.add(dt.mul(float(sj).add(jitter)));
        const p = camPos.add(rd.mul(t));
        const dens = float(0).toVar();
        const occ = float(0).toVar();
        const warm = float(0).toVar();
        Loop(loopOver(u.smokeCount, 'sk'), (vars2) => {
          const sk = (vars2 as unknown as LoopVars).sk;
          const s = u.smokeSpheres.element(sk);
          const a = u.smokeAux.element(sk);
          const q = p.sub(s.xyz).div(s.w);
          const u2 = dot(q, q);
          If(u2.lessThan(1), () => {
            const fall = float(1).sub(u2);
            const fall2 = fall.mul(fall);
            // explicit LOD: a derivative-based sample inside divergent control flow is a
            // WGSL uniformity error, and the texture has no mips to pick from anyway
            const n = texture3D(noiseTex, p.mul(0.16).add(drift).add(vec3(a.y, a.y.mul(0.31), a.y.mul(0.77))), float(0)).r;
            // noise carves the cloud: 0.55..1.45 of the radial term, clipped at the skin
            const shaped = fall2.mul(n.mul(1.6).sub(0.25)).max(0);
            dens.addAssign(a.x.mul(shaped));
            // occupancy toward the core, lighter on the sun-facing side
            occ.addAssign(a.x.mul(fall2).mul(float(1).sub(dot(q, nn(u.sunDir)).mul(0.6))));
            warm.addAssign(a.z.mul(shaped));
          });
        });
        If(dens.greaterThan(0.0005), () => {
          const sigma = dens.mul(SMOKE_SIGMA);
          const trans = exp(sigma.mul(dt).negate());
          const sunVis = exp(occ.mul(-2.2));
          const albedo = mix(vec3(0.86, 0.87, 0.88), vec3(0.42, 0.36, 0.30), warm.div(dens).clamp(0, 1));
          const light = nn(u.ambientLin).add(sunTerm.mul(sunVis)).mul(albedo);
          S.addAssign(T.mul(float(1).sub(trans)).mul(light));
          T.mulAssign(trans);
        });
      });
      result.assign(vec4(S, T));
    });
    return result;
  });
  const smokeRtt = rtt(smokeFrag(), halfW, halfH);
  // Once per FRAME, not once per render: bloom's high-pass quad re-evaluates its input
  // graph in a nested render, and a render-scoped RTT would march the smoke a second
  // time there. The renderer's own Animation loop advances frameId once per rAF tick
  // (Animation.js), which is what every FRAME-scoped effect node in this chain relies on.
  (smokeRtt as unknown as { updateBeforeType: string }).updateBeforeType = 'frame';

  // ---- h: depth-weighted 5-tap upsample at full resolution ---------------
  const uvN = uv();
  const zC = nn(inp.viewZ);
  const tap = (ox: number, oy: number): { s: N; w: N } => {
    const o = smokeTexel.mul(vec2(ox, oy));
    const tuv = uvN.add(o);
    const s = smokeRtt.sample(tuv);
    const z = getViewPosition(tuv, depth.sample(tuv).r, projInv).z.negate();
    const w = exp(abs(z.sub(zC)).mul(-0.6)).add(0.001);
    return { s, w };
  };
  const t0 = tap(0, 0), t1 = tap(-0.75, -0.75), t2 = tap(0.75, -0.75), t3 = tap(-0.75, 0.75), t4 = tap(0.75, 0.75);
  const wsum = t0.w.mul(2).add(t1.w).add(t2.w).add(t3.w).add(t4.w);
  const smoke = t0.s.mul(t0.w.mul(2)).add(t1.s.mul(t1.w)).add(t2.s.mul(t2.w)).add(t3.s.mul(t3.w)).add(t4.s.mul(t4.w)).div(wsum);

  // ---- b/c/d: the analytic haze -------------------------------------------
  const dFull = depth.sample(uvN).r;
  const wpFull = camWorld.mul(vec4(nn(inp.viewPos), 1)).xyz;
  const rdFull = normalize(wpFull.sub(camPos));
  const L = zC;
  const H = nn(u.fogHeight);
  const hx = rdFull.y.mul(L).div(H).clamp(-40, 40);
  const ratio = select(abs(hx).lessThan(0.001), float(1).sub(hx.mul(0.5)), float(1).sub(exp(hx.negate())).div(hx));
  const hfac = exp(camPos.y.negate().div(H).clamp(-40, 40)).mul(ratio);
  const rl = nn(u.fogDensity).mul(L);
  const tau = rl.mul(rl).mul(hfac);
  // the sky dome writes no depth (depthWrite false), so depth == 1 exactly means sky
  const isGeom = select(dFull.lessThan(1), float(1), float(0));
  const f = float(1).sub(exp(tau.negate())).mul(isGeom).mul(nn(inp.fogOn));
  const sunAmt = pow(max(dot(rdFull, nn(u.sunDir)), 0), nn(u.inscatterPower)).mul(nn(u.inscatter)).clamp(0, 1);
  // toward the sun the haze brightens and takes the key's tint (in-scatter)
  const fogCol = mix(nn(u.fogColor), nn(u.fogColor).mul(0.55).add(nn(u.sunTint).mul(0.75)), sunAmt);
  const hazed = mix(nn(inp.color), fogCol, f);

  // ---- i: composite ---------------------------------------------------------
  const color = hazed.mul(smoke.a).add(smoke.rgb);

  return {
    color,
    smoke,
    hazeFactor: f,
    setSize: (w, h) => {
      const hw = Math.max(1, Math.round(w / 2));
      const hh = Math.max(1, Math.round(h / 2));
      smokeRtt.setSize(hw, hh);
      smokeTexel.value.set(1 / hw, 1 / hh);
    },
    dispose: () => {
      noiseTex.dispose();
      smokeRtt.renderTarget?.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// The rig controller
// ---------------------------------------------------------------------------

export interface AtmosphereRig {
  scene: THREE.Scene;
  renderer: WebGPURenderer;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  fill: THREE.DirectionalLight;
  envTex: THREE.DataTexture;
  uniforms: AtmosphereUniforms;
}

export interface Atmosphere {
  readonly uniforms: AtmosphereUniforms;
  tod(): TodName;
  weather(): WeatherName;
  set(tod: TodName): boolean;
  setWeather(w: WeatherName): boolean;
  /** Per frame, from world.render(). Host time in ms (performance.now()). */
  update(now: number): void;
  smoke: SmokeAdapter;
  /** THREE.Light count in the scene - a switch must never change it (PASS 82). */
  lightCount(): number;
  /** CPU cost of the last env re-bake, ms. */
  bakeMs(): number;
  /** Shadow camera half-extent in use and whether the fit widened it past the frozen square. */
  shadowFit(): { half: number; fitted: number; near: number; far: number };
  effective(): Readonly<EffectiveState>;
  dispose(): void;
}

function makeRain(u: AtmosphereUniforms): THREE.Mesh {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('uv', base.getAttribute('uv'));
  geo.instanceCount = RAIN_STREAKS;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const mat = buildRainMaterial({ wind: u.wind, amount: u.rainAmount, tint: u.rainTint });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'rain';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 20;
  mesh.visible = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/** The playable box the shadow camera must cover, with the same 6 m margin world.ts used. */
const SHADOW_BOX_MIN = new THREE.Vector3(BOUND_X_MIN - 6, 0, -BOUND_Z - 6);
const SHADOW_BOX_MAX = new THREE.Vector3(BOUND_X_MAX + 6, 18, BOUND_Z + 6);
const _lightView = new THREE.Matrix4();
const _corner = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export function createAtmosphere(rig: AtmosphereRig, initialTod: TodName = 'noon', initialWeather: WeatherName = 'clear'): Atmosphere {
  const u = rig.uniforms;
  const eff = newEffective();
  let tod: TodName = initialTod;
  let weather: WeatherName = initialWeather;
  let lastBakeMs = 0;
  const smoke = new SmokeAdapter(u);
  const rain = makeRain(u);
  rig.scene.add(rain);
  const envData = rig.envTex.image.data as Uint8Array;
  const sc = rig.sun.shadow.camera;
  // the frozen square world.ts fitted for the noon sun: never tightened, only widened
  const squareHalf = sc.right;
  const fit = { half: squareHalf, fitted: 0, near: sc.near, far: sc.far };

  /**
   * Re-fit the shadow camera to the sun. Light-space AABB of the playable box for this
   * direction; the half-extent is max(frozen square, fitted) so noon is bit-identical
   * and a low sun whose footprint outgrows the square still gets covered. Per-axis
   * tightening is deliberately NOT done (world.ts records why: out-of-frustum
   * fragments clamp to shadowed edge texels).
   */
  const fitShadow = (): void => {
    _lightView.lookAt(rig.sun.position, rig.sun.target.position, _up).invert();
    let maxXY = 0;
    for (let i = 0; i < 8; i++) {
      _corner.set(i & 1 ? SHADOW_BOX_MAX.x : SHADOW_BOX_MIN.x, i & 2 ? SHADOW_BOX_MAX.y : SHADOW_BOX_MIN.y, i & 4 ? SHADOW_BOX_MAX.z : SHADOW_BOX_MIN.z);
      _corner.sub(rig.sun.position).applyMatrix4(_lightView);
      maxXY = Math.max(maxXY, Math.abs(_corner.x), Math.abs(_corner.y));
    }
    const half = Math.max(squareHalf, Math.ceil(maxXY));
    fit.fitted = +maxXY.toFixed(1);
    if (half !== sc.right) {
      sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
      sc.updateProjectionMatrix();
    }
    fit.half = half;
  };

  const apply = (): void => {
    resolveEffective(eff, TOD_PRESETS[tod], WEATHER[weather]);
    // lights: the same three objects, new numbers
    rig.sun.color.copy(eff.sunColor);
    rig.sun.intensity = eff.sunIntensity;
    rig.sun.position.copy(eff.sunDir).multiplyScalar(SUN_DIST).add(rig.sun.target.position);
    rig.sun.shadow.intensity = eff.shadowIntensity;
    fitShadow();
    rig.hemi.color.copy(eff.hemiSky);
    rig.hemi.groundColor.copy(eff.hemiGround);
    rig.hemi.intensity = eff.hemiIntensity;
    rig.fill.color.copy(eff.fillColor);
    rig.fill.intensity = eff.fillIntensity;
    rig.fill.position.copy(eff.fillPos);
    // dome + fog + smoke uniforms
    u.skyTop.value.copy(eff.skyTop); u.skyHorizon.value.copy(eff.skyHorizon); u.skySun.value.copy(eff.skySun);
    u.skySunDir.value.copy(eff.skySunDir);
    u.glowBroad.value = eff.glowBroad; u.glowCore.value = eff.glowCore;
    u.fogColor.value.copy(eff.fogColor);
    u.fogDensity.value = eff.fogDensity; u.fogHeight.value = eff.fogHeight;
    u.inscatter.value = eff.inscatter; u.inscatterPower.value = eff.inscatterPower;
    u.sunDir.value.copy(eff.sunDir);
    u.sunTint.value.copy(eff.sunColor);
    u.sunLin.value.copy(eff.sunColor).multiplyScalar(eff.sunIntensity * 0.22);
    u.ambientLin.value.copy(eff.hemiSky).lerp(eff.hemiGround, 0.4).multiplyScalar(eff.hemiIntensity * 0.35);
    u.rainTint.value.copy(eff.skyHorizon).multiplyScalar(0.9).add(u.sunLin.value.clone().multiplyScalar(0.15));
    // env: re-bake once into the same texture; the PMREM regenerates on its version bump
    const t0 = performance.now();
    bakeEnvironmentInto(envData, eff);
    rig.envTex.needsUpdate = true;
    rig.envTex.needsPMREMUpdate = true;
    lastBakeMs = performance.now() - t0;
    rig.scene.environmentIntensity = eff.envIntensity;
    // exposure is a renderer uniform, read per frame
    rig.renderer.toneMappingExposure = eff.exposure;
    // weather surfaces
    setWetness(eff.wetness);
    u.rainAmount.value = eff.rain;
    rain.visible = eff.rain > 0;
  };

  apply();

  const api: Atmosphere = {
    uniforms: u,
    tod: () => tod,
    weather: () => weather,
    set(name) {
      if (!(name in TOD_PRESETS)) return false;
      tod = name; apply(); return true;
    },
    setWeather(name) {
      if (!(name in WEATHER)) return false;
      weather = name; apply(); return true;
    },
    update(now) { smoke.update(now); },
    smoke,
    lightCount() {
      let n = 0;
      rig.scene.traverse((o) => { if ((o as THREE.Light).isLight) n++; });
      return n;
    },
    bakeMs: () => lastBakeMs,
    shadowFit: () => ({ ...fit, near: sc.near, far: sc.far }),
    effective: () => eff,
    dispose() {
      rig.scene.remove(rain);
      rain.geometry.dispose();
      (rain.material as THREE.Material).dispose();
    },
  };
  installQA(api);
  return api;
}

// ---------------------------------------------------------------------------
// URL routes + QA surface
// ---------------------------------------------------------------------------

export interface AtmosphereQuery { tod: TodName; weather: WeatherName; smoke: Array<{ kind: 'grenade' | 'blast'; x: number; y: number; z: number; r?: number }> }

/** `?tod=dusk&weather=rain&smoke=x,y,z[,r[,kind]];...` - unknown values fall to defaults. */
export function parseAtmosphereQuery(search: string): AtmosphereQuery {
  const q = new URLSearchParams(search);
  const t = q.get('tod') as TodName | null;
  const w = q.get('weather') as WeatherName | null;
  const out: AtmosphereQuery = {
    tod: t && (TOD_NAMES as readonly string[]).includes(t) ? t : 'noon',
    weather: w && (WEATHER_NAMES as readonly string[]).includes(w) ? w : 'clear',
    smoke: [],
  };
  const s = q.get('smoke');
  if (s) {
    for (const part of s.split(';')) {
      const f = part.split(',');
      if (f.length < 3) continue;
      const x = +f[0], y = +f[1], z = +f[2];
      if (![x, y, z].every(Number.isFinite)) continue;
      const r = f[3] !== undefined && f[3] !== '' && Number.isFinite(+f[3]) ? +f[3] : undefined;
      out.smoke.push({ kind: f[4] === 'blast' ? 'blast' : 'grenade', x, y, z, r });
    }
  }
  return out;
}

/**
 * Module-owned QA global, like `__NTANIM` (characters) and `__NTNET` (netcode): the
 * verifier and the critics drive presets without a main.ts line. main.ts may also
 * publish the same object as `__NT.atmosphere` (the line is in the lane report).
 */
function installQA(api: Atmosphere): void {
  try {
    if (typeof window === 'undefined') return;
    (window as unknown as Record<string, unknown>).__NTATMO = {
      set: (n: string) => api.set(n as TodName),
      weather: (n: string) => api.setWeather(n as WeatherName),
      state: () => ({
        tod: api.tod(), weather: api.weather(), lights: api.lightCount(), bakeMs: +api.bakeMs().toFixed(2),
        smokes: api.smoke.count(), shadow: api.shadowFit(),
      }),
      presets: TOD_NAMES,
      weathers: WEATHER_NAMES,
      lightCount: () => api.lightCount(),
      smoke: {
        test: (kind: 'grenade' | 'blast', x: number, y: number, z: number, r?: number, lifeMs?: number) => api.smoke.test(kind, x, y, z, r, lifeMs),
        clear: () => api.smoke.clear(),
        count: () => api.smoke.count(),
        push: (v: SmokeVolumeLike) => api.smoke.push(v),
        end: (id: number) => api.smoke.end(id),
      },
    };
  } catch { /* headless without a window: nothing to hook */ }
}
