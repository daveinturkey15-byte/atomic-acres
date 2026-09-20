# Operator runtime packaging — handoff

Source-only. Preserves passing implementation, adds minimal main hook, ships root-clean patch.

## Exact files

- `src/characters/operator-authored.ts` (NEW, 475 lines) — additive `?operator=authored` dress, shared GLB cache, per-actor bones/Skeleton/pose, `preloadAuthoredOperator` bounded 8 s (`OPERATOR_LOAD_TIMEOUT_MS`), `clear/dispose/status`, `dressAuthored`/`spawnAuthoredOperator`, `__NTOPERATOR` QA only. Comment fixed: strict GLB `13596` tris (was stale `13224`); SHA `ae0521210cc469d3c81fa220898223431e34ff347e6848f2e7ad25112843c8ea` pinned, recipe/validator untouched.
- `src/characters/system.ts` (MOD, +19/-2) — `spawn()` tries `dressAuthored` when enabled, falls back to `dressProcedural`; alternates team patches for unpinned authored spawns. Bots/remote/demo all flow through `spawn`; no demo special path.
- `src/main.ts` (MOD, +10, root-based) — import + awaited opt-in preload BEFORE `createCharacterSystem`/spawns; miss resolves null, procedural dress holds:
  `if (isAuthoredOperatorEnabled()) await preloadAuthoredOperator().catch(warn → null)`.
- `scripts/assets/verify-operator-lifetime.mjs` (NEW, 336 lines) — CPU-only real-module lifetime proof, no browser/GPU.
- `work/operator-runtime.integration.patch` — the ship artifact. `git apply --check` clean in root `4a4659d`; `--stat`: 4 files, 838+/2- (operator 475, system 19, main 10, verifier 336). No recipe/validator/GLB changes, no old-partial removals, no main wholesale overwrite.

Supersedes `work/operator-runtime.integration.failed-muse-0016.patch` (preserved verbatim + README); do not apply it.

## Verified (CPU only)

- `node scripts/assets/verify-operator-lifetime.mjs` → `OPERATOR_LIFETIME_VERIFY PASS` (39/39: gate-off procedural, spawn hook/teams, pose separation, exact dispose-once, invalid-leak fix, cancel/timeout orphan sweep, per-primitive materials, rebind).
- `npm run check` → `tsc --noEmit` clean + `[check-render-sites] OK`.
- Root: `git apply --check work/operator-runtime.integration.patch` → exit 0; `--stat` exactly the 4 files above.

## Root next

Copy exact `ae052121…` GLB to `public/assets/operators/operator-sand.glb` after patch review, then build + look at real frames.

## OPEN (unverified, no browser/GPU per task)

- OPEN: authored stance/contact/motion in real game frames (`?operator=authored`).
- OPEN: draw-call/triangle delta vs procedural at fidelity stations; program count stays 18.
- OPEN: 8 s timeout behaviour against hanging server in browser; autoplay/missing-GLB fallback frame.
- OPEN: `public/assets/operators/operator-sand.glb` byte identity (`ae052121…`) once copied.
