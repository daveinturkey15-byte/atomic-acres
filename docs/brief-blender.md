# Task brief: BLENDER → glTF PBR ASSET PIPELINE

Read `docs/SPARK-CONTEXT.md` first. It binds you.

## Files and directories you own exclusively

- `scripts/blender/` (new)
- `src/core/assets.ts` (new — a glTF loader/registry)
- `public/assets/` (new — the exported glb output)
- `docs/ASSET-PIPELINE.md` (new)
- `package.json` — **only** to add asset-authoring npm scripts. Say so loudly if you do;
  another agent may also be in build config.

Do not touch `src/build/*`, `src/main.ts`, `index.html`, `src/core/world.ts`,
`src/core/materials.ts` or `src/core/renderer.ts`. Other agents own those right now.

## Context and the constraint that changed

Blender 5.1 is installed at `C:/Program Files/Blender Foundation/`. Until now this
project has been strictly "every mesh and texture generated in code", and the owner
originally asked for no reused assets. He has now explicitly asked for Blender and a
proper **image-to-3D / PBR / maps / lighting / reflections** pipeline to raise quality.

So the rule becomes: **assets may be authored, but they must be authored HERE, by this
pipeline, from scratch — not downloaded.** A `.glb` produced by a Blender script in
this repo is fine. A `.glb` downloaded from anywhere is not. Baked textures produced by
this pipeline are fine. Downloaded textures are not.

## What to deliver

### 1. A headless, reproducible Blender pipeline
`scripts/blender/` containing Python that Blender runs with `--background --python`.
It must be **reproducible from source**: someone runs one npm script and gets the same
`.glb` out. No manual GUI steps. Model the entry point on
`npm run asset:<name>` → Blender headless → `public/assets/<name>.glb`.

Include, in `docs/ASSET-PIPELINE.md`, the exact Blender executable path, how to add a
new asset, and how long a build takes.

### 2. One hero asset, done properly, end to end
Do **not** try to convert the whole map. Pick **one** object where Blender clearly beats
procedural code and take it all the way:

Recommended: **the Nuketown tour coach** — it is the map's hero prop, it stands on the
turning head in a fidelity frame, and it is currently a lofted box with painted-on
trim. Alternatively a team house shell. Your call; justify it.

It must have:
- clean topology and sane scale in metres (the player's eye is at 1.68 m)
- **real PBR maps baked in Blender**: base colour, roughness, metalness, normal, and
  ambient occlusion. This is the point of the exercise — flat uniform roughness is
  exactly what makes the current build look like coloured plastic.
- correct material assignment and a sensible texture budget (2K maps max, and say what
  the total VRAM cost is — a known trap on this owner's projects is a small download
  that expands to a huge GPU footprint, so report **decoded** size, not file size)
- glTF/glb export with Draco or meshopt compression if it helps, and correct
  colour-space flags on each map (base colour sRGB, the rest linear — getting this
  wrong is the single most common glTF authoring bug)

### 3. A loader the rest of the project can use
`src/core/assets.ts`: an async glTF loader with a small registry, returning something a
builder module can drop into its group. It must:
- work under **`THREE.WebGPURenderer`** (that is what this project now uses)
- not break the headless capture harness — `scripts/capture.mjs` waits for
  `window.__NT.ready`, so if assets load asynchronously the scene must either wait for
  them or the harness will photograph a map with the asset missing and the stats will
  look perfectly healthy
- dispose properly

**Do not wire the asset into a builder yourself** — another agent owns those files.
Deliver the loader and the asset, and say exactly how to wire it in one line.

## Verify

```
npx tsc --noEmit -p tsconfig.json     # clean
npm run <your asset script>            # produces the .glb, reproducibly
npm run capture -- --tag blend         # must still pass, ZERO page errors
```

Report: which asset, why, its triangle count, its decoded texture VRAM, the build time,
and **open a render of the asset** (Blender viewport render or a capture) with the Read
tool and describe what you actually see. Do not claim PBR quality you have not looked at.
