# DIMENSIONS — measured vs current (`src/core/layout.ts`)

Owner complaint: street/cover/house dimensions must match BO2 Nuketown 2025; the
layout numbers were invented, never measured. This file is the measurement record.
Every constant in `layout.ts` gets a row: current value, measured value, method,
confidence. **VERIFIED** = seen in a frame with the ruler named. **CLAIMED** = a
credible source, corroborated at most loosely. **ESTIMATED** = no direct evidence;
left unchanged.

Headline result: the invented numbers were mostly right. Street width, pavement
depth, storey heights and deck rise all corroborate within tolerance, so they
stand. The "too generous" feel came from missing blockers (open street ends, no
chicane), uniform 2.1 m fences everywhere, and bare interiors — all fixed in
other lanes (vehicles gate/plinth/chicane, fences two-build rework, interior
dressing). Rescaling the map to chase feel would break traverse for no gain.
One constant changes on this pass (`KERB_HEIGHT` 0.14 → 0.15); the rest of the
deltas below are recorded, not applied, with the reason stated.

## Sources used

**(a) Gameplay frames** (`docs/reference/gameplay/`, 636 files on disk at read
time — the set grew since `REAL-REFERENCE.md` was written against ~438, and
frame numbering has shifted, so REAL-REFERENCE frame IDs below are cited as
PRIOR-READS, re-verified only where I opened the file myself). Rulers: standing
player ~1.8 m, eye ~1.6 m, doorway ~2.0–2.1 m, 1950s intercity coach ~11 m long
× ~3.0–3.2 m tall, sedan ~4.5–5 m, kerb ~0.15 m. Files I opened first-hand in
this pass: `f-FKQOEO-1ceE-135.jpg` (tour-bus rear on street, soldier alongside),
`f-FKQOEO-1ceE-205.jpg` (second-livery bus side on street), `f-aICKIbuo8zQ-030.jpg`
(garage door 13 + open roller + wreck + side fence), `f-FKQOEO-1ceE-160.jpg`
(striped utility interior, door/wall bands), `f-FKQOEO-1ceE-212.jpg` (scoreboard
over street-end: display sedan on plinth + black steel gate + mannequin + fence),
`f-aICKIbuo8zQ-100.jpg` (saucer soffit: mauve band + downlights + leg, looking up),
`f-mGpZaLy5_hM-014.jpg` (dressed living room, doorway + ceiling). Caveat, first-hand:
two same-session re-reads of one path returned identical bytes to a different
path once each; per-path content was consistent on re-read, but I treat only
content I could describe twice as first-hand VERIFIED (135/205/212/030/014 above).

**(b) CoD unit convention.** 1 Radiant unit = 1 inch (0.0254 m). Confirmed via
UGX-Mods mapping forum (OP assumption + "One meter is 39 inches", and quoted
modding lore "one square on grid size 1 = one inch / 2.54 cm"). No credible
source for this map's extents in units was found (web search: wiki/map-guide
pages give no numbers), so there is nothing to convert — convention VERIFIED,
map-specific CLAIMED numbers: none. Treat any future "X units" figure as CLAIMED
until a frame corroborates it.

**(c) Installed game** (`.../Call of Duty Black Ops II/zone/all/mp_nuketown_2020.ff`,
38,472,064 bytes; `en_mp_nuketown_2020.ff`, 832 bytes). Note the internal map
name is `mp_nuketown_2020`. A strings scan (62,989 ASCII runs ≥ 6 chars) finds no
entity lump, no worldspawn/mins/maxs, no player-spawn origins — the FastFile is
opaque without extraction tooling, which is out of scope (reading a number is
fine; pulling assets is not). Source (c) yields the internal name and a negative
result, honestly reported: no numbers recovered.

Prior analysis reused as CLAIMED (not re-measured): `docs/REAL-REFERENCE.md`
§1 (60-frame survey by 12 scouts + arbitration) and `docs/SPEC.md` §3 (wiki-still
reads NT02–NT07). Where they agree with my first-hand opens I upgrade to VERIFIED.

## The table

Derived rows (HOUSE_BACK, EAVE_Y, DECK_Y, spawn-to-spawn, lawn depths) are
computed, not constants, but they are what the eye judges, so they are listed.

| Constant | Current | Measured | How | Confidence | Action |
|---|---|---|---|---|---|
| `ROAD_HALF_WIDTH` (street 9.2 kerb-to-kerb) | 4.6 | 7–9 m asphalt (bus-half ruler, ±1 m); 7–8 m at gate; 8–10 m kerb-to-driveway (soldier ruler) | (a) first-hand 135/205: 2.5 m-wide bus leaves ~2–3 m per side; PRIOR-READS 135/150/212/aICK-060 | VERIFIED | KEEP |
| `KERB_HEIGHT` | 0.14 | ~0.15 | (a) brief ruler; standard kerb | VERIFIED | **→ 0.15** |
| `KERB_WIDTH` | 0.3 | ~0.3 | standard; unresolved in frames | ESTIMATED | KEEP |
| `PAVEMENT_OUTER` (pavement 2.6/side) | 7.2 | apron 2–3 m (wheel ruler); layered verge/fence/pavement section | (a) PRIOR-READS aICK-035, FKQ-135 | VERIFIED | KEEP |
| `ROAD_X_MIN` | −52 | open end runs to plaza, no measure | (a) none — road stem leaves frame everywhere | ESTIMATED | KEEP |
| `ROAD_X_MAX` | 17.0 | bulb tangent, no clean top-down | (a) OPEN-1: killcam whiteout + smoke aerial unmeasurable | ESTIMATED | KEEP |
| `HEAD_CENTER_X` | 26.0 | offset OPEN | (a) no daylight down-street both-kerbs shot | ESTIMATED | KEEP |
| `HEAD_RADIUS` (dia 19.2) | 9.6 | curvature + flagstone apron confirmed; diameter OPEN | (a) first-hand 135/205: bus ON bulb; PRIOR-READS 085/105/150/195 | CLAIMED (shape) / ESTIMATED (number) | KEEP |
| `FRONT_LAWN_OUTER` (kerb→wall 9.0; lawn 6.4) | 13.6 | front wall ~7 m behind kerb; driveway apron 6–8 m deep | (a) PRIOR-READS FKQ-205, aICK-100; first-hand 030 shows deep apron + door 13 | CLAIMED | KEEP — see §1 |
| `HOUSE_DEPTH` | 9.2 | no front-to-back measure (needs calibrated aerial) | (a) interiors read two rooms deep, 2.4–2.6 m ceilings | ESTIMATED | KEEP |
| `HOUSE_BACK` (derived 22.8) | 22.8 | follows | — | — | KEEP |
| `HOUSE_HALF_LEN` (frontage 19.2) | 9.6 | no square-on elevation with ruler | (a) NT04 band + first-hand 135: ~4 window bays | ESTIMATED | KEEP |
| `FLOOR_H` | 3.15 | each storey ~1.7× soldier ≈ 3.0–3.2 m | (a) first-hand 135: eave ≈ 3.3 soldiers; PRIOR-READS aICK-030/060/090/120, FKQ-205 | VERIFIED | KEEP |
| `UPPER_H` | 3.05 | same reads; capsule ~6.0 m total | (a) as above + aICK-120 | VERIFIED | KEEP |
| `EAVE_Y` (derived 6.20) | 6.20 | eave ~6 m (soldier ruler) | (a) as above | VERIFIED | KEEP |
| `GARAGE_LEN` | 7.6 | wing ≈ 1.5× sedan ≈ 7–8 m; 3 bays × ~2.5 m doors | (a) first-hand 030: roller 2.5–3.0 w × 2.2 h; PRIOR-READS 060/070/205 | CLAIMED | KEEP |
| `GARAGE_DEPTH` | 8.0 | apron-to-rear unmeasured | (a) none clean | ESTIMATED | KEEP |
| `GARAGE_H` | 3.65 | single storey ≈ 2 soldiers, well under eave | (a) first-hand 135/030 | CLAIMED | KEEP |
| `GARAGE_BAYS` | 3 | close-ups show single roller per wing; SPEC plan says 3 barrel vaults | (a) CONTESTED (PRIOR-READS 060/070/205 vs SPEC NT03) | ESTIMATED | KEEP — see §2 |
| `DECK_Y` (derived = FLOOR_H) | 3.15 | steel stair rise 2.8–3.2 m, 13–15 open risers | (a) PRIOR-READS aICK-085, FKQ-090 | VERIFIED | KEEP |
| `DECK_LEN` | 7.2 | footprint unmeasured | (a) none | ESTIMATED | KEEP |
| `DECK_OUT` | 3.4 | projection unmeasured | (a) none | ESTIMATED | KEEP |
| `RAIL_H` | 1.05 | waist height on 1.8 m figure ≈ 1.0–1.1 m | (a) PRIOR-READ 090 balustrade; standard rail | CLAIMED | KEEP |
| `CANOPY_Y` | 3.35 | deep flat eave over deck, just above ground-floor head height | (a) SPEC NT04 + first-hand 135 | CLAIMED | KEEP |
| `CANOPY_LEN` / `CANOPY_OUT` | 6.4 / 2.9 | footprint unmeasured | (a) none | ESTIMATED | KEEP |
| `BACK_FENCE` (yard depth 11.2) | 34.0 | yards read compact; camera-to-facade 12–15 m | (a) PRIOR-READ aICK-090; first-hand 212: fence-to-house wedge | CLAIMED | KEEP |
| `FENCE_H` | 2.1 | rear/side runs 1.8–2.0 m incl 0.4–0.6 m stone base; front runs 1.1–1.3 m + scallop (separate build) | (a) PRIOR-READS 075/120/aICK-045/085/090/100, 160/190/195/aICK-120/175; first-hand 030 (tall) + 212 (low front) | CLAIMED (rear) | KEEP — see §3 |
| `YARD_X_MIN` / `YARD_X_MAX` | −20 / 20 | plot width unmeasured (40 m band) | (a) none | ESTIMATED | KEEP |
| `BOUND_X_MIN` / `BOUND_X_MAX` / `BOUND_Z` | −54 / 46 / 38 | out-of-bounds desert, no measure | (a) none | ESTIMATED | KEEP |
| `THIRD_HOUSE_X` | 44.5 | third house beyond head confirmed; inset OPEN | (a) SPEC NT02; PRIOR-READ OPEN | ESTIMATED | KEEP |
| `SPAWN_A` (−4.0, −31.8) / `SPAWN_B` (−1.2, 31.2) | — | spawn-to-spawn 63.1 m straight-line; SPEC says ~60 m; no frame shows both ends | (a) OPEN-2, kept per PRIOR-READ | ESTIMATED | KEEP |
| `EYE_HEIGHT` | 1.68 | ruler eye 1.6 m; 5% high, moves every station | (a) convention | ESTIMATED | KEEP — see §4 |

## §1 Front lawn: the one real "too generous" signal, deliberately not applied

Measured kerb→garage/apron 6–8 m vs ours 9.0 m: both houses sit ~1–2 m too far
back. Pulling `FRONT_LAWN_OUTER` 13.6 → ~12.6 would fix the apron, but it drags
`HOUSE_BACK`, both `HouseSide` walls, the canopy/bank/driveway derivations, and
— to hold yard depth — `BACK_FENCE` plus both spawns: a 5-constant rescale whose
blast radius (colliders, traverse waypoints, sibling lanes' placements) exceeds
a dims pass. The feel complaint is already answered more cheaply by the gate
closing the stem and the mid-street chicane (vehicles lane). Recommendation: a
follow-up rescale lane with traverse-owning mandate, not a drive-by constant
tweak here. Revert policy honored: no change rather than a broken rescale.

## §2 Garage bays: contested, left at 3

Close-up frames read a single 2.2–2.5 m roller per wing; SPEC NT03 and the plan
diagram read 3 barrel-vault bays. `GARAGE_BAYS` feeds builder loops in both
house modules; 3 → 1 would delete geometry other lanes just dressed (banner,
door 13, cabinets). Needs a square-on garage elevation before touching. Left at 3.

## §3 Fence height: kept at 2.1 by sibling contract

The single `FENCE_H` conflates two real builds (low front ~1.2 m + scallop, tall
rear ~1.8–2.0 m). The fences lane just rebuilt `yards.ts` tall runs to top out
at 1.91 + cap with posts to 2.04 under the explicit contract "total stays <=
`FENCE_H`". Lowering the constant under their geometry would break that contract
and the collider/traverse heights. The two-height split needs a new
`FRONT_FENCE_H`-style constant owned by a fences-lane follow-up (their report
already asks for the masonry/fence material pass). Left at 2.1.

## §4 Eye height: kept at 1.68

Ruler says 1.6 m; every capture station and both spawns derive from the constant.
An 8 cm change buys nothing measurable and reframes all evidence. Left.

## What changed on this pass

- `KERB_HEIGHT`: 0.14 → 0.15 (VERIFIED, 1 cm, ground-lane kerb extrusion only).
- Nothing else. Symbols, shapes, `ORANGE`/`WHITE`/`HOUSES`,
  `garageIsOnTheRight()` untouched; handedness invariant holds by construction
  (no sign touched).
