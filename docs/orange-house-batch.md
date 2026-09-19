# Orange house — static batching (F1)

2026-09-19, lane `refine/glm-orange-batch-20260919`. One call, one proof script,
this document. No other runtime file changed.

## The change

`src/build/orange-house.ts` imports `batchStatic` from `core/static-batch.ts` and
calls it on the finished group, immediately before `return { group, colliders }`:

```ts
batchStatic(g, 'orange-house');
```

That is the whole implementation. Everything else in this document is evidence and
tradeoff notes.

## Why the call is safe here

`batchStatic` consumes leaf meshes only (single non-transparent material, no
skinning/morphs, all-Float32 attributes, no children, fully visible chain, positive
determinant, ≤ 200 instances, no `instanceColor`) and merges them into one mesh per
(material instance, shadow flags, attribute set), baked into group-local space. The
orange house at that point in the builder is exactly that kind of tree:

- **Every child of `g` is a leaf `Mesh`/`InstancedMesh`.** Walls, slabs, rails,
  stairs, garage, roof, glazing frames and dressing are all added directly to `g`;
  nothing parents anything; nothing under the house animates, toggles or hides.
- **All materials are `ctx.mat` singletons** (`materials.ts`), so merge groups are
  keyed on shared program state, not one-off instances. `painted()`/`emissive()`/
  `signText()` are argument-cached (`materials.ts:842-936`), so repeat calls share
  one instance exactly as elsewhere on the map.
- **Colliders are untouched by construction.** Every collider row was pushed from
  `layout.ts`-derived values while building - never derived from the meshes - and
  `batchStatic` only rewires meshes. The proof asserts row-for-row equality anyway.
- **RNG untouched**: `batchStatic` calls `ctx.rand` zero times; the proof counts
  calls (6, both runs).
- **Transparent glass never merges** (batcher contract), so the ground panes and the
  clerestory band keep their own draws and the per-object alpha sort.
- **The one `windowDark` mesh** (living-room TV, orange-house.ts:635) is alone in its
  group and is left exactly as built. This matters: the static reflection probe
  (`main.ts:475-479`) selects meshes by **material identity** (`material ===
  mat.windowDark`), and the merged meshes keep their material instances, so any
  future second windowDark mesh on this house would still be found by that traverse
  whether merged or not.
- **RainShelter** (`core/rain-shelter.ts`) rasterises actual world-space triangles
  and folds them with `max()`, which is order-independent; the batch bakes the same
  parent-chain product, differing from `matrixWorld` only in float association
  (~1e-6 m, measured below) - invisible on a ~0.8 m/pixel height field.
- **No hazard cases exist in this tree**, and the proof runs the bundle under
  `import.meta.env.DEV = true`, where `batchStatic` itself *throws* on any hazard -
  a green run is also the batcher's own gate passing.

## Measured result (candidate vs. control, CPU only)

`node scripts/assets/verify-orange-house-batch.mjs` bundles the **actual builder
source** twice with esbuild: the candidate with the real batcher (instrumented by a
single documented rename inside `static-batch.ts` so the report is retained), and a
control where `core/static-batch` is replaced by a no-op stub - i.e. **only the new
call reverted**. The control is the unbatched baseline and its zero-reduction check
is retained as one negative control. Materials come from a stub that mirrors
`materials.ts` in exactly what the batcher can see: singleton caching per key,
`glass` transparent, map slots per key (which decides the batcher's UV drop), and
the relevant `capsuleWhite` properties. No DOM material code runs.

| Check | Result |
|---|---|
| Colliders | 233 rows identical, row for row |
| RNG | 6 `ctx.rand` calls in both runs |
| Triangle/material/shadow signature | 45 (material, cast, recv) groups; 9564 triangles total, equal |
| World triangles | 4,938/9,564 match at 1e-6 quantization; the remaining 4,626 match within semantic limits, worst position **9.54e-7 m**, normal **1.13e-8**, UV **0** |
| Hazards | none (DEV gate armed - it throws) |
| Glass | 2 transparent meshes unchanged (same materials, triangles, unmerged) |
| windowDark | exactly 1 mesh, still the library singleton, unmerged |
| Opaque draw objects | **202 → 49 (-153)** |
| Merged groups | 23, carrying 7196 triangles |
| Negative controls | 0 reduction/0 groups without the call; position, UV, and shadow mutations are rejected by the equivalence gate |

The 4,626 tolerance-pass triangles are Float32 storage in the merged attribute
arrays (the measured position residual is below 1e-6 m at 20-40 m coordinates),
not transforms: the batcher and the proof compute the same parent-chain product.
The comparator now quantizes at 1e-6 and bounds the fallback independently at
1e-5 m for positions and 1e-6 for normals and UVs. It reports the worst residual
for each semantic. The proof also runs three falsifiers through that same gate:
one position mutation, one map-bearing UV mutation, and one shadow-flag mutation;
each must be rejected.

The material fixture pins the used `capsuleWhite` slots to the source library:
map, roughnessMap, normalMap, `normalScale=(0.35,0.35)`, roughness 1, metalness
0.02, and env-map intensity 0.6. Texture pixels are still intentionally not
sampled by this CPU proof.

## Known tradeoffs

- **Frustum culling granularity.** Merged meshes are culled as units. The house is
  one co-visible structure, so per-material groups (23) - not per-part (204) - is
  the right granularity here. `vehicles.ts` deliberately batches per vehicle for
  the same reason; a whole-street call was rejected there and the same logic would
  reject batching across buildings.
- **Vertex memory.** Instanced meshes ≤ 200 instances are expanded and baked
  (batcher `MAX_EXPAND`), so repeated boxes stop sharing one 24-vertex cube. The
  merged groups carry 7196 triangles' worth of vertices; instance transforms stop
  being free. GPU-side this is bounded by the same budget line as before - the
  triangle count is identical, only the vertex layout changed.
- **UV drop is material-scoped, not blanket.** Only mapless materials (`windowDark`,
  `emissive` per `materials.ts`) lose their uv attribute on merge; they sample
  nothing through it (`static-batch.ts usesUV`). Every map-bearing material keeps
  its uvs, and the proof compares uvs on those.
- **`left` classes on this tree:** 2 transparent (the glass draws) + 26
  alone-in-group (single-mesh groups are already one draw). Nothing was skipped for
  a hazard reason.

## What this proof cannot tell you

No performance or visual claims are made or implied. The renderer, frame loop,
shadow maps and actual draw-call counts are Root's browser gates: `npm run check`,
baseline (4191) vs candidate (4192) gameplay screenshots, all stations, collider
snapshot, traversal, then `soak` before hand-off. The proof's draw-object counts
are object counts, not submitted draw calls.
