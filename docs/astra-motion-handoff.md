# Astra first-person motion candidate — 20 September 2026

VERIFIED source: `d4406fdbfb62e8f7424f4378aab2cb8f3803da72`, branch
`art/astra-motion-20260920`, worktree
`C:/Users/david/Desktop/stuff/worktrees/nuketown-astra-motion-20260920`.
Base: `e8b4b6d75e9e9843e4affe22f393dd07ba2388c6`. Owner requested
`gpt-6-astra` / `xhigh` for this specialist, with implementation stopped before
09:00 Europe/London on 2026-09-20. No child agents or CLI workers launched.

VERIFIED candidate is opt-in: `?motion=canary`. Default weapon transforms and
hand reload path remain present. `__NT` weapon state reports `motionCanary`.
The frozen 4212 artifact and its 233c7d7 source were not modified.

## Root integration requirement

OPEN required root-owned edit: add `prone: player.getStance() === 'prone'` next
to `crouched` in the movement sample sent to weapons in `src/main.ts`. The new
field is optional for compatibility, but low prone arms need the real field.
This lane has not changed `main.ts`, run a browser, or promoted an artifact.

VERIFIED build: `npm run check` and `npm run build` pass. Local bundle
`dist/assets/index-CABw0VVM.js`, SHA-256
`82b42bf27b42a6a71a5a8b4a7aab8fc01a19a695d3ce340ec1730ecbd9225321`.
Rebuild after integration: the main.ts field changes the source/build identity.

## Contributions and contract

- VERIFIED Astra authored `viewmodel-motion.ts`: bounded camera-look inertia,
  damped visual recoil, quieter aimed stride, hip-to-ADS transition, visible
  reload roll/lift, sprint carry and stance-aware offhand withdrawal. Settled
  ADS retains the exact old mount and existing hero sight corrections.
- VERIFIED Astra authored `first-person-hands-motion.ts`: independently rotated
  wrist, authored release/reach/seat/return with the palm constrained to the
  existing reload target, and existing sleeves mapped between live wrist and
  a following elbow at constant length. No runtime geometry/material changes.
- VERIFIED controller edits read its existing timers, kick and ordnance lower
  value. Fire, reload completion, ammo, FOV, recoil authority and action claims
  are unchanged. Ordnance suppresses the support reload reach while it owns
  the action. Weapon switch and hidden/resumed state reset presentation lag.
- VERIFIED rig names and public `updateReload` / `resetReload` remain. The
  optional `updatePose(crouch, prone, handLower)` supplies presentation blends.
  Sleeves remain children of their hands; their local matrices counter the
  hand transform before applying a rigid wrist/elbow attachment. Only those
  two existing sleeve groups disable `matrixAutoUpdate` while the canary is on.
- VERIFIED no added mesh, material, texture, light, renderer, clip or GPU job.
  Generated owner video was a motion reference only; no skeleton/mocap extracted.

## Mechanical evidence

VERIFIED `node scripts/verify-viewmodel-motion.mjs` passed:

- Five actual rig paths retain wrist/sleeve continuity and sleeve length within
  `1e-8 m`; the palm meets each measured seat target within `1e-8 m`. Negative
  controls detect a 20 mm detached sleeve and 20 mm shifted contact.
- All 20 catalogue profiles map to the intended five fallback rigs and retain
  exact settled ADS endpoints through tested transitions. This is explicitly
  20 profile coverage, not 20 distinct authored weapons.
- 6,970 simulated real-controller frames cover the 17 admitted profiles,
  including the crossbow canary. All 172 shot/throw/knife claims, HUD/ammo,
  reload, cadence, FOV and camera recoil compare exactly to the frozen controller
  with the candidate both enabled and disabled.
- Full geometry, level-camera crouch/prone, hip/ADS, seven reload samples and
  three offhand blends remain at least 20 mm above the floor. Worst pistol
  clearance is 20.321 mm; other families 52.414 mm. Extreme look pitches and
  world/chest visual intersection remain OPEN for real-game review.
- 50,000 warmed transform updates cost approximately `0.00122 ms` each on this
  CPU run, below the declared `0.2 ms` ceiling. This does not measure renderer
  frame time, FPS or mobile. Geometry hashes and material identity stayed fixed.

VERIFIED results: `docs/astra-motion-evidence/cpu-result.json`.

## Preserved failed trials and remaining visual work

VERIFIED initial motion r0 failed the prone offhand floor check at -279 mm.
Local correction r1 replaces downward movement with lateral withdrawal in low
stances and initializes existing stance immediately on switch/resume. The
original helper is retained locally at `work/astra-motion/viewmodel-motion-r0.ts`;
the failed receipt is `docs/astra-motion-evidence/floor-r0-rejected.json`.

VERIFIED supplied Muse 0558 pistol geometry was staged and its original C1-C5
proof executed. C1 passed (+900 triangles), C4/C5 passed. C2 failed the 5 mm
thumb/finger envelope; C3 failed a 16.6 mm index contact (8 mm ceiling) and 137
vertices inside the declared grip solid by more than 2 mm. The assertions were
not changed. It is REJECTED and no proposed geometry/material entered `src/`.
Source provenance remains the original `nuketown-audio-20260919/work/
pistol-hand-authoring-0558` handoff. Staging only corrected a mismatched interface
closing-brace patch context. Full output is `muse-0558-rejected.txt` beside the CPU
result; staged proposal remains local in `work/astra-motion/muse-trial`.

OPEN root browser review: compare the 17 baseline frames and actual recordings
with candidate hip, ADS, firing, reload, sprint, crouch, prone and throw poses.
Judge wrist direction, whether the seat reads as contact, weapon/hand occlusion,
and camera motion. No art acceptance, photorealism or FPS improvement claimed.
This candidate animates the existing glove meshes; it does not create separate
magazine extraction, moving fingers, or an anatomical grenade-throwing arm.

## Source checks and operational notes

VERIFIED installed Three.js is 0.180.0. Read current official
[index](https://threejs.org/docs/llms.txt),
[Quaternion](https://threejs.org/docs/pages/Quaternion.html),
[Matrix4](https://threejs.org/docs/pages/Matrix4.html), and the
[IK example](https://threejs.org/examples/webgl_animation_skinning_ik.html).
Used stable matrix/quaternion APIs against the installed build; no example code
or old-project assets/modules copied. The rig is an original rigid attachment
solver, not the example's skinned CCD solver. Poimandres is not needed here.

VERIFIED native Codex adoption check passed and audit printed no local Codex
failure. AKP active HEAD/origin both `34b9dc8`; unrelated receipt/evaluation edits
made worktree currency OPEN, preserved untouched. High performance power plan
verified. Git identity was absent; source commit used per-command Codex Astra
identity, without changing shared or global Git configuration.
