# GLM turf material — `src/core/turf-material.ts`

Lane: `nuketown-glm-turf-20260919` (GLM, 2026-09-19). This document records the
candidate and its root integration in `src/core/materials.ts`. One candidate was
calibrated twice during this lane (see Verification history).

## Why

The current lawn (`work/turf-reference.png`) reads as bright saturated green with
soft marbled waves and no grain: `PAL.lawn` flat fill + 12-band cross-stripes +
radial blotches. Target: fine short mown turf — muted green/brown blade
variation, soft LARGE mow bands, no huge clumps, no bald sparse patches. The
PolyHaven `sparse_grass` set stays rejected (read as bare soil, 2026-09-17);
nothing external is downloaded or loaded.

## API

```ts
createTurfTextures(): TurfTextureSet   // { lawnTex, lawnRough, lawnNormal }, cached singleton
disposeTurfTextures(set): void         // GPU dispose + cache drop; idempotent
turfTextureStats(set): TurfTextureStats
checkTurfRanges(set): TurfCheck[]      // green dominance, no black/clip, roughness bounds, unit+modest normals
checkTurfSeams(set): TurfCheck[]       // wrap-around delta vs the map's own interior delta
checkTurfDeterminism(set): TurfCheck   // byte-identical regeneration through the pure generators
```

The checks read properties of the produced data (ranges, unit length, seam vs
interior statistics, byte-identical regen). None re-derive the generator math.

## Root wiring (materials.ts, three bindings + one cache owner)

Replace ONLY the three texture bindings; everything else stays byte-identical:

```ts
import { createTurfTextures, disposeTurfTextures } from './turf-material';
const turf = createTurfTextures();
const lawnTex = turf.lawnTex;
const lawnRough = turf.lawnRough;
const lawnNormal = turf.lawnNormal;
own({ dispose: () => disposeTurfTextures(turf) });
```

- The material line keeps the same map fields, roughness, normal scale, and
  wetness factor: `wetStd({ map: lawnTex, roughness: 1, roughnessMap: lawnRough,
  normalMap: lawnNormal, normalScale: 0.4, metalness: 0 }, 0.5, false)`. The
  third argument only disables duplicate map registration; the roughness map
  still stores ABSOLUTE roughness (mean 0.939, like the old `R(0.95)` canvas)
  and the WETNESS node multiplies it at k=0.5 as before.
- The lawn call uses `wetStd(..., 0.5, false)`: the turf-set disposer is the
  sole owner of these three maps. This both avoids duplicate map disposal and
  drops the module cache, so a later material-library rebuild receives live
  textures.
- No new material, program, draw call, light, or per-frame allocation. The map
  slots already exist on the lawn material, so the 18-program count holds.
- `flipY` is explicitly `true` on all three DataTextures. The old maps were
  CanvasTexture (`flipY=true`), and the installed Three.js WebGPU upload path
  honors this flag, so the replacement keeps the old vertical orientation.

## Texture specs

| Map | Size | Encoding | Filters | Aniso | Repeat | Bytes |
|---|---|---|---|---|---|---|
| `lawnTex` | 512² RGBA8 | `SRGBColorSpace` | linear / trilinear-mipmap | 8 | 48 | 1,048,576 |
| `lawnRough` | 256² RGBA8 | `NoColorSpace` | linear / trilinear-mipmap | 4 | 48 | 262,144 |
| `lawnNormal` | 256² RGBA8 | `NoColorSpace` | linear / trilinear-mipmap | 4 | 48 | 262,144 |

All four channels of `lawnRough` carry the value (three.js samples
roughnessMap.g). Total: 1,572,864 B CPU; ~2.1 MB GPU with full mip chains.
Generation: ~65 ms once at build; cached call 0.00 ms.

## Surface design (constants at the top of the module)

- Tileable value noise (wrapped integer-period lattice, quintic fade, 32-bit
  integer hash, seed `0x74757266`), four octaves: tuft 8 cyc/tile, patch 24,
  blade 64, grain 128. `ground.ts` uses `UV_LAWN=96`; repeat 48 therefore
  makes a 2 m tile, with wavelengths from 25 cm tufts down to 1.56 cm grain.
  The grain is what kills the smooth read.
- Mow bands: 4 integer sine periods per 2 m tile along u (0.5 m), ±0.07 luminance,
  mirrored into roughness (light/laid stripe −0.03) and pulled toward
  `PAL.lawnLight` by ±0.10. Integer periods => seamless by construction.
- No bald patches: the dry (brown) mix is clamped at 0.62 toward a tone that is
  itself green-dominant, so G>R>B holds everywhere by construction (measured
  mean rgb 92.5/123.1/62.3). No huge clumps: low-frequency amplitude capped at
  ±0.08 luminance.
- Colours: anchors are `PAL.lawn`, `PAL.lawnLight`, `PAL.dirt` only; BASE and
  DRY are interpolations. No new hexes.
- Moire control: baked xy slopes clamped at 0.35 with RMS ≈ 0.20 (strength 1.0),
  trilinear mips + aniso 8/4. Recommended review at spawn-range stations.

## Verification (all green 2026-09-19)

```bash
npm run check        # tsc --noEmit + render-site allow-list: PASS
bun _turf-verify.mjs # runner below, then delete it (no repo artifacts kept)
```

Runner body (temporary, not committed):

```js
import { createTurfTextures, checkTurfRanges, checkTurfSeams, checkTurfDeterminism } from './src/core/turf-material.ts';
const set = createTurfTextures();
console.log([...checkTurfRanges(set), ...checkTurfSeams(set), checkTurfDeterminism(set)]);
```

Measured: albedo mean rgb (92.5, 123.1, 62.3), channel min 47 / max 150;
roughness 0.867–1.000 mean 0.939, channels identical; normal max |len−1| 0.0051,
max xy slope 0.355, mean z 0.9804; seams albedo 0.38/0.04, roughness 0.71/0.05,
normal 1.07/1.18 (all < 1.4, seam ≈ interior); determinism byte-identical.

History (honest calibration, not gate-weakening):
1. Strength 2.0 → mean z 0.9562 (too strong for "modest"). Lowered to 1.0 → 0.9804.
2. Seam check's absolute `8 levels` cap was mis-calibrated for a high-frequency
   normal map (its own interior delta is ~5–8 levels). Re-anchored to
   `interior + 3` levels with the same ratio<1.4 seam-vs-interior semantics.

## Out of scope for this lane

Visual review of the in-game frame (root owns `playcap` against the baseline
png), band-axis reorientation (swap `u`/`v` in the band
calls if stripes should run the other world axis), and any photoreal claim —
this is a stylized procedural surface, not a reference-matched material.
