# Task brief: HUD, MENUS, AND THE RENAME TO ATOMIC ACRES

Read `docs/SPARK-CONTEXT.md` first. It binds you.

## Files you own exclusively

- `src/ui/` (new directory)
- `index.html`
- `README.md`
- `docs/DEPLOY.md`

Do not touch `src/build/*`, `src/main.ts`, `src/weapons/*`, `src/core/*`,
`vite.config.ts`, `package.json` or `scripts/*`. Five other agents own those.

## 1. The rename — do this first, it is quick

The project is now **Atomic Acres**. It is a **fan project inspired by Call of Duty:
Black Ops 2**, starting close to BO2's Nuketown 2025 and diverging from there. The
GitHub repo has already been renamed and is live at
`https://daveinturkey15-byte.github.io/atomic-acres/`.

Update every user-visible string you own: the `<title>`, the overlay heading, the
README, DEPLOY.md. Keep the map's own name as **Nuketown 2025** — that is the map
inside the game, and the game is Atomic Acres.

Say clearly somewhere visible that it is an unofficial fan project and not affiliated
with Activision or Treyarch. One line is enough; do not make it shouty.

Do not rename the repo folder on disk and do not touch `package.json` — other agents
are working against those paths right now.

## 2. HUD

A Black Ops 2-flavoured in-game HUD, built as DOM/CSS over the canvas (cheap, sharp,
and it cannot cost draw calls). A weapons agent is concurrently building firing and
ammo in `src/weapons/`; **you do not own that**, so expose a clean API the game can
push state into — something like `initHud()` returning handles, or an event/store the
weapon code can call. Define it, document it at the top of your file, and state the
exact one-line wiring the orchestrator needs to add to `main.ts`. Assume nothing about
its internals and make the HUD render sensibly with placeholder values if nothing
pushes to it yet.

Elements, in priority order:
- **crosshair** — dynamic bloom that opens when moving/firing, tightens when still/ADS,
  hidden entirely while aiming down sight
- **ammo counter** — magazine / reserve, bottom right, with a low-ammo state
- **health / shield** — bottom left or a screen-edge damage vignette
- **hitmarker** — the small X flash on a hit; this is the single most satisfying piece
  of feedback in a shooter, get its timing right (very short, ~100 ms)
- **killfeed** — top right, stacked entries that age out
- **minimap** — top left. You have a real advantage here: the map layout lives in
  `src/core/layout.ts` and you can draw an accurate top-down schematic from those
  constants rather than guessing. Show the player's position and facing.
- **scoreboard** on a held key
- the existing debug line (fps/calls/tris/mode) should stay available but move to a
  toggle so it is not always on screen

Keep the aesthetic BO2-ish: thin sans type, tight tracking, high-contrast white on a
soft shadow, restrained use of an accent colour. Do not use the Call of Duty logo,
wordmark, or any Activision/Treyarch branding.

## 3. Menus

- **main menu** — game name, Play, Settings, a line naming it as a fan project
- **map select** — one entry for now, Nuketown 2025, with a thumbnail. Make it data-
  driven so more maps drop in later
- **settings** — mouse sensitivity, FOV, and a graphics quality toggle; persist to
  `localStorage` and wrap every access in try/catch (it throws in some privacy modes)
- **pause** on Esc

## Do not break the capture harness — read this carefully

`scripts/capture.mjs` removes `#start` and hides `#hud` and `#crosshair` before **every**
screenshot. If you rename or restructure those ids, every capture comes back showing
your UI while the renderer stats still look perfectly healthy, and that failure is
invisible in the logs. It has already happened twice on this project.

So: **keep the ids `start`, `hud` and `crosshair` working as the harness expects**, or
if you must restructure, give the harness a single deterministic way to hide all UI —
and since you do not own `scripts/capture.mjs`, that means keeping those ids. Also keep
the click-to-play overlay dismissable by a real click: its listener must be on the
overlay itself, because the overlay covers the canvas and a listener on the canvas
never fires. That bug shipped once and made the owner think the game was broken.

## Verify

```
npx tsc --noEmit -p tsconfig.json     # clean
npm run capture -- --tag hud          # 10 stations, ZERO page errors
```

**Open** `captures/hud-streetElevation.png` and `captures/hud-spawnA.png` with the Read
tool and confirm **no UI is visible in them** — that proves the harness can still hide
your work. Then load the page in a headless browser, click through, and screenshot the
menu and the in-game HUD, and **look at those too**. Report what you built, the exact
wiring line for `main.ts`, and anything unfinished.
