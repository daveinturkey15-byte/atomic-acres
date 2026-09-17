Read `docs/night/_COMMON.md` and `docs/SPARK-CONTEXT.md` first. They bind you.

# Night lane: IMAGE3D - concept art to a real in-game asset

## Files you own
`scripts/blender/`, `public/assets/`, `src/core/assets.ts`, `docs/IMAGE-TO-3D.md`

Do not touch `src/build/*`, `src/main.ts`, `src/core/` other than `assets.ts`.

## Context
There is already a working headless Blender -> glTF PBR pipeline in `scripts/blender/`
with a glb inspector (`inspect_glb.cjs`) and a base-aware loader in
`src/core/assets.ts`. A previous lane built a coach with it, compared it against the
procedural coach, found the procedural one better and **deleted the glb** - the right
call, and the standard you are held to.

There are concept images in `docs/reference/concept/` (53) and a sibling lane may add
`concept2/`. The relevant skills on this machine are `img2threejs`,
`ai-3d-asset-generation-loop`, `comfyui-3d-native-pipeline`.

## The task
Take ONE concept image through to a finished in-game asset, end to end, and document
the route so it can be repeated:

1. pick a subject where a modelled asset clearly beats procedural code - a detailed
   prop, a sign assembly, a piece of street furniture. NOT a whole building.
2. model it in headless Blender from the concept, reproducibly (one npm script ->
   one glb, no GUI steps)
3. bake real PBR maps in Blender: base colour (sRGB), roughness, metal, normal, AO
   (all Non-Color). Correct colour-space flags are the single most common glTF
   authoring bug.
4. keep the texture budget honest and report **decoded** VRAM (sum of w*h*4), not file
   size - a small file can be a huge GPU footprint
5. load it through `assets.ts` and make sure `__NT.ready` is not set until assets have
   loaded, or the capture harness photographs a map with the asset missing while the
   stats look perfectly healthy

## The standard
**Wire it, capture it, compare it against what is there now, and if it is not clearly
better, delete the glb and say so.** Shipping megabytes to justify the work is the
failure mode. Write the honest verdict in `docs/IMAGE-TO-3D.md` either way, along with
the repeatable route.

## Verify
`npm run build`, `npm run traverse`, `npm run capture -- --tag i3d`. Open the capture
showing your asset in the map. Report triangle count, decoded VRAM, build time and
your verdict.
