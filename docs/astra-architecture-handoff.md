# Architecture material canary — frozen intent, 2026-09-20

Status: CPU-verified candidate; visual acceptance OPEN. Authoring starts 06:50 BST,
bounded to 45 minutes before root's independent pixel gate. At most two visual
repairs, then change approach. Stop by 08:58 BST regardless of remaining work.

## Frozen targets and falsifiers

- At unchanged spawnA and interiorOrange cameras, replace visibly stretched,
  repeated flecks with coherent fine plaster relief and restrained broad wear.
  Timber must acquire recognisable grain instead of regular painted stripes.
- Preserve cream/terracotta/wood palette families and existing material identities.
  A darker frame or added contrast alone does not satisfy this target.
- Use metre-space mapping so a doorway reveal, wall and roof share the same grain
  scale. No UV/mesh/collider edits, lights, per-frame updates or new scene draws.
- Four owned maps, maximum 8 MB total packaged assets and 24 MiB decoded runtime
  textures including mipmaps. Root measures actual GPU costs; CPU estimates do not
  establish frame rate. No runtime network dependency beyond local static assets.
- Reject obvious seams on rounded capsule walls, crawling grain during motion,
  false board seams across posts, lost interior readability or accidental ground
  changes. Keep failed captures and repair history.

Scope: `stuccoCream`, `stuccoTerracotta`, `capsuleWhite`, `interiorWall`,
`roofWhite`, `timber`, `timberDark`. The ground concrete, deck and fence families
have separate asynchronous PBR owners and are deliberately excluded.

Compared actual root `captures/gauntlet/glazing/round-r1-0648/after-spawnA.png`
and `after-interiorOrange.png` with the frozen references:
`photoreal/stucco-wall-sun-shade-ratio-01.png`, `-02.png`, and
`photoreal/timber-fence-kerb-shadow-01.png`. These guide surface response; they are
not source textures. The root frozen VISUAL-BAR.md remains unchanged.

## Source and assembly contract

Two genuine downloaded CC0 scan sets from Poly Haven, with original files, source
URLs, publisher MD5 and local SHA-256 in assets/architecture-pbr/provenance.json.
Technical channel packing and a single seam-free plank crop are labelled as
derivations. No generated photographs, borrowed game art or reconstructed models.

`await installArchitecturalMaterials(mat)` immediately after `buildMaterials()` and
before builders/first render. `?architecture=canary` enables it; other values are
off. The installer wraps the existing library disposer and restores it on disposal.
Failed loads leave original borrowed maps untouched and dispose partial resources.
No atmosphere contract is needed: the PBR graph uses the existing scene lighting,
including the authored HDR environment and time-of-day transitions.

Existing material identities are preserved using enumerable node hooks. Three r180
`NodeLibrary.fromMaterial` copies their properties into its standard node adapter;
WebGPURenderer uses that adapter with both WebGPU and its WebGL2 fallback backend.
No `onBeforeCompile`, prototype mutation or live renderer switch is introduced.

Primary implementation sources (installed r180 checked before use):
- https://threejs.org/docs/llms.txt
- https://github.com/mrdoob/three.js/blob/r180/src/renderers/common/nodes/NodeLibrary.js
- https://github.com/mrdoob/three.js/blob/r180/src/nodes/utils/TriplanarTextures.js
- https://github.com/mrdoob/three.js/blob/r180/src/nodes/accessors/Normal.js
- https://polyhaven.com/license
- https://polyhaven.com/a/white_plaster_rough_01
- https://polyhaven.com/a/brown_planks_09

## Verification and remaining gate

VERIFIED: `npm run check`, `npm run build`, and
`node scripts/check-architectural-materials.mjs` pass. CPU checks exercise seven
unchanged material identities; r180's actual StandardNodeLibrary preserves all
three hooks; 10,000 repeated installer calls retain the same promise, maps and
graph; explicit and library disposal release each owned map once; missing-file
rollback is retryable; teardown during pending loads leaves original maps intact.
All ten source/derived texture hashes and the PNG dimensions match provenance.
Normal-map finite/unit checks measured maximum length error 0.00536 after 8-bit
encoding. No GPU/browser/Blender process was launched by this lane.

Repair-1 payload: 7,247,779 texture bytes plus a small JSON manifest (below 8 MB). Four
runtime maps: plaster 1024x1024 x2, timber 1024x256 x2. Conservative RGBA8 decoded
estimate with mipmaps is 13,981,014 bytes (13.33 MiB). There are six texture samples
per shaded pixel (three projections each for packed surface and normal), compared
with the original three UV samples. Actual GPU time remains OPEN. Original unused
maps remain borrowed library resources and are neither overwritten nor disposed.

The local production build does not apply the separate assembly patch and may
tree-shake this unused installer. The CPU fixture explicitly bundles/imports it;
root must build the assembled candidate and boot both renderer paths.

Known limitation: timber grain follows world vertical on vertical faces; horizontal
beams using the same shared material do not have object-specific longitudinal
grain orientation. The crop removes artificial board joints/nail rows. Inspect
this at spawnA before accepting it; an object-orientation integration contract
would be a separate bounded correction if needed. The shader does not pretend to
add physical relief silhouettes or cracks.

Root owns same-station spawnA/interiorOrange/yardWhite pairs, WebGPU + WebGL2 boot,
resource counts, moving-camera stability, disposal soak and visual acceptance.
Use unchanged glazing and `lighting=authored` alongside `architecture=canary`.
Keep geometry/draw/light counts stable; inspect rounded capsule blending and the
one-metre plaster scale. No lighting refresh hook or per-frame update is required.

## Visual repair 1 — rejected source preserved

The initial candidate `c3d5504` is REJECTED visually. Parent reports its assembled
source `6158ab2` booted eight frames without errors or new draws, but root's actual
`captures/gauntlet/architecture/round-0715/after-spawnA.png` and
`after-interiorOrange.png` visibly show scalloped/mould-like wall bands, cloudy
timber and a dirty roof underside. Inspected both against `before-spawnA.png`.
This rejection is not overridden by the initial CPU pass. The rejected maps remain
recoverable in Git and the raw licensed inputs remain byte-identical.

Cause: the source scan's metre-scale staining and low-frequency normal slopes were
repeated as wall relief. Timber's broad board-colour clouds similarly outweighed
grain after minification. This repair locally normalizes linear scan luminance
and high-pass filters normal slopes before packing; it does not blindly reduce
the existing normal/colour profile strengths. Fine scanned relief, grain and
roughness remain. World-space application variation is bounded to +/-1.7% over
building-scale distances rather than repeating source dirt at every metre.

Frozen repair controls (`python scripts/pack-architecture-textures.py --check`):
local-normal slope RMS <0.005 and broad packed-luminance std <0.016; fine-slope
RMS >0.015 and fine-colour std >0.04 so a flat replacement cannot pass. The raw
source must FAIL both broad-frequency controls. Timber's physical across-grain
gradient must exceed along-grain by 1.3x (measured 1.80x). The check mode is read-only
and verifies deterministic byte equality with the recipe.

VERIFIED results: plaster broad-slope RMS 0.07780 -> 0.00089, timber 0.02877 ->
0.00268; broad-colour std 0.04146 -> 0.00596 and 0.05074 -> 0.01062, respectively.
Fine-slope RMS remains 0.03774/0.03866. All lifecycle/hash checks and `npm run check`
pass. Four textures, dimensions, material scope, draw count contract and assembly
API remain unchanged. No GPU used by this lane.

OPEN fixed-image acceptance: spawnA cream and terracotta walls must lose the
vertical scallop rows; the roof underside must read clean matte cream; the timber
post/chair should show fine directional grain instead of broad muddy clouds.
InteriorOrange must lose the repeated wet-looking bands while retaining fine
plaster detail. Root must compare against BOTH original baseline and rejected
round-0715 pixels. One visual repair remains after this candidate.
