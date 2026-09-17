# Atomic Acres

A from-scratch, code-only fan project inspired by **Black Ops 2 `Nuketown 2025`**
in Three.js. It starts close to BO2's Nuketown 2025 and diverges from there —
**Nuketown 2025** is the name of the map inside the game. Every mesh and every
texture is generated procedurally at load — nothing is downloaded, and nothing
is carried over from any previous project.

Unofficial fan project — not affiliated with Activision or Treyarch.

Play it live at `https://daveinturkey15-byte.github.io/atomic-acres/`.

## Play it

```bash
npm install
npm run dev
```

Open the URL it prints, click to lock the pointer, then **WASD** to move, **mouse** to
look, **shift** to sprint, **space** to jump. The debug line top-left shows fps, draw
calls, triangles and your position.

You start in the orange team's back yard. The white house is across the street; the
cul-de-sac with the tour coach is to your right as you face the road.

## Verify it

```bash
npm run check      # tsc
npm run capture    # headless captures of every camera station
npm run traverse   # walks the real player controller along required routes
```

`capture` starts its **own** dev server on a port it picks, so it can never photograph a
stale preview someone else left running. It writes to `captures/` and fails on any page
error. `traverse` drives the actual movement code — collision, step-up, gravity — along
routes a player must be able to take, and scans each house wall to *find* the doors
rather than assuming where they are.

Both are necessary and neither is sufficient. **Open the frames and look at them.**
`src/core/stations.ts` names, for every fidelity camera, the Black Ops 2 reference frame
it is to be judged against; a station whose `ref` is `null` is a diagnostic view and
proves nothing about how the map looks.

## How it is put together

```
src/core/layout.ts      every dimension. Nothing else may hardcode one.
src/core/palette.ts     every colour.
src/core/materials.ts   procedural canvas textures; materials are shared singletons
src/core/world.ts       renderer, sky dome, environment map, light rig
src/core/player.ts      first-person controller
src/core/stations.ts    camera stations, each paired to its reference frame
src/core/kit.ts         the Builder type and geometry helpers
src/build/*.ts          one file per feature, each exporting a single Builder
src/ui/*.ts             HUD, menus, settings (wired from main.ts via initUI)
src/main.ts             the only file that touches the scene
```

Adding a feature is a new file in `src/build/` and one line in `BUILDERS` in `main.ts`.
There is deliberately no registry, no plugin loader and no pass system.

See `AGENTS.md` for the module contract and `docs/SPEC.md` for the build spec and the
reference reads.

## The one invariant

From either back yard, facing your own house, the garage is on your **right**. The two
houses are a **180° rotational pair, not a mirror pair**. `layout.ts` derives this in
`garageIsOnTheRight()` rather than hardcoding a sign.
