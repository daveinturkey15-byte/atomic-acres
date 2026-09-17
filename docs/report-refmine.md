# Report — refmine (gameplay-footage mining)

## What I changed (files owned: docs/REAL-REFERENCE.md, docs/SPEC.md; plus this report per STEP 6)

- NEW `docs/REAL-REFERENCE.md` (27,758 bytes): 60-frame correction list with the 5 required
  sections (layout, artstyle per family with wrong PAL/material -> fix, ranked missing props,
  transcribed signage, ordered top-10 with owner files) plus seed-hypothesis scorecard and
  12 OPEN items with settling shots. Every claim cites its frame filename.
- `docs/SPEC.md` section 3 only: NT04 (warm-tan paving not cool grey; two fence builds on stone
  plinth not one picket run; rubble-veneer addition; chain-and-post kept-but-unseen note),
  NT05 (tour-coach confirm + second black/navy livery; display-plinth/gate/wreck/truck/trailer
  additions; saucer mauve/downlight/leg extension; mannequin/interior-dressing extension;
  lamp/plaque/canopy/banner rhythm), NT07 (second-livery note + transcription limit),
  OPEN items (ledge still open; mailboxes partially resolved to one pier box; head inset still
  open with failed-frame note; new gates/holes open). Every correction tagged FOOTAGE
  CORRECTION (gameplay, not wiki stills). No game code touched (`src/` untouched).
- No commits, no installs, no process kills (per brief).

## What I measured

- Disk at read time: 438 frames (212 FKQOEO-1ceE + 210 aICKIbuo8zQ + 14 mGpZaLy5_hM with
  vid-mGpZaLy5_hM.mp4.part still downloading; third id incomplete).
- Opened: 60 distinct frames (29/27/4 split above, early/mid/late spread) via 12 parallel
  scouts + 1 corrective respawn (MineaICKMidA returned placeholder `test`; respawned as
  MineAICKMidA2, completed), plus 5 first-hand arbitration opens/queries by me (duplicates of
  scout frames for fence/trailer/saucer checks + one vision-confirm on f-FKQOEO-1ceE-205.jpg).
- Layout numbers defended: road 7-9m (keep 9.2m); pavement 2-3m/side (keep 2.6m); storeys
  3.0-3.2m (keep 3.15/3.05/6.20); garage single bay 2.4-2.8x2.1-2.3 recessed 0.5m; driveway
  5-6m wide, apron 6-8m deep; front wall ~7m behind kerb; street fences 1.1-1.6m total,
  side/rear 1.8-2.0m (FENCE_H 2.1 rear-only); slots 2.5-4m; saucer clearance >2m likely 2.5-3m,
  downlights 1.0-1.5m apart; door 13. Spawn-60m, head diameter/offset, gates/holes: OPEN.
- Most confident: rubble masonry everywhere; warm paving vs dark road; two fence builds on
  plinths; trailer + truck + two bus liveries as chicane; Welcome banner + door 13 + open
  canopy; striped prefab cell + two signature rooms; display plinth + gate; saucer underside.

## What I looked at

- All 13 scout payloads in full (agent://MineFKQEarly/MidA/Late/MidB, MineaICKEarly/MidB/Late,
  MineFenceClutter, MineSignage, MineThirdVid, MineLayoutMeasure, MineAICKMidA2).
- First-hand: arbitration image opens (fence/trailer/saucer checks) + vision query confirming
  f-FKQOEO-1ceE-205.jpg (door 13, wreck, fence contested horizontal-vs-vertical).
- Orientation files: AGENTS.md (in context), docs/SPEC.md §3, src/core/layout.ts (full incl.
  garageIsOnTheRight), src/core/palette.ts, src/core/materials.ts (timber/board texture),
  src/build/ file list + fence grep (yards.ts fence() vertical 0.17m boards = wrong for
  horizontal runs). No captures relied on (doc-only change); no capture PNGs opened.

## Verification

- `npx tsc --noEmit -p tsconfig.json`: FAILS in `src/ui/menus.ts(196,23)` TS2488
  (NodeListOf iterator) — PRE-EXISTING, out of my file set (I own docs only, write no game
  code; `git status` shows `src/` untouched, `docs/DEPLOY.md` modified by another lane).
  Left alone per hard rule 1 (writing outside my set will be reverted); not dispatched as a
  fix-up for the same reason. My files are markdown-only and cannot cause it.
- Deliverables check: `docs/REAL-REFERENCE.md` 27,758 bytes exists; `docs/SPEC.md` diff
  +66/−13 lines, section 3 only; `git status --short docs/` shows only SPEC modified +
  REAL-REFERENCE new (other untracked briefs/reference are pre-existing lanes).
- `npm run capture` NOT run: doc-only change produces no visual delta; brief has no
  capture gate (its only ask: frame count + confident corrections + OPENs, all in
  REAL-REFERENCE.md + below).

## What I could not resolve (see REAL-REFERENCE.md OPEN-1..12)

Fence direction at f-FKQOEO-1ceE-205.jpg (my full-frame read says horizontal, vision-crop says
vertical — kept contested); gates/holes (none in 60); yard programme set; full bus/truck
lettering; plaque bodies; No-Hassle room extent + fuse-vs-intercom; saucer leg count/layout;
footage-only chirality (needs post-spawn walk-out frames); third-id weight (incomplete
download); turning-head absolute + spawn-60m (no frame shows both ends). One scout
(MineaICKMidA) failed with placeholder and was respawned cleanly; no silent inline fix.
