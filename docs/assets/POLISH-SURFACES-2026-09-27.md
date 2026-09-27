# Surface finish canary — September 27

VERIFIED: source-only first canary on restart branch `salvage/full-game-20260926`,
baseline `b9adb96`. Activate with `?surface-finish=canary` alongside the existing
`architecture=canary` route. The surface flag does not enable architecture itself.
Without the exact flag, all seven installed architecture graphs match the frozen
baseline. This is an initial change plus one mechanical repair, within the
initial-plus-two-repairs budget. No build, browser, render, GPU, inference or asset
generation was run by this lane. Root owns integration and pixel acceptance.

## Frozen references and claim boundaries

VERIFIED: read the original `docs/reference/CONCEPT-BAR.md` §§1–2,
`CONCEPT-BAR-2.md`, `docs/night/VISUAL-BAR.md`, both concept manifests and existing
architecture texture provenance. Inspected these retained original concepts in
the same restart fallback at `C:/Users/david/Desktop/stuff/nuketown/docs/reference/concept/`:

| Original concept | SHA-256 independently read back and matched to inventory |
| --- | --- |
| `orange-house-noon-eye.png` | `4b9a0f2667585c5822b98b74a5444d25887e35f457ab654d05bd6e9c68b735fa` |
| `white-house-noon-detail.png` | `4efebcf84a105577e7b595d98598120db3e8fd71690dd06cd22c19ad42b355f4` |

VERIFIED: the comparison game image inspected was the retained
`captures/overnight-2f837ae-play-spawnA.png`. It is an earlier runtime, not a
capture of this canary. The concept's shaded cream, orange midtone and smoother
white surface guide the proposal. No image was copied into runtime assets.

CLAIMED: the historical manifests attribute those original concepts to route A;
this lane did not generate them or independently prove their historical provider.
The inventory is `docs/assets/POLISH-CONCEPT-INVENTORY-2026-09-27.json`.

OPEN: the concept roughness numbers are authored design targets, not calibrated
measurements from the concept images or current game pixels. A scalar roughness
range alone cannot establish the quality or intensity of the resulting sheen.

## Exact change

VERIFIED: three existing shared material profiles change only under the opt-in.
The existing scan assets, triplanar metre scale, palette multiplication and normal
space conversion remain. The small existing two-wave macro signal now also
modulates roughness by at most ±0.012, without another texture sample.

| Profile | Baseline roughness | Canary scan range | Normal strength, old → proposed | Scan contrast, old → proposed |
| --- | --- | --- | --- | --- |
| Cream stucco | .78–.98 | .52–.64 | .95 → .55 | .42 → .24 |
| Terracotta | .78–.98 | .70–.85 | 1.15 → .75 | .50 → .38 |
| Capsule white | .70–.92 | .36–.50 | .40 → .20 | .24 → .14 |

VERIFIED: cream and capsule receive a dry film only on outward-facing, nearly
vertical surfaces within their main house plans. The grade comes from existing
`KERB_HEIGHT + .001` (0.151 m). Coverage peaks through the first 25 mm and fades
smoothly to zero 150 mm above grade; it also fades below grade. The field rejects
inward-facing wall-box faces, horizontal surfaces and positions outside the
main-house bounds. Maximum additional albedo reduction is 4.5% for cream and 3.5%
for capsule, with roughness increases of at most .025/.030 respectively. No hue
wash, painted shadow, per-window stain or new high-frequency noise is added.
Terracotta receives no grade film. This first canary intentionally excludes
garage extensions and detached props from the dust field.

VERIFIED: `interiorWall`, `roofWhite`, `timber` and `timberDark` retain exactly the
baseline colour/roughness/normal graphs. The actual baked-room AO graph survives
installation unchanged, including on the three affected shared materials. No
light, sun, sky, exposure, colour palette, collider, geometry, scene membership,
post-processing route, render call or MRT setup is changed.

OPEN: the three exterior-named materials are shared. Their revised finish also
applies to existing geometry borrowing that material (for example the capsule
canopy and inner faces of cream perimeter boxes). Only the dust field has the
outward-facing/grade/plan rejection. This is not a per-object material split;
actual interior/roof-adjacent pixels must still be checked for specular changes.

## Version, caching and ownership

VERIFIED: installed Three is 0.180.0. Consulted the current
[official docs index](https://threejs.org/docs/llms.txt), which now illustrates
0.186.0, then checked the pinned
[r180 MeshStandardNodeMaterial source](https://github.com/mrdoob/three.js/blob/r180/src/materials/nodes/MeshStandardNodeMaterial.js)
and installed TSL arithmetic/adapter source. Existing r180 `colorNode`,
`roughnessNode` and `normalNode` adaptation is retained. No Lab/newer-version API
or renderer technology was adopted.

VERIFIED: exactly seven existing material identities and four existing scan maps
remain. Reported RGBA-plus-mipmap budget is 13,981,014 bytes, identical to baseline.
No extra geometry, draw, light, texture, per-frame callback or runtime texture job
is added. Changed profiles append `/surface-finish-v1` to their stable, already
texture-owner-specific cache keys. The other four keys retain the baseline form.
The shared pending-promise cache prevents repeat allocation. Composed baked-room
and architecture teardown restores borrowed maps, original colours and property
descriptors and releases each owned texture once.

OPEN: CPU resource counts do not measure actual GPU memory or fragment cost.
The dust mask adds arithmetic to two surface shaders. GPU compilation, shader
cache behaviour under the actual renderer and equal-quality frame timing remain
root's gates; no FPS improvement is claimed.

## Verification and retained failure

VERIFIED: `node scripts/_verify-polish-surfaces.mjs` passed eight groups:

1. Exact opt-in and protected profile exclusions.
2. Default graph equality against the frozen baseline, and exactly three changed profiles.
3. Evaluation of the actual TSL dust graph at grade, height, normal and plan boundary cases.
4. Evaluation of actual roughness graphs across scan extremes and spatial samples.
5. Actual r180 material adaptation/cache keys, unchanged material/texture budget and 10,000 cache hits.
6. Actual retained baked-room binary data and unchanged AO graph.
7. Composed room/library teardown, original colours and borrowed-map restoration.
8. Partial texture failure leaves original materials and frees partial ownership.

VERIFIED: full `node node_modules/typescript/bin/tsc --noEmit` passed. Scoped
`git diff --check` passed (ordinary LF/CRLF checkout warnings only).
Receipt: `captures/polish-surfaces-cpu-2026-09-27T14-39-30-993Z/report.json`.
Arithmetic evaluation uses controlled texture sample values and the real node
graph; it does not execute a GPU shader or validate filtering/antialiasing.

VERIFIED: repair 1 retained the first verifier/source bytes and the failure at
`captures/polish-surfaces-repair1/`. The verifier initially compared an LF Git
blob against its CRLF checkout hash. Both exact hashes are now asserted; their
line-ending-only equivalence was proved. TypeScript also rejected assigning a
clamp MathNode into an OperatorNode-inferred variable; a const conditional
preserves the same graph without that invalid type assignment. No material
values, assertions, visual thresholds or prior verifier files were weakened.

| Frozen source | SHA-256 |
| --- | --- |
| `src/core/architectural-materials.ts` | `6e59ab2df322f14d9a737979c7245958a5799d031e5c03c72bf1d962863915f3` |
| `src/core/surface-weathering.ts` | `7540b24b1f5bde87a5d99a53846ed47f60dc504ca13a48ae581ed28a1c21b8cc` |
| `scripts/_verify-polish-surfaces.mjs` | `eaed9576a78358d8b26fee9ec8575217be4ddd9202646681a1d8bde7da25c95b` |
| Unchanged `src/core/room-visibility.ts` | `9601ad13433e9699aee340352c7fa0b4b92bcd97e4c1420a5f183e6505afa289` |

## Pixel gate still open

OPEN: compare baseline/canary at the same source, camera, viewport, DPR and
authored desert-noon lighting using existing `spawnA`, `spawnB`,
`streetElevation` and `interiorOrange` stations. Inspect full frames plus normal
native camera motion. Reject a plastic/wet capsule, crawling normals, a visible
uniform dirty stripe, cream turning beige, loss of terracotta midtone or any
interior/baked-light regression. Preserve the frozen S1–S10 and B1–B6 criteria,
existing quality settings and runtime budgets. This source-ready canary has no
owner art acceptance and must not become a default solely from its CPU proof.
