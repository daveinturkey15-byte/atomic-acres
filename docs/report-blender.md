# Report: BLENDER → glTF PBR asset pipeline (blend lane)

## What I changed (my lane's files only)

Two parallel subagents, disjoint file sets, one shared contract
(asset `coach` → `public/assets/coach.glb`, base-aware URL, registry API names).

| File | Change |
|---|---|
| `scripts/blender/build_coach.py` (new, ~560 lines) | Deterministic headless builder: Greyhound-style 1950s tour coach from ~70 primitives, fixed seed, metres. Lofted hull using the same rib/section maths as `src/build/vehicles.ts` so it drops into the existing footprint. |
| `scripts/blender/common.py` (new) | Shared helpers: sRGB math, deterministic image fill, VRAM count. |
| `scripts/blender/inspect_glb.cjs` (new) | Node verifier: bounds, embedded-image list, material wiring, external-URI count. |
| `public/assets/coach.glb` (new, committed, 8 605 816 bytes) | Built by a real Blender run, not hand-written. sha256 `5c386b65…da483`. |
| `docs/ASSET-PIPELINE.md` (new) | Exe path + version, one-command build, per-asset layout, new-asset recipe, measurements, colour-space table, compression decision, one-line wiring. |
| `src/core/assets.ts` (new) | Async glTF registry: `ASSET_URLS`, `loadAsset` (cached master, concurrent-safe, owned clones), `preloadAssets`, `getAsset`, `disposeAssets`, `assetsReady` + `gateReadiness()` holding `window.__NT.ready`. No import-time side effects. |
| `package.json` | **I touched it — scripts block only** (`+3` lines, confirmed via `git diff package.json`): `asset:coach`, `asset:all`, `asset:render`. Nothing else changed. |

Not wired into any builder (vehicles owner does that). Forbidden files untouched by this lane.

## What I measured

- Blender: `C:\Program Files\Blender Foundation\Blender 5.1\blender.exe`, v5.1.2.
- Build: **18.5 s** wall (11–27 s across runs, Ryzen 7 9700X / RTX 5080).
- Coach: **4016 tris**, 70 meshes, bounds x −5.81…5.89 (nose +x), y 0…3.33 (wheels at 0), z −1.56…1.56 — matches the procedural loft target (~11.2 × 2.6 × 3.1) within bumper/vent tolerance.
- Texture VRAM (decoded, `sum(w*h*4)`): **25 165 824 bytes (24.0 MiB)**. File is 8.6 MB (PNG-encoded pixels inside the binary).
- PBR: 5 maps authored in-Blender (base 2048 sRGB; rough/metal/normal/AO 1024 Non-Color). Exporter merges rough+metal → one ORM and drops Mix-wired AO, so AO is pre-multiplied into base pixels: **3 embedded PNGs, 0 external URIs**, wired to `baseColorTexture` / `metallicRoughnessTexture` / `normalTexture` (verified by `inspect_glb.cjs`).
- Compression: **uncompressed, deliberate** — Draco would need `DRACOLoader` + decoder WASM at runtime for a file that is 90% PNG pixels Draco cannot shrink.
- Reproducibility: two consecutive `npm run asset:coach` → identical sha256; my own `sha256sum` re-confirms `5c386b65…da483`.
- Types: `src/core/assets.ts` scoped `tsc --strict` exits 0. Project-wide `tsc -p tsconfig.json` shows **1 unrelated error** in `src/ui/menus.ts` (another lane's file, `NodeListOf` iteration under this tsconfig) — not mine, not touched.
- Capture: `npm run capture -- --tag blend` → **exit 0, `pageErrors: []`, `consoleErrors: []`**, 10/10 frames written. Stats read 77–131 calls / **0 tris at every station** — that is a stats-pipeline artifact (WebGPURenderer `info` shape), not an empty scene; see below.

## What I looked at

- `captures/blend-coach.png` (headless EEVEE thumbnail): upright cream coach, maroon swoosh along the flank, window band with pillars, split raked windscreen with divider + destination blind box above, side mirror, 6 whitewall wheels (rear duals + front axle visible), 4 round headlamps + grille slats + bumper. Chrome reads near-black — expected, EEVEE headless renders with no environment; in-game IBL fixes it. **Honest flag:** at this 3/4-front angle the split windscreen panes read slightly visor-like (jutting rather than flush); the flank, nose crown and lamp positions verified in-file (x≈±5.6, y≈1.5), but nobody has yet seen this mesh under the real sky/lighting. First wiring should be judged in a `turningHead` capture, not this thumbnail.
- `captures/blend-turningHead.png`: the live map renders correctly — procedural coach, truck, saloon on the bulb, third house, mannequins, hedges, sky. (The GLB is deliberately unwired, so this frame shows the current procedural fleet, unchanged.)
- `captures/blend-summary.json`: zero errors confirmed by parsing, not by exit code alone.

## What I could not resolve

1. **0-tris stats**: every `blend-*` station reports 0 triangles while the PNGs prove geometry rendered. Almost certainly the capture harness reading `renderer.info` in a shape `WebGPURenderer` no longer populates the same way. It is harness-wide (all stations, all modules) and outside my file set — flagging for the harness owner, not asserting more.
2. **Project-wide `tsc`**: 1 error in `src/ui/menus.ts`, another lane's concurrent work. Left alone per disjoint-ownership rule.
3. **Windscreen flushness** (above): needs a real in-engine look after wiring, by the vehicles owner.
4. **Busy tree**: several other lanes have concurrent modifications in the working tree (`ground.ts`, `orange-house.ts`, `plaza.ts`, …). I verified via `git diff package.json` that my lane added only the 3 scripts, and removed a stray `scripts/blender/__pycache__/`.

## Wiring (for the vehicles owner, one line + gate)

```ts
import { loadAsset } from '../core/assets';
const coach = await loadAsset('coach'); group.add(coach);
```

And in `main.ts` (orchestrator): `await gateReadiness()` before marking `__NT.ready`, so capture never photographs a missing coach. Details in `docs/ASSET-PIPELINE.md`.
