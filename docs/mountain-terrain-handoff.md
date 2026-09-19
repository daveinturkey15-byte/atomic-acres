# Mountain-Terrain Handoff — Connected Panorama Outer Loop (Source-Only)

**Date**: 2026-09-19
**Lane**: `nuketown-environment-20260919` (exclusive; source-only — zero Blender / GPU / browser / server / delegation executed here)
**Target root**: `nuketown-recovery-20260919` (read-only reference; root builds + looks at frames)
**Status**: New recipe + validator + manifest ready for guarded root build and same-camera visual review. No visual claim made in lane.

---

## 1. Grounded failure (looked-at frames, not counts)

Root captures (read-only): `captures/authored-mountains-2309/authored-yardWhite.png` and `authored-turningHead.png`, compiled model SHA `ea97e9477b570ea014555cc04c3545dcb4d865b60bc4986bfdedc7a28468c0ea`.

- Authored yardWhite: a few isolated blank trapezoidal towers (cooling-tower read), horizon empty between them.
- Baseline yardWhite (same camera): continuous overlapping mountain front across the full frame width.
- Frozen direction `docs/reference/refinement-targets/yard-white.png`: unbroken jagged ridge skyline, overlapping peaks, no gaps.
- 28 browser / 48 CPU checks green did **not** meet art. Two prior harmonic-canary rounds failed as smooth parallel ribbons; per directive, no third harmony tweak.

Root cause in the retained recipe: 17 box-scaled massif parts. Per-massif angular widths are only 17.6° / 15.6° / 13.5° at R 310 / 460 / 660 m, leaving **42–59° of empty horizon per sector**. Box scaling stretches a few solids vertically while the gaps stay sky. Fixing keepout/height asserts twice could not fix this — it is the representation, so this loop changes it.

## 2. New representation (what changed and why it cannot make towers)

`scripts/blender/build_mountain_terrain.py` (NEW — `build_authored_mountains.py` untouched):

- **One connected annular grid mesh per ring** (azimuth × radial), built vertex-by-vertex with `bmesh` — no `create_cube`, no scale-to-form, no modifiers, no booleans.
  - near: R 295 m, 90 m deep, 192×10 → 3840 tris
  - mid: R 455 m, 130 m deep, 176×9 → 3168 tris
  - far: R 650 m, 170 m deep, 160×8 → 2560 tris
  - total **9568 tris / 3 draws** (budget ≤ 30000 / ≤ 3).
- **Broad overlapping Gaussian peak profiles** (7 / 7 / 6 peaks, widths 0.32–0.44 rad vs ~0.9 rad spacing). Saddles dip to 19–29% of peak height but never to sky — continuity is structural, not tuned.
- **Connected talus base**: radial shape rises from a sunk toe (BASE_Y −12 m) through a crest at v = 0.55, then falls 35% outward; azimuthal meander ±12 m is positional only and the inner anchor (295 m) keeps every vertex ≥ 280 m.
- **Eroded relief**: `sin(gfreq·θ+phase)^1.5` gully chutes on the mid-slope window, 6.5 m strata terrace benches (0.32 / 0.28 / 0.22), 2.2 + 1.1 m ridge sin, ±1.1 m hash grain. Mesa flattening (0.78 crest, 0.15 residual) on near {2,4} + mid {2,4} only; far horns pointed.
- **Stratified rock PBR**: 1 material `MountainTerrainRock`, 3 pixel-filled 1024 PNGs (albedo strata + talus/cap regions + mottle; roughness 0.86–1.0 banded; tangent-space normal with ledge/streak perturbation). True per-vertex UVs (u = azimuth ×8, v = elevation-mapped) so texture bands follow slopes. Smooth shading — the failed loop's `use_smooth = False` boxes are gone. No licensed PBR download: pixel-filled strata instead, zero external inputs.
- Same guarded export contract: threads = 2, y-up roll `_ROLL @ matrix_world`, `transform_apply`, all-vertex (not bound-box) keepout/base/peak asserts plus tier-ladder asserts (mid > near, far > mid).

## 3. Silhouette math at the exact source cameras (no render in lane)

Pure-Python projection of the crest profiles (lane `eval`, not a render):

| View | near crest | mid crest | far crest | Ladder |
|---|---|---|---|---|
| Town centre max elevation | 11.36° | 15.52° | 16.77° | strictly rising |
| Town centre mean elevation | 6.08° | 9.55° | 9.92° | strictly rising |
| yardWhite centre-ray elevation | 2.81° (Z 27 m) | 11.33° (Z 120 m) | 13.47° (Z 194 m) | tiered, town roofs (~9° max) cleared by mid/far |
| Minimum crest elevation (any azimuth) | 0.30° | 3.51° | 3.66° | always above horizon — no empty gaps |

- yardWhite frustum (pos [−10, 8.5, 38], yaw −30.5°, vfov 62° → hfov 93.8°): azimuths 253.6°–347.4° all carry crest ≥ near-minimum; old boxes left 42–59° gaps inside this same frustum.
- turningHead frustum (pos [−14, 2.6, 1], yaw −90°, vfov 72° → hfov 104.5°): azimuths −52°–+52° likewise continuous.
- Old-vs-new coverage: old 13–18° solids vs new 360° connected surface with saddle ratio 0.19–0.29 (deep saddles, never sky).

Bounds: min radius 287 m (≥ 280), min base ≈ −10 m (< −6), max peaks 70 / 146 / 223 m (> 60). These are recipe-side computations; the validator rechecks them on real GLB chunk offsets after root builds.

## 4. Shipped files (all additive; zero overwrites)

| File | Purpose |
|---|---|
| `scripts/blender/build_mountain_terrain.py` | Deterministic connected-terrain recipe (SEED 20260919), out → `public/assets/mountain-terrain/` |
| `scripts/assets/verify-mountain-terrain.mjs` | Strict validator: 15 recipe checks + full GLB chunk/bounds/PNG checks + lane-boundary checks |
| `work/mountain-terrain/manifest.json` | Frozen provenance, budgets, rings, peaks, silhouette numbers |
| `docs/mountain-terrain-handoff.md` | This file |

Untouched per directive: `build_authored_mountains.py`, old validators, integration patch, `assets/main/skyline`.

## 5. Exact root steps (in order)

```bash
# 1. Copy lane outputs into root (new files only)
cp ../nuketown-environment-20260919/scripts/blender/build_mountain_terrain.py scripts/blender/
cp ../nuketown-environment-20260919/scripts/assets/verify-mountain-terrain.mjs scripts/assets/
cp ../nuketown-environment-20260919/work/mountain-terrain/manifest.json work/mountain-terrain-manifest.json

# 2. Guarded candidate generation (CPU only, 2 threads, 2 GiB cap)
call "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --threads 2 --python scripts/blender/build_mountain_terrain.py

# 3. Strict validation (GLB must exist; chunk offsets, PNG IHDR, all-vertex bounds)
node scripts/assets/verify-mountain-terrain.mjs --strict

# 4. Same-camera visual review through the REAL game loop (owned by root):
#    A. yardWhite + turningHead + aerial vs retained baseline frames
#    B. Bar: docs/reference/refinement-targets/yard-white.png (distribution/angular silhouette)
#    C. Judge: continuous overlapping massifs, connected talus, gully/strata read — NOT counts
#    No integration patch exists in this loop; root decides the route only after looking.
```

## 6. Honest status and caveats

- **No pixels looked at in lane** — recipe unexecuted here by directive. Mathematical silhouettes above argue continuity and tiering, but artistic acceptance belongs to root's same-camera frames. Do not call this done-visually until root looks.
- Validator green without the GLB proves recipe structure only; `--strict` green after root's build proves mechanics + bounds, still not art.
- No quality-threshold change: ≤ 3 draws, ≤ 30000 tris, ≤ 3×1024 PNGs, ≤ 2 materials, keepout ≥ 280 m, base < −6 m, peaks > 60 m — all asserted in-recipe and rechecked in-validator.
- Rollback: delete the three new files; nothing existing was modified.
