# Mountain-Terrain Runtime Handoff — `?mountains=terrain` Exposure Patch

**Date**: 2026-09-19
**Lane**: `nuketown-environment-20260919` (exclusive; source-only — zero Blender / GPU / browser / server / delegation executed here)
**Target root**: `nuketown-recovery-20260919` (read-only reference, HEAD `580a1aa`; root builds + looks at frames)
**Status**: Runtime patch ready for guarded root apply, build, and same-camera visual review. No visual claim made in lane.
**Frozen**: `scripts/blender/build_mountain_terrain.py`, `scripts/assets/verify-mountain-terrain.mjs`, `work/mountain-terrain/manifest.json` — untouched (validator §3 green).

---

## 1. What this delivers

Small additive patch exposing the already-reviewed connected-terrain recipe at its own flag and URL, mirroring the retained authored-mountains loader exactly — no new loader framework:

| File in `work/mountain-terrain-runtime.patch` | Change |
|---|---|
| `src/build/mountain-terrain.ts` (NEW, 91 lines) | `isMountainTerrainOptIn()` (`?mountains=terrain` / `mountain-terrain`, plus `__NT_OVERRIDE_MOUNTAIN_TERRAIN__`), `createMountainTerrain()` (GLB clone or sync canary fallback), `buildMountainTerrain` builder. Same clone-ownership contract as `createAuthoredMountains`: detach clone only, master stays in cache, shared `ctx.mat` singletons never touched/disposed, zero colliders. |
| `src/core/assets.ts` | `AssetName` gains `'mountain-terrain'`; `ASSET_URLS` gains `assets/mountain-terrain/mountain-terrain.glb` — the recipe's actual `OUT_GLB`. Existing entries untouched. |
| `src/build/skyline.ts` | Terrain branch first, then the retained `?mountains=authored` branch, then canary, then baseline. Old authored and default/baseline paths byte-identical otherwise. |
| `src/main.ts` | Opt-in-only `preloadAssets(['mountain-terrain'])` (same fetch guard as authored: other flags fetch nothing), `mountain_terrain` pagehide detach, `releaseAsset('mountain-terrain')` beside the existing authored retirement. Coach untouched. |

Patch stat (from root HEAD): **4 files, +124 / −2**. No default enabling: without `?mountains=terrain` the frame is bit-identical to today. No replacement: `?mountains=authored`, `?mountains=canary`, and baseline all keep their exact routes. Old artifacts never overwritten (recipe asserts `mountain-terrain/` output only).

## 2. Evidence (lane-side, source-only)

- `npm run check` (tsc + render-site allow-list): **clean** with the new module + registry entry in lane.
- `node scripts/assets/verify-mountain-terrain.mjs` (non-strict): **18/18 PASS**, GLB section SKIP (absent — root builds it). Frozen acceptance unchanged.
- `git apply --check` of this patch with cwd at root HEAD `580a1aa`: **clean** (read-only check, root unmodified).
- New module is byte-identical between lane `src/build/mountain-terrain.ts` and the patch's new-file hunk (`cmp` clean).
- Budgets carried over from the frozen recipe/validator: **3 draws, 9568 tris (≤ 30000)**, 1 material (≤ 2), 3×1024 PNGs, keepout ≥ 280 m, base < −6 m, peaks > 60 m.

## 3. Exact root steps (in order)

```bash
# 1. Lane outputs already in root? If not, copy the three frozen files (new files only):
cp ../nuketown-environment-20260919/scripts/blender/build_mountain_terrain.py scripts/blender/
cp ../nuketown-environment-20260919/scripts/assets/verify-mountain-terrain.mjs scripts/assets/
cp ../nuketown-environment-20260919/work/mountain-terrain/manifest.json work/mountain-terrain-manifest.json

# 2. Apply the runtime exposure patch (applies clean at 580a1aa):
git apply --check ../nuketown-environment-20260919/work/mountain-terrain-runtime.patch
git apply ../nuketown-environment-20260919/work/mountain-terrain-runtime.patch

# 3. Guarded candidate generation (CPU only, 2 threads, 2 GiB cap):
call "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --threads 2 --python scripts/blender/build_mountain_terrain.py

# 4. Strict validation (GLB must exist; chunk offsets, PNG IHDR, all-vertex bounds):
node scripts/assets/verify-mountain-terrain.mjs --strict

# 5. Same-camera visual review through the REAL game loop (owned by root):
#    A. ?mountains=terrain at yardWhite + turningHead + aerial vs retained baseline frames
#    B. Bar: docs/reference/refinement-targets/yard-white.png (distribution/angular silhouette)
#    C. Judge: continuous overlapping massifs, connected talus, gully/strata read — NOT counts
```

## 4. Honest status and caveats

- **No pixels looked at in lane** — recipe unexecuted here by directive. The silhouette math in `docs/mountain-terrain-handoff.md` argues continuity, but artistic acceptance belongs to root's same-camera frames. Do not call this done-visually until root looks.
- `?mountains=authored` stays exactly as root left it (visually rejected boxes retained for comparison, not removed).
- Rollback: `git checkout -- src/` + `git clean -f src/build/mountain-terrain.ts`, then delete the three copied frozen files; nothing existing was modified by the recipe/validator loop.
- Gotcha recorded while building this patch: never use the `edit` tool on unified-diff files — its `+` body-row prefix collides with diff `+`/`-` lines and splices hunks. Author diffs with `write`, or fix them with `node`/`git diff` plumbing. A second gotcha: root sources are CRLF (newer one-off modules like `authored-mountains.ts` are LF); generated hunks must preserve the target file's endings or `git apply --check` fails.
