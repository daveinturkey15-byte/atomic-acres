# ASTRA GEOMETRY REPAIR 0824, based on Muse source SHA256
# 0d36d4e0e2c032f32d0271f904220997603bc5a40da0add1c5c375d7d0d2b365.
# Run from this folder: blender --background --threads 2 --python build_coach_geometry_0824.py
# Output stays in this folder. common.py and coach_geometry.py are bundled dependencies.
# The inherited authoring notes below describe the preserved source, not acceptance.
"""Coach geometry repair 0824. Original Muse coach body/maps retained.
Pure CPU geometry checks: python check_geometry.py.
Root-only bounded bake: blender --background --threads 2 --python build_coach_geometry_0824.py.
Writes coach-geometry-0824.glb beside this recipe; preserves earlier rejected assets.
Authoring frame x-long/y-up/z-wide, then one explicit y-up export roll.
Gameplay envelope remains 11.6 x 2.87 x 3.4 metres. Six material identities,
three embedded 1K maps, <=12000 geometry triangles. Visual acceptance remains OPEN.
"""

import math
import sys
import time
from pathlib import Path

THIS = Path(__file__).resolve()
ROOT = THIS.parent
sys.path.insert(0, str(THIS.parent))

import bpy  # noqa: E402

import common as C  # noqa: E402
from coach_geometry import repair_meshes
BL_EXE = "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe"
SEED = 742
OUT_GLB = ROOT / "coach-geometry-0824.glb"
OUT_PNG = ROOT / "blend-coach-geometry-0824.png"

# Palette families from src/core/palette.ts
CREAM_HEX = 0xE8E0CD
MAROON_HEX = 0x7C2A33
CHROME_HEX = 0xC8CCD0
GLASS_HEX = 0x9FC0CF

T0 = time.perf_counter()

# ---------------------------------------------------------------- clear scene

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images,
             bpy.data.cameras, bpy.data.lights):
    for x in list(coll):
        coll.remove(x)

scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1.0

# ------------------------------------------------- coach loft maths (NT07 rib set)

# [x_belt, x_roof, x_skirt, half_width, skirt_y, roof_y]
RIBS = [
    (-5.62, -5.30, -5.44, 0.10, 0.90, 2.78),
    (-5.52, -5.22, -5.36, 0.80, 0.80, 2.98),
    (-5.30, -5.12, -5.22, 1.16, 0.68, 3.13),
    (-4.90, -4.84, -4.88, 1.27, 0.59, 3.21),
    (-3.70, -3.70, -3.70, 1.30, 0.56, 3.25),
    (2.70, 2.70, 2.70, 1.30, 0.56, 3.25),
    (4.30, 4.16, 4.24, 1.30, 0.57, 3.24),
    (5.00, 4.74, 4.84, 1.27, 0.60, 3.19),
    (5.36, 5.02, 5.10, 1.16, 0.64, 3.10),
    (5.56, 5.20, 5.26, 0.94, 0.70, 3.00),
    (5.66, 5.30, 5.34, 0.56, 0.78, 2.88),
    (5.70, 5.34, 5.38, 0.10, 0.86, 2.76),
]
# cross section: (u fraction of half width, v fraction of height)
SECTION = [
    (0.000, 0.000), (0.550, 0.000), (0.840, 0.012), (0.960, 0.055),
    (1.000, 0.140), (1.000, 0.330), (0.998, 0.520), (0.990, 0.680),
    (0.972, 0.800), (0.930, 0.885), (0.840, 0.945), (0.640, 0.985),
    (0.380, 1.000), (0.000, 1.000),
]
MID = RIBS[4]
NOSE = RIBS[-1]


def roof_pull(v):
    return max(0.0, (v - 0.40) / 0.60) ** 1.45


def skirt_pull(v):
    return max(0.0, (0.30 - v) / 0.30) ** 1.30


def rib_point(r, u, v):
    return (
        r[0] + (r[1] - r[0]) * roof_pull(v) + (r[2] - r[0]) * skirt_pull(v),
        r[4] + (r[5] - r[4]) * v,
        r[3] * u,
    )


def flank_half(y):
    v = min(1.0, max(0.0, (y - MID[4]) / (MID[5] - MID[4])))
    s = SECTION
    for i in range(1, len(s)):
        if v <= s[i][1]:
            span = s[i][1] - s[i - 1][1]
            t = (v - s[i - 1][1]) / span if span > 0 else 0.0
            return MID[3] * (s[i - 1][0] + (s[i][0] - s[i - 1][0]) * t)
    return 0.0


def nose_x(y):
    v = min(1.0, max(0.0, (y - NOSE[4]) / (NOSE[5] - NOSE[4])))
    return rib_point(NOSE, 0.0, v)[0]


REPAIR_HULL, REPAIR_PARTS = repair_meshes(RIBS, SECTION)

# ------------------------------------------------------------------ prim helpers

def link(ob):
    bpy.context.collection.objects.link(ob)
    return ob


def mesh_from(name, verts, faces, mat=None, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    link(ob)
    if mat is not None:
        me.materials.append(mat)
    return ob


def box(name, loc, size, mat=None):
    cx, cy, cz = loc
    sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
    v = [(cx - sx, cy - sy, cz - sz), (cx + sx, cy - sy, cz - sz),
         (cx + sx, cy + sy, cz - sz), (cx - sx, cy + sy, cz - sz),
         (cx - sx, cy - sy, cz + sz), (cx + sx, cy - sy, cz + sz),
         (cx + sx, cy + sy, cz + sz), (cx - sx, cy + sy, cz + sz)]
    f = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1),
         (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    return mesh_from(name, v, f, mat, smooth=False)


def cylinder_z(name, loc, r, depth, mat=None, verts_n=24):
    cx, cy, cz = loc
    ring_b, ring_t = [], []
    for i in range(verts_n):
        a = 2 * math.pi * i / verts_n
        ring_b.append((r * math.cos(a), r * math.sin(a), -depth / 2))
        ring_t.append((r * math.cos(a), r * math.sin(a), depth / 2))
    v = ring_b + ring_t
    f = []
    n = verts_n
    for i in range(n):
        j = (i + 1) % n
        f.append((i, j, n + j, n + i))
    f.append(tuple(reversed(range(n))))
    f.append(tuple(range(n, 2 * n)))
    ob = mesh_from(name, v, f, mat, smooth=False)
    ob.location = (cx, cy, cz)
    return ob


def quad_strip(name, quads, mat=None):
    """quads: list of 4-vert tuples -> one mesh."""
    verts, faces = [], []
    for q in quads:
        b = len(verts)
        verts.extend(q)
        faces.append((b, b + 1, b + 2, b + 3))
    return mesh_from(name, verts, faces, mat, smooth=False)


def select_only(ob):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def smart_uv(ob):
    select_only(ob)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.uv.smart_project(angle_limit=66, island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')


# ------------------------------------------------------------------ materials

def principled(name, base_hex=None, metallic=0.0, roughness=0.5, alpha=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    if base_hex is not None:
        bsdf.inputs['Base Color'].default_value = (*C.hex_to_linear_rgb(base_hex), 1.0)
    try:
        bsdf.inputs['Metallic'].default_value = metallic
    except Exception:
        pass
    bsdf.inputs['Roughness'].default_value = roughness
    if alpha is not None:
        bsdf.inputs['Alpha'].default_value = alpha
        try:
            mat.blend_method = 'BLEND'
        except Exception:
            pass
    return mat


mat_body = principled('CoachBody', CREAM_HEX, metallic=0.05, roughness=0.45)
mat_chrome = principled('CoachChrome', CHROME_HEX, metallic=1.0, roughness=0.24)
mat_glass = principled('CoachGlass', GLASS_HEX, metallic=0.0, roughness=0.08, alpha=0.55)
# CANARY budget: 6 materials max. Merges vs baseline (10): dark trim + tyre
# rubber + destination blind share one near-black; ivory sidewall stands
# alone; maroon swoosh + tail lens + red steel rims share one signal red;
# headlamp lens merges into glass.
mat_trimdark = principled('CoachTrimDark', 0x17181B, metallic=0.15, roughness=0.85)
mat_ivory = principled('CoachIvory', 0xE9E6DD, metallic=0.0, roughness=0.6)
mat_signal = principled('CoachSignalRed', 0x7C2A33, metallic=0.15, roughness=0.38)
mat_maroon = mat_signal  # swoosh keeps its name at use sites
mat_rubber = mat_trimdark
mat_dark = mat_trimdark
mat_blind = mat_trimdark
mat_whitewall = mat_ivory
mat_lens = mat_glass
mat_taillens = mat_signal

# ------------------------------------------------------------------ PBR maps (in-Blender procedural bake)

CREAM_LIN = C.hex_to_linear_rgb(CREAM_HEX)

def _grain(u, v, seed):
    # deterministic hash grain in [-1, 1]
    import math as _m
    s = _m.sin(u * 127.1 + v * 311.7 + seed * 74.7) * 43758.5453
    return (s - _m.floor(s)) * 2.0 - 1.0

def _ao(u, v):
    # the baked occlusion value; pre-multiplied into base colour on export
    return 0.92 + 0.08 * _grain(u, v, 5)
def _seam(u, v):
    # vertical panel seams every 1/16 of U + one horizontal belt-line seam.
    # Returns 0 on a seam, 1 elsewhere (2-px feather at 1024).
    import math as _m
    f = (u * 16.0) % 1.0
    fu = min(f, 1.0 - f) * 16.0  # 0 on a seam .. 8 mid-panel
    su = min(1.0, max(0.0, (fu - 0.55) / 0.9))
    fv = abs(v - 0.52) * 1024.0 / 2.2
    sv = min(1.0, max(0.0, (fv - 0.4) / 0.9))
    return min(su, sv)
def _wave(u, v):
    # broad press-wave: ±1 over a few low-frequency sines (reflections break
    # up instead of mirroring flat). Deterministic, no texture fetch.
    import math as _m
    return (_m.sin(u * 21.0 + 1.7) * 0.45 + _m.sin(v * 13.0 - 0.6) * 0.35
            + _m.sin((u + v) * 31.0 + 0.3) * 0.20)
def _dust(v):
    # skirt dust gradient: 0 high on the body, 1 at the skirt.
    return min(1.0, max(0.0, (0.22 - v) / 0.22)) ** 1.5
img_base = C.make_image(
    'Coach_Body_BaseColor', 1024, 1024, 'sRGB',
    lambda u, v: (
        min(1.0, CREAM_LIN[0] * (1.0 + 0.010 * _grain(u, v, 1) + 0.008 * _wave(u, v))
              * (0.90 + 0.10 * _ao(u, v)) * (0.955 + 0.045 * _seam(u, v))
              * (1.0 - 0.035 * _dust(v))),
        min(1.0, CREAM_LIN[1] * (1.0 + 0.010 * _grain(u, v, 2) + 0.008 * _wave(u, v))
              * (0.90 + 0.10 * _ao(u, v)) * (0.955 + 0.045 * _seam(u, v))
              * (1.0 - 0.030 * _dust(v))),
        min(1.0, CREAM_LIN[2] * (1.0 + 0.010 * _grain(u, v, 3) + 0.006 * _wave(u, v))
              * (0.90 + 0.10 * _ao(u, v)) * (0.955 + 0.045 * _seam(u, v))
              * (1.0 - 0.020 * _dust(v))),
        1.0))
img_rough = C.make_image(
    'Coach_Body_Roughness', 1024, 1024, 'Non-Color',
    lambda u, v: (
        min(0.85, max(0.25,
            0.44 + 0.040 * _grain(u, v, 4) + 0.035 * _wave(u, v)
            + 0.10 * (1.0 - _seam(u, v)) + 0.10 * _dust(v))),) * 3 + (1.0,))
img_metal = C.make_image(
    'Coach_Body_Metallic', 1024, 1024, 'Non-Color',
    lambda u, v: (0.05, 0.05, 0.05, 1.0))
def _nrm(u, v):
    # 0742 restrained: seam grooves pull normal.x; orange-peel ±0.012.
    s = _seam(u, v)
    gx = (1.0 - s) * -0.35 + 0.012 * _grain(u, v, 6)
    gy = 0.012 * _grain(u, v, 7)
    inv = 1.0 / max(1e-5, (gx * gx + gy * gy + 1.0) ** 0.5)
    return (0.5 + 0.5 * gx * inv, 0.5 + 0.5 * gy * inv, 0.5 + 0.5 * inv, 1.0)
img_normal = C.make_image(
    'Coach_Body_Normal', 1024, 1024, 'Non-Color', _nrm)
img_ao = C.make_image(
    'Coach_Body_AO', 1024, 1024, 'Non-Color',
    lambda u, v: (_ao(u, v),) * 3 + (1.0,))

MAP_IMAGES = [img_base, img_rough, img_metal, img_normal, img_ao]
# Decoded cost of what is actually embedded in the .glb: the exporter merges
# roughness+metallic into one ORM texture and carries AO inside base colour,
# so the file holds base(1024) + normal(1024) + ORM(1024, same size as rough).
EMBEDDED_IMAGES = [img_base, img_rough, img_normal]


def wire_body_maps(mat):
    nt = mat.node_tree
    nodes, links = nt.nodes, nt.links
    bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')

    def tex(img, label):
        t = nodes.new('ShaderNodeTexImage')
        t.label = label
        t.image = img
        return t
    t_base = tex(img_base, 'base')
    t_rough = tex(img_rough, 'rough')
    t_metal = tex(img_metal, 'metal')
    t_normal = tex(img_normal, 'normal')
    # NOTE: AO is pre-multiplied into the base-colour pixels at bake time (see
    # img_base above). A Mix/Multiply node here renders the same in the
    # viewport but is NOT understood by the glTF exporter, so the base texture
    # is wired straight in and the exporter carries the baked AO with it.
    nm = nodes.new('ShaderNodeNormalMap')
    nm.inputs['Strength'].default_value = 1.0
    # layout (visual only)
    t_base.location = (-900, 300)
    t_rough.location = (-900, -300)
    t_metal.location = (-900, -600)
    t_normal.location = (-600, -600)
    nm.location = (-300, -600)

    links.new(bsdf.inputs['Base Color'], t_base.outputs['Color'])
    try:
        links.new(bsdf.inputs['Roughness'], t_rough.outputs['Color'])
    except Exception:
        pass
    try:
        links.new(bsdf.inputs['Metallic'], t_metal.outputs['Color'])
    except Exception:
        pass
    links.new(nm.inputs['Color'], t_normal.outputs['Color'])
    links.new(bsdf.inputs['Normal'], nm.outputs['Normal'])


wire_body_maps(mat_body)

# ------------------------------------------------------------------ body hull loft

loop = list(SECTION)
for i in range(len(SECTION) - 2, 0, -1):
    loop.append((-SECTION[i][0], SECTION[i][1]))
n = len(loop)
verts, faces = [], []


def put(p):
    verts.append(p)
    return len(verts) - 1


rings = []
for r in RIBS:
    rings.append([put(rib_point(r, u, v)) for (u, v) in loop])
for i in range(len(rings) - 1):
    for k in range(n):
        k2 = (k + 1) % n
        faces.append((rings[i][k], rings[i + 1][k], rings[i + 1][k2]))
        faces.append((rings[i][k], rings[i + 1][k2], rings[i][k2]))
for end in (0, len(rings) - 1):
    apex = put(rib_point(RIBS[end], 0.0, 0.5))
    for k in range(n):
        k2 = (k + 1) % n
        if end == 0:
            faces.append((apex, rings[end][k], rings[end][k2]))
        else:
            faces.append((apex, rings[end][k2], rings[end][k]))

body = mesh_from('CoachBody', verts, faces, mat_body, smooth=True)
smart_uv(body)

# ------------------------------------------------------------------ maroon swoosh ribbons

def swoosh_y(x):
    # gentle wave: low amidships, kicking up toward the nose
    t = (x + 5.6) / 11.4
    return 1.45 + 0.55 * t * t + 0.06 * math.sin(t * 6.0)


swoosh_quads = []
NX = 48
for side in (1.0, -1.0):
    for i in range(NX):
        x0 = -5.2 + 10.6 * i / NX
        x1 = -5.2 + 10.6 * (i + 1) / NX
        for xa, xb in ((x0, x1),):
            ya0, yb0 = swoosh_y(xa) - 0.17, swoosh_y(xb) - 0.17
            ya1, yb1 = swoosh_y(xa) + 0.17, swoosh_y(xb) + 0.17
            za0, zb0 = REPAIR_HULL.surface(xa, ya0, 2) + 0.015, REPAIR_HULL.surface(xb, yb0, 2) + 0.015
            za1, zb1 = REPAIR_HULL.surface(xa, ya1, 2) + 0.015, REPAIR_HULL.surface(xb, yb1, 2) + 0.015
            q = [(xa, ya0, side * za0), (xb, yb0, side * zb0),
                 (xb, yb1, side * zb1), (xa, ya1, side * za1)]
            if side < 0:
                q = [q[0], q[3], q[2], q[1]]
            swoosh_quads.append(q)
swoosh = quad_strip('CoachSwoosh', swoosh_quads, mat_maroon)

# ------------------------------------------------------------------ chrome belt trim

belt_quads = []
for side in (1.0, -1.0):
    y0, y1 = 1.82, 1.90
    z0 = flank_half(1.86) + 0.02
    q = [(-4.9, y0, side * z0), (4.9, y0, side * z0),
         (4.9, y1, side * z0), (-4.9, y1, side * z0)]
    if side < 0:
        q = [q[0], q[3], q[2], q[1]]
    belt_quads.append(q)
belt = quad_strip('CoachBelt', belt_quads, mat_chrome)
# CANARY: lower chrome spear (ref lower trim line) + rivet rows along the
# belt. Stays inside flank bounds; colliders/doors untouched.
spear_quads = []
for side in (1.0, -1.0):
    y0, y1 = 1.02, 1.075
    z0 = flank_half(1.05) + 0.02
    q = [(-4.9, y0, side * z0), (4.9, y0, side * z0),
         (4.9, y1, side * z0), (-4.9, y1, side * z0)]
    if side < 0:
        q = [q[0], q[3], q[2], q[1]]
    spear_quads.append(q)
spear = quad_strip('CoachSpear', spear_quads, mat_chrome)
def octa(name, loc, s, mat):
    cx, cy, cz = loc
    v = [(cx - s, cy, cz), (cx + s, cy, cz), (cx, cy - s, cz),
         (cx, cy + s, cz), (cx, cy, cz - s), (cx, cy, cz + s)]
    f = [(0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4),
         (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)]
    return mesh_from(name, v, f, mat, smooth=False)
for side in (1.0, -1.0):
    z0 = flank_half(1.86) + 0.028
    for i in range(25):
        x = -4.8 + 9.6 * i / 24
        octa(f'CoachRivet_{"L" if side > 0 else "R"}_{i}', (x, 1.86, side * z0),
             0.016, mat_chrome)

# ------------------------------------------------------------------ glasshouse: side windows + pillars

for side in (1.0, -1.0):
    z = flank_half(2.3) + 0.012
    glass = box(f'CoachSideGlass_{"L" if side > 0 else "R"}',
                (0.0, 2.32, side * z), (8.6, 0.62, 0.03), mat_glass)
    # cream pillars over the band
    for px in (-3.4, -1.7, 0.0, 1.7, 3.4):
        box(f'CoachPillar_{"L" if side > 0 else "R"}_{px}',
            (px, 2.32, side * (z + 0.005)), (0.12, 0.66, 0.035), mat_body)
    # 0742: chunkier rubber hierarchy + restrained chrome pinstripe.
    # Gaskets 0.060 dominate; chrome 0.025 pinstripe outside. Wide bays get a
    # centre mullion (reference split sliders). Glass slab stays as seal bed.
    for (x0, x1) in ((-4.15, -3.55), (-3.25, -1.85), (-1.55, -0.15),
                     (0.15, 1.55), (1.85, 3.25), (3.55, 4.15)):
        cx, w = (x0 + x1) / 2, x1 - x0
        # standoff: glass face sits at z+0.015; gasket clears it, rim clears all.
        gz = side * (z + 0.017)
        box(f'CoachGasketT_{"L" if side > 0 else "R"}_{x0}',
            (cx, 2.643, gz), (w + 0.07, 0.060, 0.012), mat_trimdark)
        box(f'CoachGasketB_{"L" if side > 0 else "R"}_{x0}',
            (cx, 1.997, gz), (w + 0.07, 0.060, 0.012), mat_trimdark)
        box(f'CoachGasketL_{"L" if side > 0 else "R"}_{x0}',
            (x0 - 0.0125, 2.32, gz), (0.060, 0.60, 0.012), mat_trimdark)
        box(f'CoachGasketR_{"L" if side > 0 else "R"}_{x0}',
            (x1 + 0.0125, 2.32, gz), (0.060, 0.60, 0.012), mat_trimdark)
        rim_z = side * (z + 0.027)
        box(f'CoachRimT_{"L" if side > 0 else "R"}_{x0}',
            (cx, 2.672, rim_z), (w + 0.10, 0.025, 0.014), mat_chrome)
        box(f'CoachRimB_{"L" if side > 0 else "R"}_{x0}',
            (cx, 1.968, rim_z), (w + 0.10, 0.025, 0.014), mat_chrome)
        box(f'CoachRim0_{"L" if side > 0 else "R"}_{x0}',
            (x0 - 0.032, 2.32, rim_z), (0.025, 0.72, 0.014), mat_chrome)
        box(f'CoachRim1_{"L" if side > 0 else "R"}_{x0}',
            (x1 + 0.032, 2.32, rim_z), (0.025, 0.72, 0.014), mat_chrome)
        if w > 1.0:
            box(f'CoachMullion_{"L" if side > 0 else "R"}_{x0}',
                (cx, 2.32, gz), (0.050, 0.60, 0.014), mat_trimdark)
    # drip rail: full-length pinstripe above the glasshouse (both flanks).
    drip_z = side * (flank_half(2.70) + 0.020)
    box(f'CoachDrip_{"L" if side > 0 else "R"}',
        (0.0, 2.70, drip_z), (8.70, 0.035, 0.020), mat_chrome)
    # 0742 entry door: applique only, clear of arches (front arch rear 3.08).
    # Rect 0.85w x 1.00h glass up / 1.00h panel low; seam frame + handle.
    dx0, dx1, dy0, dy1 = 1.95, 2.80, 0.75, 2.60
    dcx, door_z = (dx0 + dx1) / 2, side * (flank_half(1.65) + 0.018)
    box(f'CoachDoorSeamT_{"L" if side > 0 else "R"}',
        (dcx, dy1 + 0.030, door_z), (0.97, 0.060, 0.014), mat_trimdark)
    box(f'CoachDoorSeamB_{"L" if side > 0 else "R"}',
        (dcx, dy0 - 0.030, door_z), (0.97, 0.060, 0.014), mat_trimdark)
    box(f'CoachDoorSeamL_{"L" if side > 0 else "R"}',
        (dx0 - 0.030, (dy0 + dy1) / 2, door_z), (0.060, dy1 - dy0 + 0.12, 0.014), mat_trimdark)
    box(f'CoachDoorSeamR_{"L" if side > 0 else "R"}',
        (dx1 + 0.030, (dy0 + dy1) / 2, door_z), (0.060, dy1 - dy0 + 0.12, 0.014), mat_trimdark)
    box(f'CoachDoorPanel_{"L" if side > 0 else "R"}',
        (dcx, 1.20, door_z), (0.85, 0.90, 0.012), mat_body)
    box(f'CoachDoorGlass_{"L" if side > 0 else "R"}',
        (dcx, 2.18, door_z), (0.85, 0.72, 0.012), mat_glass)
    box(f'CoachDoorHandle_{"L" if side > 0 else "R"}',
        (dx1 - 0.12, 1.62, side * (flank_half(1.65) + 0.032)), (0.16, 0.035, 0.030), mat_chrome)
# Surface-conforming front/rear and connected wheel-arch repair.
_roles = {'dark': mat_trimdark, 'glass': mat_glass, 'chrome': mat_chrome, 'signal': mat_signal}
for _part in REPAIR_PARTS:
    mesh_from(_part['name'], _part['vertices'], _part['faces'],
              _roles[_part['material']], smooth=_part['material'] in ('glass', 'chrome'))

# ------------------------------------------------------------------ wheels: 6x whitewall (3 axles), rest y=0

WHEEL_R = 0.52
WHEEL_Y = WHEEL_R  # bottom touches y=0
for ai, ax in enumerate((3.70, -2.40, -3.60)):
    for side in (1.0, -1.0):
        zc = side * 1.15
        tyre = cylinder_z(f'CoachTyre_{ai}_{"L" if side > 0 else "R"}',
                          (ax, WHEEL_Y, zc), WHEEL_R, 0.36, mat_rubber, verts_n=32)
        wall = cylinder_z(f'CoachWall_{ai}_{"L" if side > 0 else "R"}',
                          (ax, WHEEL_Y, zc), 0.28, 0.38, mat_whitewall, verts_n=32)
        hub = cylinder_z(f'CoachHub_{ai}_{"L" if side > 0 else "R"}',
                         (ax, WHEEL_Y, zc), 0.14, 0.42, mat_chrome, verts_n=20)
# 0742 running gear: red steel rim + chrome lip + dome + seated lugs;
# connected surface-conforming arch ribbons are emitted above.
# Frozen collider envelope: x +/-5.8, z +/-1.435, y 0..3.4; no collider change.
for ai, ax in enumerate((3.70, -2.40, -3.60)):
    for side in (1.0, -1.0):
        zc = side * 1.15
        tag = f'{ai}_{"L" if side > 0 else "R"}'
        rim = cylinder_z(f'CoachRimRed_{tag}', (ax, WHEEL_Y, zc),
                         0.205, 0.44, mat_signal, verts_n=24)
        lip = cylinder_z(f'CoachRimLip_{tag}', (ax, WHEEL_Y, side * 1.375),
                         0.215, 0.012, mat_chrome, verts_n=24)
        dome = cylinder_z(f'CoachDome_{tag}', (ax, WHEEL_Y, zc),
                          0.085, 0.47, mat_chrome, verts_n=16)
        for li in range(8):
            a = 2 * math.pi * li / 8
            lx, ly = ax + 0.145 * math.cos(a), WHEEL_Y + 0.145 * math.sin(a)
            box(f'CoachLug_{tag}_{li}', (lx, ly, zc + side * 0.225),
                (0.040, 0.040, 0.040), mat_trimdark)
box('CoachBelly', (-0.1, 0.62, 0.0), (10.6, 0.10, 2.10), mat_trimdark)
for _mz in (-1.0, 1.0):
    box(f'CoachFlap_{"L" if _mz > 0 else "R"}', (-4.25, 0.25, _mz * 1.15),
        (0.06, 0.50, 0.42), mat_trimdark)

# ------------------------------------------------------------------ mirrors + roof vent (period detail)

for side in (1.0, -1.0):
    box(f'CoachMirrorArm_{"L" if side > 0 else "R"}',
        (5.05, 2.30, side * 1.19), (0.05, 0.05, 0.28), mat_chrome)
    box(f'CoachMirror_{"L" if side > 0 else "R"}',
        (5.05, 2.22, side * 1.33), (0.06, 0.28, 0.14), mat_chrome)
box('CoachRoofVent', (-0.5, 3.28, 0.0), (1.4, 0.10, 0.5), mat_body)

# Check the complete world-space asset BEFORE coordinate-system export roll.
# Updating here is required: local cylinder locations must reach matrix_world.
bpy.context.view_layer.update()
_bounds = [[float('inf')]*3, [float('-inf')]*3]
for _o in [o for o in bpy.data.objects if o.type == 'MESH']:
    for _v in _o.data.vertices:
        _p = _o.matrix_world @ _v.co
        assert all(math.isfinite(v) for v in _p), f'nonfinite {_o.name}'
        for _axis in range(3):
            _bounds[0][_axis] = min(_bounds[0][_axis], _p[_axis])
            _bounds[1][_axis] = max(_bounds[1][_axis], _p[_axis])
assert all(_bounds[0][i] >= (-5.8, 0, -1.435)[i] - 1e-5 for i in range(3)), _bounds
assert all(_bounds[1][i] <= (5.8, 3.4, 1.435)[i] + 1e-5 for i in range(3)), _bounds
assert C.scene_tri_count() <= 12000, C.scene_tri_count()
print('COACH_GEOMETRY_0824 preexport_bounds=' + repr(_bounds))

# The coach is authored y-up (three.js convention: y = height, nose +x) but
# Blender models z-up. Roll every coach object +90 deg about X before export:
# (x, y, z) -> (x, -z, y) puts height on Blender Z and width on Blender Y.
# NOTE: must premultiply in world space (Blender XYZ Eulers apply X first,
# so bumping rotation_euler.x corrupts objects that already have rotation).
from mathutils import Matrix as _Matrix
_ROLL = _Matrix.Rotation(math.pi / 2, 4, 'X')
for _ob in [o for o in bpy.data.objects if o.type == 'MESH']:
    _ob.matrix_world = _ROLL @ _ob.matrix_world
bpy.context.view_layer.update()

# ------------------------------------------------------------------ finalize + export

# apply object transforms so origin sits at ground centre, +x nose preserved
bpy.ops.object.select_all(action='SELECT')
bpy.context.view_layer.objects.active = body
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

tris = C.scene_tri_count()
vram = C.vram_bytes(EMBEDDED_IMAGES)

OUT_GLB.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=str(OUT_GLB),
    export_format='GLB',
    export_apply=True,
    export_yup=True,
    export_materials='EXPORT',
)
wall = time.perf_counter() - T0
size_b = OUT_GLB.stat().st_size

print(f'COACH_GEOMETRY_0824 time_s={wall:.1f} tris={tris} '
      f'vram_bytes={vram} glb_bytes={size_b} path={OUT_GLB}')
print(f'COACH_GEOMETRY_0824 materials={len(bpy.data.materials)} '
      f'embedded={len(EMBEDDED_IMAGES)}x1024')
assert tris <= 12000, f'0824 tri budget blown: {tris}'
assert len(bpy.data.materials) <= 6, '0824 material budget blown'
if size_b > 6 * 1024 * 1024:
    print(f'COACH_GEOMETRY_0824 WARN glb_bytes={size_b} exceeds 6 MiB')

# ------------------------------------------------------------------ optional headless render

if '--render' in sys.argv:
    OUT_PNG.parent.mkdir(parents=True, exist_ok=True)
    try:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except TypeError:
        try:
            scene.render.engine = 'BLENDER_EEVEE'
        except TypeError:
            pass
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.filepath = str(OUT_PNG)
    scene.render.image_settings.file_format = 'PNG'

    cam_data = bpy.data.cameras.new('CoachCam')
    cam = bpy.data.objects.new('CoachCam', cam_data)
    link(cam)
    cam.location = (12.6, -9.6, 4.6)
    # track to coach centre
    con = cam.constraints.new('TRACK_TO')
    tgt = bpy.data.objects.new('CoachTarget', None)
    link(tgt)
    tgt.location = (0.0, 0.0, 1.6)
    con.target = tgt
    con.track_axis = 'TRACK_NEGATIVE_Z'
    con.up_axis = 'UP_Y'
    scene.camera = cam

    sun_data = bpy.data.lights.new('CoachSun', 'SUN')
    sun = bpy.data.objects.new('CoachSun', sun_data)
    link(sun)
    area_data = bpy.data.lights.new('CoachFill', 'AREA')
    area = bpy.data.objects.new('CoachFill', area_data)
    link(area)
    area.location = (-6.0, -7.0, 5.0)
    area_data.energy = 800.0
    area_data.size = 4.0

    bpy.ops.render.render(write_still=True)
    print(f'COACH_GEOMETRY_0824_RENDER path={OUT_PNG}')
