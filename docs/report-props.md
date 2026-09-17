# Report: props lane — vehicles detail + third house (brief-props.md)

Working tree state: orchestrator commit `afad912` landed mid-pass and contains this
lane's coach/fleet/third-house work. One 2-line follow-up (mirror reseat) is
uncommitted in `src/build/vehicles.ts`. Nothing else of mine is outstanding.

## What changed (owned files only: `src/build/vehicles.ts`, `src/build/third-house.ts`)

**Coach** (`makeCoach`, hull/loft/script untouched — no redesign):
- `lamps()` rebuilt with real depth: dark socket + bright bezel + domed pale lens
  hooding forward (was bezel + flat lens). Shared by truck/saloons via new
  `tailLamps()` (red lenses).
- Front bumper is now real `ctx.mat.chrome` (env map exists — see below) with a dark
  rubber shadow-gap arc under it so it separates from the cream at distance; rear
  bumper is darker steel. 4-lamp row rejected: the grille owns the middle 1.5 m.
- Added: entry door on +z flank (cream leaf + glazing + seams + handle, kept on the
  parallel mid-body so it never stands off the nose taper), sill-mounted wing
  mirrors with chrome heads, angled wipers on both screen panes, 2 roof pods
  (`hgt` 3.25 → 3.40), 4 round red tail lights, 6 instanced luggage-bay hatches,
  NT07 plates front/rear, rear exhaust stack, tyre sidewall bead torus in `wheels()`
  (all vehicles benefit).
- Stale header comment (no-env-map) updated; `brightwork()` still low-metal polish
  for large flat trim, real chrome for hero parts.

**Other four** (colours/positions/angles untouched):
- Box truck: raked-screen header/sill rails, side-glass post+rail frames, cab door
  seams + handles, red rear corner lights, steel rear bumper, mudflaps, NT52 plates
  (`len` 8.24 → 8.36 so the rear plate stays inside the collider).
- Saloons (all three via `makeSaloon`): belt + drip rails, 4 shut-lines + 2 chrome
  handles per flank (instanced), red fin-tip lenses via `tailLamps()` for every fin
  height, NT55 plates (`len` 4.94 → 5.04 ditto).

**Colliders**: stepped-slab `park()`/`parkOnHead()` logic untouched; only the
`len`/`hgt` inputs it already consumes were updated. No single-AABB anywhere.

**Third house**: ridge cap, stepped barge boards on both gable slopes, chimney pot +
cap, porch (deepened hood slab on 2 white posts + wall brackets; protrusion 0.77 m
respects the 0.8 m fence gap; house collider widened honestly), eaves gutters both
flanks, downpipes + shoes at rear corners, hedge down the -z flank, post-and-rail
timber fence beyond the drive on +z, 5 shrubs. Two new `Batch`es (`th-fence`,
`th-planting`); stale no-env-map comment updated. One known approximation: the
downpipes sit 0.43 m inboard of the gutter ends in z (against the wall, tops
disappearing under the eave behind the fascia) — invisible past ~10 m, accepted.

**Follow-up fix**: review found the mirror stalks floated (nose recedes with height
and plan curvature). Corrected numerically: throwaway `/tmp/mirror_*.mjs` scripts
rebuilt the exact loft and raycast the surface (old base burial 0.013, a corner
proud by 0.010, top gap 0.046 → stalk shifted back 0.03 and extended down to y=1.55;
new base burial 0.045–0.084 across the footprint, head joint intact). 2-line diff,
uncommitted, in the working tree.

## What I measured

- `npx tsc --noEmit -p tsconfig.json`: clean, empty output (so the
  `grep -E "vehicles|third-house"` check is trivially empty). `npm run build`:
  23 modules, success.
- No `Math.random`, no `new THREE.*Material` in either owned file (grep verified).
- `npm run capture -- --tag props turningHead plaza streetElevation aerial`: 4/4
  frames, **0 page errors, 0 console errors**. Module stats: vehicles 178 objects /
  11 colliders / 18.7 ms; third-house 13 objects / 3 colliders / 1.7 ms. Draw calls
  at these stations: 51–69 (headless swiftshader fps/programs/triangles read
  63/0/0 — the harness zeroes some counters headless; calls are the usable number,
  far under budget).
- `npm run traverse`: **"5/5 routes passed; 4/4 house faces enterable"**,
  garage-on-the-RIGHT invariant **PASS** from both yards, verge scan unchanged
  (25.0 m / 28.0 m open). Free lane across the bulb confirmed in the aerial frame.

## What I looked at

Opened all four `captures/props-*.png` plus before-frames `veh2-turningHead.png`,
`veh2-aerial.png`, `final-plaza.png`, `final-streetElevation.png` (props views match
the historical station viewpoints exactly — note the filenames: the "plaza" station
frames the orange house face with the saloons, the "streetElevation" station looks
down the stem at the pylon; identical in `final-*`, so this is long-standing
station naming, not a harness bug).
- turningHead vs veh2: coach nose now has bezel depth in the lamps, a bumper that
  reads separate from the cream, grille slats, mirrors/wipers; whitewalls read as
  tyres not discs; truck glass is framed; third-house chimney pot/cap and porch
  posts visible over the fence; the bulb's free lane is open.
- aerial vs veh2: third-house plot gained hedge + fence + shrubs + a darker drive
  under the red car; coach roof pods and script present; all five vehicles on the
  asphalt, lane across the bulb clear.
- plaza/streetElevation: dark-blue saloon close-up shows shut-lines, handles,
  spears, domed hubcaps; two-tone car shows 4 lamps + NT55 plate; red driveway
  car shows fins + two-tone roof.

## What I could not resolve / flags

1. `src/build/vehicles.ts` is now ~770 lines vs the ~400 guideline (was 599 when
   the brief landed — the brief's parts list does not fit in 400 without a split
   into e.g. `coach.ts`/`cars.ts`; left for the owner — splitting is a cross-file
   move I did not want to make unilaterally mid-fleet).
2. Close-up hero parts (front bumper, mirror heads) now use full-metal chrome on
   the strength of the PMREM env map; the turningHead frame shows them bright, not
   black — holds. If lighting changes, `brightwork()` is still the fallback.
3. Mid-pass the harness was red for ~1 h because the freecam lane removed `#hud`
   from `index.html` while `main.ts` appended to it (`TypeError` on load — capture
   and traverse both failed). Not my files; resolved by their commit `afad912`,
   after which I re-ran everything above green. No action needed, recorded so the
   red window is not a mystery.
