# Street-lamp geometry canary — 2026-09-20

OPEN: actual pixel/motion/runtime acceptance belongs to root. This source candidate
has not been booted on GPU in the worker lane. Maximum two visual repairs; none used.

VERIFIED integration: cherry-pick the lamp commit and append `street-lamps=canary`
to the candidate URL. Runtime changes are only the new
`src/build/street-lamps-canary.ts`, its import, and the lamp subsection of
`src/build/yards.ts`. No main/material/world integration is needed. Off/default
retains all original lamp primitive calls. The canary collects the exact eight
existing normalized foot/direction inputs before the original geometry calls and
emits three shared borrowed-material groups once, before any rendering.

VERIFIED geometry: the original four cylinders plus three faceted spheroids per
lamp become a continuous tapered pole/arm, flanged shoe, smooth shallow terracotta
housing, rolled steel rim/reflector underside, and inset warm diffuser. The pole
uses a 16-sided analytic sweep, three straight stem spans and a 16-segment quarter
bend with tangent continuity into the stem and head socket. Its diameter tapers
from 170 mm near the foot to 104 mm at the housing. The elbow sphere and exposed
cylinder joins are removed. This is an original procedural fixture, not a replica
of a branded product or a downloaded mesh.

VERIFIED frozen constraints: `docs/astra-street-lamps-baseline.json` records the
original eight lamp inputs, exact per-lamp world AABBs, head/lens centres, 3,712
baseline geometry triangles, full 78-collider hash and visual gates. It was written
before runtime edits from the actual old lamp function and its Batch transforms.
The one-shot freeze script refuses an existing baseline. No collider, placement
expression, RNG use, material palette or actual light was added/removed/changed.

VERIFIED measured CPU costs: 3,712 → 14,720 geometry triangles across eight lamps,
an increase of 11,008 against the frozen +15,000 ceiling. With two render passes a
renderer may report +22,016 submitted triangles; actual root measurement is OPEN.
The real whole-yard batcher reports 56 → 56 input meshes and 37 → 37 output meshes,
with zero hazards. The prefab itself has three instance groups. There are zero
new material cache entries, textures, lights or per-frame callbacks/allocations.
The exact existing emissive material is reused with intensity 0.5; no new light or
emission intensity change is hidden in the geometry helper.

VERIFIED CPU checks: `node scripts/check-street-lamps-canary.mjs`, `npm run check`
and `npm run build` pass. The targeted test runs actual buildYards with the same
seed and preserved foliage canary on both sides, compares all 78 colliders, and
records 619 identical non-lamp Batch transforms/material identities. Every new
vertex fits its old lamp's world AABB; foot positions and housing/lens centres are
preserved. It verifies finite geometry and matrices, unit normals, outward pole
winding, tangent continuity, monotonic taper, constant geometry footprint across
one/eight lamps, separate ownership across builds, empty/invalid input handling,
material cache parity, real static-batcher compatibility, and three mesh/geometry
disposal events with zero borrowed-material disposals. A deliberately displaced
instance fails the same bounds gate. Report: `captures/astra-street-lamps-cpu/report.json`.

VERIFIED lifecycle: temporary component geometries are disposed immediately after
merging. The returned group owns its three final geometries and instance buffers;
normal scene teardown can dispose those meshes/geometries. Passed materials stay
owned by MaterialLibrary. Geometry is built once; no live topology toggles, clipping
planes, frame hooks, texture allocation, shader customization or engine migration.

OPEN fixed-camera criteria, frozen before authoring:

- `turningHead`: smooth connected tapered curves visibly replace the foreground
  segmented poles; the head reads as an assembled fixture with a recessed lens.
- `midStreet` / `streetElevation`: retain foot/head positions, house/road sightlines,
  orange/steel/warm-white palette and overall bounds; avoid bulky new housings.
- Moving camera: no detached head, faceted elbow, sparkling coplanar rim or culling
  pop. No warm-up resource growth; root measures actual passes/calls and frame rate.

VERIFIED reference/source inspection: reviewed root actual
`captures/gauntlet/foliage/round-0801/after-turningHead.png` and the frozen shot-matrix
pairings `gameplay/f-FKQOEO-1ceE-115.jpg`, `img/nt2025-sniper-boii.png`, and previously
`gameplay/f-aICKIbuo8zQ-030.jpg`. These ground street proportions/palette/composition;
they do not establish exact product geometry. No reference pixels were copied into
the runtime. The frozen VISUAL-BAR scorecard remains unchanged.

VERIFIED workflow/provenance: applied the original shared
`C:/Users/david/.codex/skills/atomic-acres-procedural-art-authoring/SKILL.md` workflow
for original geometry, frozen budgets, borrowed registry materials and real-consumer
integration. Consulted [current Three docs](https://threejs.org/docs/llms.txt), then
installed Three 0.180.0 source before implementing the sweep and lathed profiles:
[TubeGeometry r180](https://github.com/mrdoob/three.js/blob/r180/src/geometries/TubeGeometry.js),
[LatheGeometry r180](https://github.com/mrdoob/three.js/blob/r180/src/geometries/LatheGeometry.js),
[BufferGeometryUtils r180](https://github.com/mrdoob/three.js/blob/r180/examples/jsm/utils/BufferGeometryUtils.js).
Original code authored here; no textures, generated images, Blender or imported assets.
