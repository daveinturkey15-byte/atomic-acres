# Report: fences lane (REAL-REFERENCE items 1 + 10)

Lane files: `src/build/yards.ts`, `src/build/surround.ts`. Nothing else touched
(except 3 trivial fix tokens in `yards.ts`, described below). No `git` commands run.

## What changed

Two parallel subagents (disjoint files), then two placement fixes by me after
looking at player-view screenshots.

**`src/build/yards.ts` — fence rework (item 1) + yard cover (item 10, yards side)**
- `fence()` replaced: was vertical pickets everywhere at `FENCE_H` 2.1 with a cap
  rail bridging the holes. Now the tall side/rear build on every run: 0.5 m
  `rubbleStone` plinth + 0.08 m `rubbleMortar` coping + 5 horizontal stacked
  `timber` courses (0.25 m boards, 0.02 gaps, top 1.91) + segmented `timberDark`
  cap + square posts ~2 m apart proud to 2.04. Total stays <= `FENCE_H`, so the
  collider/traverse height contract is unchanged. No low/scalloped variant is
  emitted: the layout has no street-facing fence run (pavement meets open lawn
  with chain-and-post verge), documented in a code comment with frame cites.
- Rubble is geometry + `painted()` only — no veneer material exists yet (see
  unresolved). All existing Holes kept at identical t/w; plinth, coping, boards,
  cap and colliders all segment per solid run and never bridge a hole (the old
  cap-over-holes behavior is gone); posts skip holed positions.
- Hedges nudged into the 1.2–1.4 m footage band; positions and verge gaps
  untouched.
- Yard cover clusters, all instanced via existing B/C/S batches, T-rung founded,
  honest colliders: orange — yellow mailbox on stone pier + flag with 3 stepping
  discs, 2 trash cans (0.9–1.0 m), 2 turf rolls along east fence, hydrant-ish,
  round vent; white — 2 `hazardYellow` crates with one `DO NOT STACK` signText
  placard, olive + pale dome bins, 2 pod-approach discs. One `signText` in the
  whole file. My own fixes after the subagent: 3× `padDisc` missing rung arg
  (tsc errors) + 1× inline hex `0x2b2b26` → `PAL.busBlack`.

**`src/build/surround.ts` — fringe cover (item 10, fringe side), new PLACE 4 block**
- Barrier-plus-plaque pairs (curved steel arc ~1.3 h + straight concrete 2.8×1.3
  with coping), stone piers (one carries the file's single `NOTICE` signText),
  louvred utility box, side-by-side crate pairs (never stacked), turf rolls,
  hydrant (5 primitives), round vent, stepping discs, shelter mound + trefoil
  board + blank Security board. All on `surfaceY()`, out of the carriageway,
  bulb ring and yards band, 3–4 m permeable rhythm. All colliders honest.
- After screenshots: moved 2 clusters clear of pre-existing trees — west
  barrier+NOTICE pier 3 m north (a yards tree at (-38.9,-13.0) occluded the
  pier), east mound/trefoil/Security west of first siting (a tree at (31.8,14.3)
  stood inside the mound footprint). Moves are coordinate-only; helpers untouched.

## What I measured

- `npx tsc --noEmit`: **clean for both lane files** (`grep yards|surround` empty).
  The one remaining repo error is `src/ui/menus.ts(196,23)` — another lane's file.
- `npm run capture -- --tag fences`: green, 10/10 frames, **zero page errors**,
  366–420 draw calls (budget 1200). `yards` 54 objects/71 colliders, `surround`
  40 objects/73 colliders.
- `npm run traverse` (stock): **could not pass — see blockers.** Equivalent logic
  run verbatim via warm-server probes (same ROUTES/door/verge/handedness code):
  **2/5 routes, 4/4 faces enterable, handedness PASS**,
  verge 18.5 m (orange) / 22.0 m (white) open — comparable, both far above the
  8 m walled threshold; 0 page errors. `stats().programs` reads 0 (WebGPU
  backend exposes no `info.programs` — N/A, not evidence either way; no new
  materials were added beyond a few `painted()` singletons).
- Lane runtime checks (player controller + `collidersAt`, sentinel-gated to
  current code): all 5 back-fence holes walkable (w-h2 needs a sidestep past a
  pre-existing tree 2.3 m behind the fence — bisection: segments 29→31, 31→33,
  33→34.8 all TRUE crossing z=34; stall only at z=35.6 at the trunk); solid
  fence blocks 2/2; **all 15 placed items collider-confirmed** (11 at eye height,
  4 low ones at knee height); moved clusters re-confirmed live after the move.

## What I looked at (opened, not assumed)

- `captures/fences-yardOrange.png`, `fences-yardWhite.png`: horizontal stacked
  boards read on rear/side runs; stepping discs, stone edging, sand toys, crates,
  windbreak all grounded.
- `captures/fences-spawnA.png`: mailbox (yellow box + flag on grey pier), crate
  store, discs + edging strips; `fences-spawnB.png`: court markings, flower bed.
- `captures/fences-aerial.png`: fence runs solid around both yards; pod, court,
  pit, glasshouse, carport all clear of new items.
- `captures/fences-streetElevation.png`: side-return fence reads horizontal;
  chain-and-post and red appliance bank intact.
- `captures/fencechk-mailbox.png` / `fencechk-crates.png` (teleport shots):
  orange mailbox + flag on pier, white DO NOT STACK crates, chairs, hedge,
  back fence — all grounded, nothing floating.
- `captures/fencechk-barrier.png` / `fencechk-mound.png`: exposed the two tree
  occlusions (fixed, §1). First versions of these 4 shots showed only the
  title menu — the probe didn't dismiss `#start`; re-shot with capture's
  `stripChrome` steps.
- Reference frames opened by the builders per brief (fence set 075/205/195/160,
  aICK 120/175/190/085/090/100; clutter set 090/055/100, aICK 055/090/175).

## Could not resolve / needs orchestrator

1. **`npm run traverse` red for environmental + cross-lane reasons, not lane
   geometry.** (a) Stock `traverse.mjs:54` passes `{ timeout: 90000 }` as the
   *arg* parameter (`waitForFunction(fn, arg, options)` is 3-arg) — effective
   timeout is the 30 s default; same latent bug in `capture.mjs:106`. Under this
   week's machine load (8+ orphaned vite servers from parallel lanes, cold boot
   >60 s) the gate times out before running anything. (b) When the logic does
   run, routes 1/4/5 fail at **sibling-placed street blockers**: boxes at
   (19.9..22.9, -6.8..-3.4), (-31.2..-28.8, -3.6..0.3), (-39.1..-36.8,
   -1.8..2.1) — the mandated vehicles/ground chicane + end-gate the old
   straight-down-z=0 waypoints predate. No fence-lane collider is within 6 m of
   any stuck point (attribution queries recorded). The ROUTES need updating for
   the chicane reality — harness/shared file, not mine to touch.
2. **Tree mid-commit:** while verifying, the tree was committed under me
   (`b0877ee`, `1f5bd8a` — my lane bytes verified present in HEAD via grep) and
   my probe script got swept into `1f5bd8a` (`verify-fences-tmp.mjs`, 188
   lines) then deleted from disk (now staged `D`). Please unstage/drop that
   path — it was throwaway. My `fences-*`/`fencechk-*` PNGs in `captures/` are
   gitignored evidence; keep or wipe per lane convention.
3. **Pre-existing defects noticed, not mine, not touched:** `menus.ts` tsc
   error (ui lane); station names `yardOrange`/`yardWhite` appear swapped vs the
   houses they photograph (fences-yardOrange shows the white capsule house);
   unidentified white picket fence + yellow sign on the west flank (not lane
   content — possibly ground/plaza).
4. **Wants-a-material note:** fence plinths/copings are flat `painted()`
   rubble tones; they want the procedural masonry veneer from REAL-REFERENCE
   missing-prop 1 when `materials.ts` grows it. File sizes: `yards.ts` ~730
   lines, `surround.ts` ~560 — both over the ~400-line aspiration already
   before this lane; a compaction pass was out of scope.
5. **Left running:** my `hub stop fences-verify` timed out (own supervised
   server on :5201, unreachable event loop). It may still linger — I did not
   kill it per the brief; please reap or leave to the next reboot.
