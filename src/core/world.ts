/**
 * Renderer, scene, sky and the light rig.
 *
 * Look target: bright hazy desert daylight over bleached concrete. The lift in the
 * reference frames comes from OCCLUSION contrast, not from raising ambient - a flat
 * global ambient bump makes every enclosed space read wrong. So: one strong sun with a
 * tight, high-resolution shadow camera fitted to the playable area, a hemisphere fill
 * that is genuinely sky-vs-ground coloured, and fog matched to the horizon.
 *
 * Backend: a single THREE.WebGPURenderer (see core/renderer.ts) serves both WebGPU
 * and its silent WebGL2 fallback, so everything below is backend-agnostic. The sky
 * is a TSL node material for exactly that reason - the old hand-written GLSL dome
 * cannot compile under WebGPU. The environment map is a procedurally baked
 * equirectangular texture; the node system prefilters it for roughness
 * automatically, on both backends. That preserves the old screen/env split: the
 * VISIBLE dome goes through tone mapping and colour-space conversion, the baked
 * env data never does (it is lighting input, not a picture).
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  clamp,
  dot,
  float,
  Fn,
  max,
  mix,
  normalize,
  oneMinus,
  positionWorld,
  pow,
  smoothstep,
  uniform,
} from 'three/tsl';
import { PAL } from './palette';
import { BOUND_X_MIN, BOUND_X_MAX, BOUND_Z } from './layout';
import { bootRenderer, type BackendKind, type WorldRenderer } from './renderer';
import { buildPost, type PostBackend } from './post';

export interface World {
  renderer: WorldRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  /** Backend asked for (`webgpu` = try WebGPU, accept silent fallback). */
  backend: BackendKind;
  /** Resolves to the backend that actually came up. */
  backendReady: Promise<BackendKind>;
  /** Post-chain frame render (GTAO/SSR/bloom/vignette, or direct fallback). */
  render: () => void;
  /** False when post degraded to direct rendering. */
  postEnabled: boolean;
  /** Which path the post chain took. */
  postBackend: PostBackend;
  resize: () => void;
  dispose: () => void;
}

/** Shared sun direction: the visible dome, its glow and the baked env must agree. */
const SUN_DIR = new THREE.Vector3(0.45, 0.55, -0.7).normalize();

/**
 * Vertical gradient sky dome with sun glow, drawn as a TSL node material so it
 * compiles under both WebGPU and the WebGL2 fallback. Same ramp as the old GLSL
 * dome: horizon -> zenith biased pale, broad warm glow plus a hot core around
 * the sun, slight warm haze right at the horizon band. Tone mapping and output
 * colour-space conversion are applied by the material chain because this dome
 * renders to the screen.
 */
function makeSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(900, 32, 16);
  const topColor = uniform(new THREE.Color(PAL.skyTop).convertSRGBToLinear());
  const horizonColor = uniform(new THREE.Color(PAL.skyHorizon).convertSRGBToLinear());
  const sunColor = uniform(new THREE.Color(PAL.sunColor).convertSRGBToLinear());
  const sunDir = uniform(SUN_DIR);

  const skyColor = Fn(() => {
    const d = normalize(positionWorld);
    // horizon -> zenith ramp, biased so most of the visible sky is pale
    const h = clamp(d.y, 0, 1);
    const disc = mix(horizonColor, topColor, pow(h, 0.85))
      // broad warm glow around the sun, plus a hotter core
      .add(sunColor.mul(pow(max(dot(d, sunDir), 0), 8).mul(0.28)))
      .add(sunColor.mul(pow(max(dot(d, sunDir), 0), 180).mul(0.9)));
    // Slight warm haze right at the horizon band. Edges ascending: identical to
    // the old shader's reversed-edge smoothstep on every GPU (the smoothstep
    // polynomial is symmetric), but well-defined instead of undefined behaviour.
    const haze = oneMinus(smoothstep(float(-0.04), float(0.3), d.y));
    return mix(disc, horizonColor.mul(1.02), haze);
  });

  const mat = new MeshBasicNodeMaterial();
  mat.colorNode = skyColor();
  mat.side = THREE.BackSide;
  mat.depthWrite = false;
  mat.fog = false;
  const m = new THREE.Mesh(geo, mat);
  m.name = 'sky';
  m.frustumCulled = false;
  return m;
}

/** Well-defined smoothstep for the CPU bake (edges ascending, like the TSL sky). */
function smoothstepCpu(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const ENV_W = 256;
const ENV_H = 128;

/**
 * Procedurally baked equirectangular environment map: the same sky ramp, sun
 * glow and horizon haze as the visible dome, with bleached-concrete bounce
 * below the horizon (where the old code put a ground disc). Byte texture is
 * deliberate — this is low-frequency IBL data, and RGBA8 filters everywhere
 * both backends run. Linear values (NoColorSpace): lighting input, never
 * tone-mapped. Texel (x, y) holds the radiance for the direction three samples
 * it with: u = atan(z, x)/2PI + 0.5, v = asin(y)/PI + 0.5.
 */
function bakeEnvironment(): THREE.DataTexture {
  const top = new THREE.Color(PAL.skyTop).convertSRGBToLinear();
  const horizon = new THREE.Color(PAL.skyHorizon).convertSRGBToLinear();
  const sun = new THREE.Color(PAL.sunColor).convertSRGBToLinear();
  const bounce = new THREE.Color(PAL.bounce).convertSRGBToLinear();
  const data = new Uint8Array(ENV_W * ENV_H * 4);
  const d = new THREE.Vector3();
  for (let y = 0; y < ENV_H; y++) {
    const v = (y + 0.5) / ENV_H;
    const el = (v - 0.5) * Math.PI;
    const ce = Math.cos(el);
    for (let x = 0; x < ENV_W; x++) {
      const az = ((x + 0.5) / ENV_W - 0.5) * Math.PI * 2;
      d.set(ce * Math.cos(az), Math.sin(el), ce * Math.sin(az));
      let r: number;
      let g: number;
      let b: number;
      if (d.y < 0) {
        r = bounce.r;
        g = bounce.g;
        b = bounce.b;
      } else {
        const t = Math.pow(Math.min(Math.max(d.y, 0), 1), 0.85);
        r = horizon.r + (top.r - horizon.r) * t;
        g = horizon.g + (top.g - horizon.g) * t;
        b = horizon.b + (top.b - horizon.b) * t;
        const s = Math.max(d.dot(SUN_DIR), 0);
        const glow = Math.pow(s, 8) * 0.28 + Math.pow(s, 180) * 0.9;
        r += sun.r * glow;
        g += sun.g * glow;
        b += sun.b * glow;
        const hz = 1 - smoothstepCpu(-0.04, 0.3, d.y);
        r += (horizon.r * 1.02 - r) * hz;
        g += (horizon.g * 1.02 - g) * hz;
        b += (horizon.b * 1.02 - b) * hz;
      }
      const o = (y * ENV_W + x) * 4;
      data[o] = Math.min(255, Math.round(r * 255));
      data[o + 1] = Math.min(255, Math.round(g * 255));
      data[o + 2] = Math.min(255, Math.round(b * 255));
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, ENV_W, ENV_H, THREE.RGBAFormat);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export function createWorld(canvasParent: HTMLElement): World {
  const boot = bootRenderer();
  const renderer = boot.renderer;
  canvasParent.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(PAL.fog, 0.0031);

  const sky = makeSky();
  scene.add(sky);

  // ---- environment map, baked from the same sky.
  // Without this every metalness>0.7 material (chrome bumpers, trim, steel) has no
  // indirect specular to reflect and renders near-BLACK. That is not a "dark metal"
  // look, it is a missing term. The node system prefilters the equirect for
  // roughness on the GPU, on both backends.
  const envTex = bakeEnvironment();
  scene.environment = envTex;
  scene.environmentIntensity = 1.0;

  const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.08, 1400);

  // ---- sun. High and slightly behind the +x end so the houses catch a raking light.
  // Harsh desert noon: the key stays warm (a nudge warmer than PAL.sunColor) and a
  // touch stronger than before; shadow interiors go dark by starving the fills,
  // never by touching exposure (still 1.09 in renderer.ts).
  const sunTint = new THREE.Color(PAL.sunColor).offsetHSL(-0.008, 0.05, -0.004);
  const sun = new THREE.DirectionalLight(sunTint, 3.2);
  sun.position.set(58, 72, -92);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.00022;
  sun.shadow.normalBias = 0.055;
  // Fit the shadow camera to the playable area only. A shadow camera sized to the
  // skyline would waste almost all of its texels on empty desert.
  const cx = (BOUND_X_MIN + BOUND_X_MAX) / 2;
  const halfX = (BOUND_X_MAX - BOUND_X_MIN) / 2 + 6;
  const halfZ = BOUND_Z + 6;
  const half = Math.max(halfX, halfZ);
  const sc = sun.shadow.camera;
  sc.left = -half; sc.right = half;
  sc.top = half; sc.bottom = -half;
  sc.near = 1; sc.far = 320;
  sc.updateProjectionMatrix();
  sun.target.position.set(cx, 0, 0);
  scene.add(sun);
  scene.add(sun.target);
  // ---- fill. Cool sky above (skyTop family), warm bleached-concrete bounce below.
  // Kept at 1.05, below the old 1.15, so occlusion — not ambient wash — carries
  // the shadow interiors.
  const hemi = new THREE.HemisphereLight(PAL.skyTop, PAL.bounce, 1.05);
  hemi.position.set(0, 60, 0);
  scene.add(hemi);
  // A weak opposing fill so north-facing walls do not go to mud, kept low so that
  // occlusion still does the work. Cooled a step past skyTop, capped at 0.30.
  const fillTint = new THREE.Color(PAL.skyTop).offsetHSL(0.02, 0.04, -0.02);
  const fill = new THREE.DirectionalLight(fillTint, 0.3);
  fill.position.set(-70, 40, 80);
  fill.castShadow = false;
  scene.add(fill);

  // ---- post. Built once: buildPost probes the backend synchronously and lands
  // on the direct-render fallback (enabled:false) wherever the chain cannot run,
  // so main.ts keeps calling renderer.render safely and render() here is the
  // post path. post.setSize forwards to the renderer, preserving resize.
  const post = buildPost(renderer, scene, camera);
  const render = () => {
    post.render();
  };
  const resize = () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    post.setSize(innerWidth, innerHeight);
  };
  addEventListener('resize', resize);
  const dispose = () => {
    removeEventListener('resize', resize);
    post.dispose();
    sky.geometry.dispose();
    (sky.material as THREE.Material).dispose();
    envTex.dispose();
    renderer.dispose();
  };
  // Surface the boot failure loudly: ready rejects only when NO backend can
  // render. The rejection is the QA signal; main.ts keeps running its loop.
  boot.ready.catch(() => {
    /* already console.error'd in renderer.ts — this catch marks it handled */
  });
  return { renderer, scene, camera, sun, backend: boot.requested, backendReady: boot.ready, render, postEnabled: post.enabled, postBackend: post.backend, resize, dispose };
}
