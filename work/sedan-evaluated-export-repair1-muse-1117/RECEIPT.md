# RECEIPT — sedan-evaluated-export-repair1-muse-1117

## Diagnosis (matches root's numbers exactly)

1105 assigned `ob.location`/`ob.rotation_euler` then premultiplied
`_ROLL @ matrix_world` with no `view_layer.update()` in between, so every
cylinder premultiplied from stale identity and baked at the origin:
stale tub `z-min = -0.36 == -TUB_R` (root saw `-0.360`), stale width `0.99`
(box-only mirror-arm outer; mirror heads collapsed). CPU world-array fixture
could not see it because it never touches Blender evaluation.

## Fix

Evaluate-first (`view_layer.update()` before any read), bake TRS to mesh data,
roll mesh data directly, join by material after validation. BEFORE/AFTER gates
use evaluated world coordinates (`matrix_world @ bound_box`) for every named
cylinder part; nominal checks retained as tripwires only. Envelope numerics
unchanged (`envelope.py` hash-identical to 1105).

## Verify (CPU, this lane only)

- `python work/sedan-evaluated-export-repair1-muse-1117/tests/test_envelope_cpu.py`:
  GREEN, 0 failed — authored `x ±2.50 y 0..1.445 z ±1.02`, rolled
  `y ±1.02 z 0..1.445`, tris `4310`, join groups `6/6` totalling `4310`,
  stale model reproduces `-0.36`/`0.99`, all negatives fail.
- `python -m py_compile` recipe + envelope + test: CLEAN.
- No Blender/GPU/browser/server run here; no GLB claimed; no runtime loader work.

## Root bake

`blender --background --threads 2 --python build_sedan_envelope_muse_1117.py`
from this lane; expect `output/sedan-envelope-muse-1117.glb` + `SEDAN_..._1117` log.
