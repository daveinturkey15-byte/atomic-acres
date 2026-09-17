# Task brief: VEHICLES AND THE THIRD HOUSE — close-inspection detail

Read `docs/SPARK-CONTEXT.md` first. It binds you.

## Files you own exclusively

- `src/build/vehicles.ts`
- `src/build/third-house.ts`

Nothing else. Other agents are in `src/core/`, `src/main.ts`, `index.html`, the two
team houses, `src/build/yards.ts`, `src/build/surround.ts` and `vite.config.ts`.

## Context

The owner is about to walk and fly around this map inspecting it closely. The tour
coach stands on the turning head and he will walk right past it. It was recently
rebuilt from a flat-fronted transit bus into a 1950s intercity coach — crowned raked
nose, split windscreen on a chrome pillar, slatted grille, destination blind,
tumblehome, whitewalls with hubcaps, and a "Nuketown" script on the flank via
`ctx.mat.signText`. **That work is good. Do not redesign it.** This is a detail pass.

## What to do

### 1. Coach — close-up credibility
At 2 m the coach still reads simple. Add, cheaply and instanced: door and door seams,
wing mirrors, wipers, a roof vent or two, tail lights and a rear bumper, a luggage bay
hatch along the skirt, tyre sidewall detail, a licence plate, an exhaust. Two known
nits from a critic: the **headlamps read flat**, and the **front bumper is too close in
value to the cream body and disappears at distance**. Fix both.

### 2. The other four vehicles
The box truck, the two saloons and the driveway car are cruder than the coach. Bring
them up: window frames, door lines, handles, lights front and rear, grilles, plates,
proper wheels. They are 1950s/60s American iron — slab sides, heavy chrome, whitewalls,
wraparound screens, tail fins. Keep each one's existing colour and position.

### 3. Do not break the collider work
Each vehicle's collider is **stepped along its own length axis** into several
axis-aligned boxes, so a rotated vehicle's collision follows its diagonal instead of
its bounding rectangle. A single AABB fitted to a rotated envelope previously walled
off the turning head — an 11.6 x 2.87 m coach at 25 degrees has a 7.5 m z-extent. The
slab count is driven by `|sin(2*yaw)|`. **Keep that.** If you change a vehicle's size
or angle, re-check the free lane across the bulb.

### 4. Third house
It closes the cul-de-sac and is the map's best landmark for telling the two ends apart.
It is out of bounds, so it is silhouette work: it already has a dark pitched gable,
white-framed window bands with dark lights, a door, a gable vent, a drive and a red
saloon. Add roof detail (ridge, barge boards, a chimney pot), a porch, guttering and a
downpipe, a fence or hedge to its plot, and a little planting — enough that at 25–40 m
it reads as a real house rather than a box with bands on it.

## Rules

Colours from `PAL`. Materials from `ctx.mat` — never construct one. `ctx.rand()`, never
`Math.random()`. Placement from `src/core/layout.ts`. `InstancedMesh` for repeats.
Nothing floats — check every wheel touches the surface it stands on, and note that
`ground.ts` puts garage aprons on the `KERB_HEIGHT` plateau, not at y=0.

Note on chrome: `ctx.mat.chrome` is metalness 0.95. There **is** now a PMREM
environment map in `world.ts`, so full metals reflect properly — but check in a frame
rather than assuming, and prefer `ctx.mat.painted(PAL.chrome, 0.24, 0.4)` for large
bright trim faces if real chrome reads too dark.

## Verify

```
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "vehicles|third-house"   # must be empty
npm run capture -- --tag props
npm run traverse                                                           # must stay 5/5
```

Then **open** `captures/props-turningHead.png`, `props-plaza.png`,
`props-streetElevation.png` and `props-aerial.png` with the Read tool and look at them,
before and after. Report what you actually saw change, and quote the traverse result.
