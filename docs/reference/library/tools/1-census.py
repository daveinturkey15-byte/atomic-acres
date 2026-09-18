"""Mechanical census of the Atomic Acres reference corpus.

Verifies every image decodes, records dimensions, and computes cheap features
used to shortlist candidate hero frames (flash, interior, sky, detail).
Writes census.json next to itself. Read-only on the repo.
"""
import json, os, sys, math
from PIL import Image
import numpy as np

ROOT = r"C:\Users\david\Desktop\stuff\nuketown\docs\reference"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "census.json")

rows = []
bad = []

def feats(path):
    im = Image.open(path)
    w, h = im.size
    fmt = im.format
    im = im.convert("RGB")
    small = im.resize((160, max(1, int(160 * h / w))), Image.BILINEAR)
    a = np.asarray(small).astype(np.float32) / 255.0
    H, W, _ = a.shape
    lum = 0.2126 * a[:, :, 0] + 0.7152 * a[:, :, 1] + 0.0722 * a[:, :, 2]
    mx = a.max(axis=2); mn = a.min(axis=2)
    sat = np.where(mx > 1e-5, (mx - mn) / np.maximum(mx, 1e-5), 0.0)
    warm = a[:, :, 0] - a[:, :, 2]
    top = lum[: H // 4]
    blue = (a[: H // 4, :, 2] - a[: H // 4, :, 0])
    sky = float(((top > 0.45) & (blue > 0.02)).mean())
    # flash: hot warm pixels anywhere (muzzle flash / tracer / explosion)
    hot = ((lum > 0.85) & (warm > 0.10))
    flash = float(hot.mean())
    # local contrast as a rough detail proxy
    gy = np.abs(np.diff(lum, axis=0)).mean()
    gx = np.abs(np.diff(lum, axis=1)).mean()
    return dict(w=w, h=h, fmt=fmt,
                mean_l=round(float(lum.mean()), 4),
                p05=round(float(np.percentile(lum, 5)), 4),
                p95=round(float(np.percentile(lum, 95)), 4),
                sat=round(float(sat.mean()), 4),
                sky=round(sky, 4),
                flash=round(flash, 5),
                detail=round(float(gx + gy), 4))

for dirpath, dirnames, filenames in os.walk(ROOT):
    if os.path.basename(dirpath) == "library":
        continue
    for fn in sorted(filenames):
        ext = os.path.splitext(fn)[1].lower()
        if ext not in (".jpg", ".jpeg", ".png", ".webp"):
            continue
        p = os.path.join(dirpath, fn)
        rel = os.path.relpath(p, ROOT).replace("\\", "/")
        try:
            f = feats(p)
        except Exception as e:
            bad.append({"rel": rel, "err": str(e), "bytes": os.path.getsize(p)})
            continue
        f["rel"] = rel
        f["bytes"] = os.path.getsize(p)
        rows.append(f)

json.dump({"rows": rows, "bad": bad}, open(OUT, "w"), indent=0)
print("ok", len(rows), "bad", len(bad))
by = {}
for r in rows:
    d = r["rel"].split("/")[0]
    by.setdefault(d, []).append(r)
for d, rs in sorted(by.items()):
    dims = {}
    for r in rs:
        dims["%dx%d" % (r["w"], r["h"])] = dims.get("%dx%d" % (r["w"], r["h"]), 0) + 1
    print("%-12s %5d  %s" % (d, len(rs), ", ".join("%s:%d" % kv for kv in sorted(dims.items(), key=lambda x: -x[1])[:4])))
for b in bad:
    print("BAD", b)
