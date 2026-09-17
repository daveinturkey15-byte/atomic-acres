# Task brief: THE GROUND PLANE — what the player stares at all day

Read `docs/SPARK-CONTEXT.md` first. It binds you.

## Files you own exclusively

- `src/build/ground.ts`
- `src/build/mannequins.ts`

Nothing else. Other agents are in `src/core/`, `src/main.ts`, `index.html`, the two
team houses, `src/build/yards.ts`, `src/build/surround.ts`, `src/build/vehicles.ts`,
`src/build/third-house.ts` and `vite.config.ts`.

## Context

The owner is about to walk and fly around this map inspecting it. In a first-person
view the road and pavement occupy a third to a half of the screen at all times, and
right now they are large flat washes. This is the highest-leverage surface in the
project for close-up credibility.

## 1. Road and pavement detail

**Do not break the y-ladder.** `ground.ts` has a documented ladder at the top of the
file and the rungs are spaced against a measured depth-buffer resolution
(`z^2 x 7.5e-7 m`); at aerial range an 8 mm step was already inside the resolvable
limit and produced paving-coloured stipple across the whole street. Anything you add
gets its own rung, and you update the comment.

Add: painted road markings (centre line, the turning-head circulation), a camber or at
least a gutter line at the kerb, drain gratings, expansion joints and cracks in the
paving, tyre scuffs and oil marks on the turning head, a dropped kerb at each driveway,
tactile paving or a kerb radius at the corners, manhole and utility covers beyond the
one that exists. Keep it cheap and instanced — these are decals on flat quads.

Note SPEC section 3 marks **mailboxes** and the exact **turning-head inset** as OPEN.
Do not invent those.

## 2. Mannequins

35 figures, already fixed for limb gaps, seated poses, base discs and the bare/dressed
ratio, and the toppled ones were moved off the carriageway. **Do not undo any of that.**
What is left is close-up quality: at 2 m they are smooth featureless capsules. Add the
cheap things that sell a shop mannequin — a seam line, a joint ring at shoulder/hip, a
slightly faceted head, a wig-block crown, a subtle two-tone between limbs and torso.
Add a few more figures in genuinely new places if it helps the map read as a test town
— on a porch, leaning on a vehicle, one in an upstairs window — but keep the total
under about 45 and keep them out of the parked vehicles and out of the two fidelity
camera lines at x=6.

They have **no colliders** by design; keep it that way and keep the comment saying why.

## Rules

Colours from `PAL`. Materials from `ctx.mat` — never construct one. `ctx.rand()`, never
`Math.random()`. Dimensions from `src/core/layout.ts`. `InstancedMesh` for anything
repeated more than ~20 times — road markings and paving joints must not become
hundreds of draw calls.

Ground planes should `receiveShadow` and not `castShadow`.

## Budget

The whole scene must stay under 1200 draw calls and 900k triangles at every camera
station; it is currently at about 363 / 135k with 18 shader programs. The program count
is the number to watch — it stays at 18 only because materials are singletons.

## Verify

```
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "ground|mannequins"   # must be empty
npm run capture -- --tag gnd
npm run traverse                                                        # must stay 5/5
```

`traverse` must still report 5/5 routes, 4/4 house faces enterable, handedness PASS,
and the verge scan must still show a comparable amount of open verge on both sides —
quote it before and after. The player's floor height comes from **collider tops**
(`groundUnder()` defaults to `best = 0`), so every raised pad must keep its support
collider or the player sinks into it.

Then **open** `captures/gnd-streetElevation.png`, `gnd-turningHead.png`,
`gnd-midStreet.png` and `gnd-aerial.png` with the Read tool and look at them, before
and after. Report what you actually saw change.
