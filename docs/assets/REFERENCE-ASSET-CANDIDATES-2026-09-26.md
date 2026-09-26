# Reference asset candidates — 2026-09-26

VERIFIED: This is a read-only reference inventory and proposed mapping. No asset, source module, generator or Git history was copied. Only this document was written. No renderer, Blender, GPU job or download was run.

## Identity and authorization

- VERIFIED: Reference checkout: `C:/Users/david/Desktop/stuff/atomic-acres`, branch `contrib/dave-gaming-pc/codex/world-studio-20260912`, HEAD `950d84bd98332a97c9913c3bf3e2149fe57161fa`. It remains the historical predecessor, not the selected restart.
- VERIFIED: Candidate checkout: `C:/Users/david/Desktop/stuff/worktrees/nuketown-salvage-20260926`, branch `salvage/full-game-20260926`, observed HEAD `df38222339de139c41a1be482570092720b0256d`; later dirty host/reward work is separate from this inventory.
- CLAIMED: The integrator relayed new owner steering authorizing useful owner asset reuse and overnight polish. That supersedes the historical blanket no-asset-copy restriction for a scoped asset intake. Modules/history remain excluded. Exact import target paths still belong to the integrator.

## Measured census and immediate value

- VERIFIED: The reference `public/assets` contains 178 GLBs (110.33 MiB), 330 PNGs (86.42 MiB), 51 WebPs (8.14 MiB), 15 JPGs (3.62 MiB), one glTF (3.21 MiB), plus videos and small metadata/license files. These are census figures, not an import proposal.
- VERIFIED: All eleven currently borrowed loadout weapons have individually authored `*-fp-lod0.glb` files and corresponding thumbnails. Their combined first-person LOD0 payload is 3,428,416 bytes. Every LOD0 SHA-256 below matches its individual checked-in provenance receipt.
- VERIFIED: Twenty firearm WebPs total 190,404 bytes. Add `public/assets/original/ui/pass65-crossbow-hero-quarter.webp` (21,934 bytes) for a 21-image / 212,338-byte pack covering twenty loadout weapons plus Crimson. Firearm images are 480×360 RGB; crossbow is 640×480 RGB. They have no alpha.
- VERIFIED: Viewed AK-47, Mini Uzi, Magnum and Minigun images. They are recognizably different stylized models, with studio background and baked caption bars. They are useful menu illustrations; they are not transparent icons or evidence of photoreal quality. Cropping/layout must be checked at actual card size, especially for the legacy names in captions.

## Eleven borrowed-model mappings

VERIFIED: Each row maps the same restart weapon ID to `public/assets/original/models/weapons/pass65-firearms/<id>/<id>-fp-lod0.glb` in the reference checkout. Its receipt is `source-assets/blender/pass65-weapons/<id>.provenance.json`. Triangles/primitives are read from actual glTF accessors, not copied from receipt totals.

| Restart ID | Bytes | Triangles | Primitives | SHA-256 |
|---|---:|---:|---:|---|
| `mp5` | 239,332 | 8,468 | 6 | `cc59b90320395b672662f6ea44fc56e34167485bee7fb1a9ce488cf633033247` |
| `mini-uzi` | 260,456 | 11,424 | 7 | `1dfd91a34d7d64503561d8ec741ff10ed7f431f545c7ff3a41fe88534f8a0428` |
| `machine-pistol` | 332,928 | 13,276 | 12 | `06a4c5769fdeb6ec9c63455a32ab19dcba2b3b0318453665d43030fd344896fb` |
| `m4a1` | 535,112 | 32,300 | 8 | `9b52f1e02d9aa73f3141d4640eb4034cae25540e281141f06895f0fb94226e35` |
| `ak-47` | 288,300 | 8,228 | 5 | `6973ab8a4f9d8ba143f258651c226d2c18df3b33d4987e8993450aa7cdbd70ec` |
| `lmg` | 303,164 | 12,756 | 8 | `b271e80ebd6146511a30e393c57965c130f6e22592d0b92a34ce7d62bfc996b7` |
| `minigun` | 213,428 | 10,840 | 8 | `bc7c965c3931ca2cce575a98552532b46fae11f41e313d3b03940cf726583a3b` |
| `m14-ebr` | 291,556 | 10,484 | 7 | `8e6c85f4216436eea451344a06b6a76d5da51e742171962f8851cae9b79f2a4b` |
| `slug-shotgun` | 255,576 | 8,376 | 8 | `8f74adb17d1d81dd555166e91fc233774c793fce5d1df07dc320759dc225494d` |
| `magnum` | 313,408 | 12,616 | 9 | `e5a8b7eddbc38a0b2906edb3333459b775e31acf2c0dc2689249e76c0e973048` |
| `flashlight-pistol` | 395,156 | 18,272 | 10 | `c3e26b8730fee03e2f23f1e41a0d8404a8282581e8033eeb7ffd975d80819727` |

## Bounded first intake proposal

OPEN: Proposed destinations are new asset-only folders. Do not overwrite any existing model, source, rejected variant or procedural fallback. The following four candidate units are a menu pack plus three individual models; adoption must remain per-ID and contingent on actual rendering.

| Priority | Candidate and value | Proposed destination | Bounded import |
|---|---|---|---|
| 1 | Menu illustration pack: removes the identical rifle glyph across the loadout list immediately | `public/assets/reference-weapons/ui/<restart-id>.webp` | 21 original WebPs, 212,338 bytes; SHA table below; preserve baked originals |
| 2 | Mini Uzi: compact receiver, grip magazine and wire stock instead of a borrowed SMG | `public/assets/reference-weapons/mini-uzi/mini-uzi-fp-lod0.glb` | 260,456 bytes, 11,424 triangles, 7 primitives |
| 3 | Magnum: visibly larger slide and bore than the shared Duster pistol | `public/assets/reference-weapons/magnum/magnum-fp-lod0.glb` | 313,408 bytes, 12,616 triangles, 9 primitives |
| 4 | Minigun: strongest silhouette correction, six-barrel cluster and ammunition drum instead of a rifle | `public/assets/reference-weapons/minigun/minigun-fp-lod0.glb` | 213,428 bytes, 10,840 triangles, 8 primitives; highest hand-fit risk |

VERIFIED: Proposed runtime payload totals 999,630 bytes before small provenance metadata. AK-47 is an alternative fourth model with simpler central grip geometry (288,300 bytes, 8,228 triangles, 5 primitives) if Minigun hand fitting exceeds the bounded pass. These choices are recommendations from source structure and existing review images; no new in-game adoption was tested.

VERIFIED: The restart already contains independent `public/assets/roster-heroes/mp5.glb` (3,042,956 bytes), `m14-ebr.glb` (3,063,420 bytes) and `lmg.glb` (2,893,668 bytes), plus their dedicated loader and sight anchors. Review those existing candidates before importing duplicate old versions. They differ in bytes/contract from the reference corpus.

## Import contract and actual constraints

- VERIFIED: All eleven GLBs are self-contained: no image or buffer URI dependencies. Each has 13 named clips: equip, unequip, idle, walk, sprint, ads-in, ads-out, fire, dry-fire, reload, empty-reload, melee and inspect. Presence is verified; correct animation playback in the restart is OPEN.
- VERIFIED: They require `EXT_meshopt_compression`, `EXT_texture_webp` and `KHR_mesh_quantization`. The restart weapon loaders currently construct plain `GLTFLoader` without a Meshopt decoder, so these files are not a URL-only swap. Use the pinned Three.js decoder/loader contract in a new bounded adapter; do not import predecessor runtime modules.
- VERIFIED: Selected Mini Uzi/Magnum/Minigun each embed five 512×512 RGB WebPs: normal, polymer base color, polymer packed metallic/roughness, metal base color and metal packed metallic/roughness. Retain their authored UV-bound maps; generic world textures are not replacements. A five-map RGBA upload is about 6.7 MiB including mipmaps before implementation-specific overhead.
- VERIFIED: Delivery roots contain a Y half-turn quaternion and declare local −Z forward. Preserve the root transform. Source socket coordinates must be transformed through the node hierarchy; do not copy raw local translations into the new rig.
- VERIFIED: Old socket names differ from the restart contract: `grip-socket-r` → `anchor_grip`, `support-socket-l` → `anchor_support`, `magazine-socket` → `anchor_mag`, `muzzle-socket` → `anchor_muzzle`; old `eject-socket`, `rear-sight-socket`, `front-sight-socket` are also present. `weapon-magazine` and animated action owners must remain intact.
- OPEN: Fit scale from actual socket distances and existing hand contact, then solve ADS from the rear/front sight pair. The declared lengths are stylized: Mini Uzi 0.78 m, Magnum 0.76 m, Minigun 1.94 m, AK-47 1.42 m. They are not accepted physical sizing. Do not apply one scale to all guns.

VERIFIED: Selected transformed socket positions, computed from the GLB node hierarchy at bind pose (metres as declared):

| ID | Right grip | Support grip | Muzzle | Rear sight → front sight |
|---|---|---|---|
| `mini-uzi` | `(0, −.23, .18)` | `(.12, −.04, −.28)` | `(0, .04, −.56)` | `(0, .23, .17)` → `(0, .22, −.31)` |
| `magnum` | `(0, −.22, .22)` | `(.10, −.05, −.22)` | `(0, .075, −.59)` | `(0, .20, .13)` → `(0, .20, −.47)` |
| `minigun` | `(−.28, −.20, −.05)` | `(.28, −.14, −.20)` | `(0, .05, −1.23)` | `(0, .34, .12)` → `(0, .34, −.55)` |

OPEN: Minigun side grips differ materially from the restart rifle hand pose. Retain the current hand source and make any permitted fit a separate adapter, with contact/ADS review. No hand or gun is accepted merely because its socket names exist.

## Provenance, rights and retained editables

- VERIFIED: Individual receipts state creator/owner `Atomic Acres project`, license `Project-original; no third-party meshes or textures`, procedural PBR and original Blender geometry. This is checked-in provenance evidence, not an independent legal audit. The three shortlisted GLBs and their original review PNGs match receipt hashes.
- VERIFIED: Editable corpus source remains at `source-assets/blender/pass65-weapon-families.blend`, 43,485,382 bytes, SHA-256 `650f0286bc702996887fc80d291494d86f040a5f5ae3d1712aa8f61d7695f892`, matching the receipts. `source-assets/blender/pass65-weapon-family-specs.json` and individual provenance JSONs remain alongside it. Keep these references and original sources; do not flatten or replace them. Generators are referenced by receipts but no generator/module is part of this import.
- VERIFIED: Original review sheets remain under `docs/assets/pass65-weapons/firearms/<id>/`. The historical README calls the corpus a stylized production candidate and explicitly leaves owner visual acceptance open. Historical acceptance claims are not current acceptance.
- VERIFIED: Quaternius `animated-guns` contains four compact GLBs plus local attribution/license files. The [official pack page](https://quaternius.com/packs/animatedguns.html) currently lists CC0. These generic Rifle/P90/Pistol/Shotgun shapes do not fill the eleven ID-specific gaps as well as the project-original corpus; retain as fallback references.
- VERIFIED: The local DJMaesen FPS arms license records CC BY 4.0 attribution requirements. These arms are not proposed: the current authored hand rig is preserved, and older project docs record a rejected framing/grip candidate.
- VERIFIED: `public/assets/original/world-studio/pbr/manifest.json` records Poly Haven CC0 1k asphalt/concrete maps with provider URLs/hashes and physical scale; the [official Poly Haven license](https://polyhaven.com/license) confirms CC0 for its asset files. These are world-surface candidates, not weapon-map replacements. No map was copied.
- OPEN: Authored hero bus/truck/interior GLBs are present (about 1.34 MB / 1.55 MB / 4.60 MB respectively), but their fit and provenance were not deeply audited in this gun-focused pass; they are not in the proposed intake.

## Menu mapping and exact image hashes

VERIFIED: Source directory is `public/assets/original/ui/pass65-firearms/`, except the crossbow file in its parent directory. Existing identities are preserved: Longhorn uses legacy carbine art, Rattler SMG art, Coachman scattergun art, Deadeye sniper art and Duster pistol art. Baked legacy captions must not be mistaken for the current weapon names.

| Restart ID | Reference image | Bytes | SHA-256 |
|---|---|---:|---|
| `longhorn` | `carbine-hero-quarter.webp` | 9,064 | `304d775b7ec3a85d0f74becb182cfbab77bf232e704e6640ff47ee7c6880c2ce` |
| `rattler` | `smg-hero-quarter.webp` | 9,274 | `a57c4ac7a7e7d25b1e3e9f98fcd03c4a6874148cda3da9988fb2b29aae78a6c4` |
| `coachman` | `scattergun-hero-quarter.webp` | 8,340 | `0d7c9f1e78774f566d60bc69d5d2a9d1b4332aa02a4e1b0f8bdc1179ead66e56` |
| `deadeye` | `sniper-hero-quarter.webp` | 9,464 | `1d34d027fad5c5c2c03968308f2edb9ae8da5c4b738fc528e587ead8101c95e1` |
| `duster` | `pistol-hero-quarter.webp` | 8,246 | `3c8c16ea043242328140ca9d77596febe9626a624f055760ca8db9d44dd19650` |
| `mp5` | `mp5-hero-quarter.webp` | 7,872 | `d97b40a8bccb0a9f41ea81343c9347b79c18c4d0fb545e9bbe1f7df86814c5cd` |
| `mini-uzi` | `mini-uzi-hero-quarter.webp` | 8,104 | `b2a45b4c2d0655767a6f32d2d1b1f682e38987bc9bc310f8c32915ea98be1edf` |
| `machine-pistol` | `machine-pistol-hero-quarter.webp` | 9,298 | `6c34b8aa0eeb6dcdd6d739daf0f8b6c603a60f36a6f022a077f6e72de54729cd` |
| `m4a1` | `m4a1-hero-quarter.webp` | 9,514 | `989a0e20f59cff4ae328e50ab00747fb91b42dc26c3aca2c4f12b5c4bc61c57f` |
| `ak-47` | `ak-47-hero-quarter.webp` | 7,844 | `431527849811152bd9bd102f085db1af78c19eacdb4f4c9fff7dc9ed52ec05f0` |
| `lmg` | `lmg-hero-quarter.webp` | 10,288 | `b64cd26b70ccc979d092bde9a98dd4454bac605c27355ce920b6ebbe2b2c398d` |
| `minigun` | `minigun-hero-quarter.webp` | 10,794 | `2fc905a219755b5741d658a402f56527e41e36c008325425bafd404c3dc43a47` |
| `m14-ebr` | `m14-ebr-hero-quarter.webp` | 10,078 | `0e2b5e6b8dc44e5afd01ee3d554ddaec138abed5bbcb8f32a9c30fda8a6979cf` |
| `slug-shotgun` | `slug-shotgun-hero-quarter.webp` | 8,972 | `457cc1c022d1944d8da84570928af01811210cd0f996e0f833ce99a579d0d927` |
| `magnum` | `magnum-hero-quarter.webp` | 12,198 | `3a34bb2c65b73c27ca3b2e1edea35192a3384da4eb7f1233d8387f43b86d0e07` |
| `flashlight-pistol` | `flashlight-pistol-hero-quarter.webp` | 10,350 | `7de6356e9f3ef135b2a6bb07294cf849edfc272894cb1476791ef164d12a95de` |
| `railgun` | `railgun-hero-quarter.webp` | 12,824 | `cbed6566d4e11b976a7d733d5793b3b1af36eb33dc20dc0ac1a3f441580155f2` |
| `flamethrower` | `flamethrower-hero-quarter.webp` | 9,556 | `94cbd8362edc79ab369e300a2bb3ca03f3c1d9ff341d4e5d7dd1284dccef50c8` |
| `flare-gun` | `flare-gun-hero-quarter.webp` | 7,696 | `ca1982aa4df7b3a5d4c2bba0465ce56f2602a145a9db4132bf1012c1dd309c83` |
| `crimson-flamethrower` | `crimson-flamethrower-hero-quarter.webp` | 10,628 | `440900ef35a67be671026b146b68154d98e9decd4895f8718e70a3d71a651039` |
| `explosive-crossbow` | `../pass65-crossbow-hero-quarter.webp` | 21,934 | `db8ff19b28ba48a38cc990fa0ee88d35ea88b51ff62192ddedf4aabfcbb518e9` |

## Acceptance boundary

VERIFIED: This pass established existence, measured bytes, matching receipt hashes, glTF JSON structure, authored editable-source retention, image dimensions and four existing rendered thumbnails. It did not copy assets or change gameplay.

OPEN: Before enabling a model: decode the real compressed GLB, verify sockets/material disposal, fit current hands without replacing them, verify hip/ADS/reload/muzzle placement in the actual restart renderer, and compare frame cost. Retain its procedural fallback until those views pass. Import images separately so menu improvement does not depend on GLB fitting.

## Approved intake implementation — September 26 evening

VERIFIED: The owner approved the shortlist. All 21 menu WebPs and exactly three FP LOD0 models (Mini Uzi, Magnum, Minigun) are now byte-identical copies under `public/assets/reference-weapons/`, totalling 999,630 bytes. `public/assets/reference-weapons/source-provenance.json` records all 24 original paths, target paths, bytes and SHA-256 values, the historical source commit, retained editable sources and provenance receipt hashes. No predecessor module, generator, build script or Git history was copied. Pillow decoded all 21 actual WebP images successfully; the originals and their baked captions remain unchanged.

VERIFIED: New restart-only `src/weapons/reference-weapon-models.ts` uses installed Three.js 0.180.0 `GLTFLoader.setMeshoptDecoder(MeshoptDecoder)`. Current [official GLTFLoader documentation](https://threejs.org/docs/pages/GLTFLoader.html) and [pinned r180 decoder source](https://github.com/mrdoob/three.js/blob/r180/examples/jsm/libs/meshopt_decoder.module.js) were checked. Three sequential controller loads bound concurrent decoding. Procedural family rigs remain owned and available throughout loading or failure. Each imported instance owns and disposes its GLB geometries, materials, textures and ImageBitmaps; current shared hand materials are never disposed by it. Late loads after controller teardown dispose immediately.

| Imported ID | Scale | Meshes | Triangles | Embedded texture objects | Actual source-file SHA-256 |
|---|---:|---:|---:|---:|---|
| `mini-uzi` | 0.70 | 7 | 11,424 | 5 | `1dfd91a34d7d64503561d8ec741ff10ed7f431f545c7ff3a41fe88534f8a0428` |
| `magnum` | 0.48 | 9 | 12,616 | 5 | `e5a8b7eddbc38a0b2906edb3333459b775e31acf2c0dc2689249e76c0e973048` |
| `minigun` | 0.52 | 8 | 10,840 | 5 | `bc7c965c3931ca2cce575a98552532b46fae11f41e313d3b03940cf726583a3b` |

VERIFIED: The adapter preserves the authored 180-degree root rotation, mounts the right-grip socket on the existing trigger palm, offsets the current support hand onto the measured support socket, and aims reload motion toward the named reload socket. An exact two-sight rotation/translation supplies ADS x/y/pitch/yaw corrections in both normal and motion-canary paths. Runtime muzzle/eject effects use the real named sockets. `weapons.command('state').referenceModels` reports actually adopted IDs, URLs and present sockets; family fallback labels remain conservative until pixel review. The file's 13 authored clips remain preserved but are not played: current restart weapon/reload timing and hand motion remain in charge.

VERIFIED: `node scripts/_verify-astra-reference-models-20260926.mjs` passed real Meshopt decode, exact asset hashes, bounded mesh/triangle/texture counts, trigger/support fit, both sights on the camera axis, reload reset, exactly-once resource release, shared-material preservation, and fail-closed missing-socket cleanup. Its ImageBitmap shim verifies embedded WebP signatures and disposal only; browser image decoding and GPU rendering are not simulated acceptance. `node node_modules/typescript/bin/tsc --noEmit` passed after integration.

CLAIMED: Existing project receipts declare project-original geometry and textures. The nineteen conventional weapon and crossbow receipts are retained at the historical source. No individual Crimson thumbnail receipt was found; it is recorded as a retained project variant explicitly approved by the owner, not given a fabricated receipt.

OPEN: Root must inspect actual Mini Uzi/Magnum/Minigun hip, ADS and reload frames, verify browser PBR texture upload and contact quality (especially Minigun's wide grips), and measure draw-call/frame/memory cost. Imported menu art is a distinct presentation improvement, not proof of matching third-person models. No first-person clips, world/drop LODs or independent owner art acceptance are claimed by this intake.

## ADS repair after actual pixel rejection

VERIFIED: The root's `captures/salvage-reference-mini-uzi-ads.png` and `captures/salvage-reference-magnum-ads.png` show solid sight/receiver geometry covering the aim point. Read-only triangle raycasts reproduced the obstruction at 0.273m (Mini Uzi) and 0.317m (Magnum). The previous two-anchor alignment proof was insufficient: the anchors are embedded in solid material-group meshes. Those rejected frames and the original asset bytes remain preserved.

VERIFIED: The original restart adapter now adds six small authored pieces per affected weapon: a rear U-notch with a physical attachment base, plus a mounted front blade. It measures the actual imported vertex silhouette and raises the effective sight line by 43.72mm (Mini Uzi) or 29.43mm (Magnum). The entire original receiver remains visible and intact. The actual front blade sits 1.5mm beneath its effective aim marker for a six-o'clock hold. Derived rig totals are 13 meshes/11,496 triangles and 15 meshes/12,688 triangles, within the unchanged 16-mesh/16,000-triangle cap. Two explicit effective sight anchors replace the unsuitable original sockets for ADS calculation; original sockets remain for provenance.

VERIFIED: The Minigun's separate Lens material was actually opaque (`transparent=false`, opacity1, depthWrite=true). Its existing pane geometry now has an original transparent polycarbonate finish (opacity0.16, depthWrite=false), retaining the same owned material and exactly-once disposal. It remains eight meshes/10,840 triangles. No GLB or image byte changed.

VERIFIED: The enhanced CPU proof raycasts the real decoded triangles along the camera centre and four aperture-margin rays. All five rays clear opaque geometry on each rig. A negative control restores the original socket-only mount and must detect the Mini Uzi/Magnum solid obstruction. Hash, contact, reload and resource-disposal assertions remain in force. These tests protect geometric visibility but do not replace rendered acceptance.

OPEN: The root must re-render and inspect all three ADS frames, physical sight attachments and hip/reload appearance. This adapter repair is a source candidate until those actual pixels pass.
