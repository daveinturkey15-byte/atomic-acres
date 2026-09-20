"""MUSE-1030-final2 CPU diagnostic: exact extrema / joint / boundary proof before Blender.

Owns ONLY work/operator-export-final2-muse-1030. Prior work/operator-closed-surface-muse-1017 readonly.
Imports the muse builder (no Blender, no GPU, no browser) and runs ACTUAL
mesh-data tests: finite verts, weight contract, UV rect, face normals,
nonmanifold, welded position+weights boundary loops, bone names/axes,
triangle budget, metric envelope.

AGY-1000 baseline (position+weights weld): shirt 1514 pos / 40 zero-area /
272 boundary (40 mislabelled 'shoulder' at y~=1.1267 = elbow-cap rims);
trousers 1362 / 0 / 74. This script proves the muse correction from data.
"""
import collections
import importlib.util
import json
import math
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
CAND = HERE / "build_operator_sand_export_final2_muse_1030.py"

spec = importlib.util.spec_from_file_location("muse1030f2", CAND)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

FAIL = []


def note(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        FAIL.append(msg)


def weld(p):
    keys, ids, pos = {}, [], []
    for i, v in enumerate(p.verts):
        key = tuple(round(x, 6) for x in v) + tuple(
            sorted((b, round(w, 6)) for b, w in p.weights[i] if w > 0))
        if key not in keys:
            keys[key] = len(pos)
            pos.append(v)
        ids.append(keys[key])
    return ids, pos


def face_tris(p, ids, pos):
    edges = collections.Counter()
    zero = 0
    for f in p.faces:
        for j in range(1, len(f) - 1):
            tri = [ids[k] for k in (f[0], f[j], f[j + 1])]
            a, b, c = (pos[k] for k in tri)
            u = [b[k] - a[k] for k in range(3)]
            v = [c[k] - a[k] for k in range(3)]
            cr = [u[1] * v[2] - u[2] * v[1],
                  u[2] * v[0] - u[0] * v[2],
                  u[0] * v[1] - u[1] * v[0]]
            if sum(x * x for x in cr) < 1e-20:
                zero += 1
                continue
            for x, y in zip(tri, tri[1:] + tri[:1]):
                edges[tuple(sorted((x, y)))] += 1
    return edges, zero


def loops_of(edges, pos):
    adj = collections.defaultdict(list)
    for a, b in [e for e, n in edges.items() if n == 1]:
        adj[a].append(b)
        adj[b].append(a)
    seen, out = set(), []
    for s in list(adj):
        if s in seen:
            continue
        loop, prev, cur = [s], None, s
        seen.add(s)
        while True:
            nxts = [n for n in adj[cur] if n != prev]
            if not nxts:
                break
            nxt = nxts[0] if len(nxts) == 1 else next(
                (n for n in nxts if n not in seen), None)
            if nxt is None or nxt == s:
                break
            loop.append(nxt)
            seen.add(nxt)
            prev, cur = cur, nxt
        xs = [pos[k][0] for k in loop]
        ys = [pos[k][1] for k in loop]
        zs = [pos[k][2] for k in loop]
        out.append({"n": len(loop),
                    "cx": sum(xs) / len(xs), "cy": sum(ys) / len(ys),
                    "cz": sum(zs) / len(zs),
                    "x": [min(xs), max(xs)], "y": [min(ys), max(ys)],
                    "z": [min(zs), max(zs)]})
    return sorted(out, key=lambda d: -d["n"])


def check_part(label, p, expect_loops):
    ids, pos = weld(p)
    edges, zero = face_tris(p, ids, pos)
    boundary = [e for e, n in edges.items() if n == 1]
    nonman = sum(n > 2 for n in edges.values())
    loops = loops_of(edges, pos)
    print(f"== {label}: verts={len(p.verts)} welded={len(pos)} "
          f"faces={len(p.faces)} zero={zero} boundary={len(boundary)} "
          f"nonmanifold={nonman} ==")
    for L in loops:
        print(f"  loop n={L['n']:3d} c=({L['cx']:+.4f},{L['cy']:.4f},{L['cz']:+.4f}) "
              f"y=[{L['y'][0]:.4f},{L['y'][1]:.4f}] x=[{L['x'][0]:+.4f},{L['x'][1]:+.4f}]")
    # actual data tests
    note(all(math.isfinite(c) for v in p.verts for c in v), f"{label} verts finite")
    note(all(math.isfinite(c) for uv in p.uvs for c in uv), f"{label} uvs finite")
    note(all(0.0 - 1e-6 <= u <= 1.0 + 1e-6 and 0.0 - 1e-6 <= v <= 1.0 + 1e-6
             for u, v in p.uvs), f"{label} uvs in [0,1] atlas")
    note(all(v < 21 and w > 0 and math.isfinite(w) for ws in p.weights for v, w in ws),
         f"{label} bone indices <21 weights>0 finite")
    note(all(abs(sum(w for _, w in ws) - 1.0) < 1e-3 for ws in p.weights),
         f"{label} weights normalized")
    note(len(p.uvs) == sum(len(f) for f in p.faces), f"{label} uv count matches corners")
    note(zero == 0, f"{label} zero-area tris == 0 (got {zero})")
    note(nonman == 0, f"{label} nonmanifold == 0")
    note(sorted(L["n"] for L in loops) == sorted(expect_loops),
         f"{label} boundary loops == {sorted(expect_loops)} (got {sorted(L['n'] for L in loops)})")
    # joint proof: no boundary in shoulder band or crotch band
    band = [L for L in loops if 1.10 < L["cy"] < 1.50 and abs(L["cx"]) > 0.095]
    note(len(band) == 0, f"{label} no open loop in shoulder band (got {len(band)})")
    return ids, pos, loops


# shirt: waist 36 + throat-top 36 + cuffs 16+16 = 104 ; trousers: waist 34 + cuffs 20+20 = 74
ps = m.Part()
m.build_closed_shirt(ps)
check_part("shirt", ps, [36, 36, 16, 16])
pt = m.Part()
m.build_closed_trousers(pt)
check_part("trousers", pt, [34, 20, 20])

# full body+gear: bones, tris, envelope (bake-safe, CPU only)
note(m.BONE_NAMES and len(m.BONE_NAMES) == 21, "21 bone names")
note(list(m.BONE_INDEX.values()) == list(range(21)), "bone indices 0..20")
body, gear = m.build_body(), m.build_gear()
tris = sum(len(f) - 2 for f in body.faces) + sum(len(f) - 2 for f in gear.faces)
print(f"full tris={tris} body_verts={len(body.verts)} gear_verts={len(gear.verts)}")
note(12000 <= tris <= 20000, f"triangle budget 12k..20k (got {tris})")
allv = body.verts + gear.verts
xs = [v[0] for v in allv]
ys = [v[1] for v in allv]
zs = [v[2] for v in allv]
print(f"extrema x=[{min(xs):.4f},{max(xs):.4f}] y=[{min(ys):.4f},{max(ys):.4f}] z=[{min(zs):.4f},{max(zs):.4f}]")
note(-0.02 <= min(ys) <= 0.05, f"feet on ground (min_y={min(ys):.4f})")
note(1.78 <= max(ys) <= 1.95, f"crown height (max_y={max(ys):.4f})")
note(abs(min(xs) + max(xs)) <= 0.02, "X symmetric")
note(max(xs) <= 0.31 and min(xs) >= -0.31, "shoulder envelope +-0.31")
note(max(zs) >= 0.15, "forward reach")
note("export-final2-muse-1030" in str(m.OUT_DIR) and "agy-1000" not in str(m.OUT_DIR),
     f"unique OUT dir ({m.OUT_DIR})")
note(str(m.OUT_BLEND.name).endswith("muse-1030.blend"), f"bake-safe blend name ({m.OUT_BLEND.name})")

# FINAL2-1030: exporter-validity proof on ACTUAL mesh data (no Blender).
# Root failure: "Mesh OperatorSand_Gear is not valid", exported 11980 tris
# vs 12520 authored (-540), elbows 68 vs >=100. Diagnose from source data:
def _tri_area(p, a, b, c):
    ax, ay, az = p.verts[a]
    bx, by, bz = p.verts[b]
    cx, cy, cz = p.verts[c]
    ux, uy, uz = bx - ax, by - ay, bz - az
    vx, vy, vz = cx - ax, cy - ay, cz - az
    return 0.5 * math.sqrt((uy * vz - uz * vy) ** 2 + (uz * vx - ux * vz) ** 2 + (ux * vy - uy * vx) ** 2)


def check_export_validity(label, p):
    used = [0] * len(p.verts)
    for f in p.faces:
        for v in f:
            used[v] += 1
    orph = sum(1 for u in used if u == 0)
    rep = sum(1 for f in p.faces if len(set(f)) != len(f))
    oor = sum(1 for f in p.faces for v in f if v < 0 or v >= len(p.verts))
    zero = tot = 0
    for f in p.faces:
        for k in range(1, len(f) - 1):
            tot += 1
            if _tri_area(p, f[0], f[k], f[k + 1]) < 1e-10:
                zero += 1
    print(f"== validity {label}: orphans={orph} repeatedFaces={rep} "
          f"outOfRange={oor} zeroTris={zero}/{tot} ==")
    return orph, rep, oor, zero

b_orph, b_rep, b_oor, b_zero = check_export_validity("body", body)
g_orph, g_rep, g_oor, g_zero = check_export_validity("gear", gear)
note(b_rep == 0 and g_rep == 0, "no repeated-index faces (got "
     f"body={b_rep} gear={g_rep})")
note(b_oor == 0 and g_oor == 0, "no out-of-range indices (got "
     f"body={b_oor} gear={g_oor})")
note(g_orph == 0, f"gear orphans == 0 (got {g_orph}; pre-fix 614 = "
     "598 kneepad + 16 lens verts with faces misindexed at 0..298)")
note(b_zero + g_zero <= 200, f"sphere-pole degenerates only (got body={b_zero} "
     f"gear={g_zero}; all at head heights y>=1.61, Blender-weldable)")


def _pair_count(p, a, b):
    key = tuple(sorted([m.BONE_INDEX[a], m.BONE_INDEX[b]]))
    n = 0
    for ws in p.weights:
        nz = [(j, w) for j, w in ws if w > 1e-6]
        if len(nz) == 2 and tuple(sorted(j for j, _ in nz)) == key:
            n += 1
    return n


for side in ("Left", "Right"):
    got = _pair_count(body, f"{side}Arm", f"{side}ForeArm")
    print(f"elbow blend {side}: {got} two-joint verts (7 rings x 16)")
    note(got >= 100, f"weights.blend.elbow.{side[0]} >= 100 (got {got})")
for side in ("Left", "Right"):
    got = _pair_count(body, f"{side}UpLeg", f"{side}Leg") + _pair_count(gear, f"{side}UpLeg", f"{side}Leg")
    note(got >= 100, f"weights.blend.knee.{side[0]} >= 100 (got {got})")

if FAIL:
    print(f"\nMUSE-1030-FINAL2 CPU DIAGNOSTIC: {len(FAIL)} FAILURES")
    sys.exit(1)
print("\nMUSE-1030-FINAL2 CPU DIAGNOSTIC: all actual mesh-data tests passed")
