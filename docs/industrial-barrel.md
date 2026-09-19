# Industrial barrel — Poly Haven barrel_03 (1k glTF set, packed GLB)

Reusable CC0 prop. No visual/game acceptance claimed; root inspects and places.

## Source (verified 2026-09-19, live fetch)

- Asset page: https://polyhaven.com/a/barrel_03 — "Barrel 03", weathered blue
  painted steel drum, author meta `Serhii Khromov`.
- Metadata API: https://api.polyhaven.com/info/barrel_03 — `authors:
  {"Serhii Khromov": "All"}`, `polycount: 1473`, `dimensions:
  [633.943498134613, 638.5995149612427, 930.4736243899824]` (mm),
  `max_resolution: [4096, 4096]`, `description` matches page.
- File API: https://api.polyhaven.com/files/barrel_03 — all URLs/sizes/md5
  below are its `gltf/1k` entries.
- License: https://polyhaven.com/license — all assets CC0
  (https://creativecommons.org/publicdomain/zero/1.0/). Author: Serhii Khromov.
  No attribution required.
- Fallback (NOT used): https://polyhaven.com/a/Barrel_01. Not needed —
  preferred 1k set is 0.55 MB total, 1473 tris, inside every cap.

## Downloaded files (scratch: `work/industrial-barrel/`, 5 files only, no zip sweep)

| File | Official URL | Bytes | md5 (official, matched) | sha256 (measured) |
|---|---|---|---|---|
| `barrel_03_1k.gltf` | https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/barrel_03/barrel_03_1k.gltf | 2638 | `204eec2159a38a1dc4b826ef255f9468` | `80e2faf48b7423bb522b573e459d99c5656a16763285ec8268e957fc7d41f9b8` |
| `barrel_03.bin` | https://dl.polyhaven.org/file/ph-assets/Models/gltf/4k/barrel_03/barrel_03.bin | 44872 | `6993587e3ef8e0603334e615ab292288` | `10f3202e9ac9acf8dd896f1562c64db58311ffef89efb402d8433e03ad486427` |
| `barrel_03_diff_1k.jpg` | https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/barrel_03/barrel_03_diff_1k.jpg | 149997 | `6e77dc1af60c48787fd80dbbcf125040` | `62feb27dfa9a0daf3f323fdc1ddc2d8e4a5996cf2c72fe50197b55c2b9cba7f3` |
| `barrel_03_nor_gl_1k.jpg` | https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/barrel_03/barrel_03_nor_gl_1k.jpg | 126707 | `fd181365eb7397d55773987d145f0420` | `ade97c52985047858a4f38226a9b8a888e3a766ba0434700b4618fb25424c4b6` |
| `barrel_03_arm_1k.jpg` | https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/barrel_03/barrel_03_arm_1k.jpg | 249922 | `3520338e30b4d257745db34848098688` | `2cec2338b36d7322bef55e6a1d0884b223c5ed383cf986a58bfa461478c64c7e` |

Total download: **574136 bytes** (cap 20 MB). All 5 md5s matched the file API.

## Runtime payload (`public/assets/industrial-barrel/industrial-barrel.glb`)

- `glb_bytes=573188`, `sha256=ac47c9c9a377d5911c739338bef0cc8cdd325975a739668cecc21bf78029863b`
  (cap 5 MB — pass).
- `triangles=1473` (4419 indices / 3; 1126 verts), `materials=1`, `meshes=1`,
  `primitives=1` (cap 12k tris / 2 materials — pass).
- Textures (official JPEGs embedded byte-identical, verified per-bufferView):
  `barrel_03_diff_1k.jpg 1024x1024`, `barrel_03_nor_gl_1k.jpg 1024x1024`,
  `barrel_03_arm_1k.jpg 1024x1024`.
- `external_uris=0`, `buffers_byteLength=571504`. Self-contained GLB.
- Channel wiring preserved from official glTF: `normalTexture.index=0`
  (nor_gl), `baseColorTexture.index=1` (diff), `metallicRoughnessTexture.index=2`
  (arm, R=AO/G=Rough/B=Metal). Color spaces preserved by embedding untouched:
  diff is sRGB base color; nor_gl + arm are Non-Color/linear (OpenGL Y+ normal).
  No recolor, no cylinder rebuild.

## Original dimensions / orientation / bounds (documented, unmodified)

- API dimensions (mm): 633.94 x 638.60 x 930.47.
- glTF POSITION accessor: `min=[-0.31697171926498413, -1.1793932941372987e-07,
  -0.31929945945739746]`, `max=[0.3169717788696289, 0.9304735064506531,
  0.3193000555038452]` (metres, Y-up).
- Read: ~0.634 m diameter (x), ~0.639 m depth (z), ~0.930 m tall (y), origin at
  bottom center (y min ~0), upright drum. Pack keeps these bytes and bounds.

## Reproduce

```
python scripts/assets/import-industrial-barrel.py [--check-only]
```

CPU-only stdlib pack: drops external `uri`s, appends 3 image bufferViews
4-byte aligned, concatenates `.bin` + JPEGs into one BIN chunk, writes GLB.
Re-verifies JSON chunk (`magic/version/length`, 0 external URIs, all images
have `bufferView`), prints the stats above. No Blender/GPU/browser/npm/git.

## Files owned by this lane (new only, nothing else touched)

- `public/assets/industrial-barrel/industrial-barrel.glb`
- `docs/industrial-barrel.md` (this file)
- `scripts/assets/import-industrial-barrel.py`
- Scratch: `work/industrial-barrel/` (5 official downloads)
