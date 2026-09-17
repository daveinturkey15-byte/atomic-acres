# Implementation wave — apply `docs/REAL-REFERENCE.md`

Read `docs/SPARK-CONTEXT.md` first, then **`docs/REAL-REFERENCE.md` in full**, then the
part of `docs/SPEC.md` section 3 marked FOOTAGE CORRECTION.

## Why this wave exists

The owner looked at the build and said it does not look like Black Ops 2's Nuketown.
He was right. The previous spec came from six low-resolution wiki stills. It has now
been replaced by `docs/REAL-REFERENCE.md`, written from **422 frames extracted from
real BO2 gameplay footage** (in `docs/reference/gameplay/`, `f-<videoid>-NNN.jpg`).
Every correction there cites the frames it came from.

**You can open those frames yourself with the Read tool. Do it.** When
`REAL-REFERENCE.md` cites a frame for something you are building, open that frame and
look at it rather than working from the prose.

## Rules for this whole wave

- **`src/core/palette.ts` is READ-ONLY.** All the colour keys the corrections need have
  already been added centrally (`rubbleStone`, `rubbleMortar`, `pavingWarm`,
  `pavingStain`, `flagstone`, `fenceRail`, `busNavy`, `busBlack`, `trailerBody`,
  `trailerRoof`, `trailerTrim`, `interiorTeal`, `interiorPlum`, `interiorGold`,
  `interiorMint`, `saucerSoffit`, `hazardYellow`). Use them. If you genuinely need
  another, use the closest existing key and say so in your report.
- **`src/core/materials.ts` is OWNED BY ANOTHER AGENT right now** and is being rewritten
  with roughness and normal maps. Do not touch it. Build with `ctx.mat.painted(...)`
  and the existing library entries. If a correction needs a new material (the rubble
  veneer, for example), approximate it with geometry plus `painted()` and note in your
  report that it wants a proper material later.
- Never construct a `THREE.Material` in a builder. `ctx.rand()`, never `Math.random()`.
  Every structural dimension from `src/core/layout.ts`.
- **This is a fan project inspired by BO2**, starting close and diverging. Build
  original geometry that reads like the reference. Do not reproduce game art or
  trademarked logos. Where the reference shows signage, write plausible in-world text
  in the same spirit, not a copy of Treyarch's wording.
- Respect the OPEN items at the end of `REAL-REFERENCE.md` — where the footage could
  not settle something, build the cheapest plausible thing and do not invent detail.

## Gates for every lane in this wave

```
npx tsc --noEmit -p tsconfig.json 2>&1 | grep <your files>   # must be empty
npm run capture -- --tag <yourlane>
npm run traverse
```

`traverse` must still report **5/5 routes, 4/4 house faces enterable, handedness PASS**,
and the verge scan must keep a comparable amount of open verge on both sides. Quote it.

Then **open** the captures that show your work with the Read tool and say what you
actually saw change. Do not report success because it compiles — that is the specific
failure mode this project exists to avoid.

Draw-call budget for the whole scene is 1200 and it currently sits near 470. Keep an
eye on `window.__NT.stats().programs` — it stays near 20 only because materials are
singletons.
