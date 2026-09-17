# Task brief: THE TWO TEAM HOUSES — close-inspection detail

Read `docs/SPARK-CONTEXT.md` first. It binds you.

## Files you own exclusively

- `src/build/orange-house.ts`
- `src/build/white-house.ts`

Nothing else. Other agents are in `src/core/`, `src/main.ts`, `index.html`,
`src/build/yards.ts` and `src/build/surround.ts` right now.

## Context

These two houses are the map. The owner is about to walk and fly around them inspecting
closely, including inside. They already read correctly at a distance — the orange
house's swooping butterfly roof with its terracotta clerestory, and the white house's
rounded streamline-moderne capsules, are both right and are a **180-degree rotational
pair, not a mirror**. Do not redesign either. This is a detail and correctness pass.

## Defect 1 — the white house's roof glazing reads as a rooftop swimming pool

From above it is a pale-blue stadium-shaped panel inset in a white coping lip, with a
smaller blue disc beside it: the exact colour, shape and framing of a pool with a hot
tub. `docs/SPEC.md` does call for "pale blue-grey roof glazing" and a rooftop drum, so
the *elements* are right — the read is wrong. Fix it so it reads as **glazing**:
glazing bars dividing it into panes, a proper frame, a different reflectance from
still water. The rooftop drum should read as a plant/vent drum, not a hot tub.

## Defect 2 — interiors are bare shells

Both ground floors are open, lit, walkable and correctly glazed — that part is done.
But they are empty boxes, and the owner will walk inside. Add cheap period interior
detail: a staircase or its enclosure, a kitchen counter run, a fireplace or chimney
breast, room-dividing partitions with openings, skirting, a ceiling light. Keep it
blocky and instanced; this is set dressing, not furniture modelling.

**Anything you add inside must not block movement.** `npm run traverse` drives the real
controller through both houses and its door scan must keep reporting exactly one span
per real door on each face. If you add a partition, leave a doorway in it and give it
an honest collider.

## Defect 3 — the orange house's exterior stair lands oddly

It descends from the deck's inner end *toward* the garage, so the stair and the garage
crowd the same end. `docs/SPEC.md`'s NT03 read has the stair at the opposite end of the
house from the garage, with a **circular patio at the foot of the flight**. The patio
is built in `yards.ts` (not yours) centred on the deck. Move the flight so it lands on
that patio, or run it the other way — whichever reads closer to NT03. Say which you
chose and why.

## Defect 4 — exterior close-up detail

At 2 m the elevations are flat. Add: downpipes and gutters, a meter box, vents, a
house number, door furniture, a step and threshold, window reveals with visible depth,
a light beside each door. Cheap, instanced, from `PAL` only.

## Do not break

- the handedness invariant — `main.ts` asserts it and `traverse` gates on it
- the glazing work already done: panes are set back in a reveal with frame, cill,
  mullions and a transom, and the spandrel **below** each window is a solid collider.
  That last one is what stopped players walking through walls under windows and stopped
  the door scan reporting three doors on a face with one. Keep `solid = true` there.
- doorways at least 1.1 m wide and 2.1 m tall; the player capsule is 0.6 m wide with a
  1.68 m eye height

## Verify

```
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "orange-house|white-house"   # empty
npm run capture -- --tag house2
npm run traverse
```

`traverse` must report **5/5 routes, 4/4 house faces enterable, handedness PASS**, and
the door scan must show roughly one span per face — quote it before and after.

Then **open** `captures/house2-yardOrange.png`, `house2-yardWhite.png`,
`house2-streetElevation.png`, `house2-midStreet.png` and `house2-interiorOrange.png`
with the Read tool and look at them. Report what you actually saw.
