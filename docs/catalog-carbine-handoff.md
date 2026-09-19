# Catalog carbine — Explicit geometry handoff (2026-09-19)

Stage: **authored-model only**. Not accepted runtime. No in-game deployment claim.
Target: recovery root `docs/reference/production-catalog/weapons/carbine.png` (all-black AR carbine).

## Best candidate (retained, AGY Gemini 3.8 Flash high new approach)

- `public/assets/catalog-carbine/carbine.glb` — sha256 `fa600f0d56d2f88cfafd8524bf60f7aef2d039265405259ac03b45bfca08f51b`, 982,444 B (~0.98 MB)
- Editable source: `work/catalog-carbine/carbine.blend`, builder `scripts/blender/catalog-carbine/build_catalog_carbine.py`, module `scripts/blender/catalog-carbine/explicit_geometry.py`
- Evidence renders:
  - Neutral side (+X, full profile): `work/catalog-carbine/authored-model-render.png`
  - Three-quarter perspective: `work/catalog-carbine/authored-model-render-34.png`
  - Rendered from the **actual exported GLB** (`public/assets/catalog-carbine/carbine.glb`), not source-only.
- Preserved artifacts:
  - `work/catalog-carbine/pre-explicit-geometry/` (artifacts preserved prior to explicit geometry approach)
  - `work/catalog-carbine/_preserve-20260919-muse/` (earlier Muse iteration partials)

## Budgets (measured from exported GLB via fixed `verify_glb.mjs`)

| Gate | Target | Measured |
|---|---|---|
| Triangles | 8–18k | **10,836** pass |
| Materials | ≤4 | **3** (`metal_black`, `polymer_black`, `polymer_rubber`) pass |
| GLB size | ≤5 MB | **0.98 MB** (982,444 B) pass |
| Maps / decoded | two 1K / 8–12 MiB | **2 PNG** embedded (`carbine_basecolor_1k.png`, `carbine_orm_1k.png`), 8 MiB decoded pass |
| PBR wiring | baseColor + ORM per material | **pass** — all 3 carry both textures |
| World bounds | sanity envelope, no stray cubes | **pass** — X: [-0.029, 0.034], Y: [-0.196, 0.102], Z: [-0.620, 0.320] |
| Console/page errors | none | Blender logs clean (`_geometry.log`, `_bake.log`, `_render.log`), `PHASE_OK` x3 pass |

## Root-cause resolutions & improvements

1. **Eliminated untransformed unit cubes / stray triangular planes**:
   - Cause: `bmesh.ops.create_cube` in BMesh created 1.0 m unit cubes at origin; slicing `bm.verts[start:]` without `ensure_lookup_table()` failed to capture vertices, leaving un-transformed ±0.5 m cubes in `lower_controls` and `muzzle_device`.
   - Correction: Replaced ambiguous bmesh slicing with `explicit_geometry.py` generating explicit vertex arrays and quad/tri face index tuples directly in Python, loaded via Blender's C API `from_pydata()`.
   - Verification: World bounds checked pre-export and confirmed in `glb-evidence.json`: zero stray coordinates at ±0.5.

2. **Corrected top rail overhang**:
   - Cause: `RAIL_Y` was set to `(-0.475, 0.100)`, running the rail ~16 cm behind the buttpad over the stock and leaving the handguard bare.
   - Correction: `RAIL_Y = (-0.150, 0.495)` now runs continuously from the rear of the upper receiver across the entire handguard top, ending at the front sight / barrel nut junction.

3. **Authentic AR-15 component anatomy & layout**:
   - Rear to front along Y: Buttpad (`-0.320` to `-0.305`) -> Stock & Buffer Tube (`-0.305` to `-0.155`) -> Upper Receiver (`-0.155` to `+0.105`) -> Grip (`-0.088` to `-0.003`) -> Trigger Guard & Trigger (`-0.024` to `+0.035`) -> Magwell & Curved PMAG (`+0.035` to `+0.130`) -> Handguard (`+0.105` to `+0.495`) -> Barrel (`+0.105` to `+0.565`) -> Flash Hider (`+0.565` to `+0.620`).

4. **All-black furniture & restrained wear**:
   - Switched furniture from FDE tan to deep black polymer `(0.032, 0.033, 0.035, 1.0)` with roughness 0.65; dark anodized metal `(0.045, 0.046, 0.048, 1.0)` with metallic 0.85 and roughness 0.40; matte black rubber buttpad `(0.022, 0.022, 0.024, 1.0)` with roughness 0.90.
   - Baking uses subtle edge wear (`(0.11, 0.115, 0.12, 1.0)`) and low-contrast noise overlay (0.06), eliminating harsh blown-out edges.

5. **Falsified "UV atlas ineffective" / fixed verifier offset bug**:
   - Root cause: `verify_glb.mjs` read binary buffer views from `20 + jsonLen` instead of `20 + jsonLen + 8` (the 8-byte GLB chunk 1 length/type header). This 8-byte shift caused the VEC2 UV reader to read the last 2 floats of the preceding normal buffer (often `[0, -0.7071]`).
   - Correction: Adjusted chunk 1 binary offset in `verify_glb.mjs`. All 18 meshes now verify with 100% finite UVs strictly within `[0.0, 1.0]` and inside their assigned 5x4 atlas tiles.

6. **Render of actual GLB artifact**:
   - `render_hero()` clears the scene and imports `public/assets/catalog-carbine/carbine.glb` directly, ensuring the rendered output reflects the actual exported GLB asset.

7. **Fallback builder preserved**:
   - `build_geometry_legacy()` is retained in `build_catalog_carbine.py` and accessible via `--legacy`.

8. **Sockets verified**:
   - `anchor_muzzle`: `(0.0, 0.615, 0.035)`
   - `anchor_grip`: `(0.0, 0.006, -0.072)`
   - `anchor_support`: `(0.0, 0.330, 0.002)`
   - `anchor_mag`: `(0.0, 0.118, -0.052)`

## Guard measurements (`run_blender.py` unchanged)

- Host state: free RAM **41.1 GiB** (floor 12 GiB), free VRAM **12.0 GiB** (floor 3 GiB).
- CPU-only, 2 threads, 1 process.
- Execution metrics:
  - `geometry`: 1.0 s (RSS 0.163 / private commit 0.244 GiB)
  - `bake`: 10.5 s (RSS 0.374 / private commit 0.589 GiB)
  - `render`: 6.0 s (RSS 0.476 / private commit 0.662 GiB)
- Total time: ~17.5 s. Memory cap of 2.0 GiB never approached.

## Touched paths

- `scripts/blender/catalog-carbine/explicit_geometry.py` (new explicit geometry authoring module)
- `scripts/blender/catalog-carbine/build_catalog_carbine.py` (updated builder with explicit pipeline, pre-export bounds validation, black materials, actual GLB render)
- `scripts/blender/catalog-carbine/verify_glb.mjs` (fixed GLB chunk 1 offset in validator)
- `work/catalog-carbine/pre-explicit-geometry/` (preserved pre-explicit artifacts)
- `work/catalog-carbine/` (`carbine.blend`, `carbine-geometry.glb`, `carbine_basecolor_1k.png`, `carbine_orm_1k.png`, `authored-model-render.png`, `authored-model-render-34.png`, `glb-evidence.json`, `geometry_evidence.json`, `_runs.json`, `_[geometry|bake|render].log`)
- `public/assets/catalog-carbine/carbine.glb` (exported artifact)
- `docs/catalog-carbine-handoff.md` (this report)
