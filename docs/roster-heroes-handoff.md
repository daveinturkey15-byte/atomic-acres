# Roster heroes — source-only handoff (MP5 / M14 EBR / LMG)

Stage: **recipe-authored, source-only**. Not accepted runtime. No in-game
deployment claim, no renders, no GLBs yet. Actual generation/rendering and
acceptance are root's later step; this slice reports source-only honestly.

Comparison baseline kept, unmutated: `public/assets/catalog-carbine/carbine.glb`
(10,836 tris, 3 mats, 2×1K PNG). Nothing below touches it.

## What was delivered (4 new files, no existing module changed)

- `scripts/blender/build_roster_heroes.py` — editable Blender-native recipe.
- `scripts/assets/verify-roster-heroes.mjs` — GLB validator, strict-by-default.
- `work/roster-heroes/manifest.json` — design tables, provenance, budgets.
- `docs/roster-heroes-handoff.md` — this file.

## Reference targets (frozen root catalog, 2D guide only)

| Gun | Reference (read-only root) | sha256 |
|---|---|---|
| mp5 | `docs/reference/production-catalog/weapons/mp5.png` | `0A19EA14…E8DE649` |
| m14-ebr | `docs/reference/production-catalog/weapons/m14-ebr.png` | `7CC4FDE1…8809E104` |
| lmg | `docs/reference/production-catalog/weapons/lmg.png` | `C0FA3D2C…D3103FB5` |

Full hashes in `work/roster-heroes/manifest.json`. Images were used as art
reference for silhouettes and material regions. **No image-to-3D conversion was
performed**; every mesh is explicit `from_pydata` code (boxes, cylinders,
extruded rails), same authoring family as the carbine lane.

## Why these are not recolored carbine clones

Each gun carries the receiver/barrel/stock/magazine/grip/rail/optic its role
needs; the part lists do not overlap the carbine's AR-15 anatomy:

| Part | MP5 (13 meshes) | M14 EBR (14) | LMG (16) |
|---|---|---|---|
| Receiver | short stamped box + trigger housing | chassis spine + separate receiver + bolt handle | bulky box + hinged feed cover + tray |
| Barrel | 100 mm jacket + compact muzzle | 380 mm tube + 3-ring brake | QC tube + ribbed heat shield |
| Stock | collapsed sliding rails + endplate | fixed precision stock + cheek riser + buttpad | fixed stock + buttpad |
| Magazine (real object, pivot below) | straight box mag | short 20-rd box | side-hung ammo box + feed chute |
| Grip | trigger-pack frame + paddle | steep pistol grip | raked grip |
| Rail | short claw rail over receiver | full-length top + side rails | short cover rail |
| Optic/sight | hooded post + drum diopter (irons) | tube scope + turrets + bell (only scope in slice) | carry handle + post/aperture (irons) |

Material regions are readable per gun via distinct metal/polymer/accent triples
(blued/polymer/rubber on MP5; parkerized/graphite/glass-accent on EBR;
worn-metal/olive/polymer-black on LMG), each wired to procedural basecolor +
ORM textures with metalness in Blue and roughness in Green.

## Recipe

```text
blender --background --factory-startup --threads 2 \
  --python scripts/blender/build_roster_heroes.py -- --gun all --out <repo-root>
```

- Blender 5.1.2, CPU asset building only. No Cycles bake, no render, no
  subdivision, no booleans (bevel ≤2 segments only), no external downloads.
- Per gun, fresh scene: 3 Principled materials (BSDF looked up by node type),
  2 deterministic procedural 1024 PNGs (pixel-filled, packed + saved), UVs via
  `smart_project` packed into a 5×4 atlas, exact `anchor_*` empties, identity
  transforms on all meshes (reload pivot lives at `anchor_mag`, see below).
- Pre-export gate fails fast on: stray bounds, 1 m unit cubes, forbidden
  modifiers, unapplied scale/rotation, non-finite/out-of-tile UVs, missing or
  drifted (>5 mm) sockets, missing magazine object, or budget breach
  (≤14000 tris, ≤18 draws, ≤3 materials, ≤2 PNGs).
- Outputs per gun: `work/roster-heroes/<gun>.blend`,
  `work/roster-heroes/<gun>_{basecolor,orm}_1k.png`,
  `public/assets/roster-heroes/<gun>.glb` — not loaded by baseline.
- Guard envelope for root's run: 2 GiB private/RSS cap, ≥12 GiB system free
  RAM, ≥3 GiB free VRAM (recipe itself is CPU-only, 2 threads).

## Validator

```text
node scripts/assets/verify-roster-heroes.mjs --strict [--out evidence.json]
```

- Decodes the GLB binary chunk correctly: `bufferView.byteOffset` is relative
  to the BIN chunk body (`binStart = 20 + jsonLen + 8`), never to the whole
  file — the exact 8-byte-shift bug the carbine lane caught in its own
  `verify_glb.mjs`.
- Checks, from the file: TRIANGLES-only modes, tris/draws/materials/images
  budgets, PNG magic + IHDR dims ≤1024, **actual PBR wiring**
  (`baseColorTexture` + `metallicRoughnessTexture` on every material),
  4 sockets within 8 mm of the design table (table flipped Blender→glTF:
  `(x,y,z)→(x,z,−y)`), a real magazine/ammo-box node with `anchor_mag`
  inside its bounds (+12 mm), sane world bounds, UVs present/finite/[0,1].
- **Fails in all modes until the GLBs exist** (`ASSETS_MISSING`, exit 2), so a
  source-only checkout is honestly red; `--strict` additionally turns texture
  warnings into failures.

## Loader integration contract (no runtime patch yet)

A future loader mirrors `src/weapons/catalog-carbine-loader.ts` without
changing it:

1. New `ROSTER_HERO_GLB_URLS = { mp5: './assets/roster-heroes/mp5.glb', … }`;
   baseline imports nothing from `public/assets/roster-heroes/`.
2. Reuse the proven pattern: canonical-URL master cache + refCount + orphaned
   entries + generation-guarded pending loads; strict socket verification with
   the same 4 names — missing sockets reject the asset and engage the
   procedural fallback, never fabricated.
3. Orientation is identical to carbine: forward −Z, up +Y, right +X (Blender
   +Y forward through `export_yup`). `anchor_muzzle` drives muzzle flash/
   tracer origin; `anchor_grip`/`anchor_support` parent the existing
   first-person hands; renderOrder/frustum/shadow traits per
   `applyViewmodelMeshTraits`.
4. Reload pivot: `anchor_mag` sits exactly at the magazine feed-top (MP5/EBR)
   or ammo-box chute interface (LMG, x≈−0.06 side-hung). Runtime re-parents
   the `<…magazine|ammo_box>` node under `anchor_mag` with its baked offset
   and rotates about the anchor; mag meshes stay at identity transforms so
   `export_apply=True` never destroys the pivot.
5. Material note: 3 GLB materials per gun stay inside the asset; shared
   `MaterialLibrary` singletons remain the fallback's property and are never
   disposed by asset teardown (`disposeOwnedGeometries` for owned geometry
   only).

## Provenance and licenses

- Recipe code (`build_roster_heroes.py`, `verify-roster-heroes.mjs`): repo-owned
  original code, authored in this lane.
- Output assets on export (GLB + embedded procedural PNGs): original
  project-authored game art; no third-party mesh, texture, module, or
  old-project asset copied. Reference images are not embedded.
- No billable endpoint was invoked; no image-to-3D ran in this slice.

## Honest status and next step for root

- Done: editable recipe, strict validator, manifest, handoff. Syntax-checked
  (`py_compile`, `node --check`, JSON parse); **never executed in Blender** —
  no GLBs, no renders, no measurements exist yet.
- For root's guarded run: build (`--gun all`), verify (`--strict`), look at
  actual frames against the three reference sheets with the carbine as the
  quality bar, then decide on loader wiring. Expected: each gun well under
  budget (boxes ≈12 tris, 14-seg cylinders ≈60 tris; rails dominate but stay
  in the low thousands).
