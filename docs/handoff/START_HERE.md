# Nuketown 2025 — handoff

**Project:** from-scratch, code-only Three.js recreation of Black Ops 2 `Nuketown 2025`.
**Started:** 2026-09-17, dave-gaming-pc, Claude Code (Opus 5).
**Root:** `C:/Users/david/Desktop/stuff/nuketown`
**Lane ownership:** single writer. There are no worktrees and no lanes yet. If you add
one, register it under `<workspace>/worktrees/nuketown-<lane>` per the workspace AGENTS.md.

## Why this exists

Atomic Acres' Nuke Town rebuild was abandoned on 2026-09-17 after repeated passes that
went green on counts while the map itself did not hold up. The owner's decision was to
start a new project and use the old one **for reference only** — no assets, no modules,
no build scripts carried across. Measurements and lessons may be recovered; bytes may not.

## Read first

1. `AGENTS.md` — the module contract and the failure modes this repo designs against.
2. `docs/SPEC.md` — the build spec, the plan diagram, and section 3, which records what
   was actually seen in each BO2-2025 reference frame with OPEN items marked.
3. `src/core/layout.ts` — every dimension. Nothing else may hardcode one.

## State

| Thing | State |
|---|---|
| Core (layout, palette, materials, world, player, stations, kit) | done, typechecks clean |
| Feature modules | 9: ground, orange-house, white-house, third-house, vehicles, yards, skyline, plaza, mannequins |
| Capture harness | `npm run capture` - 10 stations, fails on page errors, strips the overlay before every shot |
| Traversability harness | `npm run traverse` - 5/5 routes, 4/4 house faces enterable, verge scan |
| Budgets | worst station ~326 draw calls / 112k tris against 1200 / 900k |
| Reference images | **not committed.** CDN is behind a bot check - fetch with a real browser, not curl. URLs in the old project's `docs/references/nuketown-2025/manifest.json` |

## Bugs found by looking at frames, that the numbers passed

Worth knowing, because each one produced a perfectly healthy-looking stat line:

- no environment map, so every `metalness > 0.7` surface rendered near-black
- the animation loop re-synced the camera each frame, so all ten capture stations
  silently photographed the spawn view (identical stats everywhere was the tell)
- every screenshot was the click-to-play overlay; a vite HMR reload restores it
  mid-run, so the harness now strips it before **every** shot
- player movement was mirrored in x against the camera: correct at yaw 0 and PI,
  exactly backwards at +/-PI/2
- both spawn yaws were inverted, so each team faced its own back fence
- the house interiors had a **lawn** floor - ground.ts laid its house band in grass
  and neither house drew a floor of its own
- three camera stations were aimed at the wrong building

## The one invariant

From either back yard, facing your own house, the garage is on your **RIGHT**. The two
houses are a 180° rotational pair, not a mirror pair. `layout.ts` derives this in
`garageIsOnTheRight()`; nothing else may hardcode the sign.

## How to verify anything

```bash
npm run check      # tsc
npm run capture    # headless captures of every station, fails on page errors
```

Then **open the frames and look at them**. A capture nobody opened is not evidence, and
a station whose `ref` is `null` in `src/core/stations.ts` is a diagnostic view — it may
never be used to claim the map looks right. Each fidelity station names the BO2-2025
frame it is to be compared against.

## Not done / next

- No weapons, no multiplayer, no HUD beyond a debug line. This is the map.
- Interiors are open shells; no furniture.
- OPEN reference items (front ledge, mailboxes, exact head inset, calibrated hex) are
  listed at the end of `docs/SPEC.md` section 3 with the falsifier for each.
