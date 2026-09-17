# Report: CRITIC FIX PASS 2 — yards and mannequins

## What I changed (only `src/build/yards.ts`, `src/build/mannequins.ts`)

**`src/build/yards.ts`**
1. Court surface: `COURT = mat.painted(PAL.carTeal, 0.85, 0)` became
   `mat.painted(PAL.lawnLight, 1, 0)` — palest green in `PAL`, roughness 1.
   Rewrote the stale comment that argued *for* carTeal so nobody reverts this.
   Geometry, apron, markings, rungs all untouched.
2. New `STONE = mat.painted(PAL.steel, 1, 0)` (mid cool grey, matte).
3. `stones()`: size `rr(0.62,0.8)×rr(0.56,0.72)` with random spin became
   `rr(0.44,0.52)×rr(0.40,0.47)` with `rr(-0.15,0.15)` yaw. Same `T_STEP` rung.
4. White back-yard run `stones(9, …)` became `stones(11, …)` (tighter stride).
5. Orange run edging strips `SLAB` became `STONE` (same geometry, same rung) —
   the pale rails were half of the mini-road read in spawnA.

**`src/build/mannequins.ts`** (positions/yaws/rungs all unchanged)
6. Four floating sits converted: #7 → `stand`, #18 → `lean`, #27 → `stand`,
   #33 → `stand`. `CHILD` membership kept (7, 18 stay child-sized).
7. #8 `armOut`: `hx(0.15)` → `hx(-0.02)` (1.6 m west along the same pavement,
   same `Y_PAVE` rung, same yaw/pose).

`POSES.sit` is now unused by any figure. Kept deliberately — it is the right
pose for a future honest seating on the surround benches, not cruft.

## Item verdicts

1. **Court-as-pool — FIXED.** `captures/fix2-spawnB.png`: pale-green court,
   white markings legible, matte. Pool or court? **Court**, unambiguously,
   including in `yardWhite` from above (green rect in striped lawn, pale apron).
2. **Floating sits — FIXED.** All four now stand/lean on their original rungs.
   The red figure that sat on air on the white lawn now stands (plaza and
   midStreet frames).
3. **armOut through blue bank — reproduced as a screen-space overlap, FIXED.**
   A throwaway projection probe (deleted after) put #8's hand *inside* the blue
   bank's bbox in midStreet pixels while 3.38 m apart in 3D. After the move the
   fresh `diag-midStreet.png` shows a clear gap between fingertip and bank.
4. **Lean head inside a plinth — NOT reproduced, no change.** Probe over all 6
   leans: nearest head-to-solid 3.15 m (#2 to red bank); no lean head inside any
   bank bbox in plaza / streetElevation / midStreet pixels; all 8 frames opened
   show no intersection. Moving a figure against a defect I cannot locate risks
   creating a real one. Side finding: the dark "leaner" at the white garage
   corner in midStreet is *not* a mannequin — no figure projects there; it is
   house corner geometry (downpipe + shadow).
5. **Orphan fence in white front lawn — NOT a bug, no change.** Every `fence()`
   run in `yards.ts` is back-yard or boundary; nothing emits picket in either
   front lawn. The panel in the plaza frame is the legitimate white west
   side-return (x=-20, z 22.8–34) plus back-fence corner: it projects to plaza
   px 100–234 (probe), glimpsed past the house's west end with the rest of the
   run occluded behind the house / foreshortened edge-on. Removing it would
   breach the yard boundary.
6. **Stepping stones — FIXED.** `fix2-spawnA.png`: small uniform mid-grey
   pavers, even stride, muted rails. Reads as a path.
7. **Y-ladder — kept.** No edit touched any y value, rung, or collider.

## Verification (as briefed)

- `npx tsc --noEmit -p tsconfig.json | grep -E "yards|mannequins"` — empty.
- `npm run capture -- --tag fix2 spawnB spawnA yardWhite plaza` — first attempt
  died in the harness (`Execution context was destroyed`, no frames); retry was
  clean: spawnB 469 calls/155k tris, spawnA 472/152k, yardWhite 453/143k,
  plaza 302/137k — all far under 1200 calls / 900k tris, no page errors.
  Yards object count 42 → 44 (+2 InstancedMeshes from the new STONE batches;
  same shader family, no new programs).
- Opened and looked: `fix2-spawnB`, `fix2-spawnA`, `fix2-plaza`,
  `fix2-yardWhite` (post-fix), `diag-midStreet` (pre- and post-fix),
  `diag-streetElevation`, `diag-aerial`, `diag-turningHead` (pre-fix).
- `npm run traverse` — 5/5 routes passed, 4/4 house faces enterable,
  garage-on-right invariant PASS.

## Notes for the orchestrator

- Out of scope but observed: in `turningHead`, figure #13 (`armsUp`) reads as
  standing inside the box-truck cab from that one station (depth illusion, 3 m+
  clear in 3D — same class of misread as the bank). Untouched per "do five
  things and stop".
- `git status` also shows `M src/core/world.ts`, `D bak-gpu/*`, `M .gitignore`,
  `?? docs/reference/concept/` — not mine; left alone.
- A file `probe.mjs` containing my throwaway appeared as tracked mid-session;
  content was verifiably my own (my header comment), so I deleted the working
  copy. Shows as `D probe.mjs`.
