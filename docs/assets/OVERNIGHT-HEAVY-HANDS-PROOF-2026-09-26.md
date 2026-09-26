# Minigun contact canary — initial take, explicit admission

VERIFIED: built from restart source `ac3f1d45b31c5516fa9504980ce4aa4828674ffa`; presentation-only scope. Read the heavy-grip brief, retained critic, original 1600×900 Minigun hip/ADS captures, and `references/heavy-weapon-grip-v1.png`. Applied Dream Loop, Visual Gauntlet Loop, and Atomic Acres Asset Authoring workflows. The generated image supplies contact principles, not replacement gun mechanics, geometry or production acceptance.

VERIFIED: the new hands, depth offset and aim mark require `?heavy-hands=canary`. The adapter's optional fourth argument `{heavyHands:true}` admits the same canary in CPU fixtures; `{heavyHands:false}` forces the default. With no browser location the default is false. Uzi/Magnum never select the heavy-hand path. Default geometry, hands, mounts and stats for all three imported weapons remain byte-signature identical to ac3; this is not default art promotion.

VERIFIED: the original GLB and all other 24 imported source assets retain their manifest SHA256 values. Minigun source SHA remains `bc7c965c3931ca2cce575a98552532b46fae11f41e313d3b03940cf726583a3b`; its eight required sockets and 13 inactive source clips remain intact. No model scale, texture, gun node or gun vertex was changed. New work is original procedural hand geometry, two small unlit aim-reference meshes, and an adapter-provided presentation offset consumed by the integrator's controller patch. Existing shared material-library palette supplies canvas palm, rubber digits/wrist and cloth sleeves; no added textures or lights.

## Named gap and initial repair

VERIFIED: retained hip/ADS pixels show extreme foreground gun mass and no persuasive hand contact. Decoding the mesh reveals a tilted right-side handle with approximately 48×48×279 mm principal extents, not the much larger axis-aligned box. The new right hand follows its measured axis; the left hand wraps the separate top crossbar. Four individually separated finger tubes and a separate opposed thumb are constructed against ray hits on actual handle triangles. Glove wrist bridges connect palms to fitted forearm sleeves. All geometry is built once; reload only mutates the existing support-hand transform and restores exact bind pose.

VERIFIED: the rear gun frame originally reaches camera-local z≈−0.0168 m at the standard hip mount. A Minigun-only `cameraOffset = {x:0,y:0,z:-0.30}` changes that to −0.3168 m without resizing the model. The same depth offset at hip and ADS preserves the solved sight-axis x/y alignment. A dark-outlined cream chevron below the exact aiming line supplies a visible aiming reference while leaving the established centre and four margin rays clear. It is an open-centre/six-o'clock reference; moving-target usability is not established by the CPU projection.

## Mechanical evidence

VERIFIED: `node scripts/_verify-overnight-heavy-hands.mjs` PASS on the frozen initial take:

| Check | Observed result |
|---|---|
| Hands budget | 10 meshes / 3,576 triangles; unchanged caps 12 / 4,000 |
| Gun and aim-reference budget | 10 meshes / 10,848 triangles / 5 original embedded textures; unchanged caps 16 / 16,000 / 8 |
| Decoded surface contact | Ten actual surface-point to glove-triangle gaps 0.194–1.078 mm; every witness lies on the decoded handle mesh |
| Retained negative control | Previous hands miss those same contact witnesses by 45.18–265.67 mm |
| Wrist/sleeve and reload | Sleeve endpoint at wrist centre; glove bridge reaches wrist and palm; reload restores exact support-hand matrix |
| ADS geometry | Existing exact centre plus four margin rays have no opaque intersection, including new hands/mark |
| Aim reference | Approximately 19.95 px wide at 1600×900/55° ADS; internal light/dark material contrast 13.14:1 |
| Default path regression | Full mesh positions/indices, transforms, hand placement, ADS mounts and budget signatures for Uzi/Magnum/Minigun identical to retained ac3 source |
| Original resources | All 24 asset hashes retained; each owned geometry/material/texture disposed once; shared hand materials untouched; owned ImageBitmaps closed once |

VERIFIED: the first unconditional construction take failed the unchanged `scripts/_verify-astra-reference-models-20260926.mjs` at line 71, `support palm fit`, for Minigun. That assertion requires the old generic palm at the side socket; the deliberate new support hand is at the real upper crossbar. Decision: **refine-spec**, admitting the new art only through the explicit canary while preserving the complete default contract. The original socket was not moved and no dummy palm point was supplied. After this correction, the legacy verifier passes **unchanged** on the default path, and the stronger new actual-handle proof passes with the canary explicitly enabled. No legacy assertion was edited or weakened.

VERIFIED: rejected unconditional adapter and verifier bytes are preserved locally as `captures/overnight-heavy-hands-initial-unconditional-reference-weapon-models.ts.txt` (SHA256 `681cbb4ebb246da1ecc89cf571aa9fbe0ac449d7cc349bccd87ca7407eb3fb57`) and `captures/overnight-heavy-hands-initial-unconditional-verifier.mjs.txt` (`4b7c73c9a5c9adcd2d77c8efba5e8334ce70b74cf6d96e2125ebca1e755a4c98`). The hand helper itself is unchanged by this admission correction. This is a scope/admission correction before any pixel review, not a claimed visual improvement round.

VERIFIED: an initial source typecheck passed before the final helper and integrator edits. Final combined typecheck/build belong to the integrator after freeze; they are not claimed here.

## Frozen source receipt

| Worker-owned path | SHA256 |
|---|---|
| `src/weapons/reference-weapon-models.ts` | `c7b5a40faf891a6b4f1bfc78ef6709f64bf64d6a19c0270a67de553ac78bb9b0` |
| `src/weapons/reference-heavy-hands.ts` | `341abc47ecb8aad8c2aca3e67b1f054e2403e6b36993aa976bd7abc9d88b9ba5` |
| `scripts/_verify-overnight-heavy-hands.mjs` | `d3e97c116baf13c8748161766b8a16805001c47e176a2fbac25d252c009048c8` |

OPEN — decision `continue` to the integrator's serialized pixel review, not accepted. This is the initial take; **two localized visual repairs remain maximum**. Retain baseline hip/ADS PNGs, the generated contact study, and every rejected take. Required next evidence: same 1600×900 hip/ADS, neutral front/side/three-quarter inspection, and brief firing/reload/turn motion. Critic must judge grasp/contact ≥7/10 with connected wrists, four readable fingers plus thumb, plausible support, open aim, improved framing, coherent material finish, and no motion/resource regression. CPU contact and contrast measurements do not prove those pixel criteria. No browser, GPU, build, commit or push was performed by this worker.
