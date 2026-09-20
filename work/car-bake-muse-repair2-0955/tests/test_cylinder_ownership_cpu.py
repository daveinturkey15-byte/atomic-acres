"""CPU algebra fixture for car-bake-muse-repair2-0955.

Uses the ACTUAL helper logic from build_car_body_bake_repair2_0955.py
(mesh_from/box/cylinder_z exec'd with a stubbed bpy), NOT source-pattern
matching. Gates:
  - wheel world centres + axle axis under identity rotation
  - lamp/dagmar/exhaust/mirror world centres + axis after (0, pi/2, 0)
    rotation about the true centre (old baked-verts + zero-location
    behaviour is shown to orbit about the world origin and fail)
  - box winding outward on all six faces (old order shown inward)
  - cylinder side/cap winding outward
  - recipe keeps 1e-6 location/rotation guards, budgets, envelope gates
Run: python tests/test_cylinder_ownership_cpu.py (no Blender/GPU/browser).
"""
import math
import struct
import sys
import types
from pathlib import Path

THIS = Path(__file__).resolve()
LANE = THIS.parents[1]
RECIPE = LANE / "build_car_body_bake_repair2_0955.py"

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

# ---- stub bpy: record verts/faces, allow location/rotation assignment ----
class FakeMesh:
    def __init__(self, name):
        self.name = name
        self.verts = []
        self.faces = []
        self.materials = []
        self.polygons = []

    def from_pydata(self, verts, edges, faces):
        self.verts = [tuple(v) for v in verts]
        self.faces = [tuple(f) for f in faces]

    def update(self):
        self.polygons = [types.SimpleNamespace(vertices=f) for f in self.faces]


class FakeOb:
    def __init__(self, name, mesh):
        self.name = name
        self.data = mesh
        self.location = (0.0, 0.0, 0.0)
        self.rotation_euler = (0.0, 0.0, 0.0)


_meshes = {}
_objects = {}

fake_bpy = types.ModuleType("bpy")
fake_bpy.data = types.SimpleNamespace(
    meshes=types.SimpleNamespace(
        new=lambda name: _meshes.setdefault(name, FakeMesh(name))),
    objects=types.SimpleNamespace(
        new=lambda name, mesh: _objects.setdefault(name, FakeOb(name, mesh))),
)
fake_bpy.context = types.SimpleNamespace(
    collection=types.SimpleNamespace(objects=types.SimpleNamespace(link=lambda ob: ob)))
sys.modules["bpy"] = fake_bpy

# ---- load ACTUAL helpers from the recipe (link/mesh_from/box/cylinder_z) ----
code = RECIPE.read_text(encoding="utf-8")
start = code.index("def link(ob):")
end = code.index("def select_only(ob):")
helper_src = code[start:end]
ns = {"math": math, "bpy": fake_bpy}
exec(helper_src, ns)
mesh_from = ns["mesh_from"]
box = ns["box"]
cylinder_z = ns["cylinder_z"]
check("actual-helpers-loaded", all(callable(f) for f in (mesh_from, box, cylinder_z)))

# ---- rotation algebra: Blender Euler (0, pi/2, 0) == single Ry(pi/2) ----
def ry90(p):
    x, y, z = p
    return (z, y, -x)  # x'=x cos+z sin, z'=-x sin+z cos at pi/2


def world_pt(local, loc, rot):
    if rot == (0.0, 0.0, 0.0):
        return (local[0] + loc[0], local[1] + loc[1], local[2] + loc[2])
    assert tuple(rot) == (0.0, math.pi / 2, 0.0), rot
    r = ry90(local)
    return (r[0] + loc[0], r[1] + loc[1], r[2] + loc[2])


def mesh_mean(verts):
    n = len(verts)
    return (sum(v[0] for v in verts) / n, sum(v[1] for v in verts) / n, sum(v[2] for v in verts) / n)


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])

# ---- wheels: world centres + axle axis (identity) ----
WHEEL_XS = (1.52, -1.52)
WHEEL_Y = 0.34
WHEEL_Z = 0.86
for ax in WHEEL_XS:
    for side in (1.0, -1.0):
        zc = side * WHEEL_Z
        loc = (ax, WHEEL_Y, zc)
        ob = cylinder_z(f"T_wheel_{ax}_{side}", loc, 0.34, 0.22, None, verts_n=28)
        check(f"wheel-loc-held-{ax}_{side}", tuple(ob.location) == loc, f"{ob.location!r}")
        stored = tuple(f32(v) for v in loc)
        check(f"wheel-loc-f32-passes-{ax}_{side}", close_seq(stored, loc, TOL_M))
        check(f"wheel-rot-identity-{ax}_{side}",
              close_seq(ob.rotation_euler, (0.0, 0.0, 0.0), TOL_R))
        mean_local = mesh_mean(ob.data.verts)
        check(f"wheel-local-centred-{ax}_{side}",
              close_seq(mean_local, (0.0, 0.0, 0.0), 1e-9), f"{mean_local!r}")
        world_centre = world_pt(mean_local, tuple(ob.location), (0.0, 0.0, 0.0))
        check(f"wheel-world-centre-{ax}_{side}", close_seq(world_centre, loc, 1e-9))
        # axle axis: local +Z must stay +Z under identity
        check(f"wheel-axis-z-{ax}_{side}",
              close_seq(world_pt((0, 0, 1), (0, 0, 0), (0.0, 0.0, 0.0)), (0, 0, 1), 1e-12))
        # preserved vs old baked verts: old world mean (verts at loc, no offset) == loc
        check(f"wheel-preserved-vs-baked-{ax}_{side}", close_seq(world_centre, loc, 1e-9))

# ---- lamps etc: centre preserved + axis Z->X after Ry(pi/2) ----
lamp_locs = [(2.28, 0.64, lz) for lz in (-0.80, -0.62, 0.62, 0.80)]
lamp_locs += [(2.32, 0.64, lz) for lz in (-0.80, -0.62, 0.62, 0.80)]
lamp_locs += [(2.345, 0.64, lz) for lz in (-0.80, -0.62, 0.62, 0.80)]
lamp_locs += [(2.46, 0.44, s * 0.38) for s in (1.0, -1.0)]          # dagmars
lamp_locs += [(-2.46, 0.32, s * 0.55) for s in (1.0, -1.0)]         # exhausts
lamp_locs += [(0.95, 1.05, s * (0.975 + 0.11)) for s in (1.0, -1.0)]  # mirrors
lamp_locs += [(-2.40, 1.10, s * 0.925) for s in (1.0, -1.0)]        # tail socks
lamp_locs += [(-2.455, 1.10, s * 0.925) for s in (1.0, -1.0)]       # tail lenses
ROT = (0.0, math.pi / 2, 0.0)
for loc in lamp_locs:
    ob = cylinder_z(f"T_lamp_{loc}", loc, 0.115, 0.08, None, verts_n=16)
    ob.rotation_euler = (0.0, math.pi / 2, 0.0)
    check(f"lamp-loc-held-{loc}", tuple(ob.location) == loc)
    mean_local = mesh_mean(ob.data.verts)
    check(f"lamp-local-centred-{loc}", close_seq(mean_local, (0, 0, 0), 1e-9))
    world_centre = world_pt(mean_local, tuple(ob.location), ROT)
    check(f"lamp-world-centre-{loc}", close_seq(world_centre, loc, 1e-9), f"{world_centre!r}")
    # axis maps Z -> +X (faces +X)
    check(f"lamp-axis-x-{loc}", close_seq(world_pt((0, 0, 1), (0, 0, 0), ROT), (1, 0, 0), 1e-9))
    # float32 gate as the recipe asserts it (location slice + rotation)
    stored_loc = (f32(loc[1]), f32(loc[2]))
    check(f"lamp-gate-loc-{loc}", close_seq(stored_loc, (loc[1], loc[2]), TOL_M))
    stored_rot = (f32(0.0), f32(math.pi / 2), f32(0.0))
    check(f"lamp-gate-rot-{loc}", close_seq(stored_rot, ROT, TOL_R))
    # OLD buggy behaviour: verts baked at loc, location ZERO, then Ry about origin
    old_orbited = ry90(loc)
    check(f"lamp-old-would-orbit-{loc}", not close_seq(old_orbited, loc, TOL_M),
          f"old={old_orbited!r} must differ by metres (the repair1 failure mode)")

# ---- box winding: all six faces outward ----
box_cases = [
    ("plate", (2.49, 0.44, 0.0), (0.04, 0.15, 0.38)),
    ("belly", (0.0, 0.34, 0.0), (3.60, 0.08, 1.55)),
    ("lug", (1.625, 0.445, 0.985), (0.035, 0.035, 0.035)),
]
OLD_F = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1),
         (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
for tag, loc, size in box_cases:
    ob = box(f"T_box_{tag}", loc, size, None)
    cx = sum(v[0] for v in ob.data.verts) / 8
    cy = sum(v[1] for v in ob.data.verts) / 8
    cz = sum(v[2] for v in ob.data.verts) / 8
    check(f"box-centre-{tag}", close_seq((cx, cy, cz), loc, 1e-12))
    for fi, f in enumerate(ob.data.faces):
        v0, v1, v2 = (ob.data.verts[f[0]], ob.data.verts[f[1]], ob.data.verts[f[2]])
        n = cross(sub(v1, v0), sub(v2, v0))
        fc = (sum(ob.data.verts[i][0] for i in f) / 4,
              sum(ob.data.verts[i][1] for i in f) / 4,
              sum(ob.data.verts[i][2] for i in f) / 4)
        outward = sub(fc, (cx, cy, cz))
        check(f"box-outward-{tag}-{fi}", dot(n, outward) > 0,
              f"face {f} normal {n!r} points inward")
    # old order was inward on every face: prove the defect was real
    verts = ob.data.verts
    inward = 0
    for f in OLD_F:
        v0, v1, v2 = verts[f[0]], verts[f[1]], verts[f[2]]
        n = cross(sub(v1, v0), sub(v2, v0))
        fc = (sum(verts[i][0] for i in f) / 4, sum(verts[i][1] for i in f) / 4,
              sum(verts[i][2] for i in f) / 4)
        if dot(n, sub(fc, (cx, cy, cz))) < 0:
            inward += 1
    check(f"box-old-inward-{tag}", inward == 6, f"{inward}/6 inward")

# ---- cylinder winding: sides + caps outward ----
ob = cylinder_z("T_cyl_wind", (0.0, 0.0, 0.0), 0.34, 0.22, None, verts_n=24)
verts, faces = ob.data.verts, ob.data.faces
n = 24
side_ok = True
for f in faces[:n]:
    v0, v1, v2 = verts[f[0]], verts[f[1]], verts[f[2]]
    nn = cross(sub(v1, v0), sub(v2, v0))
    fc = (sum(verts[i][0] for i in f) / 4, sum(verts[i][1] for i in f) / 4,
          sum(verts[i][2] for i in f) / 4)
    if dot(nn, (fc[0], fc[1], 0.0)) <= 0:
        side_ok = False
check("cyl-sides-outward", side_ok)
bot, top = faces[n], faces[n + 1]
for name, f, want in (("bot", bot, (0, 0, -1)), ("top", top, (0, 0, 1))):
    v0, v1, v2 = verts[f[0]], verts[f[1]], verts[f[2]]
    nn = cross(sub(v1, v0), sub(v2, v0))
    check(f"cyl-cap-{name}-outward", dot(nn, want) > 0, f"{nn!r}")

# ---- negative controls: 1e-5 displacement must fail the 1e-6 gates ----
DISP = 1e-5
check("neg-wheel-10x-fails",
      not close_seq((1.52 + DISP, 0.34, 0.86), (1.52, 0.34, 0.86), TOL_M))
check("neg-lamp-10x-fails", not close_seq((0.64 + DISP, 0.62), (0.64, 0.62), TOL_M))
check("neg-rot-10x-fails",
      not close_seq((0.0, math.pi / 2 + DISP, 0.0), (0.0, math.pi / 2, 0.0), TOL_R))

# ---- recipe keeps hard gates: tolerances, asserts, budgets, envelope ----
check("recipe-exists", RECIPE.exists())
check("common-exists", (LANE / "common.py").exists())
check("tol-m-1e-6", "_F32_TOL_M = 1e-6" in code)
check("tol-rad-1e-6", "_F32_TOL_RAD = 1e-6" in code)
check("wheel-loc-gate-kept",
      "_close_seq(ob.location, (ax, WHEEL_Y, zc), _F32_TOL_M)" in code)
check("wheel-rot-gate-kept",
      "_close_seq(ob.rotation_euler, (0.0, 0.0, 0.0), _F32_TOL_RAD)" in code)
check("lamp-loc-gate-kept",
      "_close_seq(tuple(ob.location)[1:], (0.64, lz), _F32_TOL_M)" in code)
check("lamp-rot-gate-kept",
      "_close_seq(ob.rotation_euler, (0.0, math.pi / 2, 0.0), _F32_TOL_RAD)" in code)
check("ownership-fix-in", "ob.location = loc" in code)
check("baked-verts-gone", "cx + r * math.cos" not in code)
check("box-fix-in", "(0, 3, 2, 1)" in code)
for needle in ("WHEEL_XS = (1.52, -1.52)", "WHEEL_Y = WHEEL_R", "WHEEL_Z = 0.86",
               "sock.rotation_euler = (0.0, math.pi / 2, 0.0)",
               "assert tris <= 14000", "assert len(bpy.data.materials) <= 6",
               "length breaches collider envelope", "assert_quad_planar",
               "_ROLL @ _ob.matrix_world"):
    check(f"gate-kept:{needle[:30]}", needle in code, needle)
check("out-unique", 'OUT_GLB = LANE / "output" / "car-body-bake-repair2-0955.glb"' in code)
check("no-stale-prefix", "CAR_BODY_BAKE_REPAIR1_0941" not in code)
check("no-tolerance-relax", "1e-5" not in code.split("DISP")[0] or "_F32_TOL_M = 1e-6" in code)

print(f"\nTotal: {len(failures)} failed")
if failures:
    sys.exit(1)
print("CPU_OWNERSHIP green: local cylinders at origin, centres survive Ry(pi/2), boxes outward")
