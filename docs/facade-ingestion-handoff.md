# Facade canary ingestion — opt-in `?facade=canary` patch

Lane: facade ingestion, 2026-09-19/20, bounded 15 min, SOURCE-ONLY.
Exclusive worktree: `nuketown-environment-20260919`. Root (READONLY, applied by root):
`nuketown-recovery-20260919` @ `9a07085`. No GPU/browser/Blender/server/build run was
made here; every number below is read from source, not measured. Root runs the gates
and LOOKS at the pixels.

## Status: patch ready, CPU proof unchanged, visual acceptance OPEN

## What was recovered (exact backup, never silently overwritten)

Root untracked canary, read verbatim (sha256):

- `src/build/facade-detail-canary.ts` — `00bd8cf1…2f4787` (287 ln, 8 InstancedMesh batches)
- `scripts/assets/verify-facade-detail-canary.mjs` — `70504b1a…0bd2f8968` (166 ln)
- `docs/facade-detail-canary.md` — `c8c71d2a…5264d05335` (proof: draws 8 / tris 2208 / PASS)

The patch carries the builder and the verifier **byte-identical** to those hashes.
`docs/facade-detail-canary.md` already lives in root untracked and is NOT duplicated
in the patch (re-adding it would collide on apply).

## Geometry match: canary fits current houses (verified, not guessed)

`core/layout.ts`, `core/kit.ts`, `core/stations.ts` are **byte-identical** between
recovery root and this worktree (`diff` exit 0); `orange-house.ts` / `white-house.ts`
are likewise identical. So the author's CPU PASS on the root tree transfers.

Door/window boundaries recomputed from `core/layout.ts` against the verifier's
hardcoded aprons — all exact:

| point | layout math | verifier APRONS | match |
|---|---|---|---|
| ORANGE front door | 6.4 × 0.24 = 1.536, z −15.4 | x 1.536, z −15.4 | ✓ |
| ORANGE back door | −6.4 × 0.32 = −2.048, z −26.6 | x −2.048, z −26.6 | ✓ |
| ORANGE bays | −(6.4+3.1) ∓ 1.4333 = −10.933 / −8.067 | same | ✓ |
| WHITE front door | −6.4 × 0.16 = −1.024, z 15.4 | same | ✓ |
| WHITE back door | 6.4 × 0.26 = 1.664, z 26.6 | same | ✓ |
| WHITE bays | (6.4+3.1) ∓ 1.4333 = 8.067 / 10.933 | same | ✓ |
| garage top / vent apron | GARAGE_H 3.65; VENT_Y 2.95 ∈ (2.30, 3.65) | apron logic | ✓ |
| plinth top 0.50 | below every sill (verifier: low tops ≤ 0.55) | sill gate | ✓ |

Material keys `roofWhite / capsuleWhite / steel / windowDark / concrete` all exist in
`core/materials.ts`; canary imports are only `three`, `../core/layout`, `../core/kit`
types — module contract holds. Budget stands: **8 draws / 2208 tris** (doc proof),
inside the verifier's own ≤12 / ≤12000 gates.

## CPU-test determination: NO bug, NO change, threshold NOT lowered

The verifier's first run already caught three real defects (fixed at source, recorded
in `docs/facade-detail-canary.md` §Proof result). Against current geometry every
assertion still binds: envelopes, aprons, sills, determinism, hygiene. There is
nothing to fix, so the verifier ships byte-exact. Lowering a threshold to get green
was never on the table and did not happen.

## Patch contents (`work/facade-canary.integration.patch`, `git diff` format)

1. `src/build/facade-detail-canary.ts` — NEW, byte-exact (backup hash above).
2. `scripts/assets/verify-facade-detail-canary.mjs` — NEW, byte-exact.
3. `scripts/assets/capture-facade.mjs` — NEW. Browser QA source script (root runs):
   stock-Browser + measureFrame at fixed `yardWhite / yardOrange / streetElevation`,
   baseline vs `?facade=canary`, exact dist SHA-256 before/after, rendered frames +
   luma gate, draws/tris with absolute budgets (1200 / 900k) and exact CPU delta
   (+8 / +2208), programs and textures unchanged, `colliderSnapshot()` identical,
   `moduleStats['facade-detail-canary']` absent→present (adoption status), zero
   console/page errors. Modelled on `environment-comparison-harness.mjs`.
4. `src/main.ts` — +16 lines: import, `isFacadeDetailCanaryOptIn()` predicate
   (`?facade=canary` only, `__NT_OVERRIDE_FACADE_DETAIL__` for QA; same shape as
   `isMountainTerrainOptIn()`), conditional `BUILDERS.splice(3, 0, …)` after
   `white-house`. Default registry untouched: no flag → zero extra draws,
   zero colliders, zero light changes. No `environment-flags.ts` change, so the
   existing 4-mode harness and `verify-environment-integration.mjs` are unaffected.
5. `docs/facade-ingestion-handoff.md` — this file.

Apply: `git apply --check work/facade-canary.integration.patch && git apply
work/facade-canary.integration.patch` from the root worktree at `9a07085`.
Revert: `git apply -R` the same patch, or drop `?facade=canary` (baseline is default).

## Root run order (root owns all execution)

1. `node scripts/assets/verify-facade-detail-canary.mjs` — expect PASS + tsc clean.
2. Build candidate, then `node scripts/assets/capture-facade.mjs [--url … --dist …]`.
3. LOOK: each `captures/facade/facade-canary-{yardWhite,yardOrange,streetElevation}.png`
   against `docs/reference/refinement-targets/yard-white.png` and
   `captures/connected-terrain-relief-0004/baseline-*.png`. A capture nobody opened
   is not evidence. `playcap` + full `capture` stay the real bar per the canary doc.
