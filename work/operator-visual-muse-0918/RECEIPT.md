# Operator Sand Visual 0918 — receipt (source-only, FINAL repair 2)

Owned dir only: `work/operator-visual-muse-0918/`
- `build_operator_sand_visual_0918.py` (source recipe, root bakes)
- `check_visual_0918.py` (CPU truth checks, 41 pass in ~0.6 s)
- `RECEIPT.md` (this file)

Base: exact `work/operator-anatomy-0845/build_operator_sand_anatomy_0845.py` (SEED 2256 kept).
New basename `operator-sand-visual-0918` (no stale-asset reuse). 21 bone names/rest/weights,
+Y-up/+Z-forward, animation/team/collision semantics preserved. All original authoring;
no old-game copy. Procedural textures improved in place, never called scans.

## Flat-texture root cause (found, fixed)

`add_loft()` took a 4-tuple atlas rect as `u_range` but read `u_range[0..1]` as
`(u0,u1)` — collapsing every lofted panel (trousers, sleeves, torso, pelvis, belt,
boot shafts: 80%+ of visible cloth) onto a 1 px vertical strip at u=0.02. Mips then
averaged one texel column: beige plastic at any distance. Boxes/spheres were correct,
which is why only trim read correctly in `cloth-close.png`.
Fix: unpack the rect, map U around the ring and V inside the rect's fractional span
(functional proof in checker §9: test loft spans 0.340 in U). Zero tri cost.

## Materially different cloth (not scalar noise)

- Atlas split inside legacy FATIGUE bounds: `UV_TORSO / UV_TROUSER / UV_SLEEVE`
  (non-overlapping); all loft calls remapped, caps excluded.
- Paint: per-panel value (torso 1.02 / trouser 0.95 / sleeve 1.05), stronger
  blotch (0.16–0.18) + weave (0.09), diagonal twill ribs, stitch lines, dark seam
  piping at panel borders. 160 px probe: torso–trouser Δ0.056, sleeve–trouser Δ0.086
  (bar 0.015); bake bands hold (cloth R 0.739, gear R 0.340).
- ORM: roughness now carries weave/scuff + webbing-row lift (mean G 0.742,
  span 0.544 ≥ 0.20). Webbing albedo lifted out of pure black
  (`WEBB*1.25+0.03`, MOLLE 0.82, rib 0.92) so the carrier reads in sun.
- Geometry folds doubled where it shows (thigh/knee/cuff 0.050–0.065, sleeve
  0.050–0.055): folded thigh ring radial std 5.25 mm vs smooth ring 2.94 mm.

## Silhouette fixes

- Shoulders: balloon-cap spheres REMOVED (pad faces 320 = elbows only, 0 above
  yoke). Sleeve top buried inside torso yoke (y=1.488, rx 0.088, 6 cm overlap),
  arms cant inward + bow forward at elbow. X envelope ±0.276 (cap 0.31).
- Trousers: patella +0.012–0.013 with popliteal hollow, blouse flare 0.074/0.078,
  cargo pocket + flap lid + bellows pleat per leg.
- Carrier: plate backing shadows + top edge rolls, strap pad underlays, MOLLE
  relief; boots: wedge toe (taper 0.55/0.60, +10 mm forward) + 3 lace bars per boot
  (lace-zone verts 82 > 70).
- Roundness budget: trouser sides 32→36, sleeve/torso/pelvis 28/32→32/36
  (+640 tris) exactly offsets removed caps; net total **15,440** (body 11,184 /
  gear 4,256), verts 8,808, ground 0.0000, crown 1.8585, reach 0.232.

## Verification (this lane, no Blender/GPU/browser)

`python work/operator-visual-muse-0918/check_visual_0918.py` — 41/41 PASS.
Frozen bars kept: 12–22 k, growth +1232/+612, 21 bones, normalized weights,
blends ≥100, clearance **3.8 mm** (cup +1 mm, straps +1–2 mm for the 36-side
retessellation), threads=2, update/pack. New truth checks: loft-U span, panel
fractions (0.87/0.87/1.00), paint split, pad-cap absence, lace density, fold std.

## Remaining root acceptance (NOT done here)

1. Bake: `blender.exe --background --python work/operator-visual-muse-0918/build_operator_sand_visual_0918.py`
   (2 threads, <180 s, <2 GiB). Then `check_visual_0918.py`,
   `node scripts/assets/verify-operator-sand.mjs …visual-0918.glb`,
   `…verify-operator-sand-texture-content.mjs …`.
2. Gameplay art A/B (actual WebGPU, never headless-Chromium fallback):
   five-pose before/after vs `captures/operator-anatomy-0907`, compared against
   `docs/reference/production-catalog/operators/operator-sand-turnaround.png`
   + `operator-sand-poses.png` at 3–8 m. Accept only on looked-at frames:
   shoulder-to-sleeve continuity (no cap), carrier plates/pouches relief vs black
   slab, boot lace/toe profile, trouser panels/folds vs tube, no z-fight in
   crouch, no reimbursement of the 0845 toy read. `playcap` dark-frame gate and
   `capture` MEASURED-NOTHING rule still apply; `soak` before handoff if the
   render chain was touched (it was not — geometry/texture recipe only).
