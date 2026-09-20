"""CPU envelope & visual contract check for operator-sand-anatomy-0845.

No Blender, no GPU, no browser required. Pure-Python geometry analysis.
Run from worktree root:
    python work/operator-anatomy-0845/check_anatomy_0845.py

Fails closed (exit 1) on any budget/rig/symmetry/clearance drift.
"""
import importlib.util
import math
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve()
RECIPE = HERE.with_name("build_operator_sand_anatomy_0845.py")

BASE_BODY, BASE_GEAR, BASE_TOTAL = 9952, 3644, 13596


def main() -> int:
    spec = importlib.util.spec_from_file_location("op_anatomy_check", str(RECIPE))
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
        status = "PASS " if cond else "FAIL "
        print(status + msg)
        if not cond:
            fails.append(msg)

    # 1. Budget bounds
    ok(12000 <= total <= 22000, f"total {total} in 12k-22k")
    ok(14000 <= total <= 19000, f"anatomy band {total} in 14k-19k")
    ok(tb > BASE_BODY + 400, f"body growth {tb - BASE_BODY} > 400 (got {tb})")
    ok(tg > BASE_GEAR + 200, f"gear growth {tg - BASE_GEAR} > 200 (got {tg})")

    # 2. Skeleton contract
    ok(len(m.BONE_NAMES) == 21, "21 bones")
    ok(m.BONE_NAMES[0] == "Hips" and m.BONE_NAMES[-1] == "RightToe", "bone order ends intact")
    ok(m.BONE_NAMES == [
        "Hips", "Spine", "Chest", "Neck", "Head",
        "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
        "RightShoulder", "RightArm", "RightForeArm", "RightHand",
        "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToe",
        "RightUpLeg", "RightLeg", "RightFoot", "RightToe",
    ], "all 21 bone names and order match standard skeleton contract")

    # 3. Actor bounds
    ok(abs(min(xs) + max(xs)) <= 0.02, f"X symmetric {min(xs):.4f}/{max(xs):.4f}")
    ok(max(xs) <= 0.31 and min(xs) >= -0.31, f"shoulder envelope max {max(xs):.4f} <= 0.31")
    ok(-0.02 <= min(ys) <= 0.05 and abs(min(ys)) <= 0.002, f"feet ground contact {min(ys):.4f}")
    ok(1.78 <= max(ys) <= 1.95, f"crown height {max(ys):.4f}")
    ok(0.15 <= max(zs) <= 0.30, f"forward reach {max(zs):.4f}")

    # 4. Output targets & seed
    ok(m.SEED == 2256, f"seed {m.SEED}")
    ok(str(m.OUT_GLB).endswith("operator-sand-anatomy-0845.glb"), f"canary output {m.OUT_GLB}")
    ok("operator-anatomy-0845" in str(m.OUT_BLEND), f"blend lane {m.OUT_BLEND}")

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
        got = pair.get(tuple(sorted([bi[a], bi[b]])), 0)
        ok(got >= 100, f"blend {a}/{b} {got} >= 100")
    for b in ["Head", "Chest", "LeftFoot", "RightFoot"]:
        ok(rigid.get(bi[b], 0) >= 100, f"rigid {b} {rigid.get(bi[b], 0)} >= 100")

    # 6. UV coordinate bounds
    ok(all(0.0 <= u <= 1.0 and 0.0 <= v <= 1.0 for u, v in body.uvs + gear.uvs), "UVs in [0,1]")

    # 7. Lifecycle contracts in recipe text
    txt = RECIPE.read_text(encoding="utf-8")
    ok("img.update()" in txt and "img.pack()" in txt, "texture-repair update/pack preserved")
    ok('threads = 2' in txt or 'threads=2' in txt, "2-thread cap present")

    # 8. Kneepad & Strap clearance test (eliminates z-fighting and intersections)
    # Find trouser vertices around knee heights y in [0.35, 0.52] and verify
    # that knee strap vertices maintain positive clearance (> 2mm) proud of the trouser mesh.
    strap_pts = [v for v in gear.verts if (0.485 <= v[1] <= 0.515 or 0.355 <= v[1] <= 0.385) and abs(v[0]) > 0.05]
    ok(len(strap_pts) > 80, f"identified {len(strap_pts)} knee strap vertices")

    cup_pts = [v for v in gear.verts if 0.390 <= v[1] <= 0.490 and v[2] > 0.03 and abs(v[0]) > 0.05]
    ok(len(cup_pts) > 100, f"identified {len(cup_pts)} kneepad cup vertices")

    # Verify kneepads and straps use blended knee weights (not rigid shin!)
    # Gear verts in knee region must have LeftUpLeg or RightUpLeg influence when y > 0.44
    upper_knee_gear_blend_ok = True
    for vi, v in enumerate(gear.verts):
        if 0.45 <= v[1] <= 0.52 and abs(v[0]) > 0.06:
            ws = gear.weights[vi]
            has_upleg = any(b in (bi["LeftUpLeg"], bi["RightUpLeg"]) and w > 0.05 for b, w in ws)
            if not has_upleg:
                upper_knee_gear_blend_ok = False
                break
    ok(upper_knee_gear_blend_ok, "upper kneepad & strap vertices carry UpLeg blend weights (fixes crouch detachment)")
    # 9. Explicit radial clearance verification:
    # Ensure every strap vertex is strictly proud (clearance >= 3mm) of the underlying trouser mesh.
    min_clearance = 1e9
    for v in strap_pts:
        side_sgn = -1.0 if v[0] < 0 else 1.0
        x_leg = side_sgn * 0.098
        # Find nearest body vertices at similar Y
        nearby_body = [bv for bv in body.verts if abs(bv[1] - v[1]) <= 0.008 and ((bv[0] < 0) == (v[0] < 0))]
        if nearby_body:
            # For each nearby body vertex, check ray angle
            th_strap = math.atan2(v[2], v[0] - x_leg)
            # Find closest angular match in body
            closest_b = min(nearby_body, key=lambda bv: abs((math.atan2(bv[2], bv[0] - x_leg) - th_strap + math.pi) % (2 * math.pi) - math.pi))
            r_strap = math.hypot(v[0] - x_leg, v[2])
            r_body = math.hypot(closest_b[0] - x_leg, closest_b[2])
            clearance = r_strap - r_body
            if clearance < min_clearance:
                min_clearance = clearance

    ok(min_clearance >= 0.003, f"knee strap radial clearance {min_clearance * 1000:.1f} mm >= 3.0 mm (zero z-fight)")

    print(f"\nanatomy0845 cpu: body={tb} gear={tg} total={total} verts={len(allv)}")
    if fails:
        print(f"\n{len(fails)} ASSERTIONS FAILING")
        return 1
    print("anatomy0845: ALL CPU assertions pass cleanly.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
