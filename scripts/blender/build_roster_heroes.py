# Roster hero guns — Blender-native editable recipe (source-only slice)
#
# Builds THREE visually distinct hero guns, each in a fresh scene:
#   mp5      compact SMG (stamped receiver, short barrel, sliding-stock rails, drum diopter)
#   m14-ebr  scoped marksman rifle (EBR chassis, long barrel, tube scope, full rails)
#   lmg      belt-fed LMG (bulky receiver, feed cover, side ammo box, carry handle, bipod)
#
# Authoring axes (Blender, Z-up), same convention as the carbine lane:
#   +Y = muzzle (forward), +Z = up, +X = weapon right. Origin at grip/trigger.
#   Units: meters. Blender glTF export maps (x,y,z)_blend -> (x,z,-y)_gltf,
#   so each GLB lands in the viewmodel contract: muzzle -Z, up +Y, right +X.
#
# CPU asset building only: explicit from_pydata geometry + procedural pixel
# textures. No Cycles bake, no render, no subdivision, no booleans, no downloads.
#
# Usage (Blender 5.1.2):
#   blender --background --factory-startup --threads 2 --python build_roster_heroes.py -- \
#       --gun mp5 --out C:/path/to/repo/root
#   --gun mp5 | m14-ebr | lmg | all   (default: all)
#   --out defaults to the repository root above scripts/.
#
# Outputs per gun <g>:
#   work/roster-heroes/<g>.blend                  editable scene (kept)
#   work/roster-heroes/<g>_basecolor_1k.png       procedural basecolor (packed + saved)
#   work/roster-heroes/<g>_orm_1k.png             procedural ORM (packed + saved)
#   public/assets/roster-heroes/<g>.glb           runtime artifact (NOT loaded by baseline)
#
# Budgets enforced pre-export per gun:
#   <=14000 tris, <=18 mesh objects (draws), <=3 materials, <=2 embedded 1024 PNG.

from __future__ import annotations
import argparse
import math
import os
import random
import sys

TAU = math.pi * 2

# ----------------------------------------------------------------------------
# Per-gun design tables. Sockets are exact; validator tolerates +/-5 mm.
# anchor_mag doubles as the reload pivot: it sits exactly at the magazine /
# ammo-box feed-top interface, and the mag mesh hangs below it.
# ----------------------------------------------------------------------------
GUNS = {
    "mp5": {
        "label": "compact SMG, MP5-broad-silhouette reference",
        "ref": "docs/reference/production-catalog/weapons/mp5.png",
        "bore_z": 0.030,
        "bounds": {"x": 0.09, "y_min": -0.34, "y_max": 0.38, "z_min": -0.24, "z_max": 0.12},
        "sockets": {
            "anchor_muzzle": (0.0, 0.345, 0.030),
            "anchor_grip": (0.0, -0.020, -0.075),
            "anchor_support": (0.0, 0.150, -0.005),
            "anchor_mag": (0.0, 0.045, -0.045),
        },
        "mats": {
            "metal": ((0.050, 0.051, 0.055, 1.0), 0.85, 0.42),
            "polymer": ((0.035, 0.036, 0.040, 1.0), 0.00, 0.70),
            "accent": ((0.020, 0.020, 0.022, 1.0), 0.00, 0.92),
        },
    },
    "m14-ebr": {
        "label": "scoped marksman rifle, M14-EBR-broad-silhouette reference",
        "ref": "docs/reference/production-catalog/weapons/m14-ebr.png",
        "bore_z": 0.038,
        "bounds": {"x": 0.09, "y_min": -0.42, "y_max": 0.68, "z_min": -0.26, "z_max": 0.16},
        "sockets": {
            "anchor_muzzle": (0.0, 0.630, 0.038),
            "anchor_grip": (0.0, -0.150, -0.075),
            "anchor_support": (0.0, 0.330, 0.005),
            "anchor_mag": (0.0, 0.060, -0.055),
        },
        "mats": {
            "metal": ((0.060, 0.058, 0.055, 1.0), 0.80, 0.45),
            "polymer": ((0.090, 0.090, 0.095, 1.0), 0.10, 0.62),
            "accent": ((0.020, 0.030, 0.040, 1.0), 0.90, 0.15),
        },
    },
    "lmg": {
        "label": "belt-fed LMG, M249-broad-silhouette reference",
        "ref": "docs/reference/production-catalog/weapons/lmg.png",
        "bore_z": 0.040,
        "bounds": {"x": 0.14, "y_min": -0.42, "y_max": 0.62, "z_min": -0.26, "z_max": 0.16},
        "sockets": {
            "anchor_muzzle": (0.0, 0.575, 0.040),
            "anchor_grip": (0.0, -0.170, -0.080),
            "anchor_support": (0.0, 0.300, -0.010),
            "anchor_mag": (-0.060, 0.060, 0.020),
        },
        "mats": {
            "metal": ((0.055, 0.055, 0.058, 1.0), 0.80, 0.50),
            "polymer": ((0.100, 0.100, 0.080, 1.0), 0.00, 0.75),
            "accent": ((0.025, 0.025, 0.027, 1.0), 0.00, 0.90),
        },
    },
}

BUDGET = {"tris": 14000, "draws": 18, "mats": 3, "images": 2, "px": 1024}


# ----------------------------------------------------------------------------
# Explicit mesh helpers (from_pydata authoring; no bmesh unit-cube hazard).
# ----------------------------------------------------------------------------
def _rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return ((1.0, 0.0, 0.0), (0.0, c, -s), (0.0, s, c))


def _rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return ((c, 0.0, s), (0.0, 1.0, 0.0), (-s, 0.0, c))


def _rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return ((c, -s, 0.0), (s, c, 0.0), (0.0, 0.0, 1.0))


def _mm(A, B):
    return tuple(
        tuple(sum(A[i][k] * B[k][j] for k in range(3)) for j in range(3))
        for i in range(3)
    )


def _xform(p, R, t):
    x = R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2] + t[0]
    y = R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2] + t[1]
    z = R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2] + t[2]
    return (round(x, 6), round(y, 6), round(z, 6))


class Mesh:
    def __init__(self, name, mat, smooth=False, bevel=None):
        self.name = name
        self.mat = mat
        self.smooth = smooth
        self.bevel = bevel
        self.verts = []
        self.faces = []

    def tris(self):
        return sum(max(0, len(f) - 2) for f in self.faces)

    def box(self, size, center=(0, 0, 0), rx=0.0, ry=0.0, rz=0.0):
        sx, sy, sz = size[0] * 0.5, size[1] * 0.5, size[2] * 0.5
        R = _mm(_rot_z(rz), _mm(_rot_y(ry), _rot_x(rx)))
        b = len(self.verts)
        for p in ((-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
                  (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)):
            self.verts.append(_xform(p, R, center))
        for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
                  (2, 3, 7, 6), (0, 4, 7, 3), (1, 2, 6, 5)):
            self.faces.append([b + i for i in f])

    def cyl(self, r, depth, seg=14, center=(0, 0, 0), axis="Z", r2=None):
        r2 = r if r2 is None else r2
        half = depth * 0.5
        R = {"Y": _rot_x(math.pi / 2), "X": _rot_y(-math.pi / 2)}.get(
            axis, ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)))
        b = len(self.verts)
        for i in range(seg):
            a = TAU * i / seg
            c, s = math.cos(a), math.sin(a)
            self.verts.append(_xform((r * c, r * s, -half), R, center))
            self.verts.append(_xform((r2 * c, r2 * s, half), R, center))
        for i in range(seg):
            j = (i + 1) % seg
            self.faces.append([b + i * 2, b + j * 2, b + j * 2 + 1, b + i * 2 + 1])
        self.faces.append([b + i * 2 for i in reversed(range(seg))])
        self.faces.append([b + i * 2 + 1 for i in range(seg)])

    def rail(self, y0, y1, width=0.0212, base_z=0.064, top_z=0.0785,
             notch=0.0035, pitch=0.0100, nw=0.0053):
        hw = width * 0.5
        pts = [(y0, base_z), (y0, top_z)]
        n = max(1, int((y1 - y0) // pitch))
        for s in range(n):
            a = y0 + s * pitch + (pitch - nw)
            e = min(y1, y0 + (s + 1) * pitch)
            pts += [(a, top_z), (a, top_z - notch), (e, top_z - notch), (e, top_z)]
        pts += [(y1, top_z), (y1, base_z)]
        npts = len(pts)
        b = len(self.verts)
        for y, z in pts:
            self.verts.append((-hw, round(y, 6), round(z, 6)))
        for y, z in pts:
            self.verts.append((hw, round(y, 6), round(z, 6)))
        for i in range(npts - 1):
            self.faces.append([b + i, b + npts + i, b + npts + i + 1, b + i + 1])
        self.faces.append([b + i for i in reversed(range(npts))])
        self.faces.append([b + npts + i for i in range(npts)])


# ----------------------------------------------------------------------------
# Role-distinct geometry. Deliberately NOT the carbine part list: each gun
# gets the receiver/barrel/stock/magazine/grip/rail/optic its role needs.
# ----------------------------------------------------------------------------
def build_mp5(M, P, A):
    d = {}
    recv = Mesh("mp5_receiver", M, bevel=(0.0015, 1))
    recv.box((0.042, 0.340, 0.052), (0.0, 0.030, 0.030))
    recv.box((0.046, 0.060, 0.056), (0.0, -0.110, 0.030))  # trigger housing block
    recv.box((0.004, 0.055, 0.020), (0.0215, 0.060, 0.032))  # ejection hint, +X
    d["mp5_receiver"] = recv

    bar = Mesh("mp5_barrel_jacket", M, smooth=True)
    bar.cyl(0.011, 0.100, seg=14, center=(0.0, 0.250, 0.030), axis="Y")
    d["mp5_barrel_jacket"] = bar

    muz = Mesh("mp5_muzzle", M, smooth=True)
    muz.cyl(0.014, 0.045, seg=14, center=(0.0, 0.3225, 0.030), axis="Y")
    muz.cyl(0.0155, 0.010, seg=14, center=(0.0, 0.310, 0.030), axis="Y")
    d["mp5_muzzle"] = muz

    fs = Mesh("mp5_front_sight", M)
    fs.box((0.004, 0.004, 0.022), (0.0, 0.285, 0.052))  # post
    fs.box((0.024, 0.006, 0.004), (0.0, 0.285, 0.064))  # hood bar
    fs.box((0.004, 0.006, 0.014), (-0.012, 0.285, 0.057))
    fs.box((0.004, 0.006, 0.014), (0.012, 0.285, 0.057))
    d["mp5_front_sight"] = fs

    rs = Mesh("mp5_rear_drum", M, smooth=True)
    rs.cyl(0.009, 0.020, seg=12, center=(0.0, -0.060, 0.068), axis="X")
    rs.box((0.024, 0.030, 0.006), (0.0, -0.060, 0.058))
    d["mp5_rear_drum"] = rs

    hg = Mesh("mp5_handguard", P, bevel=(0.002, 1))
    hg.box((0.044, 0.110, 0.050), (0.0, 0.150, 0.022))
    for i in range(3):  # grip ribs — edge detail, not subdivision
        hg.box((0.046, 0.008, 0.052), (0.0, 0.115 + i * 0.030, 0.022))
    d["mp5_handguard"] = hg

    gf = Mesh("mp5_grip_frame", P, bevel=(0.002, 1))
    gf.box((0.030, 0.050, 0.110), (0.0, -0.055, -0.045), rx=-0.28)
    gf.box((0.026, 0.020, 0.030), (0.0, -0.030, 0.005))  # tang into housing
    d["mp5_grip_frame"] = gf

    trg = Mesh("mp5_trigger_pack", M)
    trg.box((0.007, 0.006, 0.020), (0.0, -0.045, -0.020))  # rear post
    trg.box((0.007, 0.006, 0.014), (0.0, 0.005, -0.024))  # front post
    trg.box((0.007, 0.056, 0.004), (0.0, -0.020, -0.032))  # bow
    trg.box((0.004, 0.006, 0.020), (0.0, -0.020, -0.018), rx=-0.20)  # trigger
    trg.box((0.010, 0.030, 0.004), (0.0, 0.045, -0.020), rx=0.15)  # paddle
    d["mp5_trigger_pack"] = trg

    mag = Mesh("mp5_magazine", P, bevel=(0.001, 1))
    mag.box((0.026, 0.040, 0.130), (0.0, 0.030, -0.110), rx=0.10)  # straight box mag
    mag.box((0.028, 0.044, 0.012), (0.0, 0.017, -0.172), rx=0.10)  # baseplate
    d["mp5_magazine"] = mag

    rails = Mesh("mp5_stock_rails", M, smooth=True)
    rails.cyl(0.005, 0.130, seg=10, center=(-0.012, -0.205, 0.045), axis="Y")
    rails.cyl(0.005, 0.130, seg=10, center=(0.012, -0.205, 0.045), axis="Y")
    d["mp5_stock_rails"] = rails

    plate = Mesh("mp5_stock_plate", P, bevel=(0.002, 1))
    plate.box((0.040, 0.020, 0.110), (0.0, -0.275, 0.005))  # collapsed endplate
    d["mp5_stock_plate"] = plate

    ch = Mesh("mp5_charging", M, smooth=True)
    ch.cyl(0.005, 0.060, seg=10, center=(-0.026, 0.100, 0.048), axis="Y")
    ch.cyl(0.009, 0.020, seg=10, center=(-0.026, 0.135, 0.048), axis="Y")
    d["mp5_charging"] = ch

    claw = Mesh("mp5_claw_rail", M)
    claw.rail(-0.100, 0.020, width=0.024, base_z=0.060, top_z=0.070)
    d["mp5_claw_rail"] = claw
    return d


def build_ebr(M, P, A):
    d = {}
    ch = Mesh("ebr_chassis", P, bevel=(0.0018, 1))
    ch.box((0.050, 0.440, 0.060), (0.0, -0.040, 0.020))  # chassis spine
    ch.box((0.054, 0.120, 0.040), (0.0, 0.120, 0.030))  # forend block
    d["ebr_chassis"] = ch

    recv = Mesh("ebr_receiver", M, bevel=(0.0015, 1))
    recv.box((0.038, 0.300, 0.046), (0.0, -0.110, 0.045))
    recv.box((0.006, 0.040, 0.014), (-0.021, -0.180, 0.050), rz=0.5)  # bolt handle root
    d["ebr_receiver"] = recv

    bolt = Mesh("ebr_bolt_handle", M, smooth=True)
    bolt.cyl(0.005, 0.045, seg=10, center=(-0.032, -0.175, 0.045), axis="X")
    bolt.cyl(0.009, 0.018, seg=10, center=(-0.056, -0.175, 0.045), axis="X")
    d["ebr_bolt_handle"] = bolt

    bar = Mesh("ebr_barrel", M, smooth=True)
    bar.cyl(0.010, 0.380, seg=16, center=(0.0, 0.370, 0.038), axis="Y")
    d["ebr_barrel"] = bar

    brake = Mesh("ebr_brake", M, smooth=True)
    brake.cyl(0.016, 0.070, seg=14, center=(0.0, 0.595, 0.038), axis="Y")
    brake.cyl(0.0175, 0.012, seg=14, center=(0.0, 0.575, 0.038), axis="Y")
    brake.cyl(0.0175, 0.012, seg=14, center=(0.0, 0.605, 0.038), axis="Y")
    d["ebr_brake"] = brake

    scope = Mesh("ebr_scope", A, smooth=True)
    scope.cyl(0.021, 0.150, seg=16, center=(0.0, -0.060, 0.105), axis="Y")  # tube
    scope.cyl(0.026, 0.045, seg=16, center=(0.0, 0.030, 0.105), axis="Y", r2=0.021)  # bell
    scope.cyl(0.011, 0.018, seg=12, center=(0.0, -0.060, 0.130), axis="Z")  # elevation turret
    scope.cyl(0.011, 0.018, seg=12, center=(0.024, -0.060, 0.105), axis="X")  # windage
    scope.box((0.030, 0.060, 0.014), (0.0, -0.060, 0.082))  # mount
    d["ebr_scope"] = scope

    trailtop = Mesh("ebr_top_rail", M)
    trailtop.rail(-0.240, 0.180, width=0.0212, base_z=0.070, top_z=0.080)
    d["ebr_top_rail"] = trailtop

    sider = Mesh("ebr_side_rails", M)
    sider.box((0.004, 0.140, 0.014), (-0.028, 0.110, 0.030))
    sider.box((0.004, 0.140, 0.014), (0.028, 0.110, 0.030))
    for i in range(4):
        sider.box((0.006, 0.010, 0.016), (-0.028, 0.055 + i * 0.035, 0.030))
        sider.box((0.006, 0.010, 0.016), (0.028, 0.055 + i * 0.035, 0.030))
    d["ebr_side_rails"] = sider

    stock = Mesh("ebr_stock", P, bevel=(0.002, 1))
    stock.box((0.034, 0.140, 0.070), (0.0, -0.330, 0.010))  # fixed precision stock
    stock.box((0.036, 0.080, 0.020), (0.0, -0.330, 0.058))  # cheek riser
    d["ebr_stock"] = stock

    butt = Mesh("ebr_buttpad", A, bevel=(0.002, 1))
    butt.box((0.038, 0.018, 0.085), (0.0, -0.409, 0.005))
    d["ebr_buttpad"] = butt

    grip = Mesh("ebr_grip", P, bevel=(0.002, 1))
    grip.box((0.030, 0.045, 0.115), (0.0, -0.185, -0.045), rx=-0.35)
    grip.box((0.030, 0.050, 0.012), (0.0, -0.200, -0.100), rx=-0.35)
    d["ebr_grip"] = grip

    trg = Mesh("ebr_trigger", M)
    trg.box((0.007, 0.006, 0.020), (0.0, -0.150, -0.015))
    trg.box((0.007, 0.006, 0.014), (0.0, -0.100, -0.019))
    trg.box((0.007, 0.056, 0.004), (0.0, -0.125, -0.027))
    trg.box((0.004, 0.006, 0.020), (0.0, -0.125, -0.013), rx=-0.20)
    d["ebr_trigger"] = trg

    mag = Mesh("ebr_magazine", M, bevel=(0.001, 1))
    mag.box((0.028, 0.070, 0.110), (0.0, 0.055, -0.110))  # short 20-rd box
    mag.box((0.030, 0.074, 0.012), (0.0, 0.055, -0.168))  # baseplate
    d["ebr_magazine"] = mag

    bipod = Mesh("ebr_bipod", M, smooth=True)
    bipod.box((0.050, 0.020, 0.016), (0.0, 0.175, -0.005))  # mount
    bipod.box((0.008, 0.008, 0.150), (-0.020, 0.175, -0.080), rz=0.25)  # folded legs
    bipod.box((0.008, 0.008, 0.150), (0.020, 0.175, -0.080), rz=-0.25)
    d["ebr_bipod"] = bipod
    return d


def build_lmg(M, P, A):
    d = {}
    recv = Mesh("lmg_receiver", M, bevel=(0.002, 1))
    recv.box((0.060, 0.520, 0.090), (0.0, -0.040, 0.020))  # bulky receiver
    d["lmg_receiver"] = recv

    cover = Mesh("lmg_feed_cover", M, bevel=(0.0015, 1))
    cover.box((0.058, 0.220, 0.030), (0.0, 0.030, 0.080))  # hinged top cover
    cover.box((0.040, 0.060, 0.012), (0.0, 0.030, 0.100))  # cover latch hump
    d["lmg_feed_cover"] = cover

    tray = Mesh("lmg_feed_tray", M)
    tray.box((0.050, 0.120, 0.010), (0.0, 0.030, 0.062))
    d["lmg_feed_tray"] = tray

    box = Mesh("lmg_ammo_box", P, bevel=(0.002, 1))
    box.box((0.060, 0.160, 0.130), (-0.095, 0.030, -0.030))  # side-hung container
    box.box((0.064, 0.040, 0.020), (-0.095, 0.030, 0.045))  # lid
    box.box((0.020, 0.060, 0.060), (-0.060, 0.055, 0.020))  # feed chute to tray
    d["lmg_ammo_box"] = box

    bar = Mesh("lmg_barrel", M, smooth=True)
    bar.cyl(0.013, 0.300, seg=16, center=(0.0, 0.370, 0.040), axis="Y")
    d["lmg_barrel"] = bar

    shield = Mesh("lmg_heat_shield", M)
    shield.box((0.040, 0.180, 0.040), (0.0, 0.310, 0.040))  # perforated guard body
    for i in range(3):
        shield.box((0.042, 0.020, 0.042), (0.0, 0.250 + i * 0.060, 0.040))
    d["lmg_heat_shield"] = shield

    muz = Mesh("lmg_muzzle", M, smooth=True)
    muz.cyl(0.017, 0.055, seg=14, center=(0.0, 0.5475, 0.040), axis="Y")
    d["lmg_muzzle"] = muz

    handle = Mesh("lmg_carry_handle", P, bevel=(0.002, 1))
    handle.box((0.014, 0.160, 0.012), (0.0, 0.030, 0.125))  # top bar
    handle.box((0.014, 0.012, 0.030), (0.0, -0.045, 0.110))  # rear leg
    handle.box((0.014, 0.012, 0.030), (0.0, 0.105, 0.110))  # front leg
    d["lmg_carry_handle"] = handle

    fs = Mesh("lmg_sights", M)
    fs.box((0.004, 0.004, 0.020), (0.0, 0.105, 0.140))  # front post on handle
    fs.box((0.026, 0.020, 0.010), (0.0, -0.045, 0.138))  # rear aperture block
    d["lmg_sights"] = fs

    bipod = Mesh("lmg_bipod", M, smooth=True)
    bipod.cyl(0.007, 0.200, seg=10, center=(-0.045, 0.420, -0.050), axis="Z")
    bipod.cyl(0.007, 0.200, seg=10, center=(0.045, 0.420, -0.050), axis="Z")
    bipod.box((0.100, 0.020, 0.020), (0.0, 0.420, 0.045))  # gas block mount
    d["lmg_bipod"] = bipod

    hg = Mesh("lmg_lower_guard", P, bevel=(0.002, 1))
    hg.box((0.052, 0.160, 0.040), (0.0, 0.140, -0.035))
    d["lmg_lower_guard"] = hg

    stock = Mesh("lmg_stock", P, bevel=(0.002, 1))
    # Frozen envelope y_min=-0.42: stock rear at -0.400, 20 mm forward of the
    # old -0.450 face that tripped heroes-build-2300. Buttpad rear at -0.418
    # keeps 2 mm bevel margin; never widen the bound to fit the mesh.
    stock.box((0.040, 0.130, 0.080), (0.0, -0.335, 0.005))  # fixed stock
    d["lmg_stock"] = stock

    butt = Mesh("lmg_buttpad", A, bevel=(0.002, 1))
    butt.box((0.044, 0.018, 0.090), (0.0, -0.409, 0.000))  # flush on stock rear
    d["lmg_buttpad"] = butt

    grip = Mesh("lmg_grip", P, bevel=(0.002, 1))
    grip.box((0.032, 0.048, 0.115), (0.0, -0.205, -0.050), rx=-0.30)
    d["lmg_grip"] = grip

    trg = Mesh("lmg_trigger", M)
    trg.box((0.008, 0.006, 0.020), (0.0, -0.175, -0.018))
    trg.box((0.008, 0.006, 0.014), (0.0, -0.125, -0.022))
    trg.box((0.008, 0.056, 0.004), (0.0, -0.150, -0.030))
    trg.box((0.004, 0.006, 0.020), (0.0, -0.150, -0.016), rx=-0.20)
    d["lmg_trigger"] = trg

    cock = Mesh("lmg_cocking", M, smooth=True)
    cock.cyl(0.006, 0.090, seg=10, center=(0.036, 0.020, 0.030), axis="Y")
    cock.box((0.014, 0.030, 0.014), (0.036, 0.070, 0.030))
    d["lmg_cocking"] = cock
    return d


BUILDERS = {"mp5": build_mp5, "m14-ebr": build_ebr, "lmg": build_lmg}


# ----------------------------------------------------------------------------
# Blender-side material / texture / scene assembly (imported lazily so the
# module stays import-safe outside Blender).
# ----------------------------------------------------------------------------
def _build_in_blender(gun, out_root):
    import bpy
    from math import radians

    cfg = GUNS[gun]
    M, P, A = (f"{gun}_{k}" for k in ("metal", "polymer", "accent"))

    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)

    try:
        bpy.context.preferences.view.language = "en_US"
    except Exception:
        pass
    sc = bpy.context.scene
    try:
        sc.render.threads_mode = "FIXED"
        sc.render.threads = 2
    except Exception:
        pass

    # --- materials: Principled BSDF looked up by TYPE (locale-safe) ---
    def get_mat(key, rgba, metal, rough):
        m = bpy.data.materials.get(key) or bpy.data.materials.new(key)
        m.use_nodes = True
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        nxt = lambda ident: next(i for i in bsdf.inputs if i.identifier == ident)
        nxt("Base Color").default_value = rgba
        nxt("Metallic").default_value = metal
        nxt("Roughness").default_value = rough
        return m

    mats = {}
    for key, full in ((M, "metal"), (P, "polymer"), (A, "accent")):
        rgba, metal, rough = cfg["mats"][full]
        mats[key] = get_mat(key, rgba, metal, rough)

    # --- procedural 1024 textures (pixel-filled, deterministic; no bake) ---
    rng = random.Random({"mp5": 137, "m14-ebr": 733, "lmg": 2025}[gun])
    S = BUDGET["px"]

    def make_image(name, kind):
        img = bpy.data.images.get(name)
        if img is not None:
            bpy.data.images.remove(img)
        img = bpy.data.images.new(name, S, S, alpha=False)
        cols = cfg["mats"]
        pals = {
            "metal": cols["metal"][0][:3],
            "polymer": cols["polymer"][0][:3],
            "accent": cols["accent"][0][:3],
        }
        if kind == "orm":
            pals = {
                "metal": (1.0, cols["metal"][2], cols["metal"][1]),
                "polymer": (1.0, cols["polymer"][2], cols["polymer"][1]),
                "accent": (1.0, cols["accent"][2], cols["accent"][1]),
            }
        keys = ("metal", "polymer", "accent")
        px = [0.0] * (S * S * 4)
        for y in range(S):
            band = keys[(y * 3) // S]
            base = pals[band]
            for x in range(S):
                n = (rng.random() - 0.5) * 0.05
                edge = 0.03 if (x % 64) < 2 or (y % 64) < 2 else 0.0
                o = (y * S + x) * 4
                px[o] = min(1.0, max(0.0, base[0] + n + edge))
                px[o + 1] = min(1.0, max(0.0, base[1] + n + edge))
                px[o + 2] = min(1.0, max(0.0, base[2] + n + edge))
                px[o + 3] = 1.0
        img.pixels.foreach_set(px)
        img.pack()
        img.file_format = "PNG"
        return img

    base_img = make_image(f"{gun}_basecolor_1k", "base")
    orm_img = make_image(f"{gun}_orm_1k", "orm")

    def wire(m):
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        tb = nt.nodes.new("ShaderNodeTexImage")
        tb.image = base_img
        tb.location = (-600, 300)
        nt.links.new(tb.outputs["Color"],
                     next(i for i in bsdf.inputs if i.identifier == "Base Color"))
        to = nt.nodes.new("ShaderNodeTexImage")
        to.image = orm_img
        to.location = (-600, -100)
        try:
            to.image.colorspace_settings.name = "Non-Color"
        except Exception:
            pass
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(to.outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"],
                     next(i for i in bsdf.inputs if i.identifier == "Roughness"))
        nt.links.new(sep.outputs["Blue"],
                     next(i for i in bsdf.inputs if i.identifier == "Metallic"))

    for m in mats.values():
        wire(m)

    # --- geometry ---
    parts = BUILDERS[gun](M, P, A)
    root = bpy.data.objects.new(f"{gun}_root", None)
    bpy.context.collection.objects.link(root)
    objs = []
    for name, em in parts.items():
        me = bpy.data.meshes.new(name)
        me.from_pydata(em.verts, [], em.faces)
        me.update()
        me.materials.append(mats[em.mat])
        o = bpy.data.objects.new(name, me)
        bpy.context.collection.objects.link(o)
        o.parent = root
        for pg in me.polygons:
            pg.use_smooth = em.smooth
        if em.bevel:
            mod = o.modifiers.new("edge", "BEVEL")
            mod.width = em.bevel[0]
            mod.segments = em.bevel[1]
            mod.limit_method = "ANGLE"
            try:
                mod.angle_limit = radians(49)
            except Exception:
                pass
        objs.append(o)

    # --- sockets (exact empties) + real magazine object check ---
    sockets = {}
    for nm, loc in cfg["sockets"].items():
        e = bpy.data.objects.new(nm, None)
        e.empty_display_type = "PLAIN_AXES"
        e.empty_display_size = 0.03
        e.location = loc
        e.parent = root
        bpy.context.collection.objects.link(e)
        sockets[nm] = e

    # --- UVs: smart_project then pack into per-MATERIAL bands ---
    # Texture is 3 horizontal bands (V thirds): 0 metal, 1 polymer, 2 accent.
    # The old per-mesh 5x4 tile scattered every mesh across band boundaries,
    # putting metal roughness on polymer etc. Mapping each mesh into its own
    # material band keeps roughness/metalness physical with the same 2 PNGs.
    for o in objs:
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        if not o.data.uv_layers:
            o.data.uv_layers.new(name="UVMap")
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=radians(66), island_margin=0.010)
        bpy.ops.object.mode_set(mode="OBJECT")
        matname = parts[o.name].mat
        band = 0 if matname == M else (1 if matname == P else 2)
        u0, u1 = 0.01, 0.99
        v0, v1 = band / 3.0 + 0.01, (band + 1) / 3.0 - 0.01
        raw = [tuple(l.uv) for l in o.data.uv_layers[0].data]
        mnu, mxu = min(p[0] for p in raw), max(p[0] for p in raw)
        mnv, mxv = min(p[1] for p in raw), max(p[1] for p in raw)
        su, sv = (mxu - mnu) or 1.0, (mxv - mnv) or 1.0
        for lp, (u, v) in zip(o.data.uv_layers[0].data, raw):
            lp.uv = (u0 + (u - mnu) * (u1 - u0) / su,
                     v0 + (v - mnv) * (v1 - v0) / sv)

    _validate(gun, cfg, objs, sockets)

    # --- save + export ---
    work = os.path.join(out_root, "work", "roster-heroes")
    pub = os.path.join(out_root, "public", "assets", "roster-heroes")
    os.makedirs(work, exist_ok=True)
    os.makedirs(pub, exist_ok=True)
    base_img.filepath_raw = os.path.join(work, f"{gun}_basecolor_1k.png")
    base_img.file_format = "PNG"
    base_img.save()
    orm_img.filepath_raw = os.path.join(work, f"{gun}_orm_1k.png")
    orm_img.file_format = "PNG"
    orm_img.save()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(work, f"{gun}.blend"))
    glb = os.path.join(pub, f"{gun}.glb")
    bpy.ops.export_scene.gltf(
        filepath=glb,
        export_format="GLB",
        export_apply=True,  # identity transforms: pivot contract preserved
        export_yup=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_texcoords=True,
        export_normals=True,
        export_cameras=False,
        export_lights=False,
    )
    total = sum(m.tris() for m in parts.values())
    print(f"ROSTER_HERO_OK {gun} meshes={len(objs)} tris={total} glb={glb}")


def _validate(gun, cfg, objs, sockets):
    bb = cfg["bounds"]
    total = 0
    for o in objs:
        if o.type != "MESH":
            continue
        mesh = o.to_mesh()
        try:
            ws = [o.matrix_world @ v.co for v in mesh.vertices]
        finally:
            o.to_mesh_clear()
        xs = [v.x for v in ws]
        ys = [v.y for v in ws]
        zs = [v.z for v in ws]
        if max(max(abs(min(xs)), abs(max(xs))), 0) > bb["x"]:
            raise AssertionError(f"{gun}/{o.name}: stray X {min(xs):+.4f}..{max(xs):+.4f}")
        if min(ys) < bb["y_min"] or max(ys) > bb["y_max"]:
            raise AssertionError(f"{gun}/{o.name}: stray Y {min(ys):+.4f}..{max(ys):+.4f}")
        if min(zs) < bb["z_min"] or max(zs) > bb["z_max"]:
            raise AssertionError(f"{gun}/{o.name}: stray Z {min(zs):+.4f}..{max(zs):+.4f}")
        sx, sy, sz = max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)
        if abs(sx - 1.0) < 0.02 and abs(sy - 1.0) < 0.02 and abs(sz - 1.0) < 0.02:
            raise AssertionError(f"{gun}/{o.name}: untransformed 1m unit cube")
        for m in o.modifiers:
            if m.type in ("SUBSURF", "BOOLEAN"):
                raise AssertionError(f"{gun}/{o.name}: forbidden modifier {m.type}")
        s = o.scale
        if abs(s[0] - 1.0) > 1e-6 or abs(s[1] - 1.0) > 1e-6 or abs(s[2] - 1.0) > 1e-6:
            raise AssertionError(f"{gun}/{o.name}: unapplied scale {tuple(s)}")
        if tuple(o.rotation_euler) != (0.0, 0.0, 0.0):
            raise AssertionError(f"{gun}/{o.name}: unapplied rotation")
        uvl = o.data.uv_layers[0]
        for lp in uvl.data:
            u, v = lp.uv
            if not (math.isfinite(u) and math.isfinite(v)):
                raise AssertionError(f"{gun}/{o.name}: non-finite UV")
            if u < 0.0 or u > 1.0 or v < 0.0 or v > 1.0:
                raise AssertionError(f"{gun}/{o.name}: UV out of [0,1]: ({u},{v})")
        import bmesh as _bm
        bm = _bm.new()
        bm.from_mesh(o.data)
        try:
            total += sum(max(0, len(f.verts) - 2) for f in bm.faces)
        finally:
            bm.free()
    if len([o for o in objs if o.type == "MESH"]) > BUDGET["draws"]:
        raise AssertionError(f"{gun}: too many draws")
    if total > BUDGET["tris"]:
        raise AssertionError(f"{gun}: {total} tris over budget {BUDGET['tris']}")
    for nm, exp in cfg["sockets"].items():
        if nm not in sockets:
            raise AssertionError(f"{gun}: missing socket {nm}")
        act = sockets[nm].location
        if max(abs(a - e) for a, e in zip(act, exp)) > 0.005:
            raise AssertionError(f"{gun}: socket {nm} at {tuple(act)} != {exp}")
    mags = [o for o in objs if "magazine" in o.name or "ammo_box" in o.name]
    if not mags:
        raise AssertionError(f"{gun}: no real magazine/ammo-box object")
    print(f"PRE_EXPORT_OK {gun} draws={len(objs)} tris={total}")


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--gun", default="all", choices=["mp5", "m14-ebr", "lmg", "all"])
    ap.add_argument("--out", default=None)
    args = ap.parse_args(argv)
    here = os.path.dirname(os.path.abspath(__file__))
    out_root = args.out or os.path.abspath(os.path.join(here, "..", ".."))
    guns = ["mp5", "m14-ebr", "lmg"] if args.gun == "all" else [args.gun]
    for g in guns:
        _build_in_blender(g, out_root)
    print("PHASE_OK roster-heroes", ",".join(guns))


if __name__ == "__main__" or "bpy" in sys.modules:
    _argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if "bpy" in sys.modules:
        main(_argv)
