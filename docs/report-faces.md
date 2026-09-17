# Report: faces (REAL-REFERENCE items 7 + 8)

## What changed (2 files, nothing else)

- `src/build/orange-house.ts` (585 -> 644 lines): garage face + teal living/dining + kitchen + stripe + rubble skirt.
- `src/build/white-house.ts` (389 -> 522 lines): garage face + plum/gold bedroom + bunks + mint ensuite + wall station + rubble skirt.

### Garage faces (item 7, one side each)
- Both: flat translucent canopy slab on slim steel columns forward of the bays (translucency
  approximated with light `painted()`; code comment notes it wants proper glass later),
  cloth banner plane via `ctx.mat.signText` with plausible in-world wording
  (orange: "Hail, wayfarer! Tour the homes of tomorrow"; white: "Welcome to Future Homes" -
  same spirit, not a copy of Treyarch wording, no `Nuke...` fragments),
  3 ribbed sectional bays from thin repeated slat boxes with the middle bay OPEN
  (door parked under header / hidden) revealing shelving boards + stored boxes,
  door-number plane "13" on a bay pier, cabinet boxes along one garage side wall.
- Orange garage colliders: cabinets get honest colliders; open bay left passable.
  White garage colliders: solid block collider replaced with rear/side strips +
  closed-bay-only front blockers so the open bay is walkable.

### Dressed interiors (item 8)
- Orange ground floor (clear of porchX/back-door lanes): teal wainscot band on the solid
  back-wall run, blue fronts + white top over the existing counter carcass, red-top pedestal
  table + 2 green shell chairs on trumpet bases, saucer ceiling light + 2 pendant globes
  (`emissive`, cords), maroon rug plane, 2 teal curtain planes, shelf + CRT + potted shrub.
- White REAR west end (clear of FRONT_DOOR_X/YARD_DOOR_X lanes): plum accent leaf
  (`painted(PAL.interiorPlum)`) with 8 gold diamond decals on that wall only, mustard bunk
  (2 stacked slabs + 4 posts, `painted(PAL.interiorGold)`, single footprint collider),
  purple shag rug plane (no collider), target-art poster as 3 nested letter-free squares,
  mint ensuite L (`painted(PAL.interiorMint)`, 2 leaves with 1.25 m gap, flanking colliders),
  shelf + floor lamp + plant. One wall-station cluster (0.4 m `trailerTrim` band + gold
  pinstripe + intercom + switch + vent slats + "House Care" plaque) on a single mint leaf.
- Orange stripe: single 0.4 m terracotta band + `hazardYellow` pinstripe + small plaque
  ("Wash bay - leave it tidy") on the numbered pier ONLY, commented with
  f-FKQOEO-1ceE-060 / f-FKQOEO-1ceE-190. Nowhere else in either house.
- Both houses: thin `painted(PAL.rubbleStone)` base course (+ mortar cap on orange) where
  walls meet ground, split around doors/drive mouths, no colliders; code comment notes it
  wants a proper rubble-veneer material with `PAL.rubbleMortar` joints later (materials.ts
  is another agent's file).

### Compliance
- Only the two owned files modified. No `new THREE.Material` / `MeshStandardMaterial`
  (verified: 0 hits in diff), no `Math.random`, no inline hex (0 hits), structural dims
  from `layout.ts` (ORANGE/WHITE, GARAGE_*, HOUSE_*, REAR/FRONT plans; rest local detail
  literals). Shells, doors, decks, stairs unmoved. Partitions leave >= 1.1 m gaps with
  colliders flanking, never spanning; door lanes kept clear.

## What I measured
- `npx tsc --noEmit`: MY files clean (`grep orange-house|white-house` empty). The tree is
  RED from other lanes' files, which I did not touch and must not touch:
  `ground.ts` (`desert` undefined x2, `lineSpecs` undefined x5),
  `plaza.ts` (`CORD` undefined), `ui/menus.ts` (NodeListOf iterator).
- `npm run capture -- --tag faces`: 10/10 frames written, no page errors, **2 console
  errors, both from other lanes**: `ground` threw (`desert is not defined`) and `plaza`
  threw (`CORD is not defined`). My modules built clean:
  orange-house 151 objects / 43 colliders, white-house 34 objects / 103 colliders.
  `handedness: [true, true]` at every station - invariant holds.
  Draw calls 118-172 across stations; **triangles and programs report 0 in every row** -
  the stats path is broken (likely another lane's world.ts rewrite), so I claim no
  triangle/program numbers.
- `npm run traverse`: FAILED - `page.waitForFunction: Timeout 30000ms exceeded`, process
  crashed. The world never reaches ready with ground/plaza throwing, so the
  5/5-routes / 4/4-faces / verge-scan gate **cannot be demonstrated in this tree state**.
  Enterability was protected by construction (open bays passable, lanes clear, gaps >=
  1.1 m) but not proven by the harness. This is the honest status.

## What I looked at
- `captures/faces-streetElevation.png` (NT04): orange street face - canopy slab + legs,
  banner text legible ("Hail, wayfarer! Tour the homes of tomorrow"), "13" pier, ribbed
  bays with the open bay + shelving visible, cabinets, red car in front. Garage face
  reads. (Ground plane is washed out white - the ground module threw; not my lane.)
- `captures/faces-midStreet.png` (diagnostic): white house + white garage wing - "13"
  plaque, banner fragment ("...me to ...re Homes"), dark ribbed slats, open bay. Reads.
- `captures/faces-interiorOrange.png` (diagnostic): inside the orange ground floor looking
  out through the street windows at the far house/mannequins - interior is open and lit,
  not a sealed box. Furnishing detail does not resolve from this station; no closer
  interior station exists.
- `captures/faces-yardOrange.png` (NT03): rear deck/stair/butterfly roof intact, mannequins
  on deck, glasshouse/beds beyond - rear silhouette unchanged by my work.
- Reference frames: subagents opened all assigned gameplay frames. Caveat: several served
  extraction-mismatched content (scoreboard / class-menu overlays with zero map evidence,
  e.g. aICK-210, FKQ-190, aICK-135-as-served, FKQ-175-as-served, FKQ-060-as-served).
  Where the pixels were wrong the build followed REAL-REFERENCE prose + the frames that
  did resolve (banner/canopy/open-bay in aICK-055, teal room in aICK-010, ribs/cabinets in
  FKQ-060-prose, number/open-bay in FKQ-205-prose). Per-frame notes are in the two
  subagent receipts.

## What I could not resolve
1. Traverse gate blocked by other lanes' throw (`desert`, `CORD`) - needs a green tree;
   re-run `npm run traverse` after ground/plaza are fixed and confirm 5/5 + 4/4 + PASS.
2. Triangle/program stats report 0 - needs the stats path fixed (world.ts lane) before
   any budget claim.
3. Canopy translucency and rubble veneer are geometry + `painted()` approximations -
   flagged in code for the materials lane (proper glass + rubble/mortar veneer).
4. No capture station looks closely at either dressed interior or either open bay from
   the driveway - my "reads" claim rests on the mid-distance frames above. A driveway
   close-up station for each garage would settle it.
5. Ground/plaza/menus type errors are outside my file set - left for their owners.
