# Task brief: YARD AND SURROUND DETAIL

Read `docs/SPARK-CONTEXT.md` first. It binds you.

## Files you own exclusively

- `src/build/yards.ts`
- `src/build/surround.ts`

Nothing else. Other agents are in `src/core/`, `src/main.ts`, `index.html`,
`vite.config.ts` and the house modules right now.

## Context

The owner is about to walk and fly around this map inspecting it closely. Things that
survive a 90 m aerial do not survive a 3 m walk-past. An independent critic reviewed
the rendered frames and left these unactioned in your files.

## Defect 1 — the glasshouse is effectively invisible

In the orange back yard. Its panes are 0.06 m of `ctx.mat.glass` at opacity 0.42 with
four steel corner posts and **no glazing bars**, so at the `yardOrange` station it is a
faint haze with a grey post in it. It also **clips the +x side fence**.

A glasshouse reads through its **frame**, not its glass: ridge, eaves, corner posts,
regularly spaced glazing bars dividing the panes, a door, a low dwarf wall at the base.
Give it those (instance the bars), and move it clear of the fence.

## Defect 2 — street-lamp arms alias into white asterisks

The curved lamp arms are ~0.15 m spans. At aerial range they alias into little white
star shapes that read as broken geometry. Thicken the arm, or simplify the curve, so
it resolves cleanly at distance while still reading as a curved lamp head close up.

## Defect 3 — density under close inspection

Walk the yards mentally at eye height. Both are still sparse for a 1960s show-home
garden. Within your two files, and without contradicting `docs/SPEC.md` section 3:

- the ORANGE yard is specified as glasshouse, cold frames with red flowers, a white
  curved-roof carport, a crate store, a circular patio, stepping stones
- the WHITE yard is a garden pod, a sand pit, a shuffleboard court, stepping stones

Add the *supporting* detail those imply — plant pots, a watering can, a hose reel, a
garden chair, a low wall, bedding plants, a washing line, edging. Keep every addition
cheap and instanced. **Do not add anything SPEC section 3 marks OPEN** (front ledge,
mailboxes) and do not invent features from a different Nuketown.

## Defect 4 — check nothing is buried

`ground.ts` puts the lawn plateau top at `KERB_HEIGHT + 0.001` = 0.141. Your file has a
documented y-ladder at the top derived from `KERB_HEIGHT` — every flat feature you add
must sit on a rung above the lawn, not be authored from y=0. An earlier pass lost the
patio, sand pit, court and all the stepping stones to exactly this, and the numbers
looked fine the whole time. Re-check the existing ones are still clear, and put
anything new on the ladder.

## Rules

Colours from `PAL`. Materials from `ctx.mat` — never construct one. `ctx.rand()`, never
`Math.random()`. Dimensions from `src/core/layout.ts`. `InstancedMesh` for anything
repeated more than ~20 times. Nothing floats; nothing intersects a house, fence, hedge
or vehicle.

## Verify

```
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "yards|surround"     # must be empty
npm run capture -- --tag yard2
npm run traverse                                                       # must stay 5/5
```

Then **open** `captures/yard2-yardOrange.png`, `yard2-yardWhite.png`,
`yard2-spawnA.png`, `yard2-spawnB.png` and `yard2-aerial.png` with the Read tool and
look at them, before and after. Report what you actually saw change.
