# Task brief: RECONSTRUCT THE PLAN FROM THE IN-GAME MINIMAP

Read `docs/SPARK-CONTEXT.md`, then `docs/DIMENSIONS.md` and `docs/REAL-REFERENCE.md`.

## Files you own exclusively

- `docs/PLAN.md` (new — your deliverable)
- `src/core/layout.ts` (numeric constants only — see hard rules)

Nothing else. Another lane owns `src/build/vehicles.ts`, `src/main.ts` and
`src/core/assets.ts` right now.

## The owner's complaint, still unresolved

> "ensure the layout matches black ops 2 from 2012"

A previous lane measured the constants from first-person frames using a 1.8 m player as
a ruler and concluded they were "mostly right". The owner still says the layout is
wrong. One of those is mistaken and it matters which.

## The source that lane did not use

**Every gameplay frame carries Black Ops 2's own minimap in the top-left corner.** That
minimap is an orthographic top-down schematic of the real playable area, drawn by the
game itself. It is by far the most authoritative plan evidence available — better than
inferring depth from a first-person view — and it is sitting in all 1100+ frames in
`docs/reference/gameplay/` (`f-*.jpg` and `g-*.jpg`).

Use it:

1. **Find frames where the minimap is at its clearest** — no smoke, no UAV overlay
   clutter, player near the centre. Open a good number with the Read tool.
2. **Read the plan off it.** The minimap shows building footprints, the street, the
   cul-de-sac bulb and the yard boundaries as filled shapes. Establish the map's
   **aspect ratio** and the **relative proportions**: street width as a fraction of
   overall width, house footprint vs street, yard depth vs house depth, bulb radius vs
   street width.
3. **Anchor the scale.** The minimap gives you proportions, not metres. Anchor it with
   one thing you can measure in a first-person frame — the 11 m coach parked on the
   bulb is ideal, because it appears on the minimap AND in side-on frames. Its length
   on the minimap converts every other minimap distance to metres.
4. **Cross-check against the compass.** The minimap has a N/S/E/W compass strip; use it
   to establish the map's true orientation and whether our +x/-x street axis matches.

## What `docs/PLAN.md` must contain

- The reconstructed plan, as an ASCII diagram in the same frame convention as
  `docs/SPEC.md` section 2 (+x right, +z down), with metres on the key spans.
- A table: every `layout.ts` constant, our value, the minimap-derived value, the ratio,
  and whether the difference is material.
- **A clear verdict on the owner's complaint**: is our plan actually wrong, and if so
  in what specific way — too wide, too deep, houses too far apart, bulb too big?
  Cite the frames.
- Anything the minimap cannot settle, marked OPEN.

## Then apply what you are confident in

Change the numeric constants in `src/core/layout.ts` where the minimap gives you a
well-anchored number.

**Hard rules:** numbers only — do not rename or remove any exported symbol, and do not
change the shape of `ORANGE` / `WHITE` / `HOUSES` or `garageIsOnTheRight()`. Eleven
builder modules import from this file. The handedness invariant must still hold.

A rescale can leave geometry overlapping or floating while typechecking perfectly, so:

```
npx tsc --noEmit -p tsconfig.json
npm run build
npm run traverse          # 5/5 routes, 4/4 faces, handedness PASS
npm run capture -- --tag plan
```

Both harnesses serve the **built** artifact — run `npm run build` first.

**Open** `captures/plan-aerial.png`, `plan-turningHead.png` and
`plan-streetElevation.png` and look at them. If a change makes things worse or breaks
traversal and you cannot fix it in budget, **revert that constant and say so**. A small
correct set of changes beats a broken rescale, and saying "the numbers were right after
all, here is the minimap proving it" is a perfectly good outcome — but only if the
minimap actually proves it.
