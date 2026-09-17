# Report: dims lane (brief-dims)

## What changed

- `src/core/layout.ts`: `KERB_HEIGHT` 0.14 → 0.15. One line, one number. No
  symbol renamed/removed, no shape change to `ORANGE`/`WHITE`/`HOUSES`, no touch
  to `garageIsOnTheRight()`. Nothing else in the repo written except the two
  docs files below.
- `docs/DIMENSIONS.md` (new): the deliverable. One row per `layout.ts` constant
  — current, measured, method, confidence (VERIFIED / CLAIMED / ESTIMATED) —
  plus the three evidence sources, and §§1–4 explaining every deliberate
  non-change (front lawn, garage bays, fence height, eye height).
- This file. No commits, no installs, no process kills.

## What I measured

- **Street/pavement/storeys: the invented numbers hold.** Tour-bus (~11 m) and
  soldier (~1.8 m) rulers give kerb-to-kerb 7–9 m vs ours 9.2, pavement ~2.6 m,
  each storey ~3.0–3.2 m vs 3.15/3.05, eave ~6 m vs 6.20, deck rise ~3 m vs 3.15.
  First-hand opens: 135 (bus rear + soldier + orange house), 205 (second-livery
  bus side), 030 (garage door 13 + roller + wreck + fence), 212 (street-end
  gate + display plinth + mannequin + fence), aICK-100 (saucer soffit +
  downlights + leg), mGp-014 (dressed interior, doorway + ceiling), 160
  (striped utility interior).
- **Unit convention VERIFIED, map extents absent.** 1 Radiant unit = 1 inch is
  confirmed (UGX-Mods forum: "1 unit in radiant is 1 inch", "One meter is 39
  inches"). No credible source gives this map's extents in units, so nothing to
  convert — recorded as such, not worked around.
- **Game install read, not mined.** `zone/all/mp_nuketown_2020.ff` is 38,472,064
  bytes (internal name `mp_nuketown_2020`); strings scan of 62,989 ASCII runs
  finds no entity/worldspawn/spawn metadata — opaque without extraction tooling,
  which is out of scope. Negative result reported honestly; no asset touched.
- **The "too generous" feel is not a rescale problem.** The one real oversize
  signal is kerb→house-front ~9.0 m vs ~7 m measured (DIMENSIONS.md §1), but
  fixing it is a 5-constant rescale (lawn, back wall, fence, both spawns) whose
  blast radius exceeds a dims pass. Feel was already answered by sibling lanes:
  stem gate + chicane (vehicles), two-build fences (fences), dressed interiors.
  A correct one-constant change beats a broken rescale — reverted-by-decision,
  not by failure.

## What I looked at (opened, not assumed)

- `captures/dims-aerial.png` (1.16 MB): plan reads right — circular head + two
  buses, third house + red car beyond, mow stripes, desert surround. No overlaps
  or floaters after the change.
- `captures/dims-turningHead.png` (866 KB): bulb, buses, boundary fence, third
  house, lamps, mannequins — all grounded.
- `captures/dims-streetElevation.png` (907 KB): orange window band, red bank,
  chain-and-post, kerbs, parked saloon/convertible — intact.
- All 10 `dims-*` frames exist on disk (469 KB–1.16 MB, non-empty).

## Verification

- `npx tsc --noEmit -p tsconfig.json`: exit 0.
- `npm run build`: exit 0 (40 modules, 7.76 s).
- `npm run traverse`: **5/5 routes, 4/4 faces enterable, garage-right PASS**,
  verges 18.5 m / 22.0 m open. Exit 0.
- `npm run capture -- --tag dims`: 10/10 frames, zero page errors. Exit 0.

## Could not resolve / honest gaps

1. Frame-ID drift: on-disk set (636 files) outgrew REAL-REFERENCE's ~438 and
   numbering shifted, so its frame IDs are cited as PRIOR-READS; one same-session
   re-read returned another path's bytes once, so only twice-describable content
   counts as first-hand above. A future measurer should re-pin IDs to disk.
2. Spawn-to-spawn (~63 m vs SPEC ~60 m), head diameter/offset, house
   depth/frontage, deck/canopy footprints, plot widths, bounds, third-house
   inset: all ESTIMATED, all kept. Settling shots listed in DIMENSIONS.md via
   REAL-REFERENCE OPEN-1/OPEN-2.
3. `FENCE_H` deliberately not lowered (would break the fences lane's
   built-to-1.91-under-2.1 contract); needs a `FRONT_FENCE_H` follow-up in the
   fences lane. `GARAGE_BAYS` contested (1 vs 3), needs a square-on elevation.
4. Fences lane's note (yardOrange/yardWhite stations photograph the opposite
   houses) not verified by me and not mine to fix — flagging, not claiming.
