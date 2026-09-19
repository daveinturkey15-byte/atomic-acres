# Semtex Live Proof Handoff — Final Proof & Projection Suite

**Date:** 2026-09-19  
**Harness / Author:** Antigravity (finishing timed-out GLM respawn lane `recovery/glm-respawn-20260919`)  
**Scope:** Root `docs/orchestration/overnight-20260919/glm-semtex-live-proof.md` & `docs/orchestration/overnight-20260919/agy-semtex-live-finish.md`

---

## 1. Summary of Completed Deliverables

1. **Preserved Original 3-Grenade Verifier:**
   - `scripts/_verify-ordnance-browser.mjs` is completely restored to its original 3-grenade baseline (frag, flash, smoke, knife, swap).
   - Clean syntax, no undefined variables (`fails` intact in baseline), preserves original verification contract.

2. **Pure Acceptance Analysis Module:**
   - `scripts/lib/semtex-analysis.mjs` is preserved and completed.
   - 16 strict checks covering actual flight ID, first-contact edge, >= 3 distinct stationary frames within 0.02 m tolerance, fuse timing from stick (1100 ± 200 ms), inventory consumption (tactical 1 → 0, armed semtex → null), single throw / no resurrection, blast at stuck coordinates (≤ 0.5 m), blast smoke announcement, bundle identity, clean console, real frame loop, and dual rAF screenshots.

3. **CPU Invariant & Falsifier Suite:**
   - `scripts/_verify-semtex-live-analysis.mjs` implemented and verified.
   - Pure CPU, runs in < 1 second.
   - **18/18 tests pass** (golden run + 17 independent failure-mode falsifiers).

4. **Dedicated Semtex Live Browser Proof:**
   - `scripts/_verify-semtex-live.mjs` implemented.
   - Uses root owned stock browser via `scripts/lib/stock-browser.mjs` with guaranteed finally-block cleanup (`await close()`, `killTree`, profile removal).
   - Strict 150 s budget enforcement (rejects `--seconds > 135`, 150 s watchdog).
   - Interacts with actual pre-match loadout menu (`.aa-tac` Semtex button), clicks Deploy (`#start`), waits for countdown completion (`phase === 'active'`), verifies HUD (`◆ SEMTEX 1`), installs high-frequency in-page rAF sampler, throws semtex, observes stick, captures stuck screenshot, observes detonation, captures blast screenshot, validates bundle SHA consistency, and feeds output to `analyseSemtexRun`.

5. **Minimal Read-Only QA Flight Projection Patch:**
   - `patches/0001-qa-flight-projection.patch`.
   - Modifies only `src/weapons/ordnance-scene.ts:qa()` to expose read-only bounded copies of active `flights` (`id`, `grenadeId`, `ownerId`, `sticky`, `x`, `y`, `z`, `resting`, `bornAt`, `detonatesAt`) and `selfId`.
   - Zero state mutation, zero gameplay changes. Tested and applies cleanly against root recovery `29efde5`.

6. **All Invariants Hold:**
   - `node scripts/_verify-ordnance.mjs` → **83/83 checks hold**.
   - `npm run check` → TypeScript and render-site checks clean.

---

## 2. Exact Root Commands & Paths

Root recovery worktree: `C:/Users/david/Desktop/stuff/worktrees/nuketown-recovery-20260919`  
Candidate worktree: `C:/Users/david/Desktop/stuff/worktrees/nuketown-glm-respawn-20260919`

### Step A: Apply Read-Only QA Flight Projection Patch to Root
In `nuketown-recovery-20260919`:
```bash
git apply C:/Users/david/Desktop/stuff/worktrees/nuketown-glm-respawn-20260919/patches/0001-qa-flight-projection.patch
npm run check
```

### Step B: Run CPU Verification Suite
```bash
node scripts/_verify-semtex-live-analysis.mjs
node scripts/_verify-ordnance.mjs
```
*Expected: 18/18 CPU analysis tests PASS, 83/83 ordnance invariants PASS.*

### Step C: Execute Live Browser Semtex Proof Against Candidate Build
Against root recovery's preview or built candidate (e.g. `dist-ui-2132` on port 4196):
```bash
node scripts/_verify-semtex-live.mjs --port 4196 --tag live-semtex
```
Or with an explicit URL:
```bash
node scripts/_verify-semtex-live.mjs --url http://127.0.0.1:4196/ --tag live-semtex
```

### Step D: Output Artifacts
The runner generates:
- Evidence JSON: `captures/verify-semtex-live-live-semtex.json`
- Stuck casing screenshot: `captures/verify-semtex-live-stuck-live-semtex.png`
- Blast smoke effect screenshot: `captures/verify-semtex-live-after-live-semtex.png`

---

## 3. Inventory of Preserved Partials & Files

| Path | Purpose |
|------|---------|
| `patches/0001-qa-flight-projection.patch` | Read-only QA projection patch against `src/weapons/ordnance-scene.ts` |
| `scripts/lib/semtex-analysis.mjs` | Pure 16-check analysis module (evaluates sampled frames & logs) |
| `scripts/_verify-semtex-live-analysis.mjs` | Pure CPU test suite & falsifier (18/18 PASS) |
| `scripts/_verify-semtex-live.mjs` | Dedicated 150 s stock browser live proof runner |
| `scripts/_verify-ordnance-browser.mjs` | Preserved original 3-grenade verifier (unmodified baseline) |
| `scripts/_verify-ordnance.mjs` | Headless ordnance test runner (83/83 checks hold) |
| `scripts/_verify-ordnance.scenario.ts` | 83 ordnance invariant test scenarios |
| `work/` | Preserved diffs, baselines, and scratch comparisons |
| `docs/semtex-contact-handoff.md` | Preserved previous contact repair handoff document |
| `docs/semtex-live-proof-handoff.md` | This document |
