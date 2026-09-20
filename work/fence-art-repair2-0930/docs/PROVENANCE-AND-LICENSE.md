# Fence Art Asset Provenance and License Record

This document records the exact provenance and license of the photographic texture assets utilized by the fence course boards lane.

## 1. Asset Identity and Source
- **Asset Name**: Wooden Planks
- **Provider**: Poly Haven (https://polyhaven.com/a/wooden_planks)
- **Declared Dimensions**: 2000 mm × 2000 mm (2 m × 2 m physical surface)
- **License**: Creative Commons 0 (CC0 1.0 Universal Public Domain Dedication)
- **License URL**: https://polyhaven.com/license
- **Authors**:
  - Charlotte Baglioni (Photography)
  - Dario Barresi (Processing)
- **API File Snapshot**: `https://api.polyhaven.com/files/wooden_planks` (cached at `docs/assets/wooden-planks/api-files.json`)

## 2. Pinned File Integrity and Manifest Verification
The files used are the byte-preserved 1024×1024 JPEG maps already imported and verified in `public/assets/wooden-planks/`:

| Map Type | Relative Path | Bytes | MD5 | Color Space |
| :--- | :--- | :--- | :--- | :--- |
| Diffuse (Albedo) | `public/assets/wooden-planks/wooden_planks_diff_1k.jpg` | 489,587 | `045a70f787fcb4b60ee5c9878a9bd674` | sRGB |
| Normal (OpenGL) | `public/assets/wooden-planks/wooden_planks_nor_gl_1k.jpg` | 705,118 | `03206d820a026239db91a1ff3d8c589d` | Linear / OpenGL Y+ |
| Roughness | `public/assets/wooden-planks/wooden_planks_rough_1k.jpg` | 233,217 | `006e1ad8b5a59e783c25b3b36c3a9e9b` | Linear |

- **Total Map Bytes**: 1,427,922 B (well within <= 3,000,000 B intake budget).
- **Zero Asset Duplication**: No files were duplicated or re-imported. The helper reuses existing repository-approved and verified public asset paths.

## 3. UV Mapping & Art Scale
- **Physical Scale**: Uniform art-scale tile of `4.57142857 m` per tile (0.25 m board height across verified 56 px seam-free crop).
- **Canary De-striping**: Per-course golden-ratio U phase shift `(course * 1.6180339887) % 1` and alternating run direction eliminate vertical seam alignment and repeating knots across adjacent stacked courses.
- **End-Grain Treatment**: Board ends at hole openings and boundaries sample a transverse cross-cut slice of the timber texture (perpendicular grain orientation to eliminate longitudinal side-grain stretching across the 6cm end cut), rather than annular rings.
