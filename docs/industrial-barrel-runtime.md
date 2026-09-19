# Industrial barrel runtime canary

Status: imported and statically verified; runtime placement remains OPEN until the
root integration lane runs its browser traversal and visual checks.

## Imported asset

The asset is a self-contained Poly Haven `barrel_03` glTF, licensed CC0 under the
[Poly Haven license](https://polyhaven.com/license), from
`https://polyhaven.com/a/barrel_03`. The source is an official 1k glTF export; this
record makes no image-to-3D reconstruction or photogrammetry claim.

The copied GLB is:

- `public/assets/industrial-barrel/industrial-barrel.glb`
- 573,188 bytes
- SHA-256 `ac47c9c9a377d5911c739338bef0cc8cdd325975a739668cecc21bf78029863b`
- one mesh, one primitive, one material, 1,473 triangles, 1,126 vertices
- three embedded 1024px JPEG maps; no external URIs
- measured y-up bounds `x -0.316972..0.316972`, `y -0.000000..0.930474`,
  `z -0.319299..0.319300` metres, giving approximately `0.634 x 0.930 x 0.639 m`

The GLTF material references the embedded normal, base-colour, and packed
metallic-roughness maps. The packed map uses AO in R, roughness in G, and metalness
in B. The embedded image SHA-256 values match the official source files recorded in
`docs/industrial-barrel.md`.

The CPU-only reproducible importer is
`scripts/assets/import-industrial-barrel.py`. It is copied beside the asset so a
future refresh can be compared and packed again without Blender, a renderer, or a
network request during runtime.

## Loader API

`src/props/industrial-barrel.ts` exports:

- `INDUSTRIAL_BARREL_URL` and `INDUSTRIAL_BARREL_SIZE`
- `preloadIndustrialBarrel()` (the unused mutable ready export was removed)
- `loadIndustrialBarrel()` / `getIndustrialBarrel()` for one shared-buffer clone
- `disposeIndustrialBarrel()` for shutdown or route replacement

The first load decodes one cached master. Every clone shares the master geometry,
materials, and textures, so four placements do not multiply decoded resources. The
loader does not add scene objects, colliders, event listeners, lights, or per-frame
work. Callers must remove clones before disposal because disposal invalidates their
shared resources. A generation token also disposes a late GLTF decode if shutdown
occurs while the request is still pending, so a disposed loader cannot orphan a
newly decoded master. The builder in `src/build/industrial-barrels.ts` owns the
four map placements and returns one honest rotated AABB per clone; root can omit
that builder until its actual scene traversal accepts the route clearances.

## Proposed placement canary

These are measured map-space suggestions on the inner side of the two back-yard
prop bands. `y=0.151` is the yard plateau top (`KERB_HEIGHT + 0.001`) and the barrel
base is at y≈0 in the GLB. The x centres keep the rotated barrel inside the yard's
prop band rather than the 2.6 m flanking lanes. The builder returns a conservative
rotated AABB for each one, but root should keep them out of gameplay until traversal
acceptance:

| name | x | y | z | yaw |
| --- | ---: | ---: | ---: | ---: |
| `white-east-fence` | 11.6 | `KERB_HEIGHT+0.001` | 34.8 | 0.18 |
| `white-west-fence` | -10.8 | `KERB_HEIGHT+0.001` | 31.8 | -0.24 |
| `orange-east-fence` | 11.3 | `KERB_HEIGHT+0.001` | -33.0 | -0.12 |
| `orange-west-fence` | -10.6 | `KERB_HEIGHT+0.001` | -34.2 | 0.28 |

The builder's CPU collision report produces these AABB widths/depths (height is
0.930 m, with the minimum at the yard plateau):

| name | width | depth |
| --- | ---: | ---: |
| `white-east-fence` | 0.738157 m | 0.742181 m |
| `white-west-fence` | 0.767720 m | 0.771388 m |
| `orange-east-fence` | 0.705937 m | 0.710302 m |
| `orange-west-fence` | 0.785900 m | 0.789324 m |

CPU geometry checks show the four centres are outside the known 1.2 m spawn-clear
envelopes and outside the rear-door x bands at z ranges used by the yard builder.
That is a placement precheck, not runtime acceptance: the root lane must verify the
actual merged scene and player traversal, confirm no lane/hedge/stair overlap, and
capture the three-quarter view before adding the canary to a live yard.
