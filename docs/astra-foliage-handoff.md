# Branch-led leaf canary — 2026-09-20

OPEN: source candidate, not visual acceptance. Root owns fixed-camera WebGPU review,
moving-camera alpha stability, shadow coverage, runtime cost and promotion. Maximum
two visual repairs; no GPU/browser/Blender was run in this lane.

VERIFIED: runtime scope is `src/build/vegetation-tree.ts` and the new
`src/build/vegetation-foliage-canary.ts`. Add `foliage=canary` to the existing root
URL. No assembly edit or new material/asset loader is needed. Default/off uses the
old builder. Missing or alpha-blended leaf material preserves the old presentation
and marks `group.userData.foliageCanary = 'unavailable-cutout-material'`.

VERIFIED: before editing, `docs/astra-foliage-baseline.json` froze the ten actual
yard specs from seed `nuketown-2025:yards`, all crown vertex bounds, the complete
78-collider hash, budgets and fixed-camera criteria. The one-shot freeze script
refuses to overwrite this file. Frozen4212, root source and the visual bar were not
modified. Quiver trees, shrubs and yard RNG/collider code were not changed.

VERIFIED: the baseline emits 30 opaque low-resolution green canopy lobes and 4,000
leaf blades. The canary removes the opaque lobes and builds 12,800 alpha-tested
leaves in 3,200 shared four-leaf sprays, plus 120 tapered secondary twig segments.
The original trunk/root/major-branch geometry and instance matrices remain exact.
Leaves retain the existing palette/material/normal/roughness maps, with restrained
per-spray pigment variation. Each rectangular card respects its atlas leaf's aspect
ratio; the scan mask supplies the outline instead of pinching an already cut-out
leaf into an almost square card. Different leaf inclinations avoid one flat plane
per spray. Branch and crown descriptors still determine the main canopy lobes.

VERIFIED budgets across all ten trees: 19,760 → 29,360 submitted geometry triangles
(+9,600, limit +12,000); 5 → 5 meshes before batching (+0, limit +4); no new textures,
materials, lights, downloads, shadow maps or frame callbacks. A CPU invocation of
the actual static batcher reduces the isolated tree group 3 → 2 meshes with distinct
bark/solid-leaf/cutout materials. Whole-map renderer calls remain OPEN for root to
measure. Leaves already exceeded the batcher's instance expansion limit; the new
3,200-instance leaf mesh also stays intact, including its per-instance colours.

VERIFIED ownership: the two removed baseline meshes and their private geometries
are disposed before the group reaches a renderer. New geometry/instance buffers
belong to the returned tree group; normal teardown can dispose each active mesh and
geometry. Every material/texture remains borrowed from MaterialLibrary and is never
disposed by this helper. Independent builds have independent geometry ownership.
There are no per-frame allocations or scene/light topology updates.

VERIFIED CPU checks: `node scripts/check-foliage-canary.mjs`, `npm run check` and
`npm run build` pass. The targeted test verifies real-yard collider parity, exact
trunk matrices, per-vertex crown containment, whole-tree twig containment, finite
positions/matrices, deterministic instances, constant shared geometry footprint,
draw/triangle limits, real static-batcher compatibility, fallback behavior,
disposal ownership and all four source texture hashes. A deliberately translated
leaf instance fails the unchanged bounds assertion; missing/blended alpha material
retains the baseline. Results are in `captures/astra-foliage-cpu/report.json`.

OPEN fixed-image acceptance, frozen before implementation:

- `turningHead`: replace opaque green balls with irregular fine leaf edges and
  visible connected woody forks; avoid sparse floating confetti or bare twig crowns.
- `spawnA` and `yardWhite`: retain the established crown envelopes, trunk locations,
  house/road sightlines and green palette. Denser leaf detail alone is insufficient.
- Moving camera: no rectangular cards, thin sparkling edges, shadow flicker or
  unstable cutout popping. Existing leaf alpha testing/texture filtering is unchanged.

VERIFIED reference inspection: actual root `glazing/round-r1-0648/after-turningHead`
shows the opaque-lobe defect. The frozen shot matrix points to gameplay
`f-aICKIbuo8zQ-030.jpg` (turningHead), `g-1icNQzMgLUM-100.jpg` (yardWhite) and
`f-FKQOEO-1ceE-026.jpg` (spawnA); inspected all three. They establish composition and
palette but most trees are outside those original game frames, so they do not prove
botanical fidelity. `refinement-targets/yard-white.png` is an illustrative generated
target, not a real photograph or an accepted runtime result. No photorealism claim.

VERIFIED provenance: new branch/leaf-card geometry is original deterministic code
authored in this standalone project. It reuses only the existing CC0 scanned leaf
maps from [Poly Haven island_tree_01](https://polyhaven.com/a/island_tree_01),
credited there to Rico Cilliers and Rob Tuytel. The unchanged
`public/textures/vegetation/manifest.json` contains original download URLs, byte
sizes and exact SHA-256 hashes for albedo, alpha, OpenGL normal and roughness maps.
The [Poly Haven licence](https://polyhaven.com/license) identifies assets as CC0.
This slice adds zero texture payload. No AI image generation or imported mesh.

VERIFIED workflow/source: read the shared canonical vegetation skill through
`C:/Users/david/.codex/skills/threejs-procedural-vegetation/SKILL.md`; used its
instancing, alpha-test, bounding-volume and disposal workflow, not copied source.
Consulted current [Three docs](https://threejs.org/docs/) and checked installed
Three 0.180.0 implementation before API use:
[InstancedMesh r180](https://github.com/mrdoob/three.js/blob/r180/src/objects/InstancedMesh.js),
[BufferGeometry r180](https://github.com/mrdoob/three.js/blob/r180/src/core/BufferGeometry.js).
No renderer/engine migration or custom shader graph was introduced.
