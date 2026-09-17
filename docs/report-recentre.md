# Report: recentre — the turning circle is central

## What changed (4 owned files only)

- `src/core/layout.ts`: `HEAD_CENTER_X` 26.0 → **0.0**, `HEAD_RADIUS` 9.6 → **10.5**,
  `ROAD_X_MAX` 17.0 → **10.5** (`= HEAD_CENTER_X + HEAD_RADIUS`, bulb east tangent +
  driveway apron to fence, no through road). `ROAD_X_MIN` stays **-52** (single west
  stem off-map to plaza). `BOUND_X_MIN/MAX`, `BOUND_Z`, `THIRD_HOUSE_X` kept; ends
  preserved (road −x / third house +x) to avoid blast radius. All comments encoding
  the +x-end lollipop rewritten. No export renamed or removed; `ORANGE`/`WHITE`/
  `garageIsOnTheRight` untouched.
- `src/build/ground.ts`: comments recentred (central circle, strip runs under the disc
  to the east tangent, ring overlaps frontage on the circle side). One code change:
  `CORNER_Z` guarded — `max(PAVEMENT_OUTER, sqrt(max(0, radicand)))`. Under the new
  contract the old radicand is −283 (yard edge outside the kerb circle → NaN pad
  without the guard); it now falls back to full frontage depth, and the pad-1
  bulb-nearest corner sits at r = 10.8 = `HEAD_RADIUS + KERB_WIDTH` exactly. Verified
  numerically for new values (no NaN) and old values (`CORNER_Z` byte-identical 7.875).
  y-ladder constants + depth-buffer comment byte-identical; no new materials.
- `src/core/stations.ts`: `plaza` and `turningHead` lenses moved 6 → **−14**
  (outside the new r = 10.5 bulb; old x = 6 sat ON the asphalt). Look directions kept
  (`plaza` yaw +90 faces −x to the sign/mountains; `turningHead` yaw −90 faces +x at
  the circle). Notes updated (central circle, coach −z + second-bus/saloon +z, driveway
  apron + fence + third house east). Yaw-convention comment byte-identical; all other
  stations untouched. Aerial note now reads CIRCLE at the map centre.
- `docs/SPEC.md` §2 only: ASCII plan redrawn (central circle, west road stem, east
  driveway apron), plus a CORRECTION block marking the old lollipop-at-+x street as a
  corrected error inherited from `FINDINGS.md`, with minimap/aerial reason. Third-house
  landmark line updated (east fence, beyond the apron). §§1/3/4/5 untouched.

Untouched per contract: `vehicles.ts`, `yards.ts`, `traverse.mjs`, everything else.

## What was measured (first-party art, both loaded in real Chromium)

- Minimap (512×512, 130,667 B PNG) and aerial (1920×1080, 506,533 B JPEG) both LOADED
  (Cloudflare challenge cleared in-page after ~6–8 s; curl wall confirmed, browser used).
- Minimap pixels: circle diameter ~**85 px**, centre ~(263, 273) ±8 px (≈ image centre);
  house gap (front-wall to front-wall) **99 px** (cleanest number, 1 px outline peaks);
  road asphalt ~34 px; houses ~110×60 px, notched/stepped (no rectangle fits).
- Scale **0.25 m/px**: gap 99 px → 24.75 m vs 27.2 m contract (corroborates DIMENSIONS.md
  front-walls ~1–2 m too far back); road 34 px → 8.5 m (inside verified 7–9 m).
- Adopted: diameter 85 px × 0.25 = **21.25 m (R = 10.5) = 86 % of the house gap**.
  Road stem exits straight along the street axis; third-house building sits beyond the
  east edge (driveway car on the east tab); two bus capsules lie staggered E–W on the
  bulb (lengths symbolic, ~2.5× oversize — positions/orientations reliable only).
- Aerial confirms: central bulb with two buses end-to-end, houses either side,
  exactly one stem + opposing driveway, mow-stripe checker.

## What was verified

- `npx tsc --noEmit`: clean (no output).
- `npm run build`: green (40 modules, 975 kB JS).
- `npm run traverse`: **2/5 routes pass** (honest, no route deleted). Invariant
  garage-on-RIGHT: **PASS** both yards. Doors 4/4 faces enterable. Verges open
  (22.0 m / 16.5 m). Failures: east-flank + cul-de-sac legs stuck at [9.6, −27]
  heading to [13, −27]; open-end→head stuck at [2.5, 0, 0] heading to [8, 0].
- `npm run capture -- --tag centre`: 10/10 frames written (470 KB–1.1 MB each, real
  bytes). No page errors.
- Opened and looked at: `centre-aerial.png`, `centre-turningHead.png`, `centre-plaza.png`.
  - Aerial: circle sits between the houses on the street centreline with the bus pair
    on it, west stem runs off-map, east apron runs to the fence with the third house
    + red car beyond. **The plan now reads like the minimap topology. Yes.**
  - turningHead (−14 looking +x): circle + coach/second-bus/saloon + houses either
    side + third house beyond the fence — the intended frame.
  - plaza (−14 looking −x): pylon sign + atom, needle tower, flags, truck/trailer
    chicane, gate — the intended frame.
- Capture log reports `0k tris` / `programs 0` on every station: stats-collection quirk
  (frames contain full renders, 65–119 calls/station); not a scene regression, flagged
  for the harness owner.

## What still differs / needs follow-up (not mine to fix)

1. **`yards.ts` boundary fence now walls the east flank (yards lane).** `BOUNDARY_X =
   HEAD_CENTER_X + HEAD_RADIUS + KERB_WIDTH` followed the symbols from ~35.9 to ~10.8
   and now runs N–S at x ≈ 10.8 straight through the houses' east ends and both back
   yards. This is the [13, −27] traverse failure, not a ground bug. The fence must move
   east (toward the third-house plot / driveway-apron edge) with a gap for the apron —
   yards-lane call. Do NOT move it here; `yards.ts` is another lane's file.
2. **Traverse routes target the old geography (traverse owner).** Route 3 ends at
   [20, −1]/[26, −0.5] (old bulb — now third-house ground); route 4's [16, −16]/[16, −8]
   legs assumed the old full-length stem; route 5's [20, 0]/[26, 0] probes are old-head
   asphalt that no longer exists while [−8, 0]/[8, 0] now cross the circle through the
   bus hulls (stuck at [2.5, 0, 0] is the vehicle chicane, working as cover). Routes need
   rewriting to end at the new circle (x ≈ 0) and thread around the buses. Left intact
   per brief — no failing route deleted.
3. **Vehicles composition is the +x-cul-de-sac photograph moved mid-map (vehicles lane).**
   `parkOnHead` + radial clamp followed automatically — all three hulls sit ON the new
   asphalt (verified in aerial + turningHead: nothing floats on lawn). But coach-across
   + bus/saloon-stacked-+z was composed for the old postcard; re-composition (stagger to
   match the minimap's upper-W/lower-E capsules) is the owning lane's call.
4. **Houses are still rectangles.** The minimap footprints are notched/stepped crosses;
   both house builders remain rectangular. Known, out of scope, and the single biggest
   remaining plan-view difference after this fix.
5. **Ends deliberately not flipped.** The art proves opposite-ends topology (stem vs
   third house) but the minimap/world flip is ambiguous, and every bound/plaza/
   third-house constant assumes road −x / house +x. Flipping would maximise blast radius
   for zero evidence; kept and noted in `layout.ts`.
