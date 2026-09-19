# Inspection report â€” standalone Nuketown 2025

## Frozen identity

This is the new standalone browser FPS project, frozen for inspection at source
commit `f7d2c57b8e13eb583e532955774b745489c91c11`. It is a rebuilt map and
runtime. The earlier Atomic Acres/Nuketown project was used as a systems
reference for weapons, damage, killstreaks, HUD/menu patterns and multiplayer;
its code and assets are not the identity of this project. The current candidate
was reviewed from `http://127.0.0.1:4192/` and promoted at 14:50 local.
**VERIFIED playable URL: [Open Nuketown 2025](http://127.0.0.1:4191/).**
A fresh stock Chrome launch used the real Play solo and Deploy buttons on 4191,
reached an active match, and reported zero console, page or resource errors.
The previous build is preserved in the recovery backup.
The candidate JavaScript is `index-OESe3EVZ.js`. A fresh build from the frozen
source, the candidate file and HTTP byte readback match SHA-256
`a0c339ffe968153c1bc82afa765cc81db3f98b148e12f57fdb10d52614fd2494`.

## What changed since the earlier b5 baseline

- The standalone menu now exposes `Play solo`, `Multiplayer`, `Options`,
  `Credits`, and the Nuketown 2025 map card. Solo rules persist and flow
  through `Deploy`; multiplayer uses the real LAN/WebRTC lobby.
- The live network path now has authoritative host movement, crouch/prone
  forwarding, loadout/HUD continuity, weapon damage and kill-feed evidence,
  clock-offset handling for ordnance, and a host-silence watchdog that returns
  a guest to the exact `HOST LEFT THE ROOM` state.
- The environment path has live time-of-day, weather, fog and smoke controls
  on the existing light set. The candidate has procedural/PBR material passes,
  reviewed field-case and barrel props, a licensed Quiver Tree canary, bounded
  foliage maps, viewmodel material work, and modern authored/recorded audio
  banks. These are quality improvements over the baseline, not a claim that the
  whole scene is photoreal.
- Geometry and placement work added exact collider capture, corrected bedroom
  reachability evidence, honest barrel clearance, native-scale plant placement,
  and bounded CPU/runtime lifecycle checks. The visual scene still contains
  simple procedural buildings, trees, mountains and operator geometry.

## How to inspect the candidate

1. Open `http://127.0.0.1:4191/` and choose the `Nuketown 2025` map card on
   the main menu. Select `Play solo`, choose bots, difficulty and time limit,
   then press `Deploy`.
2. Open `Options` â†’ `Graphics` â†’ `Environment` to change `Time of day` and
   `Weather`. The current controls are `noon`, `morning`, `goldenHour`,
   `dusk`, `overcastNoon`, and `clear`, `overcast`, `rain`. For a pinned review
   load, the first page load also accepts `?tod=<name>&weather=<name>`.
3. The map/location selector currently contains one shipped location,
   `Nuketown 2025`; it is a map card rather than a free-roaming location
   system. Use `Multiplayer` for the real host/join/ready/start path.

## Evidence at the frozen checkpoint

**VERIFIED** from the named receipts:

- Four real playcap stations pass, with no page errors and a worst measured
  1,187 draw calls against the unchanged 1,200-call limit.
- The 120-second two-browser proof passes 24/24 checks under +240,000 ms guest
  clock skew: real WebRTC joining, movement, crouch/prone, loadout, weapon
  damage, kill feed, smoke lifetime, nine connected samples and zero bad
  samples. See `captures/checkpoint-g-net.txt`.
- The ungraceful host-loss proof passes 9/9 checks. The guest reaches
  `HOST LEFT THE ROOM` in 6,483 ms, before any host unload/pagehide/bye event;
  both browser error arrays are empty. See
  `captures/host-loss-live/result.json`.
- Map traversal passes 5/5 routes and 4/4 house faces. The barrel CPU proof
  passes all four placements against the complete 652-row collider fixture,
  with minimum gaps `0.561 / 0.460 / 0.716 / 0.569 m`. Barrel-specific player
  traversal remains open.
- All 15 time/weather combinations repeat for three cycles (45 switches), the fixed
  three-light rig survives the switches, render budgets remain bounded and
  the weather proof reports no page errors. See `captures/weather-cycle.txt`.
- The Quiver Tree canary passes two native-scale placement/render frames, its
  two-collider module check and the candidate Vite build. Final subjective
  quality and placement-specific traversal remain open.
- The 210.7-second soak is recorded as a qualified harness pass: JS floor fit
  `+0.566 MB/min`, `RÂ² 0.17`; renderer fit `+2.499 MB/min`, `2.58 MB` net and
  60% upward samples. This is bounded evidence, not indefinite stability.

## Actual provider and asset routes

**VERIFIED/recorded:** GLM 5.3 Flash at max through OMP contributed bounded
barrel, turf, net and watchdog/resume lanes. Muse Spark 1.3 contributor at the
requested xhigh route contributed bounded geometry/asset lanes, including the
saloon, hedge and barrel work. AGY supplied reviewed 2D image references and
the licensed Quiver Tree conversion route; Blender 5.1 ran the conversion CPU
only with two threads. Existing local Kimodo SOMA-RP output supplies the baked
21-bone clips through the documented retarget route. Provider responses and
asset provenance are recorded in the campaign and asset documents.

No Trellis 2 or H3 video/model run was launched in this checkpoint: the
measured GPU/RAM reserve and model peak would not leave the required interactive
headroom. Image-generation outputs remain 2D look references unless separately
converted and accepted as geometry.

## Quality and unresolved edges

The current result is a working, stylized and substantially more coherent
standalone canary. It is not yet photoreal. The static reflection canary was
rejected because it only darkened local glass; no default reflection upgrade is
claimed. Foliage still reads topiary in places, distant mountains and operator
surfaces remain simple, and the fence/yard dressing pass is incomplete.

The current resume receipt is intentionally retained as a failure: the guest
rejoins the reserved seat but remains `idle`, so live match resume, post-resume
movement and post-resume firing are OPEN. The host-loss timeout path is
verified separately and must not be confused with resume acceptance.

## Next three priorities

1. Repair and re-run the real mid-match resume path until the rejoined guest
   reaches active match state, preserves the authoritative life epoch, moves,
   and can fire; retain the current negative receipt as the falsifier.
2. Finish one focused visual pass on fences/yard dressing, trees and operator
   materials, with before/after frames and the existing draw, memory and
   traversal gates. Keep the rejected reflection experiment closed.
3. Complete barrel/Quiver placement-specific traversal and improve actual
   material/light response using reviewed camera pairs; keep this promoted
   checkpoint available throughout later experimental passes.

## Preservation and continuation

VERIFIED: source checkpoint f7d2c57 is committed. Its incremental Git bundle was
verified against the retained fb715 prerequisite. The promoted artifact and the
previous artifact are both in `C:/Users/david/Desktop/stuff/nuketown-recovery/20260919T085155Z/`.
The current root source may contain the NEXT unpromoted resume repair;
`http://127.0.0.1:4191/build-info.json` identifies the frozen playable artifact.
GLM max continues the isolated fence repair. Muse xhigh produced a lighting
critique, but its run recorded errors and its screenshot attribution was incorrect;
that draft is explicitly unaccepted. No new lighting change is claimed from it.
Work continues beyond the 15:00 inspection checkpoint.
