"""Deterministic authored distant-mountain backdrop (Blender-native mesh route).

Why this file exists: two harmonic heightfield rounds (128-160 segment rings,
15744 tris) passed every CPU/browser cell yet FAILED actual image review —
the ranges still read as smooth parallel ribbons with white stripe tops and
almost no geological rock surface. Per directive this is NOT a third parameter
tweak: it authors explicit intersecting massif / buttress / mesa geometry in
Blender, with eroded relief displaced into the mesh and rock variation carried
by geometry + two small math-filled textures.

Route (ai-3d-asset-generation-loop): Blender-native authored mesh. NOT
image-to-3D (invents hidden geometry, uncontrolled scale/pivot/tris, licence
burden) and NOT a licensed registry kit (inherits чужой art direction).
Distant scenery on fixed layout anchors needs explicit structure,
deterministic regeneration and diffable source.

Budgets (guarded root run: CPU, 2 threads, 2 GiB, no Cycles, no GPU):
  draws <= 3 (one joined mesh per ring), tris <= 18000 total,
  textures <= 2 embedded PNGs at <= 1024 px, no subdivision surfaces,
  no booleans, no bake, no downloads, no HDRI.

Layout anchors (NEVER drift — map/camera/layout preserved):
  rings R = 310 / 460 / 660 m, baseY = -12 m (sunk), nothing inside R < 280 m.
  Origin stays at world origin; town sightlines, needle/saucer/dome anchors
  and gameplay bounds are untouched (backdrop only, zero colliders).

Headless build (root runs; this lane is source-only, never executed here):
  call "C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe" ^
    --background --threads 2 --python scripts/blender/build_authored_mountains.py
  optional EEVEE thumbnail: append " -- --render"

Provenance: authored here from scratch, SEED fixed, zero external inputs.
Reference (inspiration, NOT reconstruction): frozen root bar
  docs/reference/refinement-targets/yard-white.png — jagged sunlit pale-tan /
  gray massifs, stepped cliffs, dendritic chutes, alluvial aprons.
Generated 2D is reference, not reconstructed 3D: this is an authored
reconstruction that rhymes with the target's geology, it does not copy it.
"""

import math
import sys
import time
from pathlib import Path

THIS = Path(__file__).resolve()
ROOT = THIS.parents[2]
OUT_GLB = ROOT / "public" / "assets" / "authored-mountains" / "authored-mountains.glb"
OUT_PNG = ROOT / "captures" / "blend-authored-mountains.png"

sys.path.insert(0, str(THIS.parent))

import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Matrix as _Matrix  # noqa: E402

import common as C  # noqa: E402

SEED = 20260919
T0 = time.perf_counter()

# Palette anchors from src/core/palette.ts (sRGB hex, arid rock family).
DIRT_HEX = 0x8A7A5E
SAND_HEX = 0xC4AB7E
ROCK_HEX = 0x9A8F7C
PALE_HEX = 0xB4BCC6

MAX_TRIS = 18000
MAX_DRAWS = 3

# (name, radius, massifs, hMin, hSpan, tangentW, radialD, gullyFreq,
#  gullyDepthFrac, strataStrength, mesaCaps)
RINGS = [
    ("near", 310.0, 6, 54.0, 36.0, 95.0, 70.0, 21, 0.16, 0.32, 2),
    ("mid", 460.0, 6, 120.0, 70.0, 125.0, 105.0, 25, 0.18, 0.28, 2),
    ("far", 660.0, 5, 165.0, 80.0, 155.0, 140.0, 19, 0.14, 0.22, 0),
]
RING_PHASE = (0.0, 2.13, 4.31)
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
    pass  # only the optional thumbnail renders anyway
# ------------------------------------------------------------- rock textures
# Two embedded images only. Procedural node math does NOT survive glTF export
# (measured 2026-09-14: unbaked heroes render white in-engine), so the rock
# read is pixel-filled here and wired straight into Principled BSDF — the
# coach lane's defence. Albedo carries multi-scale rock mottle (breaks the
# uniform flat-ribbon read); geometry carries strata benches + gully shade;
# roughness carries bounded 0.86..1.0 variation. No normal map: faceted
# geometry IS the normal detail (flat-shaded export splits verts per face).

DIRT_LIN = C.hex_to_linear_rgb(DIRT_HEX)
SAND_LIN = C.hex_to_linear_rgb(SAND_HEX)
ROCK_LIN = C.hex_to_linear_rgb(ROCK_HEX)
PALE_LIN = C.hex_to_linear_rgb(PALE_HEX)


def _mix(a, b, t):
    return (a[0] + (b[0] - a[0]) * t,
            a[1] + (b[1] - a[1]) * t,
            a[2] + (b[2] - a[2]) * t)


def _albedo(u, v):
    n = (0.55 * _hash2(u * 37.0, v * 41.0, 11.0)
         + 0.30 * _hash2(u * 91.0, v * 73.0, 12.0)
         + 0.15 * _hash2(u * 211.0, v * 197.0, 13.0)) * 0.5 + 0.5
    col = _mix(DIRT_LIN, ROCK_LIN, min(1.0, max(0.0, n * 1.25 - 0.10)))
    col = _mix(col, PALE_LIN, min(1.0, max(0.0, (n - 0.62) * 1.6)) * 0.55)
    band = 0.5 + 0.5 * math.sin((v * 9.0 + n * 2.2) * math.tau)
    k = 1.0 + (band - 0.5) * 0.16
    if v < 0.25:  # talus tint toward sand at island feet
        col = _mix(SAND_LIN, col, v / 0.25)
    return (min(1.0, col[0] * k), min(1.0, col[1] * k), min(1.0, col[2] * k), 1.0)


def _rough(u, v):
    n = (0.6 * _hash2(u * 53.0, v * 47.0, 21.0)
         + 0.4 * _hash2(u * 129.0, v * 117.0, 22.0)) * 0.5 + 0.5
    r = 0.86 + 0.14 * min(1.0, max(0.0, n))
    return (r, r, r, 1.0)


def _metal(u, v):
    return (0.0, 0.0, 0.0, 1.0)


img_base = C.make_image("Mtn_BaseColor", 1024, 1024, "sRGB", _albedo)
img_rough = C.make_image("Mtn_Roughness", 1024, 1024, "Non-Color", _rough)
img_metal = C.make_image("Mtn_Metallic", 1024, 1024, "Non-Color", _metal)
# Exporter merges roughness+metallic into one ORM texture and carries base
# separately: exactly 2 embedded PNGs, both 1024.
EMBEDDED_IMAGES = [img_base, img_rough]


def _principled():
    mat = bpy.data.materials.new("AuthoredMountainRock")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    try:
        bsdf.inputs["Metallic"].default_value = 0.0
        bsdf.inputs["Roughness"].default_value = 1.0
    except KeyError:
        pass

    def _img_node(image):
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = image
        return node

    n_base = _img_node(img_base)
    n_rough = _img_node(img_rough)
    n_metal = _img_node(img_metal)
    nt.links.new(bsdf.inputs["Base Color"], n_base.outputs["Color"])
    for sock, src in (("Roughness", n_rough), ("Metallic", n_metal)):
        try:
            nt.links.new(bsdf.inputs[sock], src.outputs["Color"])
        except KeyError:
            pass
    return mat


mat_rock = _principled()
# ------------------------------------------------------- massif part builders
# Parts are plain bmesh cubes (subdivided unit box, pure-Python deform, no
# edit-mode ops, no booleans): intersecting volumes hide their seams because
# every part shares one material and depth testing resolves the overlaps.


def _unit_box(cuts):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    if cuts > 0:
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts,
                                  use_grid_fill=True)
    return bm


def _deform_core(bm, mesa, horn):
    for v in bm.verts:
        x, y, z = v.co.x, v.co.y, v.co.z
        h = y + 0.5  # 0 bottom .. 1 top
        x += 0.22 * h  # fault-block dip: top leans outward (+x = radial out)
        taper = 1.0 - 0.30 * h
        x *= taper
        z *= 1.0 - 0.38 * h
        if horn and y > 0.15:  # far horns stay pointed, never tabular
            x *= 0.45
            z *= 0.45
        if mesa and y > 0.28:  # tabular cap seat on capped summits only
            y = 0.28
        v.co.x, v.co.y, v.co.z = x, y, z


def _mesh_from_bm(name, bm, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    if mat is not None:
        me.materials.append(mat)
    return ob


def _place(ob, x, y, z, yaw, sx, sy, sz):
    ob.location = (x, y, z)
    ob.rotation_euler = (0.0, yaw, 0.0)
    ob.scale = (sx, sy, sz)


RING_PARTS = ([], [], [])  # per-ring part objects before join
_part_idx = 0


def _next_tag():
    global _part_idx
    _part_idx += 1
    return _part_idx


def build_massif(ri, ang, R, hgt, wtan, deprad, mesa, horn):
    # Anchor massif coordinates so town-facing spur and talus apron
    # strictly preserve the >= 280 m keepout boundary.
    rad_anchor = R + deprad * 1.20
    cx = math.cos(ang) * rad_anchor
    cz = math.sin(ang) * rad_anchor
    yaw = -ang  # local +X -> radial-outward, local +Z -> tangential
    n = _next_tag()
    bm = _unit_box(3)
    _deform_core(bm, mesa, horn)
    core = _mesh_from_bm("mtn_core_%d_%d" % (ri, n), bm, mat_rock)
    _place(core, cx, BASE_Y + hgt * 0.42, cz, yaw, deprad, hgt, wtan)
    RING_PARTS[ri].append(core)
    # Two spur buttresses projecting TOWARD town (front face), splayed +/-
    # off the fall line so couloirs read BETWEEN them, never under them.
    for side in (-1.0, 1.0):
        bm2 = _unit_box(1)
        spur = _mesh_from_bm("mtn_spur_%d_%d_%d" % (ri, n, int(side)), bm2, mat_rock)
        fx = cx - math.cos(ang) * deprad * 0.55
        fz = cz - math.sin(ang) * deprad * 0.55
        _place(spur, fx, BASE_Y + hgt * 0.22, fz,
               yaw + side * 0.38, deprad * 0.85, hgt * 0.52, wtan * 0.26)
        RING_PARTS[ri].append(spur)
    # Alluvial talus apron: wide, low, pushed town-ward of the foot.
    bm3 = _unit_box(1)
    talus = _mesh_from_bm("mtn_talus_%d_%d" % (ri, n), bm3, mat_rock)
    tx = cx - math.cos(ang) * deprad * 0.75
    tz = cz - math.sin(ang) * deprad * 0.75
    _place(talus, tx, BASE_Y + hgt * 0.07, tz,
           yaw + (rnd() - 0.5) * 0.3, deprad * 1.15, hgt * 0.15, wtan * 1.5)
    RING_PARTS[ri].append(talus)
    if mesa:
        # Tabular cap rides the flattened core seat: core top world y is
        # BASE_Y + 0.42*h + 0.28*h = BASE_Y + 0.70*h; cap half-height 1.6.
        bm4 = _unit_box(0)
        cap = _mesh_from_bm("mtn_mesa_%d_%d" % (ri, n), bm4, mat_rock)
        _place(cap, cx, BASE_Y + hgt * 0.70 + 1.2, cz,
               yaw, deprad * 0.48, 3.2, wtan * 0.40)
        RING_PARTS[ri].append(cap)


for ri, (rname, R, count, hMin, hSpan, wtan, deprad,
         _gf, _gd, _ss, mesa_n) in enumerate(RINGS):
    step = math.tau / count
    order = sorted(range(count), key=lambda k: rnd())
    mesas = set(order[:mesa_n])
    horn = (rname == "far")
    for k in range(count):
        ang = RING_PHASE[ri] + k * step + (rnd() - 0.5) * 0.30
        rr = R + (rnd() - 0.5) * 2.0 * (18.0 if ri == 0 else 28.0 if ri == 1 else 40.0)
        hgt = hMin + rnd() * hSpan
        w = wtan * (0.75 + 0.5 * rnd())
        d = deprad * (0.70 + 0.5 * rnd())
        build_massif(ri, ang, rr, hgt, w, d, mesa=(k in mesas), horn=horn)
# ------------------------------------------------- join one mesh per ring
# transform_apply bakes part matrices first so the join keeps world geometry.

RING_MESH = []
for ri, (rname, *_rest) in enumerate(RINGS):
    parts = RING_PARTS[ri]
    bpy.ops.object.select_all(action="DESELECT")
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = "Mtn_%s" % rname.capitalize()
    RING_MESH.append((ri, joined))

# ------------------------------------------- eroded relief detail pass (bmesh)
# Strata benches + front-face gully chutes + hash grain, in authored y-up
# metres BEFORE the export roll. Bounded: bench carve <= ~1 m, gully carve
# <= depthFrac * peak height, grain <= ~2.7 m radial. Mesa caps keep their
# tabular read: the +/-1.1 m grain is small against the 3.2 m cap and the
# flattened core seat, so no post-hoc clamp is needed.

GULLY_PHASE = [rnd() * math.tau for _ in RINGS]


def detail_ring(ri, ob, R, gfreq, gdepth, sstr):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    peak = 75.0 if ri == 0 else 145.0 if ri == 1 else 225.0
    for v in bm.verts:
        x, y, z = v.co.x, v.co.y, v.co.z
        r = math.hypot(x, z)
        ang = math.atan2(z, x)
        if y > 3.0:  # sedimentary bench risers
            t = (y / BENCH_M) % 1.0
            y -= BENCH_M * sstr * 0.5 * max(0.0, math.sin(t * math.pi)) ** 0.7
        front = min(1.0, max(0.0, (R + 55.0 - r) / 110.0))
        slope = min(1.0, max(0.0, (y - BASE_Y) / peak))
        slope *= 1.0 - min(1.0, max(0.0, (y - BASE_Y) / peak - 0.75) * 4.0)
        if front > 0.0 and slope > 0.0:
            chute = max(0.0, math.cos((ang - GULLY_PHASE[ri]) * gfreq)) ** 6.0
            carve = gdepth * peak * chute * front * slope
            y -= carve
            s = carve * 0.35 / max(1.0, r)
            x -= x * s
            z -= z * s
        h1 = _hash2(ang * 57.3, y * 12.9, 31.0 + ri)
        h2 = _hash2(y * 7.7, ang * 91.1, 32.0 + ri)
        y += 1.1 * h1
        rr = 1.0 + (1.6 * h2) / max(1.0, r)
        x *= rr
        z *= rr
        v.co.x, v.co.y, v.co.z = x, y, z
    bm.to_mesh(ob.data)
    ob.data.update()
    bm.free()


for ri, (rname, R, _c, _hm, _hs, _w, _d, gf, gd, ss, _m) in enumerate(RINGS):
    _ri2, _ob = RING_MESH[ri]
    assert _ri2 == ri
    detail_ring(ri, _ob, R, gf, gd, ss)

# ------------------------------------------------- UV + faceted rock shading


def smart_uv(ob):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")


for _ri, _ob in RING_MESH:
    smart_uv(_ob)
    for poly in _ob.data.polygons:  # crisp geological facets, not smooth domes
        poly.use_smooth = False

# ------------------------------------------------- y-up roll + export
# Authored y-up (three.js: y = height). Blender models z-up: roll every mesh
# +90 deg about X in world space BEFORE export: (x, y, z) -> (x, -z, y).
# Must premultiply (Blender XYZ Eulers apply X first, so bumping
# rotation_euler.x corrupts rotated parts — the exact lamp bug from coach).

_ROLL = _Matrix.Rotation(math.pi / 2, 4, "X")
for _ri, _ob in RING_MESH:
    _ob.matrix_world = _ROLL @ _ob.matrix_world
bpy.context.view_layer.update()

bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = RING_MESH[0][1]
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

tris = C.scene_tri_count()
vram = C.vram_bytes(EMBEDDED_IMAGES)
print("MTN_AUTHORED ring_meshes=%d tris=%d vram_bytes=%d" % (len(RING_MESH), tris, vram))
assert len(RING_MESH) == MAX_DRAWS, "draw budget: 3 joined ring meshes, got %d" % len(RING_MESH)
assert 3000 <= tris <= MAX_TRIS, "tri budget 3000..18000, got %d" % tris
for _ri, _ob in RING_MESH:
    xs = [v[0] for v in _ob.bound_box]
    ys = [v[1] for v in _ob.bound_box]
    zs = [v[2] for v in _ob.bound_box]
    # post-roll axes: x = east, y = depth(former z), z = height. Height range
    # must clear the town (tallest far peak ~210 m) and sit sunk at -12.
    assert min(zs) < -6.0, "ring %d not sunk: minZ=%.1f" % (_ri, min(zs))
    assert max(zs) > 60.0, "ring %d too low: maxZ=%.1f" % (_ri, max(zs))
    # Layout anchor assert: every vertex must stay strictly outside the 280 m keepout
    min_r = min(math.hypot(v.co.x, v.co.y) for v in _ob.data.vertices)
    assert min_r >= 280.0, "ring %d intrudes into keepout: min_r=%.2f < 280.0" % (_ri, min_r)

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
print("MTN_AUTHORED_BUILD time_s=%.1f tris=%d vram_bytes=%d glb_bytes=%d path=%s"
      % (wall, tris, vram, size_b, OUT_GLB))

# ------------------------------------------------- optional EEVEE thumbnail

if "--render" in sys.argv:
    OUT_PNG.parent.mkdir(parents=True, exist_ok=True)
    scene.render.engine = "BLENDER_EEVEE"
    try:
        scene.render.resolution_x = 1280
        scene.render.resolution_y = 720
        scene.render.resolution_percentage = 100
        scene.render.film_transparent = False
    except (AttributeError, TypeError):
        pass
    cam_data = bpy.data.cameras.new("MtnThumbCam")
    cam_data.lens = 50.0
    cam = bpy.data.objects.new("MtnThumbCam", cam_data)
    bpy.context.collection.objects.link(cam)
    # Town-centre eye toward the mid-ring massifs (yard-white-like bearing).
    cam.location = (-10.0, 1.0, 8.5)
    dx, dy = 460.0 + 10.0, 0.0 - 1.0
    import math as _mm
    cam.rotation_euler = (math.pi / 2 - 0.24, 0.0, -_mm.atan2(dy, dx) + _mm.pi / 2)
    scene.camera = cam
    sun = bpy.data.lights.new("MtnThumbSun", "SUN")
    sun_ob = bpy.data.objects.new("MtnThumbSun", sun)
    bpy.context.collection.objects.link(sun_ob)
    sun_ob.rotation_euler = (0.9, 0.2, 1.1)
    scene.render.filepath = str(OUT_PNG)
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    print("MTN_AUTHORED_RENDER path=%s" % OUT_PNG)
