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
 *
 * TIME OF DAY AND WEATHER (core/atmosphere.ts). Every number that describes the air
 * and the sun - sun direction/colour/intensity, hemisphere colours, the dome's ramp and
 * glow, the env bake, fog colour/density/height, exposure, wetness, rain - lives in the
 * preset table there, and the three lights, the dome uniforms and the env texture built
 * HERE are driven from it. The noon/clear default reproduces the numbers this file used
 * to hold inline. PASS 82 holds on every switch: the light SET never changes.
 *
 * FOG: the scene carries no THREE.Fog on the WebGPU path. The haze is drawn by the post
 * chain (core/post.ts, from atmosphere.ts) on linear colour AFTER AO and SSR, so distant
 * occlusion is lifted by aerial perspective instead of being darkened under the fog. The
 * WebGL2 / degraded path, which has no chain, keeps the old FogExp2.
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
} from 'three/tsl';
import type { ShaderNodeObject } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { PAL } from './palette';
import { BOUND_X_MIN, BOUND_X_MAX, BOUND_Z } from './layout';
import { bootRenderer, type BackendKind, type WorldRenderer } from './renderer';
import { buildPost, type PostBackend, type PostChain } from './post';
import {
  createAtmosphere,
  createAtmosphereUniforms,
  createEnvironmentTexture,
  parseAtmosphereQuery,
  type Atmosphere,
  type AtmosphereUniforms,
} from './atmosphere';

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
  /**
   * The chain itself, for the options menu: `post.setEffects({ ao, ssr, bloom })`,
   * `post.setFog(on)`, `post.setAtmosphere(preset, weather)`. Uniform writes only.
   */
  post: PostChain;
  /** Time of day, weather and the smoke volumes (`atmosphere.set('dusk')`, `.setWeather('rain')`, `.smoke`). */
  atmosphere: Atmosphere;
  resize: () => void;
  dispose: () => void;
}

/**
 * Vertical gradient sky dome with sun glow, drawn as a TSL node material so it
 * compiles under both WebGPU and the WebGL2 fallback. Same ramp as the old GLSL
 * dome: horizon -> zenith biased pale, broad warm glow plus a hot core around
 * the sun, slight warm haze right at the horizon band. Tone mapping and output
 * colour-space conversion are applied by the material chain because this dome
 * renders to the screen. Every term is an atmosphere uniform: a preset switch
 * moves the sky without touching the material.
 */
function makeSky(u: AtmosphereUniforms): THREE.Mesh {
  const geo = new THREE.SphereGeometry(900, 32, 16);
  type N = ShaderNodeObject<Node>;
  const nn = (x: Node): N => x as unknown as N;
  const topColor = nn(u.skyTop);
  const horizonColor = nn(u.skyHorizon);
  const sunColor = nn(u.skySun);
  const sunDir = nn(u.skySunDir);
  const glowBroad = nn(u.glowBroad);
  const glowCore = nn(u.glowCore);

  const skyColor = Fn(() => {
    const d = normalize(positionWorld);
    // horizon -> zenith ramp, biased so most of the visible sky is pale
    const h = clamp(d.y, 0, 1);
    const disc = mix(horizonColor, topColor, pow(h, 0.85))
      // broad warm glow around the sun, plus a hotter core
      .add(sunColor.mul(pow(max(dot(d, sunDir), 0), 8).mul(glowBroad)))
      .add(sunColor.mul(pow(max(dot(d, sunDir), 0), 180).mul(glowCore)));
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

export function createWorld(canvasParent: HTMLElement): World {
  const boot = bootRenderer();
  const renderer = boot.renderer;
  canvasParent.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const uniforms = createAtmosphereUniforms();

  const sky = makeSky(uniforms);
  scene.add(sky);

  // ---- environment map, baked from the same sky.
  // Without this every metalness>0.7 material (chrome bumpers, trim, steel) has no
  // indirect specular to reflect and renders near-BLACK. That is not a "dark metal"
  // look, it is a missing term. The node system prefilters the equirect for
  // roughness on the GPU, on both backends. The bytes are written by the atmosphere
  // (once per preset switch); environmentIntensity 0.9 at noon: the byte-baked sun
  // disc still clips to white so chrome/glass glints survive, but flat ambient wash
  // drops and shade sits deeper.
  const envTex = createEnvironmentTexture();
  scene.environment = envTex;

  const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.08, 1400);

  // ---- sun. High and slightly behind the +x end so the houses catch a raking light.
  // Harsh desert noon per NT04/f-FKQOEO-1ceE-105 (hard warm key, crisp edges, cool
  // sky fill in shade): the key stays warm (a nudge warmer than PAL.sunColor);
  // shadow interiors go dark by starving the fills, never by touching exposure
  // (still 1.09 in renderer.ts). Colour, intensity and position are re-applied by the
  // atmosphere's noon preset with these exact numbers; other presets move them.
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
  // edge texels). ~2.3 cm/texel at 4096 over the 96 m square. A preset switch
  // re-aims the light and only ever WIDENS this square (atmosphere.ts fitShadow).
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

  // ---- atmosphere. THE LIGHT SET IS NOW COMPLETE: sun, hemi, fill (plus the sun's
  // target). The atmosphere drives their numbers, the dome uniforms, the env bytes,
  // exposure and wetness; it adds one rain mesh (no light) and never touches the set.
  // `?tod=dusk&weather=rain&smoke=x,y,z[,r[,kind]]` pin a state for captures.
  const query = parseAtmosphereQuery(typeof location !== 'undefined' ? location.search : '');
  const atmosphere = createAtmosphere(
    { scene, renderer, camera, sun, hemi, fill, envTex, uniforms }, query.tod, query.weather,
  );
  for (const s of query.smoke) atmosphere.smoke.test(s.kind, s.x, s.y, s.z, s.r);

  // ---- post. Built once: buildPost probes the backend synchronously and lands
  // on the direct-render fallback (enabled:false) wherever the chain cannot run,
  // so main.ts keeps calling renderer.render safely and render() here is the
  // post path. post.setSize forwards to the renderer, preserving resize.
  const post = buildPost(renderer, scene, camera, atmosphere);
  // Module-owned QA handle (like `__NTATMO`, `__NTANIM`, `__NTNET`): the atmosphere
  // verifier drives setEffects / setFog through it without a main.ts line. main.ts may
  // publish the same objects as `__NT.post` / `__NT.atmosphere` (lane report).
  try {
    (window as unknown as Record<string, unknown>).__NTPOST = post;
  } catch { /* headless without a window */ }

  // No chain, no fog pass: the degraded path keeps the old in-material FogExp2 so a
  // WebGL2 frame is not fogless. Fog density 0.0016: 0.0031 was tuned before the post
  // chain existed and went milky with GTAO/SSR/bloom on top; the mountain ring vanished.
  if (!post.enabled) scene.fog = new THREE.FogExp2(PAL.fog, 0.0016);

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
    // smoke envelopes -> uniforms, before anything draws (no allocation)
    atmosphere.update(performance.now());
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
    atmosphere.dispose();
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
  return {
    renderer, scene, camera, sun, backend: boot.requested, backendReady: boot.ready, render,
    postEnabled: post.enabled, postBackend: post.backend, post, atmosphere, resize, dispose,
  };
}
