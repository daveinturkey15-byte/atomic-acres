# Tree canary

Correction 3 adds compact, softly deformed interior crown volumes after the
dense-card capture still read as sparse at the yard distance. The previous
alpha silhouettes remain in place; the new volumes provide continuous leaf mass
under them without increasing card density.

Correction 2 replaced the sparse, oversized leaf shapes rejected in the
`captures/leaf-cards-noon/yardWhite.png` review with dense original procedural
broadleaf crowns made from instanced alpha-tested cards. The first card pass was
rejected because it exposed branches and left only a handful of giant leaves.
The presentation module is [vegetation-tree.ts](../src/build/vegetation-tree.ts);
[yards.ts](../src/build/yards.ts) still owns the ten placements and gameplay
colliders. The target reference is `docs/reference/refinement-targets/yard-white.png`:
its trees read as layered, irregular foliage with visible twig structure rather
than small faceted bonsai crowns.

The authored positions and deterministic values are unchanged:

| tree | x | z |
| --- | ---: | ---: |
| orange rear 1 | -9.760 | -39.600 |
| orange rear 2 | 0.488 | -40.400 |
| orange rear 3 | 9.760 | -39.200 |
| white rear 1 | -8.296 | 40.000 |
| white rear 2 | 1.952 | 39.300 |
| white rear 3 | 10.492 | 40.600 |
| orange front 1 | 8.640 | -10.528 |
| orange front 2 | -3.520 | -12.040 |
| white front 1 | -8.640 | 10.528 |
| white front 2 | 3.520 | 12.040 |

`yards.ts` consumes the same deterministic values for each tree's scale, height,
trunk radius, canopy radius and three branch descriptors. It pushes the original
collider expression unchanged: `aabbSlab(x, 0, z, tr * 2.6, th, tr * 2.6)`.
The canary has no gameplay authority and does not change cover paths.

Each tree is built from five static `InstancedMesh` draws shared by all ten trees:

- tapered eight-sided trunk;
- eight-sided root flare;
- three angled six-sided tapered branches per tree;
- three overlapping branch-led interior crown lobes per tree, using one shared
  perturbed `SphereGeometry(0.5, 8, 6)` with smooth recomputed normals;
- 100 small volume leaf-card clusters per tree, each containing four curved atlas
  blades with deterministic rotation, scale and branch-relative placement.

The leaf cards use the explicit Poly Haven `island_tree_01` leaf atlas with its
diffuse, alpha, tangent-normal and roughness maps. The material is a singleton
`MeshStandardNodeMaterial` with `alphaTest = 0.42`, `transparent = false`,
`depthWrite = true`, `DoubleSide`, `forceSinglePass = true`, and shadow casting
enabled on the instanced mesh. This keeps cutout silhouettes in the shadow pass
without blended foliage overdraw. No per-frame CPU work, subscriptions or lights
were added.

## Measured static cost

The canary emits 19,760 world triangles: 320 trunk, 320 root flare, 720 branches,
2,400 interior-lobe triangles and 16,000 leaf-card triangles. It adds five static
scene draws, with 10 trunks, 10 root flares, 30 branches, 30 interior lobes,
1,000 leaf clusters and 4,000 individual leaf blades. Every individual leaf is
approximately 0.15–0.26 m tall before the shared atlas geometry's local bend;
the interior lobes are shared 80-triangle geometry and are not perfect spheres.
This is the final bounded tree correction; no further blind density increase is
planned under the 20,000-triangle budget.
The four local leaf maps total 5,462,812 bytes. The `vegetationStats` object is
attached to `vegetation-tree-canary` for root-side capture review.

## CC0 texture provenance

The maps are local copies of the 1k leaf channels from
[Poly Haven island_tree_01](https://polyhaven.com/a/island_tree_01), licensed under
[CC0 1.0](https://polyhaven.com/license). The source API response is
`https://api.polyhaven.com/files/island_tree_01`; exact bytes and SHA-256 values
are recorded in [public/textures/vegetation/manifest.json](../public/textures/vegetation/manifest.json).

| map | bytes | SHA-256 |
| --- | ---: | --- |
| `island_tree_01_leaves_diff_1k.png` | 1,638,916 | `63d3563a22a62151f338ceb4e992de7c31b62e8e3582e2762d5071f02d286349` |
| `island_tree_01_leaves_alpha_1k.png` | 57,438 | `f4341f147988dbe6b58d9ca841a8f0e4bcff25bc40d05f9877da82006d489c39` |
| `island_tree_01_leaves_nor_gl_1k.png` | 2,886,859 | `e58402f30c7108ec6321e0c689009508f6ab138c81612d9a67238038ac108211` |
| `island_tree_01_leaves_rough_1k.png` | 879,599 | `b7e9a1857f63617344968bb43693786bfed7dd15bedca3193ce333f233fbab78` |

## Root material integration patch

The tree builder accepts an optional `leafCards` material so this lane stays
compatible with the current fallback. Root should wire the new factory once in
the shared material library and pass the singleton to the tree call:

```ts
import { createVegetationMaterials } from './vegetation-materials';

// inside buildMaterials(), alongside the other singleton materials:
const vegetation = createVegetationMaterials();
// add `leafCards: vegetation.leafCards` to MaterialLibrary and call
// `vegetation.dispose()` from the library's existing dispose path.

// in the yards tree section:
buildVegetationTrees({
  bark: mat.bark,
  leaf: mat.leaf,
  leafCards: mat.leafCards,
}, treeSpecs);
```

Until that root wiring and an actual noon/golden capture are complete, this is a
code and asset canary. Browser, GPU and visual acceptance remain root-owned.
