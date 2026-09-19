# Menu composition — handoff (muse-menu-composition-0018)

Exclusive lane `nuketown-menu-hud-20260919`. Prior GLM writer ended 22:06; its
dirty partials (13-primary selector in `loadout-panel.ts`, loadout embedded in
`solo-setup.ts`, `menus.css` primary cards) are preserved verbatim — this patch
only composes them. Root `nuketown-recovery-20260919` at `5fd4058` was read
only; the three patched paths were byte-identical there before this work.

## What root saw

`captures/roster-menu-2259/solo-1600.png`, `solo-390.png`: four tall kit cards,
thirteen primary text cards, the tactical row, and
`DEPLOYING · MP5 · SEMTEX — MP5 · DUSTER · SEMTEX` — the auto-mirrored custom
name AND the resolved pair — all stacked above the setup rows, so Deploy sat
offscreen even at 900 px high.

## Changes (3 UI paths + 1 harness source, nothing else)

- `src/ui/loadout-panel.ts` — `refresh()` only: a custom slot whose stored name
  is exactly what `selectTactical` (`<kit title> · <tac>`) or `selectPrimary`
  (`<weapon> · <tac>`) auto-generates, 24-char slice included, now reads
  `Custom` in the deploy line. One pair out: `Deploying · Custom — MP5 ·
  Duster · Semtex`. Genuinely authored names (`Hold A · Smoke`) print verbatim.
  No store write, no grenade/damage semantic touched; Semtex stays a tactical
  choice with the same slot rules and refusal notes.
- `src/ui/solo-setup.ts` — same controls, new parents: title, then
  `.aa-solo-cols` holding `.aa-solo-loadout` (the loadout section) and
  `.aa-solo-setup` (Mode/Bots/Difficulty/Kill/Time/Friendly/Respawn/Team),
  then the Deploy/Back row full-width. `setMode('rules')` (bots hidden, Back
  to lobby), persistence, and `onChange`/`onDeploy` wiring are untouched.
- `src/ui/menus.css` — appended composition block under the existing `#start`
  namespace: unselected kit cards collapse to role/title/weapon/tactical with
  the summary clamped to 2 lines; summary + trait bars open contextually on
  `.aa-selected` or `:focus-visible` (full text always in `title`);
  primary grid tightened (`minmax(96px,1fr)`, 6 px gaps/padding); solo view
  widens to 1120 px and splits 7fr/5fr at ≥1024 px, single column below;
  every new track carries `box-sizing + min-width: 0 + max-width: 100%` so the
  older 2 px overflow fix holds — no `overflow-x` clipping anywhere.
- `scripts/ui/verify-menu-composition.mjs` (new, source only — root runs it):
  solo at 390/1280/1600 with `scrollWidth <= clientWidth + 1` and every
  loadout/setup child inside the viewport; Deploy visible without scrolling at
  1600x900; real MP5 + Semtex click → single-pair line → reload persistence →
  Deploy → active HUD; keyboard focus ring check. Same `stockBrowser`
  launcher and `RECOVERY_URL`/`QA_TAG` convention as
  `scripts/ui/verify-menu-hud-live.mjs`.

## Contracts preserved

13 primary / 3 sidearm / 4 grenade ids are never listed here — everything
derives from `PRIMARY_IDS`, `TACTICAL_IDS`, `LETHAL_IDS`, `FIELD_KITS` and the
catalog/ordnance tables at render time (the lane catalog is smaller; root's 13
flow through the same code). Custom-slot refusal writes zero bytes with the
same notes; damage/rpm/mag/range-band lines are the same derived strings;
all menu controls stay real focusable buttons; multiplayer/lobby paths
untouched. No external frameworks, images, fonts, or large assets.

## QA evidence (lane)

- `node scripts/ui/verify-loadout-store.mjs` — all assertions passed (10
  groups, unmodified); deploy line now `Deploying · Custom — Longhorn ·
  Duster · Semtex`.
- `node scripts/ui/verify-primary-selection.mjs` — all assertions passed.
- `npx tsc --noEmit` — exit 0.
- `node --check scripts/ui/verify-menu-composition.mjs` — OK (browser run is
  root's; no browser/server/build/push/delegation from this lane).

## Apply at root

`git apply work/menu-composition.integration.patch` (paths `a/src/ui/…`,
`b/src/ui/…` against root `5fd4058`), then run the new harness against the
candidate preview and look at `solo-390/1280/1600.png` beside the roster
captures. Author rationale is not a pass — acceptance is root looking at
actual pixels.
