# Lighting look diagnosis

Status: read-only diagnosis from the existing captures and source on 2026-09-19.
No lighting code was changed.

## What the frames show

`captures/leaf-cards-noon/yardWhite.png` is pale across the exterior whites,
sky and distant mountains. The lawn remains saturated, but the cream facade,
roof and concrete occupy a narrow near-white range. The visible shadows are
present and directional; this is a contrast and highlight-separation problem,
not evidence that the shadow map is missing.

`captures/candidate-stock-circle.png` has dark asphalt and deeper vehicle and
underbody separation, so the renderer can produce strong local contrast. It is a
different camera/station and is not a clean lighting A/B, but it falsifies the
idea that the whole scene is intrinsically unable to make dark values.

The existing `captures/mountain-corrected-golden/yardWhite.png` and
`captures/options-live/goldenHour-clear.png` have warmer sky and facade values,
darker greens, and clearer shadow/material separation. That difference tracks
the preset numbers: golden hour uses exposure 1.02, sun intensity 2.5,
hemisphere intensity 0.72, and environment intensity 0.8, while clear noon uses
1.09, 3.35, 0.95, and 0.9 respectively.

## Highest-probability cause

The noon rig is overfilling and then compressing large bright surfaces. The
relevant values are the 3.35 sun, 0.95 hemisphere, 0.25 opposing fill, 0.9
environment intensity, and 1.09 ACES exposure in
[`world.ts`](../src/core/world.ts), [`atmosphere.ts`](../src/core/atmosphere.ts),
and [`renderer.ts`](../src/core/renderer.ts). A cream wall or pale paving surface
therefore reaches the ACES shoulder from several lighting terms at once; ACES
then reduces highlight colour separation, which reads as a bleached exterior.
The pale noon sky is also intentional in the current palette: `skyHorizon` is
`0xcdd9df`, and the dome applies a horizon blend before the renderer's output
conversion.

This is less likely to be a colour-space conversion bug. Palette values enter
`THREE.Color` once, the environment bake is marked `LinearSRGBColorSpace`, and
the renderer applies `SRGBColorSpace` output once. The stronger golden-hour
result through the same output path also argues for a lighting/exposure balance
issue. Fog may contribute to the low-contrast mountain band, but noon fog is
`0.0016` and foreground exteriors are flat too, so it is not the leading cause.
The AO code remaps open surfaces to a multiplier of 1.0 and the captures show
real shadows, so AO and shadow-map strength are secondary suspects for this look.

## Two controlled experiments

1. **Noon exposure only:** hold the noon light rig, environment, fog, materials
   and post effects fixed; capture the same `yardWhite` station with only
   `TOD_PRESETS.noon.exposure` changed from `1.09` to `0.98`. Compare the cream
   facade, roof edge, paving and sky swatches by highlight chroma and the fraction
   of near-white pixels, not by whether the whole frame is darker. If those
   highlights regain hue and the midtone ratios stay stable, output shoulder
   compression is confirmed. If the frame merely darkens while the same surfaces
   remain equally grey/white relative to one another, exposure is not the main
   cause; restore it and test ambient balance.

2. **Noon environment intensity only:** restore exposure and change only the
   effective noon `environmentIntensity` from `0.9` to `0.55`; keep sun, hemi,
   fill, fog and palette unchanged. If shaded facade/under-deck values deepen and
   timber/blue/green chroma returns while direct sunlit surfaces stay close to
   their original luminance, the environment wash is confirmed. If open and
   shaded surfaces move together with no material separation recovery, the
   environment is not the dominant wash and the remaining candidate is the
   direct sun/hemi balance; do not keep lowering intensity to manufacture detail.

Both experiments should use the same station, camera, preset, weather and backend,
with `post=off` captured only as a diagnostic companion if the post contribution
needs separating. A successful result must recover material colour and value
relationships, not simply make the map darker.
