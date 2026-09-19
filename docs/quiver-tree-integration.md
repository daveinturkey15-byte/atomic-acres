# Quiver Tree 02 integration canary

Status: **source and CPU integration ready; runtime visual/traversal acceptance is OPEN.**
Root owns preload wiring, browser capture, route checks, and the final admission decision.

## Asset audit

The candidate was authored in the AGY worktree
`C:/Users/david/Desktop/stuff/worktrees/nuketown-agy-desert-tree-20260919` and the
GLB is present in the recovery tree at `public/assets/quiver-tree/quiver-tree.glb`.
The source is Poly Haven's official [Quiver Tree 02 page](https://polyhaven.com/a/quiver_tree_02),
licensed [CC0](https://polyhaven.com/license). The editable Blender conversion and
download receipt remain in the AGY worktree; this integration adds no model download.

Source-artifact SHA-256 anchors from that worktree:

- `docs/quiver-tree-candidate.md`: `8382bbb08d62dc664de090eb424c0d2b2695b97fa81fe6743e97a9992271e2a6`
- `scripts/assets/import-quiver-tree.py`: `35e70b7dc06c3b861480149164e7905bb0fc63680574e886bc0bc7d234362d5d`
- `scripts/blender/prepare_quiver_tree.py`: `331398cadc09799b0747563daa18ec1250f4ce574edc517b5c984b7fe84f353a`
- `public/assets/quiver-tree/quiver-tree.glb`: `2d65c167548c1d4d47d56ae457516cc074bc18a5fb22d67ac03604f2fe6c546e`

Independent GLB audit, 2026-09-19:

| Field | Measured value |
|---|---:|
| Payload | 3,526,860 bytes |
| SHA-256 | `2d65c167548c1d4d47d56ae457516cc074bc18a5fb22d67ac03604f2fe6c546e` |
| GLB version | 2 |
| Scene nodes | 1 (`quiver_tree_02`, mesh 0) |
| Mesh / primitive | 1 / 1 (`tree_small_25m`) |
| Indexed triangles | 37,500 (112,500 indices) |
| Position vertices | 25,488 |
| Materials | 1 (`quiver_tree_02`, double-sided PBR) |
| Scene node transform | identity matrix; no hidden scale or rotation |
| Scene-local bounds | x `[-0.4359820783, 0.4359820783]`, y `[0, 1.4688606262]`, z `[-0.4402450323, 0.4402450323]` m |
| Scene-local size | `0.8719641566 x 1.4688606262 x 0.8804900646` m |
| Embedded images | 3 official 1k JPEGs, 2,484,458 bytes total |

The embedded image SHA-256 values are:

- normal/OpenGL Y+: `5073a1d9563331d8a7bc57a36cae9f1d1d69470395be0c460a12c57026b5f1f0`
- diffuse/base color: `546a745ad765529d3c310178321e145909f4817b06679788ad24d29ec7eae7b7`
- ARM (R=AO, G=roughness, B=metalness): `5d12b154c534503b68766cda96f6486fa0faeb22734b300c58ede695deb2915e`

Only `public/assets/quiver-tree/quiver-tree.glb` is shipped. The converter's
source-name alias output `quiver_tree_02.glb` is intentionally absent and is not
part of the runtime or asset-library record. The material wiring remains in the GLB:
diffuse is the base-color texture,
normal is a normal texture, and ARM is the metallic-roughness texture with a
zero metallic factor. No texture reauthoring or color-space conversion occurs
in the loader. The source conversion's measured authoring bounds were the same
as the independent decoded bounds above.

## Runtime API

`src/props/quiver-tree.ts` owns one decoded master and exposes:

- `preloadQuiverTree()` — start/await the one shared decode before synchronous world builders run.
- `loadQuiverTree()` / `getQuiverTree()` — obtain clones sharing geometry/materials/textures.
- `disposeQuiverTree()` — invalidate pending work and dispose the master after all scene clones are removed.

The loader does no scene, renderer, camera, collider, subscription, or frame-loop
work. It preserves the GLTF scene hierarchy and sets decoded meshes to cast and
receive shadows. Disposal uses a generation token, so a late decode after
disposal is cleaned up and rejected rather than becoming an orphaned cache.

## Builder and budget

`src/build/desert-trees.ts` emits exactly two candidate placements:

| Name | x | z | yaw |
|---|---:|---:|---:|
| `quiver-tree-white-yard` | -3.00 | 34.00 | 0.0 |
| `quiver-tree-orange-yard` | 6.25 | -34.00 | 1.4 |

Both sit at `KERB_HEIGHT + 0.001` (`y=0.151`) and keep the authored native
scale. One `InstancedMesh` reuses the GLB's one geometry/material, so the two
trees are one additional mesh draw with shadow casting/receiving enabled. The
two instances total 75,000 triangles and the GLB contributes three embedded
1k maps. There is no per-frame allocation or update.

The returned colliders are honest full-canopy rotated AABBs derived from all
four x/z corners of the audited scene-local bounds. They are:

- white yard: x `[-3.4360, -2.5640]`, y `[0.1510, 1.6199]`, z `[33.5598, 34.4402]` m;
- orange yard: x/z are calculated from the same full bounds at yaw `1.4`, with
  y `[0.1510, 1.6199]` m.

The placement suggestions were supplied with the root collider snapshot as
having at least the stated gaps to existing colliders and retaining door/spawn
margins. That claim remains **OPEN** until root reruns the live route/collider
proof after integrating the other current props. No old tree positions are
replaced by this module.

## Reproduce / verify

From the recovery worktree, after the GLB is present:

```powershell
node scripts/assets/verify-quiver-tree.mjs
```

The verifier is CPU-only and checks GLB bytes, topology, one identity scene
node, decoded bounds, map count, and the two placement AABBs. It does not start
Vite, launch a browser, render, or claim visual acceptance.

## Correctness gate

The placement collider now uses the same Y rotation convention as Three.js:
`x' = cos(yaw)·x + sin(yaw)·z` and
`z' = -sin(yaw)·x + cos(yaw)·z`. The CPU verifier bundles the actual
`src/build/desert-trees.ts` exports, decodes all 25,488 POSITION vertices from
the GLB, applies the actual GLTF node matrix and a real `THREE.Matrix4` Y
rotation for both placements, and proves every transformed vertex is inside the
actual returned collider. It also recomputes raw vertex bounds independently of
the accessor metadata and checks the Three.js +90° orientation convention.

VERIFIED 2026-09-19: `node scripts/assets/verify-quiver-tree.mjs` passes for
both placements, including 50,976 transformed vertex checks. Runtime visual and
player traversal acceptance remain OPEN.
