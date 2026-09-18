# The visual bar — frozen before any builder sees the work

Per `visual-gauntlet-loop`: the scorecard, the blockers and the evidence record are fixed
here, in advance. A builder never grades its own work; a fresh critic grades real pixels
against this, blind to builder rationale. **Nobody weakens this file to get green** —
that is the failure it exists to prevent. If the bar is wrong, the state is
`refine-spec`, recorded as a round, not a silent edit.

## Reference (comparison aid, never permission to reproduce)

- 40 hero references: `docs/reference/library/` (the shot matrix names them).
- Per subsystem the critic is told which 3–5 real frames to hold beside the capture.
- The light condition is fixed: hard, high, slightly warm afternoon sun; crisp shadow
  edges; strong blue skylight in the shade; clear desert sky; hazy pale distance.

## Scorecard (0–4 each; a critic scores from the frame, not the description)

| # | system | 4 looks like | 0 looks like |
|---|---|---|---|
| S1 | **Grounding / contact** | every object sits: dark contact under tyres, sills, deck posts, kerbs; interiors fall off from the openings | objects pasted on; uniform ambient; interior same value as the street |
| S2 | **Value range** | true darks in shade, near-white only on sun-struck pale surfaces; ratio lit:shade on one wall ≈ 3:1 | everything mid-grey; no surface below 20% or above 90% luma |
| S3 | **Surface response** | asphalt has a wide dim lobe; render is matte with fine grain; timber shows grain + weathering; chrome reflects a real sky | plastic: uniform roughness, flat albedo, mirror-or-nothing specular |
| S4 | **Material variation** | two-scale breakup on every large surface (macro mottling + fine grain), in roughness as much as albedo | single flat colour per surface |
| S5 | **Sky & distance** | gradient with structure, a sun, aerial perspective falling off with depth, skyline reads as far | flat gradient; mountains are grey lumps at the same contrast as the fence |
| S6 | **Silhouette & detail density** | roof forms, window bands, railings, vents, wires, signage, kerb detail at BO2 density | large empty planes; box houses |
| S7 | **Colour** | lawn, terracotta, cream, road grey and sky in the reference's families; nothing neon | saturated primaries; cool grey cast on everything |
| S8 | **Temporal stability** | no shimmer on thin rails, no AO speckle, no popping with camera motion | dither crawl along kerbs; flicker on mannequins |
| S9 | **Runtime** | 60 fps at 1920×1080 on this machine's 5080 through `?post=chain`; no per-frame allocation; draw calls within budget | frame time doubling; heap climbing over two minutes |
| S10 | **Provenance** | every asset has an entry (route, seeds, weights, licence, SHA); no game art, no branding | a mesh or texture nobody can account for |

## Critical blockers (any one = the round fails, whatever the average)

- B1 the interactive path draws black or dark: `node scripts/playcap.mjs` < 4/4
- B2 a light was added/removed/hidden after the first frame, or a live material's
  clippingPlanes toggled (program-set invalidation; see PASS 82)
- B3 a capture was framed, cropped or re-lit to hide a defect
- B4 a collider no longer matches its mesh, or a house face became unenterable
- B5 copyrighted game art, logos or trade dress appear
- B6 `DARK_THRESHOLD`, this file, or a station in `stations.ts` was changed to win

## The loop, per subsystem

Subsystems, each its own bounded gauntlet, run in this order (highest impact first):
1. street & asphalt (turningHead, midStreet stations)
2. house exteriors (spawnA, spawnB, streetElevation)
3. interiors (interiorOrange + the two new interior positions)
4. vehicles & hero props (turningHead close, Trellis candidates enter here)
5. sky, distance, skyline (yardWhite, aerial)
6. characters (once Wave 4 lands: idle/walk in four views)

Each round: **builder** (one bounded correction, exact deltas recorded) → fresh capture
through `playcap` + `capture` → **fresh critic** (blind; receives the frozen bar, the
pixels, the named reference frames, and last round's frame for regression; NOT the
builder's notes) → the critic names the single largest gap, labels it
`spec | implementation | camera-lighting | missing-evidence | performance`, and returns
one correction → state ∈ `continue | refine-spec | refine-code | request-input | stop`.

Budget: **≤ 3 corrections per subsystem, ≤ 6 per loop.** Stop early on: repeated defect,
A↔B oscillation, plateau (< 0.25 average gain over two rounds), a blocker, or
diminishing gain. After the subsystems, **one integration critic** over the whole scene
(scale, palette, motion coherence) with authority to fix conflicts, not to redesign.

## Evidence record, every round (written to `captures/gauntlet/<subsystem>/round-N/`)

- git revision + `dist` bundle hash
- station names, viewport 1600×900, real Chrome over CDP, WebGPU, `?post=chain`
- the PNGs, the playcap summary JSON, console errors
- scorecard (all 10) with blockers listed separately from the average
- largest gap, its class, the exact code delta the builder made
- before/after pair against the previous round (regression visible)
- decision state and remaining budget

## Completion

"Done" only when: mechanical gates pass (tsc, build, paths all YES, 4/4 faces,
playcap 4/4), every critical system scores ≥ 3, no retained baseline regressed without
a recorded decision, the runtime output was independently inspected, and residual
unknowns are named. Otherwise the honest word is **improved**, with the numbers.
