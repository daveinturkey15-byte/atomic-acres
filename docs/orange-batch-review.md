# Orange-house static-batch review — 2026-09-19

Independent CPU/source review of the F1 proposal in
`docs/glm-render-budget-audit.md`. This review does not run the browser, renderer,
GPU, server, or build and does not change runtime code. The proposed call is
`batchStatic(g, 'orange-house')` at the end of `buildOrangeHouse`.

## Findings

**VERIFIED — the call has a suitable static boundary.** `buildOrangeHouse` creates
one root group, `g`, and returns its collider array separately
(`src/build/orange-house.ts:237-263, 1205`). Every mesh attachment found in the
builder is a direct `g.add(...)`; there is no mesh parented to another mesh in this
module. The builder has no animation, skin, morph, per-frame mutation, or scene-light
path. `main.ts` retains the returned root group in `world.scene` and
`worldTargets`, and passes those roots to `setRainShelter`; the root identity survives
the batch operation.

**VERIFIED — opaque batching preserves the source material and shadow classes.**
`static-batch.ts` groups by material UUID, cast-shadow, receive-shadow, and attribute
set, bakes each mesh into root-local coordinates, and assigns the original material
object to the merged mesh. `box()` and `slab()` default to cast and receive shadows
(`src/core/kit.ts:43-60`); `emit()` explicitly controls the cast flag for rows, so the
proof must compare both flags rather than just count merged meshes. A normal attribute
is transformed by `BufferGeometry.applyMatrix4`; `shear()` has already recomputed roof
normals before the batch (`orange-house.ts:205-214`). Mapped materials retain UVs;
unmapped materials may have UVs dropped by the documented `usesUV` rule.

**VERIFIED — the known transparent surfaces are excluded.** `mat.glass` is
`transparent:true, opacity:0.42` (`materials.ts:823-825`), and both the ground-floor
pane rows (`orange-house.ts:418`) and upper clerestory `InstancedMesh`
(`orange-house.ts:830-867`) remain outside the merger. The garage canopy at
`orange-house.ts:1002` uses `mat.painted(PAL.glass, ...)`; `painted()` is opaque even
for that colour (`materials.ts:842-858`), so it is correctly eligible as an opaque
painted canopy, despite the older audit wording calling it glazing.

**VERIFIED — the reflection identity is expected to survive.** The only direct
`mat.windowDark` use in the orange builder is the sofa-side box at
`orange-house.ts:635`. It is a singleton material group, so `batchStatic` leaves it
alone. `main.ts:476` discovers reflection participants by that exact material
identity; the proof must assert that this object remains present and that its world
transform/bounds are unchanged.

**OPEN — cull granularity is the material runtime risk.** One house root is a useful
static boundary, but the resulting merged meshes are culled as units. An interior
station can therefore submit triangles from a whole material slot that used to be
culled per part. The audit's estimated object and draw reductions are unmeasured and
must remain `INFERRED` until a same-camera render comparison is captured.

**OPEN — the audit's proposed assertions are insufficient by themselves.**
`objects < 60`, “a glass InstancedMesh exists”, and an empty hazard list can all pass
while a transform, UV, normal, shadow flag, or one pane instance is wrong. A no-batch
negative control only proves the count assertion is sensitive; it does not prove
geometry equivalence. The following CPU gate is the minimum useful proof before any
visual station test.

## Required CPU equivalence proof

Use a temporary verifier or an in-memory source copy; do not edit the authoritative
builder to manufacture the baseline. Construct the real `BuildContext` and invoke the
real `buildOrangeHouse` twice with the same deterministic RNG and material factory:

1. Capture the unbatched result before the candidate call and the batched result after
   it. Deep-copy the returned colliders, root name/transform, and the root's direct
   `worldTargets` identity. Require byte-for-byte equality of collider JSON and
   equality of the root transform/name.
2. For each pre-batch renderable, expand every `InstancedMesh` instance in index order
   and transform every attribute into root-local space using the same local-to-root
   matrix convention as `static-batch.ts`. For each opaque material/shadow class,
   canonicalize a record containing material UUID, `transparent`, cast/receive flags,
   attribute names/item sizes/normalization, index topology, and the exact float bytes
   of position, normal, UV and any other attributes. Hash the sorted record multiset.
   Compare it with the post-batch records, expanding merged geometry into triangles
   and sorting by the same class and float-byte key. Require equal triangle count,
   attribute counts, finite values, and exact hashes within the chosen serialization
   (no loose bounding-box-only tolerance).
3. Separately snapshot all excluded/non-opaque leaves. Require unchanged counts and
   exact instance matrices for `mat.glass`, unchanged `mat.windowDark` identity and
   bounds, and unchanged records for transparent, multi-material, child-bearing,
   hidden, mirrored, non-Float32, and over-200-instance leaves. Assert that every
   `mat.glass` source is still transparent and that no transparent source appears in
   a merged mesh.
4. Compare source and result material properties by identity and value for every
   surviving/merged slot: map references and color spaces, color, roughness,
   metalness, opacity, blending, depth-write/test, side, normal/roughness maps, and
   environment intensity. Compare the source cast/receive partition with the merged
   slot flags. Also assert `renderOrder`, layers, `frustumCulled`, visibility, and
   `onBeforeRender` for retained objects; the batcher does not promise to preserve
   arbitrary object metadata, so the current house must prove those values are
   default/unused before admission.
5. Compare the union bounding box for every material/shadow class in root-local space
   and the complete house bounds. This catches a matrix omission while the attribute
   hash catches a compensating translation. Assert `report.hazards.length === 0`, but
   also compare `report.left` before/after against an allow-list so a newly skipped
   source cannot hide behind a green hazard count.
6. Run a deliberate negative control against a temporary no-batch source. It must fail
   the reduction assertion while its geometry hash still matches the unbatched
   baseline. Run a second temporary mutation that omits one instance transform or
   flips one shadow flag; the geometry/flag hash must fail. These falsifiers show the
   gate is capable of detecting the two most likely regressions rather than merely
   repeating the implementation's own counters.

Only after this CPU gate passes should the owner run the existing interior and exterior
stations at the baseline resolution/backend. Record pre/post renderer draw counts,
frame time, dark-frame threshold, and cull station. Keep the one-line change
reversible until those measurements are real.

## Claim state

- **VERIFIED:** source-level separation of colliders, root retention, static mesh
  authoring, transparent `mat.glass` exclusion, opaque painted canopy, and singleton
  `mat.windowDark` reflection identity.
- **INFERRED:** any object reduction, draw reduction, frame-time improvement, or
  “photoreal”/visual outcome from F1.
- **OPEN:** actual geometry-hash proof, collider fixture equality, hazard/left report,
  and cull-as-unit behavior at the owner's render stations.

