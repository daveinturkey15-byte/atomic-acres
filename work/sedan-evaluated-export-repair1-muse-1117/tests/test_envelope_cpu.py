"""CPU sanity for sedan-evaluated-export-repair1-muse-1117. Uses SAME envelope.py."""
import math
import struct
import sys
from pathlib import Path

THIS = Path(__file__).resolve()
LANE = THIS.parents[1]
sys.path.insert(0, str(LANE))
import envelope as E

fails = []

def check(n, c, m=""):
    print(("PASS " if c else "FAIL ") + n + ("" if c else f" -- {m}"))
    if not c:
        fails.append(n)


def f32(x):
    return struct.unpack("f", struct.pack("f", x))[0]


def close(a, e, t):
    return all(abs(x - y) <= t for x, y in zip(tuple(a), tuple(e)))


TOL_M = 1e-6
TOL_R = 1e-6

sets = []
faces_all = []
hv, hf = E.loft_hull()
sets.append(hv)
faces_all += hf
for fn in (E.hood_grid, E.trunk_grid, E.roof_grid, E.windshield_grid,
           E.rear_grid, E.arch_lips, E.fins):
    v, f = fn()
    sets.append(v)
    faces_all += f
_GF = {}
for _fn in (E.hood_grid, E.trunk_grid, E.roof_grid, E.windshield_grid, E.rear_grid, E.arch_lips, E.fins):
    _GF[_fn.__name__] = _fn()[1]
hogf = _GF["hood_grid"]; trgf = _GF["trunk_grid"]; rooff = _GF["roof_grid"]
wsgf = _GF["windshield_grid"]; rwgf = _GF["rear_grid"]
archf = _GF["arch_lips"]; finf = _GF["fins"]
for n, l, s in E.addon_boxes():
    w, f = E.box_world(l, s)
    sets.append(w)
    faces_all += f
rot_sets = []
for n, l, r, d, nn, rot in E.addon_cylinders():
    if rot:
        v, f = E.cyl_z_local(r, d, nn)
        w = [(l[0] + p[2], l[1] + p[1], l[2] - p[0]) for p in v]
        sets.append(w)
        faces_all += f
    else:
        w, f = E.cyl_z_world(l, r, d, nn)
        sets.append(w)
        faces_all += f
for n, l, s in E.lug_boxes() + E.trim_boxes():
    w, f = E.box_world(l, s)
    sets.append(w)
    faces_all += f
for q in E.side_glass_quads():
    sets.append(q)
    faces_all.append((0, 1, 2, 3))

mn, mx, errs = E.check_authored(sets)
print(f"AUTHORED x=[{mn[0]:.3f},{mx[0]:.3f}] y=[{mn[1]:.3f},{mx[1]:.3f}] z=[{mn[2]:.3f},{mx[2]:.3f}]")
check("envelope-authored-hard", not errs, "; ".join(errs))
rolled = [[E.roll_x90_pt(p) for p in s] for s in sets]
rmn, rmx = E.bounds_of(rolled)
print(f"ROLLED x=[{rmn[0]:.3f},{rmx[0]:.3f}] y=[{rmn[1]:.3f},{rmx[1]:.3f}] z=[{rmn[2]:.3f},{rmx[2]:.3f}]")
check("rolled-length", rmx[0] - rmn[0] <= 5.04 + 0.02 + 1e-9, f"{rmx[0] - rmn[0]:.4f}")
check("rolled-width", rmn[1] >= -1.05 - 1e-9 and rmx[1] <= 1.05 + 1e-9, f"[{rmn[1]:.4f},{rmx[1]:.4f}]")
check("rolled-width-design", rmn[1] >= -1.02 - 1e-9 and rmx[1] <= 1.02 + 1e-9, f"[{rmn[1]:.4f},{rmx[1]:.4f}]")
check("rolled-height", rmn[2] >= -0.03 - 1e-9 and rmx[2] <= 1.50 + 1e-9, f"[{rmn[2]:.4f},{rmx[2]:.4f}]")
check("rolled-floor", rmn[2] >= -0.03 - 1e-9, f"{rmn[2]:.4f}")
tris = E.tri_count(faces_all)
print(f"TRIS={tris} faces={len(faces_all)}")
check("tris<=14000", tris <= 14000, f"{tris}")
check("tris>2000", tris > 2000, f"{tris} too coarse for sedan read")
check("materials<=6", len(E.MATERIALS) <= 6)
check("materials==6", len(E.MATERIALS) == 6)
check("maps<=3x1K", True)

for ax in E.WHEEL_XS:
    for side in (1.0, -1.0):
        zc = side * E.WHEEL_Z
        check(f"wheel-centre-{ax}-{side}",
              close((ax, E.WHEEL_Y, zc), (ax, 0.34, zc), 1e-9), f"{(ax, E.WHEEL_Y, zc)}")
        check(f"wheel-outer-{ax}-{side}", abs(zc) + 0.1275 <= 1.02 + 1e-9, f"{abs(zc) + 0.1275:.4f}")
check("wheel-bottom-floor", E.WHEEL_Y - E.WHEEL_R >= -1e-9, f"{E.WHEEL_Y - E.WHEEL_R}")
check("tub-bottom-floor", E.TUB_Y - E.TUB_R >= 0.02 - 1e-9, f"{E.TUB_Y - E.TUB_R}")
for lz in E.LAMP_ZS:
    for kind, xx in (("HeadSock", 2.28), ("HeadBezel", 2.315), ("HeadLens", 2.34)):
        v, _ = E.cyl_z_local(0.11, 0.08, 16)
        m = (xx, E.LAMP_Y, lz)  # Ry keeps the centre; rotation is about the part origin
        check(f"lamp-centre-{kind}-{lz}", close((m[1], m[2]), (E.LAMP_Y, lz), 1e-9), f"{m}")
marm = max(abs(l[2]) + s[2] / 2 for n, l, s in E.addon_boxes() if "MirrorArm" in n)
check("mirror-arm<=1.02", marm <= 1.02 + 1e-9, f"{marm:.4f}")
check("mirror-arm<prior-1.075", marm < 1.075 - 1e-9, f"{marm:.4f}")
mhead = max(abs(0.970) + 0.050 for n, l, r, d, nn, rot in E.addon_cylinders() if "MirrorHead" in n)
check("mirror-head<=1.02", mhead <= 1.02 + 1e-9, f"{mhead:.4f}")
px = max(abs(l[0]) + s[0] / 2 for n, l, s in E.addon_boxes() if "Plate" in n or "Bumper" in n)
check("plates-bumpers<=2.51", px <= 2.51 + 1e-9, f"{px:.4f}")
for n, l, s in E.addon_boxes():
    e = E.check_box_outward(l, s, n)
    check(f"box-outward-{n}", not e, "; ".join(e))
v, f = E.cyl_z_local(0.34, 0.22, 28)
n = 28
ok = True
for fa in f[:n]:
    v0, v1, v2 = v[fa[0]], v[fa[1]], v[fa[2]]
    nn = E.face_normal(v0, v1, v2)
    ctr = tuple(sum(v[i][k] for i in fa) / len(fa) for k in range(3))
    if nn[0] * ctr[0] + nn[1] * ctr[1] <= 0:
        ok = False
check("cyl-sides-outward", ok)
nn_errs = 0
for fa in hf:
    nn = E.face_normal(hv[fa[0]], hv[fa[1]], hv[fa[2]])
    if nn[0] * nn[0] + nn[1] * nn[1] + nn[2] * nn[2] < 1e-12:
        nn_errs += 1
check("hull-normals-nondegenerate", nn_errs == 0, f"{nn_errs}")

# ---- stale-vs-fixed transform model: reproduces root's exact 1105 numbers ----
# Old recipe read matrix_world before view_layer.update() (stale identity), so
# ROLL premultiplied from identity and every cylinder baked at the origin.
# Fixed recipe evaluates first (or bakes TRS then rolls mesh data).
tv, _ = E.cyl_z_local(E.TUB_R, 0.04, 20)
tloc = (E.WHEEL_XS[0], E.TUB_Y, E.WHEEL_Z - 0.16)
stale_min_z = min(E.roll_x90_pt(p)[2] for p in tv)
fixed_min_z = min(E.roll_x90_pt((p[0] + tloc[0], p[1] + tloc[1], p[2] + tloc[2]))[2] for p in tv)
print(f"STALE tub z-min={stale_min_z:.4f} FIXED tub z-min={fixed_min_z:.4f} (root saw -0.360)")
check("stale-reproduces-root-minus-0.36", abs(stale_min_z - (-E.TUB_R)) < 1e-9, f"{stale_min_z:.4f}")
check("fixed-tub-above-floor", fixed_min_z >= -0.03 - 1e-9, f"{fixed_min_z:.4f}")
check("fixed-tub-bottom-0.12", abs(fixed_min_z - (E.TUB_Y - E.TUB_R)) < 1e-9, f"{fixed_min_z:.4f}")
lv, _ = E.cyl_z_local(0.100, 0.05, 16)
lloc = (2.34, E.LAMP_Y, E.LAMP_ZS[0])
stale_lamp_c = E.roll_x90_pt((0.0, 0.0, 0.0))
fixed_lamp_c = E.roll_x90_pt(lloc)
check("stale-lamp-collapses-to-origin",
      close(stale_lamp_c, (0.0, 0.0, 0.0), 1e-9), f"{stale_lamp_c}")
check("fixed-lamp-centre-survives-roll",
      close(fixed_lamp_c, (2.34, -E.LAMP_ZS[0], E.LAMP_Y), 1e-9), f"{fixed_lamp_c}")
box_max_y = max(abs(l[2]) + s[2] / 2
                for n, l, s in E.addon_boxes() + E.lug_boxes() + E.trim_boxes())
print(f"BOX-ONLY width outer={box_max_y:.4f} (root saw 0.990) FIXED outer=1.020")
check("stale-width-is-box-only-0.99", abs(box_max_y - 0.99) < 1e-9, f"{box_max_y:.4f}")
check("fixed-width-keeps-mirror-head", abs(mhead - 1.02) < 1e-9, f"{mhead:.4f}")

# ---- consolidation accounting: mirror of the recipe's material ownership ----
GROUPS = {m: 0 for m in E.MATERIALS}


def mat_for_box(n):
    if 'GrilleBack' in n or 'Belly' in n or 'MirrorArm' in n:
        return 'SedanTrimDark'
    if 'Cream' in n or 'Plate' in n:
        return 'SedanCream'
    return 'SedanChrome'


def mat_for_cyl(n):
    if 'Dome' in n or 'Bezel' in n or 'Dagmar' in n or 'Exhaust' in n or 'MirrorHead' in n:
        return 'SedanChrome'
    if 'Wall' in n:
        return 'SedanCream'
    if 'Lens' in n:
        return 'SedanGlass' if 'Head' in n else 'SedanSignalRed'
    if 'TailSock' in n:
        return 'SedanChrome'
    return 'SedanTrimDark'


GROUPS['SedanBody'] += E.tri_count(hf + hogf + trgf + archf + finf)
GROUPS['SedanCream'] += E.tri_count(rooff)
GROUPS['SedanGlass'] += E.tri_count(wsgf + rwgf) + 4  # side-glass strip: 2 quads -> 4 tris
for _n, _l, _s in E.addon_boxes():
    _, _f = E.box_world(_l, _s)
    GROUPS[mat_for_box(_n)] += E.tri_count(_f)
for _n, _l, _r, _d, _nn, _rot in E.addon_cylinders():
    if _rot:
        _v, _f = E.cyl_z_local(_r, _d, _nn)
    else:
        _, _f = E.cyl_z_world(_l, _r, _d, _nn)
    GROUPS[mat_for_cyl(_n)] += E.tri_count(_f)
for _n, _l, _s in E.lug_boxes():
    _, _f = E.box_world(_l, _s)
    GROUPS['SedanChrome'] += E.tri_count(_f)
for _n, _l, _s in E.trim_boxes():
    _, _f = E.box_world(_l, _s)
    GROUPS['SedanBody' if 'Pillar' in _n else 'SedanChrome'] += E.tri_count(_f)
print("MATGROUPS " + " ".join(f"{k}={v}" for k, v in GROUPS.items()))
check("joins-nonempty-6", all(v > 0 for v in GROUPS.values()), str(GROUPS))
check("joins-draws<=6", len([v for v in GROUPS.values() if v > 0]) <= 6, str(GROUPS))
check("joins-draws==6", len([v for v in GROUPS.values() if v > 0]) == 6, str(GROUPS))
check("joins-tris-match", sum(GROUPS.values()) == tris, f"{sum(GROUPS.values())} vs {tris}")

# ---- negatives: the tripwires that must stay loud ----
DISP = 1e-5
check("neg-wheel-10x-fails", not close((1.52 + DISP, 0.34, 0.86), (1.52, 0.34, 0.86), TOL_M))
check("neg-lamp-10x-fails", not close((0.64 + DISP, 0.62), (0.64, 0.62), TOL_M))
check("neg-rot-10x-fails", not close((0.0, math.pi / 2 + DISP, 0.0), (0.0, math.pi / 2, 0.0), TOL_R))
big = [[(x, y, z * 1.10) for (x, y, z) in s] for s in sets]
_, _, e2 = E.check_authored(big)
check("neg-oversize-fails", bool(e2), "oversize passed")
OLD_F = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
v, _ = E.box_local((0.2, 0.2, 0.2))
inw = 0
for fa in OLD_F:
    nn = E.face_normal(v[fa[0]], v[fa[1]], v[fa[2]])
    ctr = tuple(sum(v[i][k] for i in fa) / len(fa) for k in range(3))
    if nn[0] * ctr[0] + nn[1] * ctr[1] + nn[2] * ctr[2] <= 0:
        inw += 1
check("neg-reversed-box-fails", inw == 6, f"{inw}/6 inward (want 6)")

code = (LANE / "build_sedan_envelope_muse_1117.py").read_text(encoding="utf-8")
for needle in ("SEDAN_ENVELOPE_MUSE_1117", "sedan-envelope-muse-1117.glb",
               "import envelope as E", "view_layer.update()",
               "eval_centre", "BEFORE evaluate", "AFTER-bake", "AFTER-roll",
               "data.transform(", "transform_apply(location=True",
               "ops.object.join", "tris", "len(bpy.data.materials)", "tris<=14000"):
    check(f"gate-kept:{needle[:30]}", needle.replace(" ", "") in code.replace(" ", ""), needle)
check("no-stale-prefix", "CAR_BODY_BAKE_REPAIR" not in code)
check("no-baked-loc", "cx + r * math.cos" not in code)
check("unique-output", "sedan-envelope-muse-1117.glb" in code)
check("no-old-output", "sedan-envelope-muse-1105.glb" not in code)
print(f"\nTotal: {len(fails)} failed")
sys.exit(1 if fails else 0)
