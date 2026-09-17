# Overnight wave rules (read with your brief)

You are working **unattended**. Nobody will catch your mistake before it ships.

1. Touch ONLY the files your brief names. Sibling lanes run at the same time.
2. `src/core/palette.ts` and `src/core/layout.ts` are **READ-ONLY** unless your brief
   explicitly grants them. Eleven modules import from layout.
3. Never construct a `THREE.Material` in a builder — `ctx.mat` only. `ctx.rand()`,
   never `Math.random()`. Every structural dimension from `src/core/layout.ts`.
4. Both harnesses serve the **built** artifact. Always:
   `npm run build` → `npm run traverse` → `npm run capture -- --tag <lane>`
5. The gate the runner applies after your wave: tsc clean, vite build OK, handedness
   PASS, 4/4 house faces enterable, and **at least 4/5 traverse routes**. If your wave
   fails it, the runner reverts `src/` and `scripts/` to the last green tag and your
   work is lost. So verify before you stop.
6. **Open your captures with the Read tool and look at them.** A capture nobody opened
   is not evidence. If a change made a frame worse, revert it yourself and say so.
7. Do not run `git add -A`, `commit`, `stash`, `reset`, `checkout`, or `npm install`.

## Known state (2026-09-17 19:35)

- The turning circle is **CENTRAL** (`HEAD_CENTER_X 0`, `HEAD_RADIUS 10.5`) with a team
  house either side and vehicles parked on it. One road stem runs west. This was
  corrected tonight from a wrong "cul-de-sac at one end" inherited from the old project.
- Known red: the **east flank is sealed** by a yard fence return around x=10..11.5, so
  you cannot run around the houses on that side. In BO2 you can. 4/5 routes is the
  current floor.
- The project is **Atomic Acres**, a fan project inspired by Black Ops 2. Original
  geometry only; no game assets, no Activision/Treyarch branding.
- Reference: `docs/REAL-REFERENCE.md`, `docs/PLAN.md`, `docs/DIMENSIONS.md`,
  `docs/SPEC.md`, and 1100+ real gameplay frames in `docs/reference/gameplay/`.
