ROOT REVIEW: F1 was independently reviewed and the proof hardened. Use explicit4191/4192 routes; compare collider rows, not timestamp/build metadata. Source objects204->51 and measured worst gameplay draws1189->891. The original estimates and recommendations below are worker claims, superseded by root checkpoint receipts.

# GLM render-budget audit — 2026-09-19

Static, source-confirmed audit. Per lane contract: no server, browser, GPU, or build was
run; no source was edited; the only artifact is this file. Owner-provided numbers
(f7d2c57 @ 4191; worst station 1187 draws vs 1200 budget; 420.8 s soak 57 fps avg,
+.039 MB/min post-GC; module object counts from
`docs/verification/2026-09-19/collider-snapshot.json`) are cited as given. Every saving
figure below is **INFERRED** — nothing here was mechanically measured.

Bootstrap: OMP receipt PASS `trust=trusted` (control_digest bb4a1bf5…44de). `audit`
RED/AMBER rows are stale receipts of *other* harnesses (Hermes, Claude Code, jigglyclaw
peers) — reported, not borrowed, not this lane's to fix. Power plan verified High
performance (`8c5e7fda-…`) before work.

## 1. Hot-path map (where the frame cost actually is)

One RAF loop, `src/main.ts:318-425` (`frame()`), running every frame:

| Step | Site | Cost character |
|---|---|---|
| `renderer.info.reset()` | main.ts:333-339 | none (bookkeeping, deliberate) |
| `player.update`, `worldAudio.update`, `weapons.update` | main.ts:341-353 | CPU sim + audio, no scene-graph rebuild |
| **`world.render()`** → `atmosphere.update(now)` then `post.render()` | main.ts:355; core/world.ts:258-264 | **the whole scene pass (MRT G-buffer) + sun shadow pass (4096², world.ts:163-189) + GTAO/SSR/bloom/vignette** |
| viewmodel overlay render (separate scene + lights) | main.ts:356-362 | one small scene, own cache key |
| `characters.update` + per-bot pose writes | main.ts:369-393 | skinned figures; bots cast shadows into the pass above |

`frame()` itself is clean: no per-frame allocation, no per-frame construction, no
raycasts. There is no hidden second loop (single `requestAnimationFrame(frame)` at
main.ts:425). Sky, rain, smoke are uniform-driven (core/world.ts:258-259, materials.ts
rain block) — zero draws when off (atmosphere.ts:961).

So the budget is spent in **object count × passes**: each opaque caster mesh is
submitted in the shadow pass *and* the scene pass. Objects are not draws
(`moduleStats` counts objects by traversal, main.ts:102-106), but at a station that
sees a house, roughly every loose mesh in it is drawn **twice**. With the worst
station at 1187/1200, capacity for better assets can only come from collapsing loose
static meshes — which is exactly what the existing machinery does, everywhere except
one builder.

## 2. What is already batched (do not touch)

| Builder | Mechanism | Evidence |
|---|---|---|
| vehicles | `batchStatic(v.obj, …)` per parked vehicle, deliberate | src/build/vehicles.ts:1242-1247 |
| white house | internal `Batch` → one InstancedMesh per material (`bWall/bGlaz/bTrim/…`) | src/build/white-house.ts:209, 1220-1231 |
| yards | same `Batch`-per-material pattern | src/build/yards.ts:192-228 |
| ground / ground-detail / kerb furniture | `InstancedMesh` families, `decalMesh()` sheets, `flat()` no-cast plates | src/build/ground.ts:214-218, 396-418, 656-674, 920-953; src/build/ground-detail.ts:177-184 |
| skyline | `inst()` InstancedMeshes + matrix freeze, `castShadow=false` (single pass) | src/build/skyline.ts:100-115, 609-616 |
| materials | all factories cached singletons (`painted` 842-858, `emissive` 928-936, `signText` 870-927) | src/core/materials.ts |

The general merger `batchStatic(root, tag)` (src/core/static-batch.ts:239-366) already
handles every preservation concern, and is proven in production on the vehicles:
bakes root-local transforms (exact chain walk, :333-341), groups by
`mat.uuid|shadowFlags|attrKey` (:352), preserves cast/receive per slot (:354-356),
**skips transparent, multi-material, skinned, morph, hidden, mirrored, instanceColor,
>200-instance** meshes rather than guessing (:270-349), disposes consumed source
geometries (:381-383), and throws under DEV on hazards.

## 3. Ranked findings

### F1 — Apply `batchStatic` to the orange house (the focused target)

- **Change:** one call + one import. `src/build/orange-house.ts:1205`, immediately
  before `return { group: g, colliders };`:
  `batchStatic(g, 'orange-house');` with the import mirroring vehicles.ts:25.
- **Why it is the gap:** the orange house is the largest per-module object count in the
  snapshot (205 vs vehicles 122 — and 122 is *after* per-vehicle batching). It is built
  as loose per-call meshes: every wall pier/spandrel is its own `box()` with its own
  `BoxGeometry` (orange-house.ts:296-300, kit.ts `box()`), `put()` adds one mesh per
  call (:245-249), and the glazing frames/cills/bars/jamb liners are one InstancedMesh
  of ≤~200 unit boxes (rows `emit`, :256-263) that `batchStatic` will legally expand
  and merge (`MAX_EXPAND = 200`, static-batch.ts:5). Nothing else this large is
  unbatched — see the table above.
- **Why not already handled:** `batchStatic` exists and is vehicle-proven, but no house
  calls it; the orange house predates the discipline of applying it. Cross-vehicle /
  cross-house merging is deliberately rejected by the author for frustum-cull
  granularity (vehicles.ts:1242-1246) — that argument applies at fleet scale, not to a
  single compact ~17.6 × ~9 m house volume.
- **Preservation (source-confirmed, same code path the vehicles ship):**
  - *Colliders:* the builder returns a separate array; `batchStatic` never sees it.
    `capture-collider-snapshot.mjs` output must stay byte-identical.
  - *RNG:* `batchStatic` consumes no randomness; all `ctx.rand()` calls happen during
    build, before the merge, so every downstream builder's sequence is unchanged.
  - *Transforms/normals/UV:* geometry baked root-local; `applyMatrix4` carries the
    normal attribute through the normal matrix (`shear()`-computed roof normals at
    orange-house.ts:214-221 are baked vertex data and survive); `usesUV` drops uv only
    where no map samples it (static-batch.ts:100-117).
  - *Material identity:* all house materials are `ctx.mat` singletons, so merge keys
    align; no material is constructed (module contract).
  - *Transparency / painter order:* glass panes are `transparent` (materials.ts:823-826)
    — skipped by batchStatic (:270-271) and already single draws: ground-floor panes
    `emit(paneRows, mat.glass, false)` (orange-house.ts:~429-430) and the clerestory
    band `inst(unit, mat.glass, nSeg)` (:833). They stay one transparent
    InstancedMesh each, sorted exactly as today. **No transparent grouping is
    proposed.**
  - *Shadow:* cast/receive flags preserved per merge slot; porches/glow spheres are
    `mat.emissive` (opaque, cached).
  - *Disposal:* consumed source geometries disposed at static-batch.ts:381-383; the
    returned group keeps root-level name `orange-house` (set in main.ts:98).
  - *Reflection probe:* main.ts:475-476 collects scene meshes with
    `material === mat.windowDark`; the orange house's only such mesh (sofa,
    orange-house.ts:635) is `alone-in-group` and left untouched — probe list
    unchanged.
- **Estimated effect (INFERRED):** ~205 objects → roughly 15-25 meshes (one per
  material slot with ≥2 sources). With the shadow pass, INFERRED ~250-350 whole-frame
  draw reduction at stations with the house in view: 1187 → INFERRED ~840-940, i.e.
  roughly 250-350 draws of headroom under the 1200 cap. Build-time cost INFERRED low
  single-digit ms (clone+bake of small boxes; same path as the vehicles'
  `moduleStats` ms).
- **Known risk (INFERRED, must be measured not assumed):** the merged house is
  frustum-culled as a unit, so interior views submit more triangles than today. The
  negative control below measures exactly this; rollback is deleting one line.

### F2 — Apply `batchStatic` to the skyline

- **Change:** `src/build/skyline.ts`, insert `batchStatic(g, 'skyline');` just before
  the matrix-freeze traversal at :609-616 (so the merged meshes are frozen too), with
  the import.
- **Why:** 52 objects mixing `inst()` families with per-piece `new THREE.Mesh` calls
  (skyline.ts:111-115); `castShadow=false` (:612-613) so the win is single-pass:
  INFERRED ~40 draws (52 → ~6-10 meshes; unique `signText` facades stay `alone-in-group`
  and are left as-is). The ring is distant, flat-shaded scenery; cull-as-unit costs
  only cheap triangles.
- **Why not already handled:** the builder was given the matrix freeze and no-shadow
  treatment but never the merge; `batchStatic` postdates it.

### F3 — No third meaningful safe target exists in scope

Vehicles, white house, yards, ground, ground-detail are each already batched by a
dedicated mechanism (§2) — further merging there is either forbidden (transparent cab
glass, `signText` unique textures) or explicitly rejected by the author's culling note
(vehicles.ts:1242-1246). The remaining loose-mesh builders (desert trees, barrels,
quiver trees) reuse reviewed glTF masters with shared geometry and sit below the
snapshot's top counts. Considered and rejected as unsafe or out of contract:
`sun.shadow.autoUpdate=false` (bots and the player cast moving shadows — stale-map
regression), any whole-map rebake or renderer change (lane contract), and merging
transparent windows in any form (forbidden).

## 4. Bounded next implementation + negative control

1. **Implement** F1 (single line + import). Do not bundle F2; keep each fix
   separable for bisection.
2. **Invariants check (no new harness):** `node scripts/capture-collider-snapshot.mjs`
   before and after — collider list and owners must be byte-identical.
3. **Real-geometry falsifier:** `scripts/_verify-orange-batch.mjs`, modeled on
   `_verify-static-batch.mjs` / `_verify-frame-measure.mjs`, booting the shared
   `vite preview` on :4188 with real Chrome over CDP (scripts/lib/preview.mjs +
   proc-guard). Asserts on the real assembled scene: (a) DEV `batchStatic` hazard list
   empty (it throws under `import.meta.env.DEV` on any of the five hazards);
   (b) `moduleStats['orange-house'].objects` drops from 205 to < 60; (c) an
   orange-house child with `material === mat.windowDark` still exists (probe list);
   (d) a `mat.glass` transparent InstancedMesh still exists under the house and was
   not merged; (e) per-station `renderer.info` draw deltas recorded inside the same
   synchronous evaluate as the render (capture.mjs idiom).
4. **Interior-station guard:** `goto()` an interior camera station and apply the
   existing playcap dark-frame threshold unchanged — this is where cull-as-unit would
   show up. Threshold stays frozen.
5. **Prove the falsifier can fail:** run step 3's script against a build with the
   F1 line commented out — assertion (b) must fail (same discipline as
   `soak --inject-kb-per-s`).
6. **Gates before hand-off:** `npm run check`, `npm run playcap`, `npm run capture`,
   then `npm run soak` (mandatory: this touches the render chain). Compare worst
   station against 1187; the claim to verify is the INFERRED estimate above, at the
   same resolution/backend as the baseline.

## 5. Compliance

No server, browser, GPU, or build run; no source edits; no commits; no provider
configuration changes; single output file. No image was viewed, so no visual claim is
made. All unmeasured numbers are labeled INFERRED; owner-provided measurements are
cited as given.
