# Task brief: INSPECTION MODE — fly, noclip, and on-screen controls

Read `docs/SPARK-CONTEXT.md` first. It binds you.

## Files you own exclusively

- `src/core/player.ts`
- `src/main.ts`
- `index.html`
- `src/core/freecam.ts` (new, if you want it separate)

Do not touch anything under `src/build/`, and do not touch `vite.config.ts`,
`package.json` or `.github/` — another agent owns those right now.

## Why this exists

The owner wants to **inspect the map**: walk it, and also fly around it freely, with
collision on or off, so he can look at anything from anywhere. No bots, no gameplay —
just free movement and a clear idea of which mode he is in.

## What to deliver

### 1. Three movement modes, toggled at runtime

- **WALK** (current behaviour) — gravity, collision, step-up, jump.
- **FLY with collision** — free 6-axis movement, no gravity, still blocked by walls.
- **FLY noclip** — free movement through everything.

Bind them to keys that will not fight WASD/shift/space. Suggest `F` to toggle fly and
`C` to toggle collision, but pick whatever is unambiguous and document it on screen.
Also give a **speed control** — fly is useless at walk pace over a 100 m map. Mouse
wheel or `[`/`]`, plus shift-to-boost.

Fly must move relative to where the camera is **looking**, including pitch — flying
forward while looking up must gain height. Walk mode must keep its current
horizontal-only behaviour.

### 2. Do not break what already works

`src/core/player.ts` currently has several hard-won properties. Read the comments
before you change anything:

- `dt` is **clamped** (`MAX_DT`). An unclamped step after a stall tunnels the player
  through geometry.
- The wish vector's rotation into the yaw frame must agree with the camera. The camera
  looks down its local `-z`, so world forward is `(-sin yaw, 0, -cos yaw)` and right is
  `(cos yaw, 0, -sin yaw)`. This had a sign error that mirrored movement about the z
  axis — correct at yaw 0 and PI, exactly backwards at +/-PI/2. **Do not reintroduce
  it.** Test your fly movement at 45 and 90 degrees to the world axes, not just facing
  down the street.
- Ground snap runs every grounded frame, not only on landing.

### 3. The QA surface must keep working

`src/main.ts` exposes `window.__NT` and the headless harnesses drive it:
`goto`, `spawn`, `release`, `stats`, `moduleStats`, `render`, `probeReset`,
`probeWalkTo`, `probePos`, `collidersAt`. **`npm run capture` and `npm run traverse`
must both still pass** — they are how this project proves itself. In particular:

- `cameraHeldByQA` stops the animation loop re-syncing the camera to the player while
  a capture station is set. Without it every station silently photographs the spawn
  view. Keep that behaviour intact for all three movement modes.
- `main.ts` asserts the garage-on-the-right invariant and exposes `handedness` through
  `stats()`; `traverse.mjs` gates on it. Keep it.

### 4. On-screen controls, and a first-time hint

`index.html` has a click-to-play overlay and a debug HUD line. Improve them:

- the overlay should list the controls clearly, including the new fly/noclip keys
- the HUD should show the **current mode** (WALK / FLY / FLY-NOCLIP) and the fly speed
- add a small always-visible key legend, or a `H` key that toggles one

Keep the overlay removable by id — `scripts/capture.mjs` removes `#start` and hides
`#hud` and `#crosshair` before every shot. If you rename or restructure those, the
capture harness breaks and every frame comes back showing the overlay while the
renderer stats still look perfectly healthy. If you must change them, keep the same ids.

### 5. Pointer lock robustness

Clicking to lock, `Esc` to release, and re-clicking to re-lock must all work. Do not
let a released pointer lock leave the camera spinning.

## Verify before you report

- `npx tsc --noEmit -p tsconfig.json` clean
- `npm run traverse` — must still be **5/5 routes, 4/4 house faces, handedness PASS**
- `npm run capture -- --tag cam` — 10 stations, no page errors — then **open two or
  three of the PNGs with the Read tool** and confirm they show the map, not the overlay
- exercise fly and noclip yourself in a headless browser: drive the camera through a
  house wall with noclip on, and confirm it is blocked with noclip off

Report the exact keybindings you chose, what you verified, and anything you left undone.
