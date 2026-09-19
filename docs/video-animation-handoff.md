# Video-animation handoff — third-person grenade-throw body clip

Lane: Muse Spark 1.3 contributor, `nuketown-animation-polish-20260919`, exclusive.
No commit. No runtime/browser acceptance claim. Preserved lane work
(commit `0979a42` gait phase blending; uncommitted `first-person-hands.ts`,
`hand-geometry-canary.ts`, `verify-hand-integration.mjs`) intact and re-verified.
Follow-up 2026-09-19 (contact repair, root direction): mirrored LEFT-hand throw
(right keeps the rifle in stable carry), `thrown` enters AT the release beat,
hold watchdog CANCELS (never a fake release). CPU proofs re-run in this lane.

## 1. Source intake manifest

Source dir `C:/Users/david/Desktop/stuff/h3-soldier-study-20260919` preserved;
`review-chrome-profile/` excluded and untouched.

| file | sha256 | ffprobe |
|---|---|---|
| `first-person-hud.mp4` | `9c71232874b3bdbffae99a7f61dcef0c47a34ddf1c42f91c63c0148c9e3e93ee` | 8.000 s, 1920x1080, 24 fps, H264 + AAC |
| `third-person.mp4` | `896248f8f42799c5554273a9596463cdcbfdc4524d027f4e0a9e2a44f3a31e5b` | 8.000 s, 1920x1080, 24 fps, H264 + AAC |
| `specification.json` | read as CLAIMED reference | desired throw window 6.4–8.0 s |
| `first-person-events.json` | read as CLAIMED reference | throw 6.89–8.0, release 7.56; HUD ammo/cadence illustrative, never gameplay |

Action timings OBSERVED in footage (own frame review, CPU extraction ≤2 threads,
local scratch `captures/throw-intake/`, gitignored):

- Third person: `t690` windup (right arm high-back, rifle in left hand, stride
  split); `t730` late windup (arm near vertical, body upright); `t756`
  bent-over follow-through; `t780` recovered upright with rifle. `t650` is
  pre-throw locomotion (run/turn tail), not part of the throw.
- First person (contact sheet): sweep begins ~07.15, open-hand follow-through
  ~07.80. Consistent with the claimed 7.56 release; release is quoted as a
  CLAIMED marker, observed window 7.1–7.8.

Occlusions / anatomy inconsistencies:

- Throw subject is ~150–250 px tall: finger/hand detail unrecoverable, face
  never visible (rear view + helmet), rifle partly occluded by the torso in
  windup, feet motion-blurred in locomotion frames.
- Reference throws ON THE RUN; exact footwork is unrecoverable and was NOT
  fabricated (feet stay planted, root travel zero — see §3).
- Small dark sky speck at `t650`/`t756` could be the grenade in flight;
  unconfirmed, not relied upon.
- First-person footage shows right hand/forearm only; full body invisible, so
  it corroborates timing and hand shape, never stance.

Intended rig / axis / units: standard skeleton (`src/characters/skeleton.ts`),
21 bones, +z forward, +y up, metres, adult 1.78 m. Clip authored with the
existing `onceClip` euler keys (radians, XYZ), same builder as every other
procedural one-shot.

Licence / provenance UNRESOLVED (no clearance invented): MiniMax H3 model and
output terms were not read in this lane; the two MP4s are generated visual
references (not mocap, not skeleton truth) for local authoring only. First-
person HUD ammo/cadence is illustrative and does not touch gameplay.

## 2. What was built and why this one

Gap: the game had NO third-person throw body clip. `ClipName` covered 17
actions; Kimodo baked locomotion/turns/aim/fire/reload/hit-react/death; the
first-person `OrdnanceHand` throw is camera-local only. Bots' throws are
invisible on the body. Prone-to-crouch was NOT chosen: commit `0979a42`
already owns stance-transition phase continuity with a passing proof.

Deliverable: `throw` — 0.9 s standing LEFT-hand overarm toss, a mirrored
authored adaptation of the H3 right-hand reference (never
"video-reconstructed mocap", no skeleton extraction claimed): windup coil
(0–0.18, left arm high-back per mirrored `t690`/`t730`), release snap at 0.45,
follow-through (0.62), settle to rifle carry (0.9). The right arm/forearm stay
at carry throughout so the baked rifle never flails. Markers `THROW_BODY_S =
0.9`, `THROW_BODY_RELEASE_S = 0.45` exported from `clips.ts`, plus presentation
entry markers `THROW_BODY_HOLD_S` / `THROW_BODY_THROWN_ENTRY_S` (== release) /
`THROW_BODY_HOLD_MAX_S`.

Gameplay authority preserved: host arm/release claims, fuse table
(`ordnance.ts`), `THROW_SPEED_MS`/`THROW_LIFT_MS`, and the first-person
`THROW_S`/`THROW_RELEASE_S` cadence are untouched. WIRING IS IN THIS LANE:
`src/characters/throw-body.ts` consumes presentation-only cues off the
admitted ordnance projection (`OrdnanceView.bodyThrows`, fed by the same
`grenade-armed`/`grenade-thrown` events the flight replay reads) and drives
the rig; `main.ts` resolves actor ids onto bot bodies. `speed`/`stride`
are 0: the controller keeps root motion.

Root-review corrections applied (each with a CPU proof):

- **Release timing.** The clip never starts from zero on `thrown` — that put
  the visual release 0.45 s behind the authoritative projectile. An `armed`
  cue plays the windup into a HOLD (pinned at 0.18 s); `thrown` enters AT the
  release beat (`THROW_BODY_THROWN_ENTRY_S` == 0.45) or releases the hold into
  that same beat; a late notification with no `armed` cue takes the same entry.
  Any run-up before the beat is LAG (projectile already spawned), not lead. A
  watchdog (`THROW_BODY_HOLD_MAX_S` = 2.5 s) CANCELS an abandoned hold — never
  an autonomous fake throw. Death/revive/bind re-seat or clear the overlay.
- **Stance.** The clip no longer rides `playAir` (full-body mixer ownership
  froze locomotion/plant solve for 0.9 s). It plays through the existing
  masked upper-body overlay (`playThrowBody` → `OverlaySampler` +
  `UPPER_BODY`), so stand/crouch/prone/running keep their gait, root motion
  and floor contacts; the clip's Spine/Hips keys read only in the raw demo.
- **Weapon contact (contact repair).** The rifle is baked to the RightHand bone
  (mesh.ts, single skinned mesh) — it CANNOT be thrown with the right hand
  without flailing, and no hand-off is claimed. The clip throws LEFT-handed:
  left side released to 0 (the excursion reads; the left hand leaves the
  forestock and returns), right side keeps solving at full weight, pinning the
  rifle in stable carry at the chest. `applyCarry` takes `(wr, wl)`;
  `carryWeight` reads `min(right, left)`; per-side getters exist for QA. Tests
  reject rifle flailing (right-hand wander, barrel swing) and self-intersection
  (hand-hand, hand-chest gaps), not merely a reachable grip.

`+z` character vs camera-negative-forward, hand/weapon contacts, and
crouch/prone floor contacts preserved: feet flat and penetrating ≤3 cm
(inside the plant-solve trim band), hips dip bounded 3.5 cm and recovered to
zero, no materials/network/damage changes.

## 3. Files changed / added

- `src/characters/clips.ts` — `throw` in `ClipName`, exported markers
  (`THROW_BODY_S`, `THROW_BODY_RELEASE_S`, presentation entry markers),
  `lib['throw']` via `onceClip` (13 tracks, loop false).
- `src/characters/blend.ts` — `playAir` narrowed to `'jump' | 'land'`;
  `playThrowBody('anticipation' | 'release' | 'full')`, `cancelThrowBody()`
  and the `throwBodyPhase` QA getter on the masked upper-body layer;
  per-side carry (`carryRight`/`carryLeft`, `applyCarry(input, wr, wl)`,
  `carryRightWeight`/`carryLeftWeight` getters) with the throw split:
  LEFT 0, RIGHT stable carry; hold watchdog CANCELS in `update`; `revive`
  clears the overlay.
- `src/characters/throw-body.ts` — NEW: `ThrowBodyPresentation`, the event →
  body state machine (cursor-drained cues, bind/rebind re-seat + cancel,
  dead-rig guard, QA readout).
- `src/game/ordnance-view.ts` — additive presentation-only cue ring
  `bodyThrows` (`BodyThrowCue`, cap 32, monotonic `seq`), pushed by the same
  `grenade-armed`/`grenade-thrown` cases that already fed counts/log.
- `src/weapons/ordnance-scene.ts` — `get view()` exposing the live
  projection to presentation readers.
- `src/main.ts` — `ThrowBodyPresentation` wiring: `bind` through the
  `MatchUi.bindClient` seam beside `ordnance.bind`, per-frame drain after
  `ordnance.update`, actor id resolved onto `botBodies`.
- `src/characters/demo.ts` — demo button routes `throw` through
  `playThrowBody('full')` (raw playthrough for photography).
- `scripts/animation/verify-throw-clip.mjs` — clip proof, rig section now
  exercises the overlay path + per-side carry (see §4).
- `scripts/animation/verify-throw-presentation.mjs` — NEW integration proof
  (see §4).

## 4. Verification (all CPU, this lane)

- `node scripts/animation/verify-throw-clip.mjs` → PASS: track validity
  (LeftArm owns windup/release keys; RightArm has neither), left-hand
  forward-axis path + mirrored chest-coil reversal, floor contact, event
  markers, and the live-rig section proves the overlay keeps `run` ticking
  under the throw (hips animate, locomotion intact), the carry split (left 0,
  right 1), rifle bounds (right-hand wander, barrel swing) and no
  self-intersection (hand-hand, hand-chest gaps).
- `node scripts/animation/verify-throw-presentation.mjs` → PASS, the
  focused integration proof over the REAL projection/presentation/rig
  objects: real `grenade-armed`/`grenade-thrown` events through
  `OrdnanceView.apply` reach the right phases exactly once; the release
  entry is AT the beat (left hand forward within ~0.05 s; any run-up would be
  lag); anticipation holds then releases; the watchdog CANCELS an abandoned
  hold and never passes through `release` (no fake throw); stand/crouch-walk/
  run/prone-crawl keep their locomotion, hips motion and floor contacts under
  the overlay with the right carry stable and the left released; the LEFT-hand
  path rotates with a yawed root; the right hand/barrel stay bounded, the left
  hand leaves the forestock for the toss and returns (a tracking grip would
  fail the detachment check); hands stay out of the chest and apart; death
  cancels, revive recovers both carry sides with no stale hold, dead rigs
  ignore stale cues, rebind cancels presentation-driven holds and re-seats the
  cursor, unbind is a no-op with no leaked state.
- `npx tsc --noEmit` → clean (via `npm run check`, render-site allow-list
  OK). `git diff --check` → clean.
- `node scripts/verify-hand-integration.mjs` → PASS (preserved hand work
  intact). `node scripts/animation/verify-transition-polish.mjs` → PASS
  (gait blending intact).

## 5. Root acceptance steps (front / side / three-quarter / browser)

1. Serve this worktree, open the detached demo (`#clips`), run
   `__CHARS.playClip('throw')` — routes through `playThrowBody('full')`
   (raw playthrough; the game never uses that phase).
2. Photograph front, side, three-quarter at t ≈ 0.18 (arm high-back), t ≈
   0.45 (forward snap), t ≈ 0.62 (follow-through), t ≈ 0.9 (carry). Same
   seed/character/camera for before/after; low side view for floor contact.
3. In-game event path: the rig exposes `throwBodyPhase` (`none` / `hold` /
   `release`) for the anim QA surface. Have a bot throw (`match` ticks with
   bots armed): the body should wind up on `grenade-armed`, hold, and snap
   through on `grenade-thrown` while locomotion continues underneath.
   Check stand/crouch/prone and moving bots, and that the LEFT hand throws
   while the rifle stays pinned in the RIGHT hand in stable carry (baked
   binding; no hand-off is claimed). Front/side/prone frames owned by root.
4. Browser visual acceptance remains OPEN until root looks at the frames.

## 6. Inventory

- This handoff: `docs/video-animation-handoff.md`
- Implementation + verifiers: see §3
- Scoped throw-only patch (this lane worktree root, hand/gait files excluded;
  hands/gait stay independently reviewable via their own verifiers):
  `work/throw-body-left-hand.patch`
- Local-only intake frames (gitignored, not shipped):
  `captures/throw-intake/{t650,t690,t730,t756,t780}.jpg`
