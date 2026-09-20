# repair2 receipt — work/car-bake-muse-repair2-0955

## Root cause (retracts rounding-only diagnosis)
- `cylinder_z` baked `loc` into mesh verts and left `ob.location` at ZERO.
  Guarded Blender therefore failed `SedanTyre_1.52_L: off-centre` even at 1e-6.
- Worse, lamp/dagmar/exhaust/mirror `rotation_euler=(0,pi/2,0)` then orbited
  baked verts about the world origin, e.g. sock `(2.28,0.64,0.62)` → `(0.62,0.64,-2.28)`.

## Fix (this lane only, source-only, no Blender/GPU/browser)
- `build_car_body_bake_repair2_0955.py`: `cylinder_z` builds LOCAL at origin,
  then `ob.location = loc`; rotations spin about the true centre.
  Wheel world centres/axle, lamp contact centres/envelope preserved.
- `box`: all six faces were inward; rewound outward
  `[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]`.
  Cylinder sides/caps verified outward, left as-is.
- Kept: 1e-6 loc/rot guards + asserts, WHEEL_XS/Y/Z, budgets (tris<=14000,
  materials<=6), envelope, pane/roll gates, palette, RIBS/stations.
  `OUT_GLB = output/car-body-bake-repair2-0955.glb`; log `CAR_BODY_BAKE_REPAIR2_0955`.
- `common.py`: verbatim copy of repair1 (recovery `common.py` lineage).
- Readonly honoured: root + `car-bake-muse-repair1-0941` + `car-body-agy-0923` untouched.

## Verify (CPU, actual helper logic)
- `python work/car-bake-muse-repair2-0955/tests/test_cylinder_ownership_cpu.py`:
  green — execs ACTUAL `mesh_from/box/cylinder_z` with stubbed bpy; gates wheel
  centres/axis, 22 lamp/dagmar/exhaust/mirror centres + Z→X axis after Ry(pi/2),
  old-orbit fails by metres, box 6/6 outward (old 6/6 inward), 1e-5 negatives fail.
- `python -m py_compile` recipe + common + test: clean.

## Root bake (exact, root runs)
- From `work/car-bake-muse-repair2-0955/`:
  `blender --background --threads 2 --python build_car_body_bake_repair2_0955.py`
- Expect `output/car-body-bake-repair2-0955.glb` + `CAR_BODY_BAKE_REPAIR2_0955` log.
- NO Blender claim from CPU: this lane never ran Blender.
