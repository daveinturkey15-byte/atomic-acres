# Report: HUD, menus, Atomic Acres rename (hud lane)

## What changed (my lane only: `src/ui/`, `index.html`, `README.md`, `docs/DEPLOY.md`)

New `src/ui/` (6 files, zero three.js imports, zero draw calls — all DOM/CSS):
- `hud.ts` — `initHud(): HudApi` with all 10 methods: crosshair bloom
  (4 child spans in existing `#crosshair`, `--xh-gap` widens on
  moving/firing, hidden on ADS), ammo `mag/reserve` + low state (<=5 or
  <=20% of 30), health bar + `damageFlash()` vignette (0.45 s ease-out),
  `hitmarker(kill?)` X flash (110 ms, 350 ms kill variant), killfeed
  (max 5, 5 s age-out), canvas minimap drawn ONLY from `layout.ts`
  constants (road stem, turning head, per-`HOUSES` main block + garage
  wing, back fences, yard bounds; forward = (-sin yaw, -cos yaw),
  verified by hand computation), Tab-hold scoreboard with placeholders,
  `setDebugVisible` gating pre-existing main.ts debug divs behind
  `.hud-debug-hidden` (default hidden). Placeholder defaults: 30/120,
  100 hp, tight visible cross.
- `hud.css`, `menus.css` — BO2-ish thin sans, white-on-shadow, amber
  accent only. Every selector scoped under `#hud`/`#crosshair`/`#start`.
- `settings.ts` — `{sensitivity 1.0, fov 75, quality 'high'}`,
  load/save/reset, every localStorage access in try/catch.
- `menus.ts` — `initMenus({hud, player, world})`, everything inside
  existing `#start`: main menu (ATOMIC ACRES / Nuketown 2025 / Play /
  Settings / fan line), data-driven `MAPS` array (1 entry, runtime
  canvas schematic thumbnail from layout.ts), settings panel (sliders +
  quality select, FOV applied via `camera.fov +
  updateProjectionMatrix()`), pause on `pointerlockchange` (Resume /
  Settings, only after a real session starts). Buttons stopPropagation
  so menu clicks never bubble to the overlay dismiss/pointer-lock.
- `index.ts` — `initUI({player, world})`: builds HUD + menus, rAF loop
  pushing `player.state` pos/yaw/velocity into `setPlayer`/`setMoving`,
  returns `{hud}` for the weapons agent.

Rename: `<title>` → "Atomic Acres — Nuketown 2025", overlay H1 →
ATOMIC ACRES + fan line, README + DEPLOY.md retitled with live URL
`https://daveinturkey15-byte.github.io/atomic-acres/` and the
unofficial-fan-project line. Map keeps the name Nuketown 2025.
Repo folder and `package.json` untouched.

**Wiring for `main.ts`** (orchestrator adds after the startOverlay setup,
~line 101). Not applied by me — main.ts is another lane's:
```ts
import { initUI } from './ui/index';
const { hud } = initUI({ player, world });
```
Weapons agent pushes state with one-liners, e.g.
`hud.setAmmo(mag, reserve)`, `hud.hitmarker(kill)`,
`hud.damageFlash()`, `hud.setADS(true/false)`.

## Measured
- `npx tsc --noEmit`: **zero errors in my files**. Repo-wide tsc is red
  from other lanes (`src/core/post.ts` syntax errors at 156/159,
  `src/weapons/effects.ts` at 314/327) — not mine, not touched.
- `npm run capture -- --tag hud`: 10 stations, exit 0, no page errors.
  (Ran without my UI wired — wiring is orchestrator's step — so this
  proves the harness path, not the HUD.)
- Throwaway click-through (scratch page + stub player/world, deleted
  after): per-step DOM-state log + 4 screenshots, zero page errors:
  `overlay=block/score=none` pre-Play → map-card selection works →
  `overlay=none` post-Play → Tab-hold `score=block` → settings view
  renders with persisted defaults. Evidence kept:
  `captures/v2-menu.png`, `v2-hud.png`, `v2-score.png`, `v2-settings.png`.
- Opened and looked at: `captures/hud-streetElevation.png` +
  `hud-spawnA.png` (**no UI visible** — ids intact, harness strip
  works), plus all four v2 frames (menu, HUD mid-damage-flash with
  hitmarker X, scoreboard on Tab, settings).

## Capture-safety
All new nodes live inside `#hud`, `#crosshair`, or `#start` — verified
by reading both modules end to end. Ids `start`/`hud`/`crosshair` kept.
Overlay listener stays on `#start` itself; menu children
stopPropagation. Harness `remove()`/`display:none` hides everything.

## Unresolved / flags for the orchestrator
1. **H-key overlap (real):** main.ts toggles `hudHelp.style.display`
   inline, but my `.hud-debug-hidden .hud-debug{display:none !important}`
   beats inline styles, so after wiring, H will appear dead while debug
   is hidden. Fix when wiring: make H call
   `hud.setDebugVisible(...)` instead (or drop the old handler).
2. **Sensitivity + quality persist but don't apply:** no public hook
   exists (`Player` look speed is a hardcoded constant, `World` has no
   quality hook). Code probes `player.setSensitivity?.()` for the
   future. FOV applies today.
3. **Pause-on-Esc path not exercised** (headless pointer lock never
   engages, so `pointerlockchange` pause wasn't click-tested). Logic is
   10 lines and guarded; needs one real-browser Esc test.
4. DEPLOY.md still names `Play-Nuketown.cmd` — the file itself wasn't
   renamed per the brief (not in my file set).
5. First screenshot pass produced states contradicting the logged DOM
   (scoreboard visible pre-Tab, menu visible post-Play); re-ran with
   per-step state assertions and everything agreed. Likely cause: a
   vite reload from a concurrent lane's file save mid-run. Run-1 PNGs
   deleted; only the consistent v2 set kept.
6. Observed, not mine: capture log prints `0k tris` at every station
   while the frames render full geometry — concurrent materials-lane
   work in flight; worth a look before any perf claim is made.
