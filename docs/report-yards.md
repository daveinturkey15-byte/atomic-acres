# Report: YARD AND SURROUND DETAIL (brief-yards)

## Files touched

- `src/build/yards.ts` only (+~170 lines, 512 → ~690). `src/build/surround.ts`
  deliberately untouched: no brief defect maps to it (street lamps live in
  `yards.ts`), and its `surfaceY()` burial guard already does what defect 4 asks.
  Nothing else written. No commits, no installs, no process kills.

## What changed, by defect

**Defect 1 — glasshouse.** Was 0.06 m `mat.glass` walls at opacity 0.42 on four
steel posts, no bars, at `yx(0.16)/yz(H,0.62)`. Now at `yx(0.13)/yz(H,0.68)`
(about 1.2 m SW of the old spot: 3.4 m off the west fence, 2.2 m off the back
fence, 2.9 m off the cold frames, ~1.9 m off the west walk corridor) with:
pale dwarf wall (`SLAB`, 0.5 m), white (`WHITEP`) corner posts, eaves beams,
ridge beam, vertical glazing bars (~0.7–0.9 m spacing) on all four walls,
stepped glass gable infills with a tie bar, sloped roof bars, dark door recess
with frame + step on the east face. Stone run re-derives from the new
`gxx/gzz` automatically. Same collider footprint convention.

**Defect 2 — lamp arms.** Was four 0.075 r spans (0.15 m dia, ~2 px at aerial).
Now two 0.105 r spans (0.21 m, ~3 px) pole-top → elbow → head, elbow knob
(`mat.steel` sphere), head at the exact old world position. Curve still reads
close up (verified in `yard2-streetElevation.png`).

**Defect 3 — density** (all `PAL` colours, `ctx.mat` singletons — two new
`painted()` keys `POT`/`CLOTHB`, same standard program — `ctx.rand()` via `rr`,
positions via `yx()/yz()/pxx/pzz/gxx/gzz`, everything through the existing
`Batch` instancers):
- Orange: 2 pots by the glasshouse door, 2 pots + watering can (box + spout
  span) off the patio rim, hose reel (timber cheeks + tilted hedge coil,
  collided) by the glasshouse, 2 white chairs + round table (all collided) on
  the patio SOUTH half, 8-bloom bedding ring round the patio, pale edging
  strips flanking the full stone run (30 mm, `T_STEP`, no collider).
- White: washing line (2 timber posts + crossarms, iron line, white/red/blue
  cloths, one 4.3 m collider so nobody head-clips a sheet), 2 chairs + table
  west of the pod, 2 pots flanking the pod door, sand toys (red bucket, iron
  spade, sand mound, no colliders) in the pit, soil bedding strip + 7 blooms
  south of the court (`T_STEP`), pale windbreak wall + coping at the east
  fence (collided).
- Helpers added next to `padBox`: `pot/chair/table/bloom`. No SPEC §3 OPEN
  item (no front ledge, no mailboxes), no other-Nuketown invention.

**Defect 4 — burial audit.** Every new flat sits on the file's ladder:
soil strip `T_STEP`, blooms `T_LAWN`/`T_STEP`, edging `T_STEP`, toys `T_SAND`,
furniture founded on `T_LAWN`/`T_SURF`, uprights (posts, reel, wall) founded
at lawn/patio top, never floating. Existing patio ring/disc, court
apron/bed/markings, sand fill, stone runs re-read and unchanged — all visible
above grass in the after frames.

## Measured

- `npx tsc --noEmit`: fully clean at finish (`grep yards|surround` empty throughout).
- `npm run capture -- --tag yard2`: exit 0, no page/console errors, 10 frames.
  Scene at aerial 524 calls / 162 k tris (budgets 1200 / 900 k). Peer modules
  grew this session (vehicles 101→178, orange-house 56→105 objects); my share:
  yards 32→42 objects (8 new material-geometry pairings, all instanced),
  colliders 52→61 (+9 = 4 chairs + 2 tables + reel + wash line + windbreak).
- `npm run traverse`: **5/5 routes, 4/4 faces enterable, garage-right invariant
  PASS**, verges 25 m / 28 m open.

## Looked at (Read tool, single reads)

Before: `yardbase-yardOrange/-yardWhite.png`. After: `yard2-yardOrange.png`
(glasshouse now a white-framed building with bars/walls/door, clear of the
fence; edging strips legible along the run; pots + can by the stair foot;
bloom at patio rim), `yard2-yardWhite.png` (washing line + 3 cloths with
shadows, bedding strip with 7 blooms, bucket/spade/mound in pit, windbreak at
east fence), `yard2-spawnA.png` (run + edging proud of lawn, garage RIGHT),
`yard2-spawnB.png` (court markings crisp, bedding strip reads), `yard2-aerial.png`
(no lamp asterisks; new props resolve as garden-scale dots),
`yard2-streetElevation.png` (lamp elbow + curved head close up).

## Could not resolve / honest gaps

- Pod-west chairs + pod-door pots and the patio chairs sit at frame edges in
  every station — positions are layout-derived, traverse-green and counted in
  the object/collider deltas, but I never eyeballed those three clusters.
  Recommend a freecam pass over the pod west side and the patio disc.
- `surround.ts` unchanged (see above); if the owner wants flank density to
  match, that is a separate brief.
- Mid-session peer interference, all resolved without touching others' files:
  (a) `ground.ts` lost `T_ARC` for ~4 min (peer rework; tsc red, settled —
  current tree clean); (b) `index.html` dropped `#hud` while peer `main.ts`
  required it (capture boot failed once with `hud.append` on null; peer
  restored the div, recapture green); (c) peer `orange-house` landed its new
  deck stair mid-patio + my first patio-set placement trapped the east-flank
  probe (3/5). I moved the set to the patio south half with a comment citing
  the stair landing and corridor — 5/5 since. If the stair moves again, that
  comment says where the furniture must not go.

## Postscript (after verification)

- The orchestrator committed this lane as part of `afad912` ("yards.ts: detail
  passes"). Working tree is clean for `src/build/yards.ts` (includes the patio
  set on the south half) and `src/build/surround.ts` (untouched); this report
  is the only remaining untracked file of mine.
- That commit also moved `SPAWN_B` off the sand pit (it was at (4, 31.8),
  inside the pit) and landed peer work (fly modes, road detail, mannequins).
  Re-verify against those if the owner walks the map again — my gates above
  describe the tree as I left it.
