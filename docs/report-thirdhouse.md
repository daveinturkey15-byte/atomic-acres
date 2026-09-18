# Night lane report: THIRDHOUSE — re-site the east side

## What changed (2 files; `plaza.ts` inspected, untouched)

**`src/build/third-house.ts`** (400 lines)
- `layout.THIRD_HOUSE_X` (44.5) is **stale and I stopped using it**. It encoded 8 m
  past the OLD east tangent (26.0 + 10.5 = 36.5). After the re-centre
  (`HEAD_CENTER_X` 0.0) it stranded the house 34 m past the bulb with ~30 m of bare
  concrete in front of it. `layout.ts` is read-only for this lane, so the module now
  derives the same relationship against the new head:
  `HOUSE_X = HEAD_CENTER_X + HEAD_RADIUS + 8.0 = 18.5`, gable face at ~15.2, rear at
  ~21.8 (well inside `BOUND_X_MAX` 46). Every house/drive/car/plot reference that
  used `THIRD_HOUSE_X` now uses `HOUSE_X`.
- New **forecourt apron**: bulb east tangent → gable on the street axis (4.2 × 5.2 m,
  same `T_DRIVE` rung, rides 8 mm over the bulb's pavement ring), flanked by hedges.
  This is the SPEC "driveway apron to the boundary fence" read.
- Plot adapted to the new neighbours: the +z timber fence now starts east of the
  white garage's east face (`WHITE.garageX + GARAGE_LEN/2 + 0.4` — the old run would
  have grazed the garage front at z=13.63); new rear hedge return across the back of
  the house (drive left open).
- No new materials (existing `ctx.mat` singletons only), no new draw-call families:
  +1 mesh (forecourt slab), rest goes into existing instanced batches.

**`src/build/skyline.ts`** (+x fringe only)
- The old `+x` pavilion row derived off `THIRD_HOUSE_X + 19` (x≈63.5) — 60 m out,
  leaving the aerial's dead slab. Replaced with two staggered ranks: a **near rank**
  at `BOUND_X_MAX − 14` (≈32–40) with a |z| < 13 gap on the street axis so the house
  keeps the view, plus the **far rank** at `BOUND_X_MAX + 13` as before. Same 3
  instanced meshes, more instances; no new materials.
- Side effect, unavoidable: the near rank consumes extra `ctx.rand()` values, so the
  far/−x ranks, city band and mountain rings shift deterministically downstream of
  the same stream. Same families, same counts, slightly different placement.

**`src/build/plaza.ts`** — no change. Verified by grep: every placement is
`BOUND_X_MIN`-relative (west end). Nothing in it was laid out against the old east
plan, and the west stem/−x end is preserved in the new plan.

## What I measured
- `npx tsc --noEmit`: clean.
- `npm run build`: OK (`dist/assets/index-ClQT7d2Z.js`; rebuild after the final
  comment-only trim produced the identical hash, so the captures below match src).
- `npm run traverse`: **4/5 routes, 4/4 house faces enterable, handedness PASS** —
  exactly the known floor in `docs/night/_COMMON.md`. Detail: the east-flank route
  now gets 4/9 legs and sticks at (18, −6.3), i.e. on the re-sited house's south
  face, where it previously stopped at the yards fence line (x≈10.8). Count
  unchanged, but see the unresolved note below.
- `npm run capture -- --tag thirdhouse`: exit 0, 10 frames + summary, **zero page
  errors, zero console errors**. Per-station calls 65–119; no new shader programs
  (no new materials). `third-house` module: 14 objects / 4 colliders.

## What I looked at (Read tool, not just exit codes)
- `captures/thirdhouse-turningHead.png`: from the west stem the third house now
  **closes the view** — dark pitched roof, white gable with two window bands, vent,
  chimney at ~29 m, standing clear over/between the buses. Before: a tiny distant
  block at ~55 m. Test 1 passes.
- `captures/thirdhouse-aerial.png`: house sits just east of the circle with
  forecourt, side drive + red car on its +z flank, hedges; near-rank pavilions dot
  the former dead zone at x≈32–40. The 30 m bare gap is gone; the east reads as
  town edge. Test 2 passes.
- `captures/thirdhouse-summary.json`: confirmed `pageErrors: []`,
  `consoleErrors: []`, `handedness: [true, true]`.

## What I could not resolve
1. **`THIRD_HOUSE_X = 44.5` should be updated or removed in `layout.ts`** (not my
   file). It no longer corresponds to anything; `skyline.ts` and `third-house.ts`
   now both work around it. Suggested: `HEAD_CENTER_X + HEAD_RADIUS + 8.0`, or move
   the constant's meaning to "rear out-of-bounds anchor" explicitly.
2. **East-flank traverse vs the house.** The fixed east-flank waypoints run up x=18,
   straight through the re-sited house footprint (x 14.4–21.8, z ±6). The route
   failed before (yards fence, no hole — not my file) and fails now (house south
   face); 4/5 holds either way. But when the yards lane eventually opens the east
   fence, this house becomes the next seal. Either the route must pass east of the
   plot (x ≥ 23) or a future lane must re-agree the corridor — flagging, not fixing,
   since waypoints and fences are both outside my set.
3. The bulb-to-gable forecourt ends at the yards boundary fence, which has **no
   hole** there. Visually correct (house beyond a fence); permeable only if the
   yards lane ever wants a gate.
