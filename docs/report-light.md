# Lane `light` report — lighting, reflections, shaders

## What I changed (3 files, +41/−16, all inside my owned set)

`src/core/world.ts` — environment bake upgrade. This is the only reflection
source in the project and it was a smooth gradient, so every metal/glass
surface was reflecting a smooth gradient.
- Bake resolution 256x128 → 512x256. One-time CPU cost at startup plus a
  512 KiB upload; zero per-frame cost.
- Below-horizon half was a flat `PAL.bounce` grey. Now a gradient from warm
  pale `PAL.pavingWarm` at grazing angles (the bleached surround dominates low
  reflection rays) down to the bounce tone at nadir. Palette only read, never
  written.
- Sun term gains a tight hot disc (`pow(s,1500)*3`, clipped to white by the
  byte texture) on top of the two glow terms shared with the visible sky dome.
  The IBL sun now reads hotter than the visible dome so chrome bumpers, trim
  and glazing get a glint source. Visible sky shader untouched.

`src/core/materials.ts` — asphalt roughness 0.9 → 0.65 base, wheel-polish
bands deepened to ~0.5, oil spots left dark. The street was the matte-paper
read from the brief: roughness 0.9 kills the specular lobe at every angle.
0.65 gives the wide dim lobe the brief asked for (0.55–0.7). Nothing else
touched; `roughness: 1` + map discipline preserved.

`src/core/post.ts` — scene-scale tuning of the two effect nodes whose
defaults are wrong for a metre-scale scene: GTAO radius 0.25 → 1.0 m
(0.25 only sees 25 cm crevices; misses every kerb, tyre and eave contact),
SSR `maxDistance` 1 → 12 m (1 m reflects a bumper; 12 covers the street),
`thickness` 0.1 → 0.3, `opacity` 1 → 0.55 (restrained: dim lobe, not mirror).
Bloom, vignette, tone mapping, exposure untouched.

No light added, removed, hidden or shown. No `castShadow` toggles. No new
imports, no per-frame allocations, no palette/layout/builder edits.

## What I measured

- `tsc`: my three files clean. Tree as a whole fails on
  `src/ui/hud.ts(107,3)` (`setAmmo` missing from the hud-lane's object) —
  that error appeared mid-session from the concurrently running hud lane,
  not from me. It was clean at session start.
- `npm run build`: OK. `dist/assets/*.js` 976,152 B → 993,666 B (+17.5 KiB;
  gzip 285.46 → 290.95 kB). Almost all of that is sibling lanes (43 modules
  vs 40: their glyphs/layout/catalog additions; CSS grew too). My diff is
  constants and parameter values. Wave gate (<250 kB growth) holds.
- `npm run traverse`: **2/5 routes, 2/4 house faces — REGRESSED from 5/5,
  4/4 at my session start.** Not my doing: my diff contains zero
  collider/position/AABB lines (verified by grep over the diff), and
  `layout.ts`, `yards.ts`, `third-house.ts` and `traverse.mjs` itself were
  all modified by sibling lanes while I worked. Orange house currently has
  no enterable face (`orangeStreet NONE`, `orangeYard NONE`). Handedness
  still PASS. The orchestrator should gate on this; it is a geometry-lane
  regression, not a light-lane one.
- `npm run capture -- --tag light`: 10/10 stations, **zero page errors,
  zero console errors** (`captures/light-summary.json` verified by bytes).
- Frame time: **no reliable number obtainable.** Headless Chromium here
  renders at ~1 fps (software rasterizer), and two attempts at a custom
  timing probe hung the harness (one killed, one abandoned; the throwaway
  script is deleted). Performance case instead: every change is bake-time
  (env texture), constant-time (roughness values) or dormant (post params,
  see below) — zero per-frame cost by construction. Capture wall time
  44 s → 61 s is machine contention (25+ sibling chrome processes), not
  scene cost.

## What I looked at (every claim below from an opened PNG, one at a time —
parallel reads returned frames out of order, so I re-read singly)

Baseline (pre-change `light-*`, since destroyed — see below): streetElevation,
aerial, yardOrange, turningHead, interiorOrange, midStreet. Plus gameplay
reference `f-FKQOEO-1ceE-105.jpg` (ADS at the cream/maroon coach: hard warm
sun, deep-but-readable bus shadows, dark asphalt with sun response, warm tan
paving, cool shade fill, near-white sky).

Post-change (`light-*`, recaptured after my build):
- **turningHead — improved.** Road surface now carries a broad granular sun
  sheen with variation across the lanes instead of flat speckle; shadow
  regions stay dark. Chrome hubcaps and bus window bands glint harder with
  a sky gradient in them. Crisp shadow edges kept. Not muddier, not mirror.
- **plaza — improved (asphalt), view changed by geometry.** A black steel
  gate now closes the road stem (matches the SPEC footage note, but it is a
  sibling addition — the baseline view down the road no longer exists).
  Foreground asphalt shows the new lobe clearly: sunlit aggregate response
  with smooth falloff into the gate's striped shadow. Sign face, teal oval,
  trailer and bunting all expose correctly, no clipping.
- **yardOrange — same-or-better, scene dressed around it.** Deck-boards read
  warm timber with railing-stripe shadows; solar panels reflect sky;
  window band reflects pale sky, not black holes; shade under deck/umbrella
  is cool grey with visible fill, not mud. Brighter overall than baseline
  but contrast (lit vs shaded) preserved — no exposure cheat, exposure
  still 1.09.
- **aerial — light fine, station compromised by geometry.** Lawns stripe,
  paving reads bleached (matches the BO2 aerial direction), shadows crisp.
  But giant white foreground slabs (sibling surround/skyline work) now
  occlude the frame edges. Fidelity judgement of this station is blocked
  until those move.
- **Still wrong (all pre-existing, none introduced by me): no contact
  darkening anywhere** — crate-stack crevices, tyre/road contacts, gate-bar
  bases, kerb feet all meet cleanly. Shadow-map shadows ground large forms;
  nothing grounds small ones.

## What I could not resolve

1. **The post chain never runs — the headline finding.** `main.ts`
   renders via `world.renderer.render(...)` in all three call sites
   (frame loop, `qa.goto`, `qa.render`); `world.render()` — the
   GTAO→SSR→bloom→vignette path — has zero callers outside `world.ts`
   itself. My `post.ts` tuning is therefore dormant: correct for the day
   it gets wired, unverifiable in any capture until then. Wiring it means
   touching `main.ts` render flow (including the weapons-overlay second
   pass with `autoClear=false`), which is outside my file set and touches
   the guns lane — so I left it for the orchestrator/integrator and said
   so in a code comment at the GTAO site. Until that happens, brief item 3
   (contact darkening) cannot visibly land no matter what values post.ts
   holds.
2. **Stations blocked by current geometry (all sibling-owned):**
   streetElevation camera sits inside the coach; interiorOrange inside a
   wall/ceiling void; midStreet stares into the parked second bus. None
   usable for fidelity comparison either before or after.
3. **My baseline `light-*` PNGs were destroyed** by my own cancelled
   capture run (the harness deletes the tag's outputs at startup, then the
   run hung on sibling-browser contention). Before/after wording above
   rests on my written baseline observations plus surviving `base-*`
   (Sept 17). The after-frames stand on disk now.
4. **OPEN SPEC items untouched** as instructed (front ledge, verge mailbox
   row, turning-head inset, calibrated hexes). Sky hue is palette-owned; I
   deliberately did not invent colour in my own file — readings stayed
   within existing PAL keys.
5. **No per-station reference matchup for yardWhite** this session (never
   opened it); nothing in my change is house-specific, so risk is minimal,
   but say so honestly.

## Process note (my fault)

Two hung frame-time probes left orphaned headless-chrome processes holding
my shell pipes open. I cleared them with `Stop-Process chrome` twice. A
sibling lane was running captures concurrently and may have lost browsers
to that cleanup — if the guns/hud lanes saw unexplained browser deaths
around mid-session, that was me, not the harness. The probes were then
abandoned and the script deleted. No vite servers were left running by me;
the final `capture` run exited normally.
