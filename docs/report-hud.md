# Lane `hud` — report

## What changed (my files only)

- **`src/ui/hud.ts`** (rewritten): same `HudApi` names, extended with
  `setWeapon(name, reloading)`, `setScore(text)` and
  `damageFrom(srcX, srcZ, px, pz, yaw)`. Every setter caches its last-written
  value and returns early on no-change; caches seed at impossible values so
  the first real push always writes, whatever the weapon defs say. Kill feed
  is a fixed 5-row pool built once and recycled round-robin (one
  `textContent` + one class flip per event, zero create/remove). Health fill
  uses `scaleX`, not `width`. Minimap caches its 2d context and redraws only
  past its quanta (0.25 m / ~2°), so a still player costs a few float
  compares and zero canvas work. Minimap colours now read off `PAL`
  (terracotta / capsule-white houses, barrel-roof garage, fence-rail fences,
  concrete-dark road). Accent/danger/ink are pushed once at startup into
  `--aa-*` custom properties from `PAL.hazardYellow` / `PAL.applianceRed` /
  `PAL.capsuleWhite`.
- **`src/ui/hud.css`**: new blocks for weapon, reload flag, score line,
  damage arc, pooled-row hidden states. Animations are opacity/transform
  only; `will-change` is on hitmarker, vignette and damage arc and nowhere
  else; `prefers-reduced-motion` disables the flash animation.
- **`src/ui/layout.ts`** (new): the HUD layout contract — every shared
  number (pool size, timings, thresholds, minimap quanta, crosshair gaps,
  selector map) in one place with the CSS selector each governs, plus
  `palCss`/`palRgba` helpers. The old project's lesson was that the HUD
  drifts when CSS and JS hardcode the same limits independently.
- **`src/ui/glyphs.ts`** (new): input-glyph contract from the old
  `hud-glyphs` lesson — `<kbd data-glyph>` caps whose text is the only thing
  that ever changes; keyboard labels today, standard-pad labels ready, flips
  on `gamepadconnected`/`disconnected`, no polling, per-element cache.
- **`src/ui/index.ts`**: per-frame `setPlayer`/`setMoving` pushes stay (now
  cheap by construction), plus a 4 Hz poll of the existing
  `window.__NT.weaponCmd('state')` feeding `setWeapon` — a *read* against the
  existing QA surface, no touched siblings. Exposes `window.__AA_UI = { hud }`
  so sibling lanes (weapons needs hitmarker/killfeed pushes) and headless
  verification can reach the live API. Boundary types narrowed (`UiPlayer`
  extends `MenuPlayer`; `unknown` + guards at the `__NT` read).
- **`src/ui/menus.ts`**: fully keyboard-operable — arrows move between
  controls in the visible view (skipped inside sliders/selects so native
  adjustment keeps working), Home/End jump, Escape steps back from settings
  and resumes from pause, view switches move focus to the first control,
  `role="dialog"` + per-view labels, `aria-pressed` on map cards,
  `aria-label`s on sliders/select, pause view gains a `<kbd data-glyph>`
  prompt hint. Boundary types narrowed (`MenuPlayer`/`MenuWorld`).
- **`src/ui/menus.css`**: explicit `:focus-visible` ring (gold, 2 px +
  offset) on every control; `kbd` cap styling incl. a distinct gamepad state.
- **`settings.ts`, `index.html`**: deliberately untouched. Settings needs no
  shape change (see wishes); the static `#start` fallback markup is wiped by
  `initMenus` at startup and the `#start`/`#hud`/`#crosshair` ids the harness
  strips are preserved exactly — no `capture.mjs` change needed.

No file outside `src/ui/` + this report was written. No commit/stash/reset,
no `npm install`, no killed processes.

## What I measured

- **Gate**: `tsc` clean; `vite build` OK; `traverse` **5/5 routes, 4/4
  house faces enterable, handedness PASS**; `capture -- --tag hud` exit 0,
  **zero page errors, zero console errors** (verified in `hud-summary.json`,
  not just the exit code).
- **Bundle**: JS 976,152 → 993,656 B (**+17.5 kB**, gate allows 250 kB —
  includes concurrent sibling weapons-lane changes in the same window, so my
  share is smaller); CSS 5,237 → 6,970 B (+1.7 kB).
- **DOM churn** (headless Chromium, 4 s idle, observer on `#hud`): **zero
  node insertions, zero text writes, zero attribute writes from HUD code**.
  The only mutations in the window were main.ts's debug readout swapping its
  own text nodes every stats tick (10 swaps, read-only file, not mine) — full
  swap accounting matched, nothing else moved.
- **Style/layout** (CDP `LayoutCount`/`RecalcStyleCount` over 3 s):
  **0 layouts, 0 recalcs, 0.000 ms** with the HUD visible *and* hidden — the
  HUD costs nothing measurable standing still.
- **Functional probe** (throwaway Playwright, since deleted): 17/20
  assertions passed — full keyboard path (arrows/Enter/Escape/focus),
  overlay dismiss via real Play click, 5 real fired rounds tracked in the HUD
  (`30 → 27 / 120`), reload flag via the 4 Hz poll, weapon name, score line,
  health 25 + low flag. The 3 failures were probe-timing artifacts, chased to
  ground, not code bugs: headless swiftshader presents at ~1 fps, so the
  first screenshot's frame production lands seconds after the call — past the
  350/900 ms auto-hide windows (bisect run proved show→hide lifetimes:
  hitmarker visible at t+0/gone by t+200, arc likewise, feed rows 2→2→0 at
  5.5 s exactly per the 5 s expiry) and a same-tick micro-probe proved every
  class removal, the π/2 arc angle, and the 5-row pool directly.
- **Reference frames opened and looked at**: `hud-yardOrange.png` (world
  renders; orange house/deck/stair/dome/sign all present),
  `hud-combat.png` (score line, LONGHORN+RELOADING, 27/120, red 25-health),
  `hud-game.png` (default HUD: minimap, 30/120, LONGHORN, 100-health,
  spread crosshair), `hud-menu-focus.png` + `hud-settings.png` (gold focus
  rings on Settings button and Sensitivity slider, settings layout correct).
  Note: at 1 fps the compositor serves screenshots 1+ steps stale, so exact
  screenshot↔step mapping drifted — every image is a real rendered state,
  just not always the step its filename names.

## Wishes / unresolved (for the orchestrator, not taken)

1. **Score/streak backend does not exist.** `setScore` works (proven) but
   nobody calls it; the line stays hidden. Scoreboard rows are placeholders.
2. **Duplicate ammo readout**: main.ts's `ammoDiv` debug line
   (`Longhorn 30 / 120 — reloading`, top-left) duplicates the HUD ammo block.
   I left it (read-only file); the orchestrator may want it gated behind the
   debug flag or removed.
3. **First-Tab stop**: main.ts's debug legend carries `tabindex=1`, so the
   first Tab from body lands there instead of on Play. Observed, not mine to
   fix; hurts keyboard-first impression.
4. **Sensitivity/quality hooks still absent** (`player.setSensitivity`,
   renderer quality tier) — settings persist, FOV applies, as before.
5. **Tab-scoreboard is keyboard-only** (`Tab` hold); no gamepad binding yet.
   The glyph table has a `pause` entry ready for when menus learn pads.
6. **Harness telemetry reads zero**: capture summary shows `triangles: 0`,
   `programs: 0` at every station, yet the live debug readout shows the real
   scene at **~317k tris / ~77–101 calls** (well under budget). The
   `stats()` read timing in `capture.mjs`/`main.ts` (info reset vs overlay
   render ordering) looks suspect — worth a look by the harness owner, since
   a gate reading zeros is a gate that can't catch regressions. Related:
   `renderer.info` call counts grow ~+6/frame in the live loop, suggesting
   `info.autoReset` is off somewhere.
7. **Mid-flight collision**: the sibling weapons lane refactored
   `controller.ts`/`effects.ts`/`catalog.ts` while I worked (Longhorn reserve
   90→120, `tracer`/`impact` signatures changed — `tsc` went red twice with
   errors in files I never touched, then green again once they finished). My
   placeholder/caches no longer hardcode their numbers, so this class of
   churn can't stale me again. Nothing of theirs needs reverting.
8. Headless runs at ~1 fps on swiftshader; all timing-sensitive assertions
   must be same-tick or lifetime-based there, never screenshot-timed — noted
   for anyone writing future UI probes.
