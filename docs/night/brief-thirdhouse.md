Read `docs/night/_COMMON.md` and `docs/SPARK-CONTEXT.md` first. They bind you.

# Night lane: THIRDHOUSE - repair the east side after the re-centre

## Files you own
`src/build/third-house.ts`, `src/build/plaza.ts`, `src/build/skyline.ts`

## The defect
The turning circle moved from the +x end to the map centre tonight
(`HEAD_CENTER_X` 26.0 -> 0.0). Anything positioned against the old east end is now
stranded. Open `captures/ctr-aerial.png`: the third house stands alone on bare
concrete far to the east with a large dead gap, and the east side has nothing holding
the eye.

## What to do
Re-site the third house to do the job `docs/SPEC.md` gives it: the landmark that tells
you which end of the map you are at, sitting just beyond the boundary on the east and
readable at 25-40 m. Derive its position from `layout.ts` constants
(`THIRD_HOUSE_X`, `HEAD_CENTER_X`, `HEAD_RADIUS`, `BOUND_X_MAX`).

**You may NOT edit `layout.ts`.** If `THIRD_HOUSE_X` is simply wrong now, say so
clearly in your report and position relative to the bounds instead.

Then re-balance the east side so it is not an empty slab: the perimeter pavilions,
fencing and planting in `skyline.ts` and `plaza.ts` were laid out for the old plan too.

## Verify
Open `captures/thirdhouse-aerial.png` and `captures/thirdhouse-turningHead.png`.
The test: from the central circle looking east, is there a distinct house closing the
view, and does the east side read as part of the same town?
