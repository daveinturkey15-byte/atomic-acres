/**
 * Post-production chain for Nuketown 2025.
 *
 * WebGPU backend: a TSL effect chain (GTAO contact darkening -> SSR reflections ->
 * restrained bloom -> subtle vignette) over one MRT scene pass. Anything else
 * (WebGL2 backend, or any pass throwing at build time): direct
 * `renderer.render(scene, camera)` — never a black screen.
 *
 * TWO THINGS HERE ARE LOAD-BEARING. Both were black-screen bugs, both were measured
 * on 2026-09-18, and both will come back the moment someone "tidies" them.
 *
 * 1. NOTHING MAY RENDER `scene` BEFORE THIS CHAIN DOES. The MRT scene pass needs
 *    every material's fragment shader to emit four outputs, three caches that shader
 *    under a key that ignores `renderer.getMRT()`, and so the first path to render the
 *    scene fixes the shader for the session. A direct render first => one-output
 *    shaders => pipeline creation fails against the four-attachment target with
 *      "Color target has no corresponding fragment stage output but writeMask is not
 *       zero. While validating targets[1] framebuffer output."
 *    => nothing is drawn into the pass => the pass target reads as zeros => `?post=off`
 *    showed the page background through a transparent canvas, `?post=ao` a flat field
 *    and the graded output pure black. No exception, no console error. The rule and
 *    its measurement live in the long comment above `render` in core/world.ts.
 *
 * 2. The chain does NOT use `PostProcessing`. `PostProcessing.render()` forces
 *    `NoToneMapping` for its own quad, which makes the renderer skip its internal
 *    frame-buffer target and paint the canvas directly. The frame loop's next two
 *    calls — `clearDepth()` and the depth-cleared viewmodel render — go the ordinary
 *    route, through that frame-buffer target, and `Renderer.clear()` ends with
 *    `_renderOutput(frameBufferTarget)`, which blits a buffer the chain never wrote
 *    straight over the finished frame. Measured on the QA path: post render -> canvas
 *    luma 0.0, one `clearDepth()` later -> 135.3 (that buffer's stale contents). So the
 *    chain renders its own `QuadMesh` with a LINEAR output node instead. That goes
 *    through the same frame-buffer target as every other render, the renderer applies
 *    ACES + sRGB exactly once in its output pass, and the viewmodel composites over
 *    the finished frame the way it always did on the direct path.
 *
 * The integrator (world.ts / main.ts) owns wiring; this module only builds the chain.
 * No per-frame allocations in the render path: `render()` just draws the prebuilt quad.
 */
import * as THREE from 'three';
import { NodeMaterial, QuadMesh } from 'three/webgpu';
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
  vec3,
  vec4,
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
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
  // Safe with respect to rule 1: if the chain never built, no MRT shader exists.
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

/**
 * AO remap. AO_OPEN / AO_DEEP are what the GTAO node actually emits on this scene,
 * not free parameters - measure them again if the scene scale, the AO radius or the
 * camera's near/far change. AO_STRENGTH is the only taste knob here.
 *
 * MEASURED 2026-09-18, raw denoised term, percentiles per fidelity station (the
 * previous values, 0.895 / 0.62, were recorded while the pass was rendering nothing
 * and describe no real frame):
 *
 *   station           p1     p5     p25    p50
 *   aerial            0.722  0.760  0.936  1.00
 *   yardOrange        0.685  0.853  0.968  1.00
 *   yardWhite         0.722  0.878  0.968  1.00
 *   streetElevation   0.136  0.351  0.741  0.968
 *   plaza             0.584  0.853  1.00   1.00
 *
 * So an unoccluded surface emits exactly 1.0 and the occluded tail runs to ~0.14.
 * Anchoring AO_OPEN at 0.895 put more than half of every frame past the top of the
 * ramp and squeezed all the contact information into the 5% of pixels below it -
 * which is what "the AO is on but I cannot see it" looked like.
 */
const AO_OPEN = 1.0;        // a fully unoccluded surface
const AO_DEEP = 0.35;       // p5 of the most enclosed station; below this it saturates
const AO_STRENGTH = 0.55;   // a fully occluded contact lands at 1 - this

function buildChain(
  renderer: WorldRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): PostChain {
    const scenePass = pass(scene, camera);
    // Four RGBA16F attachments = 32 bytes per sample, which is exactly the WebGPU
    // default `maxColorAttachmentBytesPerSample`. A fifth channel needs that limit
    // raised in renderer.ts's requiredLimits; the adapter here reports 128.
    scenePass.setMRT(mrt({ output, normal: normalView, metalness, roughness }));

    const color = scenePass.getTextureNode('output');
    const normal = scenePass.getTextureNode('normal');
    const depth = scenePass.getTextureNode('depth');
    const metal = scenePass.getTextureNode('metalness');
    const rough = scenePass.getTextureNode('roughness');

    // 1 — GTAO: contact darkening under eaves, vehicles, kerbs. Radius 0.9 m:
    // the default 0.25 only sees 25 cm crevices and misses every kerb, tyre and
    // eave contact in a metre-scale scene. The normal texture is not optional in
    // practice: GTAONode reconstructs normals from depth when it is passed null, and
    // on this stack that path emitted exactly ZERO everywhere (measured through a raw
    // -AO debug output, mean 0.0 / max 0 at every playcap station), which multiplies
    // the whole frame to black. That is why the MRT is worth rule 1 above.
    const aoNode = ao(depth, normal, camera);
    aoNode.radius.value = 0.9;
    aoNode.samples.value = 32;             // 16 and 24 both speckle at this radius
    aoNode.distanceExponent.value = 1.4;   // bias toward near contacts
    aoNode.thickness.value = 0.6;

    // GTAO's own output does not use its range evenly: see the measured percentile
    // table above AO_OPEN. Multiplying colour by the raw term wastes it - the right
    // move is to remap, pinning open surfaces to exactly 1.0 so AO costs nothing
    // where nothing occludes and stretching the occluded end down to where it reads.
    //
    // aoNode.scale is a POWER (ao = pow(ao, scale)), so turning it up darkens the
    // open surfaces too and makes the global dimming worse, not better. The right
    // move is to remap: pin open surfaces to exactly 1.0 so AO costs nothing where
    // nothing occludes, and stretch the occluded end down to where it reads.
    // Raw GTAO at this radius is speckled - the dither pattern reads as noise along
    // kerb edges rather than as occlusion, which is worse than no AO at all for a
    // photoreal target. Run it through the edge-aware denoise, which is what three's
    // own GTAO example does.
    const aoDenoised = denoise(aoNode.getTextureNode(), depth, normal, camera);
    aoDenoised.lumaPhi.value = 8;
    aoDenoised.depthPhi.value = 3;
    aoDenoised.normalPhi.value = 6;
    aoDenoised.radius.value = 6;

    const occRaw = aoDenoised.r;
    const occlusion = occRaw.remapClamp(
      float(AO_DEEP), float(AO_OPEN), float(1 - AO_STRENGTH), float(1),
    );
    // Work on rgb only. `color.mul(occlusion)` also multiplies ALPHA, and this canvas
    // is not opaque - a frame at alpha 0.6 composites against the page background.
    const lit = color.rgb.mul(occlusion);

    // 2 — SSR on road/paving/glazing, opacity-weighted additive. maxDistance 12
    // covers the street width (the default 1 m only reflects a bumper); opacity
    // stays restrained so rough asphalt keeps a dim lobe, not a mirror. If the
    // reflection pass fails to build, the lit colour stands on its own and
    // the existing env maps keep carrying specular response.
    let graded = lit;
    try {
      // SSRNode SAMPLES its colour input at arbitrary UVs (`this.colorNode.sample(...)`),
      // so it must be handed a real texture node, not a computed expression. Passing
      // `lit` threw `TypeError: this.colorNode.sample is not a function` at build time.
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
    const glints = bloom(
      vec4(graded, float(1)), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD,
    );
    const bloomed = graded.add(glints.rgb);
    const dist = length(uv().sub(0.5));
    const shade = float(1).sub(
      smoothstep(float(VIGNETTE_INNER), float(VIGNETTE_OUTER), dist).mul(VIGNETTE_DEPTH),
    );

    // Diagnostic outputs. "The chain runs" and "the chain does anything" are different
    // claims, and this project has already shipped the first while believing the
    // second. `?post=ao` renders the remapped occlusion term, `?post=off` the ungraded
    // scene colour. Both take the SAME route as the real frame, so what you photograph
    // is what the player is looking at, and both go through the renderer's output pass
    // - their pixels are DISPLAY values, not linear ones.
    const debug = typeof location !== 'undefined'
      ? new URLSearchParams(location.search).get('post')
      : null;
    let outputNode;
    if (debug === 'ao') {
      // The occlusion term only ever spans [1 - AO_STRENGTH, 1], and the output pass
      // then runs it through ACES, which packs that whole band into display 196..229
      // - 33 of 255 levels. Shown raw it is a white sheet whatever the AO is doing,
      // which is trap 4 in docs/HANDOFF.md and exactly how a dead GTAO passed for a
      // working one. So this view rescales the term onto 0..1 first: WHITE means AO
      // is doing nothing here, BLACK means it is applying its full AO_STRENGTH. It is
      // a contrast stretch of the diagnostic only - the graded frame below is
      // untouched, and these are still display values, not linear ones.
      const aoView = occlusion.sub(float(1 - AO_STRENGTH)).div(float(AO_STRENGTH));
      outputNode = vec4(vec3(aoView), float(1));
    }
    else if (debug === 'off') outputNode = vec4(color.rgb, float(1));
    else outputNode = vec4(bloomed.mul(shade), float(1));

    // Our own full-screen quad, NOT PostProcessing — see note 2 at the top of this
    // file. The node is LINEAR; the renderer's output pass applies ACES + sRGB once,
    // into the same frame-buffer target the viewmodel overlay draws into afterwards.
    const material = new NodeMaterial();
    material.name = 'PostChainOutput';
    material.fragmentNode = outputNode;
    material.depthTest = false;
    material.depthWrite = false;
    material.fog = false;
    const quad = new QuadMesh(material);

    // A node graph only builds on the FIRST render, so a malformed node throws deep
    // inside the frame loop rather than at construction - which is how a broken chain
    // stayed invisible behind a try/catch that only wrapped construction. Degrade to
    // direct rendering on the first failure, once, and say so loudly. Note that by
    // then the MRT shaders are already cached (rule 1), so the direct fallback may
    // itself draw nothing: it is a diagnostic of last resort, not a safety net.
    let chainBroken = false;
    return {
      render: () => {
        if (chainBroken) {
          renderer.render(scene, camera);
          return;
        }
        try {
          quad.render(renderer);
        } catch (err) {
          chainBroken = true;
          console.error('[post] chain failed at render; falling back to direct '
            + 'rendering for the rest of this session. The frame you are looking at '
            + 'has NO ambient occlusion, reflection, bloom or vignette.', err);
          renderer.render(scene, camera);
        }
      },
      setSize: (w, h) => {
        // Effect nodes (GTAO/denoise/SSR/bloom) re-derive their targets from the
        // drawing buffer every frame in updateBefore(); only the scene pass
        // needs an explicit resize alongside the renderer.
        renderer.setSize(w, h);
        scenePass.setSize(w, h);
      },
      dispose: () => {
        material.dispose();
        scenePass.dispose();
      },
      enabled: true,
      backend: 'webgpu',
    };
}
