Read `docs/night/_COMMON.md` and `docs/SPARK-CONTEXT.md` first. They bind you.

# Night lane: HUDPOLISH - our own take on the BO2 HUD

## Files you own
`src/ui/`, `index.html`

Do not touch `src/main.ts`, `src/weapons/`, `src/game/`, `src/core/` or `src/build/`.

## Reference, for DESIGN only
`C:/Users/david/Desktop/stuff/atomic-acres/src/` has the owner's earlier HUD work:
`hud-layout.ts`, `hud-feed.ts`, `hud-chat-layout.ts`, `directional-hud.ts`,
`hud-motion-contract.ts`. Read for how the feed, layout and motion contract were
structured. **Write fresh. Do not copy files.**

Also read the real thing: the gameplay frames in `docs/reference/gameplay/` all carry
BO2's actual HUD - minimap with compass strip top-left, medal/streak popups top-centre,
score bottom-left, weapon and ammo bottom-right with the fire-mode label, equipment
icons in the corner, the hit-confirm and the "+100" score pops. **Open a dozen frames
and look at them** before restyling anything.

## What to do
The HUD exists and works. Make it feel like a shipped game rather than a debug layer:

- motion: everything should animate in and out, nothing should pop
- the hitmarker timing (very short, ~100 ms) and the damage vignette
- a score-pop system ("+100") rising and fading at the crosshair
- streak / medal banners top-centre - the killstreaks lane will push to these, so
  expose them in the HUD API and document the call
- the minimap: it is drawn from `layout.ts` constants; the circle is now CENTRAL so
  re-check the schematic still matches the map, and add the compass strip
- fire-mode and weapon-name label by the ammo counter
- a settings pass: sensitivity, FOV, quality - all persisted, every `localStorage`
  access wrapped in try/catch

Keep it our own style, not a copy: no Call of Duty logo, wordmark or Activision /
Treyarch branding.

## The harness constraint that has bitten twice
`scripts/capture.mjs` removes `#start` and hides `#hud` and `#crosshair` before EVERY
screenshot. If you rename or restructure those ids, every capture comes back showing
your UI while the renderer stats look perfectly healthy, and that failure is invisible
in the logs. Keep those ids working. Keep the click-to-play overlay dismissable by a
real click - its listener must be on the overlay itself, because the overlay covers
the canvas and a listener on the canvas never fires.

## Verify
`npm run build`, `npm run capture -- --tag hud2`. Open
`captures/hud2-streetElevation.png` and `captures/hud2-spawnA.png` and confirm **no UI
is visible in them** - that proves the harness can still hide your work. Then load the
page headlessly, click through, and screenshot the menu and the in-game HUD, and look
at those too.
