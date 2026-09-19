# Semtex Live Proof — Repair Handoff (review defects fixed, no live proof claimed)

**Date:** 2026-09-19
**Lane:** `nuketown-glm-respawn-20260919` (source-only repair; no browser/GPU/build run here)
**Prior doc:** `docs/semtex-live-proof-handoff.md` (GLM+AGY preserved proof — live proof NOT accepted)
**Owned files only:** `scripts/_verify-semtex-live.mjs`, `scripts/lib/semtex-analysis.mjs`,
`scripts/_verify-semtex-live-analysis.mjs`, this handoff. Old 3-grenade verifier untouched.
Damage authority / game code untouched.

## Review defects fixed

1. **Fake menu flow** (`_verify-semtex-live.mjs`): the `.aa-tac` lookup ran on the main
   menu before Play solo (always absent), then seeded a wrong-schema `localStorage`
   loadout and clicked the `#start` container. Removed the seeding entirely. Real flow
   now: `getByRole Play solo` → wait for `.aa-tac` in the visible solo loadout panel →
   `getByRole /semtex/` press → require selected DOM (`aria-pressed`/`aa-selected`,
   else refuse) → `getByRole /deploy/` press → wait `phase === 'active'`.
   (Panel lives in the solo setup view on the root build: `loadout-panel.ts` mounted by
   `solo-setup.ts`. This lane's own checkout has no `.aa-tac`; against it the runner
   honestly refuses instead of proving anything.)
2. **Weak loadout gate** (`semtex-analysis.mjs`): `loadout-bound-semtex` passed on any
   HUD string. Now requires all three: `panelSemtexPressed === true`,
   `tacticalIdReadback === 'semtex'`, HUD matches `/semtex/i`.
3. **Dead resurrection check** (`semtex-analysis.mjs`): read `f.live`, which the
   projection never carries (patch filters to live flights only). Now detects
   disappearance of the contact id from per-frame presence sets followed by its
   reappearance. Clean retirement (absent after detonation, never back) still passes.
4. **Loose screenshot trigger** (`_verify-semtex-live.mjs`): counted all owners' semtex
   and historical resting frames. Now fires only for a currently-live own id
   (`ownerId === selfId`) with ≥ 3 distinct resting rAF frames, plus a fresh live
   re-read confirming the casing at capture. New `screenshot-anchored` analysis check
   (18 checks total, was 16) ties claimed screenshots to that stick proof.
5. **Missing backend/SHA proof:** runner requires `--sha <root-expected-sha>` (refuses
   without it) and requires actual WebGPU (`__NT_BACKEND.actual` + `__NTPOST.backend`
   both `webgpu`, post enabled) before throwing; new `actual-webgpu` analysis check
   backstops it for offline receipt replay.
6. **Receipt:** now preserves raw bounded rAF frames, full `lineTail`, both bundle SHAs
   and every actual input; a throw writes a `verdict: 'ERROR'` failure receipt with
   whatever was gathered. No synthetic screenshot substitution. 150 s watchdog and
   `finally` stock-browser cleanup kept; ≥ 100 real frames, exact
   ID + stick + fuse + detonation + own-inventory / no-respawn gates unchanged.

## Verification (source-only, this lane)

- `node scripts/_verify-semtex-live-analysis.mjs` → **23/23 PASS** (< 1 s, pure CPU):
  golden 18/18 + 18 legacy falsifiers + 5 targeted new ones (unpressed panel, wrong-HUD
  tactical, gap+reappearance resurrection with stick proof intact, unanchored
  screenshots, WebGL fallback).
- `node --check` clean on all three scripts. No browser, no build, no GPU run here.

## Root run (not executed — for root alone)

```bash
node scripts/_verify-semtex-live.mjs --url http://127.0.0.1:4196/ --tag live --sha <root-expected-sha>
node scripts/_verify-semtex-live-analysis.mjs
```

Receipt: `captures/verify-semtex-live-<tag>.json` (+ stuck/after PNGs). Then look at the
frames: an unopened capture is not evidence. **No live proof is claimed by this repair.**
