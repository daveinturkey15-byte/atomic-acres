# Saloon refinement (muse-vehicle) — bounded geometry pass

Base `fb71514`. Touches only `makeSaloon` in `src/build/vehicles.ts`
(+ verifier `scripts/assets/verify-vehicle-refinement.mjs`, this doc).
Coaches, truck, trailer, display sedan, placement, colliders: untouched.

## Reference read (`work/vehicle-reference.png`)

Foreground NT55 rear 3/4: two full-width 90° edges catch the sun as slab lines —
the tail-deck top edge across the boot and the white roof cap reading as a tabletop.
Hood nose-top edge is the same flaw at the front. Wheels already carry a 5-piece
depth stack (tyre / whitewall / rim / bead torus / domed cap + arch) sized for a
20 m read — at this distance they are not the slab problem.

## Corrections (2, the budget)

1. **Lower-body profile chamfers** — nose-top corner `P2` and deck-edge corner `P5`
   each broken one step (`[L/2+0.02,0.62]→[L/2-0.06,0.78]`,
   `[-L/2+0.06,0.98]→[-L/2+0.02,0.90]`). Contour 7→9 pts, still one extrude, same
   `paint`, extrema identical.
2. **Crowned roof cap** — the flat `box(1.86,0.1,W*0.86)` replaced 1:1 by a 6-pt
   crowned extrude (ends roll down, peak `y=1.46`, foot `y=1.36`), same `roofPaint`,
   same footprint/height. One mesh replaces one mesh.

Width-wise crown is impossible here by construction (`kit.extrude` is a constant
section across z); the length-wise breaks above are what this camera sees.
A full loft (coach machinery) is the follow-up, not this pass.

## Measured before → after (CPU, three@0.180, `node scripts/assets/…`)

`vehicles.ts` sha256 `641b89e6776f406d14e8dec308ef1dce8643fd73952b38e70895afe0f94a0a0e`
(run pins the file; the verifier instantiates both this source and frozen
`fb71514` source in CPU-only in-memory wrappers).

| metric | before | after | note |
|---|---|---|---|
| body tris / saloon mesh | 24 | 32 | +8, contour 7→9 |
| roof tris / saloon mesh | 12 (box) | 20 (6-pt crown) | +8 |
| world tris (×3 saloons) | — | **+48** | budget +5000 |
| body bbox | x[-2.42,2.42] y[0.34,0.98] | identical | collider `len/wid/hgt` literals untouched |
| roof bbox | x[-1.23,0.63] y[1.36,1.46] z ±0.839 | identical (float32 1e-6) | glass top 1.36, drip rail undisturbed |
| draw calls | 30 | 30 | actual base/current `makeSaloon` scene snapshots; one extrude ⇄ one box |
| material groups | painted/signText/windowDark sites | identical set | zero `new THREE.*Material`; batchStatic keys unchanged by construction |
| wheel/window/fin/plate locations | — | untouched | same xs, belt y, fin math, lamp calls |

Windows, wheel `xs`/`zHalf`/`r`, fins, plates, lamps, brightwork: same calls, same
args. `wheels()` shared helper deliberately not touched (feeds coaches/truck too).
The CPU verifier also proves the lower body is attached (`24 -> 32` triangles),
scene bounds and material signatures are preserved, and a negative source wrapper
that removes that attachment fails (`body=0`, one fewer draw, `-16` triangles).

## Deliberately not done (diagnosis, not omission)

- **Wheels:** no edit — stack already has depth; further rounding needs the shared
  `wheels()` helper, which would alter coaches out of bounded scope.
- **Display sedan (`NT51`):** same slab idiom, left alone — not the prominent car in
  this frame; propose porting corrections 1–2 to it as a fast follow (same tri math).
- **Side spear / bumpers:** still flat boxes; fine at this read distance, leave.

## Stage proposal for actual-game GPU review (root)

1. `npm run playcap` gate on the stem-mouth saloon + head-outer saloon views —
   look at the frames: deck edge and roof end highlights broken, no z-fight at the
   roof/glass seam (foot y=1.36 = glass top, same as the old box).
2. `npm run capture` delta: draw calls flat, tris +48 world.
3. Optional follow-ups only after looking: port to display sedan; coach-style loft
   for width-wise crown if the flat flanks still read slab-like in motion.
