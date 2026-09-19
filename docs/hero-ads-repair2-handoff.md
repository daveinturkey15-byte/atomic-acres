# hero-ads-repair2 — source-only iron-sight alignment (2026-09-20)

Bounded 20-minute SOURCE-ONLY correction, authored in exclusive
`nuketown-prop-20260919` against the frozen recovery root at `5fd4058`
(root untouched; target files verified byte-identical across `5fd4058`,
root HEAD `9a07085` and the root working tree, so the patch applies on any
of them).

## Deliverables

- `work/hero-ads-repair2.patch` — root-relative, `git apply`-clean
  (verified against a pristine extract of the root tree). 3 files,
  +174/−23. No new files required.
- `work/r2scratch/` — full editable scratch tree the patch was authored in
  (kept per the "keep successful source partials" instruction).

## Root cause (projection geometry, not style)

At settled ADS the rig origin sits at camera-local `(0, −0.148, −0.3)`
(`ADS_OFFSET`), rig axes aligned with the camera. The authored sights sit
~0.092 above the rig origin, so both iron-sight anchors hang ~5 cm under
the camera axis and project below screen centre by `f·Δy/depth`:

| gun | front anchor | rear anchor | predicted pre-fix px (F/R, 1600×900, per-gun ADS fov) | repair1 reading |
|---|---|---|---|---|
| mp5 (fov 58) | post tip `[0, .092, −.285]` | drum peep centre `[0, .088, +.060]` | −71 / −186 | ~90 / ~185 |
| m14-ebr (fov 62) | post tip `[0, .092, −.450]` | aperture centre `[0, .094, +.200]` | −54 / −389 | ~130 / ~160 (ring/strap edges, not the notch centre) |
| lmg (fov 60) | post tip `[0, .092, −.420]` | notch centre `[0, .094, +.070]` | −58 / −176 | block ~500–620 |

The MP5 rear prediction reproduces the repair1 frame (~185 px). The EBR
"rear ~610" reading was the visible ring edge; the notch centre itself
projects far lower. The live gate (below) measures true centres.

repair1's `HERO_ADS_TRIM` (+0.005/+0.002 y) removed ~10 px of ~180 and is
deleted — clean cutover, no alias left.

## The fix (calculated, adopted heroes only)

- `src/weapons/roster-heroes-loader.ts`: `ROSTER_HERO_SIGHT_ANCHORS`
  (front post TIP + rear aperture/notch CENTRE per hero, read off the
  recipe meshes in `scripts/blender/build_roster_heroes.py`) and
  `solveRosterHeroAdsMount(id, mountY)` — closed-form rig translation +
  pitch/yaw putting BOTH anchors exactly on the camera axis:
  pitch `p = (aF.y − aR.y)/(aF.z − aR.z)`, `h = aF.y − aF.z·p`,
  `offsetY = −mountY − h`; yaw is the same construction on (x, z).
- `src/weapons/controller.ts`: `HERO_ADS_MOUNT` = per-hero solved values
  (mp5 `+0.0593 y, −0.0116 rad pitch` — the peep sits 4 mm under the post
  line, so the muzzle dips 0.66°; ebr `+0.0546, +0.0031`; lmg `+0.0543,
  +0.0041`), applied in the frame path scaled by `adsT`, replacing
  `HERO_ADS_TRIM`. New QA verb `weaponCmd('sights')`: projects the two
  anchors through the LIVE rig matrices and camera after render, returns
  `{active, ready, id, centre, front, rear, errPx, pass}`; `pass` = both
  anchors within 5 px of centre, `ready` gates on settled ADS
  (`adsT ≥ 0.995`, not reloading).
- `scripts/capture-roster-heroes.mjs`: `--dist=<dir>` (default `dist`,
  absolute or repo-relative) replaces the pinned `dist-heroes-2342` in
  bundle provenance so the exact source/live sha256 works against any
  candidate; new settled-ADS sight-projection gate per hero (waits for
  `sights.ready`, records `result.sights`, fails the run unless all three
  pass), folded into `result.pass`. All pre-existing assertions kept; no
  gate relaxed — one gate ADDED.

Offline verification (node, same formulas): post-fix projection error
0.0 px F/R for all three; sway at the damped ADS amplitude adds ≤ ~2.4 px
at peep depth (bob is zero stationary), inside the 5 px gate. Camera near
plane is 0.08 (`core/world.ts`), EBR rear anchor depth 0.100 — projects
safely. `tsc --noEmit` clean on the whole patched tree; harness
`node --check` clean.

## Constraints honoured

- No reticle, camera or hit-ray change; the rig alone moves (translation
  + ≤0.66° pitch), interpolated by `adsT` — hip pose byte-identical.
- 16 baseline guns + carbine canary: no `HERO_ADS_MOUNT` entry and
  `heroBlend = 0` → zero-added-term placement.
- Recipe, GLBs, sockets, magazine pivot untouched → 14k tri / 18 draw /
  3 mat / 2 PNG / 1K budgets unchanged. No Blender rebuild required.

## Running it (root; I had no GPU/browser/build)

```
git apply work/hero-ads-repair2.patch   # from the recovery root
npm run build && serve the candidate, then:
node scripts/capture-roster-heroes.mjs --url http://127.0.0.1:4195/?heroes=canary \
    --dist <candidate-dist-dir> --tag heroes-repair2-<seq>
```

Then LOOK at the ADS frames: gate numbers first, eyeball second. If the
live gate disagrees with the table above, suspect the anchor constants
against the recipe meshes — do not loosen the gate.

## Open / unchanged

- hero210s JS slope `.681 MB/min` soak failure remains OPEN; untouched by
  this change.
- Optional follow-up (NOT this round): raise the mp5 drum peep to the
  shared 0.092 line in the recipe to zero the −0.66° pitch, IF the GLBs
  are rebuilt anyway; constants must be updated with any such rebuild.
