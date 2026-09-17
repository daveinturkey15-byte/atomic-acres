# Task brief: WIRE THE BLENDER COACH INTO THE MAP

Read `docs/SPARK-CONTEXT.md` first, then `docs/ASSET-PIPELINE.md` and
`docs/report-blender.md`.

## Files you own exclusively

- `src/build/vehicles.ts`
- `src/main.ts`
- `src/core/assets.ts`

Nothing else.

## The situation

A previous lane built a real Blender → glTF PBR pipeline and produced
`public/assets/coach.glb`: an actual headless Blender run, 5 maps baked in Blender
(base 2048 sRGB; roughness/metal/normal/AO 1024 Non-Color), exported as 3 embedded
PNGs wired to `baseColorTexture` / `metallicRoughnessTexture` / `normalTexture`, and
verified by `scripts/blender/inspect_glb.cjs`. File is 8.6 MB; **decoded texture VRAM
is 24.0 MiB**.

**It is not wired into anything.** It ships in the build and nothing loads it — 8.6 MB
of the download for nothing. The owner has explicitly asked for it to be loaded.

`src/core/assets.ts` already exists with `loadAsset('coach')`, `preloadAssets()` and a
base-aware URL (so it works from the GitHub Pages subpath). Read it before writing.

## What to do

### 1. Replace the procedural coach with the Blender one
In `vehicles.ts`, the tour coach is currently a lofted procedural hull. Swap it for the
glTF. Keep:
- its **position, rotation and the 25° angle across the bulb** (that angle exists so the
  flank, and the Nuketown script on it, face the turningHead camera)
- its **collider** — colliders are stepped along the vehicle's own length axis into
  several boxes so a rotated vehicle's collision follows its diagonal rather than its
  bounding rectangle. A single AABB on a rotated 11.6 m coach previously walled off the
  whole turning head. **Do not regress that.**
- correct **scale and sit**: the wheels must touch the road, not float or sink. Verify
  the glb's real bounds rather than assuming its export scale.

If the Blender coach turns out to look *worse* than the procedural one in frame, say so
plainly and keep the procedural one — but then **remove `coach.glb` from `public/`** so
we are not shipping 8.6 MB of nothing. Either wire it or drop it; do not leave it dead.

### 2. Make loading deterministic for the harnesses — this is the part that bites
`scripts/capture.mjs` and `scripts/traverse.mjs` both wait for `window.__NT.ready`.
If the coach loads asynchronously **after** `ready` is set, every capture photographs a
map with a missing or half-loaded coach while the renderer stats look perfectly healthy.
That class of bug has already cost this project two rounds.

So: in `main.ts`, **await the asset preload before setting `__NT.ready`**, or expose a
separate `assetsReady` promise and have `ready` mean "scene complete". Whichever you
choose, state it in your report so the harness owner knows the contract.

Also keep `__NT`'s existing surface intact: `goto`, `spawn`, `release`, `stats`,
`moduleStats`, `render`, `probeReset`, `probeWalkTo`, `probePos`, `collidersAt`,
`setMode`, and `handedness` inside `stats()`. Keep `cameraHeldByQA` behaviour.

### 3. Check the cost
Report the decoded VRAM, the draw-call delta and the fps delta. 24 MiB for one prop is
a lot — if it is not clearly better than the procedural coach, that is an argument for
dropping it.

## Verify

```
npx tsc --noEmit -p tsconfig.json     # clean
npm run build
npm run traverse                       # 5/5 routes, 4/4 faces, handedness PASS
npm run capture -- --tag wire
```

Both harnesses serve the **built** artifact, so run `npm run build` first.

Then **open** `captures/wire-turningHead.png` and `captures/wire-plaza.png` with the
Read tool and look at the coach. Compare against `captures/fog2-turningHead.png`, which
is the current procedural coach. Say which is better and why — and if the answer is the
procedural one, act on that.
