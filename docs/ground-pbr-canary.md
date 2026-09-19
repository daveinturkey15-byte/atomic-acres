# ground-pbr-canary — photo-PBR ground material candidate

OMP lane `nuketown-materials-20260919`, 2026-09-19. Directive:
`C:\Users\David\Documents\Codex\2026-09-19\hi\work\glm-ground-pbr.md`. Root recovery tree
was read as reference only; nothing outside the four owned paths was written. No
browser/server/GPU was launched; all proofs are CPU-side. **Real visual acceptance stays
OPEN** — see §7.

## 1. What ships

| Path | Content |
|---|---|
| `public/assets/ground-pbr-canary/` | 6× 1024² JPEG maps + `provenance.json` |
| `src/core/ground-pbr-canary.ts` | Pure map-accepting factory (`buildGroundPbrCanaryMaterials`, `applyGroundPbrCanaryMaps`, UV/tile constants) |
| `scripts/assets/verify-ground-pbr-canary.mjs` | CPU verifier: hashes/dims/budget + factory contract |
| this doc | Provenance, conventions, recipe, open items |

Assets: **ambientCG `Asphalt030`** (asphalt, 2.2 m native tile) and **ambientCG
`Concrete046`** (pale concrete, 2.4 m native tile), both CC0, maps = Color + NormalGL +
Roughness per asset. Chosen from the official v2 API catalog among assets that publish
`dimensionX/Y` (official physical tile scale); previews checked for character: neutral
grey fine aggregate with **no cracks** (asphalt study match) and pale bleached concrete
with pinholes (paver study match). Asphalt020S/023L rejected (bleached/sandy), Concrete034
(fluted panels), Concrete045 (mid-grey, not pale).

## 2. Recorded provenance (full copy in `provenance.json`)

| | Asphalt030 | Concrete046 |
|---|---|---|
| source URL | `https://ambientcg.com/get?file=Asphalt030_1K-JPG.zip` | `…Concrete046_1K-JPG.zip` |
| license | CC0-1.0 (ambientCG site-wide; API carries no per-asset license field) | same |
| native physical tile | 220×220 cm (API `dimensionX/Y`) | 240×240 cm |
| colors / normals / roughness | sRGB / linear NormalGL / linear | same |
| SHA-256 + bytes | per map in `provenance.json`, re-verified by the script | same |

Budgets: **6 maps ≤ 6**, each **1024² ≤ 1K**, disk total **7,629,436 B**, delivery fetch
pass **7,892,125 B ≤ 12 MB** (HTTP-Range extraction of zip members; no full-zip download
in the delivery pass). Probe overshoot disclosure: one discarded 10.2 MB full-zip test and
one buggy ranged pass also hit the wire earlier; they are not part of the deliverable
pipeline and are recorded in `provenance.json`. No height/displacement map was extracted;
no draw geometry is added.

## 3. Root UV convention and the never-double-repeat rule

Root `build/ground.ts` bakes world tiling into geometry UVs: `UV_ASPHALT = 40.0` and
`UV_PAVING = 67.2` metres of world per UV unit (`scaleUV`), while shared textures keep a
fixed `texture.repeat`. Root's existing external upgrades follow
`repeat = uvM / tileMetres` (polyhaven asphalt-07 @16 → 40/16 = 2.5 m; pavement-03 @32 →
67.2/32 = 2.1 m; grass @48 → 2.0 m). The canary applies the SAME rule exactly once:
asphalt `40 / 2.2 = 18.1818…`, concrete `67.2 / 2.4 = 28`. The factory never rescales
geometry UVs — verified byte-identical position/uv buffers (§5).

## 4. Factory contract (`src/core/ground-pbr-canary.ts`)

- Accepts six loaded `THREE.Texture` objects; configures each exactly once
  (RepeatWrapping, repeat, colorSpace, anisotropy 8, `needsUpdate`).
- Returns `MeshStandardMaterial` singletons: `roughness: 1` × roughnessMap, `metalness: 0`,
  `normalScale` 0.6 (asphalt) / 0.4 (concrete) — the root ground family's values. No
  displacement/AO/emissive/env maps.
- `dispose()` releases all six maps + both materials, idempotent (spy-verified).
- `applyGroundPbrCanaryMaps(material, spec)` swaps maps onto an EXISTING singleton so the
  root one-program-per-surface discipline survives integration.
- No per-frame map or material creation; nothing touches scene/camera/renderer/lights.

## 5. Verification (all PASS, `node scripts/assets/verify-ground-pbr-canary.mjs`)

56 checks, exit 0 on node v24 (native TS stripping) and bun 1.3.14:
- on-disk maps: count 6, each 1024², bytes + SHA-256 match provenance, colorspace roles sane;
- repeat math `uvM/tileM` per map, RepeatWrapping, color/normal/roughness colorspace split;
- material shape (roughness 1 × map, metalness 0, no displacement, maps assigned);
- `apply()` leaves position AND uv buffers byte-identical and reuses the same material object;
- dispose: 0 → 6 → 6 (idempotent);
- scoped `tsc --noEmit src/core/ground-pbr-canary.ts --strict …` exit 0.

## 6. Root integration recipe (for the recovery tree owner; no root file was edited)

1. Copy `public/assets/ground-pbr-canary/` and `src/core/ground-pbr-canary.ts` into root.
2. In `buildMaterials()` (root `src/core/materials.ts`), after `buildMaterials` constructs
   the procedural ground family, load the six maps with the existing
   `loadExternalSurfaceSet` URLs pattern or a plain loader, then for each family call:
   ```ts
   applyGroundPbrCanaryMaps(lib.asphalt, {
     maps: { map, normalMap, roughnessMap },               // Asphalt030 set
     uvMetresPerUnit: 40.0,                                 // UV_ASPHALT, ground.ts
     tilePhysicalMetres: 2.2,                               // provenance.json
     normalScale: 0.6,
   });
   applyGroundPbrCanaryMaps(lib.concrete, { maps: concreteSet, uvMetresPerUnit: 67.2, tilePhysicalMetres: 2.4, normalScale: 0.4 });
   // lib.paving may share the concrete set at the same 67.2 m/UV scale if desired.
   ```
3. Keep `upgrade()`'s externalCache discipline: one load, atomic swap, dispose old maps on
   failure/teardown; the canary's own `dispose()` covers the alternative whole-set route.
4. Do NOT also change `scaleUV` values or geometry UVs — tiling would double-repeat.
5. Gate exactly as the project requires: `playcap` + `capture` through the REAL game loop,
   compare against `docs/reference/photoreal/asphalt-hard-noon-closeup-0*.png` and
   `round-pavers-lawn-sun-0*.png`, watch shader-program count (must stay 18; map swaps on
   existing singletons add none) and draw calls (must stay ~363 at stations).

## 7. Open items (explicitly NOT claimable from this lane)

- **Visual acceptance is OPEN.** No browser/server/GPU was launched here; the root render
  comparison through the real game loop is the only acceptance. This deliverable is a
  measured CPU + material-contract candidate.
- A photo texture does NOT automatically fix lighting or grass; it changes surface response
  only. The wetness uniform path (`wetStd`) is untouched and remains compatible (it wraps
  the same map slots).
- Concrete046 review points for the visual gate: a faint greenish cast in some blotches and
  vertical drip streaks — subtle at 2.4 m tiling, but confirm against the pale-concrete
  references before adoption. Asphalt030 aggregate is finer than the macro study's coarse
  gravel; at gameplay distance this is the safer choice, but the closeup station decides.
- ` asphalt` normal maps are NormalGL (three.js convention); the DX variants in the zips
  were deliberately not extracted.
