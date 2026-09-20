# mountain-volume-muse-1010 — handoff

New true-volume background mountains, not another ribbon repair. Owns ONLY
`work/mountain-volume-muse-1010/` in `nuketown-environment-20260919`. No root
edits made; root stays read-only from this lane.

## Files (exact usable deliverable, no research-only output)

- `mountain-volume.ts` — canonical module. Copy to `src/build/mountain-volume.ts`
  with ONE line changed: `from '../../src/core/kit'` → `from '../core/kit'`.
  Then apply `mountain-volume.patch` (2-line `src/main.ts` hook).
- `proof.mjs` — CPU geometry proof (no GPU/browser/Blender). Run:
  `node work/mountain-volume-muse-1010/proof.mjs`
- `mountain-volume.patch` — root seam only (import + BUILDERS entry).
- `HANDOFF.md` — this file.

## Design (distinct heightfield-volume algorithm)

Per range: Cartesian `(u along crest) × (v across)` grid (120×24), height from
massif envelope (2–3 lobes → saddles) × ridged value-noise horns × asymmetric
cross profile (steep town scarp pow 1.6 / long back pow 1.25) − diagonal
couloirs `(u + 0.35v)` − complementary rills + town-side foothill fBm apron.
West range adds a gaussian road notch (plaza vista stays open). Rim blends to
−10 m so feet sink; 4 skirts drop to a −28 m bottom ring + bottom fan. Closed
manifold, outward winding (top +y / skirts radial / bottom −y), shared edge
vertices, `computeVertexNormals`, planar world UVs (/48 m).

Ranges (map compass from layout.ts; city band at 175 m; all beyond it):
NORTH (2.75, +432, 1020×150, crest ≤123 m) / SOUTH (2.75, −432, 1020×150,
≤106 m) / WEST (−438, 0, 920×160 yaw 90°, ≤91 m, road notch 0.9).
East left to third house + pavilion ranks + city band (turningHead needs no
mountains per its station note).

## Proof (actual, rerun 2026-09-20, `node proof.mjs`)

ALL PASS: closed (0 boundary edges), manifold, Euler V−E+F=2 all ranges,
unit normals, finite attrs/bbox/sphere, plan depth = footprint, thickness
119–151 m, bottom −28, crests 91–123 m, full perimeter sunk ≤0, skirts <0,
0 exposed vertical faces above ground, crest relief >35% span, deterministic
rebuild identical. Budgets: 19,872 tris ≤ 35k, 3 draws ≤ 6, 9,942 verts,
~544 KiB buffers < 1 MiB. `tsc --noEmit --strict` clean. Zero `Math.random`,
zero material construction, zero scene/camera/renderer/light touches, zero
`ctx.rand` consumption (only `ctx.mat.painted`, 2 colour keys).

## Materials / provenance

No downloads, no generated images, no models, no texture maps (0 MiB —
nothing to hash). Procedural geometry only. Borrows ≤2 existing singletons:
`PAL.mountain` (N/S) + `PAL.mountainFar` (W) via `ctx.mat.painted(c, 1, 0)` —
no new programs, WebGPU shader cache untouched. Defaults in-module equal those
PAL values; patch passes PAL explicitly.

## Integration (root owner)

1. Copy module → `src/build/mountain-volume.ts` (fix kit import, nothing else).
2. `git apply work/mountain-volume-muse-1010/mountain-volume.patch`
3. `npm run check` (tsc + allow-list) must stay clean.
4. A/B on ACTUAL current-camera WebGPU frames (docs, not counts, decide):
   baseline vs `?mountain-volume=canary` at yardWhite, yardOrange, plaza,
   aerial. Existing `?mountains=canary` stays OFF during comparison.
5. `npm run capture` delta: +3 draws, +~20k tris worst station (budget
   1200 calls / 900k tris — negligible). Soak only if render chain touched
   (it is not: static backdrop, matrices frozen, `matrixAutoUpdate=false`).

## Behaviour

Default OFF — empty group, no geometry, no assets, no collider, no RNG
draw. Opt-in `?mountain-volume=canary` (alias `?mountains=volume`); test
override `__NT_OVERRIDE_MOUNTAIN_VOLUME__`. Disposal detaches + disposes owned
geometries only; shared `ctx.mat` singletons never disposed (mirrors
mountain-terrain contract). No layout/sky/light/collider changes.

## Honest limits

West horizon outside the road notch is a single range — from due-west
low angles its crest repeats at 920 m width; the notch + decorrelated lobes
mitigate banding but a 4th range would be needed for full 360° asymmetry.
Not proposed: budget and the east closure make it unnecessary for the named
fidelity stations. If A/B shows the ranges reading pale against haze, deepen
`near` toward `PAL.dirt` in the patch call — no module change needed.
