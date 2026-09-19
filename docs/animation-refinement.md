# Animation refinement — 2026-09-19

This lane is a code-only refinement against recovery head `438a1aee0028d0607fc379d7de6ba89f4e131de2`.
No new model, video, Blender output, or browser capture was introduced here.

## Verified changes

- `src/characters/blend.ts` now derives the walk/run and run/sprint boundaries
  from the active `ClipSpec.speed` values when no gameplay gait flag is present.
  The current baked clips report walk `1.97`, run `2.67`, and sprint `2.84` m/s,
  so the fallback boundaries are the measured midpoints `2.32` and `2.755` m/s.
  If the bakery is absent, the procedural `1.1/3.4/5.5` speeds restore the
  previous fallback behaviour through the same midpoint rule.
- `src/characters/clips.ts` adds authored `prone-idle` and `prone-crawl`
  clips. The prone pose is low and face-down, keeps the helmet/head above the
  ground, alternates a short arm and knee pull for the crawl, and publishes
  `0.42` m/s plus a `0.567` m stride for controller-owned root travel.
- The prone clearance correction now uses a pelvis rotation of `1.52` rad,
  neutral trunk tracks, a `0.40` rad lower-leg bend, and `1.20` rad forearm
  placement. This keeps the torso, knees, lower legs, boots, and support arms
  as one visible floor-level silhouette while leaving the root travel and
  collision dimensions untouched.
- Idle now has a small looping weight shift in the hips, chest, head and arms,
  so the procedural fallback does not read as a frozen mannequin.
- `RigInput.sprinting` is now an optional gameplay-owned gait flag. When it is
  explicitly `false`, an upright moving body selects the measured walk/run
  band: low non-sprint motion walks, while the player's normal 4.8 m/s pace
  reads as a jog/run. When `true`, it selects `sprint`. The old measured
  clip-speed threshold remains only when the field is omitted, preserving the
  offline QA/demo callers while preventing a normal player pace from inheriting
  the baked sprint clip.
- Locomotion playback uses the active clip's measured authored speed through
  `locomotionTimeScale()`, with finite/positive guards. At the current speeds,
  the loaded baked rates are walk `1.97`, run `2.67`, sprint `2.84`,
  crouch-walk `1.40`, and procedural prone-crawl `0.42` m/s; the resulting
  scales are approximately `1.798`, `2.324`, `1.964`, and `2.976` for the
  4.8 m/s jog, 6.6 m/s sprint, 2.75 m/s crouch, and 1.25 m/s prone cases.
- Reload carries the rifle at `0.28` constraint weight during the upper-body
  reload layer. This leaves the authored hand excursion visible while keeping
  the weapon from snapping away; prone disables the carry solve so it can hold
  its low support pose.
- `RigInput.prone` is optional for source compatibility. The QA surface accepts
  `__NTANIM.drive(index, speed, crouch, prone, sprinting)`; the existing
  three- and four-argument calls remain valid and keep the measured fallback.

## Verification

- **OPEN** `npm run check` was attempted but the isolated lane is blocked by the
  existing `src/weapons/controller.ts(39,122): Cannot find module '../audio/service'`;
  the browser-free gait proof below bundles the character sources independently.
- **VERIFIED** existing baked sprint GLB: 21 nodes, 40 frames, 1.300 s,
  authored speed `2.84` m/s, 4.0 cm offline foot slide, root X/Z stripped,
  constant thigh/shin lengths, zero non-finite values.
- **VERIFIED** existing baked crouch idle GLB: 53 frames, 1.733 s, hip range
  `0.365–0.370` m, toe range `0.022–0.031` m, root X/Z stripped, zero
  non-finite values.
- **VERIFIED** `node scripts/animation/verify-gait-speeds.mjs` bundles the real
  blend helpers and reads `public/anim/manifest.json`: stationary selects idle;
  explicit 4.8 m/s non-sprint selects run; explicit 6.6 m/s sprint selects
  sprint; 2.75 m/s crouch selects crouch-walk; and 1.25 m/s prone selects
  prone-crawl. It also records the historical failure: an omitted sprint flag
  sends 4.8 m/s through the baked `2.755` m/s run/sprint midpoint and selects
  sprint.
- **VERIFIED** `node scripts/animation/verify-prone-clearance.mjs` samples 37
  points across each full prone cycle and transforms every dressed skinned
  vertex. Corrected minima are `0.0039 m` surface / `0.0482 m` leg for
  prone-idle and `0.0053 m` surface / `0.0053 m` leg for prone-crawl; knee and
  toe joints remain above `0.095 m` and `0.107 m`. The recreated prior pose is
  a negative control: it reaches `-0.319 m` / `-0.055 m` in idle and
  `-0.345 m` / `-0.091 m` in crawl.
- **VERIFIED** the upper extrema are hand/weapon-bound cosmetic geometry, not
  the gameplay body envelope: the highest vertices are on `RightHand` at
  `0.568 m` idle and `0.641 m` crawl, while the complete Hips/Spine/Chest/
  Neck/Head surface stays at `0.445 m` and `0.450 m`, below the authoritative
  `0.52 m` prone capsule height. No collision or pose-height change is needed
  for this result.
- **VERIFIED** the root gait harness produced the bounded ten-frame capture;
  **OPEN** visual acceptance remains because the inspected
  `captures/gait-poses/10-prone-side.png` showed the pre-correction pose with
  lower legs and feet occluded by the lawn. Root must rerun that real browser
  capture against this correction before accepting the silhouette.
- **OPEN** The main/game input must set `RigInput.prone` when the gameplay
  stance is wired. The QA path is ready, but no main.ts/game integration was
  changed in this lane.

## Integration note

When wiring prone in the root lane, set `input.prone = true` and drive speed
`0` for the hold or a small positive speed for the crawl. Clear `input.crouch`
while prone so the stance selection remains unambiguous. Keep the current
loaded clip metadata as the authority for locomotion thresholds.

For gameplay bodies with an authoritative sprint state, the root hook should set
`handle.input.sprinting` from that state every update, alongside `speed`:

```ts
handle.input.speed = body.speed;
handle.input.sprinting = body.sprinting;
```

If a body has no sprint state yet, the root lane may derive a presentation-only
flag from its authoritative stand-speed boundary, with hysteresis around
`5.5 m/s` (for example, enter at `5.5`, leave at `5.3`). Keep that flag local to
the presentation handle; do not add it to the network body protocol. This is
an inference from the current `4.8` walk and `6.6` sprint speeds, not a verified
pixel result, and remains **OPEN** until the root lane captures both states in
the game.
