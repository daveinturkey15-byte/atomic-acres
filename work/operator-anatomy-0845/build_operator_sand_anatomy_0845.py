"""Operator Sand ANATOMY 0845: genuinely anatomical, clothed tactical operator.

Source-only slice under work/operator-anatomy-0845/.
Root runs guarded bake; this lane executes only CPU verification (no Blender/GPU/browser).

Run (root only, Windows):
    "C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe" --background --python work/operator-anatomy-0845/build_operator_sand_anatomy_0845.py

Produces (only via root run):
    work/operator-anatomy-0845/operator-sand-anatomy-0845.blend
    work/operator-anatomy-0845/operator-sand-anatomy-0845.glb

Art & Architectural Upgrades vs Toy Mannequin Baseline (0800):
--------------------------------------------------------------
1. Elimination of straight cylinders:
   - Arms: anatomical deltoid-to-bicep slope, tricep volume, bicep belly,
     olecranon elbow point with natural fabric gathers, and pronounced
     brachioradialis forearm taper down to tailored wrist cuffs.
   - Legs: quadriceps forward curvature (+Z), hamstring posterior curve,
     vastus lateralis outer thigh flare, gastrocnemius posterior calf bulge (-Z),
     tapered Achilles tendon, and authentic trouser blousing over boot shafts.
2. Seat & Pelvis:
   - Distinct anatomical gluteal prominence and trouser seat shaping in the rear,
     eliminating the flat vertical board/pipe waist.
3. Tactical Gloves & Hands:
   - Articulated 4-finger cascade curled naturally in tactical ready-carry pose,
     curved dorsal knuckle armor, opposed thenar thumb mass, and wrist gauntlet cuffs.
4. Boots & Soles:
   - Contoured ankle shaft, ergonomic heel counter, rounded protective toecap,
     instep lace throat wedge, and lugged outsole with raised arch shank.
5. Kneepad & Strap Integration (Z-Fight & Crouch Detachment Elimination):
   - Upper and lower straps are mathematically offset proud (+5mm) from the trouser
     rings, eliminating z-fighting and jagged rim intersections.
   - Crucially: kneepads and straps use w_knee(side) smooth joint-blend weighting,
     ensuring they flex seamlessly with the knee during walk/crouch/prone poses
     instead of floating detached in empty space.
6. Plate Carrier & Tactical Contact:
   - Shooter's cut front plate, contoured back plate, padded shoulder straps
     following the trapezius slope, fitted cummerbund, 3 mag pouches with flap lids,
     admin pouch, radio pouch with antenna, and duty belt.

Budgets & Contracts (Standard 21-Bone Rig):
-------------------------------------------
- 12,000 - 22,000 triangles (~16.2k target).
- Exactly 2 skinned primitives: OperatorSand_Body (cloth) and OperatorSand_Gear (gear).
- Exactly 2 materials: Sand_Cloth and Sand_Gear.
- Exactly 3 embedded PNGs (Sand_Cloth_Base 1K, Sand_Gear_Base 1K, Sand_Shared_ORM 512).
- CPU cap: 2 threads fixed, <2 GiB memory, <180s build time.
"""

import math
import random
import sys
import time
from pathlib import Path

THIS = Path(__file__).resolve()
ROOT = THIS.parents[2]
OUT_DIR = ROOT / "work" / "operator-anatomy-0845"
OUT_BLEND = OUT_DIR / "operator-sand-anatomy-0845.blend"
OUT_GLB = OUT_DIR / "operator-sand-anatomy-0845.glb"

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
        _q = REST_WORLD[_p]
        REST_WORLD[_name] = [_q[0] + _o[0], _q[1] + _o[1], _q[2] + _o[2]]

# Palette (sRGB 0-1 floats)
SAND = (0.770, 0.690, 0.560)        # fatigue base
SAND_DK = (0.600, 0.540, 0.430)     # fatigue shade / pads
WEBB = (0.235, 0.235, 0.215)        # carrier webbing
HELM = (0.640, 0.590, 0.490)        # helmet shell
SKIN = (0.790, 0.620, 0.490)        # face / hands
GLOVE = (0.480, 0.410, 0.320)       # glove leather
BOOT = (0.660, 0.570, 0.440)        # boot leather
SOLE = (0.160, 0.150, 0.135)        # sole / kneepad / lens dark
LENS = (0.090, 0.110, 0.140)        # goggle lens

# ---------------------------------------------------------------------------
# Explicit-geometry toolkit
# ---------------------------------------------------------------------------


class Part:
    __slots__ = ("verts", "faces", "uvs", "weights", "smooth")

    def __init__(self):
        self.verts = []     # (x, y, z)
        self.faces = []     # (i, j, k[, l])
        self.uvs = []       # per-face-loop (u, v)
        self.weights = []   # per-vert [(boneIdx, w), ...]
        self.smooth = []    # per-face bool


def _norm_ws(ws):
    s = sum(w for _, w in ws)
    if s <= 1e-8:
        return [(0, 1.0)]
    return [(b, w / s) for b, w in ws]


def rigid(bone):
    return [(BONE_INDEX[bone], 1.0)]


def blend(bone_a, bone_b, t):
    t = min(1.0, max(0.0, t))
    return [(BONE_INDEX[bone_a], 1.0 - t), (BONE_INDEX[bone_b], t)]


def add_loft(part, rings, sides, u_range, v_range, wfn, smooth=True,
             cap_bottom=False, cap_top=False):
    """Anatomically enhanced loft with support for quadrant radii and seat shaping.
    ring keys:
      y: height
      cx, cz: center
      rx, rz: basic radii
      rx_pos, rx_neg, rz_pos, rz_neg: optional asymmetric quadrant radii
      bulge_z: forward (+Z) or rear (-Z) offset
      fold: (amp, freq, phase) cloth ripple
      glute_crease: optional boolean for pelvis seat indentation at midline
    """
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

            # Choose quadrant radius for anatomical muscle contours
            cur_rx = rx_pos if cos_th >= 0.0 else rx_neg
            cur_rz = rz_pos if sin_th >= 0.0 else rz_neg

            wob = 1.0 + fold[0] * math.sin(fold[1] * th + fold[2])

            # Seat cleft in the rear midline
            seat_mod = 1.0
            if glute and sin_th < -0.2:
                # Crease at x ~ 0, rear
                seat_mod = 1.0 - 0.14 * (1.0 - min(1.0, abs(cos_th) / 0.45)) * (-sin_th)

            x = r["cx"] + cur_rx * wob * cos_th
            z = r["cz"] + cur_rz * wob * sin_th * seat_mod + r.get("bulge_z", 0.0)
            y = r["y"]

            part.verts.append((x, y, z))
            part.weights.append(_norm_ws(wfn(x, y, z)))

    # Faces and UVs
    for j in range(nr - 1):
        for i in range(sides):
            a = base + j * sides + i
            b = base + j * sides + (i + 1) % sides
            c = base + (j + 1) * sides + (i + 1) % sides
            d = base + (j + 1) * sides + i
            part.faces.append((a, b, c, d))
            part.smooth.append(smooth)
            u0 = u_range[0] + (u_range[1] - u_range[0]) * i / sides
            u1 = u_range[0] + (u_range[1] - u_range[0]) * (i + 1) / sides
            vv0 = v_range[0] + (v_range[1] - v_range[0]) * j / max(1, nr - 1)
            vv1 = v_range[0] + (v_range[1] - v_range[0]) * (j + 1) / max(1, nr - 1)
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
    """8-vert box with top and Z tapers for contoured plates and pouches."""
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    tt = taper_top
    tz = taper_z
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


# UV Atlas Zones
UV_FATIGUE = (0.02, 0.02, 0.60, 0.98)   # camo fatigue
UV_FACE = (0.63, 0.55, 0.79, 0.97)      # skin face
UV_HAND = (0.81, 0.55, 0.97, 0.97)      # skin hands
UV_GLOVE = (0.81, 0.03, 0.97, 0.50)     # glove leather
UV_PAD = (0.63, 0.03, 0.79, 0.50)       # elbow/shoulder pad cloth
UV_WEB = (0.02, 0.02, 0.48, 0.98)       # webbing + MOLLE shadow
UV_HELM = (0.52, 0.52, 0.73, 0.97)      # helmet shell
UV_BOOT = (0.77, 0.52, 0.97, 0.97)      # boot leather + laces
UV_SOLE = (0.52, 0.03, 0.97, 0.48)      # sole / kneepad / lens dark


# ---------------------------------------------------------------------------
# Weight Fields
# ---------------------------------------------------------------------------

def w_elbow(side):
    a, b = f"{side}Arm", f"{side}ForeArm"

    def fn(x, y, z):
        if y > 1.188:
            return rigid(a)
        if y < 1.088:
            return rigid(b)
        return blend(a, b, (1.188 - y) / 0.10)
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
# BODY primitive (Cloth, Skin, Gloves)
# ---------------------------------------------------------------------------

def build_body():
    p = Part()

    # -- Legs & Trousers: Authentic anatomical curves (quadriceps S-curve,
    # -- gastrocnemius calf belly, tapered Achilles, bloused ankle).
    for side, sgn in (("Left", -1.0), ("Right", 1.0)):
        x_leg = sgn * 0.098
        w_leg = w_knee(side)
        w_hp = w_hip(side)

        def w_trouser(x, y, z, _w_leg=w_leg, _w_hp=w_hp):
            if y > 0.86:
                return _w_hp(x, y, z)
            return _w_leg(x, y, z)

        # 24 rings with anatomical quadrant radii:
        # Vastus lateralis flares outward (|x| > |x_leg|),
        # Quadriceps bulges anteriorly (+Z),
        # Hamstrings / Gluteal fold in posterior (-Z),
        # Gastrocnemius bulges posteriorly (-Z) at y=0.33,
        # Ankle blouses over boot at y=0.15.
        trouser_rings = [
            # Hip cap & Trochanter flare
            {"y": 1.020, "cx": x_leg * 0.92, "cz": 0.002, "rx_pos": 0.096, "rx_neg": 0.096,
             "rz_pos": 0.098, "rz_neg": 0.112},
            {"y": 0.940, "cx": x_leg, "cz": 0.004, "rx_pos": 0.092, "rx_neg": 0.094,
             "rz_pos": 0.102, "rz_neg": 0.106},
            # Upper thigh: Quadriceps muscle belly (+Z) & outer flare
            {"y": 0.880, "cx": x_leg + sgn * 0.004, "cz": 0.007, "rx_pos": 0.090, "rx_neg": 0.092,
             "rz_pos": 0.105, "rz_neg": 0.098},
            {"y": 0.820, "cx": x_leg + sgn * 0.005, "cz": 0.009, "rx_pos": 0.088, "rx_neg": 0.090,
             "rz_pos": 0.104, "rz_neg": 0.094},
            {"y": 0.760, "cx": x_leg + sgn * 0.005, "cz": 0.010, "rx_pos": 0.085, "rx_neg": 0.087,
             "rz_pos": 0.100, "rz_neg": 0.090, "fold": (0.025, 6.0, 0.5)},
            # Mid thigh taper
            {"y": 0.700, "cx": x_leg + sgn * 0.003, "cz": 0.009, "rx_pos": 0.081, "rx_neg": 0.083,
             "rz_pos": 0.094, "rz_neg": 0.086},
            {"y": 0.650, "cx": x_leg + sgn * 0.002, "cz": 0.008, "rx_pos": 0.078, "rx_neg": 0.080,
             "rz_pos": 0.089, "rz_neg": 0.082, "fold": (0.028, 6.0, 0.8)},
            {"y": 0.590, "cx": x_leg, "cz": 0.008, "rx_pos": 0.075, "rx_neg": 0.076,
             "rz_pos": 0.085, "rz_neg": 0.080},
            {"y": 0.540, "cx": x_leg, "cz": 0.009, "rx_pos": 0.074, "rx_neg": 0.074,
             "rz_pos": 0.084, "rz_neg": 0.079, "fold": (0.030, 6.0, 0.8)},
            # Above-knee gather ring
            {"y": 0.490, "cx": x_leg, "cz": 0.010, "rx_pos": 0.073, "rx_neg": 0.073,
             "rz_pos": 0.083, "rz_neg": 0.077},
            {"y": 0.470, "cx": x_leg, "cz": 0.011, "rx_pos": 0.072, "rx_neg": 0.072,
             "rz_pos": 0.084, "rz_neg": 0.075, "bulge_z": 0.009},
            # Knee / Patella: anterior prominence, popliteal crease in back
            {"y": 0.450, "cx": x_leg, "cz": 0.012, "rx_pos": 0.072, "rx_neg": 0.072,
             "rz_pos": 0.085, "rz_neg": 0.074, "bulge_z": 0.008},
            {"y": 0.420, "cx": x_leg, "cz": 0.010, "rx_pos": 0.070, "rx_neg": 0.070,
             "rz_pos": 0.082, "rz_neg": 0.073, "bulge_z": 0.006},
            # Below knee fold
            {"y": 0.380, "cx": x_leg, "cz": 0.006, "rx_pos": 0.066, "rx_neg": 0.066,
             "rz_pos": 0.074, "rz_neg": 0.076, "fold": (0.028, 6.0, 2.0)},
            # Gastrocnemius calf muscle belly: dramatic posterior bulge (-Z)!
            {"y": 0.340, "cx": x_leg, "cz": -0.004, "rx_pos": 0.067, "rx_neg": 0.067,
             "rz_pos": 0.070, "rz_neg": 0.086, "fold": (0.020, 6.0, 2.0)},
            {"y": 0.320, "cx": x_leg, "cz": -0.005, "rx_pos": 0.066, "rx_neg": 0.066,
             "rz_pos": 0.068, "rz_neg": 0.085},
            {"y": 0.300, "cx": x_leg, "cz": -0.005, "rx_pos": 0.065, "rx_neg": 0.065,
             "rz_pos": 0.066, "rz_neg": 0.083},
            # Calf taper into Achilles tendon
            {"y": 0.260, "cx": x_leg, "cz": -0.003, "rx_pos": 0.061, "rx_neg": 0.061,
             "rz_pos": 0.063, "rz_neg": 0.074},
            {"y": 0.220, "cx": x_leg, "cz": -0.001, "rx_pos": 0.058, "rx_neg": 0.058,
             "rz_pos": 0.060, "rz_neg": 0.067},
            {"y": 0.200, "cx": x_leg, "cz": 0.0, "rx_pos": 0.057, "rx_neg": 0.057,
             "rz_pos": 0.059, "rz_neg": 0.065},
            {"y": 0.180, "cx": x_leg, "cz": 0.0, "rx_pos": 0.057, "rx_neg": 0.057,
             "rz_pos": 0.059, "rz_neg": 0.063},
            # Trouser blousing: cloth flares out over the boot top, then folds in
            {"y": 0.155, "cx": x_leg, "cz": 0.002, "rx_pos": 0.069, "rx_neg": 0.069,
             "rz_pos": 0.073, "rz_neg": 0.077, "fold": (0.050, 7.0, 1.2)},
            {"y": 0.130, "cx": x_leg, "cz": 0.001, "rx_pos": 0.068, "rx_neg": 0.068,
             "rz_pos": 0.072, "rz_neg": 0.076, "fold": (0.050, 7.0, 1.2)},
            {"y": 0.110, "cx": x_leg, "cz": 0.0, "rx_pos": 0.063, "rx_neg": 0.063,
             "rz_pos": 0.067, "rz_neg": 0.070},
            {"y": 0.090, "cx": x_leg, "cz": 0.0, "rx_pos": 0.061, "rx_neg": 0.061,
             "rz_pos": 0.065, "rz_neg": 0.068},
        ]
        add_loft(p, trouser_rings, 32, UV_FATIGUE, (0.05, 0.95), w_trouser)

        # Fitted bellows cargo pocket on outer thigh (beveled, conforming)
        add_box(p, x_leg + sgn * 0.082, 0.695, 0.010, 0.048, 0.145, 0.100,
                UV_FATIGUE, w_trouser, taper_top=0.92, taper_z=0.90)

        # -- Arms & Sleeves: Deltoid contour, bicep/tricep volume, olecranon elbow point,
        # -- and muscular forearm taper down to wrist.
        xs = sgn * 0.18
        w_el = w_elbow(side)

        def w_sleeve(x, y, z, _w_el=w_el, _s=side):
            if y > 1.36:
                return blend("Chest", f"{_s}Arm", min(1.0, max(0.0, (1.46 - y) / 0.10)))
            return _w_el(x, y, z)

        sleeve_rings = [
            # Deltoid acromion & cap (flows into shoulder naturally, no floating ball)
            {"y": 1.465, "cx": xs + sgn * 0.008, "cz": 0.0, "rx_pos": 0.084, "rx_neg": 0.084,
             "rz_pos": 0.084, "rz_neg": 0.084},
            {"y": 1.435, "cx": xs + sgn * 0.008, "cz": 0.0, "rx_pos": 0.080, "rx_neg": 0.080,
             "rz_pos": 0.080, "rz_neg": 0.080},
            {"y": 1.400, "cx": xs + sgn * 0.006, "cz": 0.0, "rx_pos": 0.074, "rx_neg": 0.074,
             "rz_pos": 0.075, "rz_neg": 0.075},
            {"y": 1.365, "cx": xs + sgn * 0.004, "cz": 0.0, "rx_pos": 0.068, "rx_neg": 0.068,
             "rz_pos": 0.070, "rz_neg": 0.072},
            # Bicep (+Z) and Tricep (-Z) arm belly
            {"y": 1.330, "cx": xs + sgn * 0.003, "cz": 0.0, "rx_pos": 0.065, "rx_neg": 0.065,
             "rz_pos": 0.069, "rz_neg": 0.075},
            {"y": 1.295, "cx": xs + sgn * 0.002, "cz": 0.0, "rx_pos": 0.063, "rx_neg": 0.063,
             "rz_pos": 0.066, "rz_neg": 0.072},
            {"y": 1.260, "cx": xs, "cz": 0.0, "rx_pos": 0.060, "rx_neg": 0.060,
             "rz_pos": 0.063, "rz_neg": 0.068},
            {"y": 1.220, "cx": xs, "cz": 0.001, "rx_pos": 0.057, "rx_neg": 0.057,
             "rz_pos": 0.059, "rz_neg": 0.063, "fold": (0.025, 6.0, 0.4)},
            {"y": 1.175, "cx": xs, "cz": 0.001, "rx_pos": 0.054, "rx_neg": 0.054,
             "rz_pos": 0.056, "rz_neg": 0.059, "fold": (0.030, 6.0, 0.4)},
            # Elbow joint: Olecranon point protruding in posterior (-Z)
            {"y": 1.138, "cx": xs, "cz": -0.004, "rx_pos": 0.053, "rx_neg": 0.053,
             "rz_pos": 0.054, "rz_neg": 0.060},
            {"y": 1.100, "cx": xs, "cz": -0.002, "rx_pos": 0.055, "rx_neg": 0.055,
             "rz_pos": 0.055, "rz_neg": 0.057, "fold": (0.025, 6.0, 2.2)},
            # Forearm: Proximal brachioradialis / flexor mass (wide, muscular)
            {"y": 1.060, "cx": xs + sgn * 0.002, "cz": 0.001, "rx_pos": 0.054, "rx_neg": 0.054,
             "rz_pos": 0.053, "rz_neg": 0.053},
            {"y": 1.025, "cx": xs + sgn * 0.002, "cz": 0.002, "rx_pos": 0.050, "rx_neg": 0.050,
             "rz_pos": 0.049, "rz_neg": 0.049},
            {"y": 0.990, "cx": xs + sgn * 0.001, "cz": 0.002, "rx_pos": 0.047, "rx_neg": 0.047,
             "rz_pos": 0.046, "rz_neg": 0.046},
            # Forearm taper down towards the wrist
            {"y": 0.955, "cx": xs + sgn * 0.001, "cz": 0.002, "rx_pos": 0.044, "rx_neg": 0.044,
             "rz_pos": 0.043, "rz_neg": 0.043},
            {"y": 0.930, "cx": xs, "cz": 0.002, "rx_pos": 0.043, "rx_neg": 0.043,
             "rz_pos": 0.042, "rz_neg": 0.042},
            {"y": 0.908, "cx": xs, "cz": 0.002, "rx_pos": 0.044, "rx_neg": 0.044,
             "rz_pos": 0.043, "rz_neg": 0.043},
        ]
        add_loft(p, sleeve_rings, 28, UV_FATIGUE, (0.05, 0.95), w_sleeve)

        # Low-profile elbow reinforcement pad (conforming to posterior arm)
        add_sphere(p, xs, 1.138, -0.008, 0.060, 20, 8, sx=0.98, sy=1.20, sz=1.05,
                   phi0=0.0, phi1=math.pi * 0.55, uv_rect=UV_PAD, wfn=w_el)

        # Sleeve cuff ring
        add_loft(p, [
            {"y": 0.908, "cx": xs, "cz": 0.002, "rx": 0.045, "rz": 0.044},
            {"y": 0.880, "cx": xs, "cz": 0.002, "rx": 0.043, "rz": 0.042},
        ], 24, UV_FATIGUE, (0.0, 0.06), w_wrist(side))

        # -- Tactical Gloves: Hand with thenar mass, curved knuckle arch,
        # -- 4 articulated fingers curled in ready-carry pose, and opposed thumb.
        w_hand = w_wrist(side)

        # Glove wrist gauntlet cuff (overlaps sleeve cuff)
        add_loft(p, [
            {"y": 0.888, "cx": xs, "cz": 0.002, "rx": 0.046, "rz": 0.045},
            {"y": 0.862, "cx": xs, "cz": 0.002, "rx": 0.044, "rz": 0.043},
        ], 20, UV_GLOVE, (0.0, 0.15), w_hand)

        # Palm: thicker on thumb side (thenar), wider across knuckles
        add_box(p, xs - sgn * 0.004, 0.816, 0.010, 0.068, 0.096, 0.048,
                UV_GLOVE, w_hand, taper_top=0.92)
        # Dorsal knuckle protective plate (curved, padded)
        add_box(p, xs, 0.796, 0.026, 0.065, 0.025, 0.044, UV_GLOVE, w_hand)

        # 4 Articulated fingers in tactical ready-carry curve:
        # progressive curl around weapon stock/grip
        finger_specs = [
            (-0.024, 0.056, 1.0),  # Index
            (-0.008, 0.062, 1.4),  # Middle
            (+0.008, 0.058, 1.6),  # Ring
            (+0.024, 0.048, 1.8),  # Little
        ]
        for f_idx, (fx, flen, curl_mult) in enumerate(finger_specs):
            curl = 0.004 * curl_mult
            add_loft(p, [
                {"y": 0.772, "cx": xs + fx, "cz": 0.011, "rx": 0.0095, "rz": 0.010},
                {"y": 0.772 - flen * 0.32, "cx": xs + fx, "cz": 0.012 + curl,
                 "rx": 0.0090, "rz": 0.0095},
                {"y": 0.772 - flen * 0.55, "cx": xs + fx, "cz": 0.014 + curl * 1.6,
                 "rx": 0.0085, "rz": 0.0090},
                {"y": 0.772 - flen * 0.78, "cx": xs + fx, "cz": 0.017 + curl * 2.3,
                 "rx": 0.0080, "rz": 0.0085},
                {"y": 0.772 - flen, "cx": xs + fx, "cz": 0.021 + curl * 3.2,
                 "rx": 0.0070, "rz": 0.0075},
            ], 12, UV_GLOVE, (0.05, 0.25), w_hand, cap_top=False, cap_bottom=True)

        # Thumb: Opposed tactical grip with thenar base mass
        add_loft(p, [
            {"y": 0.832, "cx": xs - sgn * 0.034, "cz": 0.016, "rx": 0.0115, "rz": 0.012},
            {"y": 0.810, "cx": xs - sgn * 0.040, "cz": 0.026, "rx": 0.0105, "rz": 0.011},
            {"y": 0.792, "cx": xs - sgn * 0.043, "cz": 0.035, "rx": 0.0095, "rz": 0.010},
            {"y": 0.778, "cx": xs - sgn * 0.044, "cz": 0.042, "rx": 0.0085, "rz": 0.009},
        ], 12, UV_GLOVE, (0.25, 0.45), w_hand, cap_top=False, cap_bottom=True)

    # -- Pelvis & Seat: Shaped trouser seat with anatomical gluteal prominence (-Z)
    # -- and midline fold, connecting waist to trouser legs.
    def w_pelvis(x, y, z):
        if abs(x) < 0.02:
            return rigid("Hips")
        side = "Left" if x < 0 else "Right"
        return w_hip(side)(x, y, z)

    pelvis_rings = [
        # Belt line cinch
        {"y": 1.090, "cx": 0.0, "cz": -0.002, "rx": 0.134, "rz_pos": 0.104, "rz_neg": 0.108},
        {"y": 1.065, "cx": 0.0, "cz": -0.003, "rx": 0.133, "rz_pos": 0.103, "rz_neg": 0.112},
        {"y": 1.040, "cx": 0.0, "cz": -0.005, "rx": 0.132, "rz_pos": 0.102, "rz_neg": 0.116,
         "glute_crease": True},
        # Gluteal seat prominence (buttocks curve backward -Z)
        {"y": 1.015, "cx": 0.0, "cz": -0.008, "rx": 0.130, "rz_pos": 0.102, "rz_neg": 0.122,
         "glute_crease": True},
        {"y": 0.985, "cx": 0.0, "cz": -0.010, "rx": 0.128, "rz_pos": 0.100, "rz_neg": 0.124,
         "glute_crease": True},
        {"y": 0.955, "cx": 0.0, "cz": -0.008, "rx": 0.125, "rz_pos": 0.098, "rz_neg": 0.120,
         "glute_crease": True},
        {"y": 0.930, "cx": 0.0, "cz": -0.005, "rx": 0.122, "rz_pos": 0.096, "rz_neg": 0.112},
        {"y": 0.905, "cx": 0.0, "cz": -0.002, "rx": 0.118, "rz_pos": 0.094, "rz_neg": 0.105},
    ]
    add_loft(p, pelvis_rings, 32, UV_FATIGUE, (0.0, 0.18), w_pelvis)

    # -- Jacket Torso: Athletic V-taper from waist to chest, pectoral shelf (+Z),
    # -- and sloping trapezius/clavicle yoke.
    def w_torso(x, y, z):
        if y > 1.36:
            return rigid("Chest")
        if y > 1.20:
            return blend("Spine", "Chest", (y - 1.20) / 0.16)
        if y > 1.05:
            return blend("Hips", "Spine", (y - 1.05) / 0.15)
        return rigid("Hips")

    torso_rings = [
        # Waist cinch
        {"y": 1.040, "cx": 0.0, "cz": 0.0, "rx": 0.136, "rz_pos": 0.104, "rz_neg": 0.108},
        {"y": 1.095, "cx": 0.0, "cz": 0.002, "rx": 0.140, "rz_pos": 0.106, "rz_neg": 0.108},
        # Lower rib cage
        {"y": 1.140, "cx": 0.0, "cz": 0.003, "rx": 0.148, "rz_pos": 0.110, "rz_neg": 0.112},
        {"y": 1.190, "cx": 0.0, "cz": 0.005, "rx": 0.158, "rz_pos": 0.116, "rz_neg": 0.116},
        # Mid chest & Lats
        {"y": 1.235, "cx": 0.0, "cz": 0.007, "rx": 0.166, "rz_pos": 0.120, "rz_neg": 0.119},
        {"y": 1.275, "cx": 0.0, "cz": 0.009, "rx": 0.174, "rz_pos": 0.124, "rz_neg": 0.121},
        # Pectoral shelf: broad athletic chest
        {"y": 1.320, "cx": 0.0, "cz": 0.010, "rx": 0.179, "rz_pos": 0.126, "rz_neg": 0.122},
        {"y": 1.360, "cx": 0.0, "cz": 0.010, "rx": 0.181, "rz_pos": 0.126, "rz_neg": 0.122},
        # Trapezius / Clavicle yoke slope
        {"y": 1.415, "cx": 0.0, "cz": 0.004, "rx": 0.174, "rz_pos": 0.118, "rz_neg": 0.118,
         "fold": (0.022, 8.0, 0.9)},
        {"y": 1.465, "cx": 0.0, "cz": 0.002, "rx": 0.160, "rz_pos": 0.112, "rz_neg": 0.110,
         "fold": (0.022, 8.0, 0.9)},
        {"y": 1.515, "cx": 0.0, "cz": 0.0, "rx": 0.108, "rz_pos": 0.088, "rz_neg": 0.086},
    ]
    add_loft(p, torso_rings, 32, UV_FATIGUE, (0.0, 1.0), w_torso)

    # Fitted shoulder sleeve patches (conforming to shoulder girdle)
    for side, sgn in (("Left", -1.0), ("Right", 1.0)):
        xs = sgn * 0.198
        add_sphere(p, xs, 1.435, 0.0, 0.084, 20, 8, sx=1.02, sy=1.22, sz=1.04,
                   phi0=0.0, phi1=math.pi * 0.58, uv_rect=UV_PAD,
                   wfn=lambda x, y, z, _s=side: blend("Chest", f"{_s}Arm", 0.65))

    # Collar and neck sock
    def w_neck(x, y, z):
        if y > 1.60:
            return rigid("Neck")
        return blend("Chest", "Neck", min(1.0, max(0.0, (y - 1.50) / 0.10)))

    add_loft(p, [
        {"y": 1.500, "cx": 0.0, "cz": 0.0, "rx": 0.082, "rz": 0.072},
        {"y": 1.540, "cx": 0.0, "cz": 0.001, "rx": 0.074, "rz": 0.066},
        {"y": 1.580, "cx": 0.0, "cz": 0.002, "rx": 0.066, "rz": 0.060},
        {"y": 1.600, "cx": 0.0, "cz": 0.003, "rx": 0.062, "rz": 0.058},
        {"y": 1.620, "cx": 0.0, "cz": 0.004, "rx": 0.058, "rz": 0.056},
    ], 24, UV_FATIGUE, (0.0, 0.2), w_neck)

    # Face & Skull (deformed: brow, nose bridge, jaw taper)
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
               sx=0.94, sy=1.14, sz=1.0, uv_rect=UV_FATIGUE,
               wfn=lambda x, y, z: rigid("Head"), skip_face=eye_window)

    # Hemmed eye opening rim
    brow_y, chin_y = hy + 0.082, hy + 0.018
    add_loft(p, [
        {"y": brow_y, "cx": 0.0, "cz": 0.055, "rx": 0.062, "rz": 0.030},
        {"y": brow_y - 0.006, "cx": 0.0, "cz": 0.058, "rx": 0.064, "rz": 0.030},
    ], 24, UV_FATIGUE, (0.9, 0.98), lambda x, y, z: rigid("Head"))
    add_loft(p, [
        {"y": chin_y + 0.006, "cx": 0.0, "cz": 0.060, "rx": 0.058, "rz": 0.028},
        {"y": chin_y, "cx": 0.0, "cz": 0.057, "rx": 0.056, "rz": 0.028},
    ], 24, UV_FATIGUE, (0.9, 0.98), lambda x, y, z: rigid("Head"))

    return p


# ---------------------------------------------------------------------------
# GEAR primitive (Helmet, Plate Carrier, Pouches, Kneepads, Boots)
# ---------------------------------------------------------------------------

def build_gear():
    g = Part()
    hy = REST_WORLD["Head"][1]

    # -- Helmet: Shell, rim, NVG shroud, ARC side rails, ear-pro comms, chinstrap
    add_sphere(g, 0.0, hy + 0.048, -0.004, 0.126, 28, 14,
               sx=0.98, sy=1.02, sz=1.04, phi0=0.0, phi1=math.pi * 0.62,
               uv_rect=UV_HELM, wfn=lambda x, y, z: rigid("Head"))
    add_loft(g, [
        {"y": hy + 0.018, "cx": 0.0, "cz": -0.004, "rx": 0.128, "rz": 0.132},
        {"y": hy - 0.006, "cx": 0.0, "cz": -0.004, "rx": 0.130, "rz": 0.134},
    ], 28, UV_HELM, (0.0, 0.12), lambda x, y, z: rigid("Head"))
    # NVG shroud
    add_box(g, 0.0, hy + 0.088, 0.118, 0.052, 0.036, 0.030, UV_SOLE,
            lambda x, y, z: rigid("Head"))
    # ARC rails
    for sgn in (-1.0, 1.0):
        add_box(g, sgn * 0.122, hy + 0.045, 0.010, 0.012, 0.055, 0.085,
                UV_SOLE, lambda x, y, z: rigid("Head"))
    # Comms headset
    for sgn in (-1.0, 1.0):
        add_sphere(g, sgn * 0.100, hy + 0.030, 0.002, 0.042, 12, 6,
                   sx=0.70, sy=1.0, sz=0.90, phi0=0.0, phi1=math.pi,
                   uv_rect=UV_SOLE, wfn=lambda x, y, z: rigid("Head"))
    # Chinstrap
    add_loft(g, [
        {"y": hy - 0.010, "cx": 0.0, "cz": 0.020, "rx": 0.096, "rz": 0.088},
        {"y": hy - 0.060, "cx": 0.0, "cz": 0.012, "rx": 0.080, "rz": 0.072},
        {"y": hy - 0.080, "cx": 0.0, "cz": 0.009, "rx": 0.073, "rz": 0.067},
        {"y": hy - 0.100, "cx": 0.0, "cz": 0.006, "rx": 0.066, "rz": 0.062},
    ], 24, UV_SOLE, (0.1, 0.3), lambda x, y, z: rigid("Head"))

    # Tactical Goggles (stowed on helmet)
    add_loft(g, [
        {"y": hy + 0.062, "cx": 0.0, "cz": -0.004, "rx": 0.129, "rz": 0.133},
        {"y": hy + 0.038, "cx": 0.0, "cz": -0.004, "rx": 0.131, "rz": 0.135},
    ], 28, UV_SOLE, (0.0, 0.10), lambda x, y, z: rigid("Head"))
    add_box(g, 0.0, hy + 0.098, 0.104, 0.196, 0.052, 0.030, UV_SOLE,
            lambda x, y, z: rigid("Head"))
    for sgn in (-1.0, 1.0):
        lens = Part()
        add_box(lens, sgn * 0.048, hy + 0.098, 0.120, 0.082, 0.042, 0.008,
                (0.90, 0.05, 0.99, 0.20), lambda x, y, z: rigid("Head"))
        g.verts.extend(lens.verts)
        g.faces.extend(lens.faces)
        g.smooth.extend(lens.smooth)
        g.uvs.extend(lens.uvs)
        g.weights.extend(lens.weights)

    # -- Tactical Plate Carrier: Shooter's cut front plate, back plate, cummerbund,
    # -- MOLLE fields, 3 mag pouches with flap lids, admin pouch, radio, antenna,
    # -- padded shoulder straps, and duty belt.
    chest = lambda x, y, z: rigid("Chest")  # noqa: E731

    # Front plate (shooter's cut taper for arm mobility and weapon stock weld)
    add_box(g, 0.0, 1.335, 0.130, 0.300, 0.330, 0.080, UV_WEB, chest,
            taper_top=0.80)
    # Back plate (flush against upper back)
    add_box(g, 0.0, 1.335, -0.130, 0.300, 0.330, 0.080, UV_WEB, chest,
            taper_top=0.82)
    # Cummerbund band wrapping torso
    add_loft(g, [
        {"y": 1.170, "cx": 0.0, "cz": 0.0, "rx": 0.174, "rz": 0.128},
        {"y": 1.200, "cx": 0.0, "cz": 0.0, "rx": 0.176, "rz": 0.129},
        {"y": 1.230, "cx": 0.0, "cz": 0.0, "rx": 0.178, "rz": 0.130},
    ], 24, UV_WEB, (0.0, 0.12), chest)
    # Side plates on cummerbund
    for sgn in (-1.0, 1.0):
        add_box(g, sgn * 0.168, 1.300, 0.0, 0.042, 0.210, 0.185, UV_WEB,
                chest, taper_top=0.90)
    # MOLLE webbing rows (front 3, back 2)
    for my in (1.250, 1.310, 1.370):
        add_box(g, 0.0, my, 0.172, 0.280, 0.020, 0.012, UV_WEB, chest)
    for my in (1.280, 1.340):
        add_box(g, 0.0, my, -0.172, 0.280, 0.020, 0.012, UV_WEB, chest)
    # Triple mag pouches with secure flap lids
    for px in (-0.088, 0.0, 0.088):
        add_box(g, px, 1.295, 0.196, 0.080, 0.125, 0.064, UV_WEB, chest)
        # Flap lids
        add_box(g, px, 1.365, 0.198, 0.082, 0.028, 0.068, UV_WEB, chest)
    # Admin pouch on upper chest
    add_box(g, 0.0, 1.415, 0.188, 0.130, 0.075, 0.052, UV_WEB, chest)
    # Tactical radio on back-left flank
    add_box(g, 0.065, 1.360, -0.198, 0.108, 0.170, 0.078, UV_WEB, chest)
    add_box(g, 0.0, 1.200, 0.168, 0.058, 0.042, 0.026, UV_SOLE, chest)
    # Padded shoulder straps passing over trapezius
    for sgn in (-1.0, 1.0):
        add_box(g, sgn * 0.100, 1.515, 0.002, 0.058, 0.052, 0.195, UV_WEB, chest)
        # Hardware buckles
        add_box(g, sgn * 0.100, 1.455, 0.092, 0.062, 0.032, 0.020, UV_SOLE, chest)
    # Radio whip antenna
    add_loft(g, [
        {"y": 1.430, "cx": 0.065, "cz": -0.192, "rx": 0.006, "rz": 0.006},
        {"y": 1.560, "cx": 0.067, "cz": -0.196, "rx": 0.005, "rz": 0.005},
        {"y": 1.680, "cx": 0.069, "cz": -0.200, "rx": 0.004, "rz": 0.004},
        {"y": 1.760, "cx": 0.070, "cz": -0.202, "rx": 0.003, "rz": 0.003},
    ], 6, UV_SOLE, (0.5, 0.7), chest)

    # Duty belt & pouches (rigid Hips)
    hips = lambda x, y, z: rigid("Hips")  # noqa: E731
    add_loft(g, [
        {"y": 1.060, "cx": 0.0, "cz": -0.002, "rx": 0.140, "rz": 0.114},
        {"y": 1.084, "cx": 0.0, "cz": -0.002, "rx": 0.141, "rz": 0.115},
        {"y": 1.108, "cx": 0.0, "cz": -0.002, "rx": 0.142, "rz": 0.116},
    ], 24, UV_WEB, (0.1, 0.22), hips)
    add_box(g, 0.0, 1.084, 0.118, 0.052, 0.038, 0.026, UV_SOLE, hips)  # Buckle
    add_box(g, -0.150, 1.030, -0.010, 0.080, 0.100, 0.072, UV_WEB, hips)  # Side utility
    add_box(g, 0.150, 0.980, -0.088, 0.105, 0.125, 0.068, UV_WEB, hips)  # Dump pouch

    # -- Legs & Feet: Kneepads (Z-FIGHT & CROUCH FIX) & Combat Boots
    for side, sgn in (("Left", -1.0), ("Right", 1.0)):
        x_leg = sgn * 0.098
        w_kn = w_knee(side)
        foot = lambda x, y, z, _s=side: rigid(f"{_s}Foot")  # noqa: E731

        # KNEEPAD ERGONOMIC CAP:
        # Centered at knee joint y=0.440. Smooth curved hard cap.
        # Uses w_knee(side) so it articulates seamlessly with the knee joint!
        kp = Part()
        segs, rows = 22, 12
        for j in range(rows + 1):
            yy = 0.490 - 0.00833 * j  # y spans 0.490 down to 0.390 (centered at 0.440)
            # Profile curve: proudest at patella center (y=0.440)
            dy_patella = (yy - 0.440) / 0.050
            z_prominence = 0.088 + 0.008 * max(0.0, 1.0 - dy_patella * dy_patella)
            for i in range(segs + 1):
                th = -1.15 + 2.30 * i / segs
                # Sides curve backward around knee condyles
                kp.verts.append((
                    x_leg + 0.076 * math.sin(th),
                    yy,
                    0.012 + z_prominence * math.cos(th),
                ))
                kp.weights.append(_norm_ws(w_kn(x_leg + 0.076 * math.sin(th), yy, 0.012 + z_prominence * math.cos(th))))
        for j in range(rows):
            for i in range(segs):
                a = j * (segs + 1) + i
                b = a + 1
                c = a + segs + 2
                d = a + segs + 1
                kp.faces.append((a, b, c, d))
                kp.smooth.append(True)
                kp.uvs.extend([(0.55, 0.05), (0.95, 0.05),
                               (0.95, 0.45), (0.55, 0.45)])
        g.verts.extend(kp.verts)
        g.faces.extend(kp.faces)
        g.smooth.extend(kp.smooth)
        g.uvs.extend(kp.uvs)
        g.weights.extend(kp.weights)

        # KNEEPAD RETENTION STRAPS (Upper & Lower):
        # 1. Mathematically offset proud (+6mm) from the trouser rings:
        #    Upper strap sits at y=0.490 .. 0.510 (rx=0.080, rz=0.090) vs trouser (rx=0.073, rz=0.083).
        #    Lower strap sits at y=0.360 .. 0.380 (rx=0.073, rz=0.083) vs trouser (rx=0.066, rz=0.076).
        #    -> ZERO z-fighting or jagged rim intersections!
        # 2. Both straps use w_knee(side):
        #    Upper strap gets ~85% UpLeg, hugging the thigh during crouch!
        #    Lower strap gets ~95% Leg, hugging the calf during crouch!
        #    -> ZERO detachment or floating in midair!
        add_loft(g, [
            {"y": 0.510, "cx": x_leg, "cz": 0.010, "rx": 0.080, "rz": 0.090},
            {"y": 0.490, "cx": x_leg, "cz": 0.010, "rx": 0.079, "rz": 0.089},
        ], 24, UV_SOLE, (0.5, 0.6), w_kn)

        add_loft(g, [
            {"y": 0.380, "cx": x_leg, "cz": 0.004, "rx": 0.073, "rz": 0.083},
            {"y": 0.360, "cx": x_leg, "cz": 0.004, "rx": 0.072, "rz": 0.082},
        ], 24, UV_SOLE, (0.5, 0.6), w_kn)

        # -- Combat Boots: Contoured ankle shaft, heel counter, instep wedge,
        # -- rounded toecap, and lugged outsole with raised arch shank.
        def w_boot(x, y, z, _s=side):
            if y > 0.11:
                return blend(f"{_s}Leg", f"{_s}Foot", (0.22 - y) / 0.11) \
                    if y < 0.22 else rigid(f"{_s}Leg")
            return rigid(f"{_s}Foot")

        # Boot shaft conforming to lower leg and ankle malleoli (9 rings, 24 sides)
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

        # Foot body: Instep arch & forefoot
        add_box(g, x_leg, 0.062, 0.070, 0.096, 0.120, 0.235, UV_BOOT, foot,
                taper_top=0.82)
        # Rounded tactical toe cap (curved forward contour)
        add_box(g, x_leg, 0.048, 0.165, 0.092, 0.082, 0.070, UV_BOOT, foot,
                taper_top=0.65, taper_z=0.75)
        # Instep lace throat wedge (sloping instep, never floats)
        add_box(g, x_leg, 0.106, 0.096, 0.056, 0.052, 0.108, UV_BOOT, foot,
                taper_top=0.65)
        # Ergonomic heel counter wrapping calcaneus
        add_box(g, x_leg, 0.052, -0.046, 0.092, 0.102, 0.064, UV_SOLE, foot,
                taper_top=0.85)

        # Rugged tactical outsole with distinct heel and forefoot lugs (ground plane y=0.0):
        # Outsole perimeter welt
        add_box(g, x_leg, 0.014, 0.066, 0.108, 0.028, 0.252, UV_SOLE, foot)
        # Heel block: base y=0.000 to y=0.032
        add_box(g, x_leg, 0.016, -0.024, 0.106, 0.032, 0.100, UV_SOLE, foot)
        # Forefoot tread block: base y=0.000 to y=0.028
        add_box(g, x_leg, 0.014, 0.116, 0.104, 0.028, 0.145, UV_SOLE, foot)

    return g


# ---------------------------------------------------------------------------
# Procedural PBR Textures
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


def _fbm(x, y, seed):
    return 0.65 * _vnoise(x, y, seed) + 0.35 * _vnoise(x * 2.13 + 7.0, y * 2.13 + 3.0, seed + 11)


def _in_rect(u, v, r):
    return r[0] <= u <= r[2] and r[1] <= v <= r[3]


def paint_cloth_base(W, H):
    out = [0.0] * (W * H * 4)
    rnd = SEED
    for y in range(H):
        v = 1.0 - y / (H - 1)
        for x in range(W):
            u = x / (W - 1)
            weave = _vnoise(x * 0.55, y * 0.55, rnd) - 0.5
            blotch = _fbm(u * 6.0, v * 6.0, rnd + 101) - 0.5
            wear = _fbm(u * 22.0 + 40.0, v * 22.0, rnd + 202) - 0.5
            if _in_rect(u, v, UV_FACE) or _in_rect(u, v, UV_HAND):
                base = SKIN
                k = 1.0 + weave * 0.06 + blotch * 0.04
                r, gg, b = base[0] * k, base[1] * k, base[2] * k
            elif _in_rect(u, v, UV_GLOVE):
                base = GLOVE
                k = 1.0 + weave * 0.10 + wear * 0.12
                r, gg, b = base[0] * k, base[1] * k, base[2] * k
            elif _in_rect(u, v, UV_PAD):
                base = SAND_DK
                stitch = 0.94 if abs((v * 64.0) % 1.0 - 0.5) > 0.42 else 1.0
                k = (1.0 + weave * 0.07 + blotch * 0.10) * stitch
                r, gg, b = base[0] * k, base[1] * k * 1.01, base[2] * k * 0.97
            else:
                k = 1.0 + weave * 0.07 + blotch * 0.13 + wear * 0.05
                r = SAND[0] * k * (1.0 + blotch * 0.06)
                gg = SAND[1] * k * (1.0 + blotch * 0.08)
                b = SAND[2] * k * (1.0 - blotch * 0.10)
            o = (x + y * W) * 4
            out[o] = min(1.0, max(0.0, r))
            out[o + 1] = min(1.0, max(0.0, gg))
            out[o + 2] = min(1.0, max(0.0, b))
            out[o + 3] = 1.0
    return out


def paint_gear_base(W, H):
    out = [0.0] * (W * H * 4)
    rnd = SEED + 500
    for y in range(H):
        v = 1.0 - y / (H - 1)
        for x in range(W):
            u = x / (W - 1)
            grain = _vnoise(x * 0.5, y * 0.5, rnd) - 0.5
            scuff = _fbm(u * 18.0, v * 18.0, rnd + 303) - 0.5
            if _in_rect(u, v, UV_HELM):
                k = 1.0 + grain * 0.08 + scuff * 0.10
                r, gg, b = HELM[0] * k, HELM[1] * k, HELM[2] * k * 0.98
            elif _in_rect(u, v, UV_BOOT):
                lace = 0.90 if abs((u * 90.0) % 1.0 - 0.5) > 0.40 and v > 0.60 else 1.0
                k = (1.0 + grain * 0.09 + scuff * 0.12) * lace
                r, gg, b = BOOT[0] * k, BOOT[1] * k, BOOT[2] * k
            elif _in_rect(u, v, UV_SOLE):
                k = 1.0 + grain * 0.12
                r, gg, b = SOLE[0] * k, SOLE[1] * k, SOLE[2] * k
            else:
                molle = 0.88 if abs((v * 46.0) % 1.0 - 0.5) > 0.38 else 1.0
                k = (1.0 + grain * 0.10 + scuff * 0.08) * molle
                r, gg, b = WEBB[0] * k, WEBB[1] * k, WEBB[2] * k
            o = (x + y * W) * 4
            out[o] = min(1.0, max(0.0, r))
            out[o + 1] = min(1.0, max(0.0, gg))
            out[o + 2] = min(1.0, max(0.0, b))
            out[o + 3] = 1.0
    return out


def paint_shared_orm(W, H):
    out = [0.0] * (W * H * 4)
    for y in range(H):
        v = 1.0 - y / (H - 1)
        for x in range(W):
            u = x / (W - 1)
            if _in_rect(u, v, UV_HELM) or _in_rect(u, v, UV_BOOT):
                rough = 0.62
            elif _in_rect(u, v, UV_SOLE):
                rough = 0.50
            else:
                rough = 0.85
            o = (x + y * W) * 4
            out[o] = 1.0
            out[o + 1] = rough
            out[o + 2] = 0.0
            out[o + 3] = 1.0
    return out


# ---------------------------------------------------------------------------
# Blender Assembly (Headless root execution)
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

    # Geometry tables
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

    def _assert_buf(buf, label, r_lo, r_hi, g_lo, g_hi, b_lo, b_hi, g_span_min=0.0, red_span_min=0.02):
        n = len(buf) // 4
        step = max(1, n // 4096)
        sr = sg = sb = 0.0
        mn_r = mn_g = mn_b = 1e9
        mx_r = mx_g = mx_b = -1e9
        cnt = 0
        for i in range(0, n, step):
            o = i * 4
            r, gg, b = buf[o], buf[o + 1], buf[o + 2]
            sr += r
            sg += gg
            sb += b
            if r < mn_r:
                mn_r = r
            if r > mx_r:
                mx_r = r
            if gg < mn_g:
                mn_g = gg
            if gg > mx_g:
                mx_g = gg
            if b < mn_b:
                mn_b = b
            if b > mx_b:
                mx_b = b
            cnt += 1
        mr, mg, mb = sr / cnt, sg / cnt, sb / cnt
        assert r_lo <= mr <= r_hi, f"{label} mean R {mr:.3f} outside [{r_lo},{r_hi}]"
        assert g_lo <= mg <= g_hi, f"{label} mean G {mg:.3f} outside [{g_lo},{g_hi}]"
        assert b_lo <= mb <= b_hi, f"{label} mean B {mb:.3f} outside [{b_lo},{b_hi}]"
        assert (mx_g - mn_g) >= g_span_min, f"{label} G span {mx_g - mn_g:.3f} < {g_span_min}"
        assert (mx_r - mn_r) >= red_span_min, f"{label} red span {mx_r - mn_r:.3f} < {red_span_min}"
        return mr, mg, mb

    cloth_px = paint_cloth_base(1024, 1024)
    _assert_buf(cloth_px, "Sand_Cloth_Base", 0.30, 0.85, 0.25, 0.80, 0.15, 0.70)
    gear_px = paint_gear_base(1024, 1024)
    _assert_buf(gear_px, "Sand_Gear_Base", 0.15, 0.70, 0.15, 0.70, 0.10, 0.65)
    orm_px = paint_shared_orm(512, 512)
    _assert_buf(orm_px, "Sand_Shared_ORM", 0.99, 1.0, 0.50, 0.90, 0.0, 0.01, g_span_min=0.20, red_span_min=0.0)

    img_cloth = bpy.data.images.new("Sand_Cloth_Base", 1024, 1024, alpha=True)
    img_cloth.file_format = "PNG"
    img_cloth.colorspace_settings.name = "sRGB"
    img_cloth.pixels.foreach_set(cloth_px)
    _commit_image(img_cloth)

    img_gear = bpy.data.images.new("Sand_Gear_Base", 1024, 1024, alpha=True)
    img_gear.file_format = "PNG"
    img_gear.colorspace_settings.name = "sRGB"
    img_gear.pixels.foreach_set(gear_px)
    _commit_image(img_gear)

    img_orm = bpy.data.images.new("Sand_Shared_ORM", 512, 512, alpha=True)
    img_orm.file_format = "PNG"
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

    # Verification assertions
    assert 12000 <= tris <= 22000, f"triangle budget miss: {tris}"
    assert len(obj_body.data.materials) == 1, "body material count != 1"
    assert len(obj_gear.data.materials) == 1, "gear material count != 1"
    assert len(bpy.data.materials) <= 2, f"material count > 2: {len(bpy.data.materials)}"
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

    bone_idx = BONE_INDEX
    pair_count = {}
    rigid_count = {}
    for ws in body.weights + gear.weights:
        nz = [w for w in ws if w[1] > 1e-6]
        w_sum = sum(w[1] for w in nz)
        assert abs(w_sum - 1.0) <= 0.02, f"unnormalized weight sum: {w_sum}"
        assert all(0 <= b < 21 for b, _ in nz), "bone index out of range"
        bones = sorted([w[0] for w in nz])
        if len(bones) == 1:
            rigid_count[bones[0]] = rigid_count.get(bones[0], 0) + 1
        elif len(bones) == 2:
            k = f"{bones[0]}+{bones[1]}"
            pair_count[k] = pair_count.get(k, 0) + 1

    for label, a, b_name in [
        ("elbow.L", "LeftArm", "LeftForeArm"), ("elbow.R", "RightArm", "RightForeArm"),
        ("knee.L", "LeftUpLeg", "LeftLeg"), ("knee.R", "RightUpLeg", "RightLeg"),
    ]:
        k = "+".join(map(str, sorted([bone_idx[a], bone_idx[b_name]])))
        got = pair_count.get(k, 0)
        assert got >= 100, f"weight blend {label} got {got} < 100"

    for b_name in ["Head", "Chest", "LeftFoot", "RightFoot"]:
        got = rigid_count.get(bone_idx[b_name], 0)
        assert got >= 100, f"rigid weight {b_name} got {got} < 100"

    body_tris = sum(len(f) - 2 for f in body.faces)
    gear_tris = sum(len(f) - 2 for f in gear.faces)
    assert 14000 <= tris <= 19000, f"anatomy0845 total miss: {tris}"
    assert body_tris > 9952 + 400, f"anatomy0845 body growth miss: {body_tris}"
    assert gear_tris > 3644 + 200, f"anatomy0845 gear growth miss: {gear_tris}"
    assert max(xs) <= 0.31 and min(xs) >= -0.31, f"shoulder envelope miss: [{min(xs):.3f},{max(xs):.3f}]"
    assert max(zs) <= 0.30, f"forward reach runaway: {max(zs):.3f}"
    assert str(OUT_GLB).endswith("operator-sand-anatomy-0845.glb"), f"output mismatch: {OUT_GLB}"
    assert "operator-anatomy-0845" in str(OUT_BLEND), f"blend lane mismatch: {OUT_BLEND}"

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
    assert dt < 180, f"anatomy0845 blew 180s CPU budget: {dt:.1f}s"
    print(f"OPERATOR_SAND_ANATOMY0845_BUILD time_s={dt:.1f} tris={tris} body={body_tris} gear={gear_tris} "
          f"vram_bytes={vram} glb_bytes={glb_bytes} seed={SEED} threads=2 "
          f"verts={len(body.verts) + len(gear.verts)}")


if __name__ == "__main__":
    main()
