# Mountain-Terrain Relief Repair1 Handoff — Source-Only

**Date**: 2026-09-19
**Lane**: `nuketown-environment-20260919` (exclusive; source-only — zero Blender / GPU / browser / server / delegation executed here)
**Target root**: `nuketown-recovery-20260919` (builds + looks at identical cameras)
**Status**: Recipe + manifest repaired for guarded root re-export and same-camera visual review. No visual claim made in lane.
**Budget**: ~15 min working budget; repair1 of max2.

## 1. Art miss (root looked, lane did not re-render)

Root integrated `519d213`, built GLB `9cdbd1dffdc9131bfbca34f9f085638fdcd5d1b76470e0de70d67fad8358925d`, 42 strict CPU + 28 browser mechanics PASS, looked at `captures/connected-terrain-2352/{terrain-yardWhite,terrain-turningHead,terrain-aerial,baseline-yardWhite}.png` vs frozen `docs/reference/refinement-targets/yard-white.png`.

Better: no isolated cooling towers; continuous silhouette. Still missing: broad paper-fold triangles, obvious parallel equally spaced striped bands, little rock relief, gray cardboard/ribbon read. Mathematical coverage is not visual acceptance.

## 2. What changed (only 2 files)

- `scripts/blender/build_mountain_terrain.py` (only source change)
- `work/mountain-terrain/manifest.json` (descriptive only)
- Preserved: `work/mountain-terrain/recipe-before-relief.py` (pre-repair backup, byte copy taken before edits)
- Untouched: `build_authored_mountains.py`, `verify-mountain-terrain.mjs`, validators, integration, lighting/fog, runtime.

Geometry (spends ~16k headroom: 9568 → 25984 tris, ≤30000; 3 draws):

- Grids `288×20 / 256×16 / 224×14` (11520 + 8192 + 6272 = 25984) to resolve outcrops/gullies instead of smooth bending planes.
- Gullies: single `sin(gf·θ)^1.5` → warped dual-comb (`f1 21/25/19` + `f2 13/17/11`, powers 1.2/1.6) on warped strike + v-meander, low-freq envelope, saddle guard (0.35–1.0 by crest/60) so saddles never punch sky.
- Benches: uniform 6.5 m → spacing breathes 4.7–8.3 m, seat warped ±2.9 m, lateral pinch mask 0.25–1.0 (benches crop out, no full rings).
- Outcrops: hash-placed Gaussian buttresses 14/12/10 per ring, amp 7/10/14 m; lift added to `y` and `+1.5×` to radius (up/out only, never into keepout). Pure-hash placement consumes no `rnd()`, so peak-jitter sequence is unchanged.
- Ridge: 2.2 + 1.1 → + 0.9 (13θ) + 0.5 (23θ); grain 1.1 → 1.6 + 0.8 slope-coupled.

Material (same 1 material, 3×1024 PNGs, no new texture/stack):

- Albedo/rough/normal share one warped strat coordinate `s = v·24 + warp(u,v)` with lateral pinch, so colour and carving agree and bands pinch out instead of paralleling.
- Albedo: stronger 3-octave mottle + thin crack veins + sparse pale flecks; talus wash and cap break vary by azimuth.
- Rough stays 0.86–1.0 (warped/pinched + crack darkening). Normal: warped ledges + meandering streaks + extra detail octave.

## 3. Kept contracts (lane-verified statically, no Blender)

- `python ast.parse` clean; recipe static contract ALL green (SEED, MAX_TRIS/MAX_DRAWS, threads=2, verts/faces, no cube, crest/exp, roll, smooth, UV, NormalMap, ladder ×2, keepout assert, no subsurf/multires/boolean/bake, no cycles, no net/download).
- `rnd()` call sites unchanged (5: def + GULLY_PHASE + 3 peak jitters) — deterministic sequence preserved.
- Keepout ≥280 (lift pushes out only; toe lift ~0), base sunk (toe relief still < −6), tier ladder (near ~70 / mid ~146 / far ~223 gaps dwarf 7/10/14 m lifts), threads=2, 2 GiB, authored mountains untouched, no lighting/fog/runtime patch.

## 4. Exact root steps (in order)

```bash
cp ../nuketown-environment-20260919/scripts/blender/build_mountain_terrain.py scripts/blender/
cp ../nuketown-environment-20260919/work/mountain-terrain/manifest.json work/mountain-terrain-manifest.json
call "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --threads 2 --python scripts/blender/build_mountain_terrain.py
node scripts/assets/verify-mountain-terrain.mjs --strict
# Same-camera visual review through the REAL game loop (owned by root):
# yardWhite + turningHead + aerial vs retained baseline; bar = frozen yard-white.png
# Judge: outcrop/gully relief, broken banding, rock read — NOT counts
```

## 5. Honest status

- No pixels looked at in lane. Silhouette ladder math from the prior handoff still argues continuity; art acceptance belongs to root's frames at identical cameras.
- If still failing after root look: representation change (max2 already declared), not another parameter tweak.
- Rollback: restore `work/mountain-terrain/recipe-before-relief.py` over `scripts/blender/build_mountain_terrain.py`; manifest `tris` 25984 → 9568.
