# IMPORT-PLAN — gameplay, UI, killstreaks from the old project

Written 2026-09-18 by the inventory lane. **No code was changed by this lane.**

Source read (reference only, nothing copied):
`C:/Users/david/Desktop/stuff/atomic-acres` — `UI-INVENTORY.md`, `AGENTS.md`, `FIXLOG.md`,
`docs/HUD_STREAMLINE_INVENTORY_2026-08-03.md`, `docs/OWNER_FEEDBACK_2026-09-12.md`,
`../atomic-acres-ui-style-guide.md`, and ~40 source files under `src/`.

Scale of what we are importing *from*, measured, not estimated:

| | old project | here, today |
|---|---|---|
| `.ts` files under `src/` | 1,456 | 49 |
| lines of `.ts` under `src/` | 443,610 (285,575 non-test) | 17,131 |
| test files | 720 `*.test.ts` + 79 e2e specs | 0 |
| npm scripts | 224 | 10 |
| biggest single file | `legacy-main.ts`, **37,669 lines** | `controller.ts`, 804 |

That table is the brief. We are importing **behaviour and decisions**, not lines.
Target for everything below: **~4,000 lines in `src/game/`**, from a system that took
~60,000 lines of gameplay code to express. Where the old project needed 3,511 lines of
killstreak runtime it is because one file carried five aircraft, a possession model,
checkpoint/restore, carpet-bomb corridor planning and a taser. We ship three streaks
first and the fourth costs one new file.

---

## 0. What already exists here — read before proposing anything

Do **not** rebuild these. Wire to them.

| module | public surface you will call |
|---|---|
| `src/weapons/catalog.ts` | `WEAPONS: readonly WeaponDef[]`, `damageAt(def, dist)`, `patternMult(def, n)` |
| `src/weapons/controller.ts` | `class WeaponsController`, `.hud: GunsHudState` (live object, mutated in place), `.update/.pointerDown/.keyDown/.snapshot/.command` |
| `src/weapons/types.ts` | `GunsHudState` (`hitSeq`, `shotsHit`, `lastDamage`, `lastDistance`, `spread`, `adsT`) |
| `src/ui/hud.ts` | `HudApi`: `setAmmo setWeapon setScore setHealth damageFlash damageFrom hitmarker killfeed setMoving setFiring setADS setPlayer setDebugVisible` |
| `src/ui/layout.ts` | HUD contract constants: `KILLFEED_MAX/MS`, `HIT_MS`, `DMGDIR_MS`, `MAP_PX`, `MAP_POS_Q`, `MAP_YAW_Q`, `LOW_HP` |
| `src/ui/menus.ts` | `initMenus({hud, player, world})`, `MAPS: MapEntry[]` |
| `src/net/protocol.ts` | `InputMsg`, `PlayerSample`, `StateMsg`, `RosterEntry`, `isNetMessage`, `HostAuthored<T>`, `MAX_PLAYERS = 8` |
| `src/net/room.ts` | `class HostRoom` (`tickOnce`, `roster`, `poseOf`, `driveHostSeat`, `start`, `canStart`), `class GuestClient` (`sendInput`, `remotePose`, `selfPose`) |
| `src/net/snapshot.ts` | `TICK_HZ = 20`, `INTERP_DELAY_MS`, `SnapshotRing`, `reconcileSelf` |
| `src/characters/index.ts` | `createCharacterSystem(scene, dress)`, `CharacterHandle {rig, root, input, yaw}`, `CharacterSystem.spawn/update` |
| `src/core/layout.ts` | every dimension; `SPAWN_A`, `SPAWN_B`, `HOUSES`, `BOUND_*`, `garageIsOnTheRight()` |
| `src/core/player.ts` | `Player`, `PlayerState {pos, vel, yaw, pitch, grounded}` |

Three facts about the existing code that shape the whole plan:

1. **Nothing computes a kill.** `WeaponsController.fire()` raycasts `opts.targets`
   (`worldTargets` in `main.ts`, line 62/110 — the *builder groups*, i.e. world geometry
   only), calls `damageAt(def, hit.distance)`, and writes the number to
   `hud.lastDamage`. No victim, no hit zone, no team, no health. Damage is computed and
   thrown away.
2. **`HudApi.setScore()` works and nobody calls it.** The HUD lane said so in
   `docs/report-hud.md` §"Wishes" item 1: *"Score/streak backend does not exist."*
   Same for `killfeed()`, `hitmarker()` and `damageFrom()` — all three exist, all three
   are unwired.
3. **The map is already projected twice.** `ui/hud.ts:drawMap()` and
   `ui/menus.ts:drawNuketownThumb()` are two independent top-down projections of the same
   `layout.ts` constants, with two colour sets. Adding a live minimap must collapse these
   to one, not make it three.

`src/game/` does not exist. Nothing under it was ever written.

---

## 1. Behaviour inventory

Verdicts: **PORT** = the design comes across, re-implemented here.
**REFERENCE-ONLY** = read it when you need the decision, do not bring the module.
**SKIP** = not wanted here.

### 1.1 Killstreaks

| behaviour | old files | what its tests pin | verdict |
|---|---|---|---|
| **Streak catalog as one authored list + derived pool.** 12 entries with `cost / tier / availability / activation / durationMs / repeatable`; the care-package pool is *projected* from base weights, never authored. Slot families 1–5, duplicate + family + mutual-exclusion validation. | `killstreak-catalog.ts` (358) | `killstreak-catalog.test.ts`: "is an exact typed projection of the frozen catalog and slot families"; "rejects silent omissions, duplicate IDs, **authored derived weights**, and unsafe arithmetic"; "recomputes on rename, cost, retirement and base-weight changes **without stale mirrors**". | **PORT** — this is the best module in the old project; the projection discipline is the whole reason their content edits stayed consistent. |
| **Exact-percentage rewards.** `CARE_PACKAGE_FIXED_PERCENTS = {nuke: 1, crimson-flamethrower: 10}`; a fixed reward carries zero base weight and the weighted pool scales to `100 − Σfixed`, because no integer weight can express "exactly 10%" while the Nuke stays exactly 1%. | `killstreak-catalog.ts` | "derives the complete care-package pool from every current or future source row"; "auto-enrols two future eligible streaks exactly once and makes every reward reachable". | **PORT the mechanism, not the content.** If the owner ever says "exactly N%", this is the only shape that is honest. ~30 lines. |
| **Pure activation gate with enumerated refusals.** Nine reasons (`dead`, `match-inactive`, `menu-open`, `possession-active`, `targeting-open`, `not-earned`, `no-authority-snapshot`, `arena-unsupported`, `input-disabled`), each with a short uppercase feed label, in a fixed precedence order, plus the control-toggle exemption. | `killstreak-activation-gate.ts` (126) | `killstreak-activation-gate.test.ts`: "maps every blocking input to its single denial reason"; "ships a short uppercase feed label for every denial reason"; "never blames the kill count while the host actor snapshot is missing"; "allows the toggle back OUT while possessing". | **PORT, near-verbatim in design.** Its header records why: every reason here used to be *"an inlined bare `return` in legacy-main.ts, so a blocked key-3 press produced zero feedback."* |
| **Host earn/bank/spend ledger.** Per-actor streak counter, per-life continuity id, charges banked across deaths, bounded bank (`MAX_RETAINED_CARE_REWARDS = 8`, 255 charges/reward), backpressure instead of silent discard, exactly-once activation, forged/stale/duplicate claim rejection. | `killstreak-runtime.ts` (3,511) — the `HostKillstreakRuntime` class surface: `registerActor / recordEligibleElimination / recordActorDeath / recordActorDisconnect / activate / control / advance / snapshotFor / endMatch` | `killstreak-runtime.test.ts`: "earns only the frozen five-slot selection and retains unconsumed rewards across lives"; "banks three same-life ladder cycles without consumption and spends exactly one charge per accepted activation"; "**backpressures before a full reward bank instead of silently discarding an earned charge**"; "preserves earned rewards across repeated deaths and a transport rejoin while rejecting stale, duplicate and forged activation claims"; "atomically ends support, possession, timed modifiers and deferred impacts on every match terminal path". | **PORT the ledger and the method names.** Skip the aircraft. ~350 lines gets the whole ledger; the old 3,511 is five vehicles and a checkpoint system. |
| **Deterministic streak effects from host seed only.** Carpet Bomber derives exactly 20 in-bounds impacts from the host seed; blocked corridors are rejected *before* the reward is consumed and an exact retry is permitted. | `killstreak-runtime.ts`, `carpet-corridor-targeting.ts` (175) | "derives exactly 20 deterministic in-bounds impacts from host seed only"; "**rejects a fully blocked Carpet route before consuming the reward and permits an exact retry**". | **PORT the two rules** (seed-only determinism; validate before consuming). The carpet bomber itself: later. |
| **Announce / awareness.** Host-only announce message, epoch-scoped, admitted once, bounded de-dup memory; banner names the streak and tells own/friendly/enemy apart; distance-attenuated flight audio into a bounded reused pool. | `killstreak-awareness.ts` (428) | "has an exact host-only shape and is public to every peer"; "keeps the de-dup memory bounded without forgetting the newest activation"; "names the killstreak and tells own, friendly and enemy apart"; "shows the banner once and hides it after its window". | **PORT the announce shape + banner rules** (~60 lines into `feed.ts`). Audio pool: REFERENCE-ONLY until we have streak audio. |
| **Loadout: 5 slots, persisted, migrated.** `KillstreakLoadoutV1 {schemaVersion, slots[5]}`, slot-family allow-lists, `replaceKillstreakSlotWithSwap`, localStorage read with fallback. | `killstreak-loadout.ts` (182), `ui/killstreak-loadout-menu.ts` (187) | `killstreak-loadout.test.ts`; `killstreak-catalog.test.ts` "accepts every legal five-slot combination and rejects family, duplicate and Nuke/Drone violations". | **PORT.** Owner's 2026-09-12 defaults were *Care Package, Piloted Drone, Carpet Bomber, Chopper Gunner, Drone Swarm* — record them but do not assume they survive the new roster. |
| **Balance constants that carry their own history.** `CHOPPER_MISSILE_CAPACITY_BEFORE = 6` sits next to `_AFTER = 12`; `cadenceForFireRateMultiplier()` exists so "+25% fire rate" is a ratio in the source rather than a derived decimal nobody can trace. | `killstreak-tuning.ts` (159) | `killstreak-tuning.test.ts` pins the **ratio the owner stated**, not the resulting number. | **PORT the convention** (leaf module, imports nothing, every tuned number named with its before-value and the request that moved it). Content: not yet. |
| Chopper gunner, piloted drone, drone swarm, taser, care-package capture, hunter swarm, tri-pass, adrenaline | `killstreak-runtime.ts`, `killstreak-support-catalog.ts` (270), `killstreak-presentation.ts` (4,630), `killstreak-drone-*.ts`, `taser-stun.ts` | many | **REFERENCE-ONLY for now.** Each is a separate content decision with its own art. Ship the framework + 3 cheap streaks; come back with the vehicles when the visual pass lands. |
| Killstreak demo-capture contract, published demo media, menu preview videos | `killstreak-demo-capture-contract.ts` (874), `killstreak-demo-*`, `ui/menu-preview-video.ts` (583) | `killstreak-demo-*.test.ts` | **SKIP.** Owner removed killstreak previews (`OWNER_FEEDBACK_2026-09-12`, UI-0912-04: *icon reward choices, no preview*). Roughly 2,000 lines deleted by one owner sentence. |

### 1.2 Match, scoring, damage lifecycle

| behaviour | old files | what its tests pin | verdict |
|---|---|---|---|
| **Match state machine.** `MatchPhase = warmup \| active \| ended`; `createMatch`, `advanceMatch(state, now, [s0,s1], rules)` and `advanceFreeForAllMatch(state, now, perPlayer, rules)`; `winner: 0\|1\|'draw'\|null`, `winnerPlayerId`, `endReason: 'score'\|'time'`; `rules.durationMs \| null` and `rules.scoreLimit \| null` so an explore mode is *no rules*, not a special case. | `gameplay.ts:377–452` | `gun-range-match-clock-authority.test.ts`, `match-admission-transaction.test.ts` | **PORT.** ~110 lines, pure, testable without a browser. Take the `null = unlimited` convention — it is why their explore mode needed no branch. |
| **Match clock + respawn presentation.** `formatMatchClock(ms, ceil)`, `respawnPresentation(endsAt, now)`. | `match-presentation.ts` (62) | `match-presentation.test.ts` | **PORT** (~25 lines). |
| **Scoring ledger.** Per-player `PlayerScore` (kills/deaths/score/streak), team totals, stable tie-break by id. | scattered: `private-match.ts:83` type, **`authoritativeScores` Map in `legacy-main.ts`** with merge points at lines 8343, 8665, 8926, 9150, 10267, 10319, 10794, 27612 | `authoritative-death-outcome.test.ts`: "keeps the canonical map feed on replicas **without mutating replica scores**"; "does not score a non-hostile player death or a **forged map gun death**"; "retains ordinary attacker and victim damage accounting". | **PORT the rules, not the code.** The ledger was never extracted; it lives in eight places in a 37k-line file. This is the single clearest "do it properly this time" item. |
| **Damage resolution.** `computeDamage(weapon, distance, zone)`, `HEADSHOT_DAMAGE_MULTIPLIER = 1.5` / `SNIPER_ = 3`, `admittedPlayerDamage(d, min=1)` (a hit always does ≥1), `BOT_DAMAGE_MULTIPLIER = 0.25`, fall damage band 9.5→22 m/s, `MELEE_DAMAGE 100 / RANGE 1.75 / COOLDOWN 650 ms`, `GRENADE_RADIUS 16 / MAX 230`. | `gameplay.ts:8–34, 250+`, `combat-damage-table.ts` (126) | `ballistics.test.ts` (1,000+ lines), `combat-timing.test.ts` | **PORT the numbers as a starting band** (they are BO2-tuned and the owner played them), but resolve through **our** `weapons/catalog.ts:damageAt()` — do not import a second damage curve. |
| **`applyDamage` itself** — 100 lines that mutate health *and* record a diagnostic *and* push a feed row *and* play audio *and* rumble the gamepad *and* show the damage direction *and* add camera trauma *and* push a HUD impact *and* replay a flash *and* tell the killstreak runtime *and* broadcast a death *and* schedule respawn *and* exit pointer lock. | `legacy-main.ts:15186` | — | **REFERENCE-ONLY, as a warning.** Read it once. It is the exact shape `src/game/damage.ts` must not have. See §5.1. |
| **Authoritative shot admission.** Exactly-once fire window, bounded reorder tolerance, 250 ms target-view ceiling, pre-death trade allowed / post-death bullet rejected, life-epoch isolation, predicted muzzle validated against the shooter pose at fire time. | `authoritative-shot.ts` (226) | `authoritative-shot.test.ts`: "admits distinct 900 RPM bullets when reliable delivery bunches them"; "rejects replay outside the retained exactly-once window"; "**allows a legitimate pre-death trade but rejects bullets authored after authoritative death**"; "isolates connection and life epochs". | **PORT the rules list into `game/host.ts`'s shot admission** (~80 lines). This is genuinely hard-won netcode knowledge and our `net/` lane has no equivalent. |
| **Spawn selection.** Deterministic scoring: recent-use avoidance (12 s, depth by candidate count), nearest-threat distance reward against an engagement quantile, enemy line-of-sight penalty, map-trap radius, FFA minimum separation 8 m, team-side preference in TDM with opposite-side fallback, stable per-player tie-break seed. | `spawn-selection.ts` (272), `spawn-safety.ts` (94) | "uses spatial separation instead of asymmetric FFA spawn immunity"; "penalizes repeated traps and immediate enemy line of sight before raw distance"; "is deterministic for a fixed candidate set, context and seed"; "reserves collision-free initial FFA deployment points before peer snapshots exist". | **PORT.** Compresses to ~180 lines here because we have one map and `paths.mjs` already tells us what is reachable. |
| **Respawn + loadout re-grant.** `authoredRespawnLoadout`, `admitAuthoritativeRespawnLoadout`, invulnerability window (`player.invulnerableUntil`), respawn countdown. | `respawn-loadout-authority.ts` (64), `guest-respawn-lifecycle.test.ts` | `respawn-loadout-admission.test.ts` | **PORT** (~110 lines). |
| **Field kits / loadout presets.** 4 curated kits + 3 custom slots, `sidearmForPrimary`, localStorage key + parse/serialize with fallback. | `loadout.ts` (92), `loadout-preset-schema.ts` (849) | `loadout-preset-schema.test.ts` (892) | **PORT the 92-line `loadout.ts` design. SKIP the 849-line preset schema** — it is versioned-migration machinery for content we do not have. |
| **Death drops / scavenging.** 30 s lifetime, max 12, 2.35 m interaction vs 1.05 m scavenge range, swap-places-on-pickup. | `death-drops.ts` (269), `mp-pickup-authority.ts` (87), `mp-remote-pickup-authority.ts` (193) | `death-drops.test.ts`, `death-drop-presentation.test.ts` | **REFERENCE-ONLY.** Real BO2 Nuketown has no weapon drops as a core loop. Revisit only if the owner asks. |
| Host match checkpoint / succession / rejoin-grace / host migration | `host-match-checkpoint.ts` (852), `host-succession-wire.ts` (757), `host-migration.ts` (692), `host-authority-mirror.ts` (738) | `host-match-recovery-*.test.ts` | **SKIP for now, REFERENCE-ONLY later.** 3,039 lines to survive a host disconnect. Our `net/` is loopback-proven and 8 players; this is a Phase-3 problem. |
| Match diagnostics upload, high scores, global leaderboard, match report JSON download | `match-diagnostics.ts` (430), `match-diagnostics-upload.ts`, `match-report.ts` (157), `high-scores.test.ts` | — | **SKIP.** Owner hid leaderboard access (`AGENTS.md`, owner supersession 2026-09-12). |
| Domination / objective modes, private-match capacity 4–6, lobby kill/time limit tables | `private-match.ts` (462) | `private-match.test.ts` | **PORT the limit tables only** (`LOBBY_KILL_LIMITS = [null,10,25,50,100]`, `LOBBY_TIME_LIMITS_MS = [2,5,10,15]min`, `MatchMode = 'tdm'\|'ffa'\|'domination'`). Ship TDM + FFA; leave the `domination` tag in the type. |

### 1.3 Minimap

| behaviour | old files | what its tests pin | verdict |
|---|---|---|---|
| **World↔map transforms.** `worldToMinimap`, `minimapToWorld` (round-trips clicks), `worldToTacticalMap`, bounds clamping. | `minimap.ts` (392) | "maps arena corners and centre with north up"; "clamps out-of-bounds positions to the map frame"; "round-trips map clicks back into bounded world positions". | **PORT.** ~50 lines and it removes the duplicate projection we already have. |
| **Player-up rotation.** Minimap rotates so camera-forward is up, north marker travels the rim, rotation is continuous (no snapping to integer headings), and the horizontal reflection `playerUpScaleX() === -1` is applied to the *layer*, not to markers, so labels are not mirrored. | `minimap.ts:299–392`, `minimap-player-view-transform.test.ts` | "rotates a player-centred minimap so camera-forward stays up and north moves around the rim"; "**preserves camera left/right instead of horizontally mirroring world markers**"; "rotates continuously for sub-degree camera movement"; "matches a Canvas2D-composed affine chain for every yaw, view size, player and anchor". | **PORT.** This is the single most bug-prone thing on a minimap and they got it wrong at least twice — the reflection rule and the label exemption are the fix. |
| **Enemy reveal rule.** `shouldRevealEnemy(distance, now, lastShotAt)` — close enemies and recent gunfire show; distant quiet enemies do not. | `minimap.ts:254` | "reveals close enemies and recent gunfire but not distant quiet enemies". | **PORT** (~15 lines). This is the BO2 feel the owner means by "the way the mini map works". |
| **Semantic silhouette layer.** Surfaces are classified by *name pattern* into `house / garage / perimeter / road / vehicle`; props, decals, trim, furniture default to hidden; per-arena override tables; grouping merges all authored pieces of one house into one footprint; a 2 px fence drops remnants. | `minimap.ts:40–184`, `minimap-static-layers.ts` (185) | `minimap-semantic-layer.test.ts`: "**defaults props, decals and unknown surfaces to hidden**"; "reduces Nuketown2 to the authored house/garage/perimeter/road/vehicle set". | **REFERENCE-ONLY.** The *problem* they solved was "our arena is a name-soup and the minimap drew the furniture". We do not have that problem: `core/layout.ts` already holds the footprints, and `ui/hud.ts:drawMap()` already draws exactly the right five things from it. Keep our approach; keep their default-hidden rule in mind if we ever auto-derive. |
| **Render cadence.** 30 Hz, reflects a moved player within 2 frames of a 60 fps loop, no drift on an uneven frame loop. | `minimap-render-cadence.test.ts` | "ships at 30 Hz, the lowest cadence the shared helper can express"; "halves the redraw work: exactly half the frames of the 60 Hz predecessor". | **ALREADY BETTER HERE.** `ui/hud.ts` redraws only past a 0.25 m / ~2° quantum (`MAP_POS_Q`, `MAP_YAW_Q`), which is event-rate rather than fixed-rate. Keep ours; add the 2-frame responsiveness assertion when blips land. |
| Tactical-map strike overlay, carpet-corridor map overlay | `ui/carpet-corridor-map-overlay.ts` (479) | `carpet-corridor-targeting.test.ts` | **REFERENCE-ONLY** until a target-point streak ships. |

### 1.4 HUD

The complete old HUD surface list is `docs/HUD_STREAMLINE_INVENTORY_2026-08-03.md`
(37 in-match surfaces, 22 menu surfaces, 32 lifecycle states). Condensed verdict:

| behaviour | old files | verdict |
|---|---|---|
| **Kill feed** (`#killfeed`) and **damage feeds** (`#damage-done-feed` / `#damage-taken-feed`), routed by `feedDestination(details)`; limits 6 events / 8 damage rows, 7 s visible; accessible label prefix per destination. | `hud-feed.ts` (17), `ui/pass64-shell.ts`, `legacy-main.ts:addFeed` | **PORT the routing rule** (17 lines, exactly right). Our `HudApi.killfeed(text)` already has a 5-row recycled pool; add the destination split. |
| **Damage-direction indicator.** `sourceScreenAngle(player, yaw, source)` → CSS rotation, 0 = forward, positive = camera-right. | `directional-hud.ts` (**17 lines**) | **ALREADY HERE.** `ui/hud.ts:sourceAngle()` is the same function with the same convention, and `HudApi.damageFrom()` renders the arc. It has no caller. Wire it; do not re-import. |
| **Hitmarker + kill-confirm pulse.** Body/head/kill envelopes; 40 ms attack / 320 ms decay pulse. | `combat-feedback.ts:combatConfirmEnvelope` (81), `kill-confirm-pulse.ts` (81) | **PORT the three-kind envelope** into `HudApi.hitmarker(kind)`. Ours is boolean `kill?`. |
| **Zero-damage hit feedback** — a distinct readout when a hit lands for 0 damage, max 3 rows, 140 ms min interval. | `zero-hit-feedback.ts` (157) | **REFERENCE-ONLY.** Exists because their damage pipeline could silently apply 0. Ours must not be able to (`admittedPlayerDamage` floor of 1). If we need this module, we have a bug. |
| **Banner arbiter** — three priorities (`fatal` > `match-flow` > `announcement`), one banner at a time, explicit expiry. | `banner-arbiter.ts` (101) | **PORT.** Cheap, and it is the only thing stopping "KILLSTREAK READY" from covering "MATCH OVER". |
| **HUD impact response** — kind (`bullet/explosion/fall/melee`) × severity × bearing → CSS custom properties, frame-stepped, released when idle. | `ui/hud-impact-response.ts` (384) | **REFERENCE-ONLY.** Good design, but our HUD contract is "build once, cache, `textContent` + class flips". Take the *taxonomy* (4 kinds, severity 0..1, optional bearing); leave the property-writing machine. |
| **Match bar**: mode label, clock, two team scores, score limit, connection pill, objective text. | `ui/pass64-shell.ts`, `ui/hud-mode-banner.ts` (137) | **PORT.** Our `HudApi.setScore(text)` takes one string — that is too thin. Widen to a struct. |
| **Typed surface + lifecycle-state registry**: every HUD/menu surface has an id, root element, renderer, `critical` flag; 32 named lifecycle states; a redesign may restyle but must not drop multiplayer state, loadout, accessibility, diagnostics, focus or return-to-lobby. | `ui/surface-registry.ts` (164) | **PORT the idea at 1/4 scale.** ~40 lines listing our surfaces and their critical flag is worth having before the visual overhaul lane starts moving things. |
| Sniper scope, railgun/DMR thermal overlays, gunner cockpit HUD, overdrive, adrenaline timer, power announcements, support-platform telemetry block, room/test-bay HUD, chat | `ui/pass64-shell.ts` + ~10 modules | **SKIP.** Chat is explicitly removed by owner (UI-0912-03). The rest are content we do not have. |

### 1.5 Menus and lobby

| behaviour | old files | verdict |
|---|---|---|
| **Menu lifecycle reducer.** `MenuSurface = pre-match \| deploying \| hidden \| paused-match \| error`; `PointerLockPhase = unlocked \| requesting \| locked \| denied \| focus-suspended`; request sources (`match-start`, `respawn`, `resume`, `canvas`, `chat-close`, `targeting-close`); pure `reduceMenuLifecycle(state, event)`. | `ui/menu-lifecycle.ts` (249) | **PORT.** Pointer-lock denial and focus-suspension are the two states every browser FPS gets wrong, and a pure reducer is the only way to test them. |
| **Deploy / Field Kit / Streaks / Options tab shell.** | `ui/pass64-shell.ts` (664) | **REFERENCE-ONLY.** It is one 664-line file of template-string markup importing 20 catalogs — exactly the coupling `AGENTS.md` here forbids. Our `ui/menus.ts` (491) already has the shell; extend it. |
| **Map select driven by a data table.** | `map-selection.ts` (646) | **ALREADY BETTER HERE.** `ui/menus.ts:MAPS` is a 4-field entry with a `drawThumb` callback. |
| Lobby: capacity 4/6, roster, ready, auto-balance, room code, rejoin grace | `private-match.ts`, `mp-lobby-authority-views.ts` (217) | **PORT the lobby *rules* into `game/rules.ts`;** the view already exists in `ui/lobby.ts` (320) + `net/room.ts`. |
| Options: graphics profiles (Performance/Quality/Max/Custom), advanced-graphics orphan-option gate, audio buses, accessibility (reduced motion / damage-flash scale / weapon-motion scale), privacy | `ui/advanced-graphics-controls.ts`, `pass65-settings.ts` (648), `graphics-settings-registry.ts` (1,048) | **PORT only the accessibility trio** into `ui/settings.ts` — `reducedMotion`, `damageFlashScale`, `weaponMotionScale` are read by gameplay code and must exist before the feedback lanes hard-code intensities. Graphics registry: **SKIP**. |
| Project-map dialog, release-history dialog, changelog (`changelog.ts` is **919 lines of release notes compiled into the bundle**), build stamp, deployment transition video, operator skins/emotes/stances, text chat | various | **SKIP.** |

### 1.6 Bots

| behaviour | old files | verdict |
|---|---|---|
| Sense → intent reducer (`BotSense` → `BotIntent`), reaction delay 650 ms, fire range 22 m, grenade window 7–18 m with 12 s cooldown, `operatorYawToward` / `operatorPitchToward` with a 1.42 m aim origin, reinforcement every 10 bot deaths, spawn-side flip hysteresis (1.2 s sustain). | `bot-ai.ts` (285), `bot-stance.ts` (180) | **PORT.** Small, pure, and the numbers are play-tested. |
| Bot arsenal projected from the weapon catalog by policy (`bot: 'eligible'`), so a new weapon cannot silently be invisible to bots. | `bot-arsenal.ts` (209) | **PORT the projection rule** (~20 lines against our `WEAPONS`). |
| Rigged-bot visual evidence contracts, bot GPU vocabulary, corpse presentation contract | `bot-weapon-gpu-vocabulary.ts`, `rigged-bot-visual-evidence-contract.ts` (574) | **REFERENCE-ONLY.** But keep the rule from `AGENTS.md`'s durable gotcha: *all players, bots, reinforcements and corpses use the same rig; a performance profile may simplify materials but never substitute anatomy.* We have exactly one character path (`characters/mesh.ts`) — keep it that way. |

---

## 2. Proposed module map for `src/game/`

**Two hard boundaries, stated once:**

- **`src/game/` is DOM-free and scene-free.** No `document`, no `THREE.Scene`, no
  renderer, no material. It may import `THREE` for `Vector3`/math types only. Everything
  it needs from the world arrives through one injected port (below). This is what makes
  it testable without a browser and what stops `applyDamage` happening again.
- **Only `game/host.ts` writes authoritative state.** Health, score, kills, deaths,
  streak charges, spawn choice, match phase and the RNG seed are host-owned. Every other
  module is either a pure function the host calls, or a consumer of the events the host
  emits. A guest module that writes a score is a bug, not an optimisation.

The port the host takes from `main.ts` (this is the one good idea in the old
`KillstreakWorld` type):

```ts
interface WorldQuery {
  lineOfSight(from: Vec3, to: Vec3): boolean;   // colliders only
  groundY(x: number, z: number): number;
  inBounds(x: number, z: number): boolean;
}
```

### Modules

| file | responsibility | public surface (sketch) | talks to |
|---|---|---|---|
| `game/events.ts` | **The one vocabulary.** Discriminated union of every game event + a 40-line typed emitter. Nothing else in `src/game/` defines an event shape. | `type GameEvent = Damage \| Kill \| Death \| Spawn \| StreakEarned \| StreakActivated \| StreakDenied \| MatchPhase \| FeedLine`; `class GameBus { on(fn), emit(e) }` | nothing (leaf) |
| `game/rules.ts` | Match rules and lobby limit tables. Leaf: imports nothing. | `MatchMode`, `MatchRules`, `DEFAULT_RULES`, `KILL_LIMITS`, `TIME_LIMITS_MS`, `WARMUP_MS`, `RESPAWN_MS`, `SPAWN_PROTECT_MS`, `TEAM_A/TEAM_B` | nothing |
| `game/match.ts` | Match state machine + clock formatting. Pure. | `MatchState`, `createMatch(now, rules)`, `advanceMatch(state, now, teamScores, rules)`, `advanceFfa(state, now, perPlayer, rules)`, `formatClock(ms)`, `respawnText(endsAt, now)` | `rules` |
| `game/scoring.ts` | Per-player and per-team ledger. Pure reducer over events; owns tie-break ordering. **The only definition of "score" in the codebase.** | `Ledger`, `createLedger(ids)`, `applyKill(l, {killer, victim, weapon, headshot})`, `applyDeath`, `teamTotals(l)`, `leaderboard(l)` | `events`, `rules` |
| `game/damage.ts` | Pure damage resolution. Takes a shot description, returns a number and a reason. **Mutates nothing, emits nothing, knows no HUD.** | `resolveDamage({def, distance, zone, attackerTeam, victimTeam, victimInvulnUntil, now}) → {damage, blocked?: 'friendly'\|'invulnerable'\|'out-of-range'}` | `weapons/catalog.ts` (`damageAt`), `rules` |
| `game/health.ts` | Per-actor health/alive state; pure transitions. | `ActorHealth`, `applyDamage(h, amount, now) → {health, died}`, `revive(h, now)`, `regenStep(h, dt)` | `rules` |
| `game/spawns.ts` | Spawn point set derived from `core/layout.ts` + deterministic scored selection. | `SPAWN_POINTS`, `selectSpawn(ctx) → {index, point, score[]}` | `core/layout.ts`, `WorldQuery` |
| `game/respawn.ts` | Death→respawn timing, countdown, invulnerability window, loadout re-grant. | `RespawnState`, `scheduleRespawn(s, actorId, now)`, `dueRespawns(s, now)` | `rules`, `loadout` |
| `game/loadout.ts` | Field kits, custom slots, persistence with try/catch, respawn loadout admission. | `FIELD_KITS`, `FieldKit`, `loadLoadout()`, `saveLoadout(l)`, `respawnLoadoutFor(actor)` | `weapons/catalog.ts` |
| `game/killstreaks/catalog.ts` | Authored streak list + **derived** reward pool + slot families + loadout validation. No runtime behaviour. | `STREAKS`, `STREAK_CATALOG` (derived), `SLOT_FAMILIES`, `validateStreakLoadout(v)`, `parseStreakLoadout(v)` | nothing (leaf) |
| `game/killstreaks/gate.ts` | Pure activation gate: 9 enumerated denial reasons + labels + fixed precedence + toggle exemption. | `DenialReason`, `DENIAL_LABELS`, `evaluateActivation(input) → {allowed} \| {allowed:false, reason, label}` | `killstreaks/catalog` |
| `game/killstreaks/runtime.ts` | **Host authority for streaks only.** Earn/bank/spend ledger, per-life continuity, exactly-once activation, bounded bank with backpressure, active-entity registry, `advance()`. Hard cap 380 lines — if it grows, the growth belongs in `effects/`. | `class StreakRuntime { registerActor, recordElimination, recordDeath, recordDisconnect, activate(intent, now, world), advance(now, world) → GameEvent[], snapshotFor(actorId), endMatch() }` | `killstreaks/catalog`, `killstreaks/gate`, `events`, `WorldQuery` |
| `game/killstreaks/effects/*.ts` | One file per streak. Each exports a pure stepper: state in, state + events out. First three only: `recon.ts` (map reveal), `counter-recon.ts`, `sentry.ts`. | `step(state, dt, world) → {state, events}` | `events`, `WorldQuery` |
| `game/minimap.ts` | **Pure** map projection + blip rules. No canvas. Replaces both existing duplicate projections. | `worldToMap(x, z, view)`, `mapToWorld(px, py, view)`, `playerUpTransform(yaw, view)`, `northMarker(yaw, w, h)`, `shouldRevealEnemy(dist, now, lastShotAt)`, `MAP_FOOTPRINTS` (derived from `core/layout.ts`) | `core/layout.ts` |
| `game/feed.ts` | Kill feed + damage-feed routing + streak banner arbitration, as data. Produces strings and tones; renders nothing. | `feedLineForKill(e)`, `feedDestination(details)`, `BannerArbiter {request, expire}` | `events` |
| `game/bots.ts` | Bot actors driven inside the host loop: sense → intent, reaction delay, stance, reinforcement schedule. | `Bot`, `senseBot(b, world, actors)`, `botIntent(sense, now)`, `BOT_*` constants | `spawns`, `damage`, `WorldQuery`, `characters/` (bodies, via main) |
| `game/host.ts` | **The orchestrator and the only writer.** Owns `MatchState`, `Ledger`, per-actor health, `RespawnState`, `StreakRuntime`, bots. Consumes inputs + shot claims, runs shot admission, emits `GameEvent[]` and the authoritative game snapshot. | `class GameHost { addActor, removeActor, submitShot(claim), submitInput, submitStreakIntent, tick(now) → GameEvent[], snapshot() }` | everything above, `net/room.ts`, `WorldQuery` |
| `game/client.ts` | Guest/local projection. Applies host events and snapshots to a local view model and pushes to the HUD. Never decides anything. | `class GameClient { applyEvent(e), applySnapshot(s), view(): ClientView }` | `events`, `ui/hud.ts` (`HudApi`), `minimap`, `feed` |

### Changes needed in existing modules (small, named, and owned by one lane each)

| file | change | why |
|---|---|---|
| `src/net/protocol.ts` | **Additive only**: `ShotMsg`, `DamageMsg`, `KillMsg`, `SpawnMsg`, `StreakIntentMsg`, `StreakStateMsg`, `MatchStateMsg`; extend `PlayerSample` with `hp`, `team`, `alive`; add each to `NetMessage` and `isNetMessage`. | Host authority needs a wire. Must land **before** anything else, from **one** lane. |
| `src/ui/hud.ts` | Widen `HudApi`: `setScore(s: ScoreView)` instead of a string; `hitmarker(kind: 'body'\|'head'\|'kill')`; add `setStreak(view)`, `setBanner(text\|null)`, `setBlips(list)`, `setRespawn(secs\|null)`, `feed(line, dest)`. Keep the build-once / cache / `textContent` contract. | The HUD nodes exist; the API is too thin to carry game state. |
| `src/ui/menus.ts` | `drawNuketownThumb` calls `game/minimap.ts` instead of re-projecting `layout.ts`. | Removes the second projection. |
| `src/weapons/controller.ts` | Emit a **shot claim** (origin, direction, seq, weaponId, time) instead of only writing `hud.lastDamage`. Keep local raycast for tracers/impacts — that is presentation. | Damage must be resolved by the host, not by whoever pulled the trigger. |
| `src/main.ts` | Build the `WorldQuery` from `colliders`, construct `GameHost`/`GameClient`, forward `HudApi`. Target: **under 30 new lines.** | `main.ts` is the only file that touches the scene; it stays that way. |

---

## 3. Dependency order

```
WAVE 0  (one writer, ~1 hour, blocks everything)
  game/events.ts ─┐
  game/rules.ts  ─┼─→ the shared vocabulary
  net/protocol.ts ┘   (additive message types only)

WAVE 1  (four lanes in parallel, disjoint files)
  A ── game/match.ts, game/scoring.ts, game/host.ts
  B ── game/damage.ts, game/health.ts, game/spawns.ts, game/respawn.ts, game/loadout.ts
  C ── game/killstreaks/**
  D ── game/minimap.ts, game/feed.ts, game/client.ts, ui/hud.ts, ui/layout.ts, ui/menus.ts

WAVE 2  (sequential, after Wave 1 merges)
  game/bots.ts                       needs spawns + damage + host
  weapons/controller.ts shot claim   needs protocol + host
  main.ts wiring                     needs all of the above
  a second/third killstreak effect   needs the runtime proven with one
```

Hard ordering facts:
- `events.ts` is imported by every module in Wave 1. It must be finished and frozen
  first, or four lanes will each invent a `KillEvent`.
- `host.ts` imports A, B and C. Lane A writes it, but it cannot be *finished* until B and
  C export their signatures. Mitigation: Lane A writes `host.ts` against the interfaces
  declared in Wave 0 and stubs the calls; the integrator un-stubs.
- Lane D can build and test against synthetic events from day one — it never needs the
  host to exist.
- Nothing in Wave 1 may touch `src/main.ts`. Integration is Wave 2, one writer.

---

## 4. Sizing and lane split

| lane | files owned (exclusive) | est. LOC | why this grouping |
|---|---|---|---|
| **Wave 0 — vocabulary** | `game/events.ts`, `game/rules.ts`, `src/net/protocol.ts` | 120 + 90 + 110 = **320** | Single writer. The only thing four lanes share. |
| **A — match spine** | `game/match.ts`, `game/scoring.ts`, `game/host.ts` | 110 + 180 + 350 = **640** | These three are one decision: what the authoritative state *is* and who writes it. Splitting them puts the score in two heads. |
| **B — combat lifecycle** | `game/damage.ts`, `game/health.ts`, `game/spawns.ts`, `game/respawn.ts`, `game/loadout.ts` | 140 + 110 + 180 + 110 + 140 = **680** | All pure, all testable in isolation, all touch no other lane's files. Highest test-per-line ratio in the plan. |
| **C — killstreaks** | `game/killstreaks/catalog.ts`, `gate.ts`, `runtime.ts`, `effects/recon.ts`, `effects/counter-recon.ts`, `effects/sentry.ts` | 200 + 100 + 380 + 3×110 = **1,010** | Self-contained under one directory; only touches `events.ts` and `WorldQuery`. |
| **D — readouts** | `game/minimap.ts`, `game/feed.ts`, `game/client.ts`, `src/ui/hud.ts`, `src/ui/layout.ts`, `src/ui/menus.ts` | 180 + 120 + 200 + (~180 HUD delta) + (~30) + (~20) = **730** | The HUD files and the pure modules that feed them belong to one owner, or the API drifts. D owns *all* of `src/ui/`. |
| **Wave 2 — integration** | `game/bots.ts`, `src/weapons/controller.ts` (delta), `src/main.ts` (delta) | 250 + 60 + 30 = **340** | Sequential, one writer. |

**Total ≈ 3,720 lines** to replace what the old project spent ~60,000 lines on.

File-count check against `AGENTS.md` ("one feature per file, under ~400 lines"): 21 new
files, largest is `game/host.ts` at 350 and `killstreaks/runtime.ts` capped at 380. No
file in this plan is allowed past 400 without splitting.

**Disjointness audit** — every file appears in exactly one lane's list. The three shared
files (`events.ts`, `rules.ts`, `protocol.ts`) are finished and frozen in Wave 0 before
any lane starts, and are **read-only** to Wave 1. If a lane needs a new event shape, it
stops and asks the integrator; it does not add one.

---

## 5. Lessons the old project paid for

Each one is a measured fact from that repo, not an opinion.

### 5.1 Tidying without a ratchet is a treadmill

`src/legacy-main-size-ratchet.test.ts` exists because, measured: *"Ten commits between
2026-07-27 and 2026-09-02 carry the word 'streamline' or 'refactor' in their subject and
touch this file. Together they removed a net 191 lines. Over the same window the file
grew from ~32,300 to 35,720 lines."* The ceiling ended at **37,560**.

**Rule here:** the 400-line-per-file limit in `AGENTS.md` is the ratchet. Enforce it with
a check, in one direction only (growth reds, shrinking never does), with a ledger entry
required to raise it. Their ratchet's second lesson: they originally also failed the test
when the file *shrank* too far below the ceiling, and had to remove it because *"a gate
that reds honest cleanup teaches contributors to stop cleaning, or worse, to pad."*

### 5.2 One function must not be the whole game

`legacy-main.ts:applyDamage()` (line 15186, ~100 lines) mutates health, applies a
handicap, records a diagnostic, releases a care-package capture, adds a feed row, plays
audio, pulses the gamepad, shows the damage direction, adds camera trauma, pushes a HUD
impact, replays a CSS flash, tells the killstreak runtime, broadcasts a canonical death,
schedules respawn and exits pointer lock.

**Rule here:** `game/damage.ts:resolveDamage()` returns `{damage, blocked?}` and does
nothing else. Every one of those fifteen effects is a subscriber to a `GameEvent`.
If `damage.ts` ever imports `ui/` or `THREE`, the rule has been broken.

### 5.3 Extraction by callback-bag is not modularity

`mp-pickup-authority.ts` (87 lines) takes a `PickupAuthorityContext` of **16 fields, 11
of them callbacks back into `legacy-main.ts`**. `mp-lobby-authority-views.ts` takes a
context of **12 fields, all 12 callbacks**. These files are not modules; they are
`legacy-main` with the body moved and the coupling made explicit.

**Rule here:** a `src/game/` module takes **data** and returns **data or events**. If a
proposed signature is a bag of callbacks into the caller, the split is in the wrong place.
The one permitted injection is the three-method `WorldQuery` port.

### 5.4 A refusal with no reason is a bug report you will never get

`killstreak-activation-gate.ts`'s header: every denial reason *"was previously an inlined
bare `return` in legacy-main.ts, so a blocked key-3 press produced zero feedback."* The
owner reported it as *"cant enter them to control them, at least in killstreak range"* on
2026-08-30 — a player-visible dead key that had been shipping for weeks.

**Rule here:** any `src/game/` function that can refuse returns a reason enum with a
user-facing label. No bare `return` on a player-initiated action, ever.

### 5.5 Derived data must be derived, or it goes stale in exactly one place

The killstreak catalog **throws** if a definition carries an authored derived weight, and
its test pins *"recomputes on rename, cost, retirement and base-weight changes without
stale mirrors."* They built that guard because hardcoded rosters had already shipped
against them more than once.

**Rule here:** one authored list per content family (weapons, streaks, kits, grenades);
everything else — menu rows, bot pools, protocol id unions, HUD labels — is a projection
of it. A roster written out by hand in a second file is a defect even while it agrees.

### 5.6 One number, one owner

`authoritativeScores` is merged or copied at eight distinct sites in `legacy-main.ts`
(8343, 8665, 8926, 9150, 10267, 10319, 10794, 27612), and also exists in
`privateLobbySnapshot.scores` and in the host checkpoint. Their
`authoritative-death-outcome.test.ts` had to assert that *replicas do not mutate replica
scores* — a test you only write after that happened.

**Rule here:** `game/scoring.ts` is the only definition of a score. `client.ts` holds a
*projection* and is structurally unable to write one.

### 5.7 Green everything, broken game

720 test files, 79 e2e specs, 224 npm scripts — and the project still shipped stale and
unselectable builds often enough that `AGENTS.md` had to say *"green tests without
complete requirement coverage are not release evidence"* and add a
`requirements-acceptance` gate, plus a durable gotcha whose symptom is *"several agents
report successful work but production is stale or contradictory."*

**Rule here:** `AGENTS.md` already says it — *the gate is a looked-at frame, not a count.*
Add: **the gate for `src/game/` is a played match.** Kills counted, feed lines readable,
respawn happens, a streak earns and fires, the score line agrees with the scoreboard —
observed in the interactive page, not in a capture. (See `docs/HANDOFF.md` §2 item 2: the
capture harness drives `qa.render()`, the game drives the frame loop, and that difference
is how a black screen shipped behind ten green captures.)

### 5.8 Presentation is never the authority

Their durable gotcha: *"a corpse or low-detail path shows the retired block-built humanoid
while live combatants use the authored rig → character presentation was given a separate
primitive fallback."* And from `AGENTS.md`: *"structural telemetry was mistaken for visual
proof."*

**Rule here:** one character path (`characters/mesh.ts`) for players, bots, and corpses.
A quality profile may simplify materials; it may never substitute anatomy. No game module
may branch on "is this the local player" to decide a *rule* — only to decide a *draw*.

### 5.9 Tuned numbers carry their history or they cannot be reviewed

`killstreak-tuning.ts` keeps `CHOPPER_MISSILE_CAPACITY_BEFORE = 6` beside `_AFTER = 12`,
and provides `cadenceForFireRateMultiplier()` so that "+25% fire rate" appears as a ratio
rather than as `800 → 640` with no trace back to the request. Its test pins the **ratio
the owner stated**, not the derived decimal.

**Rule here:** free, so do it. `game/rules.ts` and any balance table name the previous
value and the request that moved it.

### 5.10 A streak must not change the light set or the material graph

`AGENTS.md` and `legacy-main.ts` both record the PASS 82 constraint: time-of-day and
weather write **uniforms over a frozen light set** — *"no light is created, destroyed or
toggled"* — pinned by `rendering/lighting-conditions-light-set.test.ts`. Hiding a
viewmodel root once dropped two lights and invalidated every shader program.

**Rule here:** a killstreak effect may move objects and write uniforms. It may not add or
remove a light, toggle clipping planes, or construct a material. `AGENTS.md` already
requires materials to be singletons in `core/materials.ts`; streak effects are the most
likely place to break that, because "the sentry needs a red glow" is a one-line
temptation.

### 5.11 Owner sentences delete more code than refactors do

*"Remove killstreak preview; use icon choice buttons"* (2026-09-12) retired
`killstreak-demo-capture-contract.ts` (874), the demo runner, the media finaliser and most
of `menu-preview-video.ts` (583) — roughly 2,000 lines. *"Lobby and game chat are
disabled"* retired the chat stack. *"Hide leaderboard access"* retired the high-score
surface.

**Rule here:** build the framework, ship the smallest real content set, and let the owner
pull. Three killstreaks that feel like BO2 beat twelve that need 4,600 lines of
presentation before one of them is visible.

### 5.12 The second projection is already here

`ui/hud.ts:drawMap()` and `ui/menus.ts:drawNuketownThumb()` both project `core/layout.ts`
top-down, with different colours and no shared code, in a 17,131-line project that is one
day old. That is exactly how the old repo started.

**Rule here:** Lane D collapses them to `game/minimap.ts` *as part of* adding the live
minimap, not afterwards.

---

## Appendix — old-project files worth opening, with line counts

Read these; do not port them.

| file | lines | read it for |
|---|---|---|
| `src/killstreak-catalog.ts` | 358 | the projection discipline (§1.1) |
| `src/killstreak-activation-gate.ts` | 126 | enumerated refusals (§5.4) |
| `src/killstreak-tuning.ts` | 159 | how to write a balance constant (§5.9) |
| `src/killstreak-runtime.ts` | 3,511 | *only* the `HostKillstreakRuntime` method list |
| `src/minimap.ts` | 392 | transforms, player-up rotation, reveal rule |
| `src/gameplay.ts` | 452 | match machine (377–452), damage constants (8–34) |
| `src/spawn-selection.ts` | 272 | the whole spawn scoring model |
| `src/authoritative-shot.ts` | 226 | shot admission rules |
| `src/ui/menu-lifecycle.ts` | 249 | pointer-lock state machine |
| `src/ui/surface-registry.ts` | 164 | the surface + lifecycle-state idea |
| `src/hud-feed.ts` | 17 | feed routing, complete |
| `src/directional-hud.ts` | 17 | already reimplemented in `ui/hud.ts` |
| `src/banner-arbiter.ts` | 101 | banner priority |
| `src/bot-ai.ts` | 285 | bot sense/intent + tuned ranges |
| `src/legacy-main.ts:15186` | ~100 | `applyDamage` — read once, as a warning |
| `src/legacy-main-size-ratchet.test.ts` | — | the treadmill measurement (§5.1) |
| `docs/HUD_STREAMLINE_INVENTORY_2026-08-03.md` | — | the complete HUD/menu surface list |
| `UI-INVENTORY.md` | — | every element id, grouped by markup function |
| `../atomic-acres-ui-style-guide.md` | 1,013 | the owner-facing visual direction |
