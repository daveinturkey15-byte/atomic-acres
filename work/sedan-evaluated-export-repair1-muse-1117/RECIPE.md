# sedan-evaluated-export-repair1-muse-1117 — evaluated-transform repair of 1105

Scope: ONLY `work/sedan-evaluated-export-repair1-muse-1117/` in
`nuketown-muse-vehicle-20260919`. Prior lane + root read-only. No
Blender/GPU/browser/server here; root runs the guarded bake.

## Files (this lane)

- `envelope.py` — byte-identical copy of the 1105 envelope (sha256 `fbe2381f…b876e6ee`).
  Numeric envelope frozen: authored `x ±2.50 / y 0..1.445 / z ±1.02`.
- `build_sedan_envelope_muse_1117.py` — corrected Blender recipe. Same parts,
  same ownership, same material assignment as 1105. Differences only:
  1. `view_layer.update()` BEFORE any `matrix_world` read (BEFORE gates);
  2. `transform_apply(location+rotation+scale)` bake + AFTER-bake evaluated gates;
  3. roll via `ob.data.transform(ROLL)` (mesh data owns everything; no
     TRS/matrix_world ordering hazard) + AFTER-roll evaluated gates;
  4. `ops.object.join` by owned material AFTER validation → 6 mesh objects.
- `tests/test_envelope_cpu.py` — same generators: authored/rolled bounds,
  wheel/tub/lamp centres, mirror/plate outers, outward/normals, all 1105
  negatives, plus a stale-vs-fixed TRS model and per-material join accounting.
- `output/` — root bakes `sedan-envelope-muse-1117.glb` here.

## Root run

From `work/sedan-evaluated-export-repair1-muse-1117/`:
`blender --background --threads 2 --python build_sedan_envelope_muse_1117.py`
Expect `SEDAN_ENVELOPE_MUSE_1117` log (BEFORE/AFTER lines), `draws=6`,
`output/sedan-envelope-muse-1117.glb`. Root counts decoded GLB
primitives/instances and real bounds; failure retained if export still wrong.
