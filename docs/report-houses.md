# Report: houses close-inspection detail (brief-houses)

Two parallel lanes, split by file so they never touched the same bytes.
Orange lane: `src/build/orange-house.ts` (478 → 578 lines). White lane:
`src/build/white-house.ts` (423 → 389 lines). Both exports unchanged
(`buildOrangeHouse` / `buildWhiteHouse: Builder`).

## Defect 1 — white roof glazing read as pool: FIXED (white lane)

Stadium panel keeps SPEC position/size but is now `ctx.mat.glass`
(transparent/reflective) instead of the opaque pale slab; a deep white kerb
ring (0.4 tall, 0.22 thick) frames it with real depth; 5 longitudinal +
3 transverse white glazing bars divide it into panes and throw bar shadows.
Drum keeps position/size, now matte `painted(PAL.rooftopDrum)`, ringed with
14 louvre fins, white flashing + vent cowl on top, side duct to roof.
White coping lip preserved. No new materials, no canvas textures.
Opened `house2-yardWhite.png`: the panel reads as a divided-light skylight,
not water; the drum reads as a dark plant drum. From directly overhead the
drum is still a dark disc — acceptable, it has a cowl and fins at any
oblique angle.

## Defect 2 — interiors dressed: DONE, both houses (see caveat)

Both ground floors were open/lit/walkable and still are. Added, all from
layout dims + PAL + `ctx.mat`, all blocky/instanced:
- Orange: stair bay on the garage-end wall (cheeks + cap + cupboard, 5 treads,
  2.1 m open doorway), kitchen counter run + hob on solid back-wall stretch,
  terracotta chimney breast + firebox + mantel, two partitions each with a
  1.3 m gap and colliders flanking only, skirting split around both doors,
  2 emissive ceiling diffusers (no scene lights).
- White: 10-tread open stair at the deck end with 1.2 m open foot doorway,
  kitchen carcass + timber worktop + wall unit at garage end, chimney breast
  + firebox on yard wall clear of the yard door, two partitions each split
  into leaves with a 1.2 m full-height doorway + honest per-leaf colliders,
  skirting, 2 pendant lights (cord + shade + emissive bulb, hung at 2.33 m).
Nothing spans a doorway; every real door keeps ≥1.1 m × 2.1 m clear.

## Defect 3 — orange stair landed on the garage end: FIXED (orange lane)

Chose the yard-ward re-run, not the x-reversal: an x-run foot lands ~7 m
off the patio disc by the side fence (noted in a code comment). The flight
now leaves from a gap in the deck's OUTER edge rail (centre deckX) and the
foot (z = -30.12) lands ~1.0 m past the `yards.ts` patio centre (6.0, -29.10),
inside its 2.59 m radius; treads finish on the disc. Slope signs derive
from S. Railing split into 4 runs + 2 newels; deck otherwise unchanged.
Opened `house2-yardOrange.png`: deck, rails, stair and patio read as one
assembly at the opposite end from the barrel-vault garages; garage RIGHT
from the yard confirmed, traverse handedness PASS.

## Defect 4 — exterior close-up: DONE, both houses

Orange: garage-eave gutters (the butterfly sweep can't take a straight
gutter), 2 garage + 1 corner downpipes, meter box + collider, 2 back-wall
vents, painted number plate, chrome handle plates on all three doors,
threshold slabs + colliders at both house doors, jamb liners deepening every
reveal (doors keep 1.36 m clear), emissive porch lights + hoods.
White: steel gutters following both capsule eaves, 3 downpipes, meter box,
2 high vents, '62' number plaque via `signText`, pull handles at both doors,
yard step + thresholds, projecting cills + head drips (GLAZ_IN setback
untouched), emissive bulkhead beside each door.
Opened `house2-streetElevation.png` (orange face, NT04): red appliance bank,
chain-and-post edging, tall narrow mullioned band, cantilevered eave all
present; `house2-midStreet.png` (white face): blue bank, capsule front,
garage block, mannequins.

## Verify

- `npx tsc --noEmit -p tsconfig.json`: clean (empty, exit 0), before and after.
- `npm run capture -- --tag house2`: green, no page errors. Worst fidelity
  station 524 calls / 162 k tris (aerial); budgets are 1200 / 900 k.
  orange-house 105 objects / 35 colliders; white-house 24 / 88.
- `npm run traverse`: **5/5 routes, 4/4 house faces enterable, handedness
  PASS.** Door scan (no before-baseline exists — first run was blocked by
  the cross-lane breakage below; after): orangeStreet 4.5..5, orangeYard
  -3.5..-3, whiteStreet -2.5..-1, whiteYard 2..3 — exactly one span per face.
- Opened with Read: `house2-yardOrange.png`, `house2-yardWhite.png`,
  `house2-streetElevation.png`, `house2-midStreet.png`,
  `house2-interiorOrange.png` — all 1600×900, all show the map (no overlay,
  no black frame).
- `interiorOrange` station faces the street wall, so most new dressing is
  outside its frame (it shows the glazed street wall, reveals, mullions,
  skirting, open lit room — correct, just not the furniture). I additionally
  drove the real player controller headless (throwaway script, since removed)
  to stand inside each house facing the dressing wall: white shows pendant
  light, fireplace + firebox, open doorway, partitions; orange shows counter
  run, partition, stair-bay wall. Both interiors visually confirmed, not just
  code-reviewed. Screenshots were throwaway; the 5 tagged frames above are
  the evidence set.

## Cross-lane interference (read this, orchestrator)

1. `index.html` — a concurrent lane deleted `<div id="hud">` while `main.ts`
   (also concurrently edited) still does `getElementById('hud').append(...)`.
   Every harness failed with `TypeError: Cannot read properties of null
   (reading 'append')`, `__NT.ready` never set. I restored the single div
   (keeping that lane's new start-overlay content) — one additive line,
   outside my file set, because nothing could verify without it.
2. Traverse caught a real regression from MY orange stair: the first version's
   3 full-height under-stair AABBs walled the east yard corridor (stuck at
   [5.1,-27.5], 3/5 routes). Fixed same-session: colliders now exist only
   where soffit headroom is < 2.0 m (foot of flight); the high part is
   walk-under. Re-ran: 5/5. Door spans unchanged.
3. The tree is dirty from other lanes (`ground, mannequins, third-house,
   vehicles, yards, layout, player, main`, plus deletions under
   `docs/reference/concept/` and a `.gitignore` change — none of that is
   mine). My lanes touched only the two house files (+ the hud line above).

## Unfinished / honest caveats

- Orange file is 578 lines vs the ~400-line target (was already 478; the
  brief's required features added ~100, kept compact via a `put()` helper).
  White is 389. I did not cut existing silhouette work to fund the number.
- No "before" traverse quote: the pre-fix tree never reached ready (item 1).
- Other lanes' half-done edits sit in the working tree; all numbers above
  are for the tree as it stands, not for my two files in isolation.
- No `git add/commit/stash` run. Work is in the working tree as instructed.
