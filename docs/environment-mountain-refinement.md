# Mountain environment refinement, correction 2

This pass addresses the noon review frame where the previous geological strip
overlay read as paper scenery and produced moire. It changes only the skyline
presentation geometry and mountain material choices. Ring radii, instance
transforms, landmark positions, playable structures, and colliders remain
unchanged.

## Geometry

`src/build/terrain-ridges.ts` now builds each massif as an indexed 2D
heightfield. Longitudinal samples retain the existing silhouette profile while
12 cross-slope samples run from the front foot through the crest to the far
foot. Two shallow, incommensurate relief waves form irregular erosion gullies
inside the surface; they vanish at the foot and crest so the range outline stays
stable. `computeVertexNormals()` runs over shared indexed vertices, giving the
rock one continuous slope response instead of broad flat strips.

There are no coplanar strata overlays. Each of the two existing instance
buckets builds one geometry with a derived erosion phase and keeps the
established random sequence; mountain draw count therefore remains the same.
At 26 longitudinal segments and 12 cross-slope segments, the surface budget
is approximately 39,936 rendered triangles across the 64 ridge instances, well
below the 120,000 triangle allowance. Relative to the former 88-triangle ridge
profile this is approximately 34,304 additional rendered triangles, with zero
additional draw calls.

## Material correction

The old mountain materials used metalness `0.9–1.0` to suppress the warm
fully-lit response after the mountains washed toward white. That workaround
made the surfaces read as flat grey metal. The revised ladder uses rough,
non-metallic palette colors: darker neutral dirt on the near ring, mountain
blue-grey in the next ring, and progressively hazier values farther out. Fog
remains responsible for aerial perspective; no global lighting or exposure was
changed.

## Integration and verification

`skyline.ts` keeps `MTN_R`, `MTN_SCALE`, `MTN_SINK`, all placement matrices,
and the existing ring counts unchanged. The heightfield helper consumes no
additional random value for erosion; its phase is derived from values already
sampled for the ridge. No browser, GPU, build, or commit was run in this lane.
The static gate is:

```text
npm run check
git diff --check
```

The root lane must compare the same clear-noon and golden-hour cameras before
claiming visual acceptance. Inspect the range for natural continuous rock
shading, no graphic contour bands, stable landmark occlusion, and the unchanged
playable footprint.
