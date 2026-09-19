# Static reflection cube diagnosis

Status: read-only diagnosis against the exact recovery tree and installed Three.js r180 source. No runtime, browser, renderer, build, or server changes were made in this pass.

## Verified scope and observations

- **VERIFIED:** the worktree is at `232e13b`; the installed package is Three.js `0.180.0`.
- **VERIFIED:** `src/core/static-reflection-probe.ts:117-141` creates a 128 px `CubeRenderTarget` with four RGBA HalfFloat attachments, depth, linear filtering, and mipmaps disabled. The primary texture is a `CubeTexture`; the other three attachments are cloned cube textures and are marked as render-target textures.
- **VERIFIED:** `src/core/static-reflection-probe.ts:229-247` admits only actual WebGPU, installs the four-output MRT, renders the six `CubeCamera` faces, and awaits `renderer.waitForGPU()` before binding.
- **VERIFIED:** `src/core/static-reflection-probe.ts:249-251` binds the primary cube to `material.envMap` and sets `material.needsUpdate`. It does not explicitly run PMREM; r180's node material path performs that lazily during a later material render.
- **VERIFIED:** `src/main.ts:455-470` first renders the normal post chain, then uses `world.post.captureMrt` and a fixed probe position `(0, 4.2, 0)`. The current source therefore proves one probe position. The two canary image names are camera stations, not evidence of two source-level probe anchors.
- **VERIFIED:** `src/core/post.ts:369-374` defines the scene MRT names as `output`, `normal`, `metalness`, and `roughness), matching the probe contract.
- **VERIFIED:** `captures/reflection-canary/result.json` reports actual WebGPU, `status: "captured"`, six faces, no captured console errors, and frame budgets of 843/892 calls and 323,637/379,427 triangles. The mechanical canary passed.
- **VERIFIED:** the viewed `streetElevation-probe.png` and `turningHead-probe.png` show darker vehicle glazing but no identifiable nearby reflected edge. This is a visual observation, not proof of which stage failed.
- **VERIFIED:** the probe changes the screenshots: baseline-to-probe mean absolute RGB difference is approximately `[2.3417, 3.7318, 4.7945]` at `streetElevation` and `[0.5799, 0.6811, 0.7717]` at `turningHead`. A luma change does not prove a local reflection.

## What the pinned r180 path proves

Three r180 details narrow the diagnosis:

1. `CubeCamera.update()` renders faces 0 through 5 and sets `renderTarget.texture.needsPMREMUpdate = true` after the render (`node_modules/three/src/cameras/CubeCamera.js:202-233`). There is no evidence of a forgotten PMREM update flag in the probe module.
2. `MeshStandardNodeMaterial.setupEnvironment()` reads an explicit `material.envMap` as a cube texture reference (`node_modules/three/src/materials/nodes/NodeMaterial.js:914-928`). `EnvironmentNode` then wraps that texture in `pmremTexture()` and caches it by source texture (`node_modules/three/src/nodes/lighting/EnvironmentNode.js:48-68`).
3. PMREM conversion is lazy. `PMREMNode.updateBefore()` compares `pmremVersion`, checks that all six image entries exist, and calls `PMREMGenerator.fromCubemap()` (`node_modules/three/src/nodes/pmrem/PMREMNode.js:42-87, 264-303, 346-370`). The probe's `waitForGPU()` only proves completion of the six raw cube renders; it does not prove that the first post-bind material render produced and sampled a PMREM target.

The current source therefore establishes a real raw-cube-to-material seam, but it does not establish that the raw cube's pixels are useful or that the PMREM result is non-null and sampled by the final glazing draw.

## Ranked hypotheses

1. **Highest value to test: raw cube content versus lazy PMREM output.** The source has a valid update flag and six-face render, but no face-pixel readback and no PMREM readiness receipt. A cube can mechanically render and still produce a visually uninformative environment or a PMREM path that has not settled when the screenshot is taken.
2. **MRT/output attachment mismatch remains possible.** The other three cube attachments are contract protection for the scene material cache. The material samples attachment 0, so a readback of `textureIndex: 0` is required; the current canary only measures the final canvas.
3. **Material response may suppress local structure.** `src/core/materials.ts:811-813` gives `windowDark` metalness `0.16`, roughness `0.12`, and environment intensity `2`. This can make a real but weak cube appear as a dark tint. The captures alone cannot distinguish this from a bad PMREM/cube.
4. **Anchor provenance is narrower than the report language.** The checked `main.ts` wires only `(0,4.2,0)`; any claim that this source captured both `(-8,2.1,-8.5)` and `(0,4.2,0)` needs a separate source or runtime receipt.

No single hypothesis is admitted as the root cause from the two screenshots.

## Bounded next diagnostic

Stop the visual iteration. Root should run one source-instrumented, QA-only diagnostic at the existing canary path:

1. Immediately after capture, record the primary cube's `uuid`, `mapping`, `isCubeTexture`, `isRenderTargetTexture`, `image.length`, six face dimensions, `pmremVersion`, target attachment count, and whether `mat.windowDark.envMap === probe.texture`.
2. Before the first post-bind frame and after five warmed frames, record `renderer.info.memory.geometries/textures`, `probe.texture.pmremVersion`, and the material/cube identity. Keep the same camera station and do not change material values.
3. Use r180's existing `renderer.readRenderTargetPixelsAsync(renderTarget, x, y, width, height, textureIndex, faceIndex)` API (`node_modules/three/src/renderers/common/Renderer.js:2628`) on a small readback from `textureIndex 0`, all six faces. Report per-face min/max/mean. This is the decisive split:
   - varied face pixels plus a settled PMREM and no local glazing edge points to material response or reflection direction;
   - flat/empty face pixels points to capture, MRT, target attachment, or output encoding;
   - valid faces with null/no-change PMREM points to readiness/identity or the lazy conversion path.
4. Repeat capture/dispose three times without screenshots and record memory after each cycle. The existing canary reports baseline `562` geometries/`126` textures, probe `572`/`135`, and disposed `572`/`130`. **VERIFIED:** disposal removes the input target allocation from the reported texture count but leaves a same-process `+10` geometries and `+4` textures at that point. **OPEN:** the exact ownership of that residual is not proven; r180's PMREM cache and generator are the leading explanation (`PMREMNode.js:42-87`), because `static-reflection-probe.ts:268-277` disposes only the cube target and does not dispose PMREM resources. A repeat cycle distinguishes a fixed warm-cache residue from growth and must pass before this canary is made reusable or startup-default.

Acceptance for this diagnostic is a machine-readable raw-face/PMREM receipt, no visual claim, and no cycle-to-cycle growth. Keep the existing SSR/environment route as the admitted reflection path until that receipt exists.
