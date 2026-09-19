# Environment Art Round 1 Handoff — First Visual Corrections (ground tint + mountain faces)

**Date**: 2026-09-19
**Lane**: `nuketown-environment-20260919` (sole owner, ~20 min exclusive). Root tree untouched (read-only).
**Scope**: ONE bounded art correction per canary. Writes limited to `src/core/ground-pbr-canary.ts`,
`src/build/distant-mountains-canary.ts`, the two focused CPU verifiers, this handoff, and
`work/art-round1-*` snapshots/diffs. No `main.ts`/`skyline.ts`/materials redesign, no exposure/lighting/
controls/mobile change, no downloads, no browser/GPU/server, no credentials/publish/recursive workers.
**Start snapshot**: `work/art-round1-start/` (pre-edit copies + `SHA256.txt`).
Start SHAs: ground `F46C9E06…966AD6`, mountains `5AE5EB2D…3AD5D813` (matches repair2 manifest).
**Diffs vs start**: `work/art-round1-canary-ground.diff` (64 lines), `work/art-round1-canary-mountains.diff`
(53 lines), root-relative `a/src/...` / `b/src/...` labels. Previous best preserved: repair2 handoff +
`work/environment-rootbase-repair2.patch` untouched; old artifacts kept.

## 1. Frames inspected (read-only, in recovery tree)

- `captures/env-comparison/baseline-turningHead.png` vs `ground-canary-turningHead.png`
- `captures/env-comparison/baseline-yardWhite.png` vs `mountains-canary-yardWhite.png`
- Frozen bar `docs/night/VISUAL-BAR.md`; pairings `docs/reference/library/shot-matrix.md`
  (`station-turningHead`, `station-yardWhite`; `sur-mountains` still NEED — unproduced Subject 14).

## 2. Diagnosis (evidence before tuning)

**Ground — asphalt reads near-white/blue concrete.** Baseline road is dark warm grey (procedural map
baked on `PAL.asphalt 0x4a4a4d` fill); canary road is light blue-grey. Cause: the canary photo
(ambientCG Asphalt030, light mid-grey mean) is multiplied by material.color **white** (factory default;
`applyGroundPbrCanaryMaps` never touched color; concrete path happened to survive because the caller
sets `PAL.concrete`). White × light photo under hard afternoon sun = washed out, dark-vs-pale contrast
lost. Roughness/normalScale/UVs are not the cause (family values 0.6/1.0 and repeat 40/2.2=18.18 kept).
Fix must be a gain on color, not new maps/scale. `PAL.asphalt` itself is NOT the gain — palette × photo
would double-darken toward black.

**Mountains — flat paper-cutout ribbons, negligible facial relief.** Numeric proof (node, layer-0
mid-face at theta=0): current `(a,b,d)/(d,b,c)` winding gives face normal **(+0.756, −0.639, +0.144)** —
pointing DOWN and OUTWARD. Viewer at map center needs UP and INWARD. So the FrontSide front scarp was
backface-culled/inverted from every map camera; what reads as "uniform bands" is the wrong side with
inverted gully shading. Crest silhouette code was never the problem (angularity 10.25× vs smooth sine).
Secondary: front profile too shallow at grazing angles, chutes too weak to shade once faces return.

## 3. Exact changes

**`src/core/ground-pbr-canary.ts`** (maps, repeats, roughness, normalScale, loader/dispose untouched):
- `GroundPbrCanarySurfaceSpec.albedoTint?: number` — optional sRGB hex on `material.color`
  (color × photo). Undefined = color untouched (existing callers/guards byte-identical).
- `buildSurface` + `applyGroundPbrCanaryMaps` apply it when defined (live root path is `applyGround`).
- `GROUND_CANARY_ALBEDO_TINT = { asphalt: 0x8f8f93, concrete: 0xffffff }` — asphalt gain ~0.56 sRGB
  restores dark-asphalt vs pale-paving contrast keeping aggregate variation; concrete white = no-op
  (caller `PAL.concrete` tint kept as-is). Roughness stays 1×map; no exposure/lighting/UV change.
  Paired views decide final ±10%.

**`src/build/distant-mountains-canary.ts`** (segments, tris, draws, palette, dispose untouched):
- Winding `(a,b,d)/(d,b,c)` → `(a,d,b)/(d,c,b)` + comment with measured numbers. Same tris.
- Front profile `pow(sf,1.45)*0.65+pow(sf,0.75)*0.35` → `pow(sf,1.7)*0.72+pow(sf,0.7)*0.28`
  (steeper upper scarp, flatter apron → sunlit-vs-shade normal spread).
- Gully depth factor `peakHeight*0.35` → `*0.45` (same tris; chutes shade once faces return).
- Layer radii/heights/widths/segments/materials/bounds/dispose unchanged:
  3 draws, 15,744 tris (3,584+5,760+6,400 ≤ 18,000), `PAL.dirt/mountain/mountainFar`.

**Focused tests (additive only; no limit/assertion weakened)**:
- `verify-ground-pbr-canary.mjs`: tint constants present; no-tint leaves white; build/apply apply
  `0x8f8f93`; apply-without-tint preserves singleton color. Now **80 PASS**.
- `verify-distant-mountains-canary.mjs`: Check 6b front-scarp orientation — meanNy **0.574** (>0.3),
  meanInward **0.649** (>0.3), minNy **0.244** (old winding −0.64). Now **31/31 PASS**.

## 4. Verification in lane (CPU + types only; all visual acceptance OPEN for root)

- `npm run check` — tsc + render-site allow-list, clean.
- `verify-ground-pbr-canary.mjs` — ALL CHECKS PASS (80 PASS incl. 7 new tint checks).
- `verify-distant-mountains-canary.mjs` — 31/31 PASS.
- `verify-environment-integration.mjs` — 100% PASS (paving brace, skyline registration, release, harness).
- No browser/GPU/server run here per directive; no `playcap`/`capture`/`soak` in lane.

## 5. Proposed SMALL materials delta for root (2 lines + import; NOT applied in lane)

Root asphalt `onReady` currently passes no tint (stays white). Apply with the round-1 canary files:

```diff
--- a/src/core/materials.ts
+++ b/src/core/materials.ts
@@
-import { applyGroundPbrCanaryMaps, GROUND_CANARY_UV_M, GROUND_CANARY_TILE_M, loadCanarySurfaceSet } from './ground-pbr-canary';
+import { applyGroundPbrCanaryMaps, GROUND_CANARY_ALBEDO_TINT, GROUND_CANARY_UV_M, GROUND_CANARY_TILE_M, loadCanarySurfaceSet } from './ground-pbr-canary';
@@ lib.asphalt onReady (canary path)
         applyGroundPbrCanaryMaps(lib.asphalt as THREE.MeshStandardMaterial, {
           maps,
           uvMetresPerUnit: GROUND_CANARY_UV_M.asphalt,
           tilePhysicalMetres: GROUND_CANARY_TILE_M.asphalt,
           normalScale: 0.6,
           roughness: 1.0,
+          albedoTint: GROUND_CANARY_ALBEDO_TINT.asphalt, // 0x8f8f93 round-1 dark-asphalt calibration
         });
```

Concrete: no change (white no-op; existing `PAL.concrete` setHex kept). Paving/UVs/materials otherwise frozen.

## 6. Root integration commands

```bash
# 1. copy round-1 canary sources (overwrite repair2 versions)
cp ../nuketown-environment-20260919/src/core/ground-pbr-canary.ts src/core/ground-pbr-canary.ts
cp ../nuketown-environment-20260919/src/build/distant-mountains-canary.ts src/build/distant-mountains-canary.ts
# (optional, CPU gates) copy the two extended verifiers too
# 2. apply the §5 materials delta above
# 3. CPU gates
npm run check
node --experimental-strip-types scripts/assets/verify-ground-pbr-canary.mjs
node --experimental-strip-types scripts/assets/verify-distant-mountains-canary.mjs
node --experimental-strip-types scripts/assets/verify-environment-integration.mjs
# 4. paired actual views + playcap, owned by root (WebGPU, real game loop):
#    ground: turningHead baseline vs canary (dark-asphalt contrast, no blue cast, grain intact)
#    mountains: yardWhite baseline vs canary (sunlit vs occluded facial relief, irregular ridges, no flat ribbons)
```

## 7. OPEN (explicitly not claimed)

- No photorealism/improvement claim from CPU checks; numbers prove orientation/contract/budget only.
- OPEN actual frames: paired `turningHead` (ground) and `yardWhite` (mountains) through the real loop,
  plus `playcap` 4/4. Retain live baseline 4191 if still worse.
- If asphalt still light/dark after pairing, adjust ONLY the `0x8f8f93` gain ±10% (one correction);
  if mountains still band, next single correction is strata/ridge amplitude, not profile/winding again.
- End SHA (lane, post-edit): ground `2169E0EE…BE05A0`, mountains `8A957A0A…C42D2`.
