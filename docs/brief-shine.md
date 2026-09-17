# Task brief: MAKE IT SHINE — post chain, reflections, material response

Read `docs/SPARK-CONTEXT.md` first. It binds you.

## Files you own exclusively

- `src/core/world.ts`
- `src/core/renderer.ts`
- `src/core/post.ts` (new)
- `src/core/materials.ts`

Do not touch `src/build/*`, `src/main.ts`, `index.html` or `vite.config.ts`.
`createWorld(canvasParent)` must keep its exported signature and the `World` shape
(`renderer, scene, camera, sun, resize, dispose`) — that is the seam that lets you work
without touching `main.ts`. If you need a post-processing hook in the frame loop, expose
it through the returned `World` object (e.g. a `render()` the loop can call) rather than
editing `main.ts`, and say so in your report so the orchestrator can wire it.

## The owner's words

> "I want the graphics to be much shinier than this ... a good pipeline for graphics,
> PBR, maps, lighting, reflections"

The renderer is already `THREE.WebGPURenderer` (see `src/core/renderer.ts`) with a
WebGL fallback. Everything is `MeshStandardMaterial` and the only environment is a PMREM
of a gradient sky dome. It reads as clean untextured shapes under flat noon light. Your
job is to make it read as a **photographed place**.

## What to build

### 1. A post chain
Use three.js's WebGPU post-processing (`three/tsl`, `PostProcessing`, the `three/addons`
TSL passes). Aim for, in rough priority order:

- **ambient occlusion** (GTAO/SSAO) — this is the single biggest win. The scene has
  almost no contact darkening, which is why props look pasted on rather than sitting in
  the world. Corners, under eaves, where kerb meets road, under vehicles.
- **screen-space reflections** on the road, paving and glazing, or at minimum a much
  stronger env contribution on those surfaces.
- **bloom**, tight and restrained — sun glints on chrome and glass, not a haze over
  everything.
- **filmic tone mapping** already exists (ACES, exposure 1.09). Keep exposure where it
  is unless you can show a measured reason; a critic verified there are no blown whites
  and no crushed blacks today and that is worth preserving.
- optionally: subtle vignette, chromatic aberration at the very edge, sharpening.

**The fallback must still work.** If the WebGL path cannot run the chain, it must
degrade to today's output, not to a black screen.

### 2. Material response
`materials.ts` builds every texture procedurally on a canvas. Raise their quality:

- give the main surfaces a **roughness map** and a **normal map**, not just a colour
  map — procedurally generated, same canvas approach. Paving, asphalt, stucco, timber,
  lawn and hedge all currently have uniform roughness, which is why they look like
  coloured plastic.
- vary roughness spatially (wet/polished patches on asphalt, worn kerb edges, grubby
  stucco near the ground).
- the reference bar in `docs/reference/CONCEPT-BAR.md` has concrete, falsifiable
  statements about material behaviour per surface family — read it and implement what
  it says. It was written for exactly this task.

### 3. Light rig
One sun + hemisphere + a weak fill is flat. Consider: a warmer key, a cooler sky fill,
and genuinely dark shadow interiors so the value range opens up. **Do not just raise
ambient** — a previous lesson on this project was that a flat global ambient bump makes
every enclosed space read wrong; the lift must come from occlusion contrast.

## Budget and gates

The scene is currently ~471 draw calls, ~150k triangles, 20 shader programs, measured
284-317 fps on the published build. You have a lot of headroom. Stay under 1200 calls
and keep an eye on the program count — it stays low only because materials are
singletons, so **never construct a material inside a builder** and do not explode the
material count.

```
npx tsc --noEmit -p tsconfig.json          # clean
npm run capture -- --tag shine             # 10 stations, ZERO page errors
npm run traverse                           # must stay 5/5, handedness PASS
```

Then **open** `captures/shine-streetElevation.png`, `shine-yardOrange.png`,
`shine-turningHead.png` and `shine-aerial.png` with the Read tool and compare them
against the existing `captures/ship-*.png`. **Do not report success because it
compiles.** The test is whether the frames look materially better, and you must say
which specific things improved and which did not.

Report your measured fps before and after — if the chain costs more than about half the
frame budget, say so and make it configurable rather than shipping something slow.
