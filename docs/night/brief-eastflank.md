Read `docs/night/_COMMON.md` and `docs/SPARK-CONTEXT.md` first. They bind you.

# Night lane: EASTFLANK - you must be able to run around BOTH houses

## Files you own
`src/build/yards.ts`, `src/build/surround.ts`

## The defect
`npm run traverse` is at 4/5 and the red one is real: the east flank is SEALED.
A collider scan of the orange back yard shows z=-28 free only out to x=9.5, with a
blocker around **x=10..11.5** that stops you getting from the yard round the east end
of the house. The west flank is open and passes.

In Black Ops 2's Nuketown you can run around BOTH sides of BOTH houses. The flanking
lanes either side are a defining part of how the map plays. Ours has one.

## What to do
Find what occupies x about 10..11.5 in the orange yard - a fence return, a hedge run,
or new clutter - and open a genuine lane through it: a gate, a gap in the boarding, a
break in the hedge. Then do the same on the WHITE yard and open it symmetrically; the
houses are a 180-degree rotational pair and the flanks should mirror that.

Locate the blocker with `window.__NT.collidersAt(x, z, y)` from a headless page rather
than guessing - that is how it was found in the first place.

Keep clutter that is doing real work as cover. The goal is a passable lane, not a
cleared yard.

## Verify
`npm run traverse` must report **5/5 routes**, still 4/4 house faces, handedness PASS.
Quote before and after. Then open `captures/eastflank-yardOrange.png` and
`captures/eastflank-aerial.png` and confirm the yard still reads as an enclosed back
garden rather than an empty lot.
