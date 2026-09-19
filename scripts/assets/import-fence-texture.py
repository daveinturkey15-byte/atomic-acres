#!/usr/bin/env python3
"""Deterministic, idempotent CC0 intake of Poly Haven 'wooden_planks' (1k JPEG).

Lane brief (2026-09-19, fence-texture lane): import ONLY the 1k Diffuse JPEG,
OpenGL normal JPEG and roughness JPEG. Bytes pass through untouched: no image
generation, no transforms of basecolour/normal maps, no recompression.

Determinism / idempotency:
  - Provider metadata is cached at work/fence-texture/api-files.json and reused
    on re-runs (pass --refresh to refetch once). A cached run is fully offline.
  - An existing output file whose md5 matches the provider hash is KEPT, not
    re-downloaded; a mismatched file is replaced (max 2 attempts per file).
  - The manifest is content-derived only: no wall-clock fields, sorted keys,
    stable float rounding -> byte-identical across idempotent re-runs.

Verification per file: provider md5 match, provider byte-size match, decoded
format == JPEG, decoded dimensions == 1024x1024, total bytes <= 3_000_000.

Outputs:
  public/assets/wooden-planks/wooden_planks_diff_1k.jpg
  public/assets/wooden-planks/wooden_planks_nor_gl_1k.jpg
  public/assets/wooden-planks/wooden_planks_rough_1k.jpg
  work/fence-texture/api-files.json    (raw provider /files snapshot, evidence)
  work/fence-texture/manifest.json     (deterministic verification manifest)
"""
from __future__ import annotations

import hashlib
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

ASSET = "wooden_planks"
FILES_API = f"https://api.polyhaven.com/files/{ASSET}"
INFO_API = f"https://api.polyhaven.com/info/{ASSET}"
ASSET_PAGE = f"https://polyhaven.com/a/{ASSET}"
LICENSE_URL = "https://polyhaven.com/license"
PHYSICAL_SIZE_M = 2.0  # info API dimensions [2000, 2000] mm

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "public" / "assets" / "wooden-planks"
WORK_DIR = ROOT / "work" / "fence-texture"

# (API section key, filename stem, sRGB?)
CHANNELS = [
    ("Diffuse", "wooden_planks_diff_1k", True),
    ("nor_gl", "wooden_planks_nor_gl_1k", False),
    ("Rough", "wooden_planks_rough_1k", False),
]
FORMAT_KEY = "jpg"
WANT_DIM = (1024, 1024)
MAX_TOTAL_BYTES = 3_000_000
ATTEMPTS = 2
TIMEOUT_S = 60


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "nuketown-fence-texture-intake/1.0"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
        return r.read()


def load_provider_metadata(refresh: bool) -> tuple[dict, dict]:
    cache = WORK_DIR / "api-files.json"
    info_cache = WORK_DIR / "api-info.json"
    if refresh or not cache.exists() or not info_cache.exists():
        WORK_DIR.mkdir(parents=True, exist_ok=True)
        cache.write_bytes(fetch(FILES_API))
        info_cache.write_bytes(fetch(INFO_API))
    return json.loads(cache.read_text()), json.loads(info_cache.read_text())


def pick_entry(files: dict, section: str) -> tuple[str, dict]:
    node = files.get(section)
    if not isinstance(node, dict):
        raise SystemExit(f"FAIL: API has no '{section}' section; keys={sorted(files)}")
    res = node.get("1k")
    if not isinstance(res, dict):
        raise SystemExit(f"FAIL: API '{section}' has no 1k resolution; keys={sorted(node)}")
    entry = res.get(FORMAT_KEY)
    if not isinstance(entry, dict):
        raise SystemExit(f"FAIL: API '{section}'/1k has no {FORMAT_KEY}; keys={sorted(res)}")
    return entry["url"], entry


def srgb_to_linear(c: np.ndarray) -> np.ndarray:
    c = c.astype(np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def analyse_planks(lum: np.ndarray) -> dict:
    """Seam orientation + dominant plank pitch from luminance gradient energy."""
    gy = float(np.abs(np.diff(lum, axis=0)).sum())
    gx = float(np.abs(np.diff(lum, axis=1)).sum())
    horizontal_seams = gy > gx  # a horizontal seam line is a strong vertical gradient
    profile = np.abs(np.diff(lum, axis=0)).mean(axis=1) if horizontal_seams else \
        np.abs(np.diff(lum, axis=1)).mean(axis=0)
    profile = profile - profile.mean()
    n = profile.size
    spec = np.abs(np.fft.rfft(profile))
    lo, hi = max(2, n // 512), n // 8  # pitch between 8 px and 128 px
    k = int(np.argmax(spec[lo:hi])) + lo
    pitch_px = n / k
    axis = "horizontal" if horizontal_seams else "vertical"
    return {
        "seamAxis": axis,
        "plankLongAxis": "horizontal" if horizontal_seams else "vertical",
        "gradientEnergyRatio": round(gy / gx, 4),
        "plankPitchPx": round(pitch_px, 2),
        "plankCount": round(n / pitch_px, 2),
        "plankPitchMeters": round(pitch_px / WANT_DIM[0] * PHYSICAL_SIZE_M, 4),
        "method": "dominant FFT peak of mean |luminance gradient| along the seam axis",
    }


def analyse_diffuse(img: Image.Image) -> dict:
    a = np.asarray(img.convert("RGB"), dtype=np.float64) / 255.0
    mean_srgb = a.reshape(-1, 3).mean(axis=0)
    mean_lin = srgb_to_linear(mean_srgb)
    lum = 0.2126 * a[:, :, 0] + 0.7152 * a[:, :, 1] + 0.0722 * a[:, :, 2]
    hex_srgb = "#%02x%02x%02x" % tuple(int(round(v * 255)) for v in mean_srgb)
    return {
        "meanSrgb": [round(float(v), 4) for v in mean_srgb],
        "meanSrgbHex": hex_srgb,
        "meanLinear": [round(float(v), 4) for v in mean_lin],
        "warmthRoverBLinear": round(float(mean_lin[0] / max(mean_lin[2], 1e-6)), 3),
        "luminanceMean": round(float(lum.mean()), 4),
        "luminanceP10P50P90": [round(float(np.percentile(lum, p)), 4) for p in (10, 50, 90)],
        "planks": analyse_planks(lum),
    }


def analyse_roughness(img: Image.Image) -> dict:
    a = np.asarray(img.convert("L"), dtype=np.float64) / 255.0
    return {
        "mean": round(float(a.mean()), 4),
        "std": round(float(a.std()), 4),
        "p10P50P90": [round(float(np.percentile(a, p)), 4) for p in (10, 50, 90)],
        "colorSpace": "linear (data map, NoColorSpace)",
    }


def main() -> None:
    refresh = "--refresh" in sys.argv[1:]
    files, info = load_provider_metadata(refresh)

    dims_mm = info.get("dimensions")
    assert dims_mm == [2000, 2000], f"unexpected physical size {dims_mm}"
    authors = sorted(
        ({"name": name, "role": role} for name, role in info.get("authors", {}).items()),
        key=lambda a: a["name"],
    )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    entries, total = [], 0
    for section, stem, is_srgb in CHANNELS:
        url, api = pick_entry(files, section)
        dest = OUT_DIR / f"{stem}.{FORMAT_KEY}"
        data = dest.read_bytes() if dest.exists() and hashlib.md5(dest.read_bytes()).hexdigest() == api["md5"] else None
        if data is None:
            last = None
            for _ in range(ATTEMPTS):
                try:
                    data = fetch(url)
                    if hashlib.md5(data).hexdigest() == api["md5"]:
                        break
                    last = "md5 mismatch after download"
                    data = None
                except OSError as exc:
                    last = str(exc)
                    data = None
            if data is None:
                raise SystemExit(f"FAIL: {section} after {ATTEMPTS} attempts: {last}")
            dest.write_bytes(data)
        img = Image.open(dest)
        img.load()
        ok_fmt = img.format == "JPEG" and img.size == WANT_DIM
        ok_size = len(data) == api["size"]
        if not (ok_fmt and ok_size):
            raise SystemExit(f"FAIL: {dest.name}: format={img.format} size={img.size} bytes={len(data)} api={api['size']}")
        total += len(data)
        entries.append({
            "channel": section,
            "file": f"public/assets/wooden-planks/{dest.name}",
            "sourceUrl": url,
            "providerMd5": api["md5"],
            "md5": hashlib.md5(data).hexdigest(),
            "sha256": hashlib.sha256(data).hexdigest(),
            "bytes": len(data),
            "providerBytes": api["size"],
            "format": img.format,
            "width": img.size[0],
            "height": img.size[1],
            "srgb": is_srgb,
        })

    if total > MAX_TOTAL_BYTES:
        raise SystemExit(f"FAIL: total {total} B exceeds {MAX_TOTAL_BYTES} B budget")

    diff_img = Image.open(OUT_DIR / "wooden_planks_diff_1k.jpg")
    rough_img = Image.open(OUT_DIR / "wooden_planks_rough_1k.jpg")
    manifest = {
        "schema": 1,
        "asset": {
            "id": ASSET,
            "displayName": info.get("name", "Wooden Planks"),
            "sourcePage": ASSET_PAGE,
            "apiFilesEndpoint": FILES_API,
            "apiFilesHash": info.get("files_hash"),
            "providerDimensionsMm": dims_mm,
            "physicalSizeMeters": [PHYSICAL_SIZE_M, PHYSICAL_SIZE_M],
            "description": info.get("description"),
        },
        "authors": authors,
        "license": {
            "name": "CC0 1.0",
            "evidenceUrl": LICENSE_URL,
            "assetPageUrl": ASSET_PAGE,
        },
        "resolution": f"1k {FORMAT_KEY.upper()}",
        "totalBytes": total,
        "budget": {"maxTotalBytes": MAX_TOTAL_BYTES, "withinBudget": True},
        "files": entries,
        "analysis": {
            "diffuse": analyse_diffuse(diff_img),
            "roughness": analyse_roughness(rough_img),
        },
        "integrity": {
            "bytesModified": False,
            "generatedMaps": False,
            "verification": "provider md5 + byte size + JPEG decode + 1024x1024",
        },
    }
    out = WORK_DIR / "manifest.json"
    out.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(f"OK: {len(entries)} files, {total} B total (<={MAX_TOTAL_BYTES})")
    for e in entries:
        print(f"  {e['file']}: {e['bytes']} B md5={e['md5']} {e['format']} {e['width']}x{e['height']}")
    print(f"manifest: {out}")


if __name__ == "__main__":
    main()
