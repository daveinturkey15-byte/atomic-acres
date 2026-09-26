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

## Localized visible repair 1 — support thumb and reload

VERIFIED: inspected the independent stills critique and the actual canary ADS, hip and reload PNGs. The critique remains OPEN: initial framing, aim reference and material identity improved, but thumb readability and reload contact did not pass; the concealed right grasp was unproven. This repair changes only the support thumb and support-hand reload path. It neither changes the camera/gun nor accepts an occluded right hand.

VERIFIED: the support thumb now splays beyond the index/palm silhouette, with a tan canvas back and separate dark rubber tip; its contact remains on the opposite side of the actual crossbar from the four fingers. The reload path leaves the bar upward/outward, rotates about the palm, then seats outside an actual ray-hit drum rim. It returns along the same arc to exact bind. It does not use the old reload socket inside the housing. Per-frame work changes existing transforms only.

VERIFIED: strengthened `scripts/_verify-overnight-heavy-hands.mjs` PASS; retained result `captures/overnight-heavy-hands-repair1-cpu.json`. Hands are 11 meshes/3,624 triangles; gun remains 10 meshes/10,848 triangles/5 embedded textures. Thumb silhouette extends 23.335 mm beyond the palm; all ten bind-contact gaps remain below 2 mm. Reload contact is on the real decoded drum, with nearest glove distance 5.735 mm. At 39 sampled reload phases, once the glove descends into drum height its complete glove bounds stay outside the drum side plane. This conservative drum-plane check does not prove full swept collision against every gun triangle or forearm anatomy.

VERIFIED: the preserved `6d5fde7` initial helper fails the new thumb-silhouette and outside-drum criteria, so these assertions distinguish the criticized take. Exact right-hand geometry/transform signatures remain unchanged from that take. Existing default-rig, all-asset hash, ADS aperture, budget, reset and disposal checks still pass. `scripts/_verify-astra-reference-models-20260926.mjs` passes unchanged; `npx tsc --noEmit` passes.

VERIFIED: initial helper/proof bytes also remain in `captures/overnight-heavy-hands-before-repair1.ts.txt` (SHA256 `341abc47ecb8aad8c2aca3e67b1f054e2403e6b36993aa976bd7abc9d88b9ba5`) and `captures/overnight-heavy-hands-before-repair1-proof.mjs.txt` (`d3e97c116baf13c8748161766b8a16805001c47e176a2fbac25d252c009048c8`). Original GLB bytes are unchanged.

VERIFIED: `scripts/_inspect-overnight-heavy-rig.mjs --out captures/overnight-heavy-neutral-repair1` CPU-built a separate inspection bundle and identity manifest. It uses the actual adapter, model and material library, fixed front/left/right/three-quarter cameras, an explicit inspection label and a reload slider. It renders only on inspection changes, exposes `window.__HEAVY_INSPECT.view(name)`, `.reload(0..1)`, `.stats()` and `.dispose()`, and refuses output overwrite. It launches no browser/server. Neutral lighting/cameras are separate evidence, never a replacement gameplay view. Root may serve that directory and wait for `document.documentElement.dataset.ready === 'true'` before capture. Browser execution remains OPEN.

| Repair-1 worker path | SHA256 |
|---|---|
| `src/weapons/reference-weapon-models.ts` | `e1b9eea033ad18f4345ca848c2ac88955c7ca35a83c19189e433460736407b33` |
| `src/weapons/reference-heavy-hands.ts` | `7e0c48189b1efd98445ff2329a568dff21ce39bf0be1594730e8ee64a298c6dd` |
| `scripts/_verify-overnight-heavy-hands.mjs` | `5cfdd3939c0985255e15fe9720f68ee770446cac18aaf8c4099640774c31460d` |
| `scripts/_inspect-overnight-heavy-rig.mjs` | `e19e58ac7cfb55d3a292862bd02d86ff2dc67b40229d78fa8fcf6978bb8d6389` |

OPEN: source frozen for independent still/motion review. One of two localized visual repairs is consumed; **one remains maximum**. The critic must still judge visible opposition, useful reload contact and anatomical motion; neutral right-hand inspection is outstanding. No art threshold changed, default promotion occurred, or new GPU/browser/runtime-build job ran in this worker.
