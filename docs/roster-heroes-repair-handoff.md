# Roster heroes repair handoff (source-only, prop lane)

Lane: `nuketown-prop-20260919`. No Blender, no GPU, no browser, no server ran here.
Root reruns the guarded build + validator + pixels. No run success is claimed.

## Stage correction

- THIS lane: source-only. No GLBs built here, no renders, no runtime wiring.
- Recovery root (read-only from here): `public/assets/roster-heroes/` holds
  generated MP5 (13 draws) + M14-EBR (14 draws) originals from heroes-build-2300;
  LMG GLB absent (pre-export assert blocked it). Prior "no GLBs yet" wording is
  corrected in `work/roster-heroes/manifest.json` (`recovery_root` block).

## Failure inputs (heroes-build-2300, read-only root)

- `error.txt`: `AssertionError: lmg/lmg_stock: stray Y -0.4500..-0.3000`
  (frozen `y_min -0.42`).
- `output.txt`: MP5 `PRE_EXPORT_OK draws=13 tris=810`, EBR `draws=14 tris=1510`;
  both exported, then root validator read 1194 / 1862 tris and failed
  `mag node <...>_magazine has no mesh` on real meshes.

## Changes (3 files, runtime untouched, prior handoff untouched)

1. `scripts/blender/build_roster_heroes.py`
   - LMG stock/buttpad refit INSIDE the frozen envelope (bound never widened):
     stock `(0.040,0.130,0.080)` @ `(0,-0.335,0.005)` = Y `-0.400..-0.270`;
     buttpad `(0.044,0.018,0.090)` @ `(0,-0.409,0.000)` = Y `-0.418..-0.400`,
     flush joint, 2 mm bevel margin to `y_min -0.42`.
   - UVs: deleted per-mesh 5x4 tile scatter (crossed the 3 texture bands, put
     metal ORM on polymer etc). Now per-MATERIAL V bands: metal V `[0.01,0.323]`,
     polymer `[0.343,0.657]`, accent `[0.677,0.99]`; U `[0.01,0.99]`. Same
     2x1024 PNGs, same 3 mats, no new assets.
2. `scripts/assets/verify-roster-heroes.mjs`
   - Root cause of false mag FAIL: `meshes.find(m => m.name === magNode.mesh)`
     compares a name string to a numeric glTF mesh INDEX, never matches.
   - Fix: index lookup `gltf.meshes[nodes[i].mesh]` + full subtree walk from
     the named mag node (handles empty-wrapper + mesh-child exports) with
     accumulated TRS world matrices; union bounds tested vs `anchor_mag`
     +/-12 mm. Zero descendant prims still FAILs `has no mesh`; displaced
     anchor still FAILs pivot. Missing-GLB FAIL (all modes, exit 2) kept.
3. `work/roster-heroes/manifest.json`
   - Stage/status corrected per above; budgets untouched
     (14k tris / 18 draws / 3 mats / 2x1K PNG per gun).

## CPU falsifiers (no Blender/GPU; `node --check` + `py_compile` clean)

- LMG envelope: stock `-0.400..-0.270`, butt `-0.418..-0.400`, all inside
  `[-0.42,0.62]`, joint flush; old stock min `-0.450` reproduces the assert.
- Mag descendant logic on the REAL recovery GLBs: MP5 magIdx 10 (1 mesh node,
  index 6), EBR magIdx 11 (1 mesh node, index 7) — old lookup finds 0, new
  finds 1. Accumulated-bounds pivot test: MP5 bounds
  `[-0.0140,-0.1801,-0.0563]..[0.0140,-0.0434,0.0054]` vs anchor
  `[0,-0.045,-0.045]` INSIDE; EBR `[-0.0150,-0.1740,-0.0920]..[0.0150,-0.0550,-0.0180]`
  vs `[0,-0.055,-0.06]` INSIDE (tol 12 mm).
- Negative controls: empty mag subtree (0 prims) -> `has no mesh` FAIL;
  anchor 5 cm off feed top -> pivot FAIL. Strict still red on missing GLBs.
- UV bands: metal->band 0, polymer->1, accent->2 midpoints verified; old 5x4
  tiles demonstrably straddle band edges (any tile height 0.25 > band 0.333
  alignment only by luck).

## For root's rerun

`blender --background --factory-startup --threads 2 --python scripts/blender/build_roster_heroes.py -- --gun all --out <root>` then
`node scripts/assets/verify-roster-heroes.mjs --strict`. Expect: LMG pre-export
passes, MP5/EBR mag checks pass, then pixel review vs the three catalog refs
with carbine as bar. Budgets unchanged: 4 anchors, -Z forward, 14k/18/2x1K.
