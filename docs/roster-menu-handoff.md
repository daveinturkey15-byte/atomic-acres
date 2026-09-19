# Roster → menu handoff: compact primary-weapon selection + solo overflow fix

20-minute source-only slice (Muse Spark, xhigh). No browser/GPU/servers/builds run here.
Root integrates; root runs DOM/browser acceptance. HUD and gameplay untouched; no
module copies from the old project; no new framework or npm script.

## Exact files (this worktree only)

- `src/ui/loadout-panel.ts` — primary-weapon control + `selectPrimary` + live stats.
- `src/ui/menus.css` — `.aa-prim*` styles, focus ring, solo overflow child fix.
- `scripts/ui/verify-primary-selection.mjs` — NEW CPU verifier (node, esbuild+bundles
  local sources, minimal DOM stub; same pattern as `verify-loadout-store.mjs`).
- `docs/roster-menu-handoff.md` — this file.

Patch basis: local `loadout-panel.ts`/`menus.css` matched the root baselines read at
slice start, so the diff should apply to root cleanly — root must still confirm with
`git apply --check`. Local `src/game/loadout.ts` is OLDER (single sidearm, no gating);
nothing outside the four files above was touched. No baselines needed under
`docs/patches`: the panel only imports `PRIMARY_IDS`/`SIDEARM_IDS` from
`game/loadout.ts`, which root already exports.

## Behaviour

- Primary grid sits between kit cards and the tactical group: `role="group"`,
  `aria-label="Primary weapon"`, one real `<button class="aa-prim">` per
  `PRIMARY_IDS` id with `aria-pressed`, catalog name + `weaponLine` stat line.
  No second weapons table; gated prototypes and sidearms are absent because they
  are absent from `PRIMARY_IDS` — gate reasons (controller internals) never reach
  the UI, and the UI claims no asset counts.
- `selectPrimary(id)` mirrors `selectTactical`: unknown/non-`PRIMARY_IDS`/sidearm
  ids are refused with a note and zero writes; from a kit it preserves
  `resolveLoadout(store).grenade` and reuses the slot holding the exact
  (primary, grenade) pair, else the first free slot, else refuses without writing
  (`All custom slots hold authored loadouts and none matches this weapon — clear
  a slot first.`); from a custom slot it swaps the primary in place, keeping the
  grenade and slot. Kit cards, tactical buttons and the deploy line are unchanged
  derivations; `refresh()` additionally tracks `aa-selected` on the resolved
  primary and updates `.aa-prim-stats` (`<dmg> dmg · <rpm> rpm · <mag> rd mag ·
  <near>–<far> m`, all catalog fields).

## Solo mobile overflow (2px)

`captures/menu-hud-2132/solo-mobile-overflow.json`: `.aa-root` scrolls 377 vs a
375 client while `.aa-loadout`/`.aa-loadline` measure exact — the over-wide child
is elsewhere in the solo column. `solo-mobile-deploy.png` shows the resulting
horizontal scrollbar. Fix is child-side, no `overflow-x: hidden` anywhere:

- `#start .aa-solo .aa-setting { box-sizing: border-box; min-width: 0; max-width: 100%; }`
- `#start .aa-setting-row > * { min-width: 0; }` (lets the `1fr` track shrink)
- `#start .aa-select { box-sizing: border-box; max-width: 100%; }`
- `#start .aa-setting input[type="range"] { box-sizing: border-box; }`

New `.aa-prim` buttons are born fixed (`box-sizing: border-box; min-width: 0`).

## Verification done here

- `node scripts/ui/verify-primary-selection.mjs` — GREEN (derivation exactness,
  tactical retention, in-place custom update, all-full refusal with zero writes
  and standing selection, retired-id sanitization via real `loadLoadout`, kit
  regression). Local catalog offers 4 primaries; assertions are structural, so
  the same script checks the 13-primary root roster without edits.
- `node scripts/ui/verify-loadout-store.mjs` (pre-existing) — GREEN, kit/tactical
  contract intact.

## OPEN acceptance (root, real browser)

1. `npm run check` at root (local `src/weapons/roster.ts` does not exist here,
   and builds were out of scope for this slice).
2. Re-run the `menu-hud-2132` mobile probe at 390px: `.aa-root` scrollWidth must
   equal clientWidth; eyeball `solo-mobile-deploy.png` (no h-scroll bar).
3. Eyeball solo desktop + mobile frames: primary grid pressed state, deploy line,
   live stat line after a primary switch; keyboard tab reaches every `.aa-prim`.
4. `playcap` untouched render path — optional; this slice adds no render code.
