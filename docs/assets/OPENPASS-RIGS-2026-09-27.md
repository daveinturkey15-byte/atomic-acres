# Open pass: one LMG rig canary

VERIFIED — CPU source-ready, opt-in integration proposed; no game build, browser,
Blender, generation, public asset write, commit or promotion performed by this lane.
OPEN — neutral views, actual hip/ADS/reload pixels, runtime resource counts,
independent visual review and owner art acceptance. Do not batch the other seven
rigs or replace a retained asset from these CPU results.

## Frozen scope and brief

VERIFIED — initial checkout was `salvage/full-game-20260926` at
`537ddb76477b8be7953c9bcd651458f255ce48da`. Only the three new files named by the
parent are owned here. The promoted `2f837ae` preview stays unchanged.

VERIFIED — `lmg` has a 75-round magazine in the live catalog and currently uses
the service-rifle family model by default. The single authored canary has a broad
feed receiver, long heavy barrel with open bore, slotted shroud, folded bipod,
carry handle, short visible cartridge belt, canvas ammunition pouch and open
iron sights. It retains the current game's parkerized steel, warm furniture and
olive hand/sleeve materials. Geometry is original editable TypeScript; no old
repository code or assets were copied.

VERIFIED — the retained project reference `docs/reference/production-catalog/weapons/lmg.png`
was visually inspected, SHA256
`c0fa3d2cd4acd083af377fe0c08327e5b10a73b299a44e7f9f8fc684d3103fb5`.
Its long receiver, feed belt, pouch, carry handle and barrel establish the role.
The canary uses folded legs for a held weapon and current game materials.
OPEN — it is not an exact image-to-mesh reproduction. The reload is a pouch
withdrawal/reseat with the left hand; a full feed-cover opening, belt placement
and charging sequence from the reference is not implemented or claimed.

## Actual fallback inventory

VERIFIED — derived from current `families.ts`, default reference adoption in
`controller.ts`, and `REFERENCE_WEAPON_IDS`. The family metadata still calls
eleven conventional IDs fallback art; three already have default reference
models, leaving these eight actual fallback presentations.

| ID | Default family presentation | Preserved optional alternative | This pass |
|---|---|---|---|
| `mp5` | SMG | `heroes=canary` MP5 GLB | Read-only; compact receiver/curved magazine gap |
| `machine-pistol` | SMG | None in default adoption | Read-only; stockless sidearm-size gap |
| `m4a1` | Rifle | Catalog carbine is a separate optional integration | Read-only; individual AR stock/receiver gap |
| `ak-47` | Rifle | No default individual rig | Read-only; curved magazine/gas tube gap |
| `lmg` | Rifle | `heroes=canary` LMG GLB | **Only new canary** |
| `m14-ebr` | Sniper | `heroes=canary` M14 EBR GLB | Read-only; chassis/box-magazine gap |
| `slug-shotgun` | Shotgun | No default individual rig | Read-only; distinct slug platform gap |
| `flashlight-pistol` | Pistol | No default individual rig | Read-only; visible under-barrel light housing gap |

VERIFIED — `mini-uzi`, `magnum` and `minigun` already use retained reference rigs;
they are excluded from this list. No fallback registry or factory was changed.

## Retained hero comparison

VERIFIED — the actual file `public/assets/roster-heroes/lmg.glb` is present:
SHA256 `86aad9195812de84970ea89bb43d29975534d61300cd0d94e38289d168e4f9c9`,
2,893,668 bytes. The old `work/roster-heroes/manifest.json` statement that LMG is
absent is stale. Its preservation and original editable Blender recipe are
unchanged; this report reconciles that observation without overwriting history.

| CPU-measured property | Retained hero GLB | New source canary |
|---|---:|---:|
| Gun mesh draws, excluding hands | 16 | 6 |
| Gun triangles, excluding hands | 1,020 | 6,544 |
| Complete canary including hands | Not instantiated in this pass | 18 meshes / 11,380 triangles |
| New rig-owned geometry bytes | GLB file size is not decoded geometry memory | 749,848 |
| Asset materials/images | 3 / 2 embedded images, 6 texture records | No owned materials/images; shared library textures remain in use |

VERIFIED — the retained hero loader uses actual `anchor_*` sockets, a cached
GLB lifetime, solved ADS placement, and an ammunition box swing of 0.85 radians.
Its support anchor is approximately `(0,-.01,-.30)`, so it selects the generic
hand factory rather than the explicitly fitted rifle-hand route. This does not
prove a defect. The new rig keeps the accepted articulated rifle grip/support
binds, fits them to the individual new solids before merging, and uses the
existing sleeve solver with a fitted pouch contact path. Its rear/front aim
anchors both sit at y=.130, with an additive ADS y correction of +.018.

OPEN — the new rig trades more gun triangles for fewer material batches and
direct articulated hand fitting. No appearance, FPS or overall memory superiority
is established. Prefer the retained hero if actual comparative pixels are as
good or better; no reason exists to delete or overwrite it.

## Integration contract and ownership

VERIFIED — `OPENPASS_RIG_BUILDERS.lmg(mat)` returns `OpenpassWeaponRig`, a
`ViewmodelRig` with `weaponId`, eight actual named `sockets`, `adsMount`,
`adsSightNames`, measured `stats`, and idempotent `dispose()`.
`OPENPASS_RIG_IDS` contains only `lmg`; there are no stub entries.

VERIFIED — rig axes are +X right, +Y up, -Z forward, metres; the pivot remains
at the existing trigger/grip origin. Muzzle `(0,.048,-.839)` lies at the visible
barrel exit. Eject `(.056,.020,-.145)` faces +X. The trigger/support sockets use
the existing `RIFLE_HAND_BINDS`; the reload seat uses `RIFLE_RELOAD_SEAT` and
follows the withdrawing pouch. Rear/front sights `(0,.130,.008)` and
`(0,.130,-.700)` define a clear aim corridor. The front blade ends 1.5mm below it.

OPEN — parent integration should use an explicit opt-in flag, swap only the
individual LMG rig, add `adsMount` to the existing ADS transform, and retain the
shared rifle for other weapons. `hands.updateReload`, `hands.updatePose` and
`hands.resetReload` own this rig's transforms. Call its `dispose()` exactly as
the disposal owner; do not also dispose its geometry in another generic loop.
No ammo/timer/shot/host state is read or changed by the new module.

VERIFIED — static geometry merges by shared material only after hand fitting;
hands and ammunition pouch retain independent transforms. All owned retained
geometries are disposed once, temporary merge geometries are disposed during
construction, and shared materials/textures survive. There are no lights,
render targets, async loads, per-frame geometry/material allocations or global
renderer changes. Budget was frozen before implementation at 24 total meshes,
16,000 total triangles, 2MiB geometry and no rig-owned textures/materials.

## Verification and next gate

VERIFIED — `node scripts/_verify-openpass-rigs.mjs` passes actual Three.js CPU
construction, deterministic buffers, finite vertices/normals/transforms, valid
indices/bounds, all eight sockets, forward/ejection axes, clear centre and
±7mm sight rays, 101 reload phases, <3mm hand/pouch contact at the four contact
phases, fixed sleeve length/wrist attachment, offhand blend, invalid phase
reset, unchanged buffer identities, exact bind reset, budgets and disposal.
The full `tsc --noEmit --pretty false` passes. One initial type inference error
in the new stats loop was corrected with an explicit `BufferGeometry` type;
no threshold or assertion changed.

OPEN — parent should capture fixed front/left/right/three-quarter neutral
views plus actual hip, settled ADS and reload .25/.50/.75 frames. Include the
retained `heroes=canary` LMG at the same view/settings for the choice. Inspect
hand anatomy, contact/clipping, sights, material balance, barrel/pouch/bipod
readability and reload continuity without masking/cropping defects. This is
the first source candidate, with at most two localized pixel repairs before
holding. No further weapon may proceed before the parent's looked-at review;
owner art acceptance remains separate.

## Upstream source check

VERIFIED — installed Three.js is **0.180.0**. Current docs were consulted first;
their current release/index is newer and does not authorize an upgrade:
[BufferGeometry](https://threejs.org/docs/pages/BufferGeometry.html) and
[BufferGeometryUtils](https://threejs.org/docs/pages/module-BufferGeometryUtils.html).
The actual merge/rounded-box API and disposal behavior were checked against
installed source and explicit **r180** upstream files:
[BufferGeometryUtils r180](https://github.com/mrdoob/three.js/blob/r180/examples/jsm/utils/BufferGeometryUtils.js),
[RoundedBoxGeometry r180](https://github.com/mrdoob/three.js/blob/r180/examples/jsm/geometries/RoundedBoxGeometry.js).
Only ordinary supported Three.js geometry/transform APIs are used.

## Source-only actual-game capture runner

VERIFIED — `scripts/_capture-openpass-lmg.mjs` is syntax checked and frozen for
root's serial execution. It does not build or serve. Supply the independently
recorded compiled commit and entry SHA256 from the root's build receipt:

```powershell
node scripts/_capture-openpass-lmg.mjs --url http://127.0.0.1:4361/ --tag openpass-lmg-pair-v1 --expected-commit <40-hex-compiled-source> --expected-entry-sha256 <64-hex-entry>
```

VERIFIED — default execution compares `family` and `lmg-model=canary` in separate
owned stock headless Chrome processes using one compiled entry. Optional
`--include-hero` adds a distinctly named third `heroes=canary` variant. Before
each browser: >=4GiB free VRAM and >=12GiB free system RAM, otherwise FAIL without
starting a browser. Total wall cap is eight minutes. No browser profile is reused.

VERIFIED — actual menus select LMG/Duster, one live Recruit, FFA, ten minutes and
25 kills. Native Deploy/canvas input acquires real focus and pointer lock; output
is muted by Chrome while WebAudio must remain running. Viewport is 1600x900/DPR1.
The default pass admits one grounded concealed station with >30m bot separation;
the same station must independently admit for later variants, or the comparison
fails. Only player ground position and aim are staged. No bot, health, life,
inventory, clock, animation or render override exists in the runner.

VERIFIED — each variant retains full uncropped menu, loadout, hip, settled ADS,
native firing, reload near .25/.50/.75 and native mouse-turn PNGs, with hashes and
before/after actual state. Reload window bounds are [.18,.36), [.43,.61) and
[.68,.86); the report retains the actual phase, not a claimed exact timestamp.
It checks real host magazine/reserve conservation, initial life, visibility,
native lock/focus, monotonically advancing observation time and render calls,
fixed hip/ADS aim, actual canary adoption/sockets/budgets, actual browser entry
bytes, and unchanged identity/runner/helper hashes. A phase crossed during a
screenshot remains a failed frame. All earlier files survive under a unique tag.

OPEN — the runner has not been browser-executed by this agent. Still screenshots
are not neutral component views or decoded motion-cadence proof. No standalone
neutral viewer was added; priority is the actual-game first-canary gate. The
retained hero comparison is optional for resource/budget scheduling, and is not
silently represented as having run. Successful capture status is only
`CAPTURED_PENDING_PIXEL_REVIEW`, never art acceptance.
