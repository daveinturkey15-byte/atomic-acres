# Wave rules (read this with your brief)

An orchestrator IS watching this time and will gate and commit your wave. That does
not make you less responsible - it means a bad change is caught and reverted, and the
time you spent on it is wasted.

1. Touch ONLY the files your brief names. Sibling lanes run at the same time.
2. `src/core/layout.ts`, `src/build/**` and `src/core/palette.ts` are **READ-ONLY** for
   every lane in this wave. The orchestrator owns all world geometry and all dimensions.
   If your work needs a new dimension or a new colour, say so in your report and use a
   local constant in your own file for now.
3. Never construct a `THREE.Material` in a builder - `ctx.mat` only. `ctx.rand()`,
   never `Math.random()`. Every structural dimension from `src/core/layout.ts`.
4. Both harnesses serve the **built** artifact. Always:
   `npm run build` -> `npm run traverse` -> `npm run capture -- --tag <lane>`
5. The gate applied after your wave: tsc clean, vite build OK, handedness PASS,
   4/4 house faces enterable, 5/5 traverse routes, and bundle growth under 250 kB.
   A wave that fails the gate is reverted to the last green tag.
6. **Open your captures with the Read tool and look at them.** A capture nobody opened
   is not evidence. If a change made a frame worse, revert it yourself and say so.
7. Do not run `git add -A`, `commit`, `stash`, `reset`, `checkout`, or `npm install`.
8. Be mindful of the machine. Do not run more than one headless browser at a time,
   do not leave a `vite` server running when you finish, and do not spawn agents.

## Known state (2026-09-18 12:00)

- The turning circle is **CENTRAL** (`HEAD_CENTER_X 0`, `HEAD_RADIUS 10.5`) with a team
  house either side and vehicles parked on it. One road stem runs west off-map.
- Traverse is **5/5 green** as of commit e07d593. The east-flank seal is fixed
  (`BOUNDARY_X` was accidentally derived from the turning head and bisected both back
  yards after the re-centre; it is now 37.8). The third house sits at x 23.0..29.6.
- The project is **Atomic Acres**, a fan project inspired by Black Ops 2 Nuketown 2025.
  Original geometry only; no game assets, no Activision/Treyarch branding.
- Reference: `docs/REAL-REFERENCE.md`, `docs/PLAN.md`, `docs/DIMENSIONS.md`,
  `docs/SPEC.md`, and 1100+ real gameplay frames in `docs/reference/gameplay/`.
- The older, unrelated project at `C:/Users/david/Desktop/stuff/atomic-acres` is a
  **reference for design and behaviour only**. Read it freely. Copy no file from it.
  It solved a lot of these problems already and it is worth reading before you invent.
