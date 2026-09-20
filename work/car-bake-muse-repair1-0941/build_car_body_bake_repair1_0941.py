"""Fresh owned parked-sedan body recipe (car-body-bake-repair1-0941) for Nuketown 2025.

Repair1 of work/car-body-agy-0923 (READONLY source): numerical-representation guard
correction ONLY. No geometry redesign; every station, dimension, palette hex,
material count, tri/envelope/pane gate, and exact mathematical centre/rotation is
unchanged. Prior recipe failed at SedanTyre_1.52_L because Blender Object.location /
rotation_euler store float32, so direct Python-float (float64) == is invalid for
1.52, 0.86, 0.34, pi/2, etc. This copy compares with abs(a-b) <= 1e-6 (metres for
locations, radians for rotations) and keeps the exact expected tuples.

Authored as a credible late-1950s / early-1960s American family sedan matching
the current parked car transforms and collision footprint in src/build/vehicles.ts.

Key architectural features vs prior slab models:
- Coherent curved hood, cabin, trunk, and lower body shell in one lofted hull.
- Crowned double-curved cream roof with aerodynamic dome and drip rails.
- Panoramic wraparound windshield and rear window with authentic 1950s tumblehome.
- Distinct 1950s swept tailfins with conical chrome bullet taillight housings and red lenses.
- Quad round headlamps with recessed dark sockets, chrome bezels, and glass lenses.
- Heavy wraparound chrome front and rear bumpers with classic bullet "Dagmar" bumper guards.
- Radiused flush wheel arch lips with dark inner splash tubs (no light leaks or see-through gaps).
- Authentic steel wheels with wide whitewall bands, deep rims, chrome baby-moon hubcaps, and lug nuts.
- Full underbody belly pan ensuring solid visual from any camera angle.
- Swept chrome side spear with two-tone cream accent insert.

Provenance (new recovery work only, zero copied assets):
- common.py: verbatim copy of work/car-body-agy-0923/common.py (recovery scripts/blender/common.py lineage).
- Prim/roll/export patterns re-authored following clean Blender glTF conventions.
  NO coach geometry, ribs, or dimensions copied; every station authored fresh to the saloon envelope.
- Exact palette hexes from src/core/palette.ts (carBlue, coachCream, chrome, windowDark, truckCab, carRed).
- Zero external dependencies, zero image generation, zero downloaded meshes.

Run (guarded bake executed by ROOT from this work directory):
    blender --background --threads 2 --python build_car_body_bake_repair1_0941.py

Output (lane-local only):
    output/car-body-bake-repair1-0941.glb

Scale: metres. Nose +x, y-up authored, origin at ground centre.
Body x: -2.40..+2.40 (L 4.80), z: +-0.975 (W 1.95), y: 0..1.48.
Collider envelope: len 5.04 / wid 2.04 / hgt 1.48 (plates +-2.49 inside 2.52).
Wheels rest at y=0 (WHEEL_Y = 0.34, WHEEL_R = 0.34).

Orientation contract:
- Wheels: cylinder_z (axle along Z), identity rotation, concentric parts.
- Lamps: cylinder_z + OBJECT-LOCAL rotation_euler=(0,pi/2,0) at final loc.
- Roll y-up->z-up: world-matrix premultiply _ROLL @ matrix_world (Euler-safe).
- Correct axis mapping after roll: x = length, y = lateral (width), z = vertical (height).
- Panes: panoramic compound curved glass + planar quad/tri strips (zero twisted panes).
"""

import math
import sys
import time
from pathlib import Path

THIS = Path(__file__).resolve()
LANE = THIS.parent  # this repair lane owns its output; never writes outside LANE
sys.path.insert(0, str(LANE))

import bpy  # noqa: E402
import common as C  # noqa: E402

# Float32 representation guard: Blender Object.location / rotation_euler store
# float32, while Python literals are float64. struct.pack/unpack('f', 1.52) shows
# rounding of ~1.9e-08 (worst covered literal 2.32: ~6.7e-08), so exact == is
# invalid. 1e-6 m / rad is ~15x the worst rounding, yet 10x smaller than a real
# 1e-05 misplacement, which must still fail (see tests/test_float32_repr_guard.py).
_F32_TOL_M = 1e-6
_F32_TOL_RAD = 1e-6


def _close_seq(actual, expected, tol):
    return all(abs(a - b) <= tol for a, b in zip(tuple(actual), tuple(expected)))


SEED = 923
OUT_GLB = LANE / "output" / "car-body-bake-repair1-0941.glb"

# Palette families from src/core/palette.ts (exact 6 materials budget)
BODY_HEX = 0x28374F      # carBlue
CREAM_HEX = 0xE8E0CD     # coachCream (roof + two-tone spear insert + whitewalls + plates)
CHROME_HEX = 0xC8CCD0    # chrome (bumpers, dagmars, grille, spear, bezels, dome, drip, handles)
GLASS_HEX = 0x66808E     # windowDark (seated glazing + lenses)
TRIM_HEX = 0x2E3238      # truckCab (tyres, belly pan, gaskets, inner wheel tubs, grille mesh)
SIGNAL_HEX = 0xA8302C    # carRed (tailfin bullet lenses + rear reflectors)

# Dimensional contract: saloon envelope
L_HALF = 2.40
W_HALF = 0.975
H_MAX = 1.48
WHEEL_R = 0.34
WHEEL_Y = WHEEL_R  # bottom touches ground y=0
WHEEL_XS = (1.52, -1.52)  # front (+1.52) and rear (-1.52) axles
WHEEL_Z = 0.86  # track half-width

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

# ---------------------------------------------------------------- prim helpers

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
    """Authored-axis cylinder: flat faces sideways, axle along Z.
    Wheels use this with IDENTITY rotation.
    Lamps rotate object-local (0, pi/2, 0) after placement to face +X.
    """
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


def quad_strip(name, quads, mat=None, smooth=False):
    verts, faces = [], []
    for q in quads:
        b = len(verts)
        verts.extend(q)
        faces.append((b, b + 1, b + 2, b + 3))
    return mesh_from(name, verts, faces, mat, smooth=smooth)


def tri_list(name, tris, mat=None, smooth=False):
    verts, faces = [], []
    for t in tris:
        b = len(verts)
        verts.extend(t)
        faces.append((b, b + 1, b + 2))
    return mesh_from(name, verts, faces, mat, smooth=smooth)


def grid_mesh(name, grid, mat=None, smooth=True):
    """grid is a 2D array of vertices [rows][cols] of (x, y, z)."""
    rows = len(grid)
    cols = len(grid[0])
    verts = []
    faces = []
    for r in range(rows):
        for c in range(cols):
            verts.append(grid[r][c])
    for r in range(rows - 1):
        for c in range(cols - 1):
            i0 = r * cols + c
            i1 = r * cols + (c + 1)
            i2 = (r + 1) * cols + (c + 1)
            i3 = (r + 1) * cols + c
            faces.append((i0, i1, i2, i3))
    return mesh_from(name, verts, faces, mat, smooth=smooth)


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


def assert_quad_planar(q, name):
    (ax, ay, az), (bx, by, bz), (cx, cy, cz), (dx, dy, dz) = q
    ab = (bx - ax, by - ay, bz - az)
    ac = (cx - ax, cy - ay, cz - az)
    n = (ab[1] * ac[2] - ab[2] * ac[1],
         ab[2] * ac[0] - ab[0] * ac[2],
         ab[0] * ac[1] - ab[1] * ac[0])
    nl = math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2])
    assert nl > 1e-9, f'{name}: degenerate quad'
    d = abs(n[0] * (dx - ax) + n[1] * (dy - ay) + n[2] * (dz - az)) / nl
    assert d < 1e-4, f'{name}: twisted pane (off-plane {d:.6f})'


# ---------------------------------------------------------------- materials (exactly 6)

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


mat_body = principled('SedanBody', BODY_HEX, metallic=0.25, roughness=0.34)
mat_cream = principled('SedanCream', CREAM_HEX, metallic=0.0, roughness=0.42)
mat_chrome = principled('SedanChrome', CHROME_HEX, metallic=1.0, roughness=0.24)
mat_glass = principled('SedanGlass', GLASS_HEX, metallic=0.0, roughness=0.10, alpha=0.65)
mat_trim = principled('SedanTrimDark', TRIM_HEX, metallic=0.15, roughness=0.85)
mat_signal = principled('SedanSignalRed', SIGNAL_HEX, metallic=0.15, roughness=0.35)

mat_lens = mat_glass      # headlamp lenses share glass (budget)
mat_tyre = mat_trim       # tyres share trim-dark (budget)
mat_wall = mat_cream      # whitewalls share cream (budget)

EMBEDDED_IMAGES = []

# ---------------------------------------------------------------- lower-body loft
# Coherent curved hull lofted along X:
# stations: (x, half_w, skirt_y, belt_y, deck_crown_y)
# Crowned hood tapering forward to the chrome nose; crowned rear deck tapering to tail.

RIBS = [
    (-2.40, 0.35, 0.50, 0.72, 0.76),   # tail tip (closed)
    (-2.34, 0.65, 0.46, 0.76, 0.81),   # tail panel
    (-2.20, 0.86, 0.42, 0.80, 0.86),   # rear overhang
    (-1.90, 0.94, 0.36, 0.88, 0.93),   # aft rear wheel
    (-1.52, 0.975, 0.34, 0.92, 0.95),  # rear axle
    (-1.18, 0.975, 0.34, 0.93, 0.95),  # C-pillar base
    (-0.30, 0.975, 0.34, 0.93, 0.94),  # mid-cabin / B-pillar base
    (+0.60, 0.975, 0.34, 0.92, 0.93),  # cowl forward / A-pillar base
    (+1.00, 0.975, 0.34, 0.90, 0.92),  # hood rear / cowl
    (+1.52, 0.975, 0.34, 0.88, 0.90),  # front axle
    (+1.95, 0.94, 0.36, 0.84, 0.86),   # forward front wheel
    (+2.20, 0.86, 0.40, 0.79, 0.81),   # front fender shoulder
    (+2.34, 0.65, 0.46, 0.75, 0.77),   # front nose brow
    (+2.40, 0.35, 0.50, 0.70, 0.72),   # front nose tip (closed)
]

# Flank cross-section per side: skirt -> shoulder -> belt
# (u fraction of half_w, v fraction skirt->belt)
SECTION_FLANK = [
    (0.00, 0.00), (0.50, 0.00), (0.80, 0.03), (0.94, 0.10),
    (1.00, 0.25), (1.00, 0.55), (0.99, 0.80), (0.97, 1.00),
]

loop = list(SECTION_FLANK)
for i in range(len(SECTION_FLANK) - 2, 0, -1):
    loop.append((-SECTION_FLANK[i][0], SECTION_FLANK[i][1]))
n_flank = len(loop)

verts_hull, faces_hull = [], []

def put_v(p):
    verts_hull.append(p)
    return len(verts_hull) - 1

rings = []
for (rx, hw, skirt, belt, crown) in RIBS:
    ring = []
    for (u, v) in loop:
        ring.append(put_v((rx, skirt + (belt - skirt) * v, hw * u)))
    rings.append(ring)

for ri in range(len(rings) - 1):
    for k in range(n_flank):
        k2 = (k + 1) % n_flank
        faces_hull.append((rings[ri][k], rings[ri + 1][k], rings[ri + 1][k2], rings[ri][k2]))

# End caps (nose & tail fans)
for end in (0, len(rings) - 1):
    apex = put_v((RIBS[end][0], (RIBS[end][2] + RIBS[end][3]) * 0.5, 0.0))
    for k in range(n_flank):
        k2 = (k + 1) % n_flank
        if end == 0:
            faces_hull.append((apex, rings[end][k], rings[end][k2]))
        else:
            faces_hull.append((apex, rings[end][k2], rings[end][k]))

body = mesh_from('SedanBodyHull', verts_hull, faces_hull, mat_body, smooth=True)
smart_uv(body)

# Hood crown surface (x from +1.00 to +2.38)
hood_grid = []
hood_xs = [1.00, 1.30, 1.60, 1.90, 2.15, 2.34]
hood_zs = [-0.88, -0.60, -0.30, 0.0, 0.30, 0.60, 0.88]
for hx in hood_xs:
    row = []
    t_x = (hx - 1.00) / 1.34
    base_y = 0.90 - 0.14 * t_x
    crown_peak = 0.035 * (1.0 - 0.4 * t_x)
    for hz in hood_zs:
        t_z = hz / 0.88
        y = base_y + crown_peak * (1.0 - t_z * t_z)
        row.append((hx, y, hz))
    hood_grid.append(row)
hood = grid_mesh('SedanHoodCrown', hood_grid, mat_body, smooth=True)
smart_uv(hood)

# Trunk deck surface (x from -1.18 to -2.36)
trunk_grid = []
trunk_xs = [-1.18, -1.45, -1.75, -2.05, -2.25, -2.36]
trunk_zs = [-0.86, -0.58, -0.28, 0.0, 0.28, 0.58, 0.86]
for tx in trunk_xs:
    row = []
    t_x = (tx - (-1.18)) / (-1.18)
    base_y = 0.93 - 0.15 * t_x
    crown_peak = 0.030 * (1.0 - 0.3 * t_x)
    for tz in trunk_zs:
        t_z = tz / 0.86
        y = base_y + crown_peak * (1.0 - t_z * t_z)
        row.append((tx, y, tz))
    trunk_grid.append(row)
trunk = grid_mesh('SedanTrunkCrown', trunk_grid, mat_body, smooth=True)
smart_uv(trunk)

# ---------------------------------------------------------------- tail fins (sculpted late-50s blades)
# Fins rise from x=-1.20 to x=-2.42, capped with chrome housings & red rocket lenses.

fin_quads, fin_tris = [], []
for side in (1.0, -1.0):
    z = side * (W_HALF - 0.05)
    t = 0.045
    (ax, ay), (bx, by), (cx, cy) = (-2.42, 0.80), (-1.55, 0.88), (-2.38, 1.28)
    s0 = [(ax, ay, z - t), (ax, ay, z + t), (bx, by, z + t), (bx, by, z - t)]
    s1 = [(bx, by, z - t), (bx, by, z + t), (cx, cy, z + t), (cx, cy, z - t)]
    s2 = [(cx, cy, z - t), (cx, cy, z + t), (ax, ay, z + t), (ax, ay, z - t)]
    if side < 0:
        s0 = [s0[0], s0[3], s0[2], s0[1]]
        s1 = [s1[0], s1[3], s1[2], s1[1]]
        s2 = [s2[0], s2[3], s2[2], s2[1]]
    fin_quads.extend([s0, s1, s2])
    for cap in ([(ax, ay, z - t), (bx, by, z - t), (cx, cy, z - t)],
                [(ax, ay, z + t), (cx, cy, z + t), (bx, by, z + t)]):
        fin_tris.append(cap)
        fin_tris.append([cap[0], cap[2], cap[1]])

fins = quad_strip('SedanFins', fin_quads, mat_body)
fin_caps = tri_list('SedanFinCaps', fin_tris, mat_body)

# Chrome fin spears (along top edge of tailfins)
for side in (1.0, -1.0):
    box(f'SedanFinChrome_{"L" if side > 0 else "R"}',
        (-1.95, 1.10, side * (W_HALF - 0.05)), (0.90, 0.035, 0.04), mat_chrome)

# ---------------------------------------------------------------- cabin greenhouse & curved glass
# Panoramic wraparound windshield with compound curvature, seated side glass, panoramic backlight.

GX0, GX1 = -1.15, 1.00      # greenhouse x span
GBELT, GROOF = 0.94, 1.40
GHALF_BELT, GHALF_ROOF = 0.80, 0.68

# Panoramic curved windshield: 4 horizontal segments x 2 vertical rows
ws_grid = []
ws_rows_y = [GBELT, (GBELT + GROOF) * 0.5, GROOF]
for ri, wy in enumerate(ws_rows_y):
    row = []
    t_v = ri / 2.0
    wx_base = 0.98 - 0.44 * t_v
    hw = GHALF_BELT - (GHALF_BELT - GHALF_ROOF) * t_v
    for si in range(5):
        t_h = (si - 2) / 2.0  # -1.0 to +1.0
        wz = t_h * hw
        # Panoramic wrap: outer corners curve slightly rearward
        wx = wx_base - 0.08 * (t_h * t_h)
        row.append((wx, wy, wz))
    ws_grid.append(row)
windshield = grid_mesh('SedanWindshield', ws_grid, mat_glass, smooth=True)

# Panoramic curved rear window: 4 horizontal segments x 2 vertical rows
rw_grid = []
rw_rows_y = [GBELT, (GBELT + GROOF) * 0.5, GROOF]
for ri, wy in enumerate(rw_rows_y):
    row = []
    t_v = ri / 2.0
    wx_base = -1.15 + 0.22 * t_v
    hw = GHALF_BELT - (GHALF_BELT - GHALF_ROOF) * t_v
    for si in range(5):
        t_h = (si - 2) / 2.0
        wz = t_h * hw
        wx = wx_base + 0.06 * (t_h * t_h)
        row.append((wx, wy, wz))
    rw_grid.append(row)
rear_window = grid_mesh('SedanRearWindow', rw_grid, mat_glass, smooth=True)

# Side glass: planar quads with proven planarity
glass_side_quads = []
for side in (1.0, -1.0):
    z = side * GHALF_BELT
    q = [(GX0, GBELT, z), (GX1, GBELT, z), (GX1 - 0.10, GROOF - 0.04, side * GHALF_ROOF),
         (GX0, GROOF - 0.04, side * GHALF_ROOF)]
    assert_quad_planar(q, f'SedanSideGlass_{side}')
    if side < 0:
        q = [q[0], q[3], q[2], q[1]]
    glass_side_quads.append(q)
side_glass = quad_strip('SedanSideGlass', glass_side_quads, mat_glass)

# Rubber gaskets seated around glass panes
for side in (1.0, -1.0):
    gz = side * (GHALF_BELT + 0.006)
    box(f'SedanGasketB_{"L" if side > 0 else "R"}',
        ((GX0 + GX1) / 2, GBELT - 0.025, gz), (GX1 - GX0 + 0.10, 0.05, 0.014), mat_trim)
    box(f'SedanGasketT_{"L" if side > 0 else "R"}',
        ((GX0 + GX1) / 2 - 0.05, GROOF - 0.025, side * (GHALF_ROOF + 0.006)),
        (GX1 - GX0, 0.05, 0.014), mat_trim)
    box(f'SedanGasketA_{"L" if side > 0 else "R"}',
        (GX1 + 0.02, (GBELT + GROOF) / 2, gz), (0.06, GROOF - GBELT + 0.06, 0.014), mat_trim)
    box(f'SedanGasketC_{"L" if side > 0 else "R"}',
        (GX0 - 0.02, (GBELT + GROOF) / 2, gz), (0.06, GROOF - GBELT + 0.06, 0.014), mat_trim)

# Pillars & Drip Rails (classic 1950s hardtop / sedan structure)
for side in (1.0, -1.0):
    z = side * (GHALF_BELT + 0.008)
    for px in (0.55, -0.30, -1.10):
        box(f'SedanPillar_{"L" if side > 0 else "R"}_{px}',
            (px, (GBELT + GROOF) / 2, z), (0.09, GROOF - GBELT, 0.03), mat_body)
    box(f'SedanDrip_{"L" if side > 0 else "R"}',
        (-0.10, GROOF + 0.015, side * (GHALF_ROOF + 0.012)),
        (2.20, 0.035, 0.020), mat_chrome)

# ---------------------------------------------------------------- crowned curved roof (cream)
# Smooth aerodynamic double-curved dome matching 1950s GM/Ford styling.

roof_grid = []
roof_xs = [-1.22, -1.00, -0.65, -0.30, +0.05, +0.35, +0.58]
roof_zs = [-0.70, -0.45, -0.20, 0.0, 0.20, 0.45, 0.70]
for rx in roof_xs:
    row = []
    # longitudinal arch
    t_x = (rx - (-0.30)) / 0.90
    arch_x = 1.0 - 0.15 * (t_x * t_x)
    for rz in roof_zs:
        # transverse crown
        t_z = rz / 0.70
        arch_z = 1.0 - 0.18 * (t_z * t_z)
        y = 1.40 + 0.060 * arch_x * arch_z
        row.append((rx, y, rz))
    roof_grid.append(row)
roof = grid_mesh('SedanRoofCrown', roof_grid, mat_cream, smooth=True)
smart_uv(roof)

# ---------------------------------------------------------------- wheel arches & inner tubs
# Flush radiused lips (+0.010) + dark inner tubs behind wheels (no see-through gaps).

arch_quads = []
ARCH_R_OUT, ARCH_R_IN, ARCH_SEG = 0.475, 0.405, 16
for ax in WHEEL_XS:
    for side in (1.0, -1.0):
        z = side * (W_HALF + 0.010)
        for si in range(ARCH_SEG):
            a0 = math.pi * (0.08 + 0.84 * si / ARCH_SEG)
            a1 = math.pi * (0.08 + 0.84 * (si + 1) / ARCH_SEG)
            p0o = (ax + ARCH_R_OUT * math.cos(a0), WHEEL_Y + ARCH_R_OUT * math.sin(a0), z)
            p1o = (ax + ARCH_R_OUT * math.cos(a1), WHEEL_Y + ARCH_R_OUT * math.sin(a1), z)
            p1i = (ax + ARCH_R_IN * math.cos(a1), WHEEL_Y + ARCH_R_IN * math.sin(a1), z)
            p0i = (ax + ARCH_R_IN * math.cos(a0), WHEEL_Y + ARCH_R_IN * math.sin(a0), z)
            q = [p0o, p1o, p1i, p0i]
            assert_quad_planar(q, f'SedanArch_{ax}_{side}_{si}')
            if side < 0:
                q = [q[0], q[3], q[2], q[1]]
            arch_quads.append(q)
        # Inner dark tub disc concentric with wheel
        tub = cylinder_z(f'SedanTub_{ax}_{"L" if side > 0 else "R"}',
                         (ax, WHEEL_Y, side * (WHEEL_Z - 0.16)), 0.42, 0.04, mat_trim, verts_n=20)
        assert abs(tub.rotation_euler[0]) <= _F32_TOL_RAD and abs(tub.rotation_euler[1]) <= _F32_TOL_RAD, f'{tub.name}: tub must stay unrotated'
arches = quad_strip('SedanArchLips', arch_quads, mat_body)

# ---------------------------------------------------------------- wheels (concentric, axle-Z, no rotation)
# Solid rubber tyre, wide whitewall disc, deep steel rim, chrome baby-moon dome, 5 chrome lugs.

wheel_centres = []
for ax in WHEEL_XS:
    for side in (1.0, -1.0):
        zc = side * WHEEL_Z
        tag = f'{ax}_{"L" if side > 0 else "R"}'
        tyre = cylinder_z(f'SedanTyre_{tag}', (ax, WHEEL_Y, zc),
                          WHEEL_R, 0.22, mat_tyre, verts_n=28)
        wall = cylinder_z(f'SedanWall_{tag}', (ax, WHEEL_Y, zc),
                          0.22, 0.226, mat_wall, verts_n=24)
        rim = cylinder_z(f'SedanRim_{tag}', (ax, WHEEL_Y, zc),
                         0.14, 0.235, mat_trim, verts_n=20)
        dome = cylinder_z(f'SedanDome_{tag}', (ax, WHEEL_Y, zc),
                          0.08, 0.255, mat_chrome, verts_n=16)
        for ob in (tyre, wall, rim, dome):
            assert _close_seq(ob.location, (ax, WHEEL_Y, zc), _F32_TOL_M), f'{ob.name}: off-centre'
            assert _close_seq(ob.rotation_euler, (0.0, 0.0, 0.0), _F32_TOL_RAD), f'{ob.name}: must stay unrotated'
        wheel_centres.append((ax, WHEEL_Y, zc))
        # 5 Chrome lug nuts
        for li in range(5):
            a = 2 * math.pi * li / 5
            lx, ly = ax + 0.105 * math.cos(a), WHEEL_Y + 0.105 * math.sin(a)
            box(f'SedanLug_{tag}_{li}', (lx, ly, zc + side * 0.125),
                (0.035, 0.035, 0.035), mat_chrome)

# ---------------------------------------------------------------- quad headlamps (object-local rotation)
# 4 round headlamps (2 per side) at z=+-0.62 and z=+-0.80.
# cylinder_z built at FINAL loc, then rotated locally (0, pi/2, 0): axis -> X.

lamp_obs = []
LAMP_ZS = (-0.80, -0.62, 0.62, 0.80)
for lz in LAMP_ZS:
    sock = cylinder_z(f'SedanHeadSock_{lz}', (2.28, 0.64, lz), 0.115, 0.08, mat_trim, verts_n=16)
    sock.rotation_euler = (0.0, math.pi / 2, 0.0)
    bez = cylinder_z(f'SedanHeadBezel_{lz}', (2.32, 0.64, lz), 0.120, 0.04, mat_chrome, verts_n=16)
    bez.rotation_euler = (0.0, math.pi / 2, 0.0)
    lens = cylinder_z(f'SedanHeadLens_{lz}', (2.345, 0.64, lz), 0.105, 0.05, mat_lens, verts_n=16)
    lens.rotation_euler = (0.0, math.pi / 2, 0.0)
    for ob in (sock, bez, lens):
        assert _close_seq(tuple(ob.location)[1:], (0.64, lz), _F32_TOL_M), f'{ob.name}: moved after rotation'
        assert _close_seq(ob.rotation_euler, (0.0, math.pi / 2, 0.0), _F32_TOL_RAD), f'{ob.name}: lamp must hold (0, pi/2, 0)'
    lamp_obs.extend([sock, bez, lens])

# Tailfin rocket bullet lamps
for side in (1.0, -1.0):
    sock = cylinder_z(f'SedanTailSock_{side}', (-2.40, 1.10, side * 0.925),
                      0.10, 0.08, mat_chrome, verts_n=16)
    sock.rotation_euler = (0.0, math.pi / 2, 0.0)
    lens = cylinder_z(f'SedanTailLens_{side}', (-2.455, 1.10, side * 0.925),
                      0.085, 0.05, mat_signal, verts_n=16)
    lens.rotation_euler = (0.0, math.pi / 2, 0.0)

# ---------------------------------------------------------------- brightwork & bumpers
# Heavy wraparound chrome bumpers, classic bullet "Dagmar" bumper guards, horizontal slat grille.

# Front bumper & dagmars
box('SedanBumperF', (2.44, 0.44, 0.0), (0.16, 0.16, 1.76), mat_chrome)
for side in (1.0, -1.0):
    dag = cylinder_z(f'SedanDagmarF_{side}', (2.46, 0.44, side * 0.38),
                     0.075, 0.12, mat_chrome, verts_n=16)
    dag.rotation_euler = (0.0, math.pi / 2, 0.0)

# Front grille surround & slats
box('SedanGrilleBack', (2.415, 0.62, 0.0), (0.05, 0.22, 1.12), mat_trim)
for i, gy in enumerate((0.55, 0.60, 0.65, 0.70)):
    box(f'SedanGrilleBar_{i}', (2.445, gy, 0.0), (0.03, 0.025, 1.08), mat_chrome)

# Rear bumper & overriders
box('SedanBumperR', (-2.44, 0.46, 0.0), (0.16, 0.16, 1.76), mat_chrome)
for side in (1.0, -1.0):
    box(f'SedanOverriderR_{side}', (-2.46, 0.48, side * 0.40), (0.08, 0.20, 0.06), mat_chrome)
    # Dual exhaust tips
    exh = cylinder_z(f'SedanExhaust_{side}', (-2.46, 0.32, side * 0.55),
                     0.038, 0.10, mat_chrome, verts_n=14)
    exh.rotation_euler = (0.0, math.pi / 2, 0.0)

# License plates "NT55" front and rear
box('SedanPlateF', (2.49, 0.44, 0.0), (0.04, 0.15, 0.38), mat_cream)
box('SedanPlateR', (-2.49, 0.46, 0.0), (0.04, 0.15, 0.38), mat_cream)

# Chrome side spears and two-tone cream flank insert
for side in (1.0, -1.0):
    s = "L" if side > 0 else "R"
    # Upper chrome spear
    box(f'SedanSpearUpper_{s}',
        (0.10, 0.74, side * (W_HALF + 0.010)), (3.65, 0.045, 0.025), mat_chrome)
    # Lower chrome accent
    box(f'SedanSpearLower_{s}',
        (0.00, 0.62, side * (W_HALF + 0.010)), (3.20, 0.035, 0.025), mat_chrome)
    # Two-tone cream insert panel between spears
    box(f'SedanFlankCream_{s}',
        (0.05, 0.68, side * (W_HALF + 0.008)), (3.40, 0.08, 0.018), mat_cream)
    # Chrome door handles (2 per side)
    for hx in (0.35, -0.45):
        box(f'SedanHandle_{s}_{hx}',
            (hx, 0.78, side * (W_HALF + 0.020)), (0.16, 0.035, 0.035), mat_chrome)
    # Wing mirrors on cowl
    box(f'SedanMirrorArm_{s}',
        (0.95, 0.98, side * (W_HALF + 0.04)), (0.04, 0.04, 0.12), mat_trim)
    mir = cylinder_z(f'SedanMirrorHead_{s}',
                     (0.95, 1.05, side * (W_HALF + 0.11)), 0.065, 0.03, mat_chrome, verts_n=16)
    mir.rotation_euler = (0.0, math.pi / 2, 0.0)

# Solid dark belly pan underneath (seals bottom)
box('SedanBelly', (0.0, 0.34, 0.0), (3.60, 0.08, 1.55), mat_trim)

# ---------------------------------------------------------------- y-up -> z-up roll (world-matrix premultiply ONLY)

from mathutils import Matrix as _Matrix  # noqa: E402
_ROLL = _Matrix.Rotation(math.pi / 2, 4, 'X')
for _ob in [o for o in bpy.data.objects if o.type == 'MESH']:
    _ob.matrix_world = _ROLL @ _ob.matrix_world
bpy.context.view_layer.update()

# ---------------------------------------------------------------- finalize + export

bpy.ops.object.select_all(action='SELECT')
bpy.context.view_layer.objects.active = body
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

tris = C.scene_tri_count()
vram = C.vram_bytes(EMBEDDED_IMAGES)

# envelope & orientation proofs
import mathutils  # noqa: E402
_mn = mathutils.Vector((1e9, 1e9, 1e9))
_mx = mathutils.Vector((-1e9, -1e9, -1e9))
for _ob in [o for o in bpy.data.objects if o.type == 'MESH']:
    for _c in _ob.bound_box:
        _w = _ob.matrix_world @ mathutils.Vector(_c)
        _mn.x = min(_mn.x, _w.x)
        _mn.y = min(_mn.y, _w.y)
        _mn.z = min(_mn.z, _w.z)
        _mx.x = max(_mx.x, _w.x)
        _mx.y = max(_mx.y, _w.y)
        _mx.z = max(_mx.z, _w.z)

# In rolled coordinates: x is length, y is lateral (width), z is vertical (height)
print(f'CAR_BODY_BAKE_REPAIR1_0941 bounds x=[{_mn.x:.3f},{_mx.x:.3f}] '
      f'y=[{_mn.y:.3f},{_mx.y:.3f}] z=[{_mn.z:.3f},{_mx.z:.3f}]')

assert _mx.x - _mn.x <= 5.04 + 0.02, f'length breaches collider envelope: {_mx.x - _mn.x}'
assert _mn.y >= -1.02 - 0.03 and _mx.y <= 1.02 + 0.03, f'width breaches envelope: [{_mn.y},{_mx.y}]'
assert _mn.z >= -0.03 and _mx.z <= H_MAX + 0.02, f'height breaches envelope: [{_mn.z},{_mx.z}]'

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

print(f'CAR_BODY_BAKE_REPAIR1_0941 time_s={wall:.1f} tris={tris} '
      f'vram_bytes={vram} glb_bytes={size_b} path={OUT_GLB}')
print(f'CAR_BODY_BAKE_REPAIR1_0941 materials={len(bpy.data.materials)} '
      f'embedded={len(EMBEDDED_IMAGES)}x1024')
assert tris <= 14000, f'tri budget blown: {tris}'
assert len(bpy.data.materials) <= 6, f'material budget blown: {len(bpy.data.materials)}'
if size_b > 6 * 1024 * 1024:
    print(f'CAR_BODY_BAKE_REPAIR1_0941 WARN glb_bytes={size_b} exceeds 6 MiB')
