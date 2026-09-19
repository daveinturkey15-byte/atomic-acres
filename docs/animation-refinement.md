# Animation refinement — 2026-09-19

This lane is a code-only refinement against recovery head `438a1aee0028d0607fc379d7de6ba89f4e131de2`.
No new model, video, Blender output, or browser capture was introduced here.

## Verified changes

- `src/characters/blend.ts` now derives the walk/run and run/sprint boundaries
  from the active `ClipSpec.speed` values. The current baked clips report walk
  `1.97`, run `2.67`, and sprint `2.84` m/s, so the sprint handoff is now the
  measured midpoint `2.755` m/s. If the bakery is absent, the procedural
  `1.1/3.4/5.5` speeds restore the previous fallback behaviour through the
  same midpoint rule.
- `src/characters/clips.ts` adds authored `prone-idle` and `prone-crawl`
  clips. The prone pose is low and face-down, keeps the helmet/head above the
  ground, alternates a short arm and knee pull for the crawl, and publishes
  `0.42` m/s plus a `0.567` m stride for controller-owned root travel.
- Idle now has a small looping weight shift in the hips, chest, head and arms,
  so the procedural fallback does not read as a frozen mannequin.
- Reload carries the rifle at `0.28` constraint weight during the upper-body
  reload layer. This leaves the authored hand excursion visible while keeping
  the weapon from snapping away; prone disables the carry solve so it can hold
  its low support pose.
- `RigInput.prone` is optional for source compatibility. The QA surface accepts
  `__NTANIM.drive(index, speed, crouch, prone)`; the existing three-argument
  call remains valid.

## Verification

- **VERIFIED** `npm run check` passed (`tsc --noEmit` and render-site allow-list).
- **VERIFIED** existing baked sprint GLB: 21 nodes, 40 frames, 1.300 s,
  authored speed `2.84` m/s, 4.0 cm offline foot slide, root X/Z stripped,
  constant thigh/shin lengths, zero non-finite values.
- **VERIFIED** existing baked crouch idle GLB: 53 frames, 1.733 s, hip range
  `0.365–0.370` m, toe range `0.022–0.031` m, root X/Z stripped, zero
  non-finite values.
- **OPEN** The new procedural prone clips still need the root preview's four
  camera capture and the in-game foot/contact read. That requires the root
  lane's serialized browser pass; this lane did not start a browser or GPU job.
- **OPEN** The main/game input must set `RigInput.prone` when the gameplay
  stance is wired. The QA path is ready, but no main.ts/game integration was
  changed in this lane.

## Integration note

When wiring prone in the root lane, set `input.prone = true` and drive speed
`0` for the hold or a small positive speed for the crawl. Clear `input.crouch`
while prone so the stance selection remains unambiguous. Keep the current
loaded clip metadata as the authority for locomotion thresholds.
