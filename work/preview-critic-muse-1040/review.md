# Preview critic — muse-1040 — real-pixel review

Root: `C:/Users/david/Desktop/stuff/worktrees/nuketown-recovery-20260919`
Bar: `docs/night/VISUAL-BAR.md` (frozen, S1–S10 + B1–B6)
Shot matrix: `docs/reference/library/shot-matrix.md`

## Pixels actually available: YES

Viewed as images (not metadata) via image tool, 1600×900 each:
- `captures/operator-live-1038/before/three-quarter.png` — kneeling side view, tan operator, boxy rifle
- `captures/operator-live-1038/after/three-quarter.png` — standing front, full body on grass path
- `captures/operator-live-1038/before/crouch.png` — kneeling with black joint rings (debug markers)
- `captures/operator-live-1038/after/crouch.png` — standing front (same framing as after/three-quarter, NOT crouching)
- `captures/operator-live-1038/before/prone-carry.png` — tight torso/arm close-up, low camera
- `captures/operator-live-1038/after/prone-carry.png` — wide full-body prone on grass strip by fence
- `captures/operator-live-1038/after/cloth-close.png` — full-body standing 3/4, fence left, building right ("Hail, wo"), red car, mountains behind
- `captures/operator-live-1038/weapons/cloth-close.png` — low-angle hands + rifle close-up, concrete wall + grass
- `captures/operator-live-1038/before/cloth-close.png` — standing front (same as after framing)
- `captures/operator-live-1038/weapons/prone-carry.png` — HUD gameplay view (orange house, ENGAGE, LONGHORN viewmodel)
- `captures/art-live-1035/mountain-before/yardWhite.png` — HUD gameplay, orange house + dome + faint range
- `captures/art-live-1035/mountain-after/yardWhite.png` — (returned prone full-body frame; label/frame mismatch — see blocker note)
- `captures/art-live-1035/mountain-before/yardOrange.png` — HUD gameplay, orange house, ENGAGE
- `captures/art-live-1035/mountain-after/yardOrange.png` — HUD gameplay, round blue-white house, ENGAGE
- `captures/operator-live-1038/after/result.json` + `captures/art-live-1035/mountain-after/result.json` — read only for claim/station labels, not scored

Reference aids chosen (named, NOT viewed as pixels, not altering reference):
- Operator pose analogue: `anim-run-side` PARTIAL `gameplay/f-aICKIbuo8zQ-162.jpg` (pose footprint only; different weapon, never shape).
- Mountain/distance: `station-yardWhite` HAVE `gameplay/g-1icNQzMgLUM-100.jpg` + `sur-skyline-haze` HAVE `gameplay/g-1icNQzMgLUM-232.jpg` (haze falloff expectation). `sur-mountains` itself is NEED (no HAVE).

## Operator candidate (anatomy / cloth / clipping — critical)

Visible wins:
- Black joint torus rings present in `before/crouch.png` are gone in after frames. Clean removal, no ring remnants.
- After standing frames are slightly cleaner-shaded than before kneeling (fewer harsh black patches on torso).

Regressions / retained defects:
- Pose pairing broken: `after/crouch.png` is standing, not crouching; `after/three-quarter.png` is also standing. No before→after same-pose comparison possible for crouch or three-quarter. Prone pairing reframes tight-close → wide-full-body. Cannot score improvement; this is re-framing, not a delta.
- Anatomy still mannequin: limbs are smooth cylinders, elbows/knees no articulation, hands are fused mittens (fingers painted, thumb merged into rifle in prone), feet are vertical boards in prone, head is black void under helmet (no face, no balaclava weave — just crush).
- Cloth shows zero weave/wrinkle/two-scale breakup: tan uniform is flat-shaded plastic, knee/cargo details are painted dark stripes, not geometry. `after/cloth-close.png` is shot too far to judge cloth at all; `weapons/cloth-close.png` shows hands + slab rifle, no fabric detail.
- Rifle is a single boxy slab in every frame (black receiver, flat brown side panel, no sights detail, no metal/wood response). Weapon-family variety NOT established by this one rifle.
- Grounding: prone body floats over neon-green flat grass with no contact darkening; standing feet have a hard blob shadow but no falloff. Grass is single saturated green, concrete single off-white — S4 fail.
- `before/cloth-close.png` vs `after/cloth-close.png` are near-identical standing framings — no cloth delta visible.

Biggest defect: operator reads as posed crash-test dummy — void face + mitten hands + tube limbs + slab rifle. Class: `implementation` (geometry/material, not camera).

## Mountain / distance candidate

Visible wins:
- Distant range reads as far (pale, low-contrast) in both yardOrange/yardWhite HUD views; haze direction correct (pale desaturated band behind town).

Regressions / retained defects:
- Before vs after at yardOrange/yardWhite are pixel-near-identical at the range (same smooth low-poly wave silhouettes, same flat grey-tan fill, no rock/snow/shadow structure). If `mountain-volume=canary` changed geometry, it is imperceptible at these stations.
- Range shares value with rooftops/sky haze with no aerial-perspective gradient across depth planes; skyline blocks (grey boxes) sit at same contrast as range. Foreground roofs blow to near-white while shade stays mid-grey — value ratio flat.
- One `mountain-after/yardWhite.png` read returned a prone operator frame, not a yard view — station/frame labelling suspect; treat mountain-after yardWhite as missing-evidence until re-captured.

Biggest defect: mountains remain smooth grey lumps at fence contrast with no depth falloff structure. Class: `implementation`.

## Scores (from frames only; S9/S10 not scored — no evidence)

Operator (three-quarter / crouch / prone-carry / cloth-close):
- S1 grounding: 1 — blob shadows only, prone floats, no contact falloff.
- S2 value: 1 — shade stays mid-grey, face crushes to black, sun whites clip on roof/concrete.
- S3 surface: 1 — uniform + rifle uniformly matte-plastic; no asphalt/chrome/timber read in these frames.
- S4 variation: 0 — single flat colour per surface (grass, concrete, cloth, rifle).
- S6 silhouette/detail: 1 — humanoid readable at distance, zero BO2-density detail (no vents/wires/signage on figure; rifle no sights/sling/mag detail).
- S7 colour: 2 — tan/olive/black in plausible military family, but grass neon, concrete pink-grey cast.
- S5 sky/distance: n/a for operator close frames (mountains visible in cloth-close background: pale, correct hue, 2).
- S8 temporal: unscored — stills only, no motion evidence.

Mountains (yardWhite / yardOrange):
- S5 sky & distance: 1 — far read present but lumps, no structure, no gradient with depth, skyline same contrast as range.
- S1: 1, S2: 1, S3: 1, S4: 0, S6: 1, S7: 2 (same scene ills as above: lawn neon, road grey-pink, sky washed).
- S8 temporal: unscored.

## Blockers (B1–B6)

- B3 RISK: crouch after-frame is a different pose (standing); prone after-frame is a different distance (close→wide). Reframed to hide defect or mis-staged — either way not a comparable before/after. Also `mountain-after/yardWhite` label/frame mismatch.
- B1/B2/B4/B5/B6: no evidence in pixels viewed (frames draw, no logos/trade dress seen, no light/material audit performed per readonly scope). S9/S10 no assertions (no fps/provenance evidence).
- Missing-evidence: no same-pose crouch after; no true cloth macro (weave at <1 m); mountain-after yardWhite needs re-capture with verified station.

## Keep / withhold (per candidate)

- Operator: WITHHOLD from preview. Ring removal is real but trivial against retained anatomy/cloth/rifle defects. Do not present as progress on characters.
- Mountains: WITHHOLD from preview. No perceptible delta; whole-map visual overhaul remains unmet regardless of local haze correctness.
- Do not grade old accepted tree/coach/hands as newly authored; none evaluated here. Single rifle establishes nothing about family variety.

## One correction (operator first — highest impact)

Re-stage ONE same-pose, same-distance, same-light three-quarter standing pair (before rig archived) at cloth distance ≤2 m with hands + rifle + face in frame, then fix the single largest gap: mitten hands fused to slab rifle — separate fingers/thumb geometry, palm grip contact, trigger-guard clearance — before any further cloth/mountain work. If hands cannot separate, state rig limit honestly.
