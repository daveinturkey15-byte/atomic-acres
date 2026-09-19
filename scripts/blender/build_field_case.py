"""Deterministic Blender authoring pass for the standalone Nuketown field case.

This is an original hard-surface prop, authored from primitives in metres.  It is
deliberately a small game-ready canary: honest wall thickness, a closed lid,
recessed handle, clasps, ribs, feet and bolt heads.  Run with Blender 5.1:

    blender.exe --background --python scripts/blender/build_field_case.py

The exporter writes an embedded-PBR GLB and a compact provenance report.  No
network, add-on, external mesh or model is used by this script.
"""

from __future__ import annotations

import hashlib
import json
import math
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import common as C  # noqa: E402


OUT_DIR = ROOT / "public" / "assets" / "field-case"
OUT_GLB = OUT_DIR / "field-case.glb"
REPORT_DIR = ROOT / "docs" / "field-case"
REPORT = REPORT_DIR / "build-report.json"
BLEND = REPORT_DIR / "field-case.blend"
SEED = 0xFC0719
T0 = time.perf_counter()


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.materials, bpy.data.images,
                       bpy.data.cameras, bpy.data.lights, bpy.data.curves):
        for block in list(collection):
            collection.remove(block)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0


def link(obj):
    bpy.context.collection.objects.link(obj)
    return obj


def image(name: str, size: int, colorspace: str, fn):
    def wrapped(u, v):
        # A stable, tileable-ish value noise field.  The maps are hand-authored
        # data, not a runtime procedural texture, so glTF carries them.
        n = math.sin((u * 37.0 + v * 19.0 + SEED) * 0.73) * 0.5 + 0.5
        m = math.sin((u * 113.0 - v * 71.0 + SEED) * 0.19) * 0.5 + 0.5
        return fn(u, v, n, m)
    return C.make_image(name, size, size, colorspace, wrapped, pack=True)


def material(name: str, base, metallic=0.0, roughness=0.5):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*C.hex_to_linear_rgb(base), 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def paint_material():
    # A muted olive polymer with a slightly dusty, sun-faded edge tone.  The
    # maps stay intentionally restrained so the case reads as moulded plastic
    # in the game lighting instead of painted camouflage.
    mat = material("FieldCasePaint", 0x59634A, metallic=0.05, roughness=0.66)
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")

    def clamp(value):
        return max(0.0, min(1.0, value))

    base = image(
        "FieldCase_BaseColor", 256, "sRGB",
        lambda u, v, n, m: (
            # UV-border wear gives the moulded corners a dusty highlight while
            # the two stable fields provide subtle polymer grain and stain.
            clamp(0.255 + 0.045 * n + 0.018 * m
                  + 0.012 * math.sin(u * 239.0 + v * 17.0)
                  + 0.055 * max(0.0, 1.0 - min(u, 1.0 - u, v, 1.0 - v) / 0.075)
                  * (0.35 + 0.65 * m)),
            clamp(0.305 + 0.052 * n + 0.022 * m
                  + 0.010 * math.sin(u * 239.0 + v * 17.0)
                  + 0.047 * max(0.0, 1.0 - min(u, 1.0 - u, v, 1.0 - v) / 0.075)
                  * (0.35 + 0.65 * m)),
            clamp(0.205 + 0.036 * n + 0.015 * m
                  + 0.008 * math.sin(u * 239.0 + v * 17.0)
                  + 0.030 * max(0.0, 1.0 - min(u, 1.0 - u, v, 1.0 - v) / 0.075)
                  * (0.35 + 0.65 * m)),
            1.0,
        ),
    )
    rough = image(
        "FieldCase_Roughness", 256, "Non-Color",
        lambda u, v, n, m: (
            *([clamp(0.52 + 0.18 * n + 0.08 * m
                     + 0.08 * max(0.0, 1.0 - min(u, 1.0 - u, v, 1.0 - v) / 0.075))] * 3),
            1.0,
        ),
    )
    normal = image(
        "FieldCase_Normal", 256, "Non-Color",
        lambda u, v, n, m: (
            0.5 + 0.045 * math.sin(u * 239.0 + v * 17.0) + 0.018 * (n - 0.5),
            0.5 + 0.045 * math.sin(v * 223.0 - u * 13.0) + 0.018 * (m - 0.5),
            1.0,
            1.0,
        ),
    )
    for name, img, color_input in (
        ("FieldCase_BaseColorTex", base, "Base Color"),
        ("FieldCase_RoughnessTex", rough, "Roughness"),
    ):
        tex = nodes.new("ShaderNodeTexImage")
        tex.name = name
        tex.image = img
        links.new(tex.outputs["Color"], bsdf.inputs[color_input])
    ntex = nodes.new("ShaderNodeTexImage")
    ntex.name = "FieldCase_NormalTex"
    ntex.image = normal
    ntex.image.colorspace_settings.name = "Non-Color"
    links.new(ntex.outputs["Color"], bsdf.inputs["Normal"])
    return mat, (base, rough, normal)


def metal_material():
    # Darkened steel keeps the latch faces distinct from the olive shell while
    # preserving a controlled reflection under both the game and reference rigs.
    mat = material("FieldCaseSteel", 0x4A514D, metallic=0.88, roughness=0.30)
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")

    def clamp(value):
        return max(0.0, min(1.0, value))

    base = image(
        "FieldCase_MetalBase", 128, "sRGB",
        lambda u, v, n, m: (
            clamp(0.245 + 0.045 * n + 0.018 * math.sin(v * 170.0 + u * 9.0)),
            clamp(0.265 + 0.050 * n + 0.020 * math.sin(v * 170.0 + u * 9.0)),
            clamp(0.250 + 0.042 * n + 0.016 * math.sin(v * 170.0 + u * 9.0)),
            1.0,
        ),
    )
    rough = image(
        "FieldCase_MetalRoughness", 128, "Non-Color",
        lambda u, v, n, m: (
            *([clamp(0.22 + 0.11 * n + 0.07 * m)] * 3),
            1.0,
        ),
    )
    for name, img, color_input in (
        ("FieldCase_MetalBaseTex", base, "Base Color"),
        ("FieldCase_MetalRoughnessTex", rough, "Roughness"),
    ):
        tex = nodes.new("ShaderNodeTexImage")
        tex.name = name
        tex.image = img
        links.new(tex.outputs["Color"], bsdf.inputs[color_input])
    return mat, (base, rough)


def box(name, loc, dims, mat, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel > 0.0:
        mod = obj.modifiers.new("manufactured_round", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = "ANGLE"
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for poly in obj.data.polygons:
        poly.use_smooth = False
    return obj


def cylinder(name, loc, radius, depth, mat, axis="Z", vertices=12):
    rotation = {"X": (0.0, math.pi / 2.0, 0.0), "Y": (math.pi / 2.0, 0.0, 0.0), "Z": (0.0, 0.0, 0.0)}[axis]
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth,
                                        end_fill_type="NGON", location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.use_smooth = False
    return obj


def uv(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.uv.smart_project(angle_limit=1.1519, island_margin=0.025)
    bpy.ops.object.mode_set(mode="OBJECT")


def join_material(name, mat, objects):
    if not objects:
        return None
    # Bake each primitive's world transform before joining.  Without this,
    # Blender keeps the first object's non-zero origin and can offset the
    # joined mesh (most visible on the four rubber feet).
    for obj in objects:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    result = bpy.context.object
    result.name = name
    # All source objects carried one shared material.  Drop any redundant slots.
    while len(result.data.materials) > 1:
        result.data.materials.pop(index=1)
    result.data.materials[0] = mat
    uv(result)
    return result


def add_case(paint, metal, rubber):
    painted, metals, rubbers = [], [], []
    # Dimensions are metres, Blender Z-up.  The resulting export rolls to Y-up.
    w, d, h = 0.90, 0.48, 0.50
    wall = 0.045
    # Bottom and four honest walls.  The cavity remains real under the closed lid.
    painted += [box("case_floor", (0.0, 0.0, 0.035), (w - 0.04, d - 0.04, 0.07), paint, 0.012)]
    painted += [box("case_left_wall", (-w / 2 + wall / 2, 0.0, 0.205), (wall, d - 0.04, 0.34), paint, 0.012)]
    painted += [box("case_right_wall", (w / 2 - wall / 2, 0.0, 0.205), (wall, d - 0.04, 0.34), paint, 0.012)]
    painted += [box("case_front_wall", (0.0, -d / 2 + wall / 2, 0.205), (w - 0.08, wall, 0.34), paint, 0.012)]
    painted += [box("case_back_wall", (0.0, d / 2 - wall / 2, 0.205), (w - 0.08, wall, 0.34), paint, 0.012)]
    # Lid crown and a lower lip that sits over the wall tops.
    painted += [box("lid_crown", (0.0, 0.0, 0.455), (w + 0.012, d + 0.012, 0.065), paint, 0.014)]
    painted += [box("lid_lip_front", (0.0, -d / 2 + 0.008, 0.408), (w - 0.035, 0.035, 0.075), paint, 0.008)]
    painted += [box("lid_lip_back", (0.0, d / 2 - 0.008, 0.408), (w - 0.035, 0.035, 0.075), paint, 0.008)]
    painted += [box("lid_lip_left", (-w / 2 + 0.008, 0.0, 0.408), (0.035, d - 0.07, 0.075), paint, 0.008)]
    painted += [box("lid_lip_right", (w / 2 - 0.008, 0.0, 0.408), (0.035, d - 0.07, 0.075), paint, 0.008)]
    # Moulded lid ribs.  Their shadows provide the readable silhouette at 3 m.
    for i, x in enumerate((-0.29, 0.0, 0.29)):
        painted.append(box(f"lid_rib_{i}", (x, 0.0, 0.501), (0.055, d - 0.07, 0.028), paint, 0.009))
    for y in (-0.185, 0.185):
        painted.append(box("lid_cross_rib", (0.0, y, 0.502), (w - 0.07, 0.045, 0.026), paint, 0.008))
    # A recessed, unbranded inventory plate: it is deliberately blank, avoiding logos.
    painted.append(box("lid_recess_plate", (0.0, 0.0, 0.493), (0.21, 0.12, 0.006), paint, 0.004))

    # Front recessed handle pocket, mounts, and a horizontal grip.
    metals.append(box("handle_recess", (0.0, -0.244, 0.175), (0.40, 0.012, 0.17), metal, 0.009))
    for x in (-0.17, 0.17):
        metals.append(box("handle_mount", (x, -0.250, 0.185), (0.055, 0.026, 0.105), metal, 0.008))
    metals.append(cylinder("handle_grip", (0.0, -0.252, 0.185), 0.022, 0.36, metal, "X", 12))
    # Two front clasps with hinge tabs and latch faces.
    for x in (-0.27, 0.27):
        metals.append(box("clasp_plate", (x, -0.253, 0.285), (0.10, 0.025, 0.13), metal, 0.008))
        metals.append(box("clasp_latch", (x, -0.273, 0.287), (0.065, 0.022, 0.055), metal, 0.006))
        metals.append(cylinder("clasp_pin", (x, -0.286, 0.29), 0.010, 0.018, metal, "Y", 10))
    # Rear hinges are visible from an elevated orbit.
    for x in (-0.27, 0.27):
        metals.append(box("hinge_leaf", (x, 0.249, 0.36), (0.12, 0.018, 0.06), metal, 0.006))
        metals.append(cylinder("hinge_knuckle", (x, 0.255, 0.385), 0.014, 0.09, metal, "X", 10))
    # Eight recessed bolt heads, four on each long side.
    for y in (-0.251, 0.251):
        for x in (-0.36, -0.12, 0.12, 0.36):
            metals.append(cylinder("wall_bolt", (x, y, 0.185), 0.010, 0.012, metal, "Y", 10))
    # Feet are black, low-profile and physically part of the prop's contact.
    for x in (-0.34, 0.34):
        for y in (-0.16, 0.16):
            rubbers.append(box("rubber_foot", (x, y, 0.012), (0.10, 0.075, 0.024), rubber, 0.009))

    for obj in painted + metals + rubbers:
        obj.select_set(False)
    return (
        join_material("FieldCasePaintMesh", paint, painted),
        join_material("FieldCaseMetalMesh", metal, metals),
        join_material("FieldCaseRubberMesh", rubber, rubbers),
    )


def triangle_count():
    return sum(sum(max(0, len(poly.vertices) - 2) for poly in obj.data.polygons)
               for obj in bpy.data.objects if obj.type == "MESH")


def bounds():
    points = []
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    lo = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    hi = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return {"min": [round(v, 6) for v in lo], "max": [round(v, 6) for v in hi],
            "size": [round(v, 6) for v in (hi - lo)]}


def main():
    clear_scene()
    paint, images = paint_material()
    metal, metal_images = metal_material()
    rubber = material("FieldCaseRubber", 0x151718, metallic=0.02, roughness=0.88)
    meshes = add_case(paint, metal, rubber)

    # Geometry above is authored in Blender's normal Z-up space.  Blender's
    # glTF exporter performs the single Z-up -> Y-up conversion at export time;
    # applying a hand roll here would invert the ground pivot a second time.
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    # Save an editable source beside the report; no runtime dependency on it.
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    # Keep the retained source backup untouched; this appearance pass must not
    # create another redundant .blend1 beside the editable deliverable.
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(OUT_GLB), export_format="GLB", export_apply=True,
        export_materials="EXPORT", export_yup=True, export_texcoords=True,
        export_normals=True, export_tangents=True,
    )

    st = OUT_GLB.stat()
    embedded = []
    for img in bpy.data.images:
        if img.packed_file:
            embedded.append({"name": img.name, "width": img.size[0], "height": img.size[1],
                             "colorspace": img.colorspace_settings.name})
    blender_bounds = bounds()
    gltf_bounds = {
        "min": [blender_bounds["min"][0], blender_bounds["min"][2], -blender_bounds["max"][1]],
        "max": [blender_bounds["max"][0], blender_bounds["max"][2], -blender_bounds["min"][1]],
        "size": [blender_bounds["size"][0], blender_bounds["size"][2], blender_bounds["size"][1]],
    }
    report = {
        "asset": "field-case",
        "route": "original Blender-authored hard-surface canary",
        "source": "scripts/blender/build_field_case.py",
        "license": "original authored geometry and hand-authored maps; no external inputs",
        "license_read": "2026-09-19",
        "dimensions_m": {
            "declared_body": [0.9, 0.5, 0.5],
            "measured_exterior": gltf_bounds["size"],
            "axis": "x,y,z in exported glTF space; fittings included",
        },
        "pivot": "ground-centre (0,0,0); +x is the case long axis",
        "wall_thickness_m": 0.045,
        "triangles": triangle_count(),
        "meshes": [m.name for m in meshes if m is not None],
        "materials": [m.name for m in bpy.data.materials],
        "textures": embedded,
        "bounds_blender_z_up": blender_bounds,
        "bounds_gltf_y_up": gltf_bounds,
        "glb_bytes": st.st_size,
        "glb_sha256": hashlib.sha256(OUT_GLB.read_bytes()).hexdigest(),
        "build_seconds": round(time.perf_counter() - T0, 3),
        "budgets": {"triangles_max": 5000, "materials_max": 4, "texture_edge_max": 2048,
                    "glb_bytes_max": 2_000_000},
    }
    REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("FIELD_CASE_BUILD " + json.dumps({k: report[k] for k in (
        "triangles", "glb_bytes", "glb_sha256", "materials", "textures", "build_seconds")}))


if __name__ == "__main__":
    main()
