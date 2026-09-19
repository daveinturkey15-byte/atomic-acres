# Field case canary

This is an original Blender-authored hard-surface prop for the standalone Nuketown continuation. The builder uses no downloaded geometry or models. It makes a rugged olive field equipment case with real 45 mm walls, a closed lid and lower lip, moulded lid ribs, a recessed front handle, two clasps, rear hinges, bolt heads and four rubber feet.

The source is [build_field_case.py](../../scripts/blender/build_field_case.py). It runs headless with Blender 5.1 and writes an editable [field-case.blend](field-case.blend) plus the runtime [field-case.glb](../../public/assets/field-case/field-case.glb). The GLB embeds all five PNG maps and has no external URI.

The final appearance pass keeps the authored shell dimensions and collider unchanged. It adds subtle olive polymer grain with restrained UV-edge dusting, varies shell roughness over the moulded surface, and gives the steel latches their own fine base-colour and roughness maps. Rubber feet remain a separate near-black, high-roughness material so the contact hardware does not read as painted metal.

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

The exact build receipt is [build-report.json](build-report.json). The final appearance pass was rebuilt with SHA-256 `d3286def0cc476edcebe3f038503168694821fc38916b554860bfcc764036d56`.

| Gate | Result |
| --- | --- |
| triangles | 3,608 (limit 5,000) |
| materials | 3 (limit 4) |
| textures | 5 embedded PNG maps: 256² sRGB shell base colour, 256² linear shell roughness and normal, 128² sRGB steel base colour, 128² linear steel roughness |
| file size | 487,972 bytes (limit 2 MB) |
| pivot | ground centre at exported `(0, 0, 0)` |
| repeatability | deterministic source and embedded maps; final SHA recorded above |

The static GLB inspection is [inspect_field_case.cjs](../../scripts/blender/inspect_field_case.cjs). Runtime front, side and three-quarter captures remain OPEN until the root integration lane mounts this file in the live game and looks at it under the game's light rig.
