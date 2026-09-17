Read `docs/night/_COMMON.md` and `docs/SPARK-CONTEXT.md` first. They bind you.

# Night lane: INTERIORS - the houses from the inside

## Files you own
`src/build/orange-house.ts`, `src/build/white-house.ts`

## Context
Both ground floors are open, lit, walkable, correctly glazed and enterable from all
four faces - the traverse door scan proves it. They are also nearly empty, and the
player can walk into them.

`docs/REAL-REFERENCE.md` records two signature rooms read off real gameplay footage:
a teal-grey living / dining plus kitchen, and a purple-diamond and gold bedroom with
mustard bunks and a mint ensuite. There is also an orange-stripe utility cell with a
wall station and signage plaques. Frame citations are in that document - **open the
frames it names and look at them.**

## What to do
Dress both interiors so walking in is worth doing: partitions with real doorways,
a stair enclosure, kitchen counter runs, a fireplace or chimney breast, skirting,
ceiling fittings, and the period colour schemes the reference records. Windows should
read from inside as well as outside.

Keep it blocky and instanced - set dressing, not furniture modelling.

## The constraint
**Anything you add must not block movement.** `npm run traverse` drives the real
controller through both houses and its door scan must keep reporting about one span
per real door on each face. If you add a partition, leave a doorway in it and give it
an honest collider. Doorways at least 1.1 m wide and 2.1 m tall; the player capsule is
0.6 m wide with a 1.68 m eye height.

Also keep: the spandrel BELOW each window is a solid collider (that is what stopped
players walking through walls under windows), and the handedness invariant.

## Verify
`npm run build`, `npm run traverse` - quote the door scan before and after - and
`npm run capture -- --tag int`. Open `captures/int-interiorOrange.png` and at least one
frame of the white house interior. Describe what you actually see inside.
