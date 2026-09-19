# Local street reflections: bounded r180 proposal

Status: design only. No renderer, material, geometry, harness, build, browser, or
server change is included here.

## Decision

**PROPOSED:** run one WebGPU A/B experiment through the existing screen-space
reflection (SSR) pass, changing only the shared `windowDark` metalness from `0.16`
to `0.35`. Keep its `roughness: 0.12`, `envMapIntensity: 2`, and every SSR uniform
unchanged. This is the smallest experiment that can expose nearby bus, house, pole,
or street pixels already visible in the camera without adding a light, material,
texture, render target, or scene capture.

The `0.35` value is an **SSR eligibility/weight experiment**, not a claim that the
glass is physically metallic. In the installed r180 SSR implementation, metalness is
both a zero/non-zero gate and a contribution multiplier. At the current `0.16`, the
maximum raw SSR alpha before distance and Fresnel attenuation is `0.55 * 0.16 =
0.088`; at `0.35` it is `0.1925`. The change should therefore make an existing local
hit observable while remaining below the map's steel (`0.7`) and chrome (`0.95`)
families. If it only brightens the blue sky tint, the experiment fails.

**OPEN:** transparent `glass` is currently `metalness: 0`, so r180 SSR discards it.
This proposal does not make a false claim that the transparent house panes or roof
lantern have local reflections. A later mask or capture design is needed for those
surfaces if the A/B cannot prove the opaque `windowDark` bands first.

## Source evidence (installed three 0.180.0)

These are source/runtime observations from the worktree's installed package, not
assumptions from a newer Three.js release.

* **VERIFIED:** `src/core/post.ts:370-376` writes `output`, `normal`, `metalness`,
  `roughness`, and depth through one scene MRT. `src/core/post.ts:516-521` constructs
  r180 `ssr(color, depth, normal, metal, rough, camera)` with
  `maxDistance = 12`, `thickness = 0.3`, and `opacity = 0.55`. The color input is the
  real texture node, which is required because r180 `SSRNode` samples arbitrary UVs.
* **VERIFIED:** r180 `examples/jsm/tsl/display/SSRNode.js:444-447` discards fragments
  whose metalness is zero. Its `:577-584` path starts the output alpha at
  `opacity * metalness`, then applies distance attenuation and Fresnel. Its
  `:569-580` ray is screen-space and stops at `maxDistance`; it cannot see geometry
  outside the current frame or behind an occluder.
* **VERIFIED:** `src/core/materials.ts:794-804` defines transparent `glass` as
  `metalness: 0`, `roughness: 0.08`, while opaque `windowDark` is
  `metalness: 0.16`, `roughness: 0.12`, and `envMapIntensity: 2`.
  `src/build/vehicles.ts:319`, `:517`, `:671`, `:1022`, and `:1101` route the bus
  glazing through `windowDark`; house and prop glazing also use both shared families.
* **VERIFIED:** `src/core/world.ts:144-153` assigns `scene.environment` from
  `createEnvironmentTexture()`. `src/core/atmosphere.ts:316-344` and `:389-394`
  show that this is a 512x256 CPU-baked sky/horizon/sun DataTexture, not a capture of
  scene geometry. `:949-955` only rebakes it on a preset update. It can provide sky
  glints, but it cannot produce a nearby bus, pole, house, or street reflection.
* **VERIFIED:** the candidate frame
  `captures/candidate-stock-circle.png` shows broad sky-coloured bus/house glazing
  with no visually identifiable local feature. The photoreal target
  `C:\Users\david\Documents\Codex\2026-09-19\hi\work\target-viewmodel\target.png`
  is a look reference only; it is not a game-space ground truth and must not be used
  as an automated pixel target.
* **VERIFIED:** actual backend selection is exposed by
  `window.__NT_BACKEND.actual` (`src/core/renderer.ts:54-57, 95-117`) and the post
  chain reports `window.__NTPOST.backend`. The experiment must claim a reflection only
  from an actual `webgpu` run.

## CubeCamera assessment

The answer is nuanced rather than a blanket yes or no.

* **VERIFIED engine support:** r180
  `node_modules/three/src/renderers/common/CubeRenderTarget.js:16-18` explicitly
  describes `CubeRenderTarget` as compatible with `WebGPURenderer`. The WebGPU backend
  uses `activeCubeFace` as the base array layer in its render attachment view
  (`node_modules/three/src/renderers/webgpu/WebGPUBackend.js:408-450`). `CubeCamera`
  is exported by `three/webgpu`, and its `update()` method renders faces 0 through 5
  (`node_modules/three/src/cameras/CubeCamera.js:206-226`). Thus a one-time cube
  capture is technically possible in the r180 internals.
* **VERIFIED package limitation:** `three/webgpu` exports `CubeCamera`, but does not
  export `CubeRenderTarget`; the installed r180 module probe returned
  `{ CubeRenderTarget: false, CubeCamera: true, WebGPURenderer: true, revision: 180 }`.
  `WebGPURenderer` also has no public `createCubeRenderTarget()` method. The class is
  only available through the private source path
  `three/src/renderers/common/CubeRenderTarget.js`. That makes a new cubemap route
  source-path-coupled and unsupported at the package API boundary.
* **VERIFIED cost:** `CubeCamera.update()` performs six scene renders even for a
  static capture. A 256px RGBA16F cube is about 3 MiB of color storage before depth,
  mip levels, and backend overhead; every additional reflection anchor repeats the
  capture/resource cost. One cube at the map centre is also not view-correct for
  every bus or house window. It would need reflective meshes hidden during capture,
  careful material assignment, and a test that the capture does not poison the
  current MRT-first shader path.

Therefore **OPEN / follow-up only:** r180 internals can support a carefully isolated
one-time capture, but the current app has no public package-level constructor and the
capture is materially larger than the existing SSR/material experiment. Do not claim
that a static CubeCamera is already a supported production route. If the SSR A/B fails,
the owner can separately approve a private-source CubeRenderTarget spike with an
explicit six-render and memory budget.

## Measured experiment

Use the exact camera/viewport that produced `candidate-stock-circle.png` and the same
scene seed/build for both variants.

1. **Admission.** Require `window.__NT.ready === true`,
   `window.__NT_BACKEND.actual === 'webgpu'`, `window.__NTPOST.backend === 'webgpu'`,
   and no page/runtime errors. A WebGL2 fallback is useful for regression comparison
   but cannot be admitted as evidence for this proposal.
2. **Baseline.** Warm the same view for two frames. Record five or more
   `window.__NT.stats()`/`measureFrame()` samples, plus the screenshot. Record
   `calls`, `triangles`, `geometries`, `textures`, `programs`, and render invocations.
   Capture the same view once with `__NTPOST.setEffects({ao: true, ssr: false,
   bloom: true})` and once with SSR enabled. This establishes that any window delta
   is actually coming from the existing SSR term rather than the sky environment.
3. **Single change.** Rebuild the candidate with only
   `windowDark.metalness: 0.16 -> 0.35`. Keep all geometry, lighting, atmosphere,
   post values, camera, and viewport identical. Repeat the baseline/SSR-on and
   SSR-off captures. Do not change `glass`, `roughness`, `maxDistance`, `thickness`,
   or SSR `opacity` in the same trial.
4. **Visual admission.** Inspect the upper bus window bands and a house `windowDark`
   band in the paired images. A PASS requires at least two identifiable nearby scene
   edges (for example a pole, house edge, adjacent vehicle, kerb, or mullion) to appear
   as reflected structure inside the glazing. A broad blue/white luma change, a sun
   gradient, or extra bloom is not a local reflection. If the harness can hold the
   view while yawing a few degrees, the reflected edges should move relative to the
   glass; use this as a stronger discriminator than a single still.
5. **Pixel support.** Within manually recorded glazing ROIs, require the SSR-on minus
   SSR-off delta to contain the same local edge features visible in the image review.
   Edge energy or variance alone is insufficient: it can pass from noise, sky tint, or
   aliasing. The target2D image is not used for this measurement.
6. **Budget gate.** The material change must introduce no new scene render, light,
   geometry, texture, or shader program after warm-up. `calls`, `triangles`, resource
   counts, and render invocation counts must remain equal to baseline within the
   measurement method's known counter granularity. Follow the existing light-lane
   budget of under 16 ms at 1920x1080 and report mean/p95 frame time; reject a variant
   that crosses that limit or leaks resources during a short static soak.

## Failure handling and hazards

* If SSR-off and SSR-on are indistinguishable in the glazing ROIs, record **OPEN**:
  the current scene-space rays do not expose a useful local hit. Do not increase
  opacity, max distance, or thickness just to make a screenshot change.
* If the variant shows only a stronger sky wash, record **FAIL** for the experiment.
  That is environment response, not the requested local reflection.
* SSR is screen-space. A pole or house outside the frame, behind the bus, or beyond
  12 m cannot appear. This is a capability boundary, not a threshold to hide.
* The transparent `glass` family remains outside this A/B because r180's SSR metalness
  gate discards it. Applying the opaque material's metalness workaround to transparent
  panes would change their lighting model and still would not prove transmission.
* Keep the current raw `color` texture input to `ssr()`. Feeding computed `lit` or
  another expression would violate the r180 `sample()` requirement documented in
  `src/core/post.ts:512-516` and can fail at graph build time.
* Keep WebGL2 fallback behavior unchanged. If the post chain is unavailable, the sky
  environment remains the only reflection source and the result must be labelled
  **OPEN**, regardless of how attractive the tint looks.

No claim of local reflection is VERIFIED until the same-build WebGPU A/B has both a
visible local feature and the corresponding SSR-on/off evidence.
