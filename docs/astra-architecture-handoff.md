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

Payload: 7,314,524 texture bytes plus a small JSON manifest (below 8 MB). Four
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

Repair log: no visual repairs yet (two available). One pre-handoff TypeScript
failure (number-array used where TSL vec2 was required) was corrected without
weakening a check. Frozen criteria and failed evidence remain unchanged.
