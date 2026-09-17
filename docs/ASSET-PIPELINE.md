# Asset pipeline: Blender → glTF (Nuketown 2025)

Hero assets are authored **here, from scratch, by scripts in this repo** — never
downloaded. One npm script rebuilds each asset deterministically (verified
byte-identical across runs, sha256 `5c386b65…da483` twice in a row).

## Toolchain

- Blender exe: `C:\Program Files\Blender Foundation\Blender 5.1\blender.exe`
- Version: **5.1.2** (`blender.exe --version`, build 2026-05-19)
- three.js `^0.180.0`, `THREE.WebGPURenderer` — the `.glb` is plain glTF 2.0
  binary, no backend-specific extensions, loads with stock `GLTFLoader`.

## One-command build

```
npm run asset:coach    # headless Blender build -> public/assets/coach.glb
npm run asset:all      # alias (single asset for now)
npm run asset:render   # rebuild + headless render -> captures/blend-coach.png
```

Windows note: the scripts use a `call "...blender.exe"` prefix. Bare
`"C:\Program Files\...\blender.exe" args` works when pasted into a shell, but
`npm run` wraps the line as `cmd /d /s /c "..."`, and cmd's `/s` handling
strips the quotes off a leading quoted path (`'C:\Program' is not recognized`).
Leading with `call` sidesteps that with zero behaviour change.

## Per-asset file layout (coach)

```
scripts/blender/build_coach.py   # --background --python entry, all geometry + maps
scripts/blender/common.py        # shared helpers (sRGB math, image fill, VRAM count)
scripts/blender/inspect_glb.cjs  # node verifier: bounds, embedded-image + wiring check
public/assets/coach.glb          # built output, committed (8 605 816 bytes)
captures/blend-coach.png         # headless EEVEE thumbnail of the asset
```

## How to add a new asset `<name>`

1. Copy `scripts/blender/build_coach.py` → `scripts/blender/build_<name>.py`.
   Keep the contract: fixed seed, metres, origin at ground centre, nose/forward
   documented, `COACH_BUILD`-style stats line (`time_s / tris / vram_bytes / glb_bytes`).
2. Author geometry **y-up** (three.js convention) and keep the world-space
   `matrix_world = ROLL @ matrix_world` step before export — Blender models
   z-up, and bumping `rotation_euler.x` instead corrupts any object that already
   has rotation (Blender XYZ Eulers apply X first, so it is not a global roll;
   this exact bug once threw every lamp 5 m under the map).
3. Add `"asset:<name>": "call \"<same exe>\" --background --python scripts/blender/build_<name>.py"`
   to `package.json` scripts, plus a `-- --render` variant if you want a thumbnail.
4. Run it, record time/tris/VRAM below, commit the `.glb`.

## The coach (`coach.glb`) — measured

| | |
|---|---|
| Build time | **18.5 s** wall (11–27 s across runs on Ryzen 7 9700X / RTX 5080) |
| Triangles | **4016** (70 meshes, one LoD, no compression) |
| Texture VRAM (decoded) | **25 165 824 bytes (24.0 MiB)** — `sum(w*h*4)` over embedded images |
| File size | 8 605 816 bytes (PNG-encoded images inside the binary) |
| Bounds (glTF, metres) | x −5.81…5.89 (nose +x, bumpers incl.), y 0…3.33 (wheels rest y=0), z −1.56…1.56 (mirrors; body ±1.30) |
| Scale check | ~11.7 long / 2.6 wide / 3.3 tall vs `src/build/vehicles.ts` loft target 11.2 × 2.6 × 3.1 — matches within bumper/vent tolerance |
| Reproducibility | two consecutive `npm run asset:coach` → identical sha256 |

What it is: Greyhound-style 1950s tour coach from ~70 primitives — lofted hull
(same rib/section maths as the procedural loft, so it drops into the existing
footprint), raked crowned nose, split windscreen with divider + dark frames,
destination blind, chrome belt + grille + bumpers + mirrors, 6 whitewall wheels
(3 axles) with chrome hubs, 4 head + 4 tail lamps. Palette families from
`src/core/palette.ts`: cream `0xe8e0cd`, maroon `0x7c2a33`, chrome `0xc8ccd0`.

## PBR maps (baked in-Blender, embedded — zero external URIs)

Five maps are generated deterministically in-Blender (seeded hash grain, no
lights, no downloads); the exporter packs them to three embedded PNGs:

| Authored map | Size | Colour space flag | Lands in the .glb as |
|---|---|---|---|
| `Coach_Body_BaseColor` (cream + grain + AO pre-multiplied) | 2048² | **sRGB** | `baseColorTexture` |
| `Coach_Body_Roughness` (~0.45 + grain) | 1024² | **Non-Color** | merged → `metallicRoughnessTexture` (G) |
| `Coach_Body_Metallic` (0.05 body) | 1024² | **Non-Color** | merged → `metallicRoughnessTexture` (B) |
| `Coach_Body_Normal` (flat tangent-space 128,128,255) | 1024² | **Non-Color** | `normalTexture` |
| `Coach_Body_AO` (0.92 + grain) | 1024² | Non-Color | **pre-multiplied into base-colour pixels** |

Two exporter facts this design respects: (1) glTF-Blender-IO merges
roughness+metallic into one ORM texture — hence one 1024² `…Metallic-Coach_Body_Roughness`
image; (2) a Mix/Multiply node combining base colour × AO is **not** understood
by the exporter (the AO image is silently dropped), so the AO multiply happens
in the pixel-fill instead and the base texture is wired straight into Principled
BSDF. Getting sRGB-vs-Non-Color wrong here is the classic washed-out/pitch-black
glTF bug — the flags above are the whole defence. Trim/chrome/glass/rubber
materials are uniform Principled (no maps needed); chrome reads dark in the
thumbnail because EEVEE renders with no environment — in-game IBL fixes that.

Verify anytime: `node scripts/blender/inspect_glb.cjs` (bounds, image list,
material wiring, external-URI count = 0).

## Compression decision

**Uncompressed.** Blender 5.1 can write Draco-compressed GLBs, but three.js then
needs `DRACOLoader` plus a decoder WASM fetch at runtime — an extra async
dependency for the loader and the capture harness to trip over, for little gain
on an 8.6 MB file that is already 90% PNG pixels Draco cannot compress anyway
(Draco packs geometry, not images). Revisit only with a second, geometry-heavy
asset and a measured win.

## One-line builder wiring (loader lane owns `src/core/assets.ts`)

```ts
import { loadAsset } from '../core/assets';
const coach = await loadAsset('coach'); group.add(coach);
```

`assetsReady` / `gateReadiness()` hold `window.__NT.ready` until preload
settles, so the capture harness never photographs a missing coach. This lane
does **not** wire any builder — placement stays with the vehicles owner.

## Package.json

**I touched `package.json` — scripts block only**, adding `asset:coach`,
`asset:all`, `asset:render`. Nothing else in the file changed.
