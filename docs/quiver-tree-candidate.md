# Quiver Tree 02 — Poly Haven Candidate (1k glTF, Decimated GLB)

Candidate asset conversion for standalone Nuketown hero desert trees.
No visual or game acceptance claimed; root handles actual-game screenshots and placement.

## Primary Sources (verified 2026-09-19)

- Asset page: https://polyhaven.com/a/quiver_tree_02 — "Quiver Tree 02", desert succulent tree.
- Metadata API: https://api.polyhaven.com/info/quiver_tree_02 — `authors: {"Dario Barresi": "photography", "Rico Cilliers": "modeling"}`, `polycount: 153887`, `dimensions: [872.0614, 880.8198, 1468.8802]` (mm), `categories: ["nature", "trees"]`.
- File API: https://api.polyhaven.com/files/quiver_tree_02 — all official URLs, sizes, and MD5s below correspond to the official `gltf/1k` release.
- License: https://polyhaven.com/license — CC0 1.0 Universal (https://creativecommons.org/publicdomain/zero/1.0/). Authors: Dario Barresi, Rico Cilliers. Dedicated to the public domain.

## Downloaded Files (scratch: `work/quiver-tree/source/`, 5 official files, no huge variants)

| File | Official URL | Bytes | md5 (official, matched) | sha256 (measured) |
|---|---|---|---|---|
| `quiver_tree_02_1k.gltf` | https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/quiver_tree_02/quiver_tree_02_1k.gltf | 2809 | `1002e67d6921204df06b9a97f4f30cff` | `c92ea2f60defaa9c134f43ac606bb7564ade348f92b546ba91c87bc6365d1a56` |
| `quiver_tree_02.bin` | https://dl.polyhaven.org/file/ph-assets/Models/gltf/8k/quiver_tree_02/quiver_tree_02.bin | 2060604 | `63635d61c58151eb4fb0b2caaf6b373c` | `fd3598b4aea34bc6864452d2dbb37a04e4bfa7ad1ab6062a3b97c485fae258f3` |
| `textures/quiver_tree_02_diff_1k.jpg` | https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/quiver_tree_02/quiver_tree_02_diff_1k.jpg | 736321 | `7f14325c48fc30112476b851d7e05232` | `546a745ad765529d3c310178321e145909f4817b06679788ad24d29ec7eae7b7` |
| `textures/quiver_tree_02_nor_gl_1k.jpg` | https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/quiver_tree_02/quiver_tree_02_nor_gl_1k.jpg | 988408 | `5ddb37eb256e324a0929e465d429f5a7` | `5073a1d9563331d8a7bc57a36cae9f1d1d69470395be0c460a12c57026b5f1f0` |
| `textures/quiver_tree_02_arm_1k.jpg` | https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/quiver_tree_02/quiver_tree_02_arm_1k.jpg | 759729 | `36d19d0ef3d38ed92c557d9eb2203302` | `5d12b154c534503b68766dca96f6486fa0faeb22734b300c58ede695deb2915e` |

Total download package: **4,547,871 bytes** (~4.34 MiB / ~4.55 MB). All 5 MD5s matched the official API payload.

## Blender CPU Decimation Pass

- Executable: `C:/Program Files/Blender Foundation/Blender 5.1/blender.exe`
- Command: `blender.exe --background --threads 2 --python scripts/blender/prepare_quiver_tree.py`
- Execution: Python subprocess with `CREATE_NO_WINDOW`, 2 CPU threads, no GPU rendering, no ML/inference.
- Source mesh: `tree_small_25m` (49,005 vertices, 82,074 triangles imported from 1k glTF).
- Decimation attempts (max 2 allowed):
  - **Attempt 1**: ratio `0.456905` targeted 37,500 triangles. Resulted in exactly **37,500 triangles** (passed on attempt 1, 0 remaining attempts needed).
  - Triangle budget check: 37,500 <= 38,000 triangles per hero instance (**PASS**).
  - Two hero instances: 75,000 triangles <= 76,000 cap (**PASS**).
- Origin and alignment:
  - Centered XZ: X bounds `[-0.435982, +0.435982]` (center 0.0), Z bounds `[-0.440245, +0.440245]` (center 0.0).
  - Foot Y: Y min `0.000000`, Y max `1.468861`.
  - Measured height: **1.468861 m** (~1.47 m, preserved from source geometry without blind scaling).
- Editable work file (retained outside public):
  - `work/quiver-tree/quiver_tree_02.blend` (saved before GLB export).

## Runtime Payload (`public/assets/quiver-tree/quiver-tree.glb`)

- File size: **3,526,860 bytes** (~3.36 MiB / ~3.53 MB <= 8 MB cap — **PASS**).
- SHA256: `2d65c167548c1d4d47d56ae457516cc074bc18a5fb22d67ac03604f2fe6c546e`.
- Topology:
  - Triangles: **37,500** (indices count 112,500 / 3).
  - Vertices: **25,488**.
  - Meshes: 1 (`tree_small_25m`).
  - Primitives: 1 (`POSITION`, `NORMAL`, `TEXCOORD_0`).
  - Materials: 1 (`quiver_tree_02`).
  - Draw calls: 1 draw per tree instance (2 draws for two trees <= 10 cap — **PASS**).
- Material wiring & color spaces:
  - Single material `quiver_tree_02` with PBR Metallic-Roughness.
  - `baseColorTexture`: `quiver_tree_02_diff_1k.jpg` (sRGB).
  - `normalTexture`: `quiver_tree_02_nor_gl_1k.jpg` (Non-Color / linear, OpenGL Y+).
  - `metallicRoughnessTexture`: `quiver_tree_02_arm_1k.jpg` (Non-Color / linear, R=AO, G=Roughness, B=Metallic).
  - `metallicFactor`: 0.
  - `doubleSided`: true.
- Embedded textures:
  - All 3 official 1k JPEGs embedded untouched into the binary GLB chunk.
  - BufferView MD5 verification:
    - Normal (`quiver_tree_02_nor_gl_1k.jpg`): 988,408 bytes, MD5 `5ddb37eb256e324a0929e465d429f5a7` (byte-identical).
    - Diffuse (`quiver_tree_02_diff_1k.jpg`): 736,321 bytes, MD5 `7f14325c48fc30112476b851d7e05232` (byte-identical).
    - ARM (`quiver_tree_02_arm_1k.jpg`): 759,729 bytes, MD5 `36d19d0ef3d38ed92c557d9eb2203302` (byte-identical).
  - Zero texture reauthoring, zero recompression.
- Shipped filename:
  - `public/assets/quiver-tree/quiver-tree.glb` (the only Quiver Tree GLB retained in the recovery tree).
  - The converter's source-name alias output `quiver_tree_02.glb` is intentionally absent and is not shipped.

## Measured Limits Summary vs Candidate Budget

| Criterion | Target / Budget | Measured Quiver Tree 02 | Status |
|---|---|---|---|
| Single Tree Triangles | <= 38,000 | 37,500 | PASS |
| Two Instances Triangles | <= 76,000 | 75,000 | PASS |
| Material Count | 1 material | 1 (`quiver_tree_02`) | PASS |
| Primitive Count | 1 primitive | 1 (`tree_small_25m`) | PASS |
| Draws for 2 Instances | <= 10 draws | 2 draws | PASS |
| GLB Payload Size | <= 8,000,000 bytes | 3,526,860 bytes | PASS |
| Package Download Size | <= 20,000,000 bytes | 4,547,871 bytes | PASS |
| Centering & Foot Origin | Centered XZ, foot Y=0 | X: ±0.436m, Z: ±0.440m, Y min: 0.000m | PASS |
| Measured Height | ~1.47 m | 1.468861 m | PASS |
| UV & Color-Space | Preserved (sRGB diff, Non-Color norm/ARM) | Preserved byte-identical | PASS |
| Decimation Attempts | At most 2 attempts | 1 attempt (ratio 0.456905) | PASS |
| Texture Reauthoring | None | None (official JPEGs embedded) | PASS |

## Silhouette & Runtime Inspection Notes

- The source mesh was decimated from 82,074 triangles down to 37,500 triangles (~54.3% reduction of the 1k glTF geometry).
- Main trunk, succulent leaf crowns, and primary fork geometry remain intact.
- Whether the reduced leaf cluster density and silhouette hold up under close player scrutiny or direct sunlight in the Nuketown yard requires runtime inspection by root.
- Root handles actual-game placement and screenshots; this pass makes no visual photorealism or acceptance claims.

## Reproduction Commands

From worktree root (`C:/Users/david/Desktop/stuff/worktrees/nuketown-agy-desert-tree-20260919`):

```bash
# Check downloads without running Blender
python scripts/assets/import-quiver-tree.py --check-only

# Full reproducible pipeline (download + Blender CPU conversion + audit)
python scripts/assets/import-quiver-tree.py

# Direct Blender invocation
& "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --threads 2 --python scripts/blender/prepare_quiver_tree.py
```

## Files Owned by this Task

- `scripts/assets/import-quiver-tree.py`
- `scripts/blender/prepare_quiver_tree.py`
- `public/assets/quiver-tree/quiver-tree.glb`
- `docs/quiver-tree-candidate.md`
- Scratch: `work/quiver-tree/source/` (5 official files) and `work/quiver-tree/quiver_tree_02.blend`
