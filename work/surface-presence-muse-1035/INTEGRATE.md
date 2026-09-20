# Surface-presence macro (muse-1035) — root integration note

Candidate: `architectural-presence-macro.ts` (this directory) → copy verbatim to
root `src/core/architectural-presence-macro.ts`. Imports are already root-relative
(`./materials`, `three/tsl`, `three/webgpu`). No other new files. No new textures.

## Root patch (3 lines in `src/main.ts`, after line 121)

```ts
const arch = await installArchitecturalMaterials(mat);
if (isPresenceEnabled()) await installArchitecturalPresence(mat, arch?.textures);
```

plus extend the existing import on line 10:

```ts
import { installArchitecturalMaterials } from './core/architectural-materials';
import { installArchitecturalPresence, isPresenceEnabled } from './core/architectural-presence-macro';
```

Insertion stays inside the atomic pre-first-render window (before builders, before
`world.render()`), so the extended program keys are fixed before r180's first
material adaptation — same rule as the base canary.

## Budgets (by construction, verified by `check-presence-macro-cpu.mjs`)

- Textures: +0 (re-samples the base controller's 4; `addedTextures: 0`).
- Draw calls: +0 (no new materials/meshes/lights).
- Programs: 7 distinct before → 7 distinct after (`interiorWall` keeps its base key;
  the other six keys gain a `|presence-macro-v1/<key>` suffix over the uuid-carrying
  base key). Verified with the same `RenderObject.getMaterialCacheKey` probe as
  `scripts/check-architectural-materials.mjs`.
- Default: unchanged. Without `?presence=macro` the module returns null and touches
  nothing (CPU-guarded). Without the base `?architecture=canary` install it throws
  instead of half-installing.
- Disposal: restores base nodes + base keys; owns no textures. Dispose presence
  before the base controller (documented in module header).

## What root still gates (deliberately NOT claimed here)

- `npm run check` (tsc + render-site allow-list) on the integrated tree.
- Full `scripts/check-architectural-materials.mjs` unweakened, plus fixed-camera
  before/after (`captures/art-live-1035` pattern) at yardWhite/yardOrange;
  retain best-known-good if the delta is negligible.
- `playcap`/`soak` only if root judges the render chain touched (it is not: same
  materials, same programs shapes, pre-first-frame keys).

## Honest limits

- Vision: I inspected `mountain-before/yardWhite.png` + `yardOrange.png` (image-read
  supported) — flats confirmed plastic at range. No `mountain-after` comparison was
  possible from this lane (no GPU/browser/server by order).
- Macro amplitudes are bounded engineering values, not measured against a reference
  frame: stucco ±2.5% albedo / ±0.05 rough / 0.22 normal; roof whites ±1.5–1.8% /
  ±0.035–0.04 / 0.18–0.20 + 2 m bays (−2.5% / +0.04, no normal carve); timber ±3% /
  ±0.05 / 0.15 along-board. Worst-case stack ≤±6% stucco, ≤±4% roof.
- If the photographed delta is negligible, drop the candidate — the module is
  self-contained and default-off, so removal is one file + 3 lines.
