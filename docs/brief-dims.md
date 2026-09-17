# Task brief: MEASURE THE REAL DIMENSIONS

Read `docs/SPARK-CONTEXT.md` first, then `docs/REAL-REFERENCE.md`.

## The problem, in the owner's words

> "its BO2 but your layout and the gameloop arent the same, the dimensions of the
> street/cover/house etc need to be the same please"

He is right, and this is the root of it: **the numbers in `src/core/layout.ts` were
invented, not measured.** They were picked at the start of the project to be
self-consistent and plausible. Nobody ever checked them against the real map. Real
Nuketown 2025 is famously *tiny* and *tight*; ours is almost certainly too generous.

## Files you own exclusively

- `docs/DIMENSIONS.md` (new — your deliverable)
- `src/core/layout.ts` (you may change the numeric constants — see the hard rules)

Nothing else. Do not touch anything in `src/build/`.

## What to do

### 1. Measure, from evidence, not memory

You have three sources. Use all of them and say which gave what:

**(a) 422 gameplay frames** in `docs/reference/gameplay/` (`f-<videoid>-NNN.jpg`).
Open them with the Read tool. Use known real-world rulers that appear in frame:
a standing player is ~1.8 m; a 1950s intercity coach is ~11 m long and ~3.2 m tall;
a doorway is ~2.0 m; a kerb is ~0.15 m. Count how many player-heights span a street,
a house frontage, a garage door. Triangulate.

**(b) Call of Duty unit convention.** BO2 is a Quake-lineage engine: **1 game unit = 1
inch**, so metres = units × 0.0254. If you can find the map's extents in units from any
credible source, that converts directly. State the source and treat it as CLAIMED unless
a frame corroborates it.

**(c) The game is installed**: `C:/Program Files (x86)/Steam/steamapps/common/Call of
Duty Black Ops II`. You may **read** files there to look for map metadata. Do NOT launch
it, do not modify anything, and do not attempt to extract or ship any game asset — this
is a fan project and we build original geometry. Reading a number is fine; taking art is
not.

### 2. Write `docs/DIMENSIONS.md`

For every constant in `layout.ts`, a table row: current value, measured value, how it
was measured, and a confidence (VERIFIED from a frame with the ruler named / CLAIMED from
a source / ESTIMATED). The ones that matter most, in order:

- **spawn-to-spawn distance** (the single most important number — it sets the whole feel)
- street width kerb-to-kerb, and carriageway width
- house frontage length, depth, storey height, and the garage wing
- front lawn depth (pavement to house) and back yard depth (house to fence)
- turning-head radius
- the height of cover: fences, hedges, the appliance banks, vehicle roofs

### 3. Apply what you are confident in

Change the constants in `src/core/layout.ts` **only where you have a VERIFIED or
well-argued CLAIMED number.** Leave the rest and say so.

## Hard rules

- **Change numbers only. Do not rename or remove any exported symbol**, and do not
  change the shape of `ORANGE` / `WHITE` / `HOUSES` or `garageIsOnTheRight()`. Ten
  builder modules import from this file; renaming anything breaks all of them.
- The handedness invariant must still hold — `main.ts` asserts it and `traverse` gates
  on it.
- Every builder derives from these constants, so a value change should propagate. It may
  still break something (a hardcoded assumption, a collider that no longer reaches).
  **Your job includes finding out.**

## Verify

```
npx tsc --noEmit -p tsconfig.json     # clean
npm run build
npm run traverse                       # 5/5 routes, 4/4 faces, handedness PASS
npm run capture -- --tag dims
```

Both harnesses now serve the built artifact, so **run `npm run build` before them.**

Then **open** `captures/dims-aerial.png`, `dims-turningHead.png` and
`dims-streetElevation.png` and look. A rescale can leave geometry overlapping or
floating that typechecks perfectly. Report exactly what moved, what broke, and what you
did not dare change.

**If a change makes the map worse or breaks traversal and you cannot fix it inside your
budget, revert that constant and say so.** A correct smaller set of changes beats a
broken rescale.
