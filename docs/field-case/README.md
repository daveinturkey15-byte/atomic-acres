# Field case canary

This is an original Blender-authored hard-surface prop for the standalone Nuketown continuation. The builder uses no downloaded geometry or models. It makes a rugged olive field equipment case with real 45 mm walls, a closed lid and lower lip, moulded lid ribs, a recessed front handle, two clasps, rear hinges, bolt heads and four rubber feet.

The source is [build_field_case.py](../../scripts/blender/build_field_case.py). It runs headless with Blender 5.1 and writes an editable [field-case.blend](field-case.blend) plus the runtime [field-case.glb](../../public/assets/field-case/field-case.glb). The GLB embeds all three PNG maps and has no external URI.

The optional loader is [field-case.ts](../../src/assets/field-case.ts):

```ts
import { loadFieldCase } from './assets/field-case';

const prop = await loadFieldCase();
prop.position.set(x, y, z);
prop.rotation.y = yaw;
scene.add(prop);
// Remove the clone before the registry is disposed.
```

`loadFieldCase()` shares decoded geometry, materials and textures across clones and does no per-frame work. `disposeFieldCase()` releases the shared GPU resources after all clones have been detached. The honest static collider is an axis-aligned box using `FIELD_CASE_COLLIDER` (`0.90 × 0.50 × 0.48 m`); the exported exterior, including fittings, measures `0.919 × 0.515 × 0.564 m`.

## Measured build

The exact build receipt is [build-report.json](build-report.json). The GLB was rebuilt twice with the same SHA-256 `cf185ce8e9a2ecc3fa928c253fd04e70712a05e8f40abe96dec9f5441109c7b9`.

| Gate | Result |
| --- | --- |
| triangles | 3,608 (limit 5,000) |
| materials | 3 (limit 4) |
| textures | 3 embedded 256² PNG maps: sRGB base colour, linear roughness, linear normal |
| file size | 463,824 bytes (limit 4 MB) |
| pivot | ground centre at exported `(0, 0, 0)` |
| repeatability | byte-identical rebuild |

The static GLB inspection is [inspect_field_case.cjs](../../scripts/blender/inspect_field_case.cjs). Runtime front, side and three-quarter captures remain OPEN until the root integration lane mounts this file in the live game and looks at it under the game's light rig.
