"""Operator Sand CLOSED SURFACE: Coherent closed clothing surface construction.

Owned lane: work/operator-closed-surface-agy-1000/
Root runs controlled bake: 2 threads, <2 GiB, <180s.
No GPU, no browser, no model server required.

Run (root only, Windows):
    "C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe" --background --python work/operator-closed-surface-agy-1000/build_operator_sand_closed_surface.py

Produces:
    work/operator-closed-surface-agy-1000/operator-sand-closed-surface.blend
    work/operator-closed-surface-agy-1000/operator-sand-closed-surface.glb

Architectural Transformation (Elimination of Disconnected Tubular Mannequin):
------------------------------------------------------------------------------
1. Continuous Closed Shirt (Torso-to-Sleeves Branch Welding):
   - Torso and sleeves are authored as ONE topologically continuous surface.
   - Left and Right armscyes (armholes) share exact boundary vertices with sleeve
     rings (ring welding), eliminating disconnected floating tubes, hollow shoulder
     cavities, and ball-joint patch covers.
   - Underarm (axilla) forms a continuous quad gusset between chest/lat and inner
     arm that flexes smoothly under raise/crouch/throw animations.
   - Deliberate neck opening at y=1.515 revealing realistic throat/neck skin
     sock continuing seamlessly into the head/face.
   - Zero geometric boundary edges at the shoulder joint!

2. Continuous Closed Trousers (Pelvis-to-Thigh Branch Join):
   - Pelvis waist descends through shaped gluteal buttocks and groin to y=0.880.
   - Crotch saddle (perineum bridge) connects front fly to posterior seat seam.
   - Continuous branch join splits trunk into two 18-sided leg tubes with shared
     inseam vertices.
   - No interpenetrating spheres, no crotch gap during extreme crouch/sprint.
   - Zero geometric boundary edges at the pelvic-thigh junctions!

3. Preserved Sound Subsystems:
   - 21-bone standard skeleton (src/characters/skeleton.ts contracts).
   - High-fidelity tactical gloves (4 curled fingers, knuckle plate, opposed thumb).
   - Ergonomic helmet, NVG shroud, ARC rails, comms, plate carrier, duty belt.
   - Kneepads offset proud (+6mm) with w_knee joint weighting (zero z-fight/detachment).
   - Combat boots with lugged outsoles, instep wedge, 3 lace bars, ground contact at y=0.

Budgets & Contracts:
--------------------
- Triangles: 12,000 - 20,000 actual triangles (~14.2k target).
- Primitives: Exactly 2 skinned primitives: OperatorSand_Body and OperatorSand_Gear.
- Materials: Exactly 2 materials: Sand_Cloth and Sand_Gear (<=3).
- Embedded Images: Exactly 3 PNGs: Cloth Base 1K, Gear Base 1K, Shared ORM 512 (<=3 1K maps).
- Normals: Real smooth normals throughout.
- UVs: Full-rect atlas mapping (no 1px stripe collapse).
"""

import math
import random
import sys
import time
from pathlib import Path
from collections import defaultdict

THIS = Path(__file__).resolve()
ROOT = THIS.parents[2]
OUT_DIR = ROOT / "work" / "operator-export-final2-muse-1030"
OUT_BLEND = OUT_DIR / "operator-sand-export-final2-muse-1030.blend"
OUT_GLB = OUT_DIR / "operator-sand-export-final2-muse-1030.glb"

SEED = 2256
T0 = time.perf_counter()

# ---------------------------------------------------------------------------
# Standard skeleton contract -- EXACT copy of root src/characters/skeleton.ts.
# Forward is +Z, up is +Y, adult H = 1.78 m.
# ---------------------------------------------------------------------------

BONE_NAMES = [
    "Hips",
    "Spine",
    "Chest",
    "Neck",
    "Head",
    "LeftShoulder",
    "LeftArm",
    "LeftForeArm",
    "LeftHand",
    "RightShoulder",
    "RightArm",
    "RightForeArm",
    "RightHand",
    "LeftUpLeg",
    "LeftLeg",
    "LeftFoot",
    "LeftToe",
    "RightUpLeg",
    "RightLeg",
    "RightFoot",
    "RightToe",
]

BONE_PARENTS = {
    "Hips": None,
    "Spine": "Hips",
    "Chest": "Spine",
    "Neck": "Chest",
    "Head": "Neck",
    "LeftShoulder": "Chest",
    "LeftArm": "LeftShoulder",
    "LeftForeArm": "LeftArm",
    "LeftHand": "LeftForeArm",
    "RightShoulder": "Chest",
    "RightArm": "RightShoulder",
    "RightForeArm": "RightArm",
    "RightHand": "RightForeArm",
    "LeftUpLeg": "Hips",
    "LeftLeg": "LeftUpLeg",
    "LeftFoot": "LeftLeg",
    "LeftToe": "LeftFoot",
    "RightUpLeg": "Hips",
    "RightLeg": "RightUpLeg",
    "RightFoot": "RightLeg",
    "RightToe": "RightFoot",
}

REST_OFFSETS = {
    "Hips": (0.0, 0.877, 0.0),
    "Spine": (0.0, 0.195, 0.0),
    "Chest": (0.0, 0.2, 0.0),
    "Neck": (0.0, 0.27, 0.0),
    "Head": (0.0, 0.14, 0.0),
    "LeftShoulder": (-0.18, 0.18, 0.0),
    "LeftArm": (0.0, -0.02, 0.0),
    "LeftForeArm": (0.0, -0.294, 0.0),
    "LeftHand": (0.0, -0.276, 0.0),
    "RightShoulder": (0.18, 0.18, 0.0),
    "RightArm": (0.0, -0.02, 0.0),
    "RightForeArm": (0.0, -0.294, 0.0),
    "RightHand": (0.0, -0.276, 0.0),
    "LeftUpLeg": (-0.098, 0.0, 0.0),
    "LeftLeg": (0.0, -0.436, 0.0),
    "LeftFoot": (0.0, -0.401, 0.0),
    "LeftToe": (0.0, -0.02, 0.16),
    "RightUpLeg": (0.098, 0.0, 0.0),
    "RightLeg": (0.0, -0.436, 0.0),
    "RightFoot": (0.0, -0.401, 0.0),
    "RightToe": (0.0, -0.02, 0.16),
}

BONE_INDEX = {n: i for i, n in enumerate(BONE_NAMES)}

REST_WORLD = {}
for _name in BONE_NAMES:
    _p = BONE_PARENTS[_name]
    _o = REST_OFFSETS[_name]
    if _p is None:
        REST_WORLD[_name] = list(_o)
    else:
        _pw = REST_WORLD[_p]
        REST_WORLD[_name] = [_pw[i] + _o[i] for i in range(3)]


# ---------------------------------------------------------------------------
# Mesh Data Structure
# ---------------------------------------------------------------------------

class Part:
    def __init__(self):
        self.verts = []      # (x, y, z)
        self.faces = []      # tuples of vertex indices (triangles or quads)
        self.uvs = []        # list of (u, v) per polygon vertex loop
        self.weights = []    # list of [(bone_idx, weight), ...] per vertex
        self.smooth = []     # bool per face


# ---------------------------------------------------------------------------
# Weighting Utilities & Fields
# ---------------------------------------------------------------------------

def rigid(bone):
    return [(BONE_INDEX[bone], 1.0)]


def blend(b1, b2, t):
    t = max(0.0, min(1.0, t))
    i1, i2 = BONE_INDEX[b1], BONE_INDEX[b2]
    w1, w2 = 1.0 - t, t
    if w1 < 1e-4:
        return [(i2, 1.0)]
    if w2 < 1e-4:
        return [(i1, 1.0)]
    return [(i1, round(w1, 4)), (i2, round(w2, 4))]


def _norm_ws(ws):
    tot = sum(w for _, w in ws)
    if tot <= 0:
        return [(0, 1.0)]
    return [(b, w / tot) for b, w in ws]


def w_elbow(side):
    # FINAL2-1030: widen 100mm -> 200mm window centred on the olecranon ring
    # (y=1.138). The 100mm window caught only 4 sleeve rings x 16 = 64
    # Arm+ForeArm verts/side, below the >=100 validator minimum. The 200mm
    # window covers 7 existing sleeve rings (1.22..1.04) = 112 blended
    # verts/side: coherent cloth envelope, zero new triangles, still clear of
    # the Chest/Arm branch above (y>1.24) and the wrist blend below (0.89).
    a, b = f"{side}Arm", f"{side}ForeArm"
    def fn(x, y, z):
        if y > 1.23:
            return rigid(a)
        if y < 1.03:
            return rigid(b)
        return blend(a, b, (1.23 - y) / 0.20)
    return fn


def w_knee(side):
    a, b = f"{side}UpLeg", f"{side}Leg"
    def fn(x, y, z):
        if y > 0.521:
            return rigid(a)
        if y < 0.361:
            return rigid(b)
        return blend(a, b, (0.521 - y) / 0.160)
    return fn


def w_hip(side):
    def fn(x, y, z):
        if y > 0.92:
            return rigid("Hips")
        if y < 0.82:
            return rigid(f"{side}UpLeg")
        return blend("Hips", f"{side}UpLeg", (0.92 - y) / 0.10)
    return fn


def w_ankle(side):
    def fn(x, y, z):
        if y > 0.10:
            return rigid(f"{side}Leg")
        if y < 0.0:
            return rigid(f"{side}Foot")
        return blend(f"{side}Leg", f"{side}Foot", (0.10 - y) / 0.10)
    return fn


def w_wrist(side):
    def fn(x, y, z):
        if y > 0.89:
            return rigid(f"{side}ForeArm")
        if y < 0.83:
            return rigid(f"{side}Hand")
        return blend(f"{side}ForeArm", f"{side}Hand", (0.89 - y) / 0.06)
    return fn


# ---------------------------------------------------------------------------
# UV Atlas Rects (Preserving Muse 0918 unpack contracts)
# ---------------------------------------------------------------------------
UV_FATIGUE = (0.02, 0.02, 0.60, 0.98)
UV_TORSO   = (0.02, 0.60, 0.36, 0.98)     # Jacket torso & collar
UV_TROUSER = (0.02, 0.02, 0.36, 0.55)     # Trousers & pelvis seat
UV_SLEEVE  = (0.38, 0.02, 0.60, 0.98)     # Sleeves & cuffs
UV_FACE    = (0.63, 0.55, 0.79, 0.97)     # Exposed skin face & throat
UV_HAND    = (0.81, 0.55, 0.97, 0.97)     # Hand skin
UV_GLOVE   = (0.81, 0.03, 0.97, 0.50)     # Tactical glove leather
UV_PAD     = (0.63, 0.03, 0.79, 0.50)     # Elbow reinforcement
UV_WEB     = (0.02, 0.02, 0.48, 0.98)     # Tactical webbing & vest
UV_HELM    = (0.52, 0.52, 0.73, 0.97)     # Helmet shell
UV_BOOT    = (0.77, 0.52, 0.97, 0.97)     # Boots leather
UV_SOLE    = (0.52, 0.03, 0.97, 0.48)     # Lugged sole & hardware


# ---------------------------------------------------------------------------
# Primitive Generators: Loft, Box, Sphere
# ---------------------------------------------------------------------------

def add_loft(part, rings, sides, u_range, v_range, wfn,
             cap_top=False, cap_bottom=False, smooth=True):
    """Loft with full rect UV unpacking (Muse 0918 correction retained)."""
    base = len(part.verts)
    nr = len(rings)
    for j, r in enumerate(rings):
        fold = r.get("fold", (0.0, 1.0, 0.0))
        rx_pos = r.get("rx_pos", r.get("rx", 0.0))
        rx_neg = r.get("rx_neg", r.get("rx", 0.0))
        rz_pos = r.get("rz_pos", r.get("rz", 0.0))
        rz_neg = r.get("rz_neg", r.get("rz", 0.0))
        glute = r.get("glute_crease", False)

        for i in range(sides):
            th = 2.0 * math.pi * i / sides
            cos_th = math.cos(th)
            sin_th = math.sin(th)

            cur_rx = rx_pos if cos_th >= 0.0 else rx_neg
            cur_rz = rz_pos if sin_th >= 0.0 else rz_neg

            wob = 1.0 + fold[0] * math.sin(fold[1] * th + fold[2])
            seat_mod = 1.0
            if glute and sin_th < -0.2:
                seat_mod = 1.0 - 0.14 * (1.0 - min(1.0, abs(cos_th) / 0.45)) * (-sin_th)

            x = r["cx"] + cur_rx * wob * cos_th
            z = r["cz"] + cur_rz * wob * sin_th * seat_mod + r.get("bulge_z", 0.0)
            y = r["y"]

            part.verts.append((x, y, z))
            part.weights.append(_norm_ws(wfn(x, y, z)))

    if len(u_range) == 4:
        au0, av0, au1, av1 = u_range
        f0, f1 = v_range
    else:
        au0, au1 = u_range[0], u_range[1]
        av0, av1, f0, f1 = 0.0, 1.0, 0.0, 1.0

    for j in range(nr - 1):
        fj0 = f0 + (f1 - f0) * j / max(1, nr - 1)
        fj1 = f0 + (f1 - f0) * (j + 1) / max(1, nr - 1)
        for i in range(sides):
            a = base + j * sides + i
            b = base + j * sides + (i + 1) % sides
            c = base + (j + 1) * sides + (i + 1) % sides
            d = base + (j + 1) * sides + i
            part.faces.append((a, b, c, d))
            part.smooth.append(smooth)
            u0 = au0 + (au1 - au0) * i / sides
            u1 = au0 + (au1 - au0) * (i + 1) / sides
            vv0 = av0 + (av1 - av0) * fj0
            vv1 = av0 + (av1 - av0) * fj1
            part.uvs.extend([(u0, vv0), (u1, vv0), (u1, vv1), (u0, vv1)])

    for cap, ring_idx, flip in ((cap_bottom, 0, True), (cap_top, nr - 1, False)):
        if not cap:
            continue
        r = rings[ring_idx]
        ci = len(part.verts)
        part.verts.append((r["cx"], r["y"], r["cz"]))
        part.weights.append(_norm_ws(wfn(r["cx"], r["y"], r["cz"])))
        for i in range(sides):
            a = base + ring_idx * sides + i
            b = base + ring_idx * sides + (i + 1) % sides
            f = (ci, b, a) if flip else (ci, a, b)
            part.faces.append(f)
            part.smooth.append(False)
            part.uvs.extend([(0.5, 0.5), (0.0, 0.0), (1.0, 0.0)])


def add_box(part, cx, cy, cz, sx, sy, sz, uv_rect, wfn, smooth=False,
            taper_top=1.0, taper_z=1.0):
    """8-vert box with top and Z tapers for plates and gear."""
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    tt, tz = taper_top, taper_z
    v = [
        (cx - hx, cy - hy, cz - hz),
        (cx + hx, cy - hy, cz - hz),
        (cx + hx, cy - hy, cz + hz * tz),
        (cx - hx, cy - hy, cz + hz * tz),
        (cx - hx * tt, cy + hy, cz - hz),
        (cx + hx * tt, cy + hy, cz - hz),
        (cx + hx * tt, cy + hy, cz + hz * tz * tt),
        (cx - hx * tt, cy + hy, cz + hz * tz * tt),
    ]
    base = len(part.verts)
    for p in v:
        part.verts.append(p)
        part.weights.append(_norm_ws(wfn(*p)))
    quads = [
        (0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1),
        (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0),
    ]
    (u0, v0, u1, v1) = uv_rect
    for q in quads:
        part.faces.append(tuple(base + k for k in q))
        part.smooth.append(smooth)
        part.uvs.extend([(u0, v0), (u1, v0), (u1, v1), (u0, v1)])


def add_sphere(part, cx, cy, cz, r, seg, rings, sx=1.0, sy=1.0, sz=1.0,
               phi0=0.0, phi1=math.pi, uv_rect=(0, 0, 1, 1), wfn=None,
               skip_face=None, deform=None, smooth=True):
    wfn = wfn or (lambda x, y, z: rigid("Head"))
    base = len(part.verts)
    (u0, v0, u1, v1) = uv_rect
    for j in range(rings + 1):
        phi = phi0 + (phi1 - phi0) * j / rings
        for i in range(seg):
            th = 2.0 * math.pi * i / seg
            x = cx + r * sx * math.sin(phi) * math.cos(th)
            y = cy + r * sy * math.cos(phi)
            z = cz + r * sz * math.sin(phi) * math.sin(th)
            if deform:
                x, y, z = deform(x, y, z, phi, th)
            part.verts.append((x, y, z))
            part.weights.append(_norm_ws(wfn(x, y, z)))
    for j in range(rings):
        phi = phi0 + (phi1 - phi0) * (j + 0.5) / rings
        for i in range(seg):
            th = 2.0 * math.pi * (i + 0.5) / seg
            if skip_face and skip_face(phi, th):
                continue
            a = base + j * seg + i
            b = base + j * seg + (i + 1) % seg
            c = base + (j + 1) * seg + (i + 1) % seg
            d = base + (j + 1) * seg + i
            part.faces.append((a, b, c, d))
            part.smooth.append(smooth)
            uu0 = u0 + (u1 - u0) * i / seg
            uu1 = u0 + (u1 - u0) * (i + 1) / seg
            vv0 = v0 + (v1 - v0) * j / rings
            vv1 = v0 + (v1 - v0) * (j + 1) / rings
            part.uvs.extend([(uu0, vv0), (uu1, vv0), (uu1, vv1), (uu0, vv1)])


# ---------------------------------------------------------------------------
# COHERENT CLOSED CLOTHING CONSTRUCTION
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# COHERENT CLOSED CLOTHING CONSTRUCTION
# ---------------------------------------------------------------------------

def build_closed_trousers(p):
    """Continuous closed trouser mesh with shaped pelvis-to-thigh branch joins.

    Waistband starts at y=1.090 and descends through shaped buttocks/groin to
    y=0.880. A continuous crotch saddle bridge (perineum) connects front fly
    to posterior seat seam, branching cleanly into two 20-sided leg tubes.
    Zero geometric boundary edges at the crotch or hip sockets!
    """
    N_pelvis = 34
    u0, v0, u1, v1 = UV_TROUSER

    def w_pelvis(x, y, z):
        if abs(x) < 0.02:
            return rigid("Hips")
        side = "Left" if x < 0 else "Right"
        return w_hip(side)(x, y, z)

    pelvis_rings = [
        {"y": 1.090, "rx": 0.134, "rz": 0.106, "cz": -0.002},
        {"y": 1.060, "rx": 0.133, "rz": 0.109, "cz": -0.003, "glute": True},
        {"y": 1.030, "rx": 0.132, "rz": 0.113, "cz": -0.005, "glute": True},
        {"y": 1.000, "rx": 0.129, "rz": 0.116, "cz": -0.008, "glute": True},
        {"y": 0.970, "rx": 0.126, "rz": 0.117, "cz": -0.009, "glute": True},
        {"y": 0.940, "rx": 0.123, "rz": 0.113, "cz": -0.007, "glute": True},
        {"y": 0.910, "rx": 0.119, "rz": 0.107, "cz": -0.004},
        {"y": 0.880, "rx": 0.115, "rz": 0.100, "cz": -0.001},
    ]

    base_pelvis = len(p.verts)
    n_prings = len(pelvis_rings)
    for j, r in enumerate(pelvis_rings):
        y = r["y"]
        rx, rz = r["rx"], r["rz"]
        cz = r["cz"]
        glute = r.get("glute", False)
        for i in range(N_pelvis):
            th = 2.0 * math.pi * i / N_pelvis
            cos_th = math.cos(th)
            sin_th = math.sin(th)
            seat_mod = 1.0
            if glute and cos_th < -0.2:
                seat_mod = 1.0 + 0.12 * (-cos_th)
            x = -rx * sin_th
            z = cz + rz * cos_th * seat_mod
            p.verts.append((x, y, z))
            p.weights.append(_norm_ws(w_pelvis(x, y, z)))

    # Quads for pelvis trunk
    for j in range(n_prings - 1):
        fj0 = 0.0 + 0.18 * j / (n_prings - 1)
        fj1 = 0.0 + 0.18 * (j + 1) / (n_prings - 1)
        for i in range(N_pelvis):
            a = base_pelvis + j * N_pelvis + i
            b = base_pelvis + j * N_pelvis + (i + 1) % N_pelvis
            c = base_pelvis + (j + 1) * N_pelvis + (i + 1) % N_pelvis
            d = base_pelvis + (j + 1) * N_pelvis + i
            p.faces.append((a, b, c, d))
            p.smooth.append(True)
            uu0 = u0 + (u1 - u0) * i / N_pelvis
            uu1 = u0 + (u1 - u0) * (i + 1) / N_pelvis
            vv0 = v0 + (v1 - v0) * fj0
            vv1 = v0 + (v1 - v0) * fj1
            p.uvs.extend([(uu0, vv0), (uu1, vv0), (uu1, vv1), (uu0, vv1)])

    # Crotch Saddle Perineum Bridge (y=0.865)
    c1_idx = len(p.verts)
    p.verts.append((0.0, 0.865, +0.015))
    p.weights.append(_norm_ws(w_pelvis(0.0, 0.865, +0.015)))

    c2_idx = len(p.verts)
    p.verts.append((0.0, 0.865, -0.015))
    p.weights.append(_norm_ws(w_pelvis(0.0, 0.865, -0.015)))

    base_split = base_pelvis + (n_prings - 1) * N_pelvis
    left_loop = [base_split + i for i in range(18)] + [c2_idx, c1_idx]
    right_loop = [base_split + i for i in range(17, 34)] + [base_split + 0, c1_idx, c2_idx]

    # Continuous Trouser Legs descending to bloused ankles (26 rings x 20 sides)
    thigh_rings = [
        {"y": 0.850, "rx": 0.088, "rz": 0.098, "cz": 0.006},
        {"y": 0.820, "rx": 0.087, "rz": 0.097, "cz": 0.007},
        {"y": 0.790, "rx": 0.086, "rz": 0.096, "cz": 0.008, "fold": (0.045, 6.0, 0.4)},
        {"y": 0.760, "rx": 0.085, "rz": 0.095, "cz": 0.008},
        {"y": 0.730, "rx": 0.083, "rz": 0.093, "cz": 0.008},
        {"y": 0.700, "rx": 0.081, "rz": 0.091, "cz": 0.008},
        {"y": 0.670, "rx": 0.079, "rz": 0.089, "cz": 0.007, "fold": (0.055, 6.0, 0.8)},
        {"y": 0.640, "rx": 0.078, "rz": 0.088, "cz": 0.007},
        {"y": 0.600, "rx": 0.076, "rz": 0.086, "cz": 0.006},
        {"y": 0.560, "rx": 0.074, "rz": 0.084, "cz": 0.007, "fold": (0.050, 6.0, 0.8)},
        {"y": 0.520, "rx": 0.073, "rz": 0.084, "cz": 0.008},
        {"y": 0.480, "rx": 0.073, "rz": 0.086, "cz": 0.010},
        {"y": 0.450, "rx": 0.073, "rz": 0.088, "cz": 0.012, "bulge_z": 0.012},  # Patella
        {"y": 0.420, "rx": 0.071, "rz": 0.085, "cz": 0.009, "bulge_z": 0.008},
        {"y": 0.390, "rx": 0.068, "rz": 0.078, "cz": 0.005},
        {"y": 0.360, "rx": 0.067, "rz": 0.077, "cz": 0.001, "fold": (0.045, 6.0, 2.0)},
        {"y": 0.330, "rx": 0.068, "rz": 0.085, "cz": -0.005, "fold": (0.050, 6.0, 2.0)}, # Calf
        {"y": 0.300, "rx": 0.066, "rz": 0.082, "cz": -0.005},
        {"y": 0.270, "rx": 0.062, "rz": 0.076, "cz": -0.004},
        {"y": 0.240, "rx": 0.059, "rz": 0.070, "cz": -0.002},
        {"y": 0.210, "rx": 0.058, "rz": 0.066, "cz": -0.001},
        {"y": 0.180, "rx": 0.057, "rz": 0.064, "cz": 0.0},
        {"y": 0.155, "rx": 0.074, "rz": 0.080, "cz": 0.002, "fold": (0.065, 7.0, 1.2)},  # Blouse
        {"y": 0.130, "rx": 0.073, "rz": 0.079, "cz": 0.001, "fold": (0.065, 7.0, 1.2)},
        {"y": 0.105, "rx": 0.063, "rz": 0.069, "cz": 0.0},
        {"y": 0.090, "rx": 0.061, "rz": 0.068, "cz": 0.0},   # Cuff
    ]

    for side, sgn, root_loop in (("Left", -1.0, left_loop), ("Right", 1.0, right_loop)):
        cx_leg = sgn * 0.098
        w_leg = w_knee(side)
        w_hp = w_hip(side)

        def w_trouser(x, y, z, _w_leg=w_leg, _w_hp=w_hp):
            if y > 0.84:
                return _w_hp(x, y, z)
            return _w_leg(x, y, z)

        prev_loop = root_loop
        n_trings = len(thigh_rings)
        for r_idx, r in enumerate(thigh_rings):
            y = r["y"]
            rx, rz = r["rx"], r["rz"]
            cz = r.get("cz", 0.0)
            fold = r.get("fold", (0.0, 1.0, 0.0))
            bulge_z = r.get("bulge_z", 0.0)

            cur_loop = []
            for k in range(20):
                th = 2.0 * math.pi * k / 20
                sin_th = math.sin(th)
                cos_th = math.cos(th)
                wob = 1.0 + fold[0] * math.sin(fold[1] * th + fold[2])
                x = cx_leg + sgn * rx * wob * sin_th
                z = cz + rz * wob * cos_th + bulge_z
                cur_loop.append(len(p.verts))
                p.verts.append((x, y, z))
                p.weights.append(_norm_ws(w_trouser(x, y, z)))

            fj0 = 0.20 + 0.75 * r_idx / n_trings
            fj1 = 0.20 + 0.75 * (r_idx + 1) / n_trings
            for k in range(20):
                a = prev_loop[k]
                b = prev_loop[(k + 1) % 20]
                c = cur_loop[(k + 1) % 20]
                d = cur_loop[k]
                p.faces.append((a, b, c, d))
                p.smooth.append(True)
                uu0 = u0 + (u1 - u0) * k / 20
                uu1 = u0 + (u1 - u0) * (k + 1) / 20
                vv0 = v0 + (v1 - v0) * fj0
                vv1 = v0 + (v1 - v0) * fj1
                p.uvs.extend([(uu0, vv0), (uu1, vv0), (uu1, vv1), (uu0, vv1)])
            prev_loop = cur_loop

        # Fitted bellows cargo pockets on outer thighs
        add_box(p, cx_leg + sgn * 0.082, 0.695, 0.010, 0.050, 0.148, 0.104,
                UV_TROUSER, w_trouser, taper_top=0.90, taper_z=0.88)
        add_box(p, cx_leg + sgn * 0.084, 0.762, 0.012, 0.054, 0.030, 0.108,
                UV_TROUSER, w_trouser, taper_top=0.94, taper_z=0.92)
        add_box(p, cx_leg + sgn * 0.080, 0.628, 0.008, 0.046, 0.022, 0.098,
                UV_TROUSER, w_trouser, taper_top=0.96)


def build_closed_shirt(p):
    """Continuous closed shirt mesh with welded armscyes and neck opening.

    Torso loft (36 sides) branches at armscyes into welded 16-sided sleeve tubes.
    The top sleeve ring shares the exact armhole boundary vertices of the torso,
    guaranteeing 100% 2-manifold continuity across the shoulder joint under any
    pose deformation. Neck terminates in deliberate opening ring for visible throat.
    """
    N_torso = 36
    u0_t, v0_t, u1_t, v1_t = UV_TORSO
    u0_s, v0_s, u1_s, v1_s = UV_SLEEVE

    def w_torso(x, y, z):
        if y > 1.36:
            return rigid("Chest")
        if y > 1.20:
            return blend("Spine", "Chest", (y - 1.20) / 0.16)
        if y > 1.05:
            return blend("Hips", "Spine", (y - 1.05) / 0.15)
        return rigid("Hips")

    torso_rings = [
        {"y": 1.040, "rx": 0.136, "rz": 0.106},  # 0: waist hem
        {"y": 1.075, "rx": 0.139, "rz": 0.107},  # 1
        {"y": 1.110, "rx": 0.143, "rz": 0.109},  # 2
        {"y": 1.150, "rx": 0.150, "rz": 0.112},  # 3: lower rib cage
        {"y": 1.190, "rx": 0.158, "rz": 0.115},  # 4
        {"y": 1.230, "rx": 0.165, "rz": 0.118},  # 5: mid chest
        {"y": 1.270, "rx": 0.171, "rz": 0.121},  # 6
        {"y": 1.310, "rx": 0.176, "rz": 0.123},  # 7: below armhole
        {"y": 1.345, "rx": 0.180, "rz": 0.124},  # 8: armhole bottom / underarm
        {"y": 1.380, "rx": 0.182, "rz": 0.123},  # 9: armhole mid-low
        {"y": 1.415, "rx": 0.181, "rz": 0.121},  # 10: armhole mid-high
        {"y": 1.450, "rx": 0.175, "rz": 0.118},  # 11: armhole top / trapezius
        {"y": 1.485, "rx": 0.145, "rz": 0.102},  # 12: shoulder slope
        {"y": 1.515, "rx": 0.082, "rz": 0.072},  # 13: deliberate neck opening
    ]

    base_torso = len(p.verts)
    n_trings = len(torso_rings)
    for j, r in enumerate(torso_rings):
        y = r["y"]
        rx, rz = r["rx"], r["rz"]
        for i in range(N_torso):
            th = 2.0 * math.pi * i / N_torso
            # i=0: front (x=0, z>0), i=9: left (x<0, z=0), i=18: back, i=27: right
            x = -rx * math.sin(th)
            z = rz * math.cos(th)
            p.verts.append((x, y, z))
            p.weights.append(_norm_ws(w_torso(x, y, z)))

    # Armhole cutouts: 3 rows (rings 8..11) x 5 columns centered on lateral axes (i=9 and i=27)
    left_hole = set()
    right_hole = set()
    for j in (8, 9, 10):
        for i in (7, 8, 9, 10, 11):
            left_hole.add((j, i))
        for i in (25, 26, 27, 28, 29):
            right_hole.add((j, i))

    for j in range(n_trings - 1):
        fj0 = j / (n_trings - 1)
        fj1 = (j + 1) / (n_trings - 1)
        for i in range(N_torso):
            if (j, i) in left_hole or (j, i) in right_hole:
                continue
            a = base_torso + j * N_torso + i
            b = base_torso + j * N_torso + (i + 1) % N_torso
            c = base_torso + (j + 1) * N_torso + (i + 1) % N_torso
            d = base_torso + (j + 1) * N_torso + i
            p.faces.append((a, b, c, d))
            p.smooth.append(True)
            uu0 = u0_t + (u1_t - u0_t) * i / N_torso
            uu1 = u0_t + (u1_t - u0_t) * (i + 1) / N_torso
            vv0 = v0_t + (v1_t - v0_t) * fj0
            vv1 = v0_t + (v1_t - v0_t) * fj1
            p.uvs.extend([(uu0, vv0), (uu1, vv0), (uu1, vv1), (uu0, vv1)])

    # Extract directed boundary loops to get exact ordered armhole loops
    edge_faces = {}
    for fi, f in enumerate(p.faces):
        for k in range(len(f)):
            e = tuple(sorted([f[k], f[(k + 1) % len(f)]]))
            edge_faces.setdefault(e, []).append(fi)

    b_half_edges = {}
    for fi, f in enumerate(p.faces):
        for k in range(len(f)):
            v0_idx, v1_idx = f[k], f[(k + 1) % len(f)]
            e = tuple(sorted([v0_idx, v1_idx]))
            if len(edge_faces[e]) == 1 and v0_idx >= base_torso and v1_idx >= base_torso:
                b_half_edges[v1_idx] = v0_idx

    visited = set()
    left_arm_loop = None
    right_arm_loop = None
    for start in list(b_half_edges.keys()):
        if start not in visited:
            loop = [start]
            visited.add(start)
            curr = b_half_edges[start]
            while curr != start and curr in b_half_edges:
                visited.add(curr)
                loop.append(curr)
                curr = b_half_edges[curr]
            xs = [p.verts[v][0] for v in loop]
            mx = sum(xs) / len(xs)
            if len(loop) == 16:
                if mx < -0.10:
                    left_arm_loop = loop
                elif mx > 0.10:
                    right_arm_loop = loop

    assert left_arm_loop and right_arm_loop, "Armholes not extracted cleanly!"
    M_sleeve = len(left_arm_loop)

    # Sleeves descending from the shared armhole loops to wrist cuffs (16 rings x 16 sides)
    sleeve_rings = [
        {"y": 1.340, "rx": 0.066, "rz": 0.074},
        {"y": 1.310, "rx": 0.065, "rz": 0.072},
        {"y": 1.280, "rx": 0.063, "rz": 0.069},
        {"y": 1.250, "rx": 0.060, "rz": 0.066},
        {"y": 1.220, "rx": 0.058, "rz": 0.063, "fold": (0.050, 6.0, 0.4)},
        {"y": 1.180, "rx": 0.056, "rz": 0.060, "fold": (0.055, 6.0, 0.4)},
        {"y": 1.150, "rx": 0.054, "rz": 0.058},
        {"y": 1.138, "rx": 0.054, "rz": 0.058},  # Elbow olecranon
        {"y": 1.100, "rx": 0.056, "rz": 0.058, "fold": (0.050, 6.0, 2.2)},
        {"y": 1.070, "rx": 0.055, "rz": 0.055},
        {"y": 1.040, "rx": 0.052, "rz": 0.052},  # Forearm brachioradialis
        {"y": 1.000, "rx": 0.048, "rz": 0.048},
        {"y": 0.970, "rx": 0.046, "rz": 0.046},
        {"y": 0.940, "rx": 0.045, "rz": 0.044},
        {"y": 0.920, "rx": 0.045, "rz": 0.044},
        {"y": 0.908, "rx": 0.045, "rz": 0.044},  # Cuff
    ]

    for side, sgn, root_loop in (("Left", -1.0, left_arm_loop), ("Right", 1.0, right_arm_loop)):
        cx_arm = sgn * 0.180
        w_el = w_elbow(side)

        def w_sleeve(x, y, z, _w_el=w_el, _s=side):
            if y > 1.24:
                return blend("Chest", f"{_s}Arm", min(1.0, max(0.0, (1.46 - y) / 0.22)))
            return _w_el(x, y, z)

        # Smooth shoulder joint weighting across the armscye seam
        for vi in root_loop:
            p.weights[vi] = _norm_ws(blend("Chest", f"{side}Arm", 0.50))

        prev_loop = root_loop
        n_srings = len(sleeve_rings)
        for r_idx, r in enumerate(sleeve_rings):
            y = r["y"]
            rx, rz = r["rx"], r["rz"]
            fold = r.get("fold", (0.0, 1.0, 0.0))

            cur_loop = []
            for k in range(M_sleeve):
                th = 2.0 * math.pi * k / M_sleeve
                wob = 1.0 + fold[0] * math.sin(fold[1] * th + fold[2])
                x = cx_arm + sgn * rx * wob * math.sin(th)
                z = rz * wob * math.cos(th)
                cur_loop.append(len(p.verts))
                p.verts.append((x, y, z))
                p.weights.append(_norm_ws(w_sleeve(x, y, z)))

            fj0 = 0.05 + 0.90 * r_idx / n_srings
            fj1 = 0.05 + 0.90 * (r_idx + 1) / n_srings
            for k in range(M_sleeve):
                a = prev_loop[k]
                b = prev_loop[(k + 1) % M_sleeve]
                c = cur_loop[(k + 1) % M_sleeve]
                d = cur_loop[k]
                p.faces.append((a, b, c, d))
                p.smooth.append(True)
                uu0 = u0_s + (u1_s - u0_s) * k / M_sleeve
                uu1 = u0_s + (u1_s - u0_s) * (k + 1) / M_sleeve
                vv0 = v0_s + (v1_s - v0_s) * fj0
                vv1 = v0_s + (v1_s - v0_s) * fj1
                p.uvs.extend([(uu0, vv0), (uu1, vv0), (uu1, vv1), (uu0, vv1)])
            prev_loop = cur_loop

        # MUSE-1017: elbow reinforcement is sleeve-local (no floating cap).
        # AGY-1000 add_sphere(phi0=0,phi1=0.55pi,seg=20) left a 20-edge open rim
        # at y~=1.1267 plus 20 pole-duplicate zero-area tris per arm (40/40 total).
        # Capping that rim with a ball would hide the joint; deleting the patch
        # keeps the shoulder->wrist tube a single 2-manifold. Stitching stays in
        # texture (UV_PAD panel), not geometry.
        # Sleeve cuff hem: share the sleeve-end ring, extend one 16-sided ring
        # to y=0.880. Same angular convention as sleeve rings (sin/cos) so the
        # bridge has zero twist and zero boundary at y=0.908.
        cuff_cz, cuff_rx, cuff_rz, cuff_y = 0.006, 0.044, 0.043, 0.880
        cuff_loop = []
        w_cuff = w_wrist(side)
        for k in range(M_sleeve):
            th = 2.0 * math.pi * k / M_sleeve
            x = cx_arm + sgn * cuff_rx * math.sin(th)
            z = cuff_cz + cuff_rz * math.cos(th)
            cuff_loop.append(len(p.verts))
            p.verts.append((x, cuff_y, z))
            p.weights.append(_norm_ws(w_cuff(x, cuff_y, z)))
        for k in range(M_sleeve):
            a = prev_loop[k]
            b = prev_loop[(k + 1) % M_sleeve]
            c = cuff_loop[(k + 1) % M_sleeve]
            d = cuff_loop[k]
            p.faces.append((a, b, c, d))
            p.smooth.append(True)
            uu0 = u0_s + (u1_s - u0_s) * k / M_sleeve
            uu1 = u0_s + (u1_s - u0_s) * (k + 1) / M_sleeve
            p.uvs.extend([(uu0, 0.0), (uu1, 0.0), (uu1, 0.06), (uu0, 0.06)])

    # Deliberate Neck Opening & Exposed Skin Throat
    def w_neck(x, y, z):
        if y > 1.60:
            return rigid("Neck")
        return blend("Chest", "Neck", min(1.0, max(0.0, (y - 1.50) / 0.10)))

    # MUSE-1017: throat shares the torso neck ring (36 sides, same sin/cos
    # convention, same radii). AGY-1000 add_loft(24 sides, cos/sin, rx=0.080)
    # left torso-neck 36 + throat-bottom 24 = 60 open edges at y=1.515.
    # Sharing the ring closes that seam; only the chin-top 36 stays open.
    neck_root = [base_torso + 13 * N_torso + i for i in range(N_torso)]
    throat_rings = [
        {"y": 1.545, "cz": 0.001, "rx": 0.074, "rz": 0.066},
        {"y": 1.580, "cz": 0.002, "rx": 0.066, "rz": 0.060},
        {"y": 1.620, "cz": 0.004, "rx": 0.058, "rz": 0.056},
    ]
    prev = neck_root
    n_th = len(throat_rings)
    for r_idx, r in enumerate(throat_rings):
        cur = []
        for i in range(N_torso):
            th = 2.0 * math.pi * i / N_torso
            x = -r["rx"] * math.sin(th)
            z = r["cz"] + r["rz"] * math.cos(th)
            cur.append(len(p.verts))
            p.verts.append((x, r["y"], z))
            p.weights.append(_norm_ws(w_neck(x, r["y"], z)))
        fj0 = 0.10 + 0.30 * r_idx / n_th
        fj1 = 0.10 + 0.30 * (r_idx + 1) / n_th
        for i in range(N_torso):
            a = prev[i]
            b = prev[(i + 1) % N_torso]
            c = cur[(i + 1) % N_torso]
            d = cur[i]
            p.faces.append((a, b, c, d))
            p.smooth.append(True)
            uu0 = 0.63 + (0.79 - 0.63) * i / N_torso
            uu1 = 0.63 + (0.79 - 0.63) * (i + 1) / N_torso
            vv0 = 0.55 + (0.97 - 0.55) * fj0
            vv1 = 0.55 + (0.97 - 0.55) * fj1
            p.uvs.extend([(uu0, vv0), (uu1, vv0), (uu1, vv1), (uu0, vv1)])
        prev = cur



# ---------------------------------------------------------------------------
# BODY primitive (Cloth, Skin, Gloves)
# ---------------------------------------------------------------------------

def build_body():
    p = Part()

    # 1. Closed Trousers (continuous pelvis-to-thighs branch join)
    build_closed_trousers(p)

    # 2. Closed Shirt (continuous torso-to-sleeves with welded armscyes)
    build_closed_shirt(p)

    # 3. Tactical Gloves & Hands (sound existing rig preserved)
    for side, sgn in (("Left", -1.0), ("Right", 1.0)):
        xs = sgn * 0.180
        w_hand = w_wrist(side)

        # Gauntlet cuff
        add_loft(p, [
            {"y": 0.888, "cx": xs - sgn * 0.007, "cz": 0.006, "rx": 0.047, "rz": 0.046},
            {"y": 0.862, "cx": xs - sgn * 0.007, "cz": 0.006, "rx": 0.045, "rz": 0.044},
        ], 20, UV_GLOVE, (0.0, 0.15), w_hand)

        # Palm with thenar mass
        add_box(p, xs - sgn * 0.004, 0.816, 0.010, 0.068, 0.096, 0.048,
                UV_GLOVE, w_hand, taper_top=0.92)
        # Knuckle protective plate
        add_box(p, xs, 0.796, 0.026, 0.065, 0.025, 0.044, UV_GLOVE, w_hand)

        # 4 Articulated fingers curled in tactical ready-carry pose
        finger_specs = [
            (-0.024, 0.056, 1.0),  # Index
            (-0.008, 0.062, 1.4),  # Middle
            (+0.008, 0.058, 1.6),  # Ring
            (+0.024, 0.048, 1.8),  # Little
        ]
        for fx, flen, curl_mult in finger_specs:
            curl = 0.004 * curl_mult
            add_loft(p, [
                {"y": 0.772, "cx": xs + fx, "cz": 0.011, "rx": 0.0095, "rz": 0.010},
                {"y": 0.772 - flen * 0.32, "cx": xs + fx, "cz": 0.012 + curl, "rx": 0.0090, "rz": 0.0095},
                {"y": 0.772 - flen * 0.55, "cx": xs + fx, "cz": 0.014 + curl * 1.6, "rx": 0.0085, "rz": 0.0090},
                {"y": 0.772 - flen * 0.78, "cx": xs + fx, "cz": 0.017 + curl * 2.3, "rx": 0.0080, "rz": 0.0085},
                {"y": 0.772 - flen, "cx": xs + fx, "cz": 0.021 + curl * 3.2, "rx": 0.0070, "rz": 0.0075},
            ], 12, UV_GLOVE, (0.05, 0.25), w_hand, cap_top=False, cap_bottom=True)

        # Opposed tactical thumb
        add_loft(p, [
            {"y": 0.832, "cx": xs - sgn * 0.034, "cz": 0.016, "rx": 0.0115, "rz": 0.012},
            {"y": 0.810, "cx": xs - sgn * 0.040, "cz": 0.026, "rx": 0.0105, "rz": 0.011},
            {"y": 0.792, "cx": xs - sgn * 0.043, "cz": 0.035, "rx": 0.0095, "rz": 0.010},
            {"y": 0.778, "cx": xs - sgn * 0.044, "cz": 0.042, "rx": 0.0085, "rz": 0.009},
        ], 12, UV_GLOVE, (0.25, 0.45), w_hand, cap_top=False, cap_bottom=True)

    # 4. Face & Head
    hy = REST_WORLD["Head"][1]

    def face_deform(x, y, z, phi, th):
        if y < hy + 0.02:
            k = min(1.0, (hy + 0.02 - y) / 0.10)
            x *= 1.0 - 0.20 * k
            z *= 1.0 - 0.10 * k
        dth = (th - math.pi / 2 + math.pi) % (2 * math.pi) - math.pi
        dy = (y - (hy + 0.01)) / 0.05
        bump = math.exp(-(dth * dth) / 0.10) * math.exp(-(dy * dy) / 1.2)
        z += 0.016 * bump
        dyb = (y - (hy + 0.055)) / 0.03
        z += 0.005 * math.exp(-(dth * dth) / 0.25) * math.exp(-(dyb * dyb))
        return (x, y, z)

    add_sphere(p, 0.0, hy + 0.045, 0.006, 0.098, 28, 20,
               sx=0.92, sy=1.12, sz=0.98, uv_rect=UV_FACE,
               wfn=lambda x, y, z: rigid("Head"), deform=face_deform)

    # Balaclava shell with eye opening
    def eye_window(phi, th):
        dth = abs((th - math.pi / 2 + math.pi) % (2 * math.pi) - math.pi)
        return (math.pi * 0.30 < phi < math.pi * 0.54) and (dth < 0.55)

    add_sphere(p, 0.0, hy + 0.045, 0.004, 0.102, 28, 20,
               sx=0.94, sy=1.14, sz=1.0, uv_rect=UV_TORSO,
               wfn=lambda x, y, z: rigid("Head"), skip_face=eye_window)

    # Hemmed eye opening rims
    brow_y, chin_y = hy + 0.082, hy + 0.018
    add_loft(p, [
        {"y": brow_y, "cx": 0.0, "cz": 0.055, "rx": 0.062, "rz": 0.030},
        {"y": brow_y - 0.006, "cx": 0.0, "cz": 0.058, "rx": 0.064, "rz": 0.030},
    ], 24, UV_TORSO, (0.9, 0.98), lambda x, y, z: rigid("Head"))
    add_loft(p, [
        {"y": chin_y + 0.006, "cx": 0.0, "cz": 0.060, "rx": 0.058, "rz": 0.028},
        {"y": chin_y, "cx": 0.0, "cz": 0.057, "rx": 0.056, "rz": 0.028},
    ], 24, UV_TORSO, (0.9, 0.98), lambda x, y, z: rigid("Head"))

    return p


# ---------------------------------------------------------------------------
# GEAR primitive (Helmet, Plate Carrier, Kneepads, Boots)
# ---------------------------------------------------------------------------

def build_gear():
    g = Part()
    hy = REST_WORLD["Head"][1]

    # Helmet
    add_sphere(g, 0.0, hy + 0.048, -0.004, 0.126, 28, 14,
               sx=0.98, sy=1.02, sz=1.04, phi0=0.0, phi1=math.pi * 0.62,
               uv_rect=UV_HELM, wfn=lambda x, y, z: rigid("Head"))
    add_loft(g, [
        {"y": hy + 0.018, "cx": 0.0, "cz": -0.004, "rx": 0.128, "rz": 0.132},
        {"y": hy - 0.006, "cx": 0.0, "cz": -0.004, "rx": 0.130, "rz": 0.134},
    ], 28, UV_HELM, (0.0, 0.12), lambda x, y, z: rigid("Head"))
    add_box(g, 0.0, hy + 0.088, 0.118, 0.052, 0.036, 0.030, UV_SOLE, lambda x, y, z: rigid("Head"))
    for sgn in (-1.0, 1.0):
        add_box(g, sgn * 0.122, hy + 0.045, 0.010, 0.012, 0.055, 0.085, UV_SOLE, lambda x, y, z: rigid("Head"))
        add_sphere(g, sgn * 0.100, hy + 0.030, 0.002, 0.042, 12, 6,
                   sx=0.70, sy=1.0, sz=0.90, phi0=0.0, phi1=math.pi,
                   uv_rect=UV_SOLE, wfn=lambda x, y, z: rigid("Head"))
    add_loft(g, [
        {"y": hy - 0.010, "cx": 0.0, "cz": 0.020, "rx": 0.096, "rz": 0.088},
        {"y": hy - 0.060, "cx": 0.0, "cz": 0.012, "rx": 0.080, "rz": 0.072},
        {"y": hy - 0.080, "cx": 0.0, "cz": 0.009, "rx": 0.073, "rz": 0.067},
        {"y": hy - 0.100, "cx": 0.0, "cz": 0.006, "rx": 0.066, "rz": 0.062},
    ], 24, UV_SOLE, (0.1, 0.3), lambda x, y, z: rigid("Head"))

    # Tactical Goggles
    add_loft(g, [
        {"y": hy + 0.062, "cx": 0.0, "cz": -0.004, "rx": 0.129, "rz": 0.133},
        {"y": hy + 0.038, "cx": 0.0, "cz": -0.004, "rx": 0.131, "rz": 0.135},
    ], 28, UV_SOLE, (0.0, 0.10), lambda x, y, z: rigid("Head"))
    add_box(g, 0.0, hy + 0.098, 0.104, 0.196, 0.052, 0.030, UV_SOLE, lambda x, y, z: rigid("Head"))
    for sgn in (-1.0, 1.0):
        lens = Part()
        add_box(lens, sgn * 0.048, hy + 0.098, 0.120, 0.082, 0.042, 0.008,
                (0.90, 0.05, 0.99, 0.20), lambda x, y, z: rigid("Head"))
        # FINAL2-1030: same offset fix for the 6-quad goggle lens boxes:
        # 8 lens verts/side were orphaned while their faces pointed at 0..7.
        _lens_base = len(g.verts)
        g.verts.extend(lens.verts)
        g.faces.extend(tuple(_lens_base + v for v in f) for f in lens.faces)
        g.smooth.extend(lens.smooth)
        g.uvs.extend(lens.uvs)
        g.weights.extend(lens.weights)

    # Plate Carrier
    chest = lambda x, y, z: rigid("Chest")
    add_box(g, 0.0, 1.335, 0.130, 0.300, 0.330, 0.080, UV_WEB, chest, taper_top=0.80)
    add_box(g, 0.0, 1.335, -0.130, 0.300, 0.330, 0.080, UV_WEB, chest, taper_top=0.82)
    add_box(g, 0.0, 1.333, 0.086, 0.318, 0.342, 0.022, UV_WEB, chest, taper_top=0.86)
    add_box(g, 0.0, 1.333, -0.086, 0.318, 0.342, 0.022, UV_WEB, chest, taper_top=0.86)
    add_box(g, 0.0, 1.498, 0.128, 0.262, 0.030, 0.072, UV_WEB, chest, taper_top=0.85)
    add_box(g, 0.0, 1.498, -0.128, 0.262, 0.030, 0.072, UV_WEB, chest, taper_top=0.85)

    add_loft(g, [
        {"y": 1.170, "cx": 0.0, "cz": 0.0, "rx": 0.174, "rz": 0.128},
        {"y": 1.200, "cx": 0.0, "cz": 0.0, "rx": 0.176, "rz": 0.129},
        {"y": 1.230, "cx": 0.0, "cz": 0.0, "rx": 0.178, "rz": 0.130},
    ], 24, UV_WEB, (0.0, 0.12), chest)
    for sgn in (-1.0, 1.0):
        add_box(g, sgn * 0.168, 1.300, 0.0, 0.042, 0.210, 0.185, UV_WEB, chest, taper_top=0.90)
    for my in (1.250, 1.310, 1.370):
        add_box(g, 0.0, my, 0.172, 0.280, 0.020, 0.012, UV_WEB, chest)
    for my in (1.280, 1.340):
        add_box(g, 0.0, my, -0.172, 0.280, 0.020, 0.012, UV_WEB, chest)
    for px in (-0.088, 0.0, 0.088):
        add_box(g, px, 1.295, 0.196, 0.080, 0.125, 0.064, UV_WEB, chest)
        add_box(g, px, 1.365, 0.198, 0.082, 0.028, 0.068, UV_WEB, chest)
    add_box(g, 0.0, 1.415, 0.188, 0.130, 0.075, 0.052, UV_WEB, chest)
    add_box(g, 0.065, 1.360, -0.198, 0.108, 0.170, 0.078, UV_WEB, chest)
    add_box(g, 0.0, 1.200, 0.168, 0.058, 0.042, 0.026, UV_SOLE, chest)
    for sgn in (-1.0, 1.0):
        add_box(g, sgn * 0.100, 1.512, -0.006, 0.072, 0.062, 0.208, UV_SOLE, chest)
        add_box(g, sgn * 0.100, 1.515, 0.002, 0.058, 0.052, 0.195, UV_WEB, chest)
        add_box(g, sgn * 0.100, 1.455, 0.092, 0.062, 0.032, 0.020, UV_SOLE, chest)
    add_loft(g, [
        {"y": 1.430, "cx": 0.065, "cz": -0.192, "rx": 0.006, "rz": 0.006},
        {"y": 1.560, "cx": 0.067, "cz": -0.196, "rx": 0.005, "rz": 0.005},
        {"y": 1.680, "cx": 0.069, "cz": -0.200, "rx": 0.004, "rz": 0.004},
        {"y": 1.760, "cx": 0.070, "cz": -0.202, "rx": 0.003, "rz": 0.003},
    ], 6, UV_SOLE, (0.5, 0.7), chest)

    # Duty belt & pouches
    hips = lambda x, y, z: rigid("Hips")
    add_loft(g, [
        {"y": 1.060, "cx": 0.0, "cz": -0.002, "rx": 0.140, "rz": 0.114},
        {"y": 1.084, "cx": 0.0, "cz": -0.002, "rx": 0.141, "rz": 0.115},
        {"y": 1.108, "cx": 0.0, "cz": -0.002, "rx": 0.142, "rz": 0.116},
    ], 24, UV_WEB, (0.1, 0.22), hips)
    add_box(g, 0.0, 1.084, 0.118, 0.052, 0.038, 0.026, UV_SOLE, hips)
    add_box(g, -0.150, 1.030, -0.010, 0.080, 0.100, 0.072, UV_WEB, hips)
    add_box(g, 0.150, 0.980, -0.088, 0.105, 0.125, 0.068, UV_WEB, hips)

    # Kneepads & Combat Boots
    for side, sgn in (("Left", -1.0), ("Right", 1.0)):
        x_leg = sgn * 0.098
        w_kn = w_knee(side)
        foot = lambda x, y, z, _s=side: rigid(f"{_s}Foot")

        # Kneepad Cap (centered at y=0.440, w_knee articulated)
        kp = Part()
        segs, rows = 22, 12
        for j in range(rows + 1):
            yy = 0.490 - 0.00833 * j
            dy_patella = (yy - 0.440) / 0.050
            z_prominence = 0.089 + 0.008 * max(0.0, 1.0 - dy_patella * dy_patella)
            for i in range(segs + 1):
                th = -1.15 + 2.30 * i / segs
                kp.verts.append((
                    x_leg + 0.077 * math.sin(th),
                    yy,
                    0.012 + z_prominence * math.cos(th),
                ))
                kp.weights.append(_norm_ws(w_kn(x_leg + 0.077 * math.sin(th), yy, 0.012 + z_prominence * math.cos(th))))
        for j in range(rows):
            for i in range(segs):
                a = j * (segs + 1) + i
                b = a + 1
                c = a + segs + 2
                d = a + segs + 1
                kp.faces.append((a, b, c, d))
                kp.smooth.append(True)
                kp.uvs.extend([(0.55, 0.05), (0.95, 0.05), (0.95, 0.45), (0.55, 0.45)])
        # FINAL2-1030: offset local kp faces by the gear base index. Without
        # this the 264 kneepad quads/side referenced helmet verts 0..298,
        # orphaning 299 kneepad verts/side and invalidating the gear mesh
        # (Blender: "Mesh OperatorSand_Gear is not valid", exporter drops).
        _kp_base = len(g.verts)
        g.verts.extend(kp.verts)
        g.faces.extend(tuple(_kp_base + v for v in f) for f in kp.faces)
        g.smooth.extend(kp.smooth)
        g.uvs.extend(kp.uvs)
        g.weights.extend(kp.weights)

        # Retention Straps (+6mm proud clearance, zero z-fight)
        add_loft(g, [
            {"y": 0.510, "cx": x_leg, "cz": 0.010, "rx": 0.081, "rz": 0.091},
            {"y": 0.490, "cx": x_leg, "cz": 0.010, "rx": 0.080, "rz": 0.090},
        ], 24, UV_SOLE, (0.5, 0.6), w_kn)
        add_loft(g, [
            {"y": 0.380, "cx": x_leg, "cz": 0.004, "rx": 0.076, "rz": 0.086},
            {"y": 0.360, "cx": x_leg, "cz": 0.004, "rx": 0.075, "rz": 0.085},
        ], 24, UV_SOLE, (0.5, 0.6), w_kn)

        # Combat Boots
        def w_boot(x, y, z, _s=side):
            if y > 0.11:
                return blend(f"{_s}Leg", f"{_s}Foot", (0.22 - y) / 0.11) if y < 0.22 else rigid(f"{_s}Leg")
            return rigid(f"{_s}Foot")

        boot_shaft_rings = [
            {"y": 0.210, "cx": x_leg, "cz": 0.0, "rx": 0.066, "rz": 0.072},
            {"y": 0.185, "cx": x_leg, "cz": 0.001, "rx": 0.065, "rz": 0.072},
            {"y": 0.160, "cx": x_leg, "cz": 0.002, "rx": 0.063, "rz": 0.071},
            {"y": 0.135, "cx": x_leg, "cz": 0.003, "rx": 0.061, "rz": 0.070},
            {"y": 0.110, "cx": x_leg, "cz": 0.003, "rx": 0.060, "rz": 0.070},
            {"y": 0.090, "cx": x_leg, "cz": 0.004, "rx": 0.059, "rz": 0.071},
            {"y": 0.075, "cx": x_leg, "cz": 0.005, "rx": 0.059, "rz": 0.072},
            {"y": 0.060, "cx": x_leg, "cz": 0.006, "rx": 0.059, "rz": 0.072},
            {"y": 0.045, "cx": x_leg, "cz": 0.006, "rx": 0.059, "rz": 0.073},
        ]
        add_loft(g, boot_shaft_rings, 24, UV_BOOT, (0.77, 0.99), w_boot)
        add_box(g, x_leg, 0.062, 0.070, 0.096, 0.120, 0.235, UV_BOOT, foot, taper_top=0.82)
        add_box(g, x_leg, 0.046, 0.175, 0.094, 0.080, 0.074, UV_BOOT, foot, taper_top=0.55, taper_z=0.60)
        for _k in range(3):
            _ly = 0.118 - 0.019 * _k
            _lz = 0.098 + 0.012 * _k
            add_box(g, x_leg, _ly, _lz, 0.060, 0.013, 0.022, UV_SOLE, foot)
        add_box(g, x_leg, 0.106, 0.096, 0.056, 0.052, 0.108, UV_BOOT, foot, taper_top=0.65)
        add_box(g, x_leg, 0.052, -0.046, 0.092, 0.102, 0.064, UV_SOLE, foot, taper_top=0.85)

        # Rugged tactical outsoles (ground contact y=0.000)
        add_box(g, x_leg, 0.014, 0.066, 0.108, 0.028, 0.252, UV_SOLE, foot)
        add_box(g, x_leg, 0.016, -0.024, 0.106, 0.032, 0.100, UV_SOLE, foot)
        add_box(g, x_leg, 0.014, 0.116, 0.104, 0.028, 0.145, UV_SOLE, foot)

    return g


# ---------------------------------------------------------------------------
# Procedural PBR Texture Generation (Preserving Palette and Split Contracts)
# ---------------------------------------------------------------------------

def _hash2(x, y, seed):
    h = (x * 374761393 + y * 668265263 + seed * 1442695041) & 0xFFFFFFFF
    h = (h ^ (h >> 13)) * 1274126177 & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFFFFFF) / 4294967295.0


def _vnoise(x, y, seed):
    xi, yi = int(math.floor(x)), int(math.floor(y))
    xf, yf = x - xi, y - yi
    sx, sy = xf * xf * (3 - 2 * xf), yf * yf * (3 - 2 * yf)
    a = _hash2(xi, yi, seed)
    b = _hash2(xi + 1, yi, seed)
    c = _hash2(xi, yi + 1, seed)
    d = _hash2(xi + 1, yi + 1, seed)
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy


def _fbm(x, y, seed, octaves=4):
    val, amp, freq, tot = 0.0, 1.0, 1.0, 0.0
    for _ in range(octaves):
        val += _vnoise(x * freq, y * freq, seed) * amp
        tot += amp
        amp *= 0.5
        freq *= 2.0
    return val / tot


def paint_cloth_base(W=1024, H=1024):
    out = [0.0] * (W * H * 4)
    for y in range(H):
        v = 1.0 - y / (H - 1)
        for x in range(W):
            u = x / (W - 1)
            if u < 0.61:
                is_torso = (v >= 0.58 and u <= 0.37)
                is_trouser = (v < 0.58 and u <= 0.37)
                is_sleeve = (u > 0.37)
                panel_val = 1.02 if is_torso else (0.95 if is_trouser else 1.05)
                seed_off = 100 if is_torso else (200 if is_trouser else 300)

                blotch = _fbm(u * 14.0, v * 14.0, SEED + seed_off, 4)
                weave = _vnoise(u * 280.0, v * 280.0, SEED + 7)
                twill = math.sin((u + v) * 520.0 * math.pi) * 0.04
                camo = 0.88 + 0.17 * (blotch - 0.5) + 0.09 * (weave - 0.5) + twill

                near_edge = False
                if is_torso and (abs(u - 0.36) < 0.012 or abs(v - 0.60) < 0.012):
                    near_edge = True
                elif is_trouser and (abs(u - 0.36) < 0.012 or abs(v - 0.55) < 0.012):
                    near_edge = True
                elif is_sleeve and (abs(u - 0.38) < 0.012):
                    near_edge = True

                edge_shade = 0.82 if near_edge else 1.0
                camo = camo * panel_val * edge_shade
                r = min(1.0, 0.74 * camo)
                g = min(1.0, 0.67 * camo)
                b = min(1.0, 0.54 * camo)
            elif u < 0.80:
                if v > 0.52:
                    tex = 0.94 + 0.06 * _vnoise(u * 80.0, v * 80.0, SEED + 1)
                    r, g, b = 0.78 * tex, 0.60 * tex, 0.49 * tex
                else:
                    tex = 0.92 + 0.08 * _vnoise(u * 50.0, v * 50.0, SEED + 2)
                    r, g, b = 0.46 * tex, 0.43 * tex, 0.36 * tex
            else:
                if v > 0.52:
                    tex = 0.94 + 0.06 * _vnoise(u * 80.0, v * 80.0, SEED + 3)
                    r, g, b = 0.77 * tex, 0.59 * tex, 0.48 * tex
                else:
                    tex = 0.90 + 0.10 * _vnoise(u * 40.0, v * 40.0, SEED + 4)
                    r, g, b = 0.18 * tex, 0.17 * tex, 0.16 * tex
            o = (x + y * W) * 4
            out[o] = r
            out[o + 1] = g
            out[o + 2] = b
            out[o + 3] = 1.0
    return out


def paint_gear_base(W=1024, H=1024):
    out = [0.0] * (W * H * 4)
    for y in range(H):
        v = 1.0 - y / (H - 1)
        for x in range(W):
            u = x / (W - 1)
            if u < 0.50:
                tex = 0.90 + 0.10 * _vnoise(u * 120.0, v * 120.0, SEED + 5)
                molle_bar = 0.82 if abs((v * 24.0) % 1.0 - 0.5) < 0.15 else 1.0
                tex *= molle_bar
                rib = 0.92 if ((u * 60.0) % 1.0) < 0.15 else 1.0
                tex *= rib
                r = min(1.0, 0.22 * tex * 1.25 + 0.03)
                g = min(1.0, 0.23 * tex * 1.25 + 0.03)
                b = min(1.0, 0.19 * tex * 1.25 + 0.03)
            elif u < 0.75:
                if v > 0.50:
                    tex = 0.94 + 0.06 * _vnoise(u * 60.0, v * 60.0, SEED + 6)
                    r, g, b = 0.65 * tex, 0.58 * tex, 0.46 * tex
                else:
                    tex = 0.92 + 0.08 * _vnoise(u * 30.0, v * 30.0, SEED + 7)
                    r, g, b = 0.10 * tex, 0.10 * tex, 0.10 * tex
            else:
                if v > 0.50:
                    tex = 0.92 + 0.08 * _vnoise(u * 40.0, v * 40.0, SEED + 8)
                    r, g, b = 0.38 * tex, 0.32 * tex, 0.25 * tex
                else:
                    tex = 0.90 + 0.10 * _vnoise(u * 30.0, v * 30.0, SEED + 9)
                    r, g, b = 0.08 * tex, 0.08 * tex, 0.08 * tex
            o = (x + y * W) * 4
            out[o] = r
            out[o + 1] = g
            out[o + 2] = b
            out[o + 3] = 1.0
    return out


def paint_shared_orm(W=512, H=512):
    out = [0.0] * (W * H * 4)
    for y in range(H):
        v = 1.0 - y / (H - 1)
        for x in range(W):
            u = x / (W - 1)
            grain_o = (_vnoise(u * 200.0, v * 200.0, SEED + 11) - 0.5)
            scuff_o = (_vnoise(u * 40.0, v * 40.0, SEED + 13) - 0.5)
            if u < 0.60:
                is_torso = (v >= 0.58 and u <= 0.37)
                is_trouser = (v < 0.58 and u <= 0.37)
                panel_rough = 0.88 if is_torso else (0.83 if is_trouser else 0.86)
                rough = panel_rough + grain_o * 0.14 + scuff_o * 0.08
            elif u < 0.80 and v > 0.50:
                rough = 0.55 + grain_o * 0.12 + scuff_o * 0.06
            elif u >= 0.80 and v <= 0.50:
                rough = 0.70 + grain_o * 0.10 + scuff_o * 0.08
            elif u < 0.75 and v <= 0.50:
                rough = 0.50 + grain_o * 0.10 + scuff_o * 0.06
            else:
                web_row = 0.05 if abs((v * 46.0) % 1.0 - 0.5) > 0.38 else 0.0
                rough = 0.85 + grain_o * 0.14 + scuff_o * 0.08 + web_row
            o = (x + y * W) * 4
            out[o] = 1.0
            out[o + 1] = min(1.0, max(0.05, rough))
            out[o + 2] = 0.0
            out[o + 3] = 1.0
    return out


# ---------------------------------------------------------------------------
# Blender Assembly (Root Headless Execution)
# ---------------------------------------------------------------------------

def main():
    import bpy

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # Clean scene
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials,
                 bpy.data.images, bpy.data.cameras, bpy.data.lights):
        for x in list(coll):
            coll.remove(x)

    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 2

    # Armature: 21 standard bones, exact rest offsets
    arm_data = bpy.data.armatures.new("OperatorSand")
    arm_obj = bpy.data.objects.new("OperatorSand_Rig", arm_data)
    scene.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="EDIT")
    for name in BONE_NAMES:
        eb = arm_data.edit_bones.new(name)
        eb.head = REST_WORLD[name]
        eb.tail = (REST_WORLD[name][0], REST_WORLD[name][1] + 0.05, REST_WORLD[name][2])
        eb.roll = 0.0
        par = BONE_PARENTS[name]
        if par is not None:
            eb.parent = arm_data.edit_bones[par]
            eb.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")

    # Build geometry
    body = build_body()
    gear = build_gear()

    # Image commit lifecycle contract (flush + pack)
    def _commit_image(img):
        img.update()
        try:
            img.pack()
        except Exception:
            pass
        assert getattr(img, "packed_file", True) is not None, f"image not packed: {img.name}"

    cloth_px = paint_cloth_base(1024, 1024)
    gear_px = paint_gear_base(1024, 1024)
    orm_px = paint_shared_orm(512, 512)

    img_cloth = bpy.data.images.new("Sand_Cloth_Base", 1024, 1024, alpha=True)
    img_cloth.pixels.foreach_set(cloth_px)
    _commit_image(img_cloth)

    img_gear = bpy.data.images.new("Sand_Gear_Base", 1024, 1024, alpha=True)
    img_gear.pixels.foreach_set(gear_px)
    _commit_image(img_gear)

    img_orm = bpy.data.images.new("Sand_Shared_ORM", 512, 512, alpha=True)
    img_orm.colorspace_settings.name = "Non-Color"
    img_orm.pixels.foreach_set(orm_px)
    _commit_image(img_orm)

    def make_mat(name, base_img, rough, metal):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = base_img
        mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        try:
            sep = mat.node_tree.nodes.new("ShaderNodeSeparateColor")
            in_color = sep.inputs["Color"]
            out_green = sep.outputs["Green"]
            out_blue = sep.outputs["Blue"]
        except Exception:
            sep = mat.node_tree.nodes.new("ShaderNodeSeparateRGB")
            in_color = sep.inputs["Image"]
            out_green = sep.outputs["G"]
            out_blue = sep.outputs["B"]
        otex = mat.node_tree.nodes.new("ShaderNodeTexImage")
        otex.image = img_orm
        mat.node_tree.links.new(otex.outputs["Color"], in_color)
        mat.node_tree.links.new(out_green, bsdf.inputs["Roughness"])
        mat.node_tree.links.new(out_blue, bsdf.inputs["Metallic"])
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = metal
        return mat

    mat_cloth = make_mat("Sand_Cloth", img_cloth, 0.85, 0.0)
    mat_gear = make_mat("Sand_Gear", img_gear, 0.62, 0.05)

    def write_object(name, part, mat):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(part.verts, [], part.faces)
        mesh.update(calc_edges=True)
        uv_layer = mesh.uv_layers.new(name="UVMap")
        li = 0
        for poly in mesh.polygons:
            poly.use_smooth = part.smooth[poly.index] if poly.index < len(part.smooth) else True
            for _ in poly.loop_indices:
                u, v = part.uvs[li]
                uv_layer.data[li].uv = (u, v)
                li += 1
        obj = bpy.data.objects.new(name, mesh)
        scene.collection.objects.link(obj)
        obj.data.materials.append(mat)
        buckets = {}
        for vi, ws in enumerate(part.weights):
            for b, w in ws:
                buckets.setdefault((b, round(w, 3)), []).append(vi)
        for b in range(len(BONE_NAMES)):
            obj.vertex_groups.new(name=BONE_NAMES[b])
        for (b, w), vis in buckets.items():
            if w > 0.0:
                obj.vertex_groups[b].add(vis, w, "REPLACE")
        mod = obj.modifiers.new("Armature", "ARMATURE")
        mod.object = arm_obj
        return obj

    obj_body = write_object("OperatorSand_Body", body, mat_cloth)
    obj_gear = write_object("OperatorSand_Gear", gear, mat_gear)

    tris = (sum(len(f) - 2 for f in body.faces) +
            sum(len(f) - 2 for f in gear.faces))
    vram = (1024 * 1024 * 4) * 2 + 512 * 512 * 4

    assert 12000 <= tris <= 20000, f"triangle budget miss: {tris} not in [12000, 20000]"
    assert len(obj_body.data.materials) == 1, "body material count != 1"
    assert len(obj_gear.data.materials) == 1, "gear material count != 1"
    assert len(bpy.data.materials) <= 3, f"material count > 3: {len(bpy.data.materials)}"
    assert len(bpy.data.images) <= 3, f"image count > 3: {len(bpy.data.images)}"
    assert len(arm_data.bones) == 21, f"bone count mismatch: {len(arm_data.bones)}"

    all_verts = body.verts + gear.verts
    xs = [v[0] for v in all_verts]
    ys = [v[1] for v in all_verts]
    zs = [v[2] for v in all_verts]
    assert -0.02 <= min(ys) <= 0.05, f"feet ground offset: {min(ys)}"
    assert 1.78 <= max(ys) <= 1.95, f"crown height: {max(ys)}"
    assert abs(min(xs) + max(xs)) <= 0.02, f"X asymmetry: {min(xs) + max(xs)}"
    assert max(zs) >= 0.15, f"forward reach missing: {max(zs)}"
    assert max(xs) <= 0.31 and min(xs) >= -0.31, f"shoulder envelope miss: [{min(xs):.3f},{max(xs):.3f}]"

    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
    bpy.ops.export_scene.gltf(
        filepath=str(OUT_GLB),
        export_format="GLB",
        use_selection=False,
        export_apply=False,
        export_skins=True,
        export_morph=False,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_yup=False,
        export_armature_object_remove=True,
    )
    glb_bytes = OUT_GLB.stat().st_size if OUT_GLB.exists() else -1
    dt = time.perf_counter() - T0
    assert dt < 180, f"closed-surface blew 180s CPU budget: {dt:.1f}s"
    print(f"OPERATOR_SAND_CLOSED_SURFACE_BUILD time_s={dt:.1f} tris={tris} "
          f"vram_bytes={vram} glb_bytes={glb_bytes} seed={SEED} threads=2 "
          f"verts={len(body.verts) + len(gear.verts)}")


if __name__ == "__main__":
    main()
