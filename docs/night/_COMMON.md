# Wave rules (read this with your brief)

An orchestrator is watching and will gate and commit your wave.

1. Touch ONLY the files your brief names. Two sibling lanes run at the same time.
2. **READ-ONLY for every lane in this wave**: `src/core/layout.ts`, `src/core/player.ts`,
   `src/core/stations.ts`, everything under `src/build/`, and everything under
   `scripts/`. The orchestrator owns all world geometry, all dimensions, the player
   controller and all harnesses. If your work needs a new dimension, a new collider or
   a new camera station, SAY SO IN YOUR REPORT and work around it for now.
3. Never construct a `THREE.Material` in a builder - `ctx.mat` only. `ctx.rand()`,
   never `Math.random()`. Every structural dimension from `src/core/layout.ts`.
4. Both harnesses serve the **built** artifact. Always:
   `npm run build` -> `npm run traverse` -> `npm run capture -- --tag <lane>`
5. Do not run `git add -A`, `commit`, `stash`, `reset`, `checkout`, or `npm install`.
6. **Open your captures with the Read tool and look at them.** A capture nobody opened
   is not evidence. If a change made a frame worse, revert it yourself and say so.
7. Be kind to the machine: ONE headless browser at a time, no leftover `vite` servers,
   do not spawn agents. The owner is using this PC.

## Known state (2026-09-18, this wave)

- The map was re-proportioned today off the **official BO2 minimap**, which we finally
  have a real copy of (every previous file in `docs/reference/img/` was a 5.8 kB HTML
  error page). `src/core/layout.ts` carries the measurements and their provenance.
- Both houses are now enterable, 4/4 faces. `node scripts/paths.mjs` floods the
  collision world and proves every landmark is reachable from spawn A.
- KNOWN OPEN, owned by the orchestrator, do not chase: one interior obstruction in the
  orange house stalls walking routes at about (-1.3, -22.7); the west squeeze past the
  orange carport is sealed. Both are geometry, not your lanes.
- Reference: `docs/reference/img/nt2025-*.png` (official aerial, minimap, load screen,
  a 2560x1440 frame) and **1371 real gameplay frames** in `docs/reference/gameplay/`,
  named `f-<clip>-NNN.jpg` / `g-<clip>-NNN.jpg` across six clips.
- The older, unrelated project at `C:/Users/david/Desktop/stuff/atomic-acres` is a
  **reference for design and behaviour only**. Read it freely. Copy no file from it.
  It solved a great deal of this already and is worth reading before you invent.
- This is **Atomic Acres**, a fan project inspired by Black Ops 2. Original code and
  geometry only; no game assets, no Activision/Treyarch branding.

## The owner's standing direction for this wave

> "refine the graphics ... bring in the features of gameplay from the other project as a
> reference - guns killstreaks etc, multiplayer lobby host tech ... iterate on the
> graphics lighting assets etc ... to make it more and more towards photorealism
> including animations and effects where possible"
