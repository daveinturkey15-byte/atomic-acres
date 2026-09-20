# repair1 receipt — car-bake-muse-repair1-0941

## Diagnosis (CPU, struct, not missing parts)
- `struct.pack/unpack('f', 1.52)` = `1.5199999809265137`, err `-1.9e-08`, so
  `tuple(ob.location) == (ax, WHEEL_Y, zc)` is invalid for `SedanTyre_1.52_L`.
- Same for `0.34` (`+3.6e-09`), `0.86` (`+1.4e-08`), `pi/2` (`+4.4e-08`).
- Worst covered literal (`2.32`) errs `~6.7e-08`. Exact `==` fails on all of them.

## Fix (this lane only)
- `work/car-bake-muse-repair1-0941/build_car_body_bake_repair1_0941.py`: 5 guards
  (tub 504, wheels 524/525, lamps 548/549) now use
  `_close_seq(a, b, 1e-6)`; expected tuples `(ax, WHEEL_Y, zc)`,
  `(0,0,0)`, `(0.64, lz)`, `(0, pi/2, 0)` byte-identical in intent.
- `1e-6` m/rad is ~15x worst rounding, 10x below a real `1e-5` misplacement.
- All placement/envelope/tri (<=14000)/material (<=6)/pane/roll gates unchanged.
- `OUT_GLB = LANE / "output" / "car-body-bake-repair1-0941.glb"`; runs from work
  dir; writes only own `output/`. `common.py` verbatim (`cbc4d42a…`).
- Prior `work/car-body-agy-0923` untouched (readonly); root untouched; no
  Blender/GPU/browser/server/package/credential work here.

## Verify
- `python work/car-bake-muse-repair1-0941/tests/test_float32_repr_guard.py`:
  green — true centres pass at `1e-6`, `1e-5` displaced wheel/lamp/rot fail.
- `python -m py_compile` on recipe + common + test: clean.

## Root bake (exact)
- From `work/car-bake-muse-repair1-0941/`:
  `blender --background --threads 2 --python build_car_body_bake_repair1_0941.py`
- Expect `output/car-body-bake-repair1-0941.glb` + `CAR_BODY_BAKE_REPAIR1_0941` log.
- Claim NO bake until root actual receipt: this lane never ran Blender.
