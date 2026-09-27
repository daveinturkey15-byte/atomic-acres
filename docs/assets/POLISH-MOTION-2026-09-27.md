# Motion polish — September 27, 2026

VERIFIED source/CPU checkpoint; moving pixels, owner approval and performance in
the rendered game remain OPEN. This is one initial source take, with no completed
visual repair iteration. Baseline is `b9adb96b561378adf679cafc925a871820134746` in
the restart's `salvage/full-game-20260926` checkout. No browser, GPU, Blender,
inference, model download, new clip or build ran in this worker.

## Changes and integration

VERIFIED `viewmodel-motion.ts` now gives the existing presentation profiles
different carry weights: pistol .7, SMG .85, rifle 1, LMG 1.7, DMR/shotgun 1.3,
sniper 1.45 and specials 1.2. These are authored response factors, not physical
mass measurements. Sprint enters and recovers exponentially at different rates;
look lag and recoil recovery retain their existing hard displacement bounds.
The root passes the actual `weaponFamily(def.id)` so LMGs no longer inherit the
rifle response merely because they once borrowed its mesh.

VERIFIED an optional final `grounded = true` argument adds one bounded landing
gesture after at least 80 ms airborne. Its maximum standing displacement is
9 mm down and .018 radians pitch, with a .065-second downstroke and .21-second
recovery. It is a fixed gesture, not an inferred impact force. Repeated grounded
frames, short ground-contact chatter, reset, full ADS and full offhand ownership
do not produce a pulse. The root supplies `move.grounded`; old callers remain
compatible. All nine families retain settled ADS `(0, -.148, -.3)` and zero
rotation. These motion changes use the existing `motion=canary` presentation
path, including the current authored defaults; this adds no new feature switch.

VERIFIED the reload presentation keeps its full receiver pose through normalized
phase .79, when the existing ordinary support-hand path clears its return
waypoint, then settles by phase 1. It does not change reload duration, magazines,
charge admission, weapon events or any host state. `first-person-hands-motion.ts`
was inspected and left unchanged: original seat coordinates, custom wrapped-hand
paths and offhand coupling remain intact. No finger motion, detached magazine or
new hand-contact solution is claimed.

VERIFIED `presentBody(handle, body, now)` now returns the displayed horizontal
speed. The root uses it for the character mixer and sprint hysteresis. Previously
the local body position was buffered by 50 ms while the mixer used the latest
simulation speed. The retained actual-source negative shows a displayed speed
of 0 with animation speed 4 at movement start, then displayed speed 4 with
animation speed 0 at stop. The new result follows the rendered displacement.
First placement, teleport, death/revival, sample clock reset, stale gap and
buffer-mode change return zero. Network-interpolated guests gain no additional
position delay. Simulation positions, collision and hit admission are untouched;
`rootMotion` remains false. This removes one source of sliding; planted-foot
quality and transition anatomy still require actual character playback review.

VERIFIED no runtime vector/array/resource allocation was added to the existing
viewmodel update. Body bookkeeping allocates once per character handle in a
WeakMap, then mutates scalar fields. No meshes, lights, textures or new materials
were added. Existing rejected hand/weapon assets remain opt-in and unchanged.

## Source study and claim boundaries

VERIFIED read `game-animation-asset-pipeline` Lane A4 and Skills Lab
`docs/source92-97-practice-research.md` sources 95/96. The transferable method is
explicit timed poses, stable destination-rig conventions and review through
previous/current/future poses. This pass authors the existing runtime transforms;
it does not claim the full Blender intermediate/export workflow was executed.
The social-source tools and their claimed results were not reproduced here.

VERIFIED read Skills Lab `src/lab/gallery/local-motion-study.ts`: owner video is
loaded as a local blob URL, revoked on replacement/disposal, with source FPS
explicitly UNKNOWN. The viewer does not extract a skeleton or retain a motion
asset. The suggested sibling `source30-motion-reference.ts` was not found under
that Lab's `src` tree; its exact location remains OPEN, rather than invented.

VERIFIED read retained `h3-soldier-study-20260919/specification.json` and
`first-person-events.json`, plus this repository's `video-animation-handoff.md`.
Those generated-video action markers and illustrative HUD ammunition are
reference metadata, not authoritative gameplay or recovered motion capture.
The private source video, browser profile and licences were not changed, copied
or republished. No H3 timings were used to alter gameplay.

VERIFIED installed Three.js is 0.180.0. This change uses existing Vector3/Euler
operations and scalar math already present in these modules; it introduces no
new renderer API or dependency.

## CPU verification

VERIFIED `node scripts/_verify-polish-motion.mjs initial` passed **7/7 groups**.
Receipt: `captures/polish-motion-20260927/initial/result.json`. The receipt folder
retains the exact baseline source modules and separate bundles; subsequent runs
must use a new tag and cannot overwrite it. Existing verifiers were not edited.

- VERIFIED 30/60/120 Hz sprint timing agrees to numeric precision; all nine
  families settle exactly on the ADS endpoint through recoil/stance/air changes.
- VERIFIED landing peaks are 8.99996 mm at all three rates, within one rendered
  frame of the authored peak. ADS/offhand/short-air/reset controls remain still.
- VERIFIED reload hold/return seams have vanishing endpoint slope and exact
  bind endpoints; the old .79 early-rise control remains detectably different.
- VERIFIED buffered movement start/stop reproduces the old mismatch and fixes
  it using actual `presentBody` output. Lifecycle resets and shortest-arc yaw
  pass; guest positions remain undelayed.
- VERIFIED five actual hand rigs retain measured seat contact and rigid sleeve
  length/attachment, with worst numeric seam below 1.4e-16 m and unchanged
  geometry hashes. A 20 mm shifted target is rejected by the same predicate.
- VERIFIED persistent output objects are reused. A warmed 30,000-update CPU
  loop measured 0.000252 ms/update, under the unchanged .2 ms CPU bound. This
  says nothing about game FPS, GPU cost, mobile or renderer memory.

OPEN full-check result: `npx tsc --noEmit` found an out-of-scope concurrent error
at `src/core/architectural-materials.ts:100`: MathNode is not assignable to the
inferred OperatorNode type. No motion-source diagnostic appeared. Root owns the
material edit and combined final check; this receipt does not claim it passed.

## Frozen files and review next

VERIFIED worker-owned source hashes (SHA-256):

| Path | SHA-256 |
| --- | --- |
| `src/weapons/viewmodel-motion.ts` | `ab04571f2b63fa99a4f09e280edcc9041c8314248454b0696ff4b079575884fc` |
| `src/characters/body-presentation.ts` | `3b24a0d3d52aa85267cc2664c893ef91ed6be1eb309a40a475e535ea4bf81b0c` |
| `src/weapons/first-person-hands-motion.ts` (unchanged working bytes) | `aa75be4674f04814674c96ed5e047b9f21f866fc5d720b205d7f55e1e6c2f3aa` |
| `scripts/_verify-polish-motion.mjs` | `d71698194c9fb2cb7b12a0ba6973d58c922d7869199b35e839ad09610a5748cc` |

OPEN root review: on an exact built candidate, retain paired 5–8-second motion
recordings for pistol/rifle/LMG sprint-stop and one genuine jump landing, plus a
complete real reload and ADS settle. Record displayed poses and action progress;
compare previous/current/next frames at identical elapsed times. Check support
contact, wrist continuity, receiver occlusion, recoil weight, body start/stop and
standing/crouched/prone floor clearance. Inspect the third-person character from
front, side and three-quarter views. Do not promote this from CPU measurements
or a still frame alone. No renderer input or owner process is authorized by this
document; root retains the separate execution and resource gate.
