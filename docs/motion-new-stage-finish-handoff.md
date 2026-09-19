# Motion new-stage finish — source-only handoff

Lane: `nuketown-animation-polish-20260919`. No browser/GPU/server run here; root runs the proof. Source-only done != acceptance.

## Why 2124 failed (root looked at frames)

Revision-2 `verify-motion-live.mjs` parked every lens at `dz < 0`. Source says the rig faces **+Z** (`skeleton.ts` "Forward is +z", `mesh.ts` receiver "laid along +z points where the figure faces", `blend.ts` weapon follows "actor-forward (+Z)"). Lenses behind the actor read `back` in 17/21 cells — correctly. It also staged off `overlay.click()` + 1500 ms (spawn reset the first lens mid-warmup: interior with no actor) and trusted `collidersAt` points only (lens inside uncollided annex geometry; actor collocated with a pole).

## What changed (3 files, no game/animation tweaks)

- `scripts/animation/verify-motion-live.mjs` (rev 3): imports `motion-stage.mjs` as the single staging truth (no second convention). Real menu path — clicks **Play solo → Deploy**, awaits `__NTGAME.snapshot().match.phase === 'active'` before staging. Named `STAGE_ANCHORS` in order, each probed with the whole-subject set (footprint ring + every lens feet column + point-sampled lens→chest sight-lines); first zero-hit anchor wins, else frame-visible fatal. Projected/visibility numbers accepted **only if** live `__NT.playerPose()` + `__NTANIM.list()[0]` still match the expected lens + stage after settle (`POS_TOL` 0.08 m, `ANG_TOL` 0.03); respawn/drift = `poseMismatch` failure, never a pass. Accepts `--url/--tag` (env `MOTION_URL`/`NT_URL`, `MOTION_TAG`); default URL is the **4195** candidate; refuses `:4188`; always closes the owned stock Chrome in `finally`.
- `scripts/animation/_verify-motion-stage.mjs` (new): browser-free falsifier, 41 assertions — +Z hemisphere, `atan2(dx,dz)` yaw, design facing vs gate, probe-family coverage, bounded-9/full-21 plans, harness wiring strings, frozen thresholds. Proved it bites: a `dz<0` lens reads `designChestDot -0.976 → back` (the 2124 signature).
- `src/main.ts` (additive read-only): `__NT.playerPose()` — live player/lens pose for settle assertions. No writes, no animation/render change.

Frozen/kept: phase pins (hold 0.18 / release 0.45 / recovery 0.70, `ELAPSED_TOL` 0.05), facing gate 0.35 / frustum 0.65 / distance 1.2–3.2 m, dark 40, budgets 1200 calls / 900 k tris / 24 frames, visual-playback-only claim (no mocap, no grenade-event synthesis).

## Verification here (CPU only)

`node scripts/animation/_verify-motion-stage.mjs` → 41/41 pass. `node --check` on all three scripts. `npx tsc --noEmit` → clean.

## Root run

Rebuild dist from this lane first (harness refuses a dist predating `playerPose`/scrub/visibility/detail), then:

```bash
node scripts/animation/verify-motion-live.mjs --url http://127.0.0.1:4195/ --tag <unique-tag> --views bounded
```

`--views full` restores 21 frames once staging is trusted. Optional quiet stage: set bots to 0 in the Solo panel before Deploy (manual; the harness never changes product defaults — a mid-proof death/respawn reads as pose failure by design). Acceptance = root-looked frames: front/side/threequarter correct, actor unobstructed, 9/9 (then 21/21) orientation cells pass with no threshold relaxation.
