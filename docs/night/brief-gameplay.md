# Lane `gameplay` - guns and killstreaks that work

Read `docs/night/_COMMON.md` first.

## The owner's words

> "bring in the features of gameplay from the other project as a reference like i said,
> guns killstreaks etc ... make sure things like the kill streaks and the guns and
> stuff like that are all working nicely"

## Files you own

- `src/weapons/**` (all of it; you may add files)
- `src/game/**` (new directory - create it; scoring, streaks, match state)
- One small, clearly-named wiring call in `src/main.ts`, and nothing else in that file.

Read-only: `src/core/**`, `src/build/**`, `src/ui/**`, `scripts/**`.
A sibling lane owns `src/ui/**`. If the HUD needs your ammo, score or streak state,
**expose a plain readable state object** from your own module and document its shape in
your report. Do not edit the HUD.

## Read the old project before you invent

`C:/Users/david/Desktop/stuff/atomic-acres` (reference only, copy no file) has a very
complete version of this. Worth your time:

- `src/killstreak-catalog.ts` - what the streak set has to represent
- `src/killstreak-activation-gate.ts`, `src/killstreak-awareness.ts`
- `src/killstreak-drone-deployment.ts`, `src/killstreak-drone-formation.ts`,
  `src/killstreak-flight-navigation.ts` - the UAV/drone family, the hardest part
- `src/host-killstreak-loadout-ack.ts` - how a streak gets authorised in multiplayer
- `src/directional-hud.ts`, `src/hud-feed.ts` - what the kill feed and damage
  indicator will need from you

An earlier pass here already started: read `docs/report-guns.md` and
`src/weapons/catalog.ts` if they exist before rewriting either.

## What to build

1. **A real weapon table** in one file: assault rifle, SMG, shotgun, sniper, pistol.
   Each with rpm, damage falloff by range, magazine, reserve, reload and empty-reload
   times, ADS time, spread parameters, recoil parameters. Adding a sixth must be one
   object.
2. **Hitscan** raycast from the camera, with a spread cone that grows while moving and
   firing and shrinks while still, crouched or aiming.
3. **Recoil as a learnable pattern**: a deterministic climb curve per weapon plus a
   bounded random horizontal term, AND a recovery that returns the camera toward the
   original aim when firing stops. The recovery is what makes it feel like BO2 rather
   than a spray simulator.
4. **ADS** moving FOV, spread, movement speed and viewmodel pose together over a
   per-weapon 200-280 ms.
5. **Killstreaks**: a catalogue with earn thresholds, an activation gate, and at least
   two that do something in world - a UAV-style reveal and a drone or airstrike. Model
   them so a host could authorise them later; the netcode lane is building that
   transport in parallel, so keep the authority boundary clean.
6. **Scoring and match state**: kills, deaths, streak counter, round timer.

## Paid-for lessons - do not rediscover these

- **The viewmodel must not use a depth-cleared overlay pass**, and clipping planes must
  not be toggled on a live material: three shader recompiles per clip-state change
  froze the old game.
- Hiding the viewmodel root **dropped two lights** from the scene and invalidated every
  shader program. Never hide or show anything that changes the light set.
- **A rotated slab's AABB is a phantom box.** The old "gun lifts on stairs" bug came
  from an obstruction test against the axis-aligned bounds of a rotated collider.
  Reject any candidate whose oriented volume exceeds about 1.5x its AABB volume.
- **Pool everything.** Muzzle flash, tracer, shell, decal, spark: pre-allocated, zero
  allocation per shot. This is where the old project leaked.

## Verify before you report

```
npx tsc --noEmit -p tsconfig.json
npm run build
npm run traverse
npm run capture -- --tag gameplay
```

Traverse must still report 4/4 house faces enterable and handedness PASS; ignore its
route PASS/FAIL, which is red for a geometry reason the orchestrator owns.

Then actually fire the weapons headlessly for 30 s each and report: JS heap at start
and end (your falsifier for pooling), shots landed vs fired at a fixed target at 10 m
and at 40 m (if those two numbers are equal your spread is not wired in), and the AR's
first ten shot offsets as a list. Open your captures and look at them - a muzzle flash
that renders as a white square is worse than none.
