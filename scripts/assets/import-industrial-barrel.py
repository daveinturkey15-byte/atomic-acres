#!/usr/bin/env python3
"""Pack official Poly Haven barrel_03 1k glTF set into one self-contained GLB.

CPU-only, stdlib-only. No Blender, no GPU, no browser, no npm.
Embeds the official .bin + 3 official 1k JPEGs byte-identical; no re-encode,
no recolor, no resize. Preserves official channel wiring and color spaces:
  - barrel_03_diff_1k.jpg   -> pbrMetallicRoughness.baseColorTexture (sRGB)
  - barrel_03_nor_gl_1k.jpg -> normalTexture (Non-Color / linear, OpenGL Y+)
  - barrel_03_arm_1k.jpg    -> pbrMetallicRoughness.metallicRoughnessTexture (Non-Color / linear)
    (R=AO, G=Roughness, B=Metalness per Poly Haven ARM packing)

Source: https://polyhaven.com/a/barrel_03
Metadata: https://api.polyhaven.com/info/barrel_03
File list: https://api.polyhaven.com/files/barrel_03
License: CC0 1.0 Universal (https://polyhaven.com/license,
  https://creativecommons.org/publicdomain/zero/1.0/), author Serhii Khromov.

Usage (from worktree root):
  python scripts/assets/import-industrial-barrel.py [--check-only]

Reads scratch downloads from work/industrial-barrel/ (downloads them with
md5 verification if missing), writes public/assets/industrial-barrel/industrial-barrel.glb.
"""
from __future__ import annotations

import copy
import hashlib
import json
import struct
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRATCH = ROOT / "work" / "industrial-barrel"
OUT_DIR = ROOT / "public" / "assets" / "industrial-barrel"
OUT_GLB = OUT_DIR / "industrial-barrel.glb"

# Exact official download URLs (api.polyhaven.com/files/barrel_03, 1k gltf set).
# Note: the 1k gltf's .bin include points at the shared 4k-path .bin (same bytes).
SOURCES = {
    "barrel_03_1k.gltf": (
        "https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/barrel_03/barrel_03_1k.gltf",
        2638,
        "204eec2159a38a1dc4b826ef255f9468",
    ),
    "barrel_03.bin": (
        "https://dl.polyhaven.org/file/ph-assets/Models/gltf/4k/barrel_03/barrel_03.bin",
        44872,
        "6993587e3ef8e0603334e615ab292288",
    ),
    "barrel_03_diff_1k.jpg": (
        "https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/barrel_03/barrel_03_diff_1k.jpg",
        149997,
        "6e77dc1af60c48787fd80dbbcf125040",
    ),
    "barrel_03_nor_gl_1k.jpg": (
        "https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/barrel_03/barrel_03_nor_gl_1k.jpg",
        126707,
        "fd181365eb7397d55773987d145f0420",
    ),
    "barrel_03_arm_1k.jpg": (
        "https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/barrel_03/barrel_03_arm_1k.jpg",
        249922,
        "3520338e30b4d257745db34848098688",
    ),
}

# gltf images[].uri -> scratch file (official bytes embedded untouched).
IMAGE_MAP = [
    ("textures/barrel_03_nor_gl_1k.jpg", "barrel_03_nor_gl_1k.jpg"),
    ("textures/barrel_03_diff_1k.jpg", "barrel_03_diff_1k.jpg"),
    ("textures/barrel_03_arm_1k.jpg", "barrel_03_arm_1k.jpg"),
]


def md5_of(data: bytes) -> str:
    return hashlib.md5(data).hexdigest()


def sha256_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def ensure_inputs() -> dict[str, bytes]:
    SCRATCH.mkdir(parents=True, exist_ok=True)
    blobs: dict[str, bytes] = {}
    for name, (url, exp_size, exp_md5) in SOURCES.items():
        p = SCRATCH / name
        if p.exists():
            data = p.read_bytes()
        else:
            with urllib.request.urlopen(url) as r:
                data = r.read()
            p.write_bytes(data)
        if len(data) != exp_size:
            raise SystemExit(f"FAIL {name}: bytes {len(data)} != official {exp_size}")
        digest = md5_of(data)
        if digest != exp_md5:
            raise SystemExit(f"FAIL {name}: md5 {digest} != official {exp_md5}")
        blobs[name] = data
    return blobs


def jpeg_size(data: bytes) -> tuple[int, int]:
    """CPU-only JPEG dimension parse (SOF marker scan, no decode)."""
    if data[0:2] != b"\xff\xd8":
        raise ValueError("not a JPEG")
    i = 2
    n = len(data)
    while i + 3 < n:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        i += 2
        if marker in (0xD8, 0xD9):
            continue
        if marker == 0x01 or 0xD0 <= marker <= 0xD7:
            continue
        if i + 1 >= n:
            break
        seg_len = (data[i] << 8) + data[i + 1]
        if seg_len < 2:
            raise ValueError("bad JPEG segment")
        # SOF0-SOF3, SOF5-SOF11, SOF13-SOF15 carry dimensions.
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                      0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            h = (data[i + 3] << 8) + data[i + 4]
            w = (data[i + 5] << 8) + data[i + 6]
            return (w, h)
        i += seg_len - 2
    raise ValueError("SOF marker not found")


def pad4(data: bytes, fill: bytes = b"\x00") -> bytes:
    return data + fill * ((4 - (len(data) % 4)) % 4)


def pack_glb(gltf: dict, bin_data: bytes, images: list[bytes]) -> bytes:
    g = copy.deepcopy(gltf)
    # Drop external URIs; BIN chunk becomes buffers[0].
    g["buffers"][0].pop("uri", None)
    # Append one bufferView per embedded image, 4-byte aligned.
    offset = len(bin_data)
    base_view = len(g["bufferViews"])
    for idx, img in enumerate(images):
        g["bufferViews"].append({"buffer": 0, "byteOffset": offset, "byteLength": len(img)})
        offset += len(pad4(img))
    for img_json, view_idx in zip(g["images"], range(base_view, base_view + len(images))):
        img_json.pop("uri", None)
        img_json["bufferView"] = view_idx
    g["buffers"][0]["byteLength"] = offset
    json_bytes = json.dumps(g, separators=(",", ":")).encode("utf-8")
    json_padded = json_bytes + b" " * ((4 - (len(json_bytes) % 4)) % 4)
    bin_chunk = pad4(bin_data) if len(bin_data) % 4 == 0 else pad4(bin_data)
    # bin_data is already a multiple of 4? 44872 % 4 == 0, so pad4 is identity.
    for img in images:
        bin_chunk += pad4(img)
    assert len(bin_chunk) == offset
    total = 12 + 8 + len(json_padded) + 8 + len(bin_chunk)
    header = struct.pack("<III", 0x46546C67, 2, total)
    return header + struct.pack("<II", len(json_padded), 0x4E4F534A) + json_padded + struct.pack("<II", len(bin_chunk), 0x004E4942) + bin_chunk


def main() -> None:
    check_only = "--check-only" in sys.argv[1:]
    blobs = ensure_inputs()
    gltf = json.loads(blobs["barrel_03_1k.gltf"].decode("utf-8"))
    ordered_images = [blobs[scratch] for (_uri, scratch) in IMAGE_MAP]

    # Stats from source gltf (pre-pack, identical post-pack).
    idx_count = next(a["count"] for a in gltf["accessors"] if a["type"] == "SCALAR")
    tris = idx_count // 3
    pos = next(a for a in gltf["accessors"] if a.get("max") and a["type"] == "VEC3")
    dims = [(jpg, jpeg_size(blobs[jpg])) for jpg in
            ("barrel_03_diff_1k.jpg", "barrel_03_nor_gl_1k.jpg", "barrel_03_arm_1k.jpg")]
    total_dl = sum(len(blobs[k]) for k in SOURCES)

    if check_only:
        print(f"inputs_ok total_download_bytes={total_dl} tris={tris} materials={len(gltf['materials'])}")
        return

    glb = pack_glb(gltf, blobs["barrel_03.bin"], ordered_images)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT_GLB.write_bytes(glb)

    # Verify the written GLB by re-reading its JSON chunk.
    magic, version, length = struct.unpack("<III", glb[0:12])
    json_len, json_type = struct.unpack("<II", glb[12:20])
    g2 = json.loads(glb[20:20 + json_len].decode("utf-8"))
    assert magic == 0x46546C67 and version == 2 and length == len(glb)
    assert all("uri" not in b for b in g2["buffers"])
    assert all("uri" not in im for im in g2["images"])
    assert all("bufferView" in im for im in g2["images"])
    idx2 = next(a["count"] for a in g2["accessors"] if a["type"] == "SCALAR")

    print(f"OUT={OUT_GLB.relative_to(ROOT).as_posix()}")
    print(f"glb_bytes={len(glb)} sha256={sha256_of(glb)}")
    print(f"total_download_bytes={total_dl}")
    print(f"triangles={idx2 // 3} materials={len(g2['materials'])} "
          f"meshes={len(g2['meshes'])} primitives={sum(len(m['primitives']) for m in g2['meshes'])}")
    print(f"bbox_min={pos['min']} bbox_max={pos['max']}")
    for name, (w, h) in dims:
        print(f"texture {name}: {w}x{h} JPEG")
    print(f"external_uris=0 buffers_byteLength={g2['buffers'][0]['byteLength']}")


if __name__ == "__main__":
    main()
