# Report — plan lane (minimap reconstruction)

## What I changed
- **New: `docs/PLAN.md`** (only deliverable + this report). ASCII plan with metres,
  full constant table (ours vs minimap-derived vs ratio vs material-or-not),
  verdict with frame cites, OPEN-1..OPEN-9, recommendation list. Corrected once
  after independent visual verification (see below).
- **`src/core/layout.ts`: NO CHANGE.** Deliberate, evidence-backed (see verdict).
  Symbols, shapes, `garageIsOnTheRight()` untouched; handedness holds by construction.

## Verdict (for the owner)
The brief's premise is false: the BO2 minimap is a **zoomed rotating
player-centred viewport showing 1–2 houses, never the island** — not an
orthographic schematic of the playable area. It corroborates relative blocks
(houses ~2–3.5x street width vs ours ~2.1x; street E–W = map x-axis) within wide
error bars and gives **no material contradiction**. The only quantitative scale
test (street-corridor ~8 px vs 9.2 m asphalt → m/px ~1.0 ± 0.35) reproduces
`ROAD_HALF_WIDTH`/`HEAD_RADIUS` within uncertainty. "The numbers were right
after all" — with the minimap actually proving only the weak claim, stated
honestly in PLAN.md §5.

## What I measured (gates, this session)
- `npx tsc --noEmit -p tsconfig.json` → exit 0.
- `npm run build` → exit 0 (vite, 40 modules, dist JS 975.60 kB).
- `npm run traverse` → **5/5 routes, 4/4 faces enterable, handedness PASS**.
- `npm run capture -- --tag plan` → exit 0, 10 files `captures/plan-*.png`
  (473 KB–1.17 MB each) + `plan-summary.json` with
  `"pageErrors": []`, `"consoleErrors": []`.

## What I looked at
- Reference frames (minimap corners): `g-1icNQzMgLUM-040`, `g-VfcKHcDJXpM-060`,
  `g-VfcKHcDJXpM-001` (+001 black-fade reject), `f-FKQOEO-1ceE-085/-160/-025`
  + crops `mm-f-FKQOEO-1ceE-080` (best), `f-aICKIbuo8zQ-100/-030` + crops,
  `f-FKQOEO-1ceE-105` (coach side profile) / `-135` / `-150` (semi cab, excluded
  from coach math); rejects recorded: `-212` scoreboard, `-060` Hellstorm.
  Four scout batches + one independent verifier opened these, not just me.
- Capture PNGs: `plan-aerial.png` (whole map from above — street, both houses,
  circular head with 2 buses, third house + red car beyond, plaza/pylon at open
  end, mow stripes — consistent with unchanged layout), `plan-turningHead.png`
  (eye-level down street to circular dead-end with two buses),
  `plan-streetElevation.png` (eye-level orange elevation + dark saloon foreground).
  Each file's content confirmed with a targeted vision query.

## Key corrections the verifier forced (already in PLAN.md)
- `mm-*` crops are **different moments** from same-basename full frames (040 crop
  reads S while 040 full reads N) — never cited as one observation; OPEN-8 upgraded.
- Capsule/pill outlines appear in **both** g- and f-crops; full-minimap absences
  (f-105 AND g-040 despite bus in 3D) are a viewport effect, not a G-vs-F art
  difference; capsule = bus stays OPEN (non-parallel anomaly in 040 crop).
- Fixed north-up DENIED (art angle varies diagonal vs axis-aligned); rotation
  supported, exact heading coupling OPEN.

## What I could not resolve
- Everything in PLAN.md §6 OPEN-1..OPEN-9: bulb geometry, island aspect, absolute
  scale, yard identities, footprint segmentation, capsule identity. Needs a zoomed
  minimap with the arrow ON the bulb, or a sedan+coach same-frame 3D anchor.
- **Tree state changed mid-session under me (sibling lane, not mine):** at start
  `git status` showed `M src/build/vehicles.ts, M src/main.ts`; by verification
  time those were gone and `public/assets/coach.glb` shows deleted (8.6 MB).
  I touched neither — flagging so nobody attributes it to this lane.
- **Capture log anomaly:** all stations report `0k tris` (calls 60→114 look
  cumulative). Frames render correctly, so this smells like harness
  instrumentation, not scene content — but I did not diagnose it (not my files).
- Bare-image reads of the three PNGs came back permuted vs request order; settled
  with per-file vision queries, so the evidence stands.

## Layout decision log
Confident changes applied to `layout.ts`: **none**. Revert policy honored
trivially — nothing was changed, traverse stays 5/5, handedness PASS.
