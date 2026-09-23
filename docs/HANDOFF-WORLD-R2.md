# HANDOFF-WORLD-R2 — world/atmosphere lane verdict (2026-09-23 ~14:10Z)

Owner: Worldsmith. Branch `layout-boii-proportions`, HEAD `56d2f46` + uncommitted work below.
Committed nothing. Touched tracked files: ONLY `src/build/white-house.ts`,
`src/core/materials.ts`. Resumed (edited) untracked drafts: `src/core/atmosphere.ts`.
Untouched: `main.ts`, `index.html`, characters/anim/game/ui/weapons/net, all other lanes' files.
`npm run check` green (tsc 0 + render-sites OK). No files outside ownership written.

## 1. Bedroom-door fix — DONE, proven both directions
`src/build/white-house.ts`: the bed stood across the hall doorway (bed x
-4.69..-2.79 over door -4.45..-2.85, 10 mm off the partition). Rotated 90°:
0.9 × 1.9 m, headboard on the face wall, east edge 0.30 m clear of the door's
west jamb; side table moved east of the bed; storage unit/speakers kept.
`scripts/_bedroom-probe.mjs` (kept, re-runnable): stair-head flood at y=3.3
with the green-room opening SEALED — pre-fix tree FAIL (hall route blocked),
fixed tree PASS (doorway cells free, bedroom reached). `paths.mjs --y 3.3`
still all-YES. Side effect: white-house coplanar pairs 4406 -> 4408
(headboard end faces, opposite-normal flush contacts, fights unchanged).

## 2. Z-fight sweep VERIFY — HOLDS, no re-architecting
`node scripts/coplanar.mjs --json`: fightsOver001 **1411 (before) -> 922
(now)**, fights 1672 -> 1115, visibleOver001 801 -> 439 — exactly the
builder's after-values (`captures/_zfight-summary-after.json`).
Collider diff after-dump vs fresh (`captures/_zfight-colliders-verify.txt`):
the sweep's five files (ground/orange/surround/third/yards) byte-identical;
white-house deltas fully explained (owner-fix re-plan + bedroom fix above:
old bed `-4.69,3.15,23.62,-2.79,3.70,24.52` out; new bed/headboard/table in).
Residual (known, NOT this lane): vehicles 51 fightsOver001 (46 visible,
trailer/side-doorway strip) — verify-only mandate, left for a budget lane.

## 3. Atmosphere / volumetric smoke — WORKS in game, 1 gate left
Pre-existing draft was complete (presets, haze, rain, wetness, march); two
real defects found by pixel falsification (all stats via `_critic-png.mjs`):
- (a) FIXED (`src/core/atmosphere.ts` SmokeAdapter.update): the pull route
  REPLACED the push list, so once lead bound the client-less live feed every
  QA/test volume rendered nothing (beauty meanAbs 0.00 with 3 live). update()
  now merges source + own vols, retires only its own. tsc clean.
- (b) Lead's feed (`main.ts` bind + `ordnance-scene.ts` smokes getter) landed
  and typechecks; `mat.smoke()` added (`materials.ts`: cached singleton,
  unlit/transparent/no-depth-write, PAL.fog) for the ordnance lane's switch.
Proof (real rAF loop, WebGPU Chrome, zero page errors): post-load injected
cloud vs pre — meanAbs 20.86, 58.6% changed; URL volumes similar; `?post=smoke`
mask mean 156; presets × stations + toggles + 60 fps all in
`captures/atmo-verify.json` (verifier EXIT 0, lights 3 across 7 switches).
Live match attempt-1: real 5-bot TDM threw **10 smoke-volumes, 0 errors** —
game events reach the view; no frame caught one in view (fixed street camera).
Attempts 2-3 (fly overview; `?post=smoke` mask route, zero-confound): 8 + 5
smokes, 0 errors, 0 rendered. ROOT CAUSE OF THE MISS (structural, not luck):
`host-ordnance.ts:307` kinds volumes by grenade def — frag detonations emit
BLAST-kind, only the 'smoke' tactical emits grenade-kind — and the proof
filtered grenade-kind only while bots threw lethals (thrown==detonated==smokes
in both runs). The source leg is therefore still pixel-unproven for BOTH kinds.
NEXT STEP (one line in the kept script): accept any fresh smoke id, poll
500 ms, shoot at fill+100 ms (blast lives 5 s; threshold mask mean>0.8).
`scripts/_live-proof.mjs` kept for this; attempts ran
`node scripts/_live-proof.mjs` on the BannU8kz dist.
KNOWN GAP (harness-only): sync QA renders (`goto` + back-to-back `render()`)
show a stale smoke RTT; rAF/live is correct. `capture.mjs` frames will never
show smoke; `playcap` will. Did not touch frame-scoping (fixes double-march cost).

## 4. Polish list (settled list only; owned files only per lead)
- `mat.smoke()` — APPLIED-NOW (`src/core/materials.ts` interface + factory).
- blast FF rule — APPLIED-ALREADY, not my files: `src/game/damage.ts`
  (null attacker never friendly; FF gate covers all causes) +
  `src/game/host-life.ts:73` admitPreResolved + self-damage explosion rule.
- knife team check — OPEN, lead: `src/game/host-ordnance.ts:177` meleeClaim
  picks nearest actor with no team filter (downstream FF blocks damage but the
  swing is consumed on team-mates).
- ui.bindMatch + stale-body hide — OPEN, lead: `main.ts` never calls
  `ui.bindMatch`; body loop `main.ts:326` never hides rigs that left `match.bots()`.
- session-solo/bots primaryId — OPEN, lead (`src/game/session-solo.ts`,
  `src/game/bots.ts` carry no primaryId threading).
- grenade-counter HUD overlap — OPEN, lead (`src/ui/hud.ts:358` setter;
  layout overlap not diagnosable without vision).
- photoreal-targets scripts: preserved untouched; generation half needs the
  Antigravity bridge + vision quota — NOT-APPLICABLE this lane.

## 5. Gates (dist `index-BannU8kz.js`, built from this tree)
- `npm run check`: GREEN. `capture`: EXIT 0, 10/10 stations, max 1138 calls
  (budget 1200), 0 errors. `traverse`: 5/5 routes, 4/4 faces, invariant PASS.
- Serving identity at handoff: NO persistent servers on :4173/:4188/:4190
  (all connection-refused); harnesses spawn the shared :4188 preview on demand.
- Evidence kept (all gitignored): `captures/_proof*.png`, `_live-*.png`,
  `atmo-*.png`, `atmo-verify.json`, `_zfight-now/summary-now/colliders-verify`,
  `_atmo-run.log`, `_capture-run.log`. Deleted throwaways: `_bedroom-probe.mjs`
  kept (re-runnable proof), `_smoke-proof.mjs` removed (superseded, outputs above).

## For lead
1. Puff gate: run `node scripts/_live-proof.mjs` (attempt-2 may still be
   running) — PASS = live grenade smoke pixels; then retire `grenades.ts:72,141-169`.
2. Sync-QA smoke gap (capture path) is documented above; game path proven.
3. Model: meta/muse-spark-1.3-contributor. Stop 19:30Z respected (early).
