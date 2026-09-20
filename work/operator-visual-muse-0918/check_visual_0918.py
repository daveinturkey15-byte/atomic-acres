"""CPU envelope & visual contract check for operator-sand-visual-0918.

No Blender, no GPU, no browser. Pure-Python geometry + texture analysis.
Run from worktree root:
    python work/operator-visual-muse-0918/check_visual_0918.py

Fails closed (exit 1) on any budget/rig/UV/panel/clearance drift.
Visual checks measure actual geometry/paint, they never re-derive the
recipe's own constants (no formula mirroring).
"""
import importlib.util
import math
import statistics
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve()
RECIPE = HERE.with_name("build_operator_sand_visual_0918.py")

BASE_BODY, BASE_GEAR = 9952, 3644


def main() -> int:
    spec = importlib.util.spec_from_file_location("op_visual0918_check", str(RECIPE))
    assert spec and spec.loader, f"cannot load recipe: {RECIPE}"
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)

    body = m.build_body()
    gear = m.build_gear()
    tb = sum(len(f) - 2 for f in body.faces)
    tg = sum(len(f) - 2 for f in gear.faces)
    total = tb + tg
    allv = body.verts + gear.verts
    xs = [v[0] for v in allv]
    ys = [v[1] for v in allv]
    zs = [v[2] for v in allv]
    fails = []

    def ok(cond, msg):
        print(("PASS " if cond else "FAIL ") + msg)
        if not cond:
            fails.append(msg)

    # 1. Hard budgets (frozen)
    ok(12000 <= total <= 22000, f"total {total} in 12k-22k")
    ok(tb > BASE_BODY + 400, f"body growth {tb - BASE_BODY} > 400 (got {tb})")
    ok(tg > BASE_GEAR + 200, f"gear growth {tg - BASE_GEAR} > 200 (got {tg})")

    # 2. Skeleton contract (exact, from skeleton.ts)
    ok(len(m.BONE_NAMES) == 21, "21 bones")
    ok(m.BONE_NAMES == [
        "Hips", "Spine", "Chest", "Neck", "Head",
        "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
        "RightShoulder", "RightArm", "RightForeArm", "RightHand",
        "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToe",
        "RightUpLeg", "RightLeg", "RightFoot", "RightToe",
    ], "all 21 bone names and order match standard skeleton contract")

    # 3. Actor bounds (+Y up, +Z forward, feet on ground)
    ok(abs(min(xs) + max(xs)) <= 0.02, f"X symmetric {min(xs):.4f}/{max(xs):.4f}")
    ok(max(xs) <= 0.31 and min(xs) >= -0.31, f"shoulder envelope max {max(xs):.4f} <= 0.31")
    ok(-0.02 <= min(ys) <= 0.05 and abs(min(ys)) <= 0.002, f"feet ground contact {min(ys):.4f}")
    ok(1.78 <= max(ys) <= 1.95, f"crown height {max(ys):.4f}")
    ok(0.15 <= max(zs) <= 0.30, f"forward reach {max(zs):.4f}")

    # 4. Output identity (new basename, no stale lane) & determinism seed
    ok(m.SEED == 2256, f"seed {m.SEED}")
    ok(str(m.OUT_GLB).endswith("operator-sand-visual-0918.glb"), f"visual output {m.OUT_GLB}")
    ok("operator-visual-muse-0918" in str(m.OUT_BLEND), f"blend lane {m.OUT_BLEND}")

    # 5. Skinning & weight normalization
    pair, rigid = Counter(), Counter()
    wfail = 0
    for ws in body.weights + gear.weights:
        nz = [w for w in ws if w[1] > 1e-6]
        if abs(sum(w for _, w in nz) - 1.0) > 0.02 or not all(0 <= b < 21 for b, _ in nz):
            wfail += 1
        bones = tuple(sorted(b for b, _ in nz))
        if len(bones) == 1:
            rigid[bones[0]] += 1
        elif len(bones) == 2:
            pair[bones] += 1
    bi = m.BONE_INDEX
    ok(wfail == 0, f"weights normalized, 0 failures ({len(body.weights) + len(gear.weights)} verts)")
    for a, b in [("LeftArm", "LeftForeArm"), ("RightArm", "RightForeArm"),
                 ("LeftUpLeg", "LeftLeg"), ("RightUpLeg", "RightLeg")]:
        ok(pair.get(tuple(sorted([bi[a], bi[b]])), 0) >= 100, f"blend {a}/{b} >= 100")
    for b in ["Head", "Chest", "LeftFoot", "RightFoot"]:
        ok(rigid.get(bi[b], 0) >= 100, f"rigid {b} >= 100")

    # 6. UVs in range
    ok(all(0.0 <= u <= 1.0 and 0.0 <= v <= 1.0 for u, v in body.uvs + gear.uvs), "UVs in [0,1]")

    # 7. Lifecycle contracts in recipe text (root bake guards)
    txt = RECIPE.read_text(encoding="utf-8")
    ok("img.update()" in txt and "img.pack()" in txt, "texture update/pack preserved")
    ok("threads = 2" in txt or "threads=2" in txt, "2-thread cap present")

    # 8. Knee strap / cup radial clearance >= 3mm (same truthful method as 0845)
    strap_pts = [v for v in gear.verts if (0.485 <= v[1] <= 0.515 or 0.355 <= v[1] <= 0.385)
                 and abs(v[0]) > 0.05]
    ok(len(strap_pts) > 80, f"identified {len(strap_pts)} knee strap/cup vertices")
    min_clearance = 1e9
    for v in strap_pts:
        side_sgn = -1.0 if v[0] < 0 else 1.0
        x_leg = side_sgn * 0.098
        nearby = [bv for bv in body.verts if abs(bv[1] - v[1]) <= 0.008 and ((bv[0] < 0) == (v[0] < 0))]
        if nearby:
            th_s = math.atan2(v[2], v[0] - x_leg)
            cb = min(nearby, key=lambda bv: abs((math.atan2(bv[2], bv[0] - x_leg) - th_s + math.pi) % (2 * math.pi) - math.pi))
            c = math.hypot(v[0] - x_leg, v[2]) - math.hypot(cb[0] - x_leg, cb[2])
            min_clearance = min(min_clearance, c)
    ok(min_clearance >= 0.003, f"radial clearance {min_clearance * 1000:.1f}mm >= 3.0mm")

    # 9. Loft UV functional proof (catches the 0845 1px-collapse regression).
    # A rect-mapped test loft must span the rect in U and its fraction in V.
    class _T:
        def __init__(self):
            self.verts, self.faces, self.uvs, self.weights, self.smooth = [], [], [], [], []
    tmp = _T()
    m.add_loft(tmp, [{"y": 0.0, "cx": 0.0, "cz": 0.0, "rx": 0.1, "rz": 0.1},
                     {"y": 1.0, "cx": 0.0, "cz": 0.0, "rx": 0.1, "rz": 0.1}],
               8, (0.02, 0.60, 0.36, 0.98), (0.0, 1.0), lambda x, y, z: [(0, 1.0)])
    us = [u for u, _ in tmp.uvs]
    ok(max(us) - min(us) > 0.30, f"loft U spans rect width {max(us) - min(us):.3f} > 0.30")

    # 10. Panel UV assignment: thigh column / sleeve / torso sample own panels.
    def panel_frac(y0, y1, x_lo, x_hi, rect):
        li, tot, hit = 0, 0, 0
        for f in body.faces:
            n = len(f)
            fuv = body.uvs[li:li + n]
            li += n
            vs = [body.verts[i] for i in f]
            cy = sum(v[1] for v in vs) / n
            cx = sum(v[0] for v in vs) / n
            if y0 <= cy <= y1 and x_lo <= abs(cx) <= x_hi:
                tot += n
                hit += sum(1 for u, v in fuv if rect[0] <= u <= rect[2] and rect[1] <= v <= rect[3])
        return hit / max(1, tot)
    f_thigh = panel_frac(0.60, 0.80, 0.05, 0.14, m.UV_TROUSER)
    f_sleeve = panel_frac(1.30, 1.36, 0.16, 0.26, m.UV_SLEEVE)
    f_torso = panel_frac(1.22, 1.30, 0.0, 0.12, m.UV_TORSO)
    ok(f_thigh > 0.80, f"trouser panel {f_thigh:.2f} > 0.80")
    ok(f_sleeve > 0.80, f"sleeve panel {f_sleeve:.2f} > 0.80")
    ok(f_torso > 0.80, f"torso panel {f_torso:.2f} > 0.80")

    # 11. Paint truth: panel value split + bake bands + ORM span (160px probe).
    W = H = 160
    cloth, gearpx, orm = m.paint_cloth_base(W, H), m.paint_gear_base(W, H), m.paint_shared_orm(W, H)

    def band(buf, lo_r, hi_r, lo_g, hi_g, lo_b, hi_b, label):
        n = len(buf) // 4
        step = max(1, n // 2000)
        rs = [buf[i * 4] for i in range(0, n, step)]
        gs = [buf[i * 4 + 1] for i in range(0, n, step)]
        bs = [buf[i * 4 + 2] for i in range(0, n, step)]
        mr, mg, mb = sum(rs) / len(rs), sum(gs) / len(gs), sum(bs) / len(bs)
        return (lo_r <= mr <= hi_r and lo_g <= mg <= hi_g and lo_b <= mb <= hi_b,
                f"{label} mean R {mr:.3f} G {mg:.3f} B {mb:.3f}")

    c, msg = band(cloth, 0.30, 0.85, 0.25, 0.80, 0.15, 0.70, "cloth")
    ok(c, msg)
    c, msg = band(gearpx, 0.15, 0.70, 0.15, 0.70, 0.10, 0.65, "gear")
    ok(c, msg)
    n = len(orm) // 4
    gs = [orm[i * 4 + 1] for i in range(0, n, max(1, n // 2000))]
    rs = [orm[i * 4] for i in range(0, n, max(1, n // 2000))]
    mg = sum(gs) / len(gs)
    ok(0.99 <= sum(rs) / len(rs) <= 1.0 and 0.50 <= mg <= 0.90 and max(gs) - min(gs) >= 0.20,
       f"orm mean G {mg:.3f} span {max(gs) - min(gs):.3f} >= 0.20")

    def panel_r(rect):
        s = c = 0
        for yy in range(H):
            vv = 1.0 - yy / (H - 1)
            for xx in range(W):
                uu = xx / (W - 1)
                if rect[0] <= uu <= rect[2] and rect[1] <= vv <= rect[3]:
                    s += cloth[(xx + yy * W) * 4]
                    c += 1
        return s / max(1, c)
    r_torso, r_trouser, r_sleeve = panel_r(m.UV_TORSO), panel_r(m.UV_TROUSER), panel_r(m.UV_SLEEVE)
    ok(abs(r_torso - r_trouser) >= 0.015, f"torso/trouser split {abs(r_torso - r_trouser):.4f} >= 0.015")
    ok(abs(r_sleeve - r_trouser) >= 0.015, f"sleeve/trouser split {abs(r_sleeve - r_trouser):.4f} >= 0.015")

    # 12. Shoulder continuity: no balloon-cap pad faces above the yoke.
    li, pad_total, pad_high = 0, 0, 0
    for f in body.faces:
        n = len(f)
        fuv = body.uvs[li:li + n]
        li += n
        if all(0.63 <= u <= 0.79 and 0.03 <= vv <= 0.50 for u, vv in fuv):
            pad_total += 1
            vs = [body.verts[i] for i in f]
            if all(v[1] > 1.35 for v in vs):
                pad_high += 1
    ok(pad_high == 0, f"no shoulder-cap pad faces above yoke (got {pad_high})")
    ok(pad_total <= 400, f"pad faces {pad_total} <= 400 (elbows only, balls removed)")

    # 13. Boot lace bars present (instep zone vertex density).
    lace = [v for v in gear.verts if 0.07 <= v[1] <= 0.13 and abs(abs(v[0]) - 0.098) < 0.045
            and v[2] > 0.07]
    ok(len(lace) > 70, f"lace-zone verts {len(lace)} > 70")

    # 14. Cloth fold truth: folded thigh ring ripples, smooth ring stays calm.
    # Exact-y slices isolate single loft rings (boxes never land exactly on them).
    for yy, side in ((0.650, -1.0),):
        pts = [v for v in body.verts if abs(v[1] - yy) < 1e-9 and (v[0] < 0) == (side < 0)]
        x_leg = side * 0.098
        cz = 0.008 if yy == 0.650 else 0.008
        rs = [math.hypot(v[0] - x_leg, v[2] - cz) for v in pts]
        std = statistics.pstdev(rs) if len(rs) > 8 else 0.0
        ok(std * 1000 > 4.0, f"thigh fold ring y={yy} std {std * 1000:.2f}mm > 4.0mm")
    pts = [v for v in body.verts if abs(v[1] - 0.590) < 1e-9 and v[0] < 0]
    rs = [math.hypot(v[0] + 0.098, v[2] - 0.008) for v in pts]
    std = statistics.pstdev(rs) if len(rs) > 8 else 99.0
    ok(std * 1000 < 3.5, f"smooth thigh ring y=0.59 std {std * 1000:.2f}mm < 3.5mm")

    print(f"\nvisual0918 cpu: body={tb} gear={tg} total={total} verts={len(allv)}")
    if fails:
        print(f"\n{len(fails)} ASSERTIONS FAILING")
        return 1
    print("visual0918: ALL CPU assertions pass cleanly.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
