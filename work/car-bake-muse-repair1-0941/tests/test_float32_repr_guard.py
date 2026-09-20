"""CPU float32 representation guard for car-body-bake-repair1-0941.

No bpy, no Blender, no GPU, no browser, no server.
Diagnoses the actual numerical representation with struct pack/unpack (CPU),
not missing parts: Blender Object.location / rotation_euler store float32,
so Python float64 literals such as 1.52 cannot compare with ==.

Proves:
  - exact == FAILS for the reported SedanTyre_1.52_L centre (float32 rounding)
  - abs(a-b) <= 1e-6 PASSES for every true mathematical centre/rotation
  - 10x-tolerance displacement (1e-5) MUST FAIL (negative control)
  - repair recipe keeps exact expected tuples, all gates, lane-local output
"""
import math
import struct
import sys
from pathlib import Path

THIS = Path(__file__).resolve()
LANE = THIS.parents[1]
RECIPE = LANE / "build_car_body_bake_repair1_0941.py"
COMMON = LANE / "common.py"

failures = []


def check(name, cond, msg=""):
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f" -- {msg}"))
    if not cond:
        failures.append(name)


def f32(x):
    return struct.unpack("f", struct.pack("f", x))[0]


def close_seq(actual, expected, tol):
    return all(abs(a - b) <= tol for a, b in zip(tuple(actual), tuple(expected)))


TOL_M = 1e-6
TOL_R = 1e-6

# 1. struct representation: exact equality is invalid for covered literals
covered = [1.52, -1.52, 0.34, 0.86, -0.86, 0.64, 0.62, 0.80, -0.80,
           2.28, 2.32, 2.345, math.pi / 2]
max_err = 0.0
for v in covered:
    r = f32(v)
    err = abs(r - v)
    max_err = max(max_err, err)
    check(f"f32-rounds-{v}", r != v, f"f32({v!r})={r!r} unexpectedly exact")
    check(f"f32-err-{v}-within-1e-6", err <= 1e-6, f"err={err:.3e}")
check("f32-zero-exact", f32(0.0) == 0.0, "zero must stay exact")
check("f32-max-err-tight", max_err <= 6.7e-08 + 1e-12, f"max_err={max_err:.3e}")
print(f"INFO max float32 rounding over covered literals = {max_err:.3e}")

# 2. true mathematical centres pass at 1e-6 (simulated stored float32 vs literal)
wheel_cases = [(ax, 0.34, side * 0.86)
               for ax in (1.52, -1.52) for side in (1.0, -1.0)]
for c in wheel_cases:
    stored = tuple(f32(v) for v in c)
    check(f"wheel-true-passes-{c}", close_seq(stored, c, TOL_M),
          f"stored={stored!r}")
    check(f"wheel-exact-would-fail-{c}", tuple(stored) != tuple(c),
          "expected float32 rounding to break ==")
for lz in (-0.80, -0.62, 0.62, 0.80):
    stored = (f32(0.64), f32(lz))
    check(f"lamp-loc-true-passes-{lz}", close_seq(stored, (0.64, lz), TOL_M))
rot = (0.0, math.pi / 2, 0.0)
stored_rot = (f32(0.0), f32(math.pi / 2), f32(0.0))
check("lamp-rot-true-passes", close_seq(stored_rot, rot, TOL_R),
      f"stored={stored_rot!r}")
check("lamp-rot-exact-would-fail", tuple(stored_rot) != tuple(rot))
check("wheel-rot-true-passes",
      close_seq((f32(0.0), f32(0.0), f32(0.0)), (0.0, 0.0, 0.0), TOL_R))

# 3. negative control: 10x-tolerance (1e-5) displacement must FAIL at 1e-6
DISP = 1e-5  # 10 * TOL
bad_centre = (1.52 + DISP, 0.34, 0.86)
check("neg-wheel-10x-fails",
      not close_seq(tuple(f32(v) for v in bad_centre), (1.52, 0.34, 0.86), TOL_M),
      "1e-5 misplacement must not pass 1e-6 guard")
bad_lamp = (0.64 + DISP, 0.62)
check("neg-lamp-10x-fails",
      not close_seq(bad_lamp, (0.64, 0.62), TOL_M))
bad_rot = (0.0, math.pi / 2 + DISP, 0.0)
check("neg-rot-10x-fails", not close_seq(bad_rot, rot, TOL_R))
check("neg-tub-10x-fails", not (abs(DISP) <= TOL_R))

# 4. recipe source: inappropriate == gone, tight tolerance in, maths preserved
code = RECIPE.read_text(encoding="utf-8")
check("recipe-exists", RECIPE.exists())
check("no-exact-loc-eq", "tuple(ob.location) ==" not in code)
check("no-exact-rot-eq", "tuple(ob.rotation_euler) ==" not in code)
check("no-exact-euler-idx-eq", "rotation_euler[0] == 0.0" not in code)
check("tol-m-1e-6", "_F32_TOL_M = 1e-6" in code)
check("tol-rad-1e-6", "_F32_TOL_RAD = 1e-6" in code)
check("close-helper", "def _close_seq(actual, expected, tol)" in code)
check("wheel-maths-kept", "_close_seq(ob.location, (ax, WHEEL_Y, zc), _F32_TOL_M)" in code)
check("wheel-rot-maths-kept",
      "_close_seq(ob.rotation_euler, (0.0, 0.0, 0.0), _F32_TOL_RAD)" in code)
check("lamp-loc-maths-kept",
      "_close_seq(tuple(ob.location)[1:], (0.64, lz), _F32_TOL_M)" in code)
check("lamp-rot-maths-kept",
      "_close_seq(ob.rotation_euler, (0.0, math.pi / 2, 0.0), _F32_TOL_RAD)" in code)
# placement / envelope / budget / pane gates unchanged
for needle in ["WHEEL_XS = (1.52, -1.52)", "WHEEL_Y = WHEEL_R", "WHEEL_Z = 0.86",
               "LAMP_ZS = (-0.80, -0.62, 0.62, 0.80)",
               "assert _mx.x - _mn.x <= 5.04 + 0.02",
               "assert _mn.y >= -1.02 - 0.03 and _mx.y <= 1.02 + 0.03",
               "assert _mn.z >= -0.03 and _mx.z <= H_MAX + 0.02",
               "assert tris <= 14000",
               "assert len(bpy.data.materials) <= 6",
               "assert_quad_planar",
               "_ob.matrix_world = _ROLL @ _ob.matrix_world",
               "sock.rotation_euler = (0.0, math.pi / 2, 0.0)"]:
    check(f"gate-kept:{needle[:28]}", needle in code, needle)
# output + run-from-work-directory + lane-local writes only
check("out-basename", 'OUT_GLB = LANE / "output" / "car-body-bake-repair1-0941.glb"' in code)
check("no-public-assets-write", "public" not in code.split("OUT_GLB")[1].split("\n")[0]
      or "public" not in code[code.index("OUT_GLB ="):code.index("OUT_GLB =") + 80],
      "OUT_GLB must not target public/")
check("no-abs-worktree-path", "C:/Users/david/Desktop/stuff/worktrees/nuketown-muse-vehicle-20260919/public" not in code)
check("lane-path-insert", 'sys.path.insert(0, str(LANE))' in code)
check("common-verbatim", COMMON.exists() and "def scene_tri_count" in COMMON.read_text(encoding="utf-8"))

print(f"\nTotal: {len(failures)} failed")
if failures:
    sys.exit(1)
print("CPU_REPR_GUARD green: exact == invalid, 1e-6 tight, 10x displacement fails")
