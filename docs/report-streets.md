# Report: streets (items 2, 6, 9)

Lane: ground.ts + plaza.ts + skyline.ts. Three parallel workers (one per file), two
fix-up workers for dropped declarations. Only these three files touched.

## What changed

**src/build/ground.ts** (+~286/-27):
- Warm paving family: straight pavements + bulb ring + both frontage wedge pads now
  `painted(PAL.pavingWarm)`; garage aprons now `painted(PAL.flagstone)`; joints now
  warm-stain tone + 14 radial joints on the bulb ring; stained-slab variation quads
  (half-grid off joints, skipping driveways/util covers) + tar strips + cracks on the
  `Y_PAVE_MARK` rung. Kerbs stay `ctx.mat.kerb` (pale), all asphalt stays dark neutral.
- Closed the -x end: black steel gate (`PAL.busBlack` posts/rails/bars + steel mesh)
  across the carriageway at `ROAD_X_MIN + 0.15`, 2.2 m leaf, `aabbSlab` collider.
- Boundary manhole: added `[ROAD_X_MIN + 1.2, 0]` cover (0.84 m dia) to the instanced
  covers + centre-dash keep-clear.
- Verge rhythm both sides `ROAD_X_MIN + 2 .. KERB_JOIN_X`: twin-head lamp columns
  (plinth + 5 m steel column + splayed arms + pale heads + emissive lens, instanced
  families) every 8–15 m via `ctx.rand`, nudged off driveway spans; planter / AC-louvred /
  placard boxes cycling between lamps with driveway-aware slots; all with colliders.

**src/build/plaza.ts** (+109):
- Section 8 pylon island at the skyline-pylon foot seam (`ISL_X = BOUND_X_MIN - 12`,
  `ISL_Z = -(PAVEMENT_OUTER + 1.6)`, never moved): flagstone pad + pavingWarm inset +
  pavingStain kerb ring (edge |z| >= 5.0, clear of carriageway), maroon base + teal cap,
  small atom motif (steel mast, maroon nucleus, teal orbit ring), two bronze-look boards
  (fenceRail via `painted()`) with illegible cream lines facing +x, planter pair at west
  corners, open centre strip. Colliders for pad/base/boards (was: no colliders).
- Section 9 entrance rhythm: 3 stations (kiosk-relative) each planter + louvred AC box +
  twin-head-compatible plinth (paired steel stubs, no columns — columns live in ground
  lane) + placard facing the road; all +z half, south of the flag row, clear of hypar
  footprint and inlay disc. Dais/rope/kiosk/bunting/pavilions untouched.

**src/build/skyline.ts** (+24, saucer block only):
- Mauve soffit band under the saucer lip (tapered cylinder ring, top r 4.85 / bottom
  r 4.0, 0.55 deep, `painted(PAL.saucerSoffit)`).
- 4 recessed downlights: instanced face-down discs (`emissive(PAL.windowBand, 1.1)`) on
  the map-facing arc at r 4.2, 0.3 rad steps ≈ 1.26 m apart, 0.02 below the soffit.
- Legs untouched (4 splayed, feet on ground, walk-under volume open). Pylon verified
  already compliant (signMaroon script, signTeal oval, atom finial, panel clears the
  bunting corridor) — no edit.

Constraints held: palette read-only, `ctx.mat.painted()` / existing library only (no new
`THREE.Material`), `ctx.rand()` only, layout constants for all structural placement,
`aabb`/`aabbSlab` colliders. Two fix-ups restored declarations the first pass dropped
(`desert` + `lineSpecs` in ground.ts, `CORD` in plaza.ts) with no behavior change.

## What I measured

- `npx tsc --noEmit`: **zero errors in ground.ts / plaza.ts / skyline.ts** (grep empty).
  Full tree is still red from another lane: `src/ui/menus.ts(196,23): error TS2488`
  (NodeList iteration) — not ours, left alone.
- `npm run capture -- --tag streets`: 10/10 frames, **0 page errors, 0 console errors**,
  handedness `[true, true]` on every station. Calls 60–114 (budget 1200). Triangles and
  programs read 0 in this headless run (renderer-info path, not a scene regression —
  prior baseline 363 calls / 135k tris / 18 programs; do not compare).
  Modules: ground 70 obj / 82 colliders, plaza 38 / 19 (was 0), skyline 48 / 0.
- `npm run traverse`: **FAILED — `page.waitForFunction: Timeout 30000ms exceeded` at
  traverse.mjs:54** waiting for `window.__NT.ready === true`. Capture boots the same app
  clean (0 page errors), so this is not a streets-lane boot failure; likely the
  assets-readiness gate or another lane's concurrent change. Needs a rerun after the tree
  settles. The 5/5-routes + handedness + verge-scan quote cannot be given from this run;
  handedness PASS is confirmed via the capture per-station stats instead.

## What I looked at (all `captures/streets-*.png`, opened, not assumed)

- **plaza** (ref NT05): black gate closes the mouth ✓, boundary manhole on the asphalt ✓,
  twin-head columns down both verges ✓ (they now stand alongside yards.ts's orange
  singles — reads as rhythm, slightly doubled), planter/AC boxes + hedges ✓, pylon
  maroon script + teal oval + atom + needle ✓. Island base at the pylon foot is **not
  clearly resolvable** at this range — reported as built, not as seen.
- **aerial** (ref NT02): town-in-desert, head circle, third house + red car, mow stripes
  all hold. The surround still reads cool pale — the warm change covers the pavement
  bands/ring/wedges/aprons, **not** the big base apron (`ctx.mat.paving`), which
  dominates this view.
- **streetElevation** (ref NT04): twin-heads + orange singles + planters + chain-and-post
  + appliance banks read well; road dark ✓. **Pavements/driveways still read cool
  blue-grey, not warm tan**, despite the warm keys in code. Either the flat
  `painted()` warm (no warm texture — materials.ts is another lane's) renders cool under
  this light rig, or the visible sidewalk is the base-apron surface. Unresolved — see below.
- **turningHead** (ref NT02): bulb, kerbs, ring dashes, coach + truck chicane, fence,
  third house hold. Warm ring not distinguishable from cool at this angle.

## What I could not resolve (honest)

1. **Warm read**: keys are in the bytes (`pavingWarm`/`pavingStain`/`flagstone` in ground
   + plaza, confirmed by grep), but eye-level frames still read cool. The base apron was
   deliberately left on `ctx.mat.paving` (it is the shared surround other modules key
   off); warming it is a materials-owner decision. Recommend: materials lane warms the
   paving texture itself, or a follow-up moves the base apron to warm — not something to
   sneak in here.
2. **Saucer downlights**: no fidelity station frames the saucer closely (it sits at
   z = −66, out of the aerial crop). Added per REAL-REFERENCE measurements (1.0–1.5 m
   spacing → 0.3 rad steps), visually **unverified** — needs a freecam close-up, not a
   station claim. Cited close-up frame `f-FKQOEO-1ceE-165.jpg` read back as an interior
   doorway on open, and `-195.jpg` as a box truck; the worker built from the prose
   measurements instead of pixels.
3. **Traverse gate**: blocked (above). Rerun when the tree is green.
4. Lamp doubling: ground twin-heads + yards singles now coexist. Reads fine in the plaza
   frame, but if the fences lane later upgrades yards lamps to twin-head, one family
   should be removed to avoid a doubled row.
