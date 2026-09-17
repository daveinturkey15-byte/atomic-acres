# Report: WEAPONS — viewmodel, firing, movement feel

Lane complete. All work in `src/weapons/` (new) + `src/main.ts` (wiring only).
Nothing else touched. No commits, no installs, no killed processes.

## What was built

**`src/weapons/types.ts`** (orchestrator-written contract so 4 parallel units agreed):
`ViewmodelRig { group, muzzle, eject }`, `MoveSample`, `WeaponSnapshot`.

**`src/weapons/viewmodel.ts`** — procedural rifle + pistol, boxes/cylinders only,
origin at grip, barrel down local `-z`, `muzzle`/`eject` anchor empties.
Rifle ~0.86 m (receiver, barrel + muzzle device, ribbed handguard, stock, angled
grip/mag, post + notch sights, charging handle). Pistol ~0.215 m (slide, frame,
timber grips, 3-box trigger guard, blade + notch sights). Materials from `mat`
singletons only, colours from PAL only, all shadows off.

**`src/weapons/effects.ts`** — `WeaponEffects`, fully pooled: 1 muzzle-flash quad,
8 tracers (shared stretched-box geometry), 24 shells (preallocated vel/spin),
12 sparks + 4 impact quads. Lifetimes advance by visible/scale/position/quaternion
only — never opacity, colour, or material work. Round-robin reuse, zero
post-construction allocation, zero lights, zero `new THREE.Material`.

**`src/weapons/controller.ts`** — `WeaponsController`. Two defs: **Longhorn**
(auto, 600 rpm, 30+90, 2.1 s reload, 1.6° hip spread) and **Duster** (semi, 12+36,
1.4 s reload, 1.2° hip spread); 0.35° ADS spread both; pitch kick + yaw jitter
with ~8/s exponential recovery layered onto the camera after `Player.update`.
Own `overlay` Scene with one static HemisphereLight + one DirectionalLight added
once (PAL colours) and never touched again. Per-frame: camera-following mount,
hip `(0.22,-0.20,-0.45)` → ADS `(0,-0.148,-0.30)` lerp, FOV 72→55 lerp, 4 mm/1 mm
idle sway, speed-advanced walk bob (grounded only), ~12° sprint-lower (suppressed
in ADS), reload lower-tilt-raise, auto-fire timer, raycast hit detection against
builder groups with muzzle-anchored tracer + normal-aligned impact, shell eject
from camera-right/up. Lazy try-guarded WebAudio synth (shot burst, empty click,
reload clicks). `command()` exposes fire/reload/ads/switch/state/visible for QA.
`setVisible(false)` hides overlay, clears ADS/recoil/reloads, restores FOV 72.

**`src/main.ts`** — collects `worldTargets` in the build loop; constructs the
controller after `player.setColliders`; ammo line as a `#hud` child (capture-hidden);
help text extended; mousedown 0/2 → fire/ADS, `R`/`1`/`2` keydown (repeat-skipped),
wheel → weapon cycle gated on walk mode; frame loop runs `weapons.update` after
`player.update`, then main render + `clearDepth()` + overlay render with
`autoClear=false` restored after (verified present on WebGPURenderer in
`node_modules/three/build/three.webgpu.js`). `goto()` hides the weapon first,
`spawn()`/`release()` restore it; `weaponCmd(cmd, arg?)` added to `__NT`.
All pre-existing QA members byte-for-byte behaviour-preserved.

Keybindings: **LMB fire · RMB aim · R reload · 1/2 or wheel weapons**
(wheel only in walk mode; fly speed control untouched).

## What was measured

- `npx tsc --noEmit`: **clean for the whole tree** at end of lane (an earlier
  `src/ui/menus.ts` error belonged to the HUD lane; they fixed it).
- `npm run capture -- --tag wep`: **10 stations, exit 0, zero page errors**.
  (Stats readouts showed low calls / 0 tris — same in the concurrent `shine`/`hud`
  runs that minute; a backend-reporting property of the current tree, not this lane.
  Morning baselines on the same harness showed 300+ calls / 130k tris.)
- `npm run traverse`: **5/5 routes, 4/4 house faces, handedness PASS, exit 0**.
  (First two attempts hit traverse's 30 s ready-timeout on cold Vite transforms;
  a flagless probe proved the tree booted in <5 s with zero errors, and the warm
  re-run passed.)
- Headless combat drive (production `vite build` + `vite preview`, frozen bundle,
  SwiftShader): 120 rifle attempts → **exactly 30 true** (mag-empty boundary
  correct); pistol 5/5; mag dump → `emptyClick:false`, `reloadStarted:true`;
  post-reload **30/60 with correct reserve transfer**; ADS flag round-trips.
  Geometries **669→669**, textures **63→63** across 120 shots — **zero growth**.
  `pageErrors: 0`, `consoleErrors: 0`.
- `npm run build`: passes (one transient esbuild failure mid-lane was another
  lane's mid-save syntax error, green on retry).

## What was looked at (opened, not assumed)

- `captures/wep-aerial.png`, `wep-yardOrange.png`: full map renders, **no
  viewmodel in fidelity frames** — suppression confirmed visually.
- `captures/wep-soak-hip/fire/ads/hip2.png`: rifle renders correctly in hip
  offset and ADS-centered poses; front post + rear notch align on the crosshair
  in ADS; ejected brass visible mid-air; HUD ammo line reads correctly
  (`Longhorn 30 / 60 · ADS`, `Longhorn 0 / 90 · reloading`).

## Honest anomalies

1. **Soak-screenshot ↔ state mapping is unreliable under SwiftShader.** The four
  soak PNGs each show an internally coherent weapon state, but their HUD states
  do not match capture order (e.g. the file named `hip` shows post-reload ADS).
  Likely causes: multi-second compositor lag under software rendering plus a
  probable GPU-device-loss page reload mid-run (renderer.ts does that by design).
  The DRIVE telemetry in the same run is single-evaluate, deterministic, and
  fully coherent — that is what the functional claims rest on, not the PNG order.
2. **Muzzle flash / tracer streak / impact spark never visually confirmed.**
  Flashes live 50 ms; SwiftShader frames are seconds apart, so no screenshot
  could catch one. The code paths executed 35+ times with zero errors; visually
  unproven. A real-GPU screenshot (or longer-life debug flash) is still wanted.
3. **Shells cluster mid-air in one frame.** Under SwiftShader each frame advances
  at most 0.05 s (`MAX_DT` clamp), so 0.9 s shell lives stretch across ~36 real
  seconds and accumulate. Slow-motion artifact of the test rig, not a bug at
  real framerates — but only proven by reasoning, not by a 60 fps capture.
4. **Concurrent-lane churn cost most of the verifying time.** Five agents share
  this tree: mid-lane I observed `ground: desert is not defined` and
  `plaza: CORD is not defined` build throws (both since fixed by their lanes),
  several HMR reloads mid-soak, and dev-server spawn starvation. The preview-
  bundle isolation pattern (build once, soak the frozen bundle) is what finally
  gave a clean signal — recommended for any headless driving while lanes share
  one tree.
5. **`stats().programs` is 0 on this backend** (WebGPURenderer info has no
  programs field), so the "programs must not climb" check reduces to
  geometries/textures stability here. The singleton-material discipline was
  verified by code review (grep: zero `new THREE.Material` in `src/weapons/`)
  rather than by a live program count.

## Not finished / wanted next

- Visual confirmation of muzzle flash, tracer, impact spark on a real GPU.
- Sprint-lower, walk bob, reload dip: implemented and unit-sane, never observed
  (needs pointer-lock play, not headless).
- `src/core/assets.ts` / `post.ts` landed mid-lane (Blender pipeline). Per the
  brief the weapon does not depend on them; a future pass could dress the
  viewmodel with that pipeline's output.
- Shell impact audio + reload click scheduling are minimal synth; fine for now.
