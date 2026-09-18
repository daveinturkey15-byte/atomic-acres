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

// 512x256: one-time CPU bake at startup plus a 512 KiB upload, zero per-frame
// cost. 256x128 smeared the sun glow over ~1.4 deg/texel; chrome and glazing
// need a tighter hot spot to glint against.
const ENV_W = 512;
const ENV_H = 256;

/**
 * Procedurally baked equirectangular environment map: the same sky ramp, sun
 * glow and horizon haze as the visible dome. Below the horizon, a gradient from
 * warm pale paving at grazing angles (the bleached surround dominates low
 * reflection rays) down to the bounce tone at nadir — a flat bounce colour made
 * every downward-facing reflection the same grey. Above the horizon the sky
 * terms match makeSky, plus a tight hot disc the byte texture clips to white:
 * the IBL sun reads hotter than the visible dome so chrome and glass glint.
 * Byte texture is deliberate — low-frequency IBL data, RGBA8 filters everywhere
 * both backends run. Linear values (NoColorSpace): lighting input, never
 * tone-mapped. Texel (x, y) holds the radiance for the direction three samples
 * it with: u = atan(z, x)/2PI + 0.5, v = asin(y)/PI + 0.5.
 */
function bakeEnvironment(): THREE.DataTexture {
  const top = new THREE.Color(PAL.skyTop).convertSRGBToLinear();
  const horizon = new THREE.Color(PAL.skyHorizon).convertSRGBToLinear();
  const sun = new THREE.Color(PAL.sunColor).convertSRGBToLinear();
  const paving = new THREE.Color(PAL.pavingWarm).convertSRGBToLinear();
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
        // Grazing rays see the pale surround, steep rays the dirt/bounce tone.
        const t = Math.pow(Math.min(-d.y * 2.2, 1), 0.6);
        r = paving.r + (bounce.r - paving.r) * t;
        g = paving.g + (bounce.g - paving.g) * t;
        b = paving.b + (bounce.b - paving.b) * t;
      } else {
        const t = Math.pow(Math.min(Math.max(d.y, 0), 1), 0.85);
        r = horizon.r + (top.r - horizon.r) * t;
        g = horizon.g + (top.g - horizon.g) * t;
        b = horizon.b + (top.b - horizon.b) * t;
        const s = Math.max(d.dot(SUN_DIR), 0);
        const glow = Math.pow(s, 8) * 0.28 + Math.pow(s, 180) * 0.9
          + Math.pow(s, 1500) * 3.0;
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
  // Fog density. 0.0031 was tuned before the post chain existed; with GTAO,
  // SSR and bloom layered on top the mid-distance went milky and the mountain
  // ring all but vanished, which is the opposite of the aerial-perspective the
  // reference shows. Pulled back so the backdrop reads again.
  scene.fog = new THREE.FogExp2(PAL.fog, 0.0016);

  const sky = makeSky();
  scene.add(sky);

  // ---- environment map, baked from the same sky.
  // Without this every metalness>0.7 material (chrome bumpers, trim, steel) has no
  // indirect specular to reflect and renders near-BLACK. That is not a "dark metal"
  // look, it is a missing term. The node system prefilters the equirect for
  // roughness on the GPU, on both backends.
  const envTex = bakeEnvironment();
  scene.environment = envTex;
  // 0.9: the byte-baked sun disc still clips to white so chrome/glass glints
  // survive, but flat ambient wash drops and shade sits deeper.
  scene.environmentIntensity = 0.9;

  const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.08, 1400);

  // ---- sun. High and slightly behind the +x end so the houses catch a raking light.
  // Harsh desert noon per NT04/f-FKQOEO-1ceE-105 (hard warm key, crisp edges, cool
  // sky fill in shade): the key stays warm (a nudge warmer than PAL.sunColor);
  // shadow interiors go dark by starving the fills, never by touching exposure
  // (still 1.09 in renderer.ts).
  const sunTint = new THREE.Color(PAL.sunColor).offsetHSL(-0.008, 0.05, -0.004);
  const sun = new THREE.DirectionalLight(sunTint, 3.35);
  sun.position.set(58, 72, -92);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.00022;
  sun.shadow.normalBias = 0.055;
  // Fit the shadow camera to the playable area only. A shadow camera sized to the
  // skyline would waste almost all of its texels on empty desert. Square fit:
  // half must cover the worst-case scene extent in LIGHT space, and the light
  // looks at the map diagonally, so per-world-axis bounds are NOT a safe
  // tightening (a previous pass tried halfX/halfZ here and falsely shadowed
  // the west end and the rooftops: out-of-frustum fragments clamp to shadowed
  // edge texels). ~2.3 cm/texel at 4096 over the 96 m square.
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
  // Kept at 0.95 so occlusion — not ambient wash — carries the shadow interiors;
  // the sniper frame's shaded terracotta sits deep while sunlit paving runs
  // near-white, and that range needs starved shade, not raised exposure.
  const hemi = new THREE.HemisphereLight(PAL.skyTop, PAL.bounce, 0.95);
  hemi.position.set(0, 60, 0);
  scene.add(hemi);
  // A weak opposing fill so north-facing walls do not go to mud, kept low so that
  // occlusion still does the work. Cooled a step past skyTop, capped at 0.25.
  const fillTint = new THREE.Color(PAL.skyTop).offsetHSL(0.02, 0.04, -0.02);
  const fill = new THREE.DirectionalLight(fillTint, 0.25);
  fill.position.set(-70, 40, 80);
  fill.castShadow = false;
  scene.add(fill);

  // ---- post. Built once: buildPost probes the backend synchronously and lands
  // on the direct-render fallback (enabled:false) wherever the chain cannot run,
  // so main.ts keeps calling renderer.render safely and render() here is the
  // post path. post.setSize forwards to the renderer, preserving resize.
  const post = buildPost(renderer, scene, camera);

  // THE CHAIN MUST BE THE FIRST THING THAT EVER RENDERS THIS SCENE. Read this before
  // adding a `renderer.render(scene, camera)` anywhere, however harmless it looks.
  //
  // The chain's scene pass writes a G-buffer (colour + view normal + metalness +
  // roughness) via MRT, so each material's fragment shader must emit four outputs.
  // three builds that shader once and caches the result under a key that does NOT
  // include the MRT (RenderObject.getMaterialCacheKey ignores renderer.getMRT()), so
  // WHICHEVER PATH RENDERS THE SCENE FIRST DECIDES THE SHADER FOR THE WHOLE SESSION.
  // If a direct render gets there first, every material is stuck with one output,
  // pipeline creation fails against the four-attachment pass target with
  //   "Color target has no corresponding fragment stage output ... targets[1]"
  // and NOTHING is drawn into the pass. Silently: no exception, no console error,
  // just a pass target full of zeros and a black world with the viewmodel on top.
  // That is the bug that shipped, and it was introduced by the code that used to be
  // here, which rendered direct until the backend reported ready.
  //
  // Measured 2026-09-18 on ?post=nrm (an MRT carrying normalView): with the direct
  // pre-roll the frame is the beauty render, which means the MRT never reached the
  // shader; with nothing rendering before the chain it is a correct view-normal
  // buffer. Same build, same machine, one render call apart.
  //
  // So: draw nothing at all until the backend is up (a few frames behind the click-to
  // -play overlay), then the chain and only the chain. The viewmodel overlay in
  // main.ts is a DIFFERENT scene with different lights, so it gets its own cache key
  // and its own single-output shader - it is not affected by this rule.
  let backendUp = false;
  // If NO backend initialises at all, fall back to direct pixels rather than a
  // permanently black world. This is the one place a direct render of the scene is
  // allowed, and it is safe precisely because in that branch the chain has never
  // rendered and never will - there is no MRT shader variant to poison. (Verifier
  // concern on the render fix: the last-ditch visible-pixels path had been removed.)
  let bootFailed = false;
  boot.ready.then(() => { backendUp = true; }).catch(() => { bootFailed = true; });
  const render = () => {
    if (bootFailed) { renderer.render(scene, camera); return; }
    if (!backendUp) return;
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
