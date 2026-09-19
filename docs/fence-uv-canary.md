# Fence UV canary — `wooden_planks` 1k

Lane: root recovery repo, CPU-only independent review. The source candidate is
the CC0 Poly Haven `wooden_planks` 1k set. This document records
geometry/UV/provenance evidence only; no in-game visual acceptance is claimed.

## Candidate and provenance

- Provider surface: 2 m × 2 m, CC0 1.0, Poly Haven
  `https://polyhaven.com/a/wooden_planks`.
- Imported files are byte-preserved 1024² JPEGs: diffuse 489,587 B, OpenGL
  normal 705,118 B, roughness 233,217 B; total **1,427,922 B**, within the
  3,000,000 B lane budget. The manifest records provider MD5, SHA-256, source
  URLs and the cached `/files` snapshot in `docs/assets/wooden-planks/manifest.json`.
- The runtime uses one uniform art-scale tile in both axes. A 0.25 m board
  across a 56 px crop at 1024² implies `1024 * 0.25 / 56 = 4.57142857 m`
  per full UV tile, deliberately **2.285714x** the provider's declared 2 m
  surface scale. This keeps U and V isotropic while fitting a complete board
  inside one seam-free crop; it is an intentional art scale, not a claim that
  the provider surface is physically 4.57142857 m.
- The candidate source windows are four exact **56 px** strips:
  **10..66**, **289..345**, **550..606**, and **828..884**.
- A complete scan of every row in the actual diffuse JPEG, using the recorded
  median<85 detector, finds these measured dark bands:
  **6**, **75..76**, **144**, **206**, **214**, **282**, **352**,
  **421..422**, **487..489**, **491..492**, **544**, **614**, **676**,
  **678..679**, **683**, **745..747**, **753**, **816..821**, **888..891**,
  and **953..959**. Every candidate window lies strictly inside a clear
  interval with margin. Localized dark woodgrain above the detector threshold
  inside a clear interval remains legitimate texture.

## Geometry and UV proof

`node scripts/assets/verify-fence-boards.mjs` is the CPU proof for the live
helper. It pins the four live `yards.ts` `fence()` call sites, hole literals and
layout-derived segment lengths. The source and replicated run list agree at
**12 solid segments**: seven holed back-run segments, four side returns and one
84 m boundary segment. The helper emits 60 course boxes, 720 triangles, one
indexed geometry and one material/draw path.

The proof checks deterministic byte equality, no helper RNG, outward winding,
exact combined bounds `X[-14.8300,16.6300]`, `Y[0.58,1.91]`,
`Z[-42.0000,42.0000]`, uniform-scale U, exact V `56/1024 = 0.0546875`,
end-face slice, and all measured V windows. It decodes the actual diffuse JPEG
through the repository's PIL asset-intake path and verifies its 1024² dimensions
and manifest SHA-256, then compares a complete 1024-row median<85 band scan to
the recorded 20-band list. The verifier uses only Float32 storage ULP tolerance;
it does not widen geometric or visual margins.

The independent verifier `scripts/assets/verify-fence-negative.mjs` adds four
falsifiers. Temporary copies with the uniform-U constant changed from
4.57142857 m to the provider's 2 m, a 30 px V strip, a 56 px strip crossing
the 75..76 seam band, and the rotation formula changed all fail their
respective contracts. Temporary modules are written under
`work/fence-uv-negative/` and removed after execution; the authoritative helper
and JPEG bytes are untouched.

## Rejected visual history

**VERIFIED — rejected I1 visual canary:** I1 used the old 30–35 px windows
`300..330`, `560..595`, `766..800`, and `830..864`, and therefore expanded
them by approximately `3.7–4.3×` to cover a 0.25 m board. Root's actual frames
showed those strips as oversized and substantially unrealistic. Its receipts and
captures remain retained for comparison.

**VERIFIED — rejected I2 visual canary:** I2 used 128 px strips and necessarily
crossed the actual JPEG's many narrow median<85 bands; root's frame showed
approximately 15 visible seams rather than the five broad bands assumed by the
older proof. I2 is rejected. The current candidate returns to one complete
56 px board crop selected from the full-image scan and uses isotropic U/V art
scale `4.57142857 m/tile`. Geometry, RNG, layout, colliders, material ownership,
and draw count remain unchanged.

## Decision and remaining review

**CPU candidate: VERIFIED.** The helper is deterministic, source-pinned to the
actual 12-segment fence assembly, uses isotropic U/V art scale, and selects
actual JPEG-verified seam-free windows from a complete row scan. The imported
maps are provenance-verified and remain separate from root material ownership.

**Runtime visual quality: OPEN.** Root must inspect actual back-fence and spawn
frames after integration to decide whether the 56 px crops read naturally at
gameplay distance. This review does not authorize wiring, relocation into the
root texture library, photoreal claims, or promotion.
