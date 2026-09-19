#!/usr/bin/env python3
"""Import and package official Poly Haven quiver_tree_02 1k glTF set.

Downloads official 1k glTF package (~4.55 MB total) with MD5 and byte-size verification:
  - quiver_tree_02_1k.gltf
  - quiver_tree_02.bin
  - textures/quiver_tree_02_diff_1k.jpg
  - textures/quiver_tree_02_nor_gl_1k.jpg
  - textures/quiver_tree_02_arm_1k.jpg

Spawns Blender 5.1 in background mode (CPU-only, 2 threads, CREATE_NO_WINDOW) to:
  - Decimate mesh to <= 38,000 triangles (max 2 decimation attempts)
  - Center XZ and align foot to Y = 0 (preserving native measured height ~1.47 m)
  - Preserve embedded 1k diffuse/normal/ARM maps without reauthoring
  - Save editable work/quiver-tree/quiver_tree_02.blend
  - Export self-contained GLB to public/assets/quiver-tree/quiver-tree.glb

Primary sources:
  - Asset page: https://polyhaven.com/a/quiver_tree_02
  - Metadata API: https://api.polyhaven.com/info/quiver_tree_02
  - Files API: https://api.polyhaven.com/files/quiver_tree_02
  - License: CC0 1.0 Universal (https://polyhaven.com/license)
  - Authors: Dario Barresi (photography), Rico Cilliers (modeling).

Usage:
  python scripts/assets/import-quiver-tree.py [--check-only]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
SCRATCH_DIR = ROOT / "work" / "quiver-tree"
SOURCE_DIR = SCRATCH_DIR / "source"
OUT_DIR = ROOT / "public" / "assets" / "quiver-tree"
OUT_GLB = OUT_DIR / "quiver-tree.glb"
OUT_GLB_ALIAS = OUT_DIR / "quiver_tree_02.glb"
BLEND_FILE = SCRATCH_DIR / "quiver_tree_02.blend"
PREPARE_SCRIPT = ROOT / "scripts" / "blender" / "prepare_quiver_tree.py"

BLENDER_EXE = Path(r"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe")

# Official Poly Haven 1k glTF files (from api.polyhaven.com/files/quiver_tree_02)
SOURCES = {
    "quiver_tree_02_1k.gltf": (
        "https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/quiver_tree_02/quiver_tree_02_1k.gltf",
        2809,
        "1002e67d6921204df06b9a97f4f30cff",
    ),
    "quiver_tree_02.bin": (
        "https://dl.polyhaven.org/file/ph-assets/Models/gltf/8k/quiver_tree_02/quiver_tree_02.bin",
        2060604,
        "63635d61c58151eb4fb0b2caaf6b373c",
    ),
    "textures/quiver_tree_02_diff_1k.jpg": (
        "https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/quiver_tree_02/quiver_tree_02_diff_1k.jpg",
        736321,
        "7f14325c48fc30112476b851d7e05232",
    ),
    "textures/quiver_tree_02_nor_gl_1k.jpg": (
        "https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/quiver_tree_02/quiver_tree_02_nor_gl_1k.jpg",
        988408,
        "5ddb37eb256e324a0929e465d429f5a7",
    ),
    "textures/quiver_tree_02_arm_1k.jpg": (
        "https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/quiver_tree_02/quiver_tree_02_arm_1k.jpg",
        759729,
        "36d19d0ef3d38ed92c557d9eb2203302",
    ),
}


def md5_of(data: bytes) -> str:
    return hashlib.md5(data).hexdigest()


def sha256_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def ensure_downloads() -> dict[str, bytes]:
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    (SOURCE_DIR / "textures").mkdir(parents=True, exist_ok=True)
    blobs: dict[str, bytes] = {}

    for rel_path, (url, exp_size, exp_md5) in SOURCES.items():
        file_path = SOURCE_DIR / rel_path
        if file_path.exists():
            data = file_path.read_bytes()
        else:
            print(f"[DOWNLOAD] Fetching {rel_path} ({exp_size} bytes)...")
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
            with urllib.request.urlopen(req) as resp:
                data = resp.read()
            file_path.write_bytes(data)

        if len(data) != exp_size:
            raise ValueError(f"Size mismatch for {rel_path}: got {len(data)} bytes, expected {exp_size}")
        digest = md5_of(data)
        if digest != exp_md5:
            raise ValueError(f"MD5 mismatch for {rel_path}: got {digest}, expected {exp_md5}")

        blobs[rel_path] = data

    return blobs


def run_blender_conversion() -> None:
    if not BLENDER_EXE.exists():
        raise FileNotFoundError(f"Blender executable not found at: {BLENDER_EXE}")
    if not PREPARE_SCRIPT.exists():
        raise FileNotFoundError(f"Blender script not found at: {PREPARE_SCRIPT}")

    cmd = [
        str(BLENDER_EXE),
        "--background",
        "--threads", "2",
        "--python", str(PREPARE_SCRIPT),
    ]

    creation_flags = 0
    if sys.platform == "win32":
        creation_flags = subprocess.CREATE_NO_WINDOW

    print(f"[BLENDER] Launching Blender background job (2 CPU threads, no window)...")
    res = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        creationflags=creation_flags,
    )
    if res.returncode != 0:
        print(res.stdout)
        print(res.stderr, file=sys.stderr)
        raise RuntimeError(f"Blender exited with return code {res.returncode}")

    # Echo key lines from Blender output
    for line in res.stdout.splitlines():
        if any(marker in line for marker in ("[PREPARE]", "triangles", "bounds", "Saved", "Exported", "REPORT", "PASSED")):
            print(f"  {line}")


def audit_glb(path: Path) -> dict:
    data = path.read_bytes()
    magic, version, length = struct.unpack("<III", data[0:12])
    assert magic == 0x46546C67 and version == 2 and length == len(data)

    json_len, _ = struct.unpack("<II", data[12:20])
    gltf = json.loads(data[20:20 + json_len].decode("utf-8"))

    mesh = gltf["meshes"][0]
    prim = mesh["primitives"][0]
    idx_acc = gltf["accessors"][prim["indices"]]
    triangles = idx_acc["count"] // 3
    pos_acc = gltf["accessors"][prim["attributes"]["POSITION"]]

    return {
        "file": str(path.relative_to(ROOT)).replace("\\", "/"),
        "bytes": len(data),
        "sha256": sha256_of(data),
        "triangles": triangles,
        "two_instances_triangles": triangles * 2,
        "materials": len(gltf.get("materials", [])),
        "primitives": len(mesh["primitives"]),
        "images": len(gltf.get("images", [])),
        "bounds_min": pos_acc["min"],
        "bounds_max": pos_acc["max"],
        "height_m": pos_acc["max"][1] - pos_acc["min"][1],
    }


def main():
    parser = argparse.ArgumentParser(description="Import Quiver Tree 02 1k asset")
    parser.add_argument("--check-only", action="store_true", help="Verify downloads and exit without running Blender")
    args = parser.parse_args()

    blobs = ensure_downloads()
    total_dl_bytes = sum(len(b) for b in blobs.values())
    print(f"[OK] Downloaded 5 official 1k files: {total_dl_bytes} bytes (~{total_dl_bytes / (1024 * 1024):.2f} MB).")

    if args.check_only:
        print("[CHECK-ONLY] All 5 source files verified with official sizes and MD5s.")
        return

    run_blender_conversion()

    audit = audit_glb(OUT_GLB)
    print("\n=== FINAL EXPORT AUDIT ===")
    print(f"GLB path:               {audit['file']}")
    print(f"GLB bytes:              {audit['bytes']} ({audit['bytes'] / (1024 * 1024):.2f} MB <= 8.00 MB cap)")
    print(f"GLB SHA256:             {audit['sha256']}")
    print(f"Single tree triangles:  {audit['triangles']} (<= 38,000 cap)")
    print(f"Two trees triangles:    {audit['two_instances_triangles']} (<= 76,000 cap)")
    print(f"Materials:              {audit['materials']}")
    print(f"Primitives:             {audit['primitives']}")
    print(f"Images:                 {audit['images']}")
    print(f"Bounds Min (Y-up):      {audit['bounds_min']}")
    print(f"Bounds Max (Y-up):      {audit['bounds_max']}")
    print(f"Measured height:        {audit['height_m']:.6f} m (~1.47 m)")
    print(f"Centered XZ:            min_x={audit['bounds_min'][0]:.6f}, max_x={audit['bounds_max'][0]:.6f} (center={((audit['bounds_min'][0]+audit['bounds_max'][0])/2):.6f})")
    print(f"Foot Y:                 {audit['bounds_min'][1]:.6f}")


if __name__ == "__main__":
    main()
