"""Headless build of the Nuketown 2025 tour-coach hero asset.

Run:
    blender --background --python scripts/blender/build_coach.py
    blender --background --python scripts/blender/build_coach.py -- --render

Produces public/assets/coach.glb (PBR maps embedded, no external files) and,
with --render, captures/blend-coach.png (headless single-pass render).

Deterministic: fixed RNG seed, no timestamps in scene, no downloaded data.
Scale: metres. Coach ~11.2 long (x), ~2.6 wide, ~3.1 tall, wheels rest y=0,
nose +x, origin at ground centre.
"""

import math
import sys
import time
from pathlib import Path

THIS = Path(__file__).resolve()
ROOT = THIS.parents[2]
sys.path.insert(0, str(THIS.parent))

import bpy  # noqa: E402

import common as C  # noqa: E402

BL_EXE = "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe"
SEED = 7
OUT_GLB = ROOT / "public" / "assets" / "coach.glb"
OUT_PNG = ROOT / "captures" / "blend-coach.png"

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
        ring_b.append((cx + r * math.cos(a), cy + r * math.sin(a), cz - depth / 2))
        ring_t.append((cx + r * math.cos(a), cy + r * math.sin(a), cz + depth / 2))
    v = ring_b + ring_t
    f = []
    n = verts_n
    for i in range(n):
        j = (i + 1) % n
        f.append((i, j, n + j, n + i))
    f.append(tuple(reversed(range(n))))
    f.append(tuple(range(n, 2 * n)))
    return mesh_from(name, v, f, mat, smooth=False)


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
mat_maroon = principled('CoachMaroon', MAROON_HEX, metallic=0.05, roughness=0.42)
mat_chrome = principled('CoachChrome', CHROME_HEX, metallic=1.0, roughness=0.24)
mat_glass = principled('CoachGlass', GLASS_HEX, metallic=0.0, roughness=0.08, alpha=0.55)
mat_rubber = principled('CoachRubber', 0x1A1A1C, metallic=0.0, roughness=0.9)
mat_whitewall = principled('CoachWhitewall', 0xE9E6DD, metallic=0.0, roughness=0.6)
mat_dark = principled('CoachDark', 0x141518, metallic=0.2, roughness=0.8)
mat_lens = principled('CoachLens', 0xFFF6DC, metallic=0.0, roughness=0.15)
mat_taillens = principled('CoachTail', 0xB02822, metallic=0.0, roughness=0.25)
mat_blind = principled('CoachBlind', 0x2A2620, metallic=0.0, roughness=0.7)

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
img_base = C.make_image(
    'Coach_Body_BaseColor', 2048, 2048, 'sRGB',
    lambda u, v: (
        min(1.0, CREAM_LIN[0] * (1.0 + 0.012 * _grain(u, v, 1)) * (0.90 + 0.10 * _ao(u, v))),
        min(1.0, CREAM_LIN[1] * (1.0 + 0.012 * _grain(u, v, 2)) * (0.90 + 0.10 * _ao(u, v))),
        min(1.0, CREAM_LIN[2] * (1.0 + 0.012 * _grain(u, v, 3)) * (0.90 + 0.10 * _ao(u, v))),
        1.0))
img_rough = C.make_image(
    'Coach_Body_Roughness', 1024, 1024, 'Non-Color',
    lambda u, v: (0.45 + 0.05 * _grain(u, v, 4),) * 3 + (1.0,))
img_metal = C.make_image(
    'Coach_Body_Metallic', 1024, 1024, 'Non-Color',
    lambda u, v: (0.05, 0.05, 0.05, 1.0))
img_normal = C.make_image(
    'Coach_Body_Normal', 1024, 1024, 'Non-Color',
    lambda u, v: (0.5, 0.5, 1.0, 1.0))
img_ao = C.make_image(
    'Coach_Body_AO', 1024, 1024, 'Non-Color',
    lambda u, v: (_ao(u, v),) * 3 + (1.0,))

MAP_IMAGES = [img_base, img_rough, img_metal, img_normal, img_ao]
# Decoded cost of what is actually embedded in the .glb: the exporter merges
# roughness+metallic into one ORM texture and carries AO inside base colour,
# so the file holds base(2048) + normal(1024) + ORM(1024, same size as rough).
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
            za0, zb0 = flank_half(ya0) + 0.015, flank_half(yb0) + 0.015
            za1, zb1 = flank_half(ya1) + 0.015, flank_half(yb1) + 0.015
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

# ------------------------------------------------------------------ glasshouse: side windows + pillars

for side in (1.0, -1.0):
    z = flank_half(2.3) + 0.012
    glass = box(f'CoachSideGlass_{"L" if side > 0 else "R"}',
                (0.0, 2.32, side * z), (8.6, 0.62, 0.03), mat_glass)
    # cream pillars over the band
    for px in (-3.4, -1.7, 0.0, 1.7, 3.4):
        box(f'CoachPillar_{"L" if side > 0 else "R"}_{px}',
            (px, 2.32, side * (z + 0.005)), (0.12, 0.66, 0.035), mat_body)

# ------------------------------------------------------------------ raked split windscreen + blind + divider

def screen_quad(side_sign):
    # two raked panes forming a shallow V, hugging the nose profile
    yb, yt = 1.95, 2.62
    xb = nose_x(yb) + 0.02
    xt = nose_x(yt) + 0.02
    half_in, half_out = 0.06, 1.02
    if side_sign > 0:
        return [(xb, yb, half_in), (xb, yb, half_out),
                (xt, yt, half_out * 0.92), (xt, yt, half_in)]
    return [(xb, yb, -half_out), (xb, yb, half_in),
            (xt, yt, half_in), (xt, yt, half_out * 0.92)]


glass_L = mesh_from('CoachScreenL', screen_quad(1.0),
                    [(0, 1, 2, 3)], mat_glass, smooth=False)
glass_R = mesh_from('CoachScreenR', screen_quad(-1.0),
                    [(0, 1, 2, 3)], mat_glass, smooth=False)
# dark frame behind, slightly larger
frame_L = mesh_from('CoachScreenFrameL',
                    [(p[0] - 0.015, p[1], p[2] * 1.03) for p in screen_quad(1.0)],
                    [(0, 1, 2, 3)], mat_dark, smooth=False)
frame_R = mesh_from('CoachScreenFrameR',
                    [(p[0] - 0.015, p[1], p[2] * 1.03) for p in screen_quad(-1.0)],
                    [(0, 1, 2, 3)], mat_dark, smooth=False)
# centre divider bar
box('CoachScreenDivider', (nose_x(2.28) + 0.03, 2.28, 0.0), (0.05, 0.72, 0.07), mat_chrome)
# destination blind above the screen
box('CoachBlind', (nose_x(2.78) + 0.02, 2.78, 0.0), (0.06, 0.30, 1.10), mat_blind)
box('CoachBlindRim', (nose_x(2.78) + 0.005, 2.78, 0.0), (0.04, 0.36, 1.18), mat_chrome)

# ------------------------------------------------------------------ bumpers, grille, lamps

box('CoachBumperF', (5.78, 0.72, 0.0), (0.22, 0.22, 2.30), mat_chrome)
box('CoachBumperR', (-5.70, 0.72, 0.0), (0.22, 0.22, 2.30), mat_chrome)
box('CoachGrille', (nose_x(1.2) + 0.03, 1.20, 0.0), (0.08, 0.55, 1.50), mat_chrome)
# vertical grille slats
for gz in (-0.6, -0.36, -0.12, 0.12, 0.36, 0.6):
    box(f'CoachGrilleSlat_{gz}', (nose_x(1.2) + 0.07, 1.20, gz),
        (0.05, 0.48, 0.06), mat_dark)

for i, lz in enumerate((-0.78, -0.42, 0.42, 0.78)):
    # headlamp socket + lens, aimed +x
    sock = cylinder_z(f'CoachHeadSock_{i}', (nose_x(1.55) - 0.02, 1.55, lz),
                      0.14, 0.10, mat_dark, verts_n=20)
    sock.rotation_euler = (0.0, math.pi / 2, 0.0)
    lens = cylinder_z(f'CoachHeadLens_{i}', (nose_x(1.55) + 0.05, 1.55, lz),
                      0.115, 0.06, mat_lens, verts_n=20)
    lens.rotation_euler = (0.0, math.pi / 2, 0.0)
for i, lz in enumerate((-0.85, -0.45, 0.45, 0.85)):
    sock = cylinder_z(f'CoachTailSock_{i}', (-5.62, 1.55, lz), 0.11, 0.10, mat_dark, verts_n=16)
    sock.rotation_euler = (0.0, math.pi / 2, 0.0)
    lens = cylinder_z(f'CoachTailLens_{i}', (-5.68, 1.55, lz), 0.09, 0.06, mat_taillens, verts_n=16)
    lens.rotation_euler = (0.0, math.pi / 2, 0.0)

# ------------------------------------------------------------------ wheels: 6x whitewall (3 axles), rest y=0

WHEEL_R = 0.52
WHEEL_Y = WHEEL_R  # bottom touches y=0
for ai, ax in enumerate((3.70, -2.40, -3.60)):
    for side in (1.0, -1.0):
        zc = side * 1.15
        tyre = cylinder_z(f'CoachTyre_{ai}_{"L" if side > 0 else "R"}',
                          (ax, WHEEL_Y, zc), WHEEL_R, 0.36, mat_rubber, verts_n=28)
        wall = cylinder_z(f'CoachWall_{ai}_{"L" if side > 0 else "R"}',
                          (ax, WHEEL_Y, zc), 0.30, 0.38, mat_whitewall, verts_n=28)
        hub = cylinder_z(f'CoachHub_{ai}_{"L" if side > 0 else "R"}',
                         (ax, WHEEL_Y, zc), 0.14, 0.42, mat_chrome, verts_n=20)

# ------------------------------------------------------------------ mirrors + roof vent (period detail)

for side in (1.0, -1.0):
    box(f'CoachMirrorArm_{"L" if side > 0 else "R"}',
        (5.05, 2.30, side * 1.38), (0.05, 0.05, 0.22), mat_chrome)
    box(f'CoachMirror_{"L" if side > 0 else "R"}',
        (5.05, 2.22, side * 1.48), (0.06, 0.28, 0.16), mat_chrome)
box('CoachRoofVent', (-0.5, 3.28, 0.0), (1.4, 0.10, 0.5), mat_body)

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

print(f'COACH_BUILD time_s={wall:.1f} tris={tris} '
      f'vram_bytes={vram} glb_bytes={size_b} path={OUT_GLB}')

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
    print(f'COACH_RENDER path={OUT_PNG}')
