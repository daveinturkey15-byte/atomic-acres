# Night lane report: EASTFLANK

## What changed (only `src/build/yards.ts`, +16/−5 lines)

- `BOUNDARY_X`: was `HEAD_CENTER_X + HEAD_RADIUS + KERB_WIDTH` (= **10.8**).
  Now `THIRD_HOUSE_X - 6.7` (= **37.8**, restoring the pre-recentre siting east of
  all map dressing). Added `THIRD_HOUSE_X` to the layout import. Comment rewritten
  to record why, including the cross-lane note below.
- `src/build/surround.ts`: **untouched**. Its terrace wall/planters looked guilty
  from the brief's x-range, but the probe showed the probe slides around them once
  the real blocker is gone. Smaller diff wins.

## Root cause (probed, not guessed)

`collidersAt` grid + module-index mapping (BUILDERS order × `moduleStats` counts)
showed collider `yards#250`: a full-height (2.1 m) fence wall at **x 10.62–10.98,
z −38…+38, no holes** — the cul-de-sac boundary fence. The recentre commit
(`7efc2c2`) moved the turning circle to x=0 but left `BOUNDARY_X` derived from it,
so the fence landed mid-yard and bisected **both** back yards. It was never a
fence return, hedge, or clutter, so a gate/gap would have preserved nonsense: a
76 m fence down the middle of two private gardens. Moving it restores the
pre-recentre arrangement (boundary east of everything playable).

## What I measured

`npm run build` → `npx tsc --noEmit` (clean) → `npm run traverse`
→ `npm run capture -- --tag eastflank` (10 frames, no page/console errors).

Traverse (before): **4/5** — east flank stuck leg 2/9 at `[10.3, −24.8]`
heading to `[14, −25]`; 4/4 faces; handedness PASS.

Traverse (after fence move, sibling module still throwing/absent): **5/5**
(9/9 east flank), 4/4 faces, handedness PASS. This proves the yards+surround
lane is open end-to-end.

Traverse (after the third-house lane's module started building again): **4/5** —
probe now clears 4 legs and wedges at `[18, −6.3]` heading to `[18, 8]`.
`collidersAt` there: `#221:third-house [14.42..21.82 × −6..6]` (body) and, one
leg later, `#222:third-house [15.52..20.43 × 9.87..12.27]` (car). The fixed
waypoints `[18,−8] → [18,8] → [18,16]` in `scripts/traverse.mjs` run straight
through the re-sited house (body x 14.4–21.8, z ±6; car z 9.9–12.3).

Capture budgets: worst station 124 calls; programs stable (no materials added —
none constructed; `ctx.mat` only, no new `Math.random`, no new bare geometry).

## What I looked at (opened with Read)

- `captures/eastflank-yardOrange.png` — orange back yard reads as an enclosed,
  dressed garden (deck, carport, glasshouse, crates, stone run, back/side
  fences). No bisecting fence. Nothing removed: all cover clutter intact.
- `captures/eastflank-aerial.png` — map coherent; boundary fence a clean run in
  open ground east of the fringe; both yards enclosed green rectangles. The
  re-sited third house (dark roof, east of the bulb) visibly sits on the x=18
  flank line — visual confirmation of the blocker below.

## [blocked] 5/5 — needs the orchestrator, not this lane

The east flank is sealed again, this time by `src/build/third-house.ts`
(re-sited to `HOUSE_X ≈ 18.5` by its lane while I worked): body collider seals
x 14.07–22.17 at z −6…6, car seals z 9.9–12.3. Fixing it means moving that
house, moving the traverse waypoints in `scripts/`, or re-routing the flank —
all outside `yards.ts`/`surround.ts`. I did not touch those files. Reverting my
fence move would NOT help (it would re-seal the yards at leg 2 *in addition*).
Side effects of the sibling's siting, for the record: orange verge 22.0 m →
20.0 m open (lost 17.5–19 to the plot hedge), white verge 17.5 m → 13.0 m
(14–17 to drive/car zone); both in third-house geometry, both outside my set.
Also for the record: that lane's "boundary fence ~0.8 m off the wall" comments
describe a fence at ~14.4 which would slice the east terrace (x 9.75–20.75)
and the flank lane — irreconcilable with this brief; boundary siting is now a
cross-lane decision. My 37.8 only guarantees: out of the yards, every lane's
work inside it.

## Unresolved / warnings

- Sibling lanes edited `third-house.ts` and `skyline.ts` mid-run: one of my
  builds caught their file mid-edit (`third-house threw: THIRD_HOUSE_X is not
  defined` in capture; tsc was clean minutes later). Final verify used a clean
  tree (tsc 0, zero console/page errors), but the tree is still moving — the
  orchestrator should re-run `traverse` at merge.
- Gate check per `_COMMON.md`: tsc clean ✓, build OK ✓, handedness PASS ✓,
  4/4 faces ✓, routes 4/5 (meets the "at least 4/5" runner gate; the missing
  fifth is the cross-lane block above).
- No `git` commands run. Temp probe scripts removed. Preview server left
  running on :5199 (told not to kill processes).
