"""Connected mountain-terrain panorama (Blender-native grid route).

Outer-loop replacement for build_authored_mountains.py, which root rejected on
sight: isolated box-scaled towers with empty horizon between them
(captures/authored-mountains-2309/authored-yardWhite.png vs baseline-yardWhite.png
and docs/reference/refinement-targets/yard-white.png).

Representation change, not a parameter tweak: each ring is ONE connected annular
grid mesh (azimuth x radial), displaced by broad overlapping Gaussian peak
profiles plus multi-scale erosion relief. Saddles dip to 19-29% of peak height
but never to sky, so the horizon reads as a continuous geological panorama with
a connected talus base. No box scaling anywhere in this file.

Budgets: 3 draws, 25984 tris (<= 30000), 3 embedded 1024 PNGs, 1 material (<= 2),
keepout >= 280 m, base < -6 m, peaks > 60 m. CPU only, 2 threads, 2 GiB ceiling.
"""

import math
import sys
import time
from pathlib import Path

THIS = Path(__file__).resolve()
ROOT = THIS.parents[2]
OUT_GLB = ROOT / "public" / "assets" / "mountain-terrain" / "mountain-terrain.glb"

sys.path.insert(0, str(THIS.parent))

import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Matrix as _Matrix  # noqa: E402

import common as C  # noqa: E402

SEED = 20260919
T0 = time.perf_counter()

DIRT_HEX = 0x8A7A5E
SAND_HEX = 0xC4AB7E
ROCK_HEX = 0x9A8F7C
PALE_HEX = 0xB4BCC6

MAX_TRIS = 30000
MAX_DRAWS = 3
BASE_Y = -12.0
BENCH_M = 6.5

_seed_state = SEED


def rnd():
    """Deterministic LCG in [0, 1). No random module, no hash-seed drift."""
    global _seed_state
    _seed_state = (1664525 * _seed_state + 1013904223) & 0xFFFFFFFF
    return _seed_state / 4294967296.0


def _hash2(a, b, s):
    s_ = math.sin(a * 127.1 + b * 311.7 + s * 74.7) * 43758.5453
    return (s_ - math.floor(s_)) * 2.0 - 1.0


def _sstep(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3.0 - 2.0 * t)


def _angdiff(a, b):
    return (a - b + math.pi) % (math.tau) - math.pi


# ---------------------------------------------------------------- clear scene

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images,
             bpy.data.cameras, bpy.data.lights):
    for x in list(coll):
        coll.remove(x)

scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1.0
try:
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 2
except (AttributeError, TypeError):
    pass

# ------------------------------------------------------------- rock textures
# Three pixel-filled 1024 images, wired straight into Principled BSDF.
# Procedural node math does NOT survive glTF export, so the stratified read is
# pixel-filled here: albedo carries elevation strata bands + talus tint +
# mottle, roughness carries 0.86..1.0 band variation, normal carries strata
# ledge perturbation. Mesh UVs map v to elevation, so horizontal texture bands
# read as geological strata on the slopes.

DIRT_LIN = C.hex_to_linear_rgb(DIRT_HEX)
SAND_LIN = C.hex_to_linear_rgb(SAND_HEX)
ROCK_LIN = C.hex_to_linear_rgb(ROCK_HEX)
PALE_LIN = C.hex_to_linear_rgb(PALE_HEX)


def _mix(a, b, t):
    return (a[0] + (b[0] - a[0]) * t,
            a[1] + (b[1] - a[1]) * t,
            a[2] + (b[2] - a[2]) * t)


def _albedo(u, v):
    # Warped strat coordinate: bands vary in thickness and pinch out laterally
    # instead of running as evenly spaced parallels.
    warp = (0.9 * math.sin(u * math.tau * 2.0 + 1.3)
            + 0.55 * math.sin(u * math.tau * 5.0 + v * 7.0 + 0.6)
            + 0.30 * _hash2(u * 9.0, v * 7.0, 11.5))
    s = v * 24.0 + warp
    band = 0.5 + 0.5 * math.sin(s * math.pi + 0.8 * math.sin(u * math.tau * 3.0 + v * 4.0))
    pinch = 0.45 + 0.55 * (0.5 + 0.5 * math.sin(u * math.tau * 4.0 + 2.0 * math.sin(v * 9.0 + 0.5)))
    base = _mix(ROCK_LIN, DIRT_LIN, band * pinch * 0.60)
    talus = _sstep(0.30, 0.02, v)  # low-v toe reads as pale alluvial scree
    wash = 0.75 + 0.25 * math.sin(u * math.tau * 3.0 + 1.1)
    base = _mix(base, SAND_LIN, talus * 0.65 * wash)
    cap = _sstep(0.72, 0.95, v)  # high-v crest tint, broken by mottle below
    cap_break = 0.6 + 0.4 * _hash2(u * 23.0, v * 19.0, 14.0)
    base = _mix(base, PALE_LIN, cap * 0.35 * cap_break)
    n = (0.50 * _hash2(u * 37.0, v * 41.0, 11.0)
         + 0.30 * _hash2(u * 91.0, v * 83.0, 12.0)
         + 0.20 * _hash2(u * 231.0, v * 217.0, 13.0))
    ridge = 1.0 - abs(_hash2(u * 127.0, v * 113.0, 15.0))
    crack = _sstep(0.12, 0.02, ridge)  # thin dark veins where ridged noise nears zero
    fleck = _sstep(0.72, 0.92, _hash2(u * 311.0, v * 297.0, 16.0))  # sparse pale flecks
    k = 1.0 + 0.22 * n - 0.10 * band * pinch - 0.18 * crack + 0.10 * fleck
    r = min(1.0, base[0] * k + 0.02 * fleck)
    g = min(1.0, base[1] * k + 0.02 * fleck)
    b = min(1.0, base[2] * k)
    return (r, g, b, 1.0)


def _rough(u, v):
    warp = (0.7 * math.sin(u * math.tau * 2.0 + 0.4)
            + 0.4 * math.sin(u * math.tau * 5.0 + v * 6.0))
    s = v * 24.0 + warp
    band = 0.5 + 0.5 * math.sin(s * math.pi + 0.6 + 0.5 * math.sin(u * math.tau * 3.0))
    pinch = 0.5 + 0.5 * (0.5 + 0.5 * math.sin(u * math.tau * 4.0 + 1.7 * math.sin(v * 8.0)))
    n = (0.55 * _hash2(u * 53.0, v * 47.0, 21.0)
         + 0.30 * _hash2(u * 129.0, v * 137.0, 22.0)
         + 0.15 * _hash2(u * 271.0, v * 251.0, 23.0))
    crack = _sstep(0.12, 0.02, 1.0 - abs(_hash2(u * 127.0, v * 113.0, 15.0)))
    r = 0.93 + 0.05 * n - 0.04 * band * pinch - 0.03 * crack
    r = min(1.0, max(0.86, r))
    return (r, r, r, 1.0)


def _normal(u, v):
    # Ledges follow the warped strat coordinate so carving and colour agree;
    # streaks meander downslope instead of straight parallels.
    warp = (0.9 * math.sin(u * math.tau * 2.0 + 1.3)
            + 0.55 * math.sin(u * math.tau * 5.0 + v * 7.0 + 0.6))
    s = v * 24.0 + warp
    ledge = math.cos(s * math.pi + 0.8 * math.sin(u * math.tau * 3.0 + v * 4.0))
    meander = u * math.tau * 7.0 + 2.3 * math.sin(v * 9.0 + 1.1 * math.sin(u * math.tau * 2.0))
    streak = math.cos(meander * 2.0 + 1.2 * math.sin(s * 0.7))
    grain = _hash2(u * 311.0, v * 307.0, 31.0) * 0.15
    detail = _hash2(u * 173.0, v * 167.0, 32.0) * 0.08
    pinch = 0.5 + 0.5 * (0.5 + 0.5 * math.sin(u * math.tau * 4.0 + 2.0 * math.sin(v * 9.0)))
    nx = 0.5 + (0.10 * ledge * (0.5 + 0.5 * pinch) + 0.03 * detail) + 0.02 * grain
    ny = 0.5 + (0.06 * streak + 0.03 * detail) + 0.02 * grain
    nz = 1.0
    inv = 1.0 / math.sqrt((nx - 0.5) ** 2 * 4.0 + (ny - 0.5) ** 2 * 4.0 + 1.0)
    return (nx, ny, 0.5 + 0.5 * inv, 1.0)

img_albedo = C.make_image("MtnT_BaseColor", 1024, 1024, "sRGB", _albedo)
img_rough = C.make_image("MtnT_Roughness", 1024, 1024, "Non-Color", _rough)
img_normal = C.make_image("MtnT_Normal", 1024, 1024, "Non-Color", _normal)
EMBEDDED_IMAGES = [img_albedo, img_rough, img_normal]


def _principled():
    mat = bpy.data.materials.new("MountainTerrainRock")
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    try:
        bsdf.inputs["Metallic"].default_value = 0.0
    except KeyError:
        pass
    tex_b = mat.node_tree.nodes.new("ShaderNodeTexImage")
    tex_b.image = img_albedo
    mat.node_tree.links.new(tex_b.outputs["Color"], bsdf.inputs["Base Color"])
    tex_r = mat.node_tree.nodes.new("ShaderNodeTexImage")
    tex_r.image = img_rough
    try:
        mat.node_tree.links.new(tex_r.outputs["Color"], bsdf.inputs["Roughness"])
    except KeyError:
        pass
    tex_n = mat.node_tree.nodes.new("ShaderNodeTexImage")
    tex_n.image = img_normal
    nmap = mat.node_tree.nodes.new("ShaderNodeNormalMap")
    mat.node_tree.links.new(tex_n.outputs["Color"], nmap.inputs["Color"])
    try:
        mat.node_tree.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    except KeyError:
        pass
    return mat


mat_rock = _principled()

# ------------------------------------------------------- connected terrain
# One annular grid per ring: NU azimuth steps x NV radial steps, built vertex
# by vertex with bmesh (no primitives, no modifiers). Broad Gaussian peak
# profiles overlap (width > spacing) so saddles never reach sky. Radial shape
# rises from a sunk talus toe through a crest at v=0.55, then falls outward.
# Relief repair1: meandering dual-comb gullies with saddle guard, breathing
# pinched strata benches, hash-placed outcrop buttresses (up/out only),
# four-octave ridge plus slope-coupled grain. Mesa flattening on two capped
# near/mid peaks only; far horns stay pointed.

# (azimuth_deg, height_above_base_m, angular_width_rad)
PEAKS_NEAR = [(10.0, 78.0, 0.38), (60.0, 68.0, 0.34), (115.0, 82.0, 0.40),
              (170.0, 62.0, 0.32), (225.0, 75.0, 0.36), (285.0, 70.0, 0.34),
              (335.0, 66.0, 0.32)]
PEAKS_MID = [(30.0, 150.0, 0.40), (85.0, 132.0, 0.36), (140.0, 158.0, 0.42),
             (195.0, 125.0, 0.34), (250.0, 145.0, 0.38), (305.0, 138.0, 0.36),
             (350.0, 120.0, 0.32)]
PEAKS_FAR = [(0.0, 225.0, 0.42), (60.0, 200.0, 0.38), (120.0, 235.0, 0.44),
             (180.0, 190.0, 0.36), (240.0, 215.0, 0.40), (300.0, 205.0, 0.38)]

MESAS_NEAR = {2, 4}
MESAS_MID = {2, 4}

# (name, Rinner, depth, NU, NV, gullyFreq, gullyDepthFrac, strataStrength)
RINGS = [
    ("near", 295.0, 90.0, 288, 20, 21, 0.16, 0.32),
    ("mid", 455.0, 130.0, 256, 16, 25, 0.18, 0.28),
    ("far", 650.0, 170.0, 224, 14, 19, 0.14, 0.22),
]
RING_PEAKS = [PEAKS_NEAR, PEAKS_MID, PEAKS_FAR]
RING_PHASE = (0.0, 2.13, 4.31)
GULLY_PHASE = [rnd() * math.tau for _ in RINGS]
OUTCROP_COUNT = (14, 12, 10)
OUTCROP_AMP = (7.0, 10.0, 14.0)


def _outcrop_lift(ri, theta, v):
    # Deterministic buttresses from pure hash (no rnd use, so peak jitter
    # sequence is unchanged). Positive lift only: pushes up and out,
    # never inward into keepout.
    n = OUTCROP_COUNT[ri]
    amp0 = OUTCROP_AMP[ri]
    total = 0.0
    for k in range(n):
        hc = _hash2(k * 3.7 + 1.0, ri * 17.3 + 5.0, 71.0)
        thc = hc * math.pi
        vc = 0.30 + 0.50 * (0.5 + 0.5 * _hash2(k * 5.1 + 2.0, ri * 11.7 + 3.0, 72.0))
        amp = amp0 * (0.45 + 0.55 * (0.5 + 0.5 * _hash2(k * 7.3 + 4.0, ri * 5.9 + 1.0, 73.0)))
        wth = 0.045 + 0.035 * (0.5 + 0.5 * _hash2(k * 9.1 + 3.0, ri * 3.3 + 7.0, 74.0))
        wv = 0.09 + 0.07 * (0.5 + 0.5 * _hash2(k * 11.7 + 8.0, ri * 7.1 + 2.0, 75.0))
        dtheta = _angdiff(theta, thc)
        dv = v - vc
        total += amp * math.exp(-((dtheta / wth) ** 2 + (dv / wv) ** 2))
    return total


def _gully_chute(ri, theta, v):
    # Irregular chutes: two incommensurate combs on a warped strike coordinate
    # with downslope meander plus a low-freq envelope. No even parallels.
    phase = GULLY_PHASE[ri]
    warp = (0.35 * math.sin(2.0 * theta + phase)
            + 0.18 * math.sin(5.0 * theta + 0.7 + phase * 0.3))
    w = theta + warp + 0.6 * v * math.sin(3.0 * theta + phase)
    f1 = (21.0, 25.0, 19.0)[ri]
    f2 = (13.0, 17.0, 11.0)[ri]
    c1 = abs(math.sin(f1 * w + phase)) ** 1.2
    c2 = abs(math.sin(f2 * w + 1.7 * phase + 1.3)) ** 1.6
    env = 0.45 + 0.55 * (0.5 + 0.5 * math.sin(3.0 * theta + phase * 1.7 + 1.1 * math.sin(2.0 * theta)))
    return (0.65 * c1 + 0.35 * c2) * env


def _crest_height(peaks, theta):
    s = 0.0
    for (cdeg, h, w) in peaks:
        d = _angdiff(theta, math.radians(cdeg))
        s += h * math.exp(-((d / w) ** 2))
    return s


def _peak_cap(peaks, mesas, theta):
    # Tabular seat height for capped summits, else +inf (no flattening).
    cap = math.inf
    for idx in mesas:
        cdeg, h, w = peaks[idx]
        d = abs(_angdiff(theta, math.radians(cdeg)))
        if d < w * 1.2:
            cap = min(cap, 0.78 * h)
    return cap


def _height(ri, peaks, theta, v):
    crest = _crest_height(peaks, theta)
    if v < 0.55:
        s = _sstep(0.0, 0.55, v)
    else:
        s = 1.0 - 0.35 * _sstep(0.55, 1.0, v)
    y = BASE_Y + crest * s
    # Irregular eroded gullies: meandering dual-comb chutes on the mid-slope
    # face, pinched on low saddles so carving never punches sky through gaps.
    _gd = RINGS[ri][6]
    slope_win = math.sin(math.pi * min(1.0, max(0.0, v))) ** 1.0
    chute = _gully_chute(ri, theta, v)
    saddle_guard = 0.35 + 0.65 * min(1.0, crest / 60.0)
    y -= _gd * crest * chute * slope_win * saddle_guard
    # Strata terraces with geological variation: spacing breathes 4.7-8.3 m,
    # seat coordinate warped by slope position, strength pinched laterally so
    # benches crop out instead of ringing the whole panorama in parallel.
    _ss = RINGS[ri][7]
    phase = GULLY_PHASE[ri]
    sp = BENCH_M * (0.72 + 0.56 * (0.5 + 0.5 * math.sin(2.0 * theta + phase + 1.4 * math.sin(3.0 * theta))))
    yw = (y - BASE_Y) + 1.8 * math.sin(3.0 * theta + phase) + 1.1 * math.sin(7.0 * theta + 1.3 * phase)
    q = yw / sp
    bench = math.floor(q) * sp
    bench += sp * _sstep(0.35, 0.65, q - math.floor(q))
    bench_y = bench + BASE_Y
    mask = 0.25 + 0.75 * (0.5 + 0.5 * math.sin(4.0 * theta + phase * 0.7 + 2.0 * math.sin(v * 7.0 + 1.0)))
    y = y + (bench_y - y) * _ss * mask
    # Mesa caps: tabular seats on capped summits only.
    mesas = MESAS_NEAR if ri == 0 else MESAS_MID if ri == 1 else set()
    cap = _peak_cap(peaks, mesas, theta)
    if y > BASE_Y + cap:
        y = BASE_Y + cap + (y - BASE_Y - cap) * 0.15
    # Multi-scale ridge relief: retained low octaves plus outcrop-scale
    # irregular octaves; grain strengthened and slope-coupled for rock read.
    y += (2.2 * math.sin(3.0 * theta + RING_PHASE[ri])
          + 1.1 * math.sin(7.0 * theta + 1.3 * RING_PHASE[ri])
          + 0.9 * math.sin(13.0 * theta + 2.1 * phase)
          + 0.5 * math.sin(23.0 * theta + phase * 0.7))
    y += 1.6 * _hash2(theta * 19.0, v * 23.0, 41.0 + ri)
    y += 0.8 * _hash2(theta * 47.0, v * 31.0, 51.0 + ri) * slope_win
    return y


def _radius(ri, Rinner, theta):
    meander = (8.0 * math.sin(3.0 * theta + RING_PHASE[ri])
               + 4.0 * math.sin(5.0 * theta + 0.7))
    return Rinner, meander


RING_MESH = []

for ri, (rname, Rinner, depth, NU, NV, _gf, _gd, _ss) in enumerate(RINGS):
    peaks = [(c + (rnd() - 0.5) * 6.0,
              h * (0.92 + 0.16 * rnd()),
              w * (0.92 + 0.16 * rnd()))
             for (c, h, w) in RING_PEAKS[ri]]
    RING_PEAKS[ri] = peaks
    bm = bmesh.new()
    grid = [[None] * (NU + 1) for _ in range(NV + 1)]
    for iv in range(NV + 1):
        v = iv / NV
        for iu in range(NU + 1):
            theta = RING_PHASE[ri] + (iu % NU) / NU * math.tau
            theta = (theta + math.pi) % math.tau - math.pi
            r_base, meander = _radius(ri, Rinner, theta)
            lift = _outcrop_lift(ri, theta, v)
            radius = r_base + v * depth + meander * math.sin(math.pi * v) + lift * 1.5
            y = _height(ri, peaks, theta, v) + lift
            x = radius * math.cos(theta)
            z = radius * math.sin(theta)
            grid[iv][iu] = bm.verts.new((x, y, z))
    bm.verts.ensure_lookup_table()
    # Weld the azimuth seam positionally (keep duplicated UV seam verts).
    for iv in range(NV + 1):
        a = grid[iv][0].co
        b = grid[iv][NU].co
        b.x, b.y, b.z = a.x, a.y, a.z
    uv_layer = bm.loops.layers.uv.new("MtnT_UV")
    for iv in range(NV):
        for iu in range(NU):
            v0 = grid[iv][iu]
            v1 = grid[iv][iu + 1]
            v2 = grid[iv + 1][iu + 1]
            v3 = grid[iv + 1][iu]
            try:
                face = bm.faces.new((v0, v1, v2, v3))
            except ValueError:
                continue
            for loop, (vv, uu, vv2) in zip(face.loops,
                                           ((v0, iu / NU, iv / NV),
                                            (v1, (iu + 1) / NU, iv / NV),
                                            (v2, (iu + 1) / NU, (iv + 1) / NV),
                                            (v3, iu / NU, (iv + 1) / NV))):
                _y = vv.co.y
                loop[uv_layer].uv = (uu * 8.0,
                                     max(0.0, min(2.0, (_y - BASE_Y) / 60.0))
                                     + vv2 * 1.5)
    me = bpy.data.meshes.new("mountain_terrain_%s" % rname)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("mountain_terrain_%s" % rname, me)
    bpy.context.collection.objects.link(ob)
    me.materials.append(mat_rock)
    for poly in me.polygons:
        poly.use_smooth = True
    RING_MESH.append((ri, ob))

# ------------------------------------------------- y-up roll + export
# Authored y-up (three.js: y = height). Blender models z-up: roll every mesh
# +90 deg about X in world space BEFORE export: (x, y, z) -> (x, -z, y).

_ROLL = _Matrix.Rotation(math.pi / 2, 4, "X")
for _ri, _ob in RING_MESH:
    _ob.matrix_world = _ROLL @ _ob.matrix_world
bpy.context.view_layer.update()

bpy.ops.object.select_all(action="DESELECT")
for _ri, _ob in RING_MESH:
    _ob.select_set(True)
bpy.context.view_layer.objects.active = RING_MESH[0][1]
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

tris = C.scene_tri_count()
vram = C.vram_bytes(EMBEDDED_IMAGES)
print("MTN_TERRAIN ring_meshes=%d tris=%d vram_bytes=%d" % (len(RING_MESH), tris, vram))
assert len(RING_MESH) == MAX_DRAWS, "draw budget: 3 connected ring meshes, got %d" % len(RING_MESH)
assert 3000 <= tris <= MAX_TRIS, "tri budget 3000..30000, got %d" % tris

# Post-roll axes: x = east, y = depth (former z), z = height. Bounds over ALL
# vertices (bound_box is 8 corners only and would miss carved saddles).
all_min_r = math.inf
all_min_z = math.inf
all_max_z = -math.inf
ring_max = []
for _ri, _ob in RING_MESH:
    zs = [v.co.z for v in _ob.data.vertices]
    rs = [math.hypot(v.co.x, v.co.y) for v in _ob.data.vertices]
    all_min_r = min(all_min_r, min(rs))
    all_min_z = min(all_min_z, min(zs))
    all_max_z = max(all_max_z, max(zs))
    ring_max.append(max(zs))
    assert min(zs) < -6.0, "ring %d not sunk: minZ=%.1f" % (_ri, min(zs))
    assert min(rs) >= 280.0, "ring %d intrudes into keepout: min_r=%.2f < 280.0" % (_ri, min(rs))
assert all_min_r >= 280.0, "keepout violated: min_r=%.2f < 280.0" % all_min_r
assert all_min_z < -6.0, "base not sunk: minZ=%.1f" % all_min_z
assert all_max_z > 60.0, "peaks too low: maxZ=%.1f" % all_max_z
assert ring_max[1] > ring_max[0], "tier ladder broken: mid %.1f <= near %.1f" % (ring_max[1], ring_max[0])
assert ring_max[2] > ring_max[1], "tier ladder broken: far %.1f <= mid %.1f" % (ring_max[2], ring_max[1])

OUT_GLB.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=str(OUT_GLB),
    export_format="GLB",
    use_selection=False,
    export_materials="EXPORT",
    export_image_format="AUTO",
    export_texcoords=True,
    export_normals=True,
    export_tangents=False,
    export_draco_mesh_compression_enable=False,
)
wall = time.perf_counter() - T0
size_b = OUT_GLB.stat().st_size
print("MTN_TERRAIN_BUILD time_s=%.1f tris=%d vram_bytes=%d glb_bytes=%d path=%s"
      % (wall, tris, vram, size_b, OUT_GLB))
