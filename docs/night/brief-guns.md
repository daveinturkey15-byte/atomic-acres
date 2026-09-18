# Lane `guns` - weapons that feel like BO2

Read `docs/night/_COMMON.md` first.

## The ask, in the owner's words

> "make sure things like the kill streaks and the guns and stuff like that are all
> working nicely"

There is a weapon skeleton in `src/weapons/` already: `types.ts`, `controller.ts`,
`viewmodel.ts`, `effects.ts`. Your job is to make firing a gun in this map feel like
firing a gun in Black Ops 2 - and to make the code small enough that the next person
can add a weapon in one file.

## Files you own

- `src/weapons/**` (all of it, and you may add files)
- You may add `src/weapons/catalog.ts` for the weapon table.

Read-only: `src/build/**`, `src/core/layout.ts`, `src/core/palette.ts`,
`src/core/materials.ts`, `src/core/world.ts`, `src/ui/**`.
The `hud` lane is editing `src/ui/**` in parallel - do not touch it. If the HUD needs
to know your ammo count, **expose it** from your own module as a plain readable state
object and describe its shape in your report; that lane will wire to it next wave.

## Read before you write

In `C:/Users/david/Desktop/stuff/atomic-acres` (reference only, copy nothing) look at
how the old project modelled weapons, recoil, spread and the viewmodel, and at these
paid-for lessons which are already in this project's docs:

- **The viewmodel must not use a depth-cleared overlay pass**, and clipping planes must
  not be toggled on a live material - three shader recompiles per clip-state change
  froze the old game.
- **A rotated slab's AABB is a phantom box.** The old project's "gun lifts on stairs"
  bug came from an obstruction test against axis-aligned bounds of a rotated collider.
  Reject any candidate whose oriented volume is more than ~1.5x its AABB volume.
- Hiding the viewmodel root **dropped two lights** from the scene and invalidated every
  shader program. Never hide/show anything that changes the light set.

## What "feels like BO2" means concretely

BO2 is 2012 arena-paced: fast ADS, short time-to-kill, hitscan for everything except
launchers, recoil that is a **learnable pattern plus a small random component**, and
generous hit feedback.

1. **Hitscan raycast** against the world, one ray from the camera, with a spread cone
   that grows while moving/firing and shrinks while still/ADS/crouched.
2. **Recoil as a two-part model**: a deterministic climb curve per weapon plus a
   bounded random horizontal term; **and a recovery** that returns the camera toward
   the original aim when you stop firing. The recovery is what makes it feel like BO2
   rather than like a spray simulator.
3. **ADS** that changes FOV, spread, movement speed and the viewmodel pose together,
   over a per-weapon time in the 200-280 ms range.
4. **A real weapon table.** At minimum an assault rifle, an SMG, a shotgun, a sniper
   and a pistol, each with: rpm, damage falloff by range, magazine, reserve, reload
   time (and a distinct empty-reload time), ADS time, spread parameters and recoil
   parameters. One object per weapon, in one file, so adding a sixth is trivial.
5. **Feedback**: muzzle flash, tracer, shell eject, impact decal + spark/dust by
   surface, a hit marker signal, and camera kick. Every one of these must come from a
   **pre-allocated pool** - zero allocation per shot. This is where the old project
   leaked.
6. **Sound is out of scope this wave** unless it is free - say so and move on.

## What will get your work reverted

- Any allocation per shot or per frame. Pool everything. Verify with a heap snapshot
  over 30 seconds of continuous fire and put the numbers in your report.
- Constructing a `THREE.Material` anywhere outside the shared material module.
- A frame-time regression above 1 ms at 1920x1080.
- Changing the scene's light set at runtime.

## Verify before you report

```
npx tsc --noEmit -p tsconfig.json
npm run build
npm run traverse
npm run capture -- --tag guns
```

Then actually shoot things. Drive the built page headlessly, fire each weapon for
30 seconds, and report: JS heap at start and end, frame time, shots landed vs shots
fired at a fixed target at 10 m and 40 m (this is your falsifier for the spread and
falloff model - if the 40 m number equals the 10 m number, your spread is not wired in),
and the recoil pattern of the AR as a list of the first 10 shots' aim offsets.

**Open your captures and look at them.** A muzzle flash that is a white square is worse
than no muzzle flash.
