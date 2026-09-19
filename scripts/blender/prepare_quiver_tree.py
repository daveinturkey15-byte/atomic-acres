"""Blender CPU decimation and packaging pass for Quiver Tree 02 (quiver_tree_02).

Executed by Blender 5.1 in background mode:
  & "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --threads 2 --python scripts/blender/prepare_quiver_tree.py

CPU-only, no GPU rendering, no ML/inference, no texture reauthoring.
Decimates source geometry to <= 38,000 triangles (for two instances <= 76,000 tris).
Centers XZ at 0 and sets foot Y = 0 in glTF (Z = 0 in Blender).
Preserves native measured height ~1.47 m.
Exports self-contained GLB to public/assets/quiver-tree/ and editable .blend to work/quiver-tree/.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
SRC_GLTF_DEFAULT = ROOT / "work" / "quiver-tree" / "source" / "quiver_tree_02_1k.gltf"
OUT_BLEND_DEFAULT = ROOT / "work" / "quiver-tree" / "quiver_tree_02.blend"
OUT_GLB_DEFAULT = ROOT / "public" / "assets" / "quiver-tree" / "quiver-tree.glb"


def sha256_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def md5_of(data: bytes) -> str:
    return hashlib.md5(data).hexdigest()


def parse_args():
    # Blender arguments before '--' are consumed by Blender.
    # Arguments after '--' are passed to this script.
    argv = sys.argv
    if "--" in argv:
        args_for_script = argv[argv.index("--") + 1:]
    else:
        args_for_script = []

    parser = argparse.ArgumentParser(description="Prepare Quiver Tree 02 in Blender")
    parser.add_argument("--source-gltf", type=Path, default=SRC_GLTF_DEFAULT, help="Path to source quiver_tree_02_1k.gltf")
    parser.add_argument("--output-blend", type=Path, default=OUT_BLEND_DEFAULT, help="Path to write .blend file")
    parser.add_argument("--output-glb", type=Path, default=OUT_GLB_DEFAULT, help="Path to write .glb file")
    parser.add_argument("--max-tris", type=int, default=38000, help="Maximum allowed triangles")
    parser.add_argument("--target-tris", type=int, default=37500, help="Target triangles for decimation")
    return parser.parse_args(args_for_script)


def clear_scene():
    import bpy
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.materials, bpy.data.images,
                       bpy.data.cameras, bpy.data.lights, bpy.data.curves):
        for block in list(collection):
            collection.remove(block)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0


def count_triangles(mesh_or_obj) -> int:
    import bpy
    if isinstance(mesh_or_obj, bpy.types.Object):
        mesh = mesh_or_obj.data
    else:
        mesh = mesh_or_obj
    return sum(len(p.vertices) - 2 for p in mesh.polygons)


def inspect_glb(glb_path: Path) -> dict:
    data = glb_path.read_bytes()
    magic, version, length = struct.unpack("<III", data[0:12])
    assert magic == 0x46546C67, f"Invalid GLB magic: {hex(magic)}"
    assert version == 2, f"Unsupported GLB version: {version}"
    assert length == len(data), f"Length mismatch: {length} != {len(data)}"

    json_len, json_type = struct.unpack("<II", data[12:20])
    assert json_type == 0x4E4F534A, "First chunk is not JSON"
    gltf = json.loads(data[20:20 + json_len].decode("utf-8"))

    bin_offset = 20 + json_len
    bin_len, bin_type = struct.unpack("<II", data[bin_offset:bin_offset + 8])
    assert bin_type == 0x004E4942, "Second chunk is not BIN"

    # Extract mesh info
    assert len(gltf["meshes"]) == 1, f"Expected 1 mesh, found {len(gltf['meshes'])}"
    mesh = gltf["meshes"][0]
    assert len(mesh["primitives"]) == 1, f"Expected 1 primitive, found {len(mesh['primitives'])}"
    prim = mesh["primitives"][0]

    idx_acc = gltf["accessors"][prim["indices"]]
    triangles = idx_acc["count"] // 3

    pos_acc = gltf["accessors"][prim["attributes"]["POSITION"]]
    min_b = pos_acc["min"]
    max_b = pos_acc["max"]
    dim_x = max_b[0] - min_b[0]
    dim_y = max_b[1] - min_b[1]
    dim_z = max_b[2] - min_b[2]

    # Verify embedded images
    images_info = []
    chunk_bin_start = bin_offset + 8
    for i, img in enumerate(gltf.get("images", [])):
        bv = gltf["bufferViews"][img["bufferView"]]
        offset = chunk_bin_start + bv.get("byteOffset", 0)
        img_bytes = data[offset:offset + bv["byteLength"]]
        images_info.append({
            "index": i,
            "name": img.get("name"),
            "mimeType": img.get("mimeType"),
            "size": len(img_bytes),
            "md5": md5_of(img_bytes),
            "sha256": sha256_of(img_bytes),
        })

    return {
        "file": str(glb_path),
        "bytes": len(data),
        "sha256": sha256_of(data),
        "triangles": triangles,
        "vertex_count": pos_acc["count"],
        "materials_count": len(gltf.get("materials", [])),
        "materials": [m.get("name") for m in gltf.get("materials", [])],
        "primitives_count": len(mesh["primitives"]),
        "images_count": len(gltf.get("images", [])),
        "images": images_info,
        "bounds_min": min_b,
        "bounds_max": max_b,
        "dimensions": [dim_x, dim_y, dim_z],
        "height_m": dim_y,
    }


def main():
    args = parse_args()

    if not args.source_gltf.exists():
        raise FileNotFoundError(f"Source glTF not found: {args.source_gltf}")

    import bpy

    print(f"[PREPARE] Importing source glTF: {args.source_gltf}")
    clear_scene()
    t0 = time.perf_counter()
    bpy.ops.import_scene.gltf(filepath=str(args.source_gltf.resolve()))
    t_import = time.perf_counter()

    mesh_objs = [o for o in bpy.data.objects if o.type == "MESH"]
    if len(mesh_objs) != 1:
        raise RuntimeError(f"Expected 1 mesh object in glTF, found {len(mesh_objs)}")
    obj = mesh_objs[0]

    initial_tris = count_triangles(obj)
    print(f"[PREPARE] Source mesh '{obj.name}' imported with {len(obj.data.vertices)} vertices, {initial_tris} triangles.")

    # At most two decimation attempts
    decimated_tris = initial_tris
    attempts = 0
    max_attempts = 2

    if initial_tris > args.max_tris:
        mod = obj.modifiers.new(name="Decimate", type="DECIMATE")
        mod.decimate_type = "COLLAPSE"

        # Attempt 1
        attempts += 1
        ratio_1 = args.target_tris / initial_tris
        mod.ratio = ratio_1
        depsgraph = bpy.context.evaluated_depsgraph_get()
        eval_obj = obj.evaluated_get(depsgraph)
        eval_mesh = eval_obj.to_mesh()
        eval_tris_1 = count_triangles(eval_mesh)
        eval_obj.to_mesh_clear()
        print(f"[PREPARE] Decimation attempt 1: ratio={ratio_1:.6f}, resulting triangles={eval_tris_1}")

        if eval_tris_1 > args.max_tris and attempts < max_attempts:
            # Attempt 2
            attempts += 1
            ratio_2 = (args.target_tris / eval_tris_1) * ratio_1
            mod.ratio = ratio_2
            depsgraph = bpy.context.evaluated_depsgraph_get()
            eval_obj = obj.evaluated_get(depsgraph)
            eval_mesh = eval_obj.to_mesh()
            eval_tris_2 = count_triangles(eval_mesh)
            eval_obj.to_mesh_clear()
            print(f"[PREPARE] Decimation attempt 2: ratio={ratio_2:.6f}, resulting triangles={eval_tris_2}")
            if eval_tris_2 > args.max_tris:
                raise RuntimeError(f"Decimation failed: {eval_tris_2} > {args.max_tris} after {attempts} attempts")
            decimated_tris = eval_tris_2
        else:
            decimated_tris = eval_tris_1

        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier="Decimate")
        applied_tris = count_triangles(obj)
        print(f"[PREPARE] Applied decimate modifier in {attempts} attempt(s): {applied_tris} triangles.")
        assert applied_tris <= args.max_tris, f"Applied tris {applied_tris} exceeds max {args.max_tris}"

    # Centering XZ and foot Y=0
    # In Blender coordinates: Z is Up, X is Right, Y is Depth
    # Blender Z -> glTF Y (Up)
    # Blender X -> glTF X (Right)
    # Blender Y -> glTF -Z (Depth)
    xs = [v.co.x for v in obj.data.vertices]
    ys = [v.co.y for v in obj.data.vertices]
    zs = [v.co.z for v in obj.data.vertices]

    cx = (min(xs) + max(xs)) / 2.0
    cy = (min(ys) + max(ys)) / 2.0
    fz = min(zs)

    print(f"[PREPARE] Pre-center bounds (Blender coords): X=[{min(xs):.6f}, {max(xs):.6f}], Y=[{min(ys):.6f}, {max(ys):.6f}], Z=[{min(zs):.6f}, {max(zs):.6f}]")
    print(f"[PREPARE] Shifting geometry by dX={-cx:.6f}, dY={-cy:.6f}, dZ={-fz:.6f}")

    for v in obj.data.vertices:
        v.co.x -= cx
        v.co.y -= cy
        v.co.z -= fz
    obj.data.update()

    new_xs = [v.co.x for v in obj.data.vertices]
    new_ys = [v.co.y for v in obj.data.vertices]
    new_zs = [v.co.z for v in obj.data.vertices]
    print(f"[PREPARE] Post-center bounds (Blender coords): X=[{min(new_xs):.6f}, {max(new_xs):.6f}], Y=[{min(new_ys):.6f}, {max(new_ys):.6f}], Z=[{min(new_zs):.6f}, {max(new_zs):.6f}]")

    # Save editable .blend file in work/quiver-tree/
    args.output_blend.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.output_blend.resolve()))
    print(f"[PREPARE] Saved editable .blend: {args.output_blend}")

    # Export self-contained GLB
    args.output_glb.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(args.output_glb.resolve()),
        export_format="GLB",
        export_apply=True,
        export_image_format="AUTO"
    )
    print(f"[PREPARE] Exported GLB: {args.output_glb}")


    t_end = time.perf_counter()
    print(f"[PREPARE] Finished in {t_end - t0:.2f}s (import {t_import - t0:.2f}s).")

    # Inspect the exported GLB
    report = inspect_glb(args.output_glb)
    report["decimation_attempts"] = attempts
    report["initial_triangles"] = initial_tris
    report["blend_file"] = str(args.output_blend)
    report["total_time_s"] = round(t_end - t0, 3)

    print("\n=== GLB AUDIT REPORT ===")
    print(json.dumps(report, indent=2))

    # Assert budget limits
    assert report["bytes"] <= 8 * 1024 * 1024, f"GLB size {report['bytes']} exceeds 8 MB cap"
    assert report["triangles"] <= args.max_tris, f"Triangles {report['triangles']} exceeds {args.max_tris}"
    assert report["materials_count"] == 1, f"Expected 1 material, found {report['materials_count']}"
    assert report["primitives_count"] == 1, f"Expected 1 primitive, found {report['primitives_count']}"
    assert report["images_count"] == 3, f"Expected 3 images, found {report['images_count']}"
    assert abs(report["bounds_min"][1]) < 1e-4, f"Foot Y not at 0: {report['bounds_min'][1]}"
    assert abs((report["bounds_min"][0] + report["bounds_max"][0]) / 2.0) < 1e-4, f"X not centered: {report['bounds_min'][0]}..{report['bounds_max'][0]}"
    assert abs((report["bounds_min"][2] + report["bounds_max"][2]) / 2.0) < 1e-4, f"Z not centered: {report['bounds_min'][2]}..{report['bounds_max'][2]}"
    print("[PREPARE] ALL CHECKS PASSED.")


if __name__ == "__main__":
    main()
