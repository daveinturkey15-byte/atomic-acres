# First-person material cache

Status: additive factory only. The existing viewmodel geometry and integration seam
are unchanged in this change.

## What the factory provides

`src/weapons/viewmodel-materials.ts` exports `createViewmodelMaterials()`. Call it
once when the weapon overlay is constructed, then share the returned set across all
five weapon rigs. It owns four `THREE.MeshStandardMaterial` singletons:

| Material | Surface response | Base maps | Repeat | PBR values |
|---|---|---:|---:|---|
| `sleeve` | olive woven canvas, low sheen | 256 albedo + 128 roughness/normal | 2.25 | roughness 0.86, metalness 0.01 |
| `darkGlove` / `gloveDetail` | pebbled dark glove, with fine grip ribs | 256 + 128/128 | 3 | roughness 0.72, metalness 0.01 |
| `woodFurniture` | warm longitudinal grain and pores | 256 + 128/128 | 1 | roughness 0.54, metalness 0.02 |
| `parkerizedSteel` | dark green-grey machined/peened steel | 256 + 128/128 | 2 | roughness 0.44, metalness 0.82 |

Every family has an sRGB albedo, a linear roughness map, and a linear tangent-space
normal map. The normal map is derived from the same deterministic height field as the
surface pattern, so grain/weave and small shading changes line up. `gloveDetail` is
an alias of `darkGlove`, not a fifth material.

The generated patterns are camera-local. A 256 texel albedo over a typical
0.25–0.60 m weapon part is roughly 1–2.5 mm per texel before the family repeat; the
128 texel detail maps carry roughness and normal breakup at roughly 2–5 mm per texel.
This keeps a sleeve weave, glove pebble, wood grain, and parkerized finish visible in
the close-up without reusing the world painted-prop pattern on the small arms.

## Resource budget and lifetime

The cache creates exactly four materials and twelve `DataTexture`s. Retained texture
data is:

* four 256² RGBA albedo maps: 1,048,576 CPU bytes;
* eight 128² RGBA roughness/normal maps: 524,288 CPU bytes;
* total retained CPU texture data: **1,572,864 bytes** (about 1.50 MiB), before
  material and typed-array object overhead.

The GPU allocation is backend-dependent. With ordinary RGBA mip chains it is roughly
2.1 MiB for the texture payload before driver bookkeeping. This is an estimate, not a
runtime measurement. The factory adds no geometry, lights, render targets, per-frame
work, or external image requests, and all four materials use the same map feature set
so they should share the existing standard-material shader family.

`dispose()` is idempotent. It disposes the four materials and the twelve textures
exactly once. The caller must invoke it only after all five rigs and the overlay have
been removed; it must not dispose individual textures while meshes still reference
them.

## Integration seam for the owner

The current hands use `mat.painted()` for sleeve, cuff, glove, and glove detail, while
the weapon builders use `mat.timber`, `mat.timberDark`, and `mat.steel`. The owner can
wire the new cache at the single viewmodel construction seam:

* sleeve forearms → `vm.sleeve`;
* cuff, palm, and finger bundle → `vm.darkGlove` (or `vm.gloveDetail`, the same object);
* wooden handguards, stocks, grips, and pump/forend pieces → `vm.woodFurniture`;
* dark barrels, rails, magazines, and mechanical parts → `vm.parkerizedSteel`.

Existing bright chrome and scope-lens choices can remain on their current materials
until a separate visual decision is made. Geometry, transforms, reload groups,
lighting, and the overlay environment are outside this factory.

## r180 API choices

* **VERIFIED:** the factory uses core r180 `DataTexture`, `MeshStandardMaterial`,
  `RepeatWrapping`, `LinearMipmapLinearFilter`, `SRGBColorSpace`, and
  `NoColorSpace`; it does not depend on a newer node-material property or a browser
  canvas.
* **VERIFIED from current source:** the existing `src/core/materials.ts:291-304`
  already constructs `THREE.MeshStandardMaterial` and documents that r180's
  `StandardNodeLibrary` copies its properties into a node material under
  `WebGPURenderer`. The overlay uses that same renderer path.
* **VERIFIED:** normal maps are used instead of displacement or a custom shader. This
  preserves the current rig geometry and keeps the map response inside the standard
  material family.
* **OPEN until the owner integrates:** the exact visual result depends on the
  existing weapon UVs, overlay lights, exposure, and environment. The material file
  has not been run in the browser in this task.

## Reference reading and acceptance

The target image at
`C:\Users\david\Documents\Codex\2026-09-19\hi\work\target-viewmodel\target.png`
was used as a material-direction reference: cloth should have broad fold response and
fine weave, gloves should be dark but dimensional, wood should have longitudinal grain
instead of the existing repeated world pattern, and steel should have a restrained
parkerized sheen. `captures/candidate-stock-circle.png` is the current game frame and
shows the geometry/layout context; the target2D image is not an automated pixel target.

The owner should judge the integrated result at the same camera and viewport with all
five weapon rigs visible one at a time. A useful acceptance frame must show, without
changing geometry:

1. cloth breakup that remains subtle at normal hip view and does not turn into green
   noise;
2. glove fingers/palm that read as separate rounded forms through roughness and normal
   variation, not as a black silhouette;
3. wood grain that follows the authored furniture surfaces without becoming a striped
   barcode on box ends;
4. steel with a broad, low-intensity highlight and visible machining breakup rather
   than chrome or flat charcoal; and
5. unchanged rig count, transforms, draw topology, overlay lights, and reload poses.

If the close-up still reads flat, the next adjustment should be one profile at a time
(repeat, roughness, or normal scale). Do not add per-frame texture mutation or a new
material per mesh to chase a single screenshot.

## Focused source check

**VERIFIED:**

```text
npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler \
  --skipLibCheck --lib ES2022,DOM --strict src/weapons/viewmodel-materials.ts
```

This task did not run a browser, GPU capture, server, build, or commit. Runtime
appearance, frame time, and final resource counters remain **OPEN** until the owner
integrates the cache and runs the visual proof.
