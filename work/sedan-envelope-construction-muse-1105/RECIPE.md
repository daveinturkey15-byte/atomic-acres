# sedan-envelope-construction-muse-1105 — envelope-first parametric sedan

Scope: ONLY `work/sedan-envelope-construction-muse-1105/` in `nuketown-muse-vehicle-20260919`.
Root + prior lanes read-only. CPU source only; no Blender/GPU/browser/server here.

## Files (this lane)
- `envelope.py` — single truth: envelope constants, RIBS/SECTION, wheel/lamp
  envelopes, LOCAL primitive generators (`box_local`, `cyl_z_local`), all body
  grids/loft/arch/fin/trim generators, authored+rolled validators, tri/normal
  checks. Imported by BOTH Blender recipe and CPU tests.
- `build_sedan_envelope_muse_1105.py` — Blender recipe. Pre-flights EVERY
  generator output via `envelope.check_authored` BEFORE any mesh, builds local
  + object-transform ownership, 1e-6 centre/rotation gates, X-roll by
  `_ROLL @ matrix_world` only, post-roll bounds assert, `<=14000` tris /
  `<=6` mats, exports `output/sedan-envelope-muse-1105.glb`.
- `tests/test_envelope_cpu.py` — SAME generators: authored/rolled bounds,
  wheel local-origin + world centres, lamp Ry centres, mirror/plate outers,
  box/cylinder outward, hull normals, 1e-5 negatives, oversize/reversed/
  shifted failures, recipe gate strings.
- `output/` — root bakes here; this lane never claims a Blender result.

## Envelope (frozen, not loosened)
- Authored Y-up: x `+-2.52` hard / `+-2.50` design; z `+-1.05` frozen /
  `+-1.02` design; y `-0.03..1.50` assert / `0.0..1.445` actual.
- Body `+-2.40 / +-0.94 hull` (35 mm margin funds spears/handles/mirrors).
- Wheels `(+-1.52, 0.34, +-0.86)` r=0.34 w=0.22, outer `0.9875`; tub
  `(y=0.48, r=0.36)` bottom `0.12`; mirrors arm `0.99` / head `1.02`;
  plates/bumpers `<=2.50`. Prior stalk `1.075` impossible by selection.
- Length `5.00`, width `2.04`, height `1.445`; collider `5.04/2.04/1.48` holds.

## Budgets
- Tris `4310` (Blender `sum(n-2)` identical), mats `6`, draws `6`, maps `0x1K`.
- Palette hex from `src/core/palette.ts`; no coach/old-asset/imagegen code.

## Root run
From `work/sedan-envelope-construction-muse-1105/`:
`blender --background --threads 2 --python build_sedan_envelope_muse_1105.py`
Expect `SEDAN_ENVELOPE_MUSE_1105` log + `output/sedan-envelope-muse-1105.glb`.
