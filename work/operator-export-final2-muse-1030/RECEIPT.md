FINAL2-1030 receipt (last repair of the closed-garment approach)
Dir: work/operator-export-final2-muse-1030 (only writer lane)
Prior: work/operator-closed-surface-muse-1017 readonly (copied exact, then fixed)

Root failure being repaired
- Blender: "Mesh OperatorSand_Gear is not valid", export 11980 tris vs 12520
  authored (-540); elbows 68 vs >=100. Verified against retained GLB with the
  unmodified scripts/assets/verify-operator-sand.mjs (3 FAIL, all else PASS).

Actual source diagnosis (CPU mesh data, no Blender)
1. Kneepad faces misindexed: kp Part built with local 0-based faces, appended
   to gear without base offset. 264 quads/side pointed at helmet verts 0..298,
   orphaning 299 kneepad verts/side. Same bug in goggle lens boxes: 8 verts/
   side orphaned, faces pointed at 0..7.
   Evidence pre-fix: gear orphans=614 (=598+16), 811 gear faces with max idx
   <300, Blender "not valid" + exporter drops.
2. Elbow envelope too narrow: w_elbow 100mm window [1.088,1.188] caught only
   4 sleeve rings x16 = 64 Arm+ForeArm verts/side (<100). Rings exist; weights
   did not blend them.

Source corrections (2 sites, +0 triangles, no framework rewrite)
- Kneepad/lens append: offset faces by len(g.verts) base before extend.
- w_elbow [1.088,1.188]/0.10 -> [1.03,1.23]/0.20: 7 existing sleeve rings
  (1.22..1.04) = 112 blended verts/side. Centred on olecranon y=1.138, clear
  of Chest/Arm branch (>1.24) and wrist blend (<0.89). No filler, no reweight
  of thresholds (validator unchanged, still >=100).

CPU evidence post-fix (check_export_final2_muse_1030.py, exit 0)
- tris 12520 (body 8264 + gear 4256), verts 4488+2642; budget 12k..20k PASS.
- gear orphans 614->0; repeated-index 0; out-of-range 0.
- zero-area: body 94 + gear 76 = 170, all at head heights y>=1.61 = sphere
  polar-ring degenerates (helmet/ear/face/balaclava poles), Blender-weldable.
  Expected export ~= 12520-170 ~= 12350, inside 12000..22000.
- elbows 64->112/side (7x16); knees 471/side; Head/Chest/Foot rigids PASS.
- shirt loops [36,36,16,16], trousers [34,20,20], no shoulder-band opening:
  branch closure preserved. UVs in [0,1], weights finite+normalized, envelope
  x+-0.246 y[0,1.8585] z fwd 0.232: all PASS.
- body orphans=28 pre-existing (balaclava eye-window skip leaves one 28-ring
  unused); loose verts only, reported not hidden, does not invalidate mesh.

Exact intended remaining boundaries
- shirt: waist 36, throat-top 36, cuffs 16+16. trousers: waist 34, cuffs 20+20.
- Removed nothing: 540 garbage quads (528 kneepad + 12 lens) repaired in place
  by reindexing to authored verts; 614 orphaned verts reconnected.

Root to run (unchanged validators + pose frames)
- Bake work/operator-export-final2-muse-1030/build_operator_sand_export_final2_muse_1030.py,
  then scripts/assets/verify-operator-sand.mjs on the new GLB.
- If still FAILs, approach is exhausted; preserved honestly (no thresholds
  touched, no padding added).
