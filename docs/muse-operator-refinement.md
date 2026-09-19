# Muse operator refinement — kitted-soldier cloth readability

## What the frames showed

`captures/operator-close/three-quarter.png` and `cloth-close.png` (recovery
worktree): limbs read as smooth toy capsules in flat olive/tan. The old woven
signal was albedo ±2–3% at a single 10× repeat — invisible past a metre — and
its sine periods did not divide 256, so the repeat had a UV seam.

## The one improvement

Coherent muted cloth breakup at two scales, plus restrained fold geometry:

- **Material** (`src/characters/operator-materials.ts`): the single 256 data
  texture is re-baked with seamless integer-period signals — R fine weave
  (16×16), G broad wear/scuff, B low-frequency tonal-camo blotch — sampled at
  two repeats from the same map (10× weave, 2× camo). The camo is gated by the
  existing `clothMask`, so olive/tan fatigues break up ±~6% albedo with a faint
  olive chromatic lean (red/green lift, blue dip) while skin, dark webbing and
  boots keep exactly their old response. Roughness carries part of the fold
  read (±~0.03 weave, ±~0.02 camo, still clamped 0.34–0.98). No second map,
  no normal map, no new material, no per-frame work.
- **Mesh** (`src/characters/mesh.ts`): 3 thin open-tube fold/seam bands per
  side (sleeve hem, elbow bunch, trouser gather over the boot), CLOTH slot with
  fatigue colour and darker crease tints (0.82/0.84), rigid weight-1 skinning on
  the limb bones. Each is 16 triangles; +96 per figure against the 800 budget.
  Radii sit on existing silhouettes (cuff 0.053, forearm 0.043, blouse 0.064),
  so feet/head/trunk envelopes and prone clearance are untouched. No existing
  dimension changed — every pre-existing part anchor is asserted byte-identical
  by the verifier.

## Budgets (measured, not estimated)

- helmet figure: 2954 → 3050 tris (+96); cap figure: 2900 → 2996 (+96)
- materials 1, textures 1×256 RGBA (262144 bytes), normal maps 0, draws 1/figure
- 3 geometry groups (skin/cloth/dark) covering all indices; 2856 verts helmet

## Verification

`node scripts/animation/verify-operator-refinement.mjs` — plain node, no
browser/GPU/build/network. Assembles REAL THREE primitives with bake()
semantics and checks: 44/44 add-site parity (a part missing from the merge
fails), per-band 16 tris, delta ≤ 800, attribute presence/dims, index bounds,
weights (1,0,0,0) on all 2856 verts, 19 skin bones, unit/finite normals,
per-band envelope rules, part-geo/skeleton disposal, shared-geometry retention.
Result: 80/80 PASS.

Known limit: bone rest translations live in skeleton.ts (outside this lane), so
the merge runs in bone-local frames; envelope preservation is proven by
unchanged anchors + per-band radius/height rules + unchanged cull sphere.

## Acceptance

Root actual-frame review decides. No photoreal claim: the goal is a soldier
that reads as kitted cloth at 1–4 m instead of a smooth tan capsule.
