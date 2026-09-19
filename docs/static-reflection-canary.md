# Static reflection canary

Status: source-only canary. Root owns runtime integration, WebGPU capture,
browser review, and the decision to keep or remove it.

## Decision

The canary is one startup-only street cube probe bound to one opaque `windowDark`
material. It uses the pinned r180 private import
`three/src/renderers/common/CubeRenderTarget.js` because r180's public
`three/webgpu` bundle does not expose that constructor. The private coupling is
deliberate and must stay documented if this route survives review.

The probe defaults to a 128 px cube and permits at most 256 px. It allocates four
RGBA16F cube attachments, one per scene MRT output:

| attachment | texture name | color space |
|---|---|---|
| 0 | `output` | `LinearSRGBColorSpace` |
| 1 | `normal` | `NoColorSpace` |
| 2 | `metalness` | `NoColorSpace` |
| 3 | `roughness` | `NoColorSpace` |

The default 128 px estimate is 3,538,944 bytes for six faces of color plus a
conservative six-face 32-bit depth allowance. The 256 px cap estimates 14,155,776
bytes, below the 20 MiB resource ceiling. Mipmaps are disabled. This is an estimate,
not a driver allocation measurement.

## Why four cube attachments are mandatory

The existing post chain compiles the world against one MRT tuple:
`output`, `normal`, `metalness`, and `roughness`. r180's `RenderObject` material
cache key does not include `renderer.getMRT()`. A direct cube render with the default
single color attachment can therefore reuse an MRT-compiled material while the
target has only one output, or compile a single-output variant that later breaks the
four-attachment scene pass.

`static-reflection-probe.ts` gives every cube face all four cube attachments and
installs the caller's existing MRT node for all six `CubeCamera` renders. It does not
invent a second MRT node or render existing MRT-compiled materials to a single output.
The attachment names are set before the render, so r180's `MRTNode.setup()` resolves
the same output indices on every face.

The source evidence is the installed r180 code:

- `src/core/post.ts` creates the scene tuple with `mrt({ output, normal, metalness, roughness })`.
- `node_modules/three/src/nodes/core/MRTNode.js` resolves each output by attachment name.
- `node_modules/three/src/cameras/CubeCamera.js` performs six face renders.
- `node_modules/three/src/renderers/common/CubeRenderTarget.js` is the WebGPU-compatible
  private target class; its inherited target options support `count`, `type`, and depth.

## API seam

The module exports `createStaticReflectionProbe()` from
`src/core/static-reflection-probe.ts`:

```ts
const probe = createStaticReflectionProbe({
  renderer: world.renderer,
  scene: world.scene,
  anchor: streetProbeObjectOrPosition,
  material: mat.windowDark,
  mrt: existingSceneMrt,
  reflectiveMeshes: selectedWindowMeshes,
  size: 128,
});

const result = await probe.capture();
// Admit only result.status === 'captured' on actual WebGPU.
// probe.dispose() restores the material's previous envMap and frees the target.
```

`mrt` is optional only for convenience: the implementation falls back to
`renderer.getMRT()`. Capture returns `blocked` without rendering when the actual
backend is not WebGPU or the tuple is absent/missing any of the four required names.
The caller must pass the tuple used by the existing scene post pass when startup
state does not currently expose it.

The `reflectiveMeshes` list is explicit. Only those objects are hidden temporarily
to avoid self-reflection; their visibility is restored in `finally`. Passing a light
is rejected, and the module never hides or changes lights. Renderer target, active
cube face/mipmap, MRT, XR, auto-clear, viewport, scissor and scissor-test state are
saved and restored even when capture throws.

The target is bound to `material.envMap` only after all six renders and
`renderer.waitForGPU()` complete. Disposal restores the prior environment map and
marks the material for its original shader state. The probe has no animation-loop
callback, per-frame allocation, per-frame CPU work, new light, or update subscription.
After startup it contributes zero extra draws per frame; the cubemap is sampled by
the existing material draw.

## Root integration gate

Integration must happen at a point where the existing scene MRT tuple can be passed
explicitly. Do not call `renderer.render(scene, cubeCamera)` directly from a new
startup hook with `renderer.setMRT(null)`. Do not use `CubeRenderTarget`'s default
single attachment. Do not hide the world light rig during capture.

The root acceptance sequence is:

1. Verify the actual backend is `webgpu` and the existing post chain is alive.
2. Supply the exact scene MRT node and selected opaque `windowDark` meshes.
3. Capture once, wait for GPU completion, then render the normal post-chain frame.
4. Compare the selected glazing at the same street camera before/after binding. A
   broad sky wash does not prove a local reflection; identifiable nearby edges must
   appear and move plausibly when the view yaws.
5. Confirm six startup cube renders only, zero extra steady-state draws, no shader
   compile failure, no resource growth, and target allocation under 20 MiB.
6. On any failure, dispose the probe and retain the existing environment/SSR route.

This file and the module establish a bounded canary only. They do not claim that a
local reflection is visually accepted or that the current runtime has integrated it.

## Root canary verdict, 2026-09-19 12:57 local

VERIFIED: both street-height and elevated (0,4.2,0) captures rendered six cube faces
on actual WebGPU, passed normal-frame draw/triangle budgets and had no console
errors. Disposal restored the material. The first startup attempt failed because
r180 init() is not idempotent; hasInitialized() now guards it, and the failure is
preserved in captures/reflection-canary/initialization-failure.json.

OPEN / NOT ACCEPTED: viewed streetElevation and turningHead images show darker
vehicle glass, with no identifiable local reflected edge. The elevated correction
also failed the visual objective. The canary remains QA-only; no startup capture
or default material replacement is enabled. Do not mistake its mechanical PASS
for accepted local reflections. Stop this loop at two positions; a later pass must
inspect cube-face pixels/PMREM conversion before spending another visual iteration.
