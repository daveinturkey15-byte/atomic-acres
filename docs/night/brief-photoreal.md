# Lane `photoreal` - push the render toward photorealism

Read `docs/night/_COMMON.md` first.

## The owner's words

> "iterate on the graphics lighting assets etc ... to make it more and more towards
> photorealism including animations and effects where possible"

He has looked at the build. His verdict, and mine from the same frames, is that it
reads **flat and plastic**. That is the gap to close. Not "add more stuff" - make the
light and the surfaces behave like light and surfaces.

## Files you own

- `src/core/world.ts` - renderer, sky, environment bake, sun, fog, tone mapping
- `src/core/post.ts` - the post chain
- `src/core/materials.ts` - the shared material singletons
- `src/core/palette.ts` - the colours

Nothing else. In particular `src/build/**` is read-only: you change how surfaces
respond to light, not where anything is.

## Where to start - an earlier pass already did some of this

`docs/report-light.md` records what landed earlier today: env bake 256x128 to 512x256
with a real sun disc, asphalt roughness 0.9 to 0.65, GTAO radius 0.25 to 1.0 m, SSR
maxDistance 1 to 12 m. Read it. Do not redo it. It also failed to get a frame-time
number because headless Chromium here runs the software rasteriser at about 1 fps, so
do not burn budget benchmarking; argue performance from construction instead.

## Hard rules that have already cost this project days

1. **Never add, remove, hide or show a `THREE.Light` after the first frame.** Three
   compiles one program per light-set; changing it invalidates every shader in the
   scene and froze the predecessor project for seconds. Same for toggling `castShadow`
   and for changing `clippingPlanes` on a live material.
2. **A hand-written shader gets no tone mapping and no output colour-space
   conversion.** The sky already had this bug and rendered darker than everything
   beside it. `makeSky('screen'|'env')` exists because the screen variant must convert
   and the PMREM variant must not. If you add a shader, say which side of that line it
   is on, in a comment.
3. **`material.color` multiplies.** It cannot lighten anything. If something needs to
   be brighter, that is a light or an exposure problem.
4. Zero per-frame allocation. Zero material construction outside the shared library.

## What photorealism means here, in priority order

1. **Contact.** Nothing in this scene is grounded. Verify GTAO is darkening *contacts*
   and not the whole frame - an AO pass that dims everything is wrong, and is the
   commonest way to make a render muddier while believing you improved it.
2. **Shadow quality.** Check the shadow camera frames the play space and no more. An
   oversized frustum is the usual cause of soft, detached, useless shadows. BO2's
   Nuketown is a hard, high, slightly warm afternoon sun: crisp shadow edges, strong
   blue sky fill in the shade.
3. **Value range.** Open a real frame and one of ours side by side and compare
   histograms. Ours is almost certainly compressed into the mid-greys with no true
   darks. Fix that with occlusion and shadow, NOT by raising exposure - if different
   parts of one frame need wildly different scalars, no global scalar works and the
   problem is occlusion.
4. **Surface variation.** Large uniform areas read as plastic. Procedural breakup at
   two scales - macro mottling and fine grain - in roughness as much as in albedo.
   Roughness variation sells realism harder than albedo variation does.
5. **Specular response.** Asphalt has a wide dim lobe, painted render a tight one, and
   glass and chrome need something in the environment worth reflecting.

## Reference discipline

Open real frames. `docs/reference/img/nt2025-sniper-boii.png` is 2560x1440 and is the
sharpest thing we have; `docs/reference/gameplay/` holds 1371 more. For every change,
name the real frame that justifies it. "Looks better" is not a reason. "The real
frame's shaded wall sits at 38% luminance and ours at 71%" is.

## Verify before you report

```
npx tsc --noEmit -p tsconfig.json
npm run build
npm run traverse
npm run capture -- --tag photoreal
```

Traverse must still report **4/4 house faces enterable** and handedness PASS. Its five
route lines are currently red for a geometry reason the orchestrator owns - ignore
their PASS/FAIL, but if `4/4` or handedness changes, you broke something.

Then open `captures/photoreal-*.png` and compare each against the same station in
`captures/now-*.png` and against a named real frame. In your report, per station:
better, same or worse, and why. Give measured numbers where you can - luminance
percentiles of a named crop are cheap and falsifiable.
