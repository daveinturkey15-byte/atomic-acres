# Report — MAKE IT SHINE (post chain, reflections, material response)

Lane: shine. Files owned: `src/core/world.ts`, `src/core/renderer.ts`, `src/core/post.ts` (new), `src/core/materials.ts`.
`renderer.ts` ended up untouched (0 lines) — no hook was needed there.

## What changed

**`src/core/materials.ts` (only file in the materials lane).** Every mapped surface now has a
procedural `roughnessMap` + `normalMap` built on canvas with the same pattern as the existing
colour maps (new module-level helpers: linear `dataTex`, seamless `blotches` mottling,
wrapped-Sobel `normalFromHeight` → `normalTex`; zero per-frame allocation, standard maps only,
no new shader features). Per-surface, following CONCEPT-BAR §1–9 bands:

- paving: roughness base 0.65 with per-slab jitter, joints 0.85, dust films; normal has recessed joints
- asphalt: roughness base 0.9 with elongated diagonal wheel-polish blobs, darker-smoother wet/oil
  blotches + oil-drop spots; colour map gained matching dark polish/oil blotches; grain normal
- stuccoCream 0.58 / stuccoTerracotta 0.78 / capsuleWhite 0.42 (glossiest wall, envMapIntensity 0.6),
  each with stipple normal; grubby mottling in colour+roughness on cream/terracotta
- timber 0.80 / timberDark 0.82 / deckBoards 0.78: per-board jitter, silvered streaks,
  grime-rough gaps, grooved normals
- lawn: roughness 0.95 with the mow stripes mirrored as VALUE bands (0.92/0.95) + dry/wear blotches;
  fine-blade normal. hedge: 0.96 lump variation + blobby normal
- concrete/kerb/sand: roughness + grain/ripple normals (sand: seamless 16-period wind ripples);
  colours stay flat PAL values
- glass: no maps (meaningless on glazing); roughness 0.06→0.08 (spec band), envMapIntensity 1.4→1.6.
  windowDark 0.13→0.12, env 1.9→2.0. chrome 0.16→0.12 (trim band 0.08–0.12)
- Mapped materials set scalar `roughness: 1` with absolute values baked in the map (three multiplies).
- Singletons kept: `buildMaterials()` shape unchanged, all `MaterialLibrary` fields present,
  `painted()/emissive()/signText()` caches unchanged; `std()` now also disposes the new maps.
- Honest approximation: true grade-anchored bands (kerb bottom-40 mm grit wash, stucco ground band,
  kerb-top-only wear) cannot live in repeating tiles without striping — implemented as tile-safe
  seamless mottling instead. All blobs are edge-inset so every map tiles.

**`src/core/post.ts` (new) + `src/core/world.ts` (integration + light rig).**
- `post.ts` exports `buildPost(renderer, scene, camera) → { render, setSize, dispose, enabled, backend }`.
  WebGPU path: scene pass with MRT (beauty + normal/metalness/roughness) → GTAO `ao()` multiplied
  into beauty → SSR `ssr()` composed additively, inside try/catch that falls back to the env-map path
  → `bloom(graded, 0.35, 0.15, 1.0)` (tight, threshold 1.0: glints only) → inline TSL vignette
  (0.18, achromatic). `outputColorTransform` left enabled so renderer-owned ACES/exposure 1.09 applies once.
  Non-WebGPU backend (same `isWebGPUBackend` probe as `renderer.ts`) or any build-time throw →
  direct `renderer.render`, `enabled: false`. No per-frame allocations.
- `world.ts`: `const post = buildPost(renderer, scene, camera)` after lights; `World` gains
  `render()` (→ `post.render()`), `postEnabled`, `postBackend`; `resize()` forwards to `post.setSize`,
  `dispose()` to `post.dispose()`. `createWorld` signature and all existing fields unchanged.
  No `rebuild`-on-`ready`: `post.ts` exports no rebuild method and none was invented.
- Light rig: sun warmed (`PAL.sunColor` offsetHSL(−0.008, +0.05 sat, −0.004), 3.05→3.2);
  hemi sky colour `PAL.skyHorizon`→`PAL.skyTop` (cooler), 1.15→1.05; fill cooled a step, 0.34→0.30.
  SUN_DIR, sky dome, env bake, fog, shadow fit, ACES/exposure untouched.

## What I measured

- `tsc`: zero errors in `materials.ts`, `post.ts`, `world.ts`, `renderer.ts`. The repo has
  pre-existing errors in `src/ui/menus.ts` + `src/weapons/controller.ts` (other lanes' concurrent work).
- `npm run capture -- --tag shine`: 10 stations, **ZERO page errors, ZERO console errors**.
  Textures 21→54 (the new maps); geometries ~450.
- `npm run traverse`: **5/5 routes PASS, handedness PASS**, 4/4 house faces enterable.
- fps: headless capture reports ~60 fps before and after — that number is vsync-capped and meaningless
  as a before/after. The brief's 284–317 fps published-build figure was NOT remeasured, and the post
  chain's GPU cost was NOT measured (see below). No fps claim is made.

## What I looked at (opened, not assumed)

`shine-streetElevation`, `shine-aerial`, `shine-yardOrange`, `shine-turningHead` + `ship-streetElevation`
for comparison. Improved: asphalt/paving now carry visible grain, polish variation and slab joints
instead of flat fills; lawn checker crisp; deck-board/timber variation reads; shadows dark; nothing
blown or crushed. **Not achieved:** sunlit window glass still reads dark blue-grey, roughly as in `ship-*`
— CONCEPT-BAR item #1 (glass paler than shaded cream wall, mullion rhythm in glass) is still open; the
env bump was not enough. The asphalt polish blotches read slightly strong/patchy in streetElevation
(more dappled-light than wheel-wear) — easy tune: lower the blotch alpha in the asphalt painters.

## What I could not resolve — orchestrator must read this

1. **The post chain is built, wired, but NOT live in any frame.** `main.ts` (not my file) still calls
   `world.renderer.render(...)` in `frame()`, `qa.goto()` and `qa.render()` — never `world.render()`.
   Every shine capture above is materials + light rig only. GTAO/SSR/bloom are compile-clean and
   fallback-safe but **visually unverified**. Wiring (orchestrator, in `main.ts`): replace the three
   `world.renderer.render(world.scene, world.camera)` calls with `world.render()`. Note the weapons lane
   added a second viewmodel pass after the main render — decide ordering with that lane.
2. **Headless cannot exercise the chain anyway.** This machine's headless Chromium reports
   "No available adapters" → silent WebGL2 fallback, where `post.ts` correctly returns the direct-render
   fallback. GTAO/SSR/bloom need a WebGPU-capable eyeball session after wiring; measure fps there —
   if the chain costs more than half the frame budget, gate it behind a quality flag (brief's rule).
   SSR ships with a per-pass try/catch already; if it artifacts on glazing/road, delete the `ssr` line
   and the env path carries reflections.
3. **Stats anomaly, explained not hidden:** the shine run reports calls 60→114/station with 0 tris and
   0 programs while base reported ~450–526 calls / ~150k tris — yet the PNGs (0.5–1.1 MB) show the full
   scene. Cause: the tree is shared with other lanes; the weapons lane's `main.ts` edit (extra render
   pass + `clearDepth`/`autoClear` juggling) plus the WebGL-fallback info path changed what
   `renderer.info` reports at `stats()` time. The frames are the evidence; the counters in
   `shine-summary.json` are not comparable across runs. Do not quote them as a perf win/loss.
4. **Traverse flaked twice** (`waitForFunction __NT.ready` timeout) then passed 5/5 unchanged. A
   traverse-style probe showed `ready: true` on first poll with a clean boot — the timeouts smell of
   concurrent-lane file saves hitting vite mid-run, not a product bug. Re-run gates on a quiet tree
   before shipping.
