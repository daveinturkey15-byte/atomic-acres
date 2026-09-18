/**
 * Post-production chain for Nuketown 2025.
 *
 * WebGPU backend: a TSL effect chain (GTAO contact darkening -> SSR
 * reflections -> restrained bloom -> subtle vignette) driven through
 * `PostProcessing`. Tone mapping stays renderer-owned (ACESFilmic, exposure
 * 1.09 in renderer.ts); the chain leaves `outputColorTransform` enabled so
 * the standard output transform applies exactly once.
 *
 * Anything else (WebGL2 backend, or any pass throwing at build time):
 * direct `renderer.render(scene, camera)` — never a black screen.
 *
 * The integrator (world.ts / main.ts) owns wiring; this module only builds
 * the chain. No per-frame allocations in the render path: `render()` just
 * forwards to the prebuilt `PostProcessing` instance.
 */
import * as THREE from 'three';
import { PostProcessing } from 'three/webgpu';
import {
  float,
  length,
  metalness,
  mrt,
  normalView,
  output,
  pass,
  roughness,
  smoothstep,
  uv,
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import type { WorldRenderer } from './renderer';

/** Which path the chain took. `off` = WebGPU present but a pass failed. */
export type PostBackend = 'webgpu' | 'webgl2' | 'off';

export interface PostChain {
  /** Render one frame. Allocation-free after build. */
  render: () => void;
  /** Forward CSS-pixel size to the renderer and the scene pass. */
  setSize: (w: number, h: number) => void;
  /** Release the post stack and the scene pass targets. */
  dispose: () => void;
  /** False when degraded to direct rendering. */
  enabled: boolean;
  backend: PostBackend;
}

// Bloom stays tight and restrained: only ~HDR glints (sun on chrome/glass)
// clear the threshold, with low strength and a small radius.
const BLOOM_STRENGTH = 0.35;
const BLOOM_RADIUS = 0.15;
const BLOOM_THRESHOLD = 1.0;

// Vignette: no darkening in the central 45% of the half-diagonal, ramping to
// an 18% multiply at the extreme corners. Achromatic, so no palette entry.
const VIGNETTE_INNER = 0.45;
const VIGNETTE_OUTER = 0.95;
const VIGNETTE_DEPTH = 0.18;

export function buildPost(
  renderer: WorldRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): PostChain {
  // Same detection technique as renderer.ts actualBackend: the WebGPU backend
  // flags itself, anything else is the silent WebGL2 fallback.
  const backendProbe = renderer.backend as unknown as { isWebGPUBackend?: boolean };
  const onWebGPU = backendProbe.isWebGPUBackend === true;

  if (onWebGPU) {
    try {
      return buildChain(renderer, scene, camera);
    } catch {
      /* fall through to the direct-render fallback below */
    }
  }

  // WebGL2, or a WebGPU pass that threw at build time: direct render, never
  // a black screen. One literal, one site — every degradation path lands here.
  return {
    render: () => {
      renderer.render(scene, camera);
    },
    setSize: (w, h) => {
      renderer.setSize(w, h);
    },
    dispose: () => {
      /* nothing held beyond the renderer itself */
    },
    enabled: false,
    backend: onWebGPU ? 'off' : 'webgl2',
  };
}

function buildChain(
  renderer: WorldRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): PostChain {
    const scenePass = pass(scene, camera);
    scenePass.setMRT(mrt({ output, normal: normalView, metalness, roughness }));

    const color = scenePass.getTextureNode('output');
    const normal = scenePass.getTextureNode('normal');
    const depth = scenePass.getTextureNode('depth');
    const metal = scenePass.getTextureNode('metalness');
    const rough = scenePass.getTextureNode('roughness');

    // 1 — GTAO: contact darkening under eaves, vehicles, kerbs. Radius 1.0 m:
    // the default 0.25 only sees 25 cm crevices and misses every kerb, tyre and
    // eave contact in a metre-scale scene. As of 2026-09-18 this chain DOES run:
    // main.ts routes the world through World.render(). Before that it never had.
    const aoNode = ao(depth, normal, camera);
    aoNode.radius.value = 1.0;
    const occlusion = aoNode.getTextureNode();
    const lit = color.mul(occlusion);

    // 2 — SSR on road/paving/glazing, opacity-weighted additive. maxDistance 12
    // covers the street width (the default 1 m only reflects a bumper); opacity
    // stays restrained so rough asphalt keeps a dim lobe, not a mirror. If the
    // reflection pass fails to build, the lit colour stands on its own and
    // the existing env maps keep carrying specular response.
    let graded = lit;
    try {
      // SSRNode SAMPLES its colour input at arbitrary UVs (`this.colorNode.sample(...)`),
      // so it must be handed a real texture node, not a computed expression. Passing
      // `lit` (which is color.mul(occlusion)) threw
      //   TypeError: this.colorNode.sample is not a function
      // at build time - invisible until today, because main.ts never ran this chain.
      // Feed it the raw scene texture and apply occlusion to the result instead.
      const ssrNode = ssr(color, depth, normal, metal, rough, camera);
      ssrNode.maxDistance.value = 12;
      ssrNode.thickness.value = 0.3;
      ssrNode.opacity.value = 0.55;
      const reflection = ssrNode.getTextureNode();
      graded = lit.add(reflection.rgb.mul(reflection.a).mul(occlusion));
    } catch {
      /* env-map fallback: keep the GTAO-graded colour without SSR */
    }

    // 3 — tight bloom, then 4 — subtle vignette.
    const glints = bloom(graded, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
    const bloomed = graded.add(glints);
    const dist = length(uv().sub(0.5));
    const shade = float(1).sub(
      smoothstep(float(VIGNETTE_INNER), float(VIGNETTE_OUTER), dist).mul(VIGNETTE_DEPTH),
    );

    const post = new PostProcessing(renderer);
    post.outputNode = bloomed.mul(shade);

    // A node graph only builds on the FIRST render, so a malformed node throws deep
    // inside the frame loop rather than at construction - which is how a broken chain
    // stayed invisible behind a try/catch that only wrapped construction. Degrade to
    // direct rendering on the first failure, once, and say so loudly.
    let chainBroken = false;
    return {
      render: () => {
        if (chainBroken) {
          renderer.render(scene, camera);
          return;
        }
        try {
          post.render();
        } catch (err) {
          chainBroken = true;
          console.error('[post] chain failed at render; falling back to direct '
            + 'rendering for the rest of this session. The frame you are looking at '
            + 'has NO ambient occlusion, reflection, bloom or vignette.', err);
          renderer.render(scene, camera);
        }
      },
      setSize: (w, h) => {
        // Effect nodes (GTAO/SSR/bloom) re-derive their targets from the
        // drawing buffer every frame in updateBefore(); only the scene pass
        // needs an explicit resize alongside the renderer.
        renderer.setSize(w, h);
        scenePass.setSize(w, h);
      },
      dispose: () => {
        post.dispose();
        scenePass.dispose();
      },
      enabled: true,
      backend: 'webgpu',
    };
}
