# Streak keys and menu parity — 27 September 2026

VERIFIED — source audit of the September17 restart and the owner-designated
historical predecessor, followed by a separately admitted native implementation.
No old modules, history or assets were copied. No browser/GPU/build/commit was
run in this lane. Source/UI CPU checks do not establish live-game acceptance.

## Exact inspected identities

VERIFIED — restart worktree
`C:/Users/david/Desktop/stuff/worktrees/nuketown-salvage-20260926`, branch
`salvage/full-game-20260926`, HEAD `2d3ef47bb4e917b5e804495cb57146d14ae49742`.
Root's concurrently edited main/menu/settings/input files were read-only here.
The owner preview remains separately pinned by the root handoff.

VERIFIED — `CURRENT.json.predecessor` routes reference reading to
`C:/Users/david/Desktop/stuff/atomic-acres`, repository
`daveinturkey15-byte/atomic-acres-browser-arena`. Actual current reference branch
is `contrib/dave-gaming-pc/codex/world-studio-20260912`, HEAD
`d15e9d859a663dc982018e3dc6642d69d95c6ffe`, with clean status when inspected.
This differs from the September26 asset inventory's `950d84b` reference hash;
neither old identity selects the active restart or proves the owner's old live
browser build. No historical source was changed.

## Actual old key contract

VERIFIED — `src/key-bindings.ts:81–87`, `src/killstreak-catalog.ts:298–303`
and `src/killstreak-loadout.ts:11–14` jointly define:

| Default key | Chosen slot | Old allowed rewards | Old default |
|---|---:|---|---|
| 3 | 1 | Scout Sweep, Adrenaline Boost, Care Package | Care Package |
| 4 | 2 | Yardhawk, Piloted Drone | Piloted Drone |
| 5 | 3 | Tri-Pass Strike, Carpet Bomber, Hunter Swarm, Chopper Gunner | Carpet Bomber |
| 6 | 4 | Same heavy family; must differ from slot3 | Chopper Gunner |
| 7 | 5 | Nuke or Drone Swarm | Drone Swarm |

VERIFIED — these are five configurable `support-1` through `support-5` actions,
not assumed BO2 defaults. Old `legacy-main.ts:29634–29688` resolves the stored
key profile and routes presses through the same activation/toggle admission
path. Refused dead/warmup/input-disabled presses have feedback. A live owned
Piloted Drone or Chopper can be entered/released with its slot key, without
spending another charge (`24693–24748`).

VERIFIED — the old crate reward temporarily substitutes the first chosen slot
and its displayed name: `legacy-main.ts:24403–24421` and `26635–26648`. It is
not the old meaning of key7. The new pass deliberately preserves all five
chosen keys and assigns its separate unslotted bonus row to8 instead; this
bonus behavior is an explicit integration decision, not literal old parity.

## Menu behavior and initial restart gaps

VERIFIED — old `ui/killstreak-loadout-menu.ts` provides a dedicated Killstreaks
tab with five slot cards, visible reward buttons/icons, key/cost labels,
plain-language effect descriptions, duration, selected state and Use Defaults.
Picking the sibling heavy slot's current reward swaps slots3/4 and reports the
swap (`killstreak-loadout.ts:98–115`). Controls and the underlying controller
freeze during an active match. Saved persistence is read back before acceptance.
These are source observations; no old UI pixel capture was made.

VERIFIED — before this change, restart `catalog.ts` exposed only four chosen
slots (`low,low,mid,high`), allowing top rewards in the final heavy slot.
Its default was Recon Sweep, Signal Jam, Sentry Post, Blast Mortar. Keys3–6
selected those four; key7 was a conditional crate reward. The old five-choice
default was impossible to configure. The restart menu used tier dropdowns
without a defaults button, descriptions or heavy-slot swapping. Its binding
table contained no streak actions; root owns that separate input integration.

OPEN — selecting similarly named rewards does not establish complete old
mechanic parity. Source differences include old Scout12s versus new Recon30s;
Care Package4kills versus Supply Crate5kills; old Tri-Pass aircraft/targeting
versus native Strike Relay ground bursts; old Chopper possession versus native
automatic support; old drone counts5/24 versus native3/5; old map corridor
selection versus native facing/position placement. Piloted Drone initially
starts controlled in the restart, whereas old activation first spawns support
and another press enters it. This menu/slot change does not silently rewrite
those mechanics or copy the old menu's claims into descriptions.

## Native five-slot implementation

VERIFIED — exclusively changed `src/game/killstreaks/catalog.ts`,
`src/ui/streak-loadout-panel.ts`, `src/ui/streak-presentation.ts` and new
`src/ui/streak-descriptions.ts`. Five chosen families are now
`low,mid,high,high,top`. Supply Crate moves into low; its existing cost remains5.
All16 native selectable behaviors remain reachable. High slots cannot contain
top rewards; they remain distinct. The defaults are
`supply-crate,piloted-drone,carpet-bomber,chopper,drone-swarm`.
Reward-pool weights, exact10%/10%/1% shares, exclusions and crate nonrecursion
were preserved.

VERIFIED — the panel adds native behavior descriptions, Use Defaults, heavy
duplicate-pick swapping, explicit saved/session-only feedback and
`setEditable(boolean)`. Both change/default handlers reject disabled state,
including a disabled ancestor fieldset. The existing dropdown layout remains;
the old game's full icon-card/tab layout is not claimed reproduced here.

VERIFIED — storage uses `nuketown2025.streak-loadout.v2`, version2. The original
`nuketown2025.streak-loadout.v1` record is read-only and never overwritten.
`migrateLegacyStreakLoadout(value)` is pure: validates the historical four-slot
record, visits new families in order, keeps compatible IDs in old selection
order, avoids duplicates/exclusions, then fills missing families from defaults
and valid native alternatives. Old default migration becomes
`recon-sweep,sentry-post,blast-mortar,chopper,drone-swarm`.
When the old two low choices cannot both fit, the first compatible one wins;
the original record remains intact. Invalid legacy records fall back to native
defaults. Validv2 takes precedence. Read never writes. Returned stores carry
`legacyRetained:boolean` and `migratedFrom:1|null`; save validates and performs
readback when the provided storage supports it.

VERIFIED — shared `STREAK_SLOT_CODES` is Digit3 through Digit8: five chosen
keys plus a conditional sixth bonus row. `projectStreakStrip(slots,kills,codes)`
accepts optional rebound key codes and uses them for visible caps, activation
hints and assistive text. Root owns main/settings/HUD/protocol and pilot
integration; no sixth chosen class or earned charge is fabricated by the panel.

## Checks and explicit contract supersession

VERIFIED — `node scripts/_verify-openpass-streak-parity.mjs` passes12 groups:
family/default/pool constraints; illegal choices; immutable heavy swap; exact
legacy preservation; all360 legal legacy combinations; malformed/v2 precedence;
invalid writes and silent storage refusal; actual panel handlers/descriptions/
defaults; disabled controls/fieldset; storage-refused session selection; five
chosen versus bonus6; rebound visible/assistive keys. No browser was started.
`node node_modules/typescript/bin/tsc --noEmit` passes.

VERIFIED — initial typecheck found two generic-ID description lookup errors.
The localized correction adds a bounded lookup helper; no test was weakened.
The fresh CPU assertions passed both before and after that type correction.

VERIFIED — the unchanged older `scripts/_verify-astra-playflow-20260926.mjs`
now fails at line105: `all four gameplay slots are offered`, actual5 versus
expected4. This is retained as an explicit superseded four-slot contract, not
reported green, removed or loosened. Other old helpers embedding four-element
loadouts require independently reviewed contract adapters; this lane did not
edit them. The independently owned new runtime/wire/resume proof is separate.

OPEN — actual five-slot menu/deploy, rebound inputs, ready/use/spent behavior,
bonus6, pilot exit/resume, multiplayer lifecycle and visual fit must pass the
root's frozen built-artifact checks before promotion. The source-only change
does not update the accepted owner preview or establish complete old-game
feature/art parity.

## Source pins

VERIFIED — final native runtime/UI source SHA256s:

| File | SHA256 |
|---|---|
| `src/game/killstreaks/catalog.ts` | `d73bfecfb270d81d432776fb424f55522e6f4f51af02bef60bffaca3b8e5bf1b` |
| `src/ui/streak-loadout-panel.ts` | `6f03ef971867424fbc6005e85b94faaa7e4b366e499a389592c956e5c4d02ed6` |
| `src/ui/streak-presentation.ts` | `29786c78fa1597a340cf0745724f0b548c0dae113be230da23bdc728b8758550` |
| `src/ui/streak-descriptions.ts` | `fdcd7cb820cf3bdc89b1a35c97c3549e6a7bc71b7c2d8b5d3e388b10f0ac74c2` |

VERIFIED — inspected old-reference source SHA256s (no imports/copies):

| File | SHA256 |
|---|---|
| `src/key-bindings.ts` | `75c0b30d71b5280d9e0608cb64a7319440cf4731603fd458f02104e07578459f` |
| `src/killstreak-catalog.ts` | `e29f86d02c713096b32e58e6f0fc8a211399c18df10d3e6f86e7a292c8258bfd` |
| `src/killstreak-loadout.ts` | `77e8c05e7d932fa0e84e1744d0c2414358406686ab3729260f127ab050451dd2` |
| `src/ui/killstreak-loadout-menu.ts` | `34a046c40e89a9779151a64124d6cda0cb6e2c7b3d24cc9bc9e2a46dc176613e` |
| `src/legacy-main.ts` | `39efc83c22152c33ed76e04b7393f0157895625064893659e3e359a920934e76` |


## Root integration supersession

VERIFIED: root integrated and committed5cc3a26. The initial lane panel hash above is retained historical evidence; root subsequently wired configured key labels through menus/solo to the panel, matching the HUD and pilot after rebinding. Final panel SHA2561f75654fa9ebbd1f29342007acde27e431adaf7ae9a084b03b01790d7af1ec58. Legacy valid movement mappings on3–8 now receive collision-free new streak fallbacks without changing owner movement keys; a separately preserved negative and7-group actual shim/pilot/HUD closure prove that repair. Admission revision2 fences old four-slot peers in both directions. Root final parity12 and integrated streak6 checks pass. Old menu icons/visual layout and the mechanics differences above remain OPEN; no literal whole-old-game parity or current game-pixel acceptance is claimed.
