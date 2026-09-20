# RECEIPT — sedan-envelope-construction-muse-1105

## New method
Envelope-first parametric: cross-sections (13 RIBS `half_w<=0.94`, 8-pt flank),
wheel envelope (`r=0.34 @ +-1.52/0.34/+-0.86`, tub `0.36@0.48`), lamp envelope
(`y=0.64, z=+-0.60/0.78`) are SELECTED inside `+-2.50/+-1.02/1.445` design limits
BEFORE any vertex exists. `envelope.py` emits LOCAL verts; placement is
object-transform only; pre-flight scans ACTUAL verts (authored + Ry-rotated +
X-rolled) + face normals and fails loud. No clamping, no normalize.

## Why it differs from stopped offset-repair (car-bake-muse-repair2-0955)
Repair fixed `cylinder_z` ownership + box winding then tweaked offsets twice;
it never scanned every vert, so mirror stalks (`arm 1.075`, head `1.085+r`)
kept breaching frozen `+-1.05` and the export read `-1.075..1.075 / -0.42..1.46`.
This lane does not edit/copy/scale those offsets: hull narrowed to `0.94`,
mirrors reselected flush (`0.99/1.02`), tub raised (`bottom 0.12`), plates at
`2.48 (outer 2.50)`. Breach is unrepresentable, not patched. Failure preserved.

## Verify (CPU, this lane only)
- `python work/sedan-envelope-construction-muse-1105/tests/test_envelope_cpu.py`:
  GREEN 0 failed — authored `x+-2.50 y0..1.445 z+-1.02`, rolled
  `y+-1.02 z0..1.445`, tris `4310`, mats `6`, negatives fail.
- `python -m py_compile` recipe + envelope + test: CLEAN.
- No Blender/GPU/browser/server run here; no runtime loader work.

## Root bake
`blender --background --threads 2 --python build_sedan_envelope_muse_1105.py`
from this lane; expect `output/sedan-envelope-muse-1105.glb` + `SEDAN_...` log.
Source/CPU PASS is not an accepted car; root + critic judge renders.
