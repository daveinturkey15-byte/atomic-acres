# Roster heroes runtime handoff (source-only, prop lane)

Lane: `nuketown-prop-20260919`. Source-only. No Blender, GPU, browser, or server ran here.
Root reruns guarded build + WebGPU pixels. No runtime acceptance is claimed.

## Root baseline

- Read-only root `C:/Users/david/Desktop/stuff/worktrees/nuketown-recovery-20260919` at
  `fd84d14` for weapons (`HEAD` `87c9d48` only adds regenerated GLBs + repair docs;
  `fd84d14..HEAD --stat` shows zero weapon-source drift).
- Regenerated heroes (root, strict-passed 22:59:01): `mp5.glb` 1194 tri / 13 draw /
  2 mat / 2 PNG, `m14-ebr.glb` 1862 / 14 / 3 / 2, `lmg.glb` 948 / 16 / 3 / 2.
  4 real anchors, -Z muzzle. Lane has no built assets; GLBs were used only as
  documented measurements, never copied.
- Frozen (untouched this slice): `scripts/blender/build_roster_heroes.py`,
  `scripts/assets/verify-roster-heroes.mjs`, `work/roster-heroes/manifest.json`.

## Deliverables (this lane)

1. `work/roster-heroes-runtime/roster-heroes-loader.ts` (580 lines, LF) — final loader.
   Byte-identical to `work/roster-heroes-runtime/baseline/src/weapons/roster-heroes-loader.ts`
   (`cmp` clean) and to `w/src/weapons/roster-heroes-loader.ts` (0-line diff).
   Root placement: `src/weapons/roster-heroes-loader.ts` (imports are written for
   that path: `../core/materials`, `./catalog-carbine-loader`, `./first-person-hands`,
   `./families`, `./viewmodel`, `./types`).
2. `work/roster-heroes-runtime/roster-heroes-integration.patch` (141 lines, 16 hunks) —
   the ONLY patch root needs. `git apply --check` clean against `fd84d14`
   `src/weapons/controller.ts`; full apply verified (14 hero refs, 18 carbine refs,
   `isPlayableWeapon` filter intact). Controller-only: zero `roster.ts` / `families.ts` /
   `catalog.ts` lines. Supersedes the 2937-line CRLF whole-file partial
   `controller-heroes-integration.patch` (preserved, not deleted).
3. CPU tests: `work/roster-heroes-runtime/runtime-check.ts` (323 lines) +
   `check-runtime.mjs` (esbuild bundle + node, no browser/GPU). Import seam is
   `./baseline/src/weapons/*` (lane-local); root retarget is 3 lines
   (`./baseline/src/` → `../../src/`) after placing the loader, or run as-is in
   this lane against the byte-identical copy.
4. Prior GLM partials preserved untouched: `w/`, `v/`, `apply-test/`, large patch,
   `runtime-check.bundle.mjs`. Lane `src/weapons/controller.ts` (1098 lines,
   pre-roster20, no `families.ts`/`roster.ts`) was NOT copied anywhere into root.

## Integration steps for root

```bash
cp work/roster-heroes-runtime/roster-heroes-loader.ts src/weapons/roster-heroes-loader.ts
git apply --check work/roster-heroes-runtime/roster-heroes-integration.patch
git apply work/roster-heroes-runtime/roster-heroes-integration.patch
node work/roster-heroes-runtime/check-runtime.mjs   # lane-local imports; see retarget note
npm run check && npm run build
# then looked-at pixels: ?heroes=canary vs baseline at the same fidelity stations
```

## Contract (what the code does)

- Opt-in `?heroes=canary` only; default roster byte-for-byte unchanged without it.
- Exactly 3 matching IDs (`mp5`, `m14-ebr`, `lmg`), lazy per-weapon adoption, bounded
  master cache max 3 (closed URL table; explicit throw if a future URL exceeds it).
- Sockets are the ACTUAL loaded anchors: `muzzle`/`gripSocket`/`supportSocket`/`magSocket`
  are `findNamedSocket` results; missing socket or missing magazine node
  (`mp5_magazine` / `ebr_magazine` / `lmg_ammo_box`) rejects the asset → procedural
  fallback, never fabricated. Eject is the one synthesized presentation frame.
- Reload pivot: magazine node re-parented `anchor_mag → hero_mag_pivot → mag` via
  `attach` (baked world pose kept); swing rides the same hands reload phase
  (`updateReload`/`resetReload` both drive pivot + hands).
- Roster preserved: adoption looks up `WEAPONS.filter(isPlayableWeapon)` by hero id;
  16 playable + 4 gated untouched (patch has zero roster/family/catalog lines).
  Longhorn carbine canary block preserved verbatim (18 refs survive apply).
- Pending/disposal reviewed, kept from GLM: pending-map removal is promise-identity
  guarded; generation epoch discards late arrivals (resources disposed, caller gets
  fallback, never a resurrected master); `clearRosterHeroCache` bumps epoch on both
  paths and orphans live entries; per-rig `dispose()` is idempotent, releases exactly
  its own `refCount`, uses `disposeOwnedGeometries` only — shared `MaterialLibrary`
  singletons are never disposed. Controller disposes non-GLB fallbacks immediately,
  dedupes late duplicates, drops post-`disposed` arrivals, and owns hero rigs
  separately from the family-shared `this.rigs` map (one dispose each).

## CPU verification (this slice)

- `node work/roster-heroes-runtime/check-runtime.mjs`: **58 passed, 0 failed**.
  Covers: canary query gate, unknown-id reject, happy-path socket identity + mag
  world-pose preservation + swing/reset, disposal idempotence + master disposal +
  shared-material survival, missing-socket → fallback, missing-mag → fallback,
  pending-failure → fallback/throw, clear-during-pending → fallback + late disposal,
  in-flight dedupe + refCount sharing + bound of 3.
- `git apply --check` + full apply against `fd84d14` controller: clean.
- `cmp` loader top-level vs baseline copy: identical.
- Honest non-claims: no WebGPU frame, no pixels looked at, no soak. Root owns those.
