# HANDOFF — Parity Scout verdict: old-game feature inventory vs Nuketown, + 2 streaks / 2 guns implemented

Owner: re-implementation only. No byte was copied from the retired tree
(`aa-omp-newworld-prime-live`, REFERENCE ONLY). Everything below under
`src/` was written fresh against Nuketown's module contract (dims from
`core/layout.ts` where spatial, colours from `core/palette.ts` where drawn,
materials only from `ctx.mat`, deterministic `ctx.rand()`/seed hashes,
honest colliders). Behaviors were re-derived from names + tuning envelopes,
never ported.

Serving identity: `ParityScout` (worker). Model: `meta/muse-spark-1.3-contributor`.
Workstation: win32 / RTX 5080 / installed Chrome headless WebGPU.
VISION QUOTA was out until 21:50Z, so all review below is pixel statistics
(luma/draw-calls), structural checks and deterministic logic proofs — no
vision-model calls. The OWNER is the critic: open pixel questions are listed
at the end; nothing is guessed.

Files touched (all inside ownership `src/game/killstreaks/**`,
`src/weapons/catalog.ts` + directly-scoped tests, this verdict):

- NEW `src/game/killstreaks/effects/mortar.ts` — Blast Mortar stepper
- NEW `src/game/killstreaks/effects/mortar.test.ts` — 34 checks
- NEW `src/game/killstreaks/effects/dart.ts` — Tracker Dart stepper
- NEW `src/game/killstreaks/effects/dart.test.ts` — 14 checks
- EDIT `src/game/killstreaks/runtime.ts` — wire 2 steppers, `paintedTargetIds()`
- EDIT `src/weapons/catalog.ts` — `stampede`, `varmint` + header note
- NEW `src/weapons/catalog.test.ts` — 60 checks
- NEW `docs/HANDOFF-PARITY.md` — this file

No other repo files written. Nothing committed (lead integrates).
`dist/` was rebuilt locally for capture proof only (gitignored build output).

---

## 1. Old-game inventory (names + behaviors only, with citations)

### 1a. Killstreak roster — 12 ids (`src/killstreak-catalog.ts:264-280`)

| Old id | Behavior (re-derived from the old tree, not copied) |
|---|---|
| `scout-sweep` | Instant, 12 s, low, cost 3. Map-wide pulse reveal: 3 s period, 1.5 s visible (`src/field-support.ts:57-59`, pulse helper `:72-76`). |
| `adrenaline` | Instant, 15 s, low, cost 3. Self damage multiplier (`src/combat-damage-table.ts:118`). Scout-slot alternative. |
| `care-package` | Instant, 60 s, low, cost 4. Zero base weight (non-recursive pool). Rolls the care pool: weighted streaks + exactly 10% crimson-flamethrower weapon grant + exactly 1% nuke (`src/killstreak-catalog.ts:20-23`; weapon-grant path `src/care-package-weapon-reward.ts:72-76`). |
| `yardhawk` | Instant, 15 s, mid, cost 5. Retained slot-2 effect (single support unit). |
| `piloted-drone` | **Possession**, 30 s, mid, cost 5 (`DRONE_SUPPORT_LIFETIMES_MS.piloted`, `src/killstreak-support-catalog.ts:230-233`). Pilotable drone: half-baseline gun, +25% fire rate, 3 m/s +15% move speed (`:81-86`, `:182-187`). Yardhawk-slot alternative. |
| `tri-pass` | Target-line, 12 s, high, cost 7. Three aircraft passes along a line: 15 m radius, 450 max (`src/field-support.ts:47-48`). |
| `carpet-bomber` | Target-point (two-click corridor: drop point + direction, `src/carpet-corridor-targeting.ts:24-40`, run clamped `MIN..MAX`, `:83-86`), 12 s, high, cost 7. Bomber pass with N impacts (`CARPET_BOMBER_IMPACT_COUNT`), 240 max damage, residual ground fire (`src/flame-damage-authority…test: CARPET_BOMBER_MAX_DAMAGE 240`; `CARPET_BOMBER_RESIDUAL_FIRE_DURATION_MS`). |
| `hunter-swarm` | Instant, 20 s, high, cost 8. Five hunters assigned round-robin to hostiles (`HUNTER_SWARM_COUNT = 5`, `src/field-support.ts:49, :223-231`); 200 direct / 100 splash, 4 m radius, prone ×0.09 (`:50-54`, `:233-234`). |
| `chopper` (Chopper Gunner) | Instant, 30 s, high, cost 8. Attack helicopter: heavy autocannon (~3 shells to kill, `CHOPPER_GUN_PROFILE`, `src/killstreak-support-catalog.ts:113-116`), missiles (12 total on autopilot cadence), player-possession ray from the cockpit camera (`CHOPPER_GUNNER_RAY_POLICY`, `:140-143`), thermal reveal while possessing. |
| `drone-swarm` | Instant, 30 s, top, cost 15. 24-drone formation firing one barrel at a time down a shared lane (460 ms → +25% rate, `:102-111`); 2× baseline per-shot damage (`:87-90`). Nuke-slot alternative. |
| `crimson-flamethrower` | Care-only, instant, 45 s. Weapon grant (not a streak): separate instance from the map flamethrower, 70% direct damage (56.7 vs 81, `src/combat/weapon-catalog.ts:329-331`), one tank, no resupply. |
| `nuke` | Instant, top, cost 15. 5 s warning, 1000 damage to living hostiles only (`NUKE_WARNING_MS`, `NUKE_DAMAGE`, `src/field-support.ts:55-56`, `:104-108` test). |

Perks/attachments: the old tree has **no player perk system** (searched `perk|PERK` across `src/`: only incidental matches — ghost panes, MRT attachments). "Attachments" there are (a) sticky-ordnance authority (semtex / explosive-crossbow receiver-authored stick, `src/remote-sticky-attachment-authority.ts`), and (b) viewmodel sockets/optics (`optic.magnification` in the weapon catalog). Nothing to parry as a perk row.

### 1b. Gun roster — 21 ids (`src/combat/weapon-catalog.ts:9-33`, defs `:35-343`)

carbine (HK416 650 rpm), smg (FN P90 860), lmg (M249 SAW 720, 62-mag belt),
scattergun (Rem 870 pump, 9 pellets), sniper (M40A5 4×), railgun (map pickup,
full-map penetration), pistol (Glock 17), magnum (Desert Eagle .50, 90 rpm),
machine-pistol (Glock 18 auto 900), mini-uzi (1050 rpm), mp5 (800),
m4a1 (700), ak-47 (600, hard-hitting), minigun (1200 rpm spin-up, 240 belt),
m14-ebr (semi marksman, 46 rpm, thermal-through-smoke optic), slug-shotgun
(Benelli M4 single-slug), flashlight-pistol (always-on light), explosive-crossbow
(projectile, 72 rpm), flamethrower (map pickup, 18 m stream), flare-gun
(projectile), crimson-flamethrower (care reward variant).

### 1c. Grenades — 4 (`src/combat/grenade-catalog.ts:24-29`)

frag (timed-explosive), smoke (smoke-volume), flash (impact-flash), semtex
(sticky-explosive). Nuketown already ships frag/flash/smoke as a real
authored table with host authority (`src/game/ordnance.ts:77-93`,
`src/game/host-ordnance.ts`); semtex-equivalent (sticky) is the one gap.

### 1d. Nuketown baseline before this pass

Streaks: 10 catalog rows (`src/game/killstreaks/catalog.ts:149-160`), only 3
wired (`EFFECT_KIND`: recon-sweep, signal-jam, sentry-post); 7 declared rows
refused `arena-unsupported`. Guns: 5
(longhorn≈carbine/M4A1/AK, rattler≈P90/MP5, coachman≈scattergun,
deadeye≈M40A5, duster≈Glock).

---

## 2. Implemented this pass (2 streaks + 2 guns, Nuketown-style)

### S1 — `blast-mortar` wired (Carpet Bomber / Tri-Pass analogue, substitution recorded)

Why this instead of the aircraft: Nuketown has no aircraft, no altitude
model, no two-click corridor targeting (`StreakIntent` carries one anchor).
A bomber pass would be a model of a plane the engine cannot fly. What
survives honestly is the shape both old strikes share: target-point
area denial, deterministic, host-authoritative, over in seconds.

Behavior (`src/game/killstreaks/effects/mortar.ts`): 6 shells, first impact
600 ms (whistle window), one per 800 ms; seed-hash scatter inside a 4 m disc
(no clock, no `Math.random`); 6 m blast, linear 55→12, floored at 1;
plunging fire — no LOS check, cover hides nothing (unlike the sentry);
hostile-only, never the owner; health chains inside a tick (sentry rule);
max 2 shells per step (stalled-tab rule); out of shells ends the instance
(sentry out-of-ammo precedent). Placement reuses the sentry rule and is
validated BEFORE a charge moves (IMPORT-PLAN §1.1). Catalog row unchanged
(cost 8 / high / target-point / 15 s ceiling).

Tuning is FIRST VALUES reasoned against our shotgun (96 point-blank) and
sentry (14/shot): one centre hit wounds, two kill, the edge punishes
loitering. Old 240-max/450-max aircraft numbers were NOT carried: different
map, different delivery.

Test (`effects/mortar.test.ts`, 34 checks): schedule, seed determinism,
disc bound, whistle silence, exact 55 centre hit, falloff shape, edge
immunity, friendly/owner/corpse/drained skips, per-step cap, volley-expiry,
catalog row, runtime end-to-end (earn→place→damage→retire), blocked-marker
retry with charge intact.

### S2 — `tracker-dart` wired (Scout Sweep / Yardhawk analogue, substitution recorded)

Why this instead of map-wide recon: a global reveal keyed to nothing in the
world is free information. The dart must be THROWN somewhere: 14 m bubble
around the anchor (inside sentry range on purpose — it sees less far than
the gun shoots, so the pair composes).

Behavior (`src/game/killstreaks/effects/dart.ts`): pulses every 2.5 s (the
recon period, not a new number); each pulse recomputes the painted set from
scratch — hostile, alive, in radius, LOS from the dart — no memory, no leak;
owner/friendlies never painted; emits nothing (level-type like recon);
runtime aggregates via new `paintedTargetIds()` for the future minimap blip
reader. Same ship-status recon's `revealedFor` launched with (tested query,
no consumer yet). Catalog row unchanged (cost 4 / low / target-point / 20 s).

Test (`effects/dart.test.ts`, 14 checks): fresh-clean, latch, radius gate,
cover gate, team/life gates, unpaint-on-leave, expiry, seed pulse-offset,
catalog row, runtime end-to-end (throw→paint→unpaint via tick train).

### G1 — `stampede` (M249 SAW analogue)

LMG: auto 720 rpm, 60-round belt + 180 reserve, 27/17 over 25–55 m, slowest
ADS in the roster (0.30 s, 0.60 move scale), 3.4/3.9 s reload tax. Highest
sustain, worst handling — the belt is the tradeoff, same as the old SAW.

### G2 — `varmint` (M14 EBR analogue, minus the thermal optic)

Semi marksman: ~150 rpm, 45/28 over 30–70 m, 10+40. Sits strictly between
longhorn (34) and deadeye (150) per shot, cycles faster than the bolt.
The old EBR's through-smoke thermal is NOT carried (presentation-only
authority Nuketown has no equivalent for — recorded, not silently dropped).

Both guns: catalog entries only. They ride the controller's existing
rifle-viewmodel fallback + generic shot report (verified defaults in
`controller.ts:883-885,194` — read-only). Dedicated builders belong to the
viewmodel lane (`viewmodel.ts`, not owned); recorded below as deferred.
Test (`src/weapons/catalog.test.ts`, 60 checks): roster 7, ids unique,
per-gun bands/mags/cadence, varmint-between-rifle-and-bolt ordering,
finite recoil/interval/reload/ADS for every gun.

---

## 3. Evidence

- Behavior proofs (dependency-free, tsc-clean: no node builtins; bundled
  with the repo's own esbuild to a temp dir, executed with node):
  `mortar proof: 34 checks passed`, `dart proof: 14 checks passed`,
  `gun parity proof: 60 checks passed`.
  Repro: `node node_modules/esbuild/bin/esbuild <file>.test.ts --bundle
  --platform=node --format=esm --outfile=$T/x.mjs && node $T/x.mjs`
  (extensionless relative imports keep `tsc` happy; esbuild resolves them).
- `npm run check` green (`tsc --noEmit` + render-sites allow-list OK).
- `npm run playcap` green: 4/4 positions lit (spawnA 130.1, circle 99.8,
  spawnB 98.9, orangeInside 95.8 luma; 761–1161 draw calls), zero page errors.
- `npm run traverse` green: 5/5 routes, 4/4 house faces enterable.
- Captures: `captures/parity-stampede.png` (switch=true, mag 60/reserve 180),
  `captures/parity-varmint.png` (switch=true, mag 10/reserve 40) — both live
  through the REAL `weaponCmd` path in the built game, no page errors.
  Mortar/dart have no 3D presentation yet (same as recon/sentry today) — no
  screenshot can show them; the logic proofs + runtime end-to-end are the
  evidence. Their day-one visible footprint is the HUD charge bank, which
  already reads `snapshotFor`.
- One incident, repaired: an edit dropped
  `MAX_LADDER_KILLS = 100_000` from `runtime.ts:69`; restored verbatim
  (caught by the mortar proof bundling the runtime, confirmed by re-read).
  No other file outside ownership was written.

## 4. Deferred (with reasons — cap was 2+2, honesty did the rest)

- Piloted-drone / Chopper Gunner analogues: `possession` has a gate
  vocabulary but no platform, no cockpit, no thermal presentation in this
  engine. A possession streak with nothing to possess would be a label that
  lies. Deferred until a possessable platform exists.
- Drone-swarm / hunter-swarm analogues: 24-unit / 5-unit formation AI + shared
  fire lane; bot lane has no formation vocabulary. Deferred.
- Nuke / last-resort behavior: map-wide instant damage has no honest delivery
  here and `last-resort` is reward-only with duration 0. Deferred.
- `supply-crate` wiring: the pool + fixed percents exist, but rolling it
  forces inventing `field-repair` and `last-resort` behaviors (both
  Nuketown-original, zero-duration, undefined). Inventing two behaviors to
  ship one streak was refused. Deferred as a triple.
- `strike-relay` (target-line): `StreakIntent` carries one anchor; faking a
  line from a point would be dishonest. Deferred until two-point targeting.
- `fallout-screen`: a second information-denial row over the same stepper as
  signal-jam. Wirable in one line, but a duplicate effect is not a top-two
  missing streak. Deferred.
- Guns: magnum/heavy pistol, machine-pistol, slug-shotgun, launchers
  (crossbow/flare/flamethrower/railgun specials): each needs its viewmodel
  class (`viewmodel.ts`, not owned) — the controller fallback would show a
  rifle for a pistol, which reads as a bug, not parity. Deferred to the
  viewmodel lane; catalog slots reserved by the header note.
- Semtex-equivalent (sticky grenade): ordnance lane owns the throw/claim
  path; a sticky needs receiver-authored attachment authority the host does
  not have. Deferred to the ordnance lane.
- Perks: no old-system to parry (see §1). Nothing deferred — nothing missing.

## 5. Re-implementation boundary (repo contract)

Old tree was read for measurements, envelopes and feature names only:
roster ids, costs, durations, damage/radius numbers quoted in §1. No asset,
texture, mesh, module or build script was copied — no old file was even
opened for copy (all reads were grep/read through the harness). Tuning
above is re-reasoned against Nuketown's own guns/sentry/map (§5.9 style),
and every constant names the Nuketown number it was reasoned against.
`git status` will show only the 8 paths listed at the top (plus gitignored
`dist/` + `captures/` output).

## 6. Open pixel questions for the owner (do not guess — playtest answers)

1. Mortar feel: 6×55-max over ~4.6 s — does the whistle window (600 ms) read
   as fair on the street, or does the first shell need longer?
2. Dart bubble: 14 m — thrown from the circle, does it paint both houses'
   doors, or should it be smaller (10 m) so placement is a real decision?
3. Stampede: 60-belt at 720 rpm with 0.30 s ADS — oppressive or just right
   as the lane-holder? (Varmint: does 45/shot at 150 rpm obsolete the
   duster at mid range?)
4. Vision-quota note: `parity-stampede/varmint.png` are unreviewed pixels —
   worth 2 minutes in the next window to confirm the rifle-fallback
   viewmodels don't read as broken on the new guns.
