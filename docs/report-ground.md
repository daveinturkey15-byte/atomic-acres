# Report: ground plane + mannequins (brief-ground)

## What changed (working tree, uncommitted)

Only the two owned files, plus a one-line corrective fixup:

- `src/build/ground.ts` (+204/-? lines, `git diff --stat`: 204 changed lines total in file)
- `src/build/mannequins.ts` (+60 lines scope)

No other file was touched by this lane. The tree also contains concurrent sibling-lane
edits (`orange-house`, `white-house`, `third-house`, `vehicles`, `yards`, `player`,
`main`, `index.html`) that are NOT mine and were left alone.

### ground.ts — road/pavement close-up detail (all instanced, all on new y-rungs)

New rungs, ladder comment updated with each value and overlap reasoning:

- `Y_LINE = 0.072` — painted centre dashes + turning-head circulation ring + stop bar.
- `Y_GUTTER = 0.086` — gutter/camber lines + drain gratings (footprints abut, 4 cm gap).
- `Y_SCUFF = 0.100` — tyre scuff arcs + oil spots on the bulb only.
- `Y_PAVE_MARK = 0.154` — paving joints/cracks, dropped kerbs, tactile pads, utility covers.
- Restored `T_ARC = KERB_HEIGHT - 0.002` (a first-pass edit had deleted it; corrective
  pass put back the exact line — `tsc` was red at 429/430 until then).

Detail families, each one `InstancedMesh` via a new local `decalMesh()` helper
(unit quad, per-instance pos/yaw/scale, `castShadow=false`, `receiveShadow=true`,
no colliders — comment states why):

- Centre line: dashes every 5 m down the stem (steer clear of the 3 manhole spots),
  1 stop bar at the bulb mouth, 18 circulation dashes on the bulb at `HEAD_RADIUS-2.2`.
- Gutter: 2 stem lines + 16 bulb arc dashes (uses `ARC_START`/`ARC_SPAN`).
- Drains: 6 stem + 3 bulb gratings, kerb-side of the gutter lines.
- Scuffs/oil: 16 arcs + 6 spots, `ctx.rand()` placed, bulb only.
- Paving joints: transverse joints every 3 m on both straight bands, **skipping x spans
  over each house's garage** (`garageX`, `GARAGE_LEN/2 + DRIVE_FLARE + 0.4`); 12 extra
  jittered cracks.
- Dropped kerbs: 1 quad per house over the kerb strip at that house's `garageX`,
  `GARAGE_LEN + 2*DRIVE_FLARE` wide, `ctx.mat.kerb`. Footprint is the kerb strip only;
  it abuts (never overlaps) the garage apron, which lives in a different z band.
- Tactile pads: 4 (bulb junction + street-mouth corners).
- Utility covers: 2 steel squares on the pavement, placed inward-clear of each driveway.
- Manhole covers: 3 → 5 (same `InstancedMesh`, 2 new spots: mid-stem, bulb off-centre).

New `painted()` cache keys: `windowBand/0.6`, `asphaltLight/0.96`, `concreteDark/0.95`,
`truckCab/0.97`, `sand/0.9`; iron reuses the manhole key `steel/0.72/0.45`.
`painted()` is key-cached and all entries share the one standard shader, so the
~18-program count is unaffected by construction (not re-measured — see below).
New draw calls: +8 `InstancedMesh` (~140 instances, ~280 tris).

### mannequins.ts — close-up quality, 35 → 40 figures

All 35 original `PLACES` entries verified byte-identical; 5 appended (indices 35–39):

- 35: orange porch drip-edge `[hx(0.49), fz(O,0.53), Y_LAWN, stand]`.
- 36: stem loiterer by the show saloon `[stx(0.72), O.side*KERB_EDGE, Y_PAVE, lean]`,
  stated 1.6 m clear of the car flank (not paced in-world — no boot, see below).
- 37: orange rear-deck doorway `[O.deckX, O.side*(HOUSE_BACK+0.3), DECK_Y, stand]`.
- 38: child with the white lawn group `[hx(-0.60), fz(W,0.45), Y_LAWN, stand]`;
  `CHILD` extended to `[1, 7, 18, 26, 38]`.
- 39: beyond the +z fence `[yx(0.52), BACK_FENCE+2.8, Y_APRON, armsUp]`.

Poses: stand/lean/stand/stand/armsUp — none `fallen` on the carriageway (the only
`fallen` entries remain the 3 pre-existing ones on lawn/apron). x=6 note: figure 37
sits at x=6.0 but on the rear deck at z≈-23 behind the house — not in either
street-level x=6 sight corridor; the road/head figures all stay ≥1.3 m off x=6.

Detail work, no new `Batch`, no new programs, colliders still `[]` + walk-through
comment kept:

- Waist seam: thin `CYL` groove ring at the torso/pelvis parting, `SEAM` tone.
- Joint collars: shoulder discs (`shoD*1.18`) + thigh-root discs (`thighW*1.18`).
- Faceted head: `HEAD` icosahedron detail 1 → 0 (broad flat facets).
- Wig-block crown: flattened `CYL` cap sunk 8 mm into the skull; dress tone / suit
  tone / `SEAM` when bare. Reuses the exact `painted()` keys the dress/suit already
  use, so cache hits.
- Two-tone: hoisted `LIMB = painted(PAL.sand, 0.72, 0)` + `SEAM =
  painted(PAL.concreteDark, 0.62, 0)`; bare figures get `LIMB` arms/legs/joints,
  dressed keep pale sleeves, suited keep body legs.

## What I measured

- `npx tsc --noEmit -p tsconfig.json`: scoped `grep -E "ground|mannequins"` **empty**
  (grep exit 1); full-project output also empty — whole tree type-green.
- Forbidden-pattern greps on both owned files: `new THREE.*Material` 0,
  `Math.random` 0, `0x…` hex literals 0. All colours via `PAL`, all materials via
  `ctx.mat`, all placement via `layout.ts`, all jitter via `ctx.rand()`.
- `git diff --stat` for owned files: `ground.ts 204 +++`, `mannequins.ts 60 +++`.
- Ground colliders: no `colliders.push` added; new decal meshes emit none (plateau
  + `groundUnder()` default cover them). `T_DRIVE` untouched.
- Budgets (by construction, NOT re-measured — the harness never booted): +8 ground
  draws + ~10 mannequin material-split draws ≈ +18 worst case → ≈381 calls vs the
  1200 budget; +~280 ground tris + collar/crown/seam instances ≈ low single-digit k
  vs 900 k. Program count unchanged by construction (shared cached shader).

## What I looked at

- Full diffs of both owned files (read, not just subagent claims); y-ladder,
  `decalMesh`, `T_ARC` restore, `PLACES` additions, `CHILD` extension, collider
  return lines.
- `src/core/materials.ts` `painted()` cache (key = color_rough_metal) to confirm new
  tones are cache entries on the shared shader, not new programs.
- `captures/` listing: **no `gnd-*` frames exist** — the capture run below died at
  boot before any screenshot.

## What I could NOT resolve — honest blockers

- `npm run capture -- --tag gnd` **RED**: page never became ready —
  `orange-house` throws during build (`ReferenceError: Cannot access 'dL' before
  initialization at buildOrangeHouse orange-house.ts:452`), a sibling lane's file I
  am forbidden to touch. `traverse` fails the same way (ready-timeout). Both
  harnesses start their own servers, so this is not a stale-preview artefact.
- Consequences: **no after-frames** (`gnd-streetElevation/turningHead/midStreet/
  aerial`) to open; the brief's before/after visual comparison was **not performed**;
  `traverse` 5/5, 4/4 faces, handedness PASS, and the verge-scan before/after quote
  are **unavailable** — the world does not boot with the current sibling edit in
  place. My lane's static gates are green, but end-to-end verification is blocked
  extrinsic to this brief.
- Unverified by eye (needs a green boot + the four `gnd` frames): decal legibility
  at street level, scuff/oil subtlety, tactile-pad placement vs kerb geometry,
  wig-block/seam/collar read at 2 m, new-figure clearances (esp. 36 vs saloon flank,
  37 vs deck doorway, 35 vs porch slab), and aerial z-fight behaviour of the new
  rungs. The 8 mm `Y_PAVE_MARK`-over-`T_DRIVE` relationship is non-overlapping by
  footprint bands (pavement band vs apron band) — reviewed in code, not in pixels.
- `ts-set-map` lint prefers `Record` over the `CHILD` `Set`; kept the `Set` per the
  brief's explicit instruction — flag if the repo wants the conversion.
