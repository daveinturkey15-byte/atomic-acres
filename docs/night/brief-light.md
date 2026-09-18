# Lane `light` - lighting, reflections, shaders

Read `docs/night/_COMMON.md` first.

## The ask, in the owner's words

> "just loop and iterate for things like lighting and reflections and shaders and just
> get it looking really nice"

The map's geometry is broadly right now. What it lacks is **light**. Every frame reads
clean, flat and sparse next to the reference: uniform ambient, no bounce, no contact
darkening, no wet or glossy response anywhere, and a sky that does not agree with the
ground. That is your job and only your job.

## Files you own

- `src/core/world.ts` - renderer, sky, environment map, sun, fog, tone mapping
- `src/core/post.ts` - the post chain
- `src/core/materials.ts` - the shared material singletons
- `src/core/renderer.ts` - backend selection only if you must

Everything under `src/build/`, `src/core/layout.ts` and `src/core/palette.ts` is
**read-only**. You may not move, add or remove a single mesh. You may not add or remove
a light **at runtime** - see the hard rule below.

## Hard rule inherited from the predecessor project, do not rediscover it

**Never add, remove, hide or show a `THREE.Light` after the first frame.** Three
compiles one shader program per light-set; changing the set invalidates every program
in the scene and produced a multi-second freeze in the old project. Decide the light
set at construction and keep it fixed. The same applies to toggling `castShadow` and to
changing `material.clippingPlanes` on a live material.

**A hand-written `ShaderMaterial` / `MeshBasicNodeMaterial` gets no tone mapping and no
output colour-space conversion.** The sky already had this bug: it rendered darker than
every lit surface beside it. `makeSky('screen'|'env')` exists because the screen variant
must convert and the PMREM variant must not. If you write another custom shader, decide
which side of that line it is on and say so in a comment.

## What to do, roughly in this order

1. **Read what is there.** `src/core/world.ts` bakes a 256x128 equirect `DataTexture`
   from the sky and PMREMs it. That is the only reflection source in the project.
   Establish what the current env map actually contains - if it is a smooth gradient,
   every reflective surface is reflecting a smooth gradient, which is why nothing looks
   like it is outdoors.
2. **Give the environment something to reflect.** A sky with a sun disc, a horizon
   band, and a ground half that matches the actual ground albedo will do more for the
   metal and glass in this scene than any material change. Consider baking the env at
   a higher resolution once at startup - it costs nothing per frame.
3. **Contact.** Nothing in this scene is grounded. GTAO (or an SSAO fallback on WebGL2)
   at a radius tuned to the scene scale - metres, not the default - is the single
   highest-value change available to you. Verify it darkens *contacts* and not
   everything: an AO pass that darkens the whole frame is wrong.
4. **Sun.** One directional light, shadow map 4096, bias -0.00022, normalBias 0.055 is
   the current setting. Check the shadow camera actually frames the play space -
   an oversized shadow frustum is the usual cause of soft, detached, useless shadows.
   Nuketown 2025 in BO2 is a **hard, high, slightly warm afternoon sun** with crisp
   shadow edges and strong sky fill in the shade. Match that.
5. **Reflections.** The street after the tone pass reads like matte paper. Real asphalt
   has a wide, dim specular lobe. Roughness around 0.55-0.7 with a low but non-zero
   specular, plus the improved env, is usually enough; screen-space reflections are a
   bonus, not the fix, and they cost.
6. **Tone.** Check `toneMapping` and `toneMappingExposure` together with the palette.
   AgX or Neutral will hold highlights far better than Linear. Do not "fix" flatness by
   raising exposure - that is the mistake logged in
   `docs/` as the unoccluded-ambient trap: if percentiles need wildly different scalars
   in different parts of one frame, no global scalar works and the problem is occlusion.

## What will get your work reverted

- A frame that is darker or muddier than before. Brighter is not better either;
  **contrast between lit and shaded** is what is missing.
- Any per-frame allocation. Check with a heap snapshot if you add anything to the loop.
- Bundle growth over 250 kB, or a frame time above 16 ms at 1920x1080 on this machine.
- Changing the light set at runtime.

## Verify before you report

```
npx tsc --noEmit -p tsconfig.json
npm run build
npm run traverse
npm run capture -- --tag light
```

Then **open** `captures/light-*.png` with the Read tool and compare them, one by one,
against the same station from the previous run and against the reference frames in
`docs/reference/gameplay/`. Put the comparison in your report in words: which station
improved, which did not, and what is still wrong. Also report measured frame time
before and after, and the bundle size before and after.
