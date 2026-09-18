# Lane `photoreal` report — light rebalance + surface variation

## What I changed (3 files, +163/−37 vs HEAD; `post.ts` deliberately untouched)

Own set is `world.ts`, `post.ts`, `materials.ts`, `palette.ts`. I touched the first,
third and fourth. `post.ts` left alone: the chain is still dormant (main.ts renders
direct — see "could not resolve" 1), so editing it would be unverifiable churn.

**`src/core/world.ts`** — light rebalance toward the NT04/f-FKQOEO-1ceE-105 read
(hard warm key, crisp edges, cool sky fill, deep-but-readable shade):
- sun 3.2 → 3.35 (+5%, same warm tint/position; light count unchanged).
- hemi 1.05 → 0.95, opposing fill 0.30 → 0.25, `environmentIntensity` 1.0 → 0.9.
  Shade goes dark by starving fills, never by touching exposure (still 1.09).
- Shadow camera: I first "tightened" it to a per-axis fit — **reverted the same
  session** (see 2). Final state is the original square fit, plus a comment
  recording why per-axis bounds are unsafe. Bias/normalBias untouched
  (-0.00022 / 0.055).

**`src/core/materials.ts`** — two-scale breakup for the flat-plastic reads
(macro mottling + fine grain, roughness as much as albedo; means preserved):
- NEW `concreteTex` (512, repeat 12): the apron was a flat fill; now per-slab
  drift + dust + grit. Neutral overlays only — PAL.concrete hue never shifts.
- NEW `leafTex`/`leafRough`, `barkTex`/`barkRough`: canopies were plastic baubles.
- NEW `roofTex`/`roofRough` (mean 0.6), `barrelRough` (0.55): sheen drift on the
  big sun-struck sheets. `steelRough` (brushed 0.35–0.5), `chromeRough` (tight
  0.10–0.20 so the baked sun disc still glints).
- Wired in place on the existing 7 singletons (same keys, same means where a
  scalar existed). `solar` envMapIntensity → 1.2, `roofGlazing` → 1.2,
  `chrome` → 1.25. Inline hexes `0x66808e`/`0xc08a50`/`0x4d3116` → PAL keys.
- All inside `buildMaterials()`: +10 bake-time canvas textures (~3 MB),
  zero new materials, zero per-frame allocation, zero builder-file edits.

**`src/core/palette.ts`** — three ADDED keys (`windowDark`, `deckBoard`,
`timberGap`, same values as the inline literals they replace). No value changed.
I briefly deleted `saucerSoffit` with a bad range and restored it same session
(verified by re-read; tsc clean).

## What I measured

- `tsc`: tree fully clean at ship (a sibling `room.ts` error seen mid-session is gone).
- `npm run build`: OK (`dist/assets/index-CEhA5wTa.js`, 1025.73 kB / gzip 301.43 kB;
  growth since the light lane's 993,666 B is overwhelmingly sibling lanes —
  52 modules vs 43 — my diff is canvas-draw code only).
- `npm run traverse` (before AND after): **identical**: 0/5 routes stuck at the
  known orchestrator-owned obstruction (-1.3, -22.7), **4/4 house faces
  enterable** (orangeStreet 1.4..1.8, orangeYard -2.2..-1.8, whiteStreet -1.4..-0.6,
  whiteYard 1..2.2), handedness PASS, verge spans identical.
- `npm run capture -- --tag photoreal`: 10/10 stations, **zero page errors**,
  one console error: bare `404` — see 3.
- Luminance (relative-luma mean of center crop, now → photoreal, FINAL build):
  aerial 60.2→59.0, turningHead 35.8→33.9, yardOrange 60.5→58.5,
  yardWhite 45.2→43.0, plaza 50.3→49.5. Control patches: plaza sky-top pixels
  byte-identical (126.8, 154.1, 184.2), asphalt foreground 67.1→67.0.
  Sunlit work preserved; shade sits ~1–2.5 points deeper. No exposure change.

## What I looked at (every photoreal-* frame opened singly; A-B vs now-*)

- **aerial — better.** Same brightness; surround now carries slab-grid tonal
  drift (was paper); dirt reads warm tan again; lawn stripes hold. Station still
  partly occluded by sibling surround slabs at frame edges — their geometry.
- **yardOrange (owner view) — better.** Roof slope carries sheen variation
  instead of flat cream; solar reflects sky; shaded terracotta deep and
  saturated per NT04; deck/lawn/glasshouse read.
- **yardWhite — better.** Canopy reads as foliage clumps, bark streaked, deck
  railing-stripe shadows intact, capsule glazing reflective.
- **turningHead — better.** Asphalt granular sheen kept; bus shadows crisp;
  chrome/window bands glint with sky gradient; hedge stays green, not black.
- **plaza — same-or-better.** Sign face + teal oval expose; gate-bar shadows
  clean; still no contact darkening at bar bases (blocked, see 1).
- **streetElevation — blocked/same.** Camera sits inside the coach (pre-existing
  sibling geometry). Diagnostic only; chrome rails glinting through it is not
  fidelity evidence.
- Diagnostics: spawnA/B, midStreet (-3..-6, fills only — expected, still
  readable); interiorOrange camera sits in a wall/ceiling void (pre-existing),
  interior beyond reads lit through openings.

## What I could not resolve

1. **Contact (brief priority 1) still cannot land from my set.** GTAO/SSR/bloom
   remain dormant: `main.ts` frame loop + `qa.goto`/`qa.render` call
   `world.renderer.render` directly; `world.render()` (the post path) has no
   caller. Wiring it touches `main.ts` render flow + the weapons overlay second
   pass — outside my files, owned by the orchestrator/integrator. My fill
   starvation widens the value range without it, but crate crevices, tyre
   contacts and gate-bar bases still meet cleanly. `post.ts` values (GTAO
   radius 1.0 m, SSR 12 m/0.3/0.55) stand ready for that day.
2. **Shadow-crispness (brief priority 2) has no safe win from my set.** My
   per-axis tightening falsely shadowed the west end and rooftops (measured
   −10..−23 before revert; mechanism: the light looks at the map diagonally,
   so world-axis bounds clip light-space coverage and out-of-frustum fragments
   clamp to shadowed edge texels). Reverted and verified recovered
   (asphalt 67.0 vs 67.1). Real fix is a light-space bounds computation, or a
   second tight caster-following cascade — both deserve their own lane and test.
   I also once dropped the bias lines and the sun scene-adds mid-edit; both
   restored and verified in the shipped bytes (tsc + recapture).
3. **One console 404**, also present on recaptures: `public/assets/` is EMPTY so
   `src/core/assets.ts` (`coach: …assets/coach.glb`, Blender-pipeline lane's
   bytes) fails to load. Not from my diff (my files contain no URLs) — flagging
   for the orchestrator; capture still exits 0 on console errors (only page
   errors fail it), but the gate should note it.
4. **Baseline drift from concurrent lanes:** orange-house gained +7 objects/+5
   colliders between now-* (13:56) and my build; `src/main.ts`, `src/ui/*`,
   `src/weapons/*`, `src/net/*` all moved under me. Traverse/door/verge spans
   are identical, so nothing enterability-relevant changed — but strict A/B
   attribution is shared with whoever dressed orange-house interiors.
5. Headless reports triangles 0 / programs 0 on this backend, so the 900k-tri /
   program-count budgets are unverifiable from these captures; call counts grow
   linearly with station order in both runs (harness accumulation), max 569 <
   1200 at face value. Perf case is by construction (bake-time textures only).
6. OPEN SPEC items untouched (ledge, verge mailbox row, head inset, hex
   calibration). No `THREE.Light` added/removed/shown, no `castShadow` toggles.
