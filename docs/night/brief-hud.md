# Lane `hud` - HUD, menus and UI, imported in design and reskinned

Read `docs/night/_COMMON.md` first.

## The ask, in the owner's words

> "we can import from the project I asked you to reference, my original atomic acres and
> nuketown projects, the sort of UI and the HUD, and give it our own reskin and make it
> a little bit more efficient"

So: **the old project already solved this, and solved it in more detail than we will
reinvent in an afternoon.** Read it. Take the structure, the state machine, the
information architecture, the layout contracts and the lessons. Write our own code and
our own visual identity. Copy no file.

## Files you own

- `src/ui/hud.ts`, `src/ui/hud.css`
- `src/ui/menus.ts`, `src/ui/menus.css`
- `src/ui/settings.ts`, `src/ui/index.ts`
- `index.html` (the overlay markup only)
- You MAY add new files under `src/ui/`.

Read-only for you: everything under `src/build/`, `src/core/`, `src/weapons/`.
If you need the game to tell you something it currently does not expose, add the
**read** to your own file against what already exists on `window.__NT` / the exported
context, and list what you wish existed in your report. Do not edit those modules.

## Read before you write

In `C:/Users/david/Desktop/stuff/atomic-acres` (reference only, copy nothing):

- `UI-INVENTORY.md` - the catalogue of every screen the old project ended up needing.
- `C:/Users/david/Desktop/stuff/atomic-acres-ui-style-guide.md`
- `src/hud-layout.ts` and `src/hud-layout.test.ts` - a layout **contract** with tests.
  That pattern is worth keeping: the HUD had a spec its tests could check, so it could
  not silently drift.
- `src/hud-feed.ts` - the kill feed.
- `src/hud-motion-contract.test.ts` - what is allowed to animate, and how fast.
- `src/directional-hud.ts` - the damage-direction indicator.
- `src/killstreak-catalog.ts` - what the streak UI has to represent.
- `src/input/gamepad/hud-glyphs.ts` - the owner wants gamepads eventually; glyph
  handling is easier to get right at the start than to retrofit.

## What we need, in priority order

1. **A HUD that reads at a glance and costs nothing.** Health, ammo (magazine /
   reserve), the weapon name, a score/streak line, a compass or minimap stub, a hit
   marker, a damage-direction indicator, a kill feed. BO2's HUD is bottom-corner heavy,
   thin condensed type, mostly desaturated with one accent that flashes on events.
2. **Efficiency is an explicit requirement.** The predecessor project's HUD churned DOM
   every frame. Ours must not:
   - Build every node **once**; afterwards only ever write to `textContent` or a CSS
     custom property. No `innerHTML` in the frame loop, no node creation per frame.
   - Only touch the DOM when the value **changes**. Cache last-written values.
   - Drive all animation from CSS `transform` and `opacity` only - never `width`,
     `top`, `left` or `filter` in an animation.
   - `will-change` on the handful of elements that actually animate, nowhere else.
   - The kill feed is a fixed pool of rows, recycled. No append/remove churn.
3. **Menus.** A main menu, a pause menu, and a settings panel. BO2's shape: a dark
   full-bleed backdrop, a left-aligned vertical list, a thin accent rule, a title block
   top-left. It should be navigable entirely by keyboard, and every control must have a
   focus state you can actually see.
4. **Our own identity.** The name is **Atomic Acres** - a fan project, not a clone.
   No Activision or Treyarch marks, no Call of Duty logotype, no BO2 asset names.
   Take the *composition* from BO2 and the *palette* from our own `src/core/palette.ts`
   so the UI and the world agree with each other.
5. **The click-to-play overlay is load-bearing for the test harness.** It has ids
   `#start`, `#hud`, `#crosshair` and `scripts/capture.mjs` strips them before every
   shot. If you rename or restructure them, update `scripts/capture.mjs` in the same
   change - and say so loudly in your report, because that harness is how everyone
   else in this wave checks their work.
   Note the bug already paid for once: the click listener must be on the **overlay**,
   not the canvas, because the canvas sits behind it.

## Verify before you report

```
npx tsc --noEmit -p tsconfig.json
npm run build
npm run traverse
npm run capture -- --tag hud
```

Traverse must still pass 5/5 - if the overlay stops dismissing, every route fails and
you will know immediately.

Then measure the thing you were asked for. With the game running, record in your report:
- DOM nodes created per second while the HUD is updating (should be **zero**)
- style recalculations / layout per frame from a Performance trace, before and after
- bundle size before and after

And **open your captures and look at them**. A HUD that measures fast and looks wrong
is not done.
