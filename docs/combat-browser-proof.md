# Combat feedback — actual-game browser proof (2026-09-19)

Owner: Muse Spark 1.3 Contributor (xhigh), bounded 15-minute test-authoring
lane in `worktrees/nuketown-combat-feedback-20260919`. Sole-owner files:
`scripts/game/verify-combat-feedback-live.mjs` (this proof) and this doc.
No game source, no existing gate, no other worktree changed. No browser, GPU,
or server was launched in this worker; root alone runs browser acceptance.
No commit.

## Status

Source/CPU proof already passed (13 leaf + 7 adapter groups, lane handoff
`docs/combat-integration-handoff.md`). **Actual browser proof is what this
verifier authorizes.** Repair1 fixed seven deterministic harness failures
from root review (failed original retained at
`work/verify-combat-feedback-live.reviewed1.mjs`). Root ran repair1 as
`cfb-root-r1-1789839874027` and it FAILED deterministically: backend
`canvas:null` while WebGPU was live, six solo pulls with zero admitted
damage, then a 15 s Multiplayer click timeout with `errors={}` and no
screenshot. **Repair2 (this revision) fixes those five root failures; no
scenario added, none removed, none weakened.** Worker validation was
`node --check` + diff inspection only — no browser, GPU, or server was
launched in this worker, and no test is claimed to pass.

 ## Exact root run command

 ```bash
 AA_PREVIEW_PORT=4192 node scripts/game/verify-combat-feedback-live.mjs \
   --url http://127.0.0.1:4192/ --dist dist-next --signal-port 4310 --tag cfb-live
 ```

`--url` also accepts `NT_URL`/`CANDIDATE_URL` env and `--signal-url`;
`--dist` also accepts `NT_DIST` env (default `dist-next`: 4192 serves root
`dist-next`, never `dist`). Any URL containing `4188` aborts (never the old
default). Identity proof is SHA256, not length: loaded bundle name must
equal the `dist-next` asset name, the live-served JS digest (fetched over
HTTP like a player loads it) must equal the on-disk digest, and the
`dist-next/assets` mtime must be stable across the run. Output:
`captures/cfb-live/<tag>-result.json` plus `<tag>-solo-hit.png`,
`<tag>-host-fires.png`, `<tag>-guest-fires.png` (and `<tag>-exception-?.png`
plus per-peer authoritative snapshots when the run dies by exception).
Exit non-zero on any FAIL **or OPEN** — a missing actual scenario never
slides into green.

## Repair2 — what root r1 proved broken, and the fix

1. **Canvas.** `__NT_BACKEND.actual` and `__NTPOST.backend` were already
   `webgpu`; `querySelector('canvas')` selected the UI overlay canvas, which
   has no dataset. The verifier now selects `canvas[data-nt-backend]` (set
   by `src/core/renderer.ts`) and keeps the backend/post assertion.
2. **Settle-then-aim-then-fire.** r1 teleported and fired in one evaluate:
   the camera updates synchronously but the authoritative host pose/input
   needs a frame/tick, so six pulls left with a stale origin against a
   fresh direction and zero admitted damage. Now: teleport → 400 ms settle
   (the `_verify-net-refinement.mjs` pattern) → `aimAt` the exact live body
   (position static, angles only) → 150 ms tick gap → `pullTrigger`. LOS is
   eye-height both ends (`EYE_HEIGHT` 1.68, `host-life.ts` occupant rule);
   chest aims +1.0 m over feet (body band `LIMB_Y` 0.9–`HEAD_Y` 1.55),
   head aims +1.65 m (inside the head band, `host-shot.ts`). Every pull
   records claim/admission diagnostics from live surfaces only:
   `weaponCmd('state')` (mag/cool/reloading/shotsFired — trigger refusal),
   `counters().shotRejects` plus `__NTGAME.log()` `shot-reject` lines
   (host refusal with reason), victim HP/`protectedUntil`/life, LOS at
   fire time; dry mags refill through the real QA surface `soak.mjs` uses.
3. **Menu return.** `__NTGAME.leave()` tears down to idle without a menu
   transition (`menus.ts` only returns to a panel on its own
   return-pre-match path), so the same cache-busted URL reshows Multiplayer
   attached but invisible. The multiplayer legs now load a FRESH qa tag
   (real reload back at a visible Main) and `openMultiplayer` waits for a
   VISIBLE Multiplayer button before the first click.
4. **Identity.** Byte-length equality is replaced by SHA256 of the HTTP
   bytes vs the disk bytes; name and mtime checks retained.
5. **Exception evidence.** The catch now captures console/page errors, one
   failure screenshot per live peer, and each peer's authoritative
   phase/mode/counters/actors before the `finally` closes both Chromes.
   Budget and cleanup unchanged (≤150 s overall).

## Helper reuse (explicit)

- `scripts/lib/stock-browser.mjs` — **reused in place, NOT copied.** The lane
  copy already exists and is functionally identical to
  `nuketown-recovery-20260919/scripts/lib/stock-browser.mjs` (same 44-line
  helper; sha differs by CRLF/LF-only, diff shows no content change: fresh
  temp profile per peer, free CDP port, owned process-tree cleanup). No
  duplicate was introduced; the import is `../lib/stock-browser.mjs`.
- Patterns from root `scripts/_verify-net-refinement.mjs`: two stock Chromes
  (real WebRTC, never BroadcastChannel/Dave's profile), real Multiplayer UI
  (Multiplayer → lan → signal server → callsign → Host a room → code →
  Join by code → Ready → Start match), real `__NT.weaponCmd('fire')`,
  `__NTGAME.snapshot()/counters()/bots()/los()`, `__NT.probePos/teleport/
  collidersAt`, readiness waits (`__NT.ready && __AA_UI && __NTGAME`).
 | id | actual behavior | independent evidence | presentation assertion |
 |---|---|---|---|
 | S1 solo | real Play solo → Deploy into a controlled supported setup (1 recruit bot, all-hostile TDM via the player's own `atomic-acres-solo-setup` key — same key root `_verify-lobby-screens.mjs` uses); spaced chest-aimed `fire` at the pinned hostile bot from a LOS-checked spot | that victim's HP immediately before vs after ONE pull drops; global `damage` counter reported as diagnostic only (it counts the whole match, not the shot) | ≥1 popup, value finite 1–100, `translate()` placed, no `cfb-anchored`; equals the HP step when that pull's window holds exactly 1 new popup |
 | S2 host→guest | host `fire` at the pinned live guest id (victim's own `localId` cross-checked against the non-bot stranger the shooter sees; aim carries that exact id, never nearest-body) | guest HP drops across the pull | shooter-only popup on host; **zero** new popups on guest (incoming fire is nonlocal to the victim) |
 | S3 guest→host | mirror of S2 | host HP drops across the pull | mirror of S2 |
 | S4 styles | SEPARATE phases per leg: body phase (chest pulls to first HP step), then bounded respawn wait + reposition, then head phase (head pulls to crit/kill) | body: alive HP>0 after; head: `cfb-crit` in-window; fatal: alive→dead + `kills`+1 | body default (no crit/lethal while alive); `cfb-crit` only from a head-aimed window else OPEN; `cfb-lethal` asserted **only** when a real kill happened, else OPEN (host leg; mirror leg reports without asserting) |
 | S5 leave | a FRESH popup asserted visible immediately before `__NTGAME.leave()` (count>0 and age<900 ms), then `leave()` and a 250 ms read | `mode()` idle | `.cfb-num` count 0 via the reset path AND the pre-leave age proves it cleared before natural expiry |
 | S6 nonlocal silence | victim idles while being shot | victim HP drops | victim observer gains zero records |
| always | backend / build / pool / errors / frames | `__NT_BACKEND` (`{requested, actual}` per `src/core/renderer.ts`) + `canvas[data-nt-backend]` + `__NTPOST`, `dist-next` vs loaded bundle name + live SHA256, `.cfb-layer` sweep | WebGPU everywhere, bundle name + digest match + stable mtime, ≤24 actives, zero console/page errors, screenshots (plus per-peer exception captures on failure) |

Synthetic damage messages and rendered fixture numbers are never injected;
no claim about fixtures is made. The 900 ms lifetime is never extended: a
bounded (200-record) MutationObserver plus synchronous `.cfb-layer` sweeps
retain popups for assertion.

## Evidence alternatives (no guessed property names)

- **Admitted zone is host-internal.** `DamageEvent.zone` crosses only the
  `ui.onEvent` tap (`session-solo.ts:route`, `match-guest.ts:record`); no
  public snapshot/counter exposes it, so the verifier never invents a field.
  Body style is asserted from a chest-aimed admitted hit with HP evidence;
  crit is reported only when `cfb-crit` actually renders in a head-aimed
  window, otherwise OPEN. Amount-as-zone-evidence (1.5× head) is not claimed
  because range/weapon falloff is uncontrolled in a live fight.
 - **Numeric comparison.** Popup value vs that victim's HP step across ONE
   pull, timing fenced: 300–450 ms shot spacing stays above `CFB_MERGE_MS`
   140 (separate numbers) and far below `REGEN_DELAY_MS` 5000 (no regen
   inside the window). There is no armor system; spawn protection surfaces
   as "no HP change" and retries. Equality is claimed only when the pull's
   window holds exactly one new shooter popup; otherwise the popup, the HP
   delta, and the window count are all reported and the step stays OPEN.
   The global `damage` counter is diagnostic only — it counts the whole
   match, not the shot. A kill racing respawn (`RESPAWN_MS` 2200) is read
   promptly; the lethal class is the kill's proof, not the HP readout.
 - **`bots()` covers remote humans.** `BotBody` is the draw record for bots
   AND remote players (`session-types.ts`, solo seats + guest interpolated
   track); victim anchors and firing solutions read the same live list the
   renderer does. `BotBody` carries NO team, so hostility is joined inside
   the page: `snapshot().actors` (id/team/bot/alive + `localId`, mode for
   FFA vs TDM) selects hostile ids, `bots()` supplies their positions.
   Solo pins one hostile bot id through aim; the duel pins the cross-checked
   remote-human id (`!bot && id !== localId` on both ends) and never aims at
   a nearby bot. A stray ray may still be intercepted mid-flight — that
   reads as "no HP change" and retries inside the bound, never as proof.

 ## Limits

 ≤150 s overall including launches and readiness: `left()` caps every leg,
 every `waitForFunction` (via `wf()`), every `page.goto`/`ready`, and every
 menu click/fill/check (via `T()`); `waitUntil` was already capped. Two
 owned Chromes, each closed in `finally` even if the second launch or setup
 throws. Headless `chrome.exe` stock build via CDP (WebGPU-capable), no
 bundled-Chromium flags. Worker validation was `node --check` + diff
 inspection only — the browser run is root's.
 Worker did not launch a browser, GPU, or server.

 ## Source paths read

`src/ui/combat-feedback.ts` (`CFB_POOL_MAX` 24, `CFB_LIFETIME_MS` 900,
`CFB_MERGE_MS` 140), `src/ui/combat-feedback-adapter.ts` (dead-record
placement, `bots()` lookup), `src/ui/combat-feedback.css` (`cfb-crit /
cfb-lethal / cfb-anchored`), `src/game/events.ts` (`DamageEvent`),
`src/game/session-types.ts` (`BotBody` without team, `SessionActor` with
team/bot, `MatchUi.onEvent/resetPresentation`), `src/game/session-solo.ts`
(solo seats in `bots()`, real `Play solo → Deploy` route, `HostSnapshot`
passthrough) + `src/game/host.ts` (snapshot rows carry `life`,
`protectedUntil`, `respawnAt`; `shot-rejected` emission) +
`src/net/match-guest.ts` (guest `bots()`/`snapshot()`, the tap),
`src/game/session-log.ts` (`tally.damage/kills/shotRejects` + `shot-reject`
log lines — diagnostic only), `src/game/client.ts` (`shot-rejected` tap),
`src/game/host-shot.ts` (`HEAD_Y` 1.55, `LIMB_Y` 0.9, ten claim refusals),
`src/game/health.ts` (regen, `invulnerableUntil`), `src/game/rules.ts`
(respawn 2200, `SPAWN_PROTECT_MS` 1350, `SOLO_MIN_BOTS` 1, `recruit`,
`enemies` layout, `sanitizeSoloSetup`), `src/weapons/controller.ts`
(`command('fire'/'state'/'refill')`, `shotsFired`/`cool`/`mag`, the trigger
is a CLAIM), `src/core/layout.ts` (`EYE_HEIGHT` 1.68),
`src/game/host-life.ts` (occupants as eye-height points), `src/ui/menus.ts`
(`leave()` has no menu transition; return-pre-match picks the panel) +
`menu-views.ts` + `solo-setup.ts` (real menu labels/route), `src/main.ts`
(wiring, `__NTGAME`, `__NT` QA), `src/core/renderer.ts`
(`__NT_BACKEND: { requested, actual }`, canvas `dataset.ntBackend`),
`scripts/lib/stock-browser.mjs`, `scripts/_verify-net-refinement.mjs`
(root pattern source: teleport → 400 ms → fire), `scripts/_verify-lobby-
screens.mjs` (persisted solo-setup key route), `scripts/soak.mjs`
(`weaponCmd('refill')` QA surface).
At authoring, root's candidate bundle was `index-_ewwfvWF.js` on 4192 with
4191 accepted — the verifier compares `dist-next` disk vs loaded bundle
name plus live SHA256 digest dynamically rather than pinning that hash.
