# Operator Sand texture repair — source-only handoff (2026-09-20)

## Root run (Blender 5.1, CPU, 2 threads, 2 GiB — same caps as frozen recipe)

```powershell
"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --python scripts/blender/build_operator_sand_texture_repair.py
node scripts/assets/verify-operator-sand.mjs work/operator-sand-texture-repair/operator-sand.glb
node scripts/assets/verify-operator-sand-texture-content.mjs work/operator-sand-texture-repair/operator-sand.glb
```

Both validators must pass. The old structural validator is untouched and still
owns structure; the new content validator owns pixels.

## Concrete cause (matches root PIL evidence: 3 embedded PNGs RGB means 0,0,0)

`scripts/blender/build_operator_sand.py:1009-1020` writes all three images with
`pixels.foreach_set(...)` but never calls `img.update()` + `img.pack()`. The
buffer stays unflushed/unpacked, so the glTF exporter embeds solid-black PNGs —
black albedo + G=0 roughness plastic. The in-repo precedent
`scripts/blender/common.py:make_image/fill_image` does fill → `update()` →
`pack()`; the operator recipe bypassed it.

## What changed (2 new files, frozen lane untouched)

- `scripts/blender/build_operator_sand_texture_repair.py` — byte-copy of the
  frozen recipe except: `OUT_DIR → work/operator-sand-texture-repair`, and the
  texture block now sets `file_format`+`colorspace` BEFORE the fill, commits
  every image with `update()` then `pack()` (asserts packed), and asserts
  strided buffer stats pre-export (cloth/gear mid-tone + varied, ORM R=1.0 /
  G-zoned / B=0). Geometry, skeleton, weights, UVs, material slots, SEED 2256
  identical. Frozen `build_operator_sand.py`, `work/operator-sand/*`,
  `verify-operator-sand.mjs`, runtime loader untouched.
- `scripts/assets/verify-operator-sand-texture-content.mjs` — pure-node (only
  `node:zlib`), dependency-free PNG decoder (8-bit RGB/RGBA, all 5 filters);
  fails closed on the known-black originals (mean RGB < 8), constant fills,
  wrong dims, ORM without roughness zones (G span ≤ 30) or metallic B > 15.

## Evidence (author lane, no Blender/GPU/browser/build)

- Real `paint_*` output (pure-Python import): cloth mean (0.742,0.652,0.521),
  gear (0.291,0.276,0.239), ORM (1.000,0.739,0.000) G-span 0.35 — all inside
  the recipe pre-export assert bands; all-black (0,0,0) fails them.
- Guard self-test (synthetic GLBs, all PNG filter types): good pixels PASS,
  black cloth REJECTED (`known-black`), flat ORM REJECTED (`rough-varied`).

## Hero lane (readonly, per brief — not touched)

Recovery `scripts/blender/build_roster_heroes.py:596-599` does
`foreach_set` + `pack()` with NO `update()`, BUT then `filepath_raw` + `save()`
to `work/` PNGs before export — the save flushes the buffer, so hero embedded
PNGs are most likely NOT all-black. Latent risk only: recommend prop lane add
`img.update()` before `img.pack()` there too.
