Read `docs/night/_COMMON.md` and `docs/SPARK-CONTEXT.md` first. They bind you.

# Night lane: KILLSTREAKS - our own take

## Files you own
`src/game/` (new directory), `src/main.ts`

Do not touch `src/build/*`, `src/ui/*`, `src/weapons/*` or `src/core/*`.

## Reference, for DESIGN only
`C:/Users/david/Desktop/stuff/atomic-acres/src/` is the owner's much larger earlier
project. It has real working killstreak code - `killstreak-activation-gate.ts`,
`killstreak-awareness.ts`, `killstreak-blockers.ts`, `host-killstreak-loadout-ack.ts`,
`care-package-weapon-reward.ts`. Read them for HOW the activation gate, awareness and
blockers were structured. **Read for approach. Write fresh here. Do not copy files.**
That project was abandoned partly over asset-implementation problems and this repo
exists to not repeat them.

## What to build
A killstreak system that is OUR OWN TAKE - inspired by BO2, not a clone, with our own
names. There is no scoring or bots yet, so build the SYSTEM and drive it from a debug
trigger you expose on `window.__NT`:

- a streak counter and an award ladder (3 / 5 / 7 style)
- 2-3 streaks that visibly do something in the map: a recon sweep that pings the
  minimap, a supply drop that physically lands, a strike run that flies over and
  leaves effects
- an activation gate: can it fire here and now, and what blocks it
- HUD hooks - the ui lane exposes a HUD API and `main.ts` already holds the handle
  from `initUI`. Push streak state into it; do NOT edit `src/ui/`.

## The constraints that killed the last project
- **Never construct a `THREE.Material` at runtime or per state change.** One bug there
  recompiled materials three times per toggle and froze the game.
- **Never add, remove or hide a light at runtime** - that invalidated every shader
  program in that project.
- Watch `window.__NT.stats().programs`; it must not climb while a streak plays.

## Verify
`npm run build`, then `npm run traverse` (must hold) and `npm run capture -- --tag ks`.
Drive each streak headlessly via your debug hook; confirm zero page errors and no
program-count growth over 60 seconds. Open a capture of a streak actually happening
and describe what you see.
