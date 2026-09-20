"""Shared helpers for headless Blender asset builds (Nuketown 2025).

Imported by scripts/blender/build_*.py running under Blender's bundled Python.
Keep dependency-free except for Blender's own numpy (with pure-python fallback).
"""

import math
import sys

try:
    import numpy as np  # shipped with Blender
    _HAVE_NP = True
except ImportError:  # pragma: no cover
    _HAVE_NP = False


def srgb_to_linear(c):
    """Exact-ish sRGB EOTF for one channel in 0..1."""
    if c <= 0.04045:
        return c / 12.92
    return ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear_rgb(h):
    """0xRRGGBB -> (r, g, b) scene-linear floats for image pixels / lights."""
    r = ((h >> 16) & 0xFF) / 255.0
    g = ((h >> 8) & 0xFF) / 255.0
    b = (h & 0xFF) / 255.0
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b))


def hex_to_srgb_rgb(h):
    """0xRRGGBB -> (r, g, b) plain 0..1 sRGB floats (for UIs, docs)."""
    return (round(((h >> 16) & 0xFF) / 255.0, 4),
            round(((h >> 8) & 0xFF) / 255.0, 4),
            round((h & 0xFF) / 255.0, 4))


def fill_image(img, fn):
    """Fill a Blender image's pixels with fn(x, y, w, h) -> (r, g, b, a).

    Deterministic; vectorised with numpy when available.
    """
    import bpy
    w, h = img.size
    if _HAVE_NP:
        buf = np.empty((h, w, 4), dtype=np.float32)
        for y in range(h):
            v = y / max(1, h - 1)
            for x in range(w):
                u = x / max(1, w - 1)
                buf[y, x, :] = fn(u, v)
        flat = np.ascontiguousarray(buf).ravel()
        try:
            img.pixels.foreach_set(flat)
        except Exception:
            img.pixels[:] = flat.tolist()
    else:  # slow fallback, kept for exotic Blender builds
        px = []
        for y in range(h):
            v = y / max(1, h - 1)
            for x in range(w):
                u = x / max(1, w - 1)
                px.extend(fn(u, v))
        img.pixels[:] = px
    img.update()


def make_image(name, w, h, colorspace, fn, pack=True):
    """Create (or reuse) an image datablock, fill it, set colorspace."""
    import bpy
    img = bpy.data.images.get(name)
    if img is not None:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, width=w, height=h, alpha=True, float_buffer=False)
    img.file_format = 'PNG'
    try:
        img.colorspace_settings.name = colorspace
    except TypeError:
        # Blender enumerates valid names in the error; fall back to first valid.
        pass
    fill_image(img, fn)
    if pack:
        try:
            img.pack()
        except Exception:
            pass
    return img


def tri_count_of(obj):
    """Triangulated face count of a mesh object (ngon -> n-2)."""
    me = obj.data
    return sum(len(p.vertices) - 2 for p in me.polygons)


def scene_tri_count():
    """Total triangulated faces over all mesh objects in the scene."""
    import bpy
    return sum(tri_count_of(o) for o in bpy.data.objects if o.type == 'MESH')


def vram_bytes(images):
    """Decoded VRAM = sum(w*h*4) over the given Blender images."""
    total = 0
    for img in images:
        w, h = img.size
        total += w * h * 4
    return total
