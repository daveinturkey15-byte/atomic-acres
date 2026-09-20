"""Sedan envelope-first Blender recipe (muse-1117, repair1 of muse-1105).

Same numeric envelope as muse-1105 (envelope.py byte-identical): authored Y-up
parts are placed with object-transform ownership (cylinders LOCAL mesh +
ob.location/ob.rotation_euler; boxes baked), then baked, rolled Y-up -> Z-up,
joined by material, exported.

What muse-1105 got wrong (root evidence: authored y[0,1.445] z[-1.02,1.02]
baked to actual y[-0.99,0.99] z[-0.36,1.445]):
  location/rotation were assigned but matrix_world was read (ROLL premultiply)
  BEFORE any view_layer.update(), so every cylinder premultiplied from a stale
  identity matrix and lost its centre. -0.36 == -TUB_R proves tubs baked at
  origin; 0.99 == box-only mirror-arm outer proves rotated heads collapsed.
Fix here (explicit, no imagined semantics):
  1. view_layer.update() BEFORE any matrix_world read (BEFORE gates).
  2. Bake TRS into mesh data with transform_apply(location+rotation+scale),
     verify with AFTER-bake evaluated gates (verts own everything now).
  3. Roll with ob.data.transform(ROLL) -- mesh data is the single owner, so
     the roll cannot suffer TRS/matrix_world ordering hazards at all.
  4. Join by owned material AFTER all validation: GLB holds 6 mesh objects
     (one per material), not ~150 draws sharing 6 materials.
BEFORE/AFTER gates use EVALUATED world coordinates
(matrix_world @ bound_box corners), never nominal fields alone.
"""
import math
import sys
import time
from pathlib import Path

THIS = Path(__file__).resolve()
LANE = THIS.parent
sys.path.insert(0, str(LANE))
import envelope as E

import bpy

_F32_TOL_M = 1e-6
_F32_TOL_RAD = 1e-6
_EVAL_TOL_M = 1e-4  # evaluated world coords pass through float32 bound_box
SEED = 1117
OUT_GLB = LANE / "output" / "sedan-envelope-muse-1117.glb"
BODY_HEX = 0x28374F
CREAM_HEX = 0xE8E0CD
CHROME_HEX = 0xC8CCD0
GLASS_HEX = 0x66808E
TRIM_HEX = 0x2E3238
SIGNAL_HEX = 0xA8302C
TAG = "SEDAN_ENVELOPE_MUSE_1117"
T0 = time.perf_counter()

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images,
             bpy.data.cameras, bpy.data.lights):
    for x in list(coll):
        coll.remove(x)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1.0


def link(ob):
    bpy.context.collection.objects.link(ob)
    return ob


def mesh_from(name, verts, faces, mat=None, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.update()
    ob = bpy.data.objects.new(name, me)
    link(ob)
    if mat:
        ob.data.materials.append(mat)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    return ob


def box(name, loc, size, mat=None):
    v, f = E.box_local(size)
    return mesh_from(name, [(x + loc[0], y + loc[1], z + loc[2]) for (x, y, z) in v],
                      f, mat, smooth=False)


def cylinder_z(name, loc, r, depth, mat=None, verts_n=20):
    v, f = E.cyl_z_local(r, depth, verts_n)
    me = bpy.data.meshes.new(name)
    me.from_pydata(v, [], f)
    me.update()
    ob = bpy.data.objects.new(name, me)
    link(ob)
    ob.location = loc
    if mat:
        ob.data.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    return ob


def grid_mesh(name, verts, faces, mat=None, smooth=True):
    return mesh_from(name, verts, faces, mat, smooth)


def quad_strip(name, quads, mat=None, smooth=False):
    verts = []
    faces = []
    for q in quads:
        b = len(verts)
        verts.extend(q)
        faces.append((b, b + 1, b + 2, b + 3))
    return mesh_from(name, verts, faces, mat, smooth)


def select_only(ob):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def smart_uv(ob):
    try:
        select_only(ob)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.uv.smart_project(angle_limit=66)
        bpy.ops.object.mode_set(mode='OBJECT')
    except Exception:
        pass


def assert_quad_planar(q, name):
    (ax, ay, az), (bx, by, bz), (cx, cy, cz), (dx, dy, dz) = q
    ux, uy, uz = bx - ax, by - ay, bz - az
    vx, vy, vz = dx - ax, dy - ay, dz - az
    nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
    nl = math.sqrt(nx * nx + ny * ny + nz * nz) + 1e-12
    d = abs(nx * (cx - ax) + ny * (cy - ay) + nz * (cz - az)) / nl
    assert d < 1e-4, f'{name}: twisted pane {d:.6f}'


def principled(name, base_hex, metallic=0.0, roughness=0.5, alpha=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    r = (base_hex >> 16 & 255) / 255.0
    g = (base_hex >> 8 & 255) / 255.0
    b = (base_hex & 255) / 255.0
    bsdf.inputs['Base Color'].default_value = (r, g, b, 1.0)
    if 'Metallic' in bsdf.inputs:
        bsdf.inputs['Metallic'].default_value = metallic
    if 'Roughness' in bsdf.inputs:
        bsdf.inputs['Roughness'].default_value = roughness
    if alpha is not None:
        try:
            bsdf.inputs['Alpha'].default_value = alpha
            mat.blend_method = 'BLEND'
        except Exception:
            pass
    return mat


def _close_seq(a, e, t):
    return all(abs(x - y) <= t for x, y in zip(tuple(a), tuple(e)))


import mathutils

mat_body = principled('SedanBody', BODY_HEX, metallic=0.25, roughness=0.34)
mat_cream = principled('SedanCream', CREAM_HEX, metallic=0.0, roughness=0.42)
mat_chrome = principled('SedanChrome', CHROME_HEX, metallic=1.0, roughness=0.24)
mat_glass = principled('SedanGlass', GLASS_HEX, metallic=0.0, roughness=0.10, alpha=0.65)
mat_trim = principled('SedanTrimDark', TRIM_HEX, metallic=0.15, roughness=0.85)
mat_signal = principled('SedanSignalRed', SIGNAL_HEX, metallic=0.15, roughness=0.35)
EMBEDDED_IMAGES = []

# ---- envelope-first pre-flight: scan ACTUAL generator output before any mesh ----
hv, hf = E.loft_hull()
hog, hogf = E.hood_grid()
trg, trgf = E.trunk_grid()
roofv, rooff = E.roof_grid()
wsg, wsgf = E.windshield_grid()
rwg, rwgf = E.rear_grid()
archv, archf = E.arch_lips()
finv, finf = E.fins()
pre_sets = [hv, hog, trg, roofv, wsg, rwg, archv, finv] + [list(q) for q in E.side_glass_quads()]
for _n, _l, _s in E.addon_boxes() + E.lug_boxes() + E.trim_boxes():
    w, _ = E.box_world(_l, _s)
    pre_sets.append(w)
for _n, _l, _r, _d, _nn, _rot in E.addon_cylinders():
    loc = _l
    if _rot:
        v, _ = E.cyl_z_local(_r, _d, _nn)
        pre_sets.append([(_l[0] + p[2], _l[1] + p[1], _l[2] - p[0]) for p in v])
    else:
        w, _ = E.cyl_z_world(_l, _r, _d, _nn)
        pre_sets.append(w)
_mn, _mx, _errs = E.check_authored(pre_sets)
print(f'{TAG} pre authored x=[{_mn[0]:.3f},{_mx[0]:.3f}] y=[{_mn[1]:.3f},{_mx[1]:.3f}] z=[{_mn[2]:.3f},{_mx[2]:.3f}]')
assert not _errs, f'{TAG} pre-flight breach: {_errs}'

# ---- build (same ownership as 1105: boxes baked, cylinders LOCAL + TRS) ----
body = mesh_from('SedanBodyHull', hv, hf, mat_body, smooth=True)
smart_uv(body)
hood = grid_mesh('SedanHoodCrown', hog, hogf, mat_body)
smart_uv(hood)
trunk = grid_mesh('SedanTrunkCrown', trg, trgf, mat_body)
smart_uv(trunk)
roof = grid_mesh('SedanRoofCrown', roofv, rooff, mat_cream)
smart_uv(roof)
ws = grid_mesh('SedanWindshield', wsg, wsgf, mat_glass)
rw = grid_mesh('SedanRearWindow', rwg, rwgf, mat_glass)
sq = E.side_glass_quads()
for q in sq:
    assert_quad_planar(q, 'SedanSideGlass')
side_glass = quad_strip('SedanSideGlass', sq, mat_glass)
arches = quad_strip('SedanArchLips',
                    [[tuple(p) for p in q] for q in
                     [archv[i * 4:(i + 1) * 4] for i in range(len(archv) // 4)]],
                    mat_body)
finsm = mesh_from('SedanFins', finv, finf, mat_body, smooth=False)
for n, l, s in E.addon_boxes():
    m = mat_chrome
    if 'GrilleBack' in n or 'Belly' in n or 'MirrorArm' in n:
        m = mat_trim
    if 'Cream' in n or 'Plate' in n:
        m = mat_cream
    if 'Bumper' in n or 'Spear' in n or 'Handle' in n or 'Bar_' in n:
        m = mat_chrome
    box(n, l, s, m)
for n, l, r, d, nn, rot in E.addon_cylinders():
    m = mat_trim
    if 'Dome' in n or 'Bezel' in n or 'Dagmar' in n or 'Exhaust' in n or 'MirrorHead' in n:
        m = mat_chrome
    if 'Wall' in n:
        m = mat_cream
    if 'Lens' in n:
        m = mat_glass if 'Head' in n else mat_signal
    if 'TailSock' in n:
        m = mat_chrome
    ob = cylinder_z(n, l, r, d, m, verts_n=nn)
    if rot:
        ob.rotation_euler = (0.0, math.pi / 2, 0.0)
for n, l, s in E.lug_boxes():
    box(n, l, s, mat_chrome)
for n, l, s in E.trim_boxes():
    m = mat_chrome
    if 'Pillar' in n:
        m = mat_body
    box(n, l, s, m)

for _ob in [o for o in bpy.data.objects if o.type == 'MESH']:
    smart_uv(_ob)

# ---- EVALUATE the dependency graph before reading any matrix_world ----
# Without this, matrix_world is stale identity and every cylinder below reads
# (and bakes) at the origin. That staleness is the 1105 failure.
bpy.context.view_layer.update()


def eval_origin(ob):
    return ob.matrix_world @ mathutils.Vector((0.0, 0.0, 0.0))


def eval_centre(ob):
    acc = mathutils.Vector((0.0, 0.0, 0.0))
    for c in ob.bound_box:
        acc += ob.matrix_world @ mathutils.Vector(c)
    return acc / 8.0


def eval_axis_z(ob):
    v = ob.matrix_world.to_3x3() @ mathutils.Vector((0.0, 0.0, 1.0))
    return v.normalized()


# ---- BEFORE gates: EVALUATED world coords for EVERY cylinder-owned part ----
CYL = list(E.addon_cylinders())
assert len(CYL) > 0, f'{TAG}: no cylinder parts to gate'
print(f'{TAG} BEFORE evaluate: {len(CYL)} cylinder parts')
for n, l, r, d, nn, rot in CYL:
    ob = bpy.data.objects[n]
    exp = mathutils.Vector(l)
    # nominal ownership retained as a first tripwire ...
    assert _close_seq(ob.location, l, _F32_TOL_M), f'{ob.name}: off-centre {tuple(ob.location)}'
    if rot:
        assert _close_seq(ob.rotation_euler, (0.0, math.pi / 2, 0.0), _F32_TOL_RAD), \
            f'{ob.name}: lamp must hold (0,pi/2,0)'
    else:
        assert _close_seq(ob.rotation_euler, (0.0, 0.0, 0.0), _F32_TOL_RAD), \
            f'{ob.name}: must stay unrotated'
    # ... but EVALUATED world coordinates decide.
    c0 = eval_origin(ob)
    assert (c0 - exp).length <= _EVAL_TOL_M, f'{ob.name}: BEFORE origin {tuple(c0)} != {l}'
    cb = eval_centre(ob)
    assert (cb - exp).length <= _EVAL_TOL_M, f'{ob.name}: BEFORE centre {tuple(cb)} != {l}'
    az = eval_axis_z(ob)
    want = mathutils.Vector((1.0, 0.0, 0.0)) if rot else mathutils.Vector((0.0, 0.0, 1.0))
    assert (az - want).length <= 1e-3, f'{ob.name}: BEFORE axis {tuple(az)} != {tuple(want)}'
print(f'{TAG} BEFORE evaluate: all {len(CYL)} centres+axes hold')

# ---- bake TRS into mesh data (verts become the single owner) ----
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='SELECT')
act = next(o for o in bpy.data.objects if o.type == 'MESH')
bpy.context.view_layer.objects.active = act
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.context.view_layer.update()

# ---- AFTER-bake gates: verts hold authored world, objects back at identity ----
for n, l, r, d, nn, rot in CYL:
    ob = bpy.data.objects[n]
    exp = mathutils.Vector(l)
    cb = eval_centre(ob)
    assert (cb - exp).length <= _EVAL_TOL_M, f'{ob.name}: AFTER-bake centre {tuple(cb)} != {l}'
    assert _close_seq(ob.location, (0.0, 0.0, 0.0), _F32_TOL_M), f'{ob.name}: bake left location'
    assert _close_seq(ob.rotation_euler, (0.0, 0.0, 0.0), _F32_TOL_RAD), f'{ob.name}: bake left rotation'
print(f'{TAG} AFTER-bake: all {len(CYL)} baked centres hold, TRS identity')

# ---- roll y-up -> z-up as a MESH-DATA transform (no TRS/matrix_world hazard) ----
_ROLL = mathutils.Matrix.Rotation(math.pi / 2, 4, 'X')
for _ob in [o for o in bpy.data.objects if o.type == 'MESH']:
    _ob.data.transform(_ROLL)
    _ob.data.update()
bpy.context.view_layer.update()

# ---- AFTER-roll gates: evaluated centres must equal CPU roll_x90 ----
for n, l, r, d, nn, rot in CYL:
    ob = bpy.data.objects[n]
    exp = mathutils.Vector(E.roll_x90_pt(l))
    cb = eval_centre(ob)
    assert (cb - exp).length <= 2e-4, f'{ob.name}: AFTER-roll centre {tuple(cb)} != {tuple(exp)}'
print(f'{TAG} AFTER-roll: all {len(CYL)} rolled centres hold')


def world_bounds():
    mn = mathutils.Vector((1e9, 1e9, 1e9))
    mx = mathutils.Vector((-1e9, -1e9, -1e9))
    for _ob in [o for o in bpy.data.objects if o.type == 'MESH']:
        for _c in _ob.bound_box:
            _w = _ob.matrix_world @ mathutils.Vector(_c)
            mn.x = min(mn.x, _w.x)
            mn.y = min(mn.y, _w.y)
            mn.z = min(mn.z, _w.z)
            mx.x = max(mx.x, _w.x)
            mx.y = max(mx.y, _w.y)
            mx.z = max(mx.z, _w.z)
    return mn, mx


_mn, _mx = world_bounds()
print(f'{TAG} bounds pre-join x=[{_mn.x:.3f},{_mx.x:.3f}] y=[{_mn.y:.3f},{_mx.y:.3f}] z=[{_mn.z:.3f},{_mx.z:.3f}]')
assert _mx.x - _mn.x <= 5.04 + 0.02, f'length breach: {_mx.x - _mn.x}'
assert _mn.y >= -1.02 - 0.03 and _mx.y <= 1.02 + 0.03, f'width breach: [{_mn.y},{_mx.y}]'
assert _mn.z >= -0.03 and _mx.z <= E.Y_MAX + 0.02, f'height breach: [{_mn.z},{_mx.z}]'

# ---- consolidate by owned material AFTER validation: 6 draws, not ~150 ----
bpy.ops.object.mode_set(mode='OBJECT')
groups = {}
for _ob in [o for o in bpy.data.objects if o.type == 'MESH']:
    assert len(_ob.data.materials) == 1, f'{_ob.name}: expected 1 material slot'
    groups.setdefault(_ob.data.materials[0].name, []).append(_ob)
assert sorted(groups) == sorted(E.MATERIALS), f'{TAG}: material set {sorted(groups)}'
for mat_name in sorted(groups):
    members = sorted(groups[mat_name], key=lambda o: o.name)
    bpy.ops.object.select_all(action='DESELECT')
    for m in members:
        m.select_set(True)
    bpy.context.view_layer.objects.active = members[0]
    bpy.ops.object.join()
    bpy.context.view_layer.objects.active.data.name = f'SedanJoined_{mat_name}'
    bpy.context.view_layer.objects.active.name = f'SedanJoined_{mat_name}'
bpy.context.view_layer.update()
for me in list(bpy.data.meshes):
    if me.users == 0:
        bpy.data.meshes.remove(me)
joined = [o for o in bpy.data.objects if o.type == 'MESH']
assert len(joined) == 6, f'{TAG}: draws {len(joined)} != 6'
for _ob in joined:
    assert len(_ob.data.materials) == 1, f'{_ob.name}: join left extra slots'
print(f'{TAG} joined: {[o.name for o in sorted(joined, key=lambda o: o.name)]}')

_mn, _mx = world_bounds()
print(f'{TAG} bounds x=[{_mn.x:.3f},{_mx.x:.3f}] y=[{_mn.y:.3f},{_mx.y:.3f}] z=[{_mn.z:.3f},{_mx.z:.3f}]')
assert _mx.x - _mn.x <= 5.04 + 0.02, f'length breach: {_mx.x - _mn.x}'
assert _mn.y >= -1.02 - 0.03 and _mx.y <= 1.02 + 0.03, f'width breach: [{_mn.y},{_mx.y}]'
assert _mn.z >= -0.03 and _mx.z <= E.Y_MAX + 0.02, f'height breach: [{_mn.z},{_mx.z}]'
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in joined)
prims = sum(len(o.data.polygons) for o in joined)
print(f'{TAG} draws={len(joined)} primitives={prims} tris={tris} materials={len(bpy.data.materials)} embedded=0x1024')
assert tris <= 14000, f'tri budget blown: {tris}'
assert len(bpy.data.materials) <= 6, f'material budget blown: {len(bpy.data.materials)}'
assert len(joined) <= 6, f'draw budget blown: {len(joined)}'
OUT_GLB.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(OUT_GLB), export_format='GLB',
                           export_apply=True, export_yup=True,
                           export_materials='EXPORT')
wall = time.perf_counter() - T0
size_b = OUT_GLB.stat().st_size
print(f'{TAG} time_s={wall:.1f} draws={len(joined)} primitives={prims} tris={tris} glb_bytes={size_b} path={OUT_GLB}')
