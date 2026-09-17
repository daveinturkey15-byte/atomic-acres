# Report: INSPECTION MODE — fly, noclip, on-screen controls

## What changed (committed in afad912; working tree matches, no live temp files)

**`src/core/player.ts`** — three movement modes, one controller:
- `MoveMode = 'walk' | 'fly' | 'noclip'`. `update()` clamps dt exactly as before,
  then dispatches to `updateWalk()` / `updateFly()`.
- `updateWalk()` is the old `update()` body **verbatim** — proved with
  `git show HEAD:src/core/player.ts` vs the new file: 72 non-blank lines, zero
  diff (the dt clamp, void-guard and camera sync moved up into `update()`).
  Gravity, collision, step-up, jump, per-frame ground snap, probe-wish path:
  untouched.
- `updateFly()`: wish built in the camera frame **with pitch** —
  forward `(-sin yaw·cos pitch, sin pitch, -cos yaw·cos pitch)`, strafe horizontal
  in the same yaw frame walk uses. Velocity set directly (no accel lag, hard stop
  on release). FLY reuses `moveAxis` for x/z (grounded is false, so no step-up:
  pure slide) and resolves y against slabs; NOCLIP integrates position directly.
- Keys: **F** fly toggle (walk↔fly, noclip→walk), **C** noclip toggle
  (colliding→noclip, noclip→fly). `Space`/`E` up, `Q`/`X` down in fly
  (Space stays jump in walk). Wheel and `[`/`]` adjust fly speed (2–60 m/s,
  default 12); `Shift` ×3 boost in fly, sprint in walk. Toggles ignore key
  auto-repeat (holding F would otherwise flicker modes).
- `setMode()` to a colliding mode runs a depenetration rise (0.5 m steps to 5 m)
  so leaving noclip inside a wall never wedges the player; if still stuck, C
  takes you back out.
- Pointer-lock robustness: mousemove was already lock-gated (no spin possible
  unlocked); unlock now also clears held keys so nothing keeps walking after Esc.

**`src/main.ts`** — HUD, overlay lock, QA (all additive):
- HUD is now three children of the existing `#hud` (`hudStats`, `hudMode`,
  `hudHelp`): stats line, `— WALK —` / `— FLY · 12 m/s (wheel / [ ] adjust,
  SHIFT ×3) —` / `— FLY-NOCLIP … —`, and an always-visible key legend `H`
  toggles. Mode/speed changes rewrite the HUD the same frame (not at the 0.5 s
  tick). Everything lives inside `#hud`/`#start`, so capture's element stripping
  is unaffected — confirmed in frames (below).
- Clicking the `#start` overlay now dismisses it **and** requests pointer lock
  (previously the click listener was only on the canvas behind the overlay, so
  the first click never started the game — see afad912 message). Canvas clicks
  still re-lock after Esc.
- QA: `setMode`, `mode`, `teleport`, `setFlySpeed` added; `stats()` gains `mode`
  + `flySpeed`. `spawn()` and `probeReset()` force `walk` so the traverse probe
  always exercises real walk collision — a leftover noclip would pass every route
  vacuously. `cameraHeldByQA` and `handedness` untouched.

**`index.html`** — overlay keeps id `#start`, now lists all controls (walk, fly,
nocolip, speed, H, Esc). No new top-level elements.

No `src/core/freecam.ts`: the mode logic is ~120 lines tightly coupled to the
controller loop; a separate module would only re-export player internals.

## Keybindings (as documented on overlay + HUD)

| Key | Action |
|---|---|
| F | fly on/off (walk↔fly; from noclip → walk) |
| C | collision on/off (walk/fly→noclip; noclip→fly) |
| Space / E | jump in walk; up in fly |
| Q / X | down in fly |
| Wheel, `[` / `]` | fly speed 2–60 m/s (default 12) |
| Shift | sprint in walk; ×3 boost in fly |
| H | toggle key legend; Esc frees the mouse |

## What I measured

- `npx tsc --noEmit`: **clean** on the final tree. (During the session other
  lanes repeatedly broke it — `T_ARC` in ground.ts, a vehicles.ts brace — never
  my files; verified my files in isolation each time.)
- `npm run traverse`: **5/5 routes, 4/4 house faces, handedness PASS** on the
  final tree.
- `npm run capture -- --tag cam`: **10 stations, exit 0, no page/console
  errors**. Opened 3 PNGs with the Read tool — all show the map, none shows the
  overlay or HUD: `cam-yardOrange.png` (plan view: both houses, turning head,
  third house + red car, plaza), `cam-aerial.png` (orange-house deck close-up),
  `cam-spawnA.png` (spawn view: stair LEFT, garage bays RIGHT — invariant reads).
- Headless fly/noclip runs against the real controller (Playwright, synthetic
  key events, rAF loop live; scripts created, run, deleted — none in the repo):
  - FLY-collision from x=1.5 facing +x at the z=-27.5 structure: moved 3.0 m,
    stopped dead at x=4.5 pressed against it (free travel would be ~10 m+).
    **Blocked: PASS.**
  - NOCLIP same start: moved 11.4 m to x=12.9, straight through. **PASS.**
  - FLY pitched up 0.6 rad: y 2.0 → 7.42. **PASS.**
  - 90° (yaw π/2): pure −x, z held. **PASS.**
  - 45° (yaw π/4): dx/dz −3.39/−3.39 in run 1 (**PASS**); in two later runs
    exactly-equal components (−2.97/−2.97, −0.85/−0.85) but under my absolute
    distance bar. The direction math is exact every time; the shortfall is
    integrated time, not direction (see environment note).
  - Walk leg via real probe + `stats().mode/.flySpeed` round-trip: **PASS.**

## What I looked at

The three PNGs above, plus the traverse door/verge spans (unchanged shapes:
orangeStreet 4.5..5, orangeYard −3.5..−3, whiteStreet −2.5..−1, whiteYard 2..3).

## What I could not resolve / did not own

1. **Shared-machine load.** Headless rAF ran 3–13 fps during my checks (other
   lanes running harnesses concurrently; `frames=13/3896ms` typical). The dt
   clamp then integrates a fraction of wall time, so all my distance criteria
   needed wide margins and one 45° run missed its bar by 3 cm (direction exact).
   Real-machine play is unaffected (dt clamp only bites below 20 fps).
2. **Lane churn mid-run.** Twice a harness failed with `__NT` absent for 30 s+
   while a lane had the bundle broken; a later retry on a clean tree passed.
   Related find: `waitForFunction(fn, {timeout})` in traverse.mjs/capture.mjs
   passes the options object as the `arg` parameter (signature is
   `(fn, arg, opts)`), so both harnesses run with the default 30 s timeout, not
   the 60/90 s the code appears to request. Not my files; flagging for whoever
   owns `scripts/`.
3. **An early 3/5 traverse** (east flank + cul-de-sac stuck at [5.1,−27.5]
   against yards-lane colliders #86/#87, x 5.38..6.63, z −28.81..−26.2) was a
   half-saved yards edit, not my physics: walk body proved identical (above),
   and the final tree passes 5/5 with no further change from me.
4. **Capture stats anomaly (not mine).** `cam-*` summary shows 49–103 calls and
   **0k tris at every station** vs the AGENTS.md baseline (363 calls / 135k
   tris worst station), with calls rising +6/station. The frames render fully,
   so this is `renderer.info` plumbing in the in-flight world.ts/renderer.ts
   split, not rendering. Renderer-lane to confirm; budgets cannot be read off
   this capture set.
5. **Not exercised with a real mouse.** Pointer-lock paths (overlay click to
   lock, Esc release, re-click re-lock, no spin) are verified by code
   (lock-gated mousemove, key clear on unlock) and the overlay is confirmed
   gone in captures, but no human click-tested this session.
6. Station-name/view mismatch (e.g. `cam-aerial.png` is a deck close-up,
   `cam-yardOrange.png` is the plan view) — stations.ts belongs to another
   lane; I used frames only to confirm "map, not overlay".

## Files touched

Owned and committed (afad912): `src/core/player.ts`, `src/main.ts`,
`index.html`. Nothing else in the repo was written by me; all headless scripts
lived in repo root as `tmp-*.mjs` and were deleted after their runs (the `D`
entries for them in git status are the orchestrator's cleanup commit, not live
files). No `git add/commit/stash/reset/checkout`, no `npm install`, no
processes killed.
