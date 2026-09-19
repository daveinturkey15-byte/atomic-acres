# Prone weapon carry correction

Date: 2026-09-19
Owner lane: `src/characters/blend.ts` and the browser-free prone proof.

## Problem

**VERIFIED from the owner capture:**
`captures/gait-poses/10-prone-side.png` showed the prone rifle pointing back across
the operator toward the feet. The prone clips rotate the chest frame onto the lawn;
the existing weapon carry branch disabled the carry solver in prone, leaving the
baked hand orientation to determine the rifle direction.

## Change

`src/characters/blend.ts` now keeps a 0.9 carry constraint in prone and uses dedicated
prone hand anchors. The anchors are expressed in the rotated chest frame: chest local
`+Y` follows the body toward the head and local `-Z` lifts the hands above the lawn.
The barrel direction is solved from actor-root `+Z`, with aim pitch blended in when
aiming. The support hand still targets the forestock read from the right-hand world
matrix, so the rifle and the two hands remain one constraint rather than three
independent offsets.

The solver changes only upper-body quaternions. It does not alter the corrected prone
clip, root height, collision capsule, head/torso bound, or floor clearance code.

## CPU proof

`node scripts/animation/verify-prone-clearance.mjs` passed. The proof samples 37
frames across each full prone cycle through `CharacterRig`, measures the skinned
surface and the live weapon probe, and retains the prior negative-control assertions.

**VERIFIED results:**

- Hip carry: `prone-idle` minimum barrel dot with actor-forward `0.9465`, maximum
  support-hand to forestock distance `6.98 cm`; `prone-crawl` `0.9414` and
  `6.95 cm`. Both retain carry weight `0.900`.
- Aim carry: `prone-idle` minimum barrel dot `0.9758`, maximum support distance
  `4.50 cm`; `prone-crawl` `0.9720` and `4.79 cm`. Both retain carry weight `0.900`.
- Existing floor/headroom proof remains green: minimum visible surface is `0.00386 m`
  idle and `0.00530 m` crawl; head/torso maxima are `0.4445 m` and `0.4504 m`, below
  the unchanged `0.52 m` gameplay height.
- The legacy negative controls still fail floor clearance, so the proof did not pass
  by weakening its threshold.

## Remaining review

**OPEN:** the root-owned browser capture still needs to confirm that the rifle reads
forward from side and three-quarter views during idle, crawl, aim, and stance
transition. The CPU proof establishes the root-relative direction and support-hand
relationship; it cannot establish final rendered silhouette, weapon mesh occlusion,
or animation readability.
