# Task brief: WEAPONS — viewmodel, firing, movement feel

Read `docs/SPARK-CONTEXT.md` first. It binds you.

## Files you own exclusively

- `src/weapons/` (new directory — as many files as you need, one concern each)
- `src/main.ts`

Do not touch `src/build/*`, `index.html`, `src/ui/*`, `src/core/world.ts`,
`src/core/renderer.ts`, `src/core/materials.ts`, `src/core/post.ts`,
`src/core/assets.ts` or `scripts/blender/*`. Five other agents own those right now.

`src/core/player.ts` is **shared read-only** — read it to understand movement state,
but do not edit it. If you need something from it, expose it via `main.ts`.

## The project, renamed

This is now **Atomic Acres** — a fan project *inspired by* Call of Duty: Black Ops 2,
starting close to BO2's Nuketown 2025 and diverging from there. Not a clone, not
passing itself off as the original. Use that framing in any user-visible string.

## What to build

A first-person weapon that feels like a BO2-era shooter. In rough priority:

1. **A weapon viewmodel** — an assault rifle, procedurally built (see below on assets),
   parented to the camera, with idle sway, walk bob, and sprint-lower. It must sit in
   the right place at a 1.68 m eye height and not clip through walls.
2. **Firing** — semi/auto fire with a sensible RPM, muzzle flash, recoil kick with
   recovery, shell ejection, and a tracer or hitscan line.
3. **Hit detection** — raycast against the scene, with an impact decal or spark and a
   small debris puff at the hit point. There are no bots and none are wanted, so shoot
   the world: walls, vehicles, mannequins.
4. **ADS** — right mouse aims down sight: FOV change, viewmodel moves to centre,
   reduced sway, tighter spread.
5. **Reload and ammo** — magazine count, reserve, a reload animation (even a simple
   lower-tilt-raise), and an out-of-ammo click.
6. **Weapon switching** — at least two weapons (rifle + pistol, or rifle + SMG) on
   `1`/`2` or mouse wheel.

## Learn from the previous project, but do not copy its problems

`C:/Users/david/Desktop/stuff/atomic-acres/src/` is a much larger earlier incarnation
of this game by the same owner. It has real, working implementations worth reading for
**design**: weapon presentation, recoil, ADS, killstreaks, hit confirmation. Read them.

**But that project was abandoned partly over repeated graphical asset implementation
problems**, and this repo exists to not repeat them. Specifically, from its own
recorded lessons:

- **Never construct a `THREE.Material` per frame or per state change.** One of its worst
  bugs was a clipping toggle that recompiled materials three times per change and froze
  the game. Materials are singletons.
- **Never add, remove or hide a light at runtime** — it invalidated every shader program
  in that project.
- A viewmodel needs a **depth-cleared overlay** or it clips into world geometry; solving
  it with clipping planes caused shader recompiles there.
- Do not copy its files. Read for approach, write fresh here.

## Assets

Prefer **procedural geometry in code**, consistent with the rest of this repo — a
blocky-but-credible rifle built from boxes and cylinders reads fine at viewmodel scale.
A separate agent is building a Blender → glTF PBR pipeline and will expose
`src/core/assets.ts`; **do not depend on it landing**. If it exists when you get there
you may use it, but your weapon must work without it.

## Do not break the harnesses — this is how this project proves itself

`src/main.ts` exposes `window.__NT` and two harnesses drive it:
`goto`, `spawn`, `release`, `stats`, `moduleStats`, `render`, `probeReset`,
`probeWalkTo`, `probePos`, `collidersAt`, plus `handedness` inside `stats()`.

- `npm run capture` must still pass, 10 stations, **zero page errors**
- `npm run traverse` must still report **5/5 routes, 4/4 house faces, handedness PASS**
- `cameraHeldByQA` must keep stopping the loop re-syncing the camera during captures,
  or every station silently photographs the spawn view
- the weapon must be **hidden or ignored** at capture stations, or every fidelity frame
  gets a gun in the corner of it. Add a way to suppress the viewmodel via `__NT`.

## Verify

```
npx tsc --noEmit -p tsconfig.json      # clean
npm run capture -- --tag wep           # zero page errors
npm run traverse                       # 5/5, 4/4, handedness PASS
```

Then drive it in a headless browser yourself: fire, reload, ADS, switch weapons, and
confirm no page errors and no material/program count growth over 30 seconds of firing
(`window.__NT.stats().programs` must not climb — if it does, you are creating materials
at runtime and that is the exact bug that killed the last project).

**Open** at least two captures with the Read tool and confirm the viewmodel is
suppressed in fidelity frames. Report what you built, the keybindings, and what you
could not finish.
