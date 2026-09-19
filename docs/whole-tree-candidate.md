# Whole-tree candidate feasibility

Metadata-only review performed 2026-09-19 against the official Poly Haven API. No
`.bin`, texture, GLTF package, or other large asset was downloaded. The small GLTF
JSON descriptors were read only to count materials, images, and primitives.

The proposed budget is for **two hero tree instances together**: at most 80,000
added triangles, 10 draw calls, and 20,000,000 downloaded bytes. Source triangle
counts are the official asset metadata counts. The package byte count below is one
cached download: the 1k GLTF descriptor plus every file listed in that descriptor's
official `include` map. Two cloned instances render twice the source geometry, but
share that one downloaded package. Draws are conservatively counted as two times the
GLTF primitive count; instancing could reduce draw calls further.

The current procedural canary is 19,760 triangles in five static draws across ten
placements. The local tree source is only the four existing leaf maps under
`public/textures/vegetation`; it is not a whole-tree model.

## Baseline: Island Tree 01

Primary records: [asset page](https://polyhaven.com/a/island_tree_01),
[info API](https://api.polyhaven.com/info/island_tree_01),
[files API](https://api.polyhaven.com/files/island_tree_01), and
[CC0 license](https://polyhaven.com/license).

| Measure | Official 1k GLTF metadata |
| --- | ---: |
| source triangles | 3,729,692 |
| source dimensions | 12,464.4196 × 4,818.5067 × 5,027.4466 API units |
| package bytes | 66,337,268 |
| materials / primitives / images | 3 / 3 / 9 |
| two-tree triangles / shared package bytes / draws | 7,459,384 / 66,337,268 / 6 |
| API file hash | `29bbda3fd0ebe9974d015ba2a9d939525eb6811b` |

The nine 1k map options are trunk `diff`, `nor_gl`, `arm`; leaves `diff`,
`nor_gl`, `arm`; and branches `diff`, `nor_gl`, `arm`. The three GLTF material
names are `island_tree_01`, `island_tree_01_leaves`, and
`island_tree_01_branches`.

**Viability: NO as a whole-tree replacement.** It exceeds the two-tree triangle
budget by 93.2× and the download budget by 3.3× before any integration work. The
existing repo leaf maps do not change the 60,709,812-byte source binary.

## Candidate A: Island Tree 02

Primary records: [asset page](https://polyhaven.com/a/island_tree_02),
[info API](https://api.polyhaven.com/info/island_tree_02),
[files API](https://api.polyhaven.com/files/island_tree_02), and
[CC0 license](https://polyhaven.com/license).

| Measure | Official 1k GLTF metadata |
| --- | ---: |
| source triangles | 1,762,064 |
| source dimensions | 8,485.5132 × 4,078.6155 × 3,408.9039 API units |
| package bytes | 46,172,406 |
| materials / primitives / images | 3 / 3 / 9 |
| two-tree triangles / shared package bytes / draws | 3,524,128 / 46,172,406 / 6 |
| API file hash | `4292954a33702fc0809a2b2f17a310bb36fd1aca` |

The nine map options are trunk `diff`, `nor_gl`, `arm`; leaves `diff`, `nor_gl`,
`arm`; and branches `diff`, `nor_gl`, `arm`. The GLTF material names are
`island_tree_02`, `island_tree_02_leaves`, and `island_tree_02_branches`.

The API reports identical 1k JPEG payload hashes for the three leaf maps used by
Island Tree 01 and 02: leaf diffuse `1356cbb5a5dd1318f9f2a01eddbf03e`, leaf
normal `a08ffb98b5ffb7dfa682e05a1639c642`, and leaf ARM `27b06c4a53ff115ed7d51ee94e417257`.
That is the strongest source-reuse option in this pass, although the repository's
existing files are PNG leaf channels with their own recorded hashes and would need
an explicit material/import decision.

**Viability: NO under the stated budget.** It is closer in appearance and reuses the
existing Poly Haven leaf family, but two unmodified instances exceed the triangle
budget by 44.1× and the shared download budget by 2.3×. A heavily decimated, re-exported
variant would be a new asset requiring fresh measured metadata; this note does not
claim that such a variant exists.

## Candidate B: Quiver Tree 02

Primary records: [asset page](https://polyhaven.com/a/quiver_tree_02),
[info API](https://api.polyhaven.com/info/quiver_tree_02),
[files API](https://api.polyhaven.com/files/quiver_tree_02), and
[CC0 license](https://polyhaven.com/license).

| Measure | Official 1k GLTF metadata |
| --- | ---: |
| source triangles | 153,887 |
| source dimensions | 872.0614 × 880.8198 × 1,468.8802 API units |
| package bytes | 4,547,871 |
| materials / primitives / images | 1 / 1 / 3 |
| two-tree triangles / shared package bytes / draws | 307,774 / 4,547,871 / 2 |
| API file hash | `0587f20a8675f71008bafe89b42256c1ffda2cf7` |

The three 1k map options are `diff`, `nor_gl`, and `arm`, on one material named
`quiver_tree_02`. It does not share the Island Tree leaf map payloads; the model is
a different succulent asset and has no existing local whole-tree source record.

**Viability: CONDITIONAL only after a new decimation/export pass.** The package and
draw budgets pass for two copies, but the source triangles fail by 3.85×. Each hero
tree would need to be measured at 40,000 triangles or fewer, a reduction of at least
74.0% from the official source count, while preserving the silhouette. Until that
variant is authored and measured, this is not a drop-in candidate and no runtime
change is authorized.

## Decision

No inspected whole-tree asset is an unconditional fit for two hero trees under the
80,000-triangle and 20 MB limits. Island Tree 02 is the best texture-family match
but fails both hard budgets. Quiver Tree 02 is the only practical conditional path:
decimate it to a measured maximum of 40,000 triangles per hero, keep one material and
one primitive, and record the resulting package bytes before root considers an import.
The current procedural canary remains the measured runtime baseline until that
separate asset pass exists.

## Reproduction URLs and measurement notes

- Asset index used to identify whole-tree candidates: [Poly Haven assets API](https://api.polyhaven.com/assets). The review filtered `type: 2` models in `Nature/Trees`; stumps and shrubs were excluded because they are not whole trees.
- `info/{slug}` supplied the source polycount, dimensions, categories, and `files_hash`.
- `files/{slug}` supplied the official 1k GLTF URL, included binary/map sizes, and map MD5s.
- The 1k GLTF JSON descriptors supplied the material, image, and primitive counts. No downloaded package or runtime asset was created.
