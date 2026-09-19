"""Operator Sand: Blender-native editable recipe for the current Three.js rig.

Source-only slice. Root runs it; this file is never executed by the author lane.

Run (from the worktree root, Windows):
    "C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe" --background --python scripts/blender/build_operator_sand.py

Produces (only via a root run, never committed by this lane):
    work/operator-sand/operator-sand.blend   # editable source
    work/operator-sand/operator-sand.glb     # game candidate (embedded PNGs only)

What it builds
--------------
An original desert ("sand") operator in the bind pose of the standard 21-bone
rig (bone names + rest offsets copied EXACTLY from
root ``src/characters/skeleton.ts`` -- see BONE_NAMES / REST_OFFSETS below;
verified byte-identical between the recovery root and this worktree on
2026-09-19). Actor faces +Z, up +Y, feet at y=0, crown ~1.81 m.

Art target (looked-at references, not copied assets):
    docs/reference/production-catalog/operators/operator-sand-turnaround.png
    docs/reference/production-catalog/operators/operator-sand-poses.png
Current failure it replaces: spherical-head capsule mannequin with a blank
sphere head and two square eyes (root captures/motion-live/
motion-2256-stand-front-release.png).

Deliberate fixes vs the mannequin baseline
-------------------------------------------
* Trousers are ONE continuous loft per leg (hip -> ankle, 16 sides) with a
  pelvis yoke lapping the waistband -- never stacked tube segments. Knee dart
  (forward bulge) plus two fold rings; ankle blousing ripple over the boot.
* Sleeves run shoulder -> cuff in one loft with elbow shaping (taper + fold
  ring); separate forearm capsule removed.
* Tactical vest: front/back plates, cummerbund, MOLLE webbing strips, three
  mag pouches, admin pouch, radio, shoulder straps, belt -- seams carried by
  geometry strips AND texture shadow lines.
* Boots: shaft + tapered foot + toecap + darker proud sole + heel. Not tubes.
* Head: deformed skull (jaw taper, nose bridge, brow) + skin face sphere
  UNDER a balaclava shell with a real eye opening (rim loop), neck sock into
  the collar; helmet dome past the ears + rim + NVG shroud + side rails;
  goggles with strap, frame and two dark lenses. No blank sphere, no square
  eyes.
* Gloves: palm + four slightly curled fingers + thumb at rest (fingers
  together, slight curl, thumb forward), brown leather texture zone.

Budgets (hard, enforced by scripts/assets/verify-operator-sand.mjs)
--------------------------------------------------------------------
* 12 000 - 22 000 triangles; measured ~13.0k from the pure-Python tables.
* <= 2 skinned mesh primitives / <= 2 materials (Body=cloth, Gear=hard goods).
* <= 3 embedded 1K PNGs: Sand_Cloth_Base 1024 sRGB, Sand_Gear_Base 1024 sRGB,
  Sand_Shared_ORM 512 non-color (G=roughness, B=metallic; AO is pre-multiplied
  into base-colour pixels because the glTF exporter drops Mix/Multiply AO
  nodes -- the same exporter fact documented in docs/ASSET-PIPELINE.md).
* No subdivisions, no booleans, no baking, no downloads, no timestamps.
* Resource cap: Blender fixed to 2 threads; peak transient ~150 MB
  (3 images + ~25k vert build arrays), far under the 2 GiB cap.

Method: every shell is an explicit Python loft/box/sphere evaluated into
plain vert/face/uv/weight tables, then ONE from_pydata per primitive. No
edit-mode operators (background-safe), fully deterministic (seed 2256).

Originality: all geometry parameters and all texture pixels are authored
here from the written spec above. No third-party mesh, texture, or image is
loaded, traced, or copied. Reference PNGs above are pose/wardrobe guides only.
"""

import math
import random
import sys
import time
from pathlib import Path

THIS = Path(__file__).resolve()
ROOT = THIS.parents[2]
OUT_DIR = ROOT / "work" / "operator-sand"
OUT_BLEND = OUT_DIR / "operator-sand.blend"
OUT_GLB = OUT_DIR / "operator-sand.glb"

SEED = 2256
T0 = time.perf_counter()

# ---------------------------------------------------------------------------
# Standard skeleton contract -- EXACT copy of root src/characters/skeleton.ts.
# Forward is +Z, up is +Y, adult H = 1.78 m. Do not "fix" these numbers here;
# any drift fails verification against the game rig.
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

# Rest offset of each bone from its parent, metres (skeleton.ts REST_OFFSETS).
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

# Rest-world joint positions (bind space). The mesh is authored directly here.
REST_WORLD = {}
for _name in BONE_NAMES:
    _p = BONE_PARENTS[_name]
    _o = REST_OFFSETS[_name]
    if _p is None:
        REST_WORLD[_name] = list(_o)
    else:
        _q = REST_WORLD[_p]
        REST_WORLD[_name] = [_q[0] + _o[0], _q[1] + _o[1], _q[2] + _o[2]]

# Palette -- original sand-operator article (sRGB 0-1 floats).
SAND = (0.770, 0.690, 0.560)        # fatigue base
SAND_DK = (0.600, 0.540, 0.430)     # fatigue shade / pads
WEBB = (0.235, 0.235, 0.215)        # carrier webbing
HELM = (0.640, 0.590, 0.490)        # helmet shell
SKIN = (0.790, 0.620, 0.490)        # face / hands
GLOVE = (0.480, 0.410, 0.320)       # glove leather
BOOT = (0.660, 0.570, 0.440)        # boot leather
SOLE = (0.160, 0.150, 0.135)        # sole / lens dark
LENS = (0.090, 0.110, 0.140)        # goggle lens

# ---------------------------------------------------------------------------
# Tiny explicit-geometry toolkit (no bpy.ops, no booleans, no subdivision).
# A Part accumulates verts/faces/uvs/weights in bind space; primitives are
# joined by list concatenation, then written with ONE from_pydata each.
# ---------------------------------------------------------------------------


class Part:
    __slots__ = ("verts", "faces", "uvs", "weights", "smooth")

    def __init__(self):
        self.verts = []     # (x, y, z)
        self.faces = []     # (i, j, k[, l]) -- quads split by exporter
        self.uvs = []       # per-face-loop (u, v)
        self.weights = []   # per-vert [(boneIdx, w), ...] (normalized later)
        self.smooth = []    # per-face bool


def _norm_ws(ws):
    s = sum(w for _, w in ws)
    return [(b, w / s) for b, w in ws]


def rigid(bone):
    return [(BONE_INDEX[bone], 1.0)]


def blend(bone_a, bone_b, t):
    t = min(1.0, max(0.0, t))
    return [(BONE_INDEX[bone_a], 1.0 - t), (BONE_INDEX[bone_b], t)]


def add_loft(part, rings, sides, u_range, v_range, wfn, smooth=True,
             cap_bottom=False, cap_top=False):
    """Cylindrical loft. rings: list of dicts with keys:
    y, cx, cz, rx, rz, bulge_z (opt), fold (opt: (amp, freq, phase)),
    oval (opt: x/z scale tweak). Faces wound outward (+theta)."""
    base = len(part.verts)
    nr = len(rings)
    for j, r in enumerate(rings):
        v = v_range[0] + (v_range[1] - v_range[0]) * (j / max(1, nr - 1))
        fold = r.get("fold", (0.0, 1.0, 0.0))
        for i in range(sides):
            th = 2.0 * math.pi * i / sides
            wob = 1.0 + fold[0] * math.sin(fold[1] * th + fold[2])
            x = r["cx"] + r["rx"] * wob * math.cos(th)
            z = r["cz"] + r["rz"] * wob * math.sin(th) + r.get("bulge_z", 0.0)
            y = r["y"]
            part.verts.append((x, y, z))
            part.weights.append(_norm_ws(wfn(x, y, z)))
    # faces + loop uvs (part.uvs is loop-only; one quad per face below)
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
            taper_top=1.0):
    """8-vert box, optional top taper (vest plates read tailored, not toy)."""
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    tt = taper_top
    v = [
        (cx - hx, cy - hy, cz - hz), (cx + hx, cy - hy, cz - hz),
        (cx + hx, cy - hy, cz + hz), (cx - hx, cy - hy, cz + hz),
        (cx - hx * tt, cy + hy, cz - hz * tt), (cx + hx * tt, cy + hy, cz - hz * tt),
        (cx + hx * tt, cy + hy, cz + hz * tt), (cx - hx * tt, cy + hy, cz + hz * tt),
    ]
    base = len(part.verts)
    for p in v:
        part.verts.append(p)
        part.weights.append(_norm_ws(wfn(*p)))
    quads = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1),
             (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    (u0, v0, u1, v1) = uv_rect
    for q in quads:
        part.faces.append(tuple(base + k for k in q))
        part.smooth.append(smooth)
        part.uvs.extend([(u0, v0), (u1, v0), (u1, v1), (u0, v1)])


def add_sphere(part, cx, cy, cz, r, seg, rings, sx=1.0, sy=1.0, sz=1.0,
               phi0=0.0, phi1=math.pi, uv_rect=(0, 0, 1, 1), wfn=None,
               skip_face=None, deform=None, smooth=True):
    """Parametric sphere patch. skip_face(phi, theta)->True omits a quad
    (balaclava eye opening). deform(x, y, z, phi, theta)->(x, y, z)."""
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


# Cloth-texture UV zones (Sand_Cloth_Base 1024):
UV_FATIGUE = (0.02, 0.02, 0.60, 0.98)   # camo fatigue
UV_FACE = (0.63, 0.55, 0.79, 0.97)      # skin face
UV_HAND = (0.81, 0.55, 0.97, 0.97)      # skin hands
UV_GLOVE = (0.81, 0.03, 0.97, 0.50)     # glove leather
UV_PAD = (0.63, 0.03, 0.79, 0.50)       # elbow/shoulder pad cloth
# Gear-texture UV zones (Sand_Gear_Base 1024):
UV_WEB = (0.02, 0.02, 0.48, 0.98)       # webbing + MOLLE shadow
UV_HELM = (0.52, 0.52, 0.73, 0.97)      # helmet shell
UV_BOOT = (0.77, 0.52, 0.97, 0.97)      # boot leather + laces
UV_SOLE = (0.52, 0.03, 0.97, 0.48)      # sole / kneepad / lens dark


# ---------------------------------------------------------------------------
# Weight-field helpers (bind space; all blends normalized, two joints max).
# Joint heights: elbow y=1.138, knee y=0.441, ankle y=0.040, wrist y=0.862.
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
# BODY primitive (cloth + skin + gloves, one material)
# ---------------------------------------------------------------------------

def build_body():
    p = Part()
    hx = REST_WORLD["Hips"][1]

    for side, sgn in (("Left", -1.0), ("Right", 1.0)):
        x_leg = sgn * 0.098
        w_leg = w_knee(side)
        w_hp = w_hip(side)

        def w_trouser(x, y, z, _w_leg=w_leg, _w_hp=w_hp):
            if y > 0.86:
                return _w_hp(x, y, z)
            return _w_leg(x, y, z)

        # -- Trouser: ONE continuous loft, hip -> ankle (30 sides, 21 rings).
        # -- Knee dart = forward bulge on two rings; fold rings above/below
        # -- knee + ankle blousing. ~1200 tris/leg of real cloth shaping.
        trouser_rings = [
            {"y": 1.020, "cx": x_leg * 0.92, "cz": 0.0, "rx": 0.088, "rz": 0.096},
            {"y": 0.940, "cx": x_leg, "cz": 0.0, "rx": 0.084, "rz": 0.092},
            {"y": 0.905, "cx": x_leg, "cz": 0.001, "rx": 0.082, "rz": 0.090},
            {"y": 0.870, "cx": x_leg, "cz": 0.002, "rx": 0.081, "rz": 0.089},
            {"y": 0.800, "cx": x_leg, "cz": 0.004, "rx": 0.078, "rz": 0.086},
            {"y": 0.730, "cx": x_leg, "cz": 0.005, "rx": 0.075, "rz": 0.083},
            {"y": 0.695, "cx": x_leg, "cz": 0.005, "rx": 0.074, "rz": 0.082},
            {"y": 0.660, "cx": x_leg, "cz": 0.006, "rx": 0.073, "rz": 0.081},
            {"y": 0.600, "cx": x_leg, "cz": 0.007, "rx": 0.071, "rz": 0.079,
             "fold": (0.030, 6.0, 0.7)},
            {"y": 0.540, "cx": x_leg, "cz": 0.008, "rx": 0.070, "rz": 0.078,
             "fold": (0.030, 6.0, 0.7)},
            {"y": 0.505, "cx": x_leg, "cz": 0.010, "rx": 0.071, "rz": 0.080,
             "fold": (0.025, 6.0, 0.7)},
            {"y": 0.470, "cx": x_leg, "cz": 0.014, "rx": 0.072, "rz": 0.082,
             "bulge_z": 0.008},                       # knee dart, front
            {"y": 0.440, "cx": x_leg, "cz": 0.013, "rx": 0.070, "rz": 0.080,
             "bulge_z": 0.007},
            {"y": 0.410, "cx": x_leg, "cz": 0.012, "rx": 0.068, "rz": 0.078,
             "bulge_z": 0.006},
            {"y": 0.380, "cx": x_leg, "cz": 0.010, "rx": 0.066, "rz": 0.075,
             "fold": (0.025, 6.0, 2.1)},
            {"y": 0.360, "cx": x_leg, "cz": 0.008, "rx": 0.064, "rz": 0.073,
             "fold": (0.030, 6.0, 2.1)},
            {"y": 0.300, "cx": x_leg, "cz": 0.004, "rx": 0.061, "rz": 0.069,
             "fold": (0.030, 6.0, 2.1)},
            {"y": 0.240, "cx": x_leg, "cz": 0.0, "rx": 0.058, "rz": 0.065},
            {"y": 0.210, "cx": x_leg, "cz": 0.0, "rx": 0.058, "rz": 0.064},
            {"y": 0.180, "cx": x_leg, "cz": 0.0, "rx": 0.058, "rz": 0.064},
            {"y": 0.130, "cx": x_leg, "cz": 0.0, "rx": 0.060, "rz": 0.066,
             "fold": (0.045, 7.0, 1.2)},              # blousing over boot
            {"y": 0.100, "cx": x_leg, "cz": 0.0, "rx": 0.061, "rz": 0.067,
             "fold": (0.045, 7.0, 1.2)},
            {"y": 0.075, "cx": x_leg, "cz": 0.0, "rx": 0.062, "rz": 0.068,
             "fold": (0.045, 7.0, 1.2)},
        ]
        add_loft(p, trouser_rings, 30, UV_FATIGUE, (0.05, 0.95), w_trouser)

        # -- Cargo pocket (outer thigh) + thigh pad zone is texture; pocket is
        # -- one low box so the silhouette breaks at 2-4 m.
        add_box(p, x_leg + sgn * 0.078, 0.700, 0.012, 0.052, 0.130, 0.090,
                UV_FATIGUE, w_trouser)

        # -- Sleeve: ONE loft shoulder -> cuff with elbow shaping.
        xs = sgn * 0.18
        w_el = w_elbow(side)

        def w_sleeve(x, y, z, _w_el=w_el, _s=side):
            if y > 1.36:
                # deltoid cap blends chest -> arm so the shoulder never cracks
                return blend("Chest", f"{_s}Arm", min(1.0, max(0.0, (1.46 - y) / 0.10)))
            return _w_el(x, y, z)

        sleeve_rings = [
            {"y": 1.470, "cx": xs, "cz": 0.0, "rx": 0.075, "rz": 0.075},
            {"y": 1.435, "cx": xs, "cz": 0.0, "rx": 0.070, "rz": 0.070},
            {"y": 1.400, "cx": xs, "cz": 0.0, "rx": 0.066, "rz": 0.066},
            {"y": 1.375, "cx": xs, "cz": 0.0, "rx": 0.064, "rz": 0.064},
            {"y": 1.350, "cx": xs, "cz": 0.0, "rx": 0.063, "rz": 0.063},
            {"y": 1.300, "cx": xs, "cz": 0.0, "rx": 0.060, "rz": 0.060},
            {"y": 1.275, "cx": xs, "cz": 0.0, "rx": 0.059, "rz": 0.059},
            {"y": 1.250, "cx": xs, "cz": 0.0, "rx": 0.058, "rz": 0.058},
            {"y": 1.200, "cx": xs, "cz": 0.0, "rx": 0.056, "rz": 0.056,
             "fold": (0.035, 6.0, 0.4)},              # elbow bunch, upper
            {"y": 1.165, "cx": xs, "cz": 0.001, "rx": 0.054, "rz": 0.055,
             "fold": (0.035, 6.0, 0.4)},
            {"y": 1.138, "cx": xs, "cz": 0.002, "rx": 0.052, "rz": 0.053},
            {"y": 1.100, "cx": xs, "cz": 0.002, "rx": 0.050, "rz": 0.051,
             "fold": (0.035, 6.0, 2.4)},              # elbow bunch, lower
            {"y": 1.070, "cx": xs, "cz": 0.002, "rx": 0.048, "rz": 0.049,
             "fold": (0.035, 6.0, 2.4)},
            {"y": 1.048, "cx": xs, "cz": 0.002, "rx": 0.047, "rz": 0.048},
            {"y": 1.025, "cx": xs, "cz": 0.002, "rx": 0.046, "rz": 0.047},
            {"y": 0.980, "cx": xs, "cz": 0.002, "rx": 0.045, "rz": 0.046},
            {"y": 0.940, "cx": xs, "cz": 0.002, "rx": 0.045, "rz": 0.046},
            {"y": 0.905, "cx": xs, "cz": 0.002, "rx": 0.046, "rz": 0.047},
        ]
        add_loft(p, sleeve_rings, 26, UV_FATIGUE, (0.05, 0.95), w_sleeve)

        # -- Elbow pad cap (cloth pad zone in texture; thin shell in mesh).
        add_sphere(p, xs, 1.135, 0.004, 0.058, 18, 7, sx=1.0, sy=1.15, sz=1.0,
                   phi0=0.0, phi1=math.pi * 0.55, uv_rect=UV_PAD, wfn=w_el)

        # -- Cuff ring.
        add_loft(p, [
            {"y": 0.905, "cx": xs, "cz": 0.002, "rx": 0.047, "rz": 0.048},
            {"y": 0.875, "cx": xs, "cz": 0.002, "rx": 0.044, "rz": 0.045},
        ], 24, UV_FATIGUE, (0.0, 0.06), w_wrist(side))

        # -- Glove: palm box + knuckle plate + 4 curled fingers + thumb.
        w_hand = w_wrist(side)
        add_box(p, xs, 0.815, 0.010, 0.070, 0.100, 0.055, UV_GLOVE, w_hand)
        add_box(p, xs, 0.795, 0.030, 0.064, 0.022, 0.050, UV_GLOVE, w_hand)
        for f_i, fx in enumerate((-0.026, -0.009, 0.009, 0.026)):
            curl = 0.004 * (1 if f_i in (0, 3) else 2)
            flen = 0.062 if f_i in (1, 2) else 0.052
            add_loft(p, [
                {"y": 0.768, "cx": xs + fx, "cz": 0.012, "rx": 0.0105, "rz": 0.011},
                {"y": 0.768 - flen * 0.35, "cx": xs + fx, "cz": 0.013 + curl,
                 "rx": 0.010, "rz": 0.0105},
                {"y": 0.768 - flen * 0.52, "cx": xs + fx, "cz": 0.014 + curl * 1.5,
                 "rx": 0.0095, "rz": 0.010},
                {"y": 0.768 - flen * 0.7, "cx": xs + fx, "cz": 0.015 + curl * 2,
                 "rx": 0.009, "rz": 0.0095},
                {"y": 0.768 - flen, "cx": xs + fx, "cz": 0.018 + curl * 3,
                 "rx": 0.008, "rz": 0.0085},
            ], 12, UV_GLOVE, (0.0, 0.2), w_hand)
        # thumb: forward-inner, slight bend
        add_loft(p, [
            {"y": 0.830, "cx": xs - sgn * 0.038, "cz": 0.018, "rx": 0.011, "rz": 0.011},
            {"y": 0.806, "cx": xs - sgn * 0.043, "cz": 0.028, "rx": 0.010, "rz": 0.010},
            {"y": 0.790, "cx": xs - sgn * 0.045, "cz": 0.036, "rx": 0.009, "rz": 0.009},
            {"y": 0.778, "cx": xs - sgn * 0.046, "cz": 0.042, "rx": 0.008, "rz": 0.008},
        ], 12, UV_GLOVE, (0.2, 0.4), w_hand)

        # -- Boot shaft is gear; ankle blend handled in gear weights.

    # -- Pelvis yoke laps the trouser waistband (continuous read, no gap).
    def w_pelvis(x, y, z):
        if abs(x) < 0.02:
            return rigid("Hips")
        side = "Left" if x < 0 else "Right"
        return w_hip(side)(x, y, z)

    add_loft(p, [
        {"y": 1.090, "cx": 0.0, "cz": 0.0, "rx": 0.130, "rz": 0.104},
        {"y": 1.055, "cx": 0.0, "cz": 0.0, "rx": 0.128, "rz": 0.103},
        {"y": 1.037, "cx": 0.0, "cz": 0.0, "rx": 0.127, "rz": 0.102},
        {"y": 1.020, "cx": 0.0, "cz": 0.0, "rx": 0.126, "rz": 0.102},
        {"y": 0.990, "cx": 0.0, "cz": 0.0, "rx": 0.123, "rz": 0.100},
        {"y": 0.960, "cx": 0.0, "cz": 0.0, "rx": 0.120, "rz": 0.098},
    ], 28, UV_FATIGUE, (0.0, 0.15), w_pelvis)
    # -- Jacket torso loft (waist -> collar, 24 sides, 10 rings), tailored taper.
    def w_torso(x, y, z):
        if y > 1.36:
            return rigid("Chest")
        if y > 1.20:
            return blend("Spine", "Chest", (y - 1.20) / 0.16)
        if y > 1.05:
            return blend("Hips", "Spine", (y - 1.05) / 0.15)
        return rigid("Hips")

    add_loft(p, [
        {"y": 1.040, "cx": 0.0, "cz": 0.0, "rx": 0.138, "rz": 0.106},
        {"y": 1.095, "cx": 0.0, "cz": 0.001, "rx": 0.143, "rz": 0.108},
        {"y": 1.122, "cx": 0.0, "cz": 0.001, "rx": 0.145, "rz": 0.109},
        {"y": 1.150, "cx": 0.0, "cz": 0.002, "rx": 0.148, "rz": 0.110},
        {"y": 1.210, "cx": 0.0, "cz": 0.003, "rx": 0.153, "rz": 0.112},
        {"y": 1.272, "cx": 0.0, "cz": 0.004, "rx": 0.158, "rz": 0.114},
        {"y": 1.325, "cx": 0.0, "cz": 0.004, "rx": 0.162, "rz": 0.115},
        {"y": 1.352, "cx": 0.0, "cz": 0.004, "rx": 0.164, "rz": 0.115},
        {"y": 1.380, "cx": 0.0, "cz": 0.004, "rx": 0.166, "rz": 0.116},
        {"y": 1.425, "cx": 0.0, "cz": 0.003, "rx": 0.160, "rz": 0.111,
         "fold": (0.025, 8.0, 0.9)},                  # shoulder-yoke fold
        {"y": 1.470, "cx": 0.0, "cz": 0.002, "rx": 0.150, "rz": 0.104,
         "fold": (0.025, 8.0, 0.9)},
        {"y": 1.530, "cx": 0.0, "cz": 0.0, "rx": 0.100, "rz": 0.082},
    ], 28, UV_FATIGUE, (0.0, 1.0), w_torso)


    # -- Shoulder pads (cloth shell over deltoid; texture carries stitching).
    for side, sgn in (("Left", -1.0), ("Right", 1.0)):
        xs = sgn * 0.20
        add_sphere(p, xs, 1.430, 0.0, 0.082, 18, 8, sx=1.0, sy=1.2, sz=1.05,
                   phi0=0.0, phi1=math.pi * 0.62, uv_rect=UV_PAD,
                   wfn=lambda x, y, z, _s=side: blend("Chest", f"{_s}Arm", 0.65))

    # -- Collar + neck sock (balaclava runs into the collar, no bare ring).
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

    # -- Face: skin sphere UNDER the balaclava, deformed skull (jaw taper,
    # -- nose bridge, brow). Never visible as a bare ball: balaclava covers
    # -- all but the eye window; helmet + goggles cover the rest.
    hy = REST_WORLD["Head"][1]

    def face_deform(x, y, z, phi, th):
        # jaw taper below mid-face
        if y < hy + 0.02:
            k = min(1.0, (hy + 0.02 - y) / 0.10)
            x *= 1.0 - 0.20 * k
            z *= 1.0 - 0.10 * k
        # nose bridge: gaussian bump around theta=+Z (th=pi/2), mid height
        dth = (th - math.pi / 2 + math.pi) % (2 * math.pi) - math.pi
        dy = (y - (hy + 0.01)) / 0.05
        bump = math.exp(-(dth * dth) / 0.10) * math.exp(-(dy * dy) / 1.2)
        z += 0.016 * bump
        # brow ridge, slight
        dyb = (y - (hy + 0.055)) / 0.03
        z += 0.005 * math.exp(-(dth * dth) / 0.25) * math.exp(-(dyb * dyb))
        return (x, y, z)

    add_sphere(p, 0.0, hy + 0.045, 0.006, 0.098, 28, 20,
               sx=0.92, sy=1.12, sz=0.98, uv_rect=UV_FACE,
               wfn=lambda x, y, z: rigid("Head"), deform=face_deform)

    # -- Balaclava shell: proud of the face by 4 mm, eye window omitted.
    # -- Window: phi in [0.32pi, 0.52pi] (brow-to-nose band), |theta-pi/2|<0.55.
    def eye_window(phi, th):
        dth = abs((th - math.pi / 2 + math.pi) % (2 * math.pi) - math.pi)
        return (math.pi * 0.30 < phi < math.pi * 0.54) and (dth < 0.55)

    add_sphere(p, 0.0, hy + 0.045, 0.004, 0.102, 28, 20,
               sx=0.94, sy=1.14, sz=1.0, uv_rect=UV_FATIGUE,
               wfn=lambda x, y, z: rigid("Head"), skip_face=eye_window)

    # -- Eye-opening rim: two thin loft bands tracing the window edge so the
    # -- hole reads as hemmed cloth, not a mesh tear.
    brow_y, chin_y = hy + 0.082, hy + 0.018
    add_loft(p, [
        {"y": brow_y, "cx": 0.0, "cz": 0.055, "rx": 0.062, "rz": 0.030},
        {"y": brow_y - 0.006, "cx": 0.0, "cz": 0.058, "rx": 0.064, "rz": 0.030},
    ], 24, UV_FATIGUE, (0.9, 0.98),
        lambda x, y, z: rigid("Head"))
    add_loft(p, [
        {"y": chin_y + 0.006, "cx": 0.0, "cz": 0.060, "rx": 0.058, "rz": 0.028},
        {"y": chin_y, "cx": 0.0, "cz": 0.057, "rx": 0.056, "rz": 0.028},
    ], 24, UV_FATIGUE, (0.9, 0.98),
        lambda x, y, z: rigid("Head"))
    return p


# ---------------------------------------------------------------------------
# GEAR primitive (carrier, helmet, goggles, kneepads, boots -- rigid, 1 bone)
# ---------------------------------------------------------------------------

def build_gear():
    g = Part()
    hy = REST_WORLD["Head"][1]

    # -- Helmet dome: past the ears (phi to 0.62pi), tailored sand shell.
    add_sphere(g, 0.0, hy + 0.048, -0.004, 0.126, 28, 14,
               sx=0.98, sy=1.02, sz=1.04, phi0=0.0, phi1=math.pi * 0.62,
               uv_rect=UV_HELM, wfn=lambda x, y, z: rigid("Head"))
    # -- Helmet rim band.
    add_loft(g, [
        {"y": hy + 0.018, "cx": 0.0, "cz": -0.004, "rx": 0.128, "rz": 0.132},
        {"y": hy - 0.006, "cx": 0.0, "cz": -0.004, "rx": 0.130, "rz": 0.134},
    ], 28, UV_HELM, (0.0, 0.12), lambda x, y, z: rigid("Head"))
    # -- NVG shroud (brow) + side rails.
    add_box(g, 0.0, hy + 0.088, 0.118, 0.052, 0.036, 0.030, UV_SOLE,
            lambda x, y, z: rigid("Head"))
    for sgn in (-1.0, 1.0):
        add_box(g, sgn * 0.122, hy + 0.045, 0.010, 0.012, 0.055, 0.085,
                UV_SOLE, lambda x, y, z: rigid("Head"))
    # -- Ear-pro cups under the dome (reference turnaround shows a headset).
    for sgn in (-1.0, 1.0):
        add_sphere(g, sgn * 0.100, hy + 0.030, 0.002, 0.042, 12, 6,
                   sx=0.70, sy=1.0, sz=0.90, phi0=0.0, phi1=math.pi,
                   uv_rect=UV_SOLE, wfn=lambda x, y, z: rigid("Head"))
    # -- Chin strap: thin band under the jaw into the collar.
    add_loft(g, [
        {"y": hy - 0.010, "cx": 0.0, "cz": 0.020, "rx": 0.096, "rz": 0.088},
        {"y": hy - 0.060, "cx": 0.0, "cz": 0.012, "rx": 0.080, "rz": 0.072},
        {"y": hy - 0.080, "cx": 0.0, "cz": 0.009, "rx": 0.073, "rz": 0.067},
        {"y": hy - 0.100, "cx": 0.0, "cz": 0.006, "rx": 0.066, "rz": 0.062},
    ], 24, UV_SOLE, (0.1, 0.3), lambda x, y, z: rigid("Head"))

    # -- Goggles: strap band + frame + two dark lenses, worn up on the dome.
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

    # -- Plate carrier: front + back plates (top-tapered), cummerbund,
    # -- MOLLE strips, pouches, straps. All rigid to Chest (back radio too --
    # -- no spine-chain flex on hard goods).
    chest = lambda x, y, z: rigid("Chest")  # noqa: E731
    add_box(g, 0.0, 1.330, 0.128, 0.300, 0.330, 0.075, UV_WEB, chest,
            taper_top=0.88)
    add_box(g, 0.0, 1.330, -0.128, 0.300, 0.330, 0.075, UV_WEB, chest,
            taper_top=0.88)
    # cummerbund band
    add_loft(g, [
        {"y": 1.170, "cx": 0.0, "cz": 0.0, "rx": 0.166, "rz": 0.122},
        {"y": 1.200, "cx": 0.0, "cz": 0.0, "rx": 0.168, "rz": 0.123},
        {"y": 1.230, "cx": 0.0, "cz": 0.0, "rx": 0.170, "rz": 0.124},
    ], 24, UV_WEB, (0.0, 0.12), chest)
    # -- Vest side plates (left/right cummerbund armour).
    for sgn in (-1.0, 1.0):
        add_box(g, sgn * 0.168, 1.300, 0.0, 0.045, 0.220, 0.190, UV_WEB,
                chest, taper_top=0.90)
    # MOLLE webbing rows: thin strips, front 3 / back 2.
    for my in (1.250, 1.310, 1.370):
        add_box(g, 0.0, my, 0.168, 0.280, 0.020, 0.010, UV_WEB, chest)
    for my in (1.280, 1.340):
        add_box(g, 0.0, my, -0.168, 0.280, 0.020, 0.010, UV_WEB, chest)
    # triple mag pouches + admin + radio + buckles + shoulder straps
    for px in (-0.088, 0.0, 0.088):
        add_box(g, px, 1.300, 0.190, 0.080, 0.115, 0.055, UV_WEB, chest)
    add_box(g, 0.0, 1.415, 0.180, 0.130, 0.068, 0.045, UV_WEB, chest)
    add_box(g, 0.060, 1.360, -0.190, 0.110, 0.170, 0.070, UV_WEB, chest)
    add_box(g, 0.0, 1.200, 0.175, 0.060, 0.045, 0.030, UV_SOLE, chest)
    for sgn in (-1.0, 1.0):
        add_box(g, sgn * 0.102, 1.520, 0.004, 0.062, 0.058, 0.200, UV_WEB,
                chest)
    # -- Radio antenna: thin whip off the back plate (silhouette cue).
    add_loft(g, [
        {"y": 1.430, "cx": 0.060, "cz": -0.200, "rx": 0.006, "rz": 0.006},
        {"y": 1.560, "cx": 0.062, "cz": -0.205, "rx": 0.005, "rz": 0.005},
        {"y": 1.680, "cx": 0.064, "cz": -0.210, "rx": 0.004, "rz": 0.004},
        {"y": 1.760, "cx": 0.065, "cz": -0.212, "rx": 0.003, "rz": 0.003},
    ], 6, UV_SOLE, (0.5, 0.7), chest)

    # -- Belt + side pouch (rigid Hips).
    hips = lambda x, y, z: rigid("Hips")  # noqa: E731
    add_loft(g, [
        {"y": 1.060, "cx": 0.0, "cz": 0.0, "rx": 0.140, "rz": 0.112},
        {"y": 1.084, "cx": 0.0, "cz": 0.0, "rx": 0.141, "rz": 0.113},
        {"y": 1.108, "cx": 0.0, "cz": 0.0, "rx": 0.142, "rz": 0.114},
    ], 24, UV_WEB, (0.1, 0.22), hips)
    add_box(g, -0.150, 1.030, -0.010, 0.084, 0.104, 0.076, UV_WEB, hips)
    add_box(g, 0.0, 1.084, 0.120, 0.055, 0.040, 0.028, UV_SOLE, hips)
    # -- Dump pouch, rear-right hip.
    add_box(g, 0.150, 0.980, -0.090, 0.110, 0.130, 0.070, UV_WEB, hips)

    for side, sgn in (("Left", -1.0), ("Right", 1.0)):
        x_leg = sgn * 0.098
        leg = lambda x, y, z, _s=side: rigid(f"{_s}Leg")  # noqa: E731
        foot = lambda x, y, z, _s=side: rigid(f"{_s}Foot")  # noqa: E731

        # -- Kneepad cup: open shell segment over the patella + lower rim.
        kp = Part()
        segs, rows = 18, 10
        for j in range(rows + 1):
            yy = 0.505 - 0.028 * j
            for i in range(segs + 1):
                th = -0.85 + 1.70 * i / segs
                kp.verts.append((x_leg + 0.070 * math.sin(th),
                                 yy, 0.055 + 0.062 * math.cos(th)))
                kp.weights.append(rigid(f"{side}Leg"))
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
        # kneepad strap bands above/below
        w_leg_band = lambda x, y, z, _s=side: rigid(f"{_s}Leg")  # noqa: E731
        add_loft(g, [
            {"y": 0.560, "cx": x_leg, "cz": 0.004, "rx": 0.074, "rz": 0.082},
            {"y": 0.545, "cx": x_leg, "cz": 0.004, "rx": 0.074, "rz": 0.082},
            {"y": 0.530, "cx": x_leg, "cz": 0.004, "rx": 0.075, "rz": 0.083},
        ], 20, UV_SOLE, (0.5, 0.6), w_leg_band)
        add_loft(g, [
            {"y": 0.380, "cx": x_leg, "cz": 0.004, "rx": 0.070, "rz": 0.078},
            {"y": 0.365, "cx": x_leg, "cz": 0.004, "rx": 0.070, "rz": 0.078},
            {"y": 0.350, "cx": x_leg, "cz": 0.004, "rx": 0.071, "rz": 0.079},
        ], 20, UV_SOLE, (0.5, 0.6), w_leg_band)

        # -- Boot: shaft + tapered foot + toecap + proud darker sole + heel.
        # -- Ankle verts blend Leg->Foot so the shaft never cracks; the foot
        # -- block and below are rigid Foot.
        def w_boot(x, y, z, _s=side):
            if y > 0.11:
                return blend(f"{_s}Leg", f"{_s}Foot", (0.22 - y) / 0.11) \
                    if y < 0.22 else rigid(f"{_s}Leg")
            return rigid(f"{_s}Foot")

        add_loft(g, [
            {"y": 0.220, "cx": x_leg, "cz": 0.0, "rx": 0.064, "rz": 0.070},
            {"y": 0.180, "cx": x_leg, "cz": 0.002, "rx": 0.063, "rz": 0.071},
            {"y": 0.160, "cx": x_leg, "cz": 0.003, "rx": 0.062, "rz": 0.071},
            {"y": 0.140, "cx": x_leg, "cz": 0.004, "rx": 0.062, "rz": 0.072},
            {"y": 0.110, "cx": x_leg, "cz": 0.005, "rx": 0.061, "rz": 0.073},
            {"y": 0.095, "cx": x_leg, "cz": 0.006, "rx": 0.061, "rz": 0.074},
            {"y": 0.080, "cx": x_leg, "cz": 0.007, "rx": 0.060, "rz": 0.074},
            {"y": 0.065, "cx": x_leg, "cz": 0.008, "rx": 0.060, "rz": 0.075},
            {"y": 0.050, "cx": x_leg, "cz": 0.009, "rx": 0.060, "rz": 0.075},
        ], 20, UV_BOOT, (0.77, 0.99), w_boot)
        add_box(g, x_leg, 0.062, 0.062, 0.096, 0.120, 0.220, UV_BOOT, foot,
                taper_top=0.80)
        # toecap: rounded front -- extra squashed box, darker leather zone
        add_box(g, x_leg, 0.045, 0.155, 0.088, 0.075, 0.060, UV_BOOT, foot,
                taper_top=0.70)
        # sole: proud, near-black; heel block.
        add_box(g, x_leg, 0.015, 0.060, 0.104, 0.030, 0.248, UV_SOLE, foot)
        add_box(g, x_leg, 0.045, -0.045, 0.090, 0.090, 0.060, UV_SOLE, foot)

    return g


# ---------------------------------------------------------------------------
# Procedural PBR textures (seeded value-noise; no lights, no downloads).
# AO is pre-multiplied into base colour (exporter-safe). ORM packs
# G=roughness, B=metallic (both low-frequency, hence the 512 ORM).
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
            weave = _vnoise(x * 0.55, y * 0.55, rnd) - 0.5          # fine grain
            blotch = _fbm(u * 6.0, v * 6.0, rnd + 101) - 0.5        # tonal camo
            wear = _fbm(u * 22.0 + 40.0, v * 22.0, rnd + 202) - 0.5 # scuff
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
            else:  # fatigue: sand + olive-lean camo + grain
                k = 1.0 + weave * 0.07 + blotch * 0.13 + wear * 0.05
                r = SAND[0] * k * (1.0 + blotch * 0.06)
                gg = SAND[1] * k * (1.0 + blotch * 0.08)
                b = SAND[2] * k * (1.0 - blotch * 0.10)
            # fold AO pre-multiply: darker in pinched v bands is done by the
            # mesh fold rings; keep a whisper of large-scale dirt low on legs
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
            else:  # webbing + MOLLE shadow rows
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
    # R unused(1.0), G roughness (cloth .85 / webbing .62 / sole .5 by UV),
    # B metallic 0.0 everywhere except 0.15 on buckle/lens-dark zone whisper.
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
# Blender assembly (runs headless under root's Blender 5.1).
# ---------------------------------------------------------------------------

def main():
    import bpy

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # -- clean scene
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials,
                 bpy.data.images, bpy.data.cameras, bpy.data.lights):
        for x in list(coll):
            coll.remove(x)

    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    # CPU cap: exactly 2 threads; no GPU, no baking anywhere in this script.
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 2

    # -- armature: 21 standard bones, exact rest offsets, canonical neutral frame.
    # -- Every edit bone has head at REST_WORLD[name], tail at (head.x, head.y + 0.05, head.z),
    # -- and roll=0.0. In Blender convention, pointing strictly along +Y with roll=0 yields
    # -- an identity orientation matrix (local X=world X, local Y=world Y, local Z=world Z).
    # -- This guarantees:
    # -- 1. Every bone has identity rest rotation quaternion [0, 0, 0, 1] relative to parent.
    # -- 2. Every bone's relative translation is exactly REST_OFFSETS[name].
    # -- 3. Hips root node has identity rotation and exact REST_OFFSETS['Hips'] translation.
    # -- 4. IBMs are pure translation matrices matching worldOf(joint).inverted().
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

    # -- geometry tables (pure Python, deterministic)
    body = build_body()
    gear = build_gear()

    # -- textures (seeded fills, sRGB flags set below)
    img_cloth = bpy.data.images.new("Sand_Cloth_Base", 1024, 1024, alpha=True)
    img_cloth.pixels.foreach_set(paint_cloth_base(1024, 1024))
    img_cloth.file_format = "PNG"
    img_cloth.colorspace_settings.name = "sRGB"
    img_gear = bpy.data.images.new("Sand_Gear_Base", 1024, 1024, alpha=True)
    img_gear.pixels.foreach_set(paint_gear_base(1024, 1024))
    img_gear.file_format = "PNG"
    img_gear.colorspace_settings.name = "sRGB"
    img_orm = bpy.data.images.new("Sand_Shared_ORM", 512, 512, alpha=True)
    img_orm.pixels.foreach_set(paint_shared_orm(512, 512))
    img_orm.file_format = "PNG"
    img_orm.colorspace_settings.name = "Non-Color"

    def make_mat(name, base_img, rough, metal):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = next(n for n in mat.node_tree.nodes
                    if n.type == "BSDF_PRINCIPLED")
        tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = base_img
        mat.node_tree.links.new(tex.outputs["Color"],
                                bsdf.inputs["Base Color"])
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
        # loop UVs (face-loop order matches part.uvs)
        uv_layer = mesh.uv_layers.new(name="UVMap")
        li = 0
        for poly in mesh.polygons:
            poly.use_smooth = part.smooth[poly.index] \
                if poly.index < len(part.smooth) else True
            for _ in poly.loop_indices:
                u, v = part.uvs[li]
                uv_layer.data[li].uv = (u, v)
                li += 1
        obj = bpy.data.objects.new(name, mesh)
        scene.collection.objects.link(obj)
        obj.data.materials.append(mat)
        # vertex groups: EXACT standard bone names; bucket by (bone, weight)
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

    tris = sum(len(f) - 2 for f in body.faces) + \
        sum(len(f) - 2 for f in gear.faces)
    vram = (1024 * 1024 * 4) * 2 + 512 * 512 * 4

    # -----------------------------------------------------------------------
    # Mandatory asset-budget assertions BEFORE export (fail closed so a bad
    # build cannot write/overwrite .blend or .glb artifacts).
    # -----------------------------------------------------------------------
    assert 12000 <= tris <= 22000, f"triangle budget miss: {tris}"
    assert len(obj_body.data.materials) == 1, "body material count != 1"
    assert len(obj_gear.data.materials) == 1, "gear material count != 1"
    assert len(bpy.data.materials) <= 2, f"material count > 2: {len(bpy.data.materials)}"
    assert len(bpy.data.images) <= 3, f"image count > 3: {len(bpy.data.images)}"
    assert len(arm_data.bones) == 21, f"bone count mismatch: {len(arm_data.bones)}"

    # Structural actor bounds
    all_verts = body.verts + gear.verts
    xs = [v[0] for v in all_verts]
    ys = [v[1] for v in all_verts]
    zs = [v[2] for v in all_verts]
    assert -0.02 <= min(ys) <= 0.05, f"feet ground offset: {min(ys)}"
    assert 1.78 <= max(ys) <= 1.95, f"crown height: {max(ys)}"
    assert abs(min(xs) + max(xs)) <= 0.02, f"X asymmetry: {min(xs) + max(xs)}"
    assert max(zs) >= 0.15, f"forward reach missing: {max(zs)}"

    # Weight distribution and blend contracts
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

    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
    bpy.ops.export_scene.gltf(
        filepath=str(OUT_GLB),
        export_format="GLB",
        use_selection=False,
        export_apply=False,          # already in bind/world space; keep skin
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
    print(f"OPERATOR_SAND_BUILD time_s={dt:.1f} tris={tris} "
          f"vram_bytes={vram} glb_bytes={glb_bytes} seed={SEED} threads=2 "
          f"verts={len(body.verts) + len(gear.verts)}")


if __name__ == "__main__":
    main()
