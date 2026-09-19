# Semtex inventory boundary — second bounded repair (lane handoff)

## Verdict

**Correct animation beat + bounded projection delivery. NOT a product bug.**
No game-authority change. Scoped patch is QA-only (`scripts/lib/semtex-analysis.mjs`
+ CPU falsifiers + this doc), plus the copied root JSDoc-delimiter fix in the
lane verifier. No live-proof claim from this lane (CPU source-only, no
browser/GPU/server/subagents per the brief).

## What failed and why

Root live run `verify-semtex-live-semtex-2224.json` (WebGPU, manual
PlaySolo→Semtex→Deploy→active match): 17/18 PASS, only `inventory-consumed`
REFUTED with `pouch had a charge -> 0, armed seen=true cleared=true
STILL ARMED after release`.

The old assertion split frames at `releasePerfNow` (button-release INTENTION
timestamp 20275.5 ms) and forbade ANY `armed === 'semtex'` afterwards. The
receipt shows 7 frames armed after intent (t 20291.9–20396.8), own
`grenade-thrown … id=1` at **20387**, last observed armed 20396.8,
first `tactical 0 / armed null` + own flight visible at 20414.8, detonation id 1
at 21889 (fuse 1034 ms, blast 0.196 m from stick, 59 stationary frames, one
throw/one event/no respawn/no errors).

## Authoritative source chain (this is the beat, not a bug)

- `src/game/host-ordnance.ts` `grenadeClaim`: **arm** sets `kit.armed` and emits
  `grenade-armed` + `ordnance-inventory` with the pouch **unchanged**; the
  **second claim (throw)** does `kit.tactical--`, `kit.armed = null`, and emits
  `grenade-thrown` + `ordnance-inventory` in the same tick. The pouch moves only
  on the admitted throw.
- `src/game/ordnance-view.ts` `'ordnance-inventory'`: view applies that event to
  `self.tactical/self.armed`. The sampler reads `o.self.*`, so it clears only
  when the commit's inventory event arrives.
- `src/weapons/ordnance-hand.ts`: `release()` only does `start('throw')`; the
  claim fires at `THROW_RELEASE_S = 0.12 s` (`releasePending`).
- `src/weapons/ordnance-input.ts` `update` + `src/weapons/controller.ts` drain:
  `consumeRelease → releaseWaiting` (gated on host-confirmed arm) →
  `pending.push → takeClaim → claim`. The harness's `releasePerfNow` stamps
  `command('grenade')` (intention), ~112 ms before the admitted throw here
  (20275.5 → 20387 ≈ `THROW_RELEASE_S`), plus ~28 ms host→view + 1 rAF to the
  first cleared sample (20387 → 20414.8).

So frames in `(release, commit]` MUST still read armed/tactical-held. The old
check criminalised the throw animation.

## Exact change (lane-owned files only)

1. `scripts/_verify-semtex-live.mjs` — copied root's first-repair delimiter fix:
   added the missing closing `*/` after the Usage line (line 39). Before, the
   open JSDoc commented out the imports/CLI. `node --check` passes on the
   verifier and the analysis lib.
2. `scripts/lib/semtex-analysis.mjs`
   - `OWN_THROW` now captures the authoritative timestamp:
     `/^(\d+) grenade-thrown you semtex id=(\d+)/`.
   - `inventory-consumed` boundary moved from `releasePerfNow` to the own
     `grenade-thrown` line's timestamp (`admissionAt`), requiring
     `admissionAt >= releasePerfNow` and `admissionId === flight id`.
     `before` = `t <= admissionAt` (must show charge + armed);
     `after` = `t > admissionAt` (must reach `tactical 0` + `armed null`,
     bounded: both clears at or before the detonation timestamp when one
     exists). Transient armed between commit and first clear is delivery;
     **armed after the first clear, tactical ≥ 1 after the first spend, or
     never clearing before the blast all fail independently**; respawn still
     poisons. Header comment updated with the authority chain.
   - All other 17 checks, fuse/ID/position/frame gates untouched.
3. `scripts/_verify-semtex-live-analysis.mjs` — 4 new CPU tests (27/27 pass):
   - replay of the 2224 beat shape (intent→commit beat + one delivery frame
     admitted, stays cleared → inventory HOLDS);
   - falsifier: armed never clearing after admission → REFUTED;
   - falsifier: armed resurrecting after first clear → REFUTED;
   - falsifier: tactical never reaching 0 after admission → REFUTED.

## Verification (CPU only, no live run from this lane)

- `node scripts/_verify-semtex-live-analysis.mjs` → **27/27 pass** (< 1 s).
- Actual receipt replayed through the lane's patched `analyseSemtexRun`
  (frames/lineTail/timestamps from root
  `captures/verify-semtex-live-semtex-2224.json`): **18/18 HOLDS**, detail
  `commit@20387 (>= release 20275.5) id=1 matches flight, pouch had a charge
  -> 0@20414.8, armed seen=true cleared=null@20414.8 beatFrames=1`.
- `node --check` on both touched script files passes.

## Approach-change condition

If a future live receipt still fails `inventory-consumed` after this repair, do
NOT widen the beat or add ms tolerance: the failure is then either a genuinely
stuck hand (no clear before blast), a resurrection (armed/tactical returning
after clear), a commit/flight id mismatch, or a real authority defect — report
the exact detail string and the receipt, and change approach (suspect the
host/view path, not the boundary).
