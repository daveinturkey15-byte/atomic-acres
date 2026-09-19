# `src/game/` — the frozen vocabulary

Wave 0 of IMPORT-PLAN §3, written 2026-09-18 by the vocabulary lane.

## What is frozen

| file | contents |
|---|---|
| `src/game/events.ts` | the `GameEvent` union, `GameBus`, and a re-export of everything in `vocab.ts` |
| `src/game/vocab.ts` | frozen enumerations, enumerated refusals + labels, the `WorldQuery` port |
| `src/game/rules.ts` | `MatchMode`, `MatchRules`, `DEFAULT_RULES`, limit tables, timings, teams, lobby capacity |
| `src/net/protocol.ts` | lobby/transport wire — unchanged except the additive gameplay union members and `PlayerSample`'s three optional fields |
| `src/net/protocol-game.ts` | the gameplay wire: `ShotMsg`, `ShotRejectMsg`, `DamageMsg`, `KillMsg`, `SpawnMsg`, `StreakIntentMsg`, `StreakStateMsg`, `MatchStateMsg` and their validators |

**Import from `game/events.ts` and `net/protocol.ts`.** `vocab.ts` and
`protocol-game.ts` exist only because the combined files passed the 400-line
cap in `AGENTS.md`; each is fully re-exported by its partner, so no lane needs
to know they are two files.

Frozen means: **read-only to Wave 1.** Waves A, B, C and D may import anything
here and may not edit any of it. Three lanes each widening `KillEvent` in
parallel is the merge conflict this freeze exists to prevent, and a fourth lane
quietly inventing a second `DenialReason` is the stale mirror
(IMPORT-PLAN §5.5) it exists to prevent.

## If you need a shape that is not here

**Stop and report it. Do not add one.**

State in your report: the event or field you need, which module needs it, and
what you did instead (a stub, a local type, or nothing). The integrator makes
the change once, in this file, and tells every lane. A lane that adds an event
type of its own has forked the vocabulary, and the fork will not be noticed
until two lanes' events reach the same bus.

The same applies to `rules.ts` constants and to `protocol-game.ts` messages.

## The two hard boundaries these files serve

1. **`src/game/` is DOM-free and scene-free.** No `document`, no
   `THREE.Scene`, no renderer, no material. `THREE` is permitted for
   `Vector3`/math types only — and note that nothing here imports it at all:
   `Vec3` is structural, so `THREE.Vector3` passes straight in. The world
   arrives only through the injected `WorldQuery` port.
2. **Only `game/host.ts` writes authoritative state** — health, score, kills,
   deaths, streak charges, spawn choice, match phase, RNG seed. Everything else
   is a pure function the host calls, or a consumer of the events it emits.
   A guest that writes a score is a bug.

## Conventions a lane will trip over if it does not read them

- **Kill and Death are separate events, and both fire.** Every death emits
  `DeathEvent`. A death *credited to a killer* — including a team kill — also
  emits `KillEvent`. Suicides and world deaths emit only `DeathEvent`.
  Count kills from `KillEvent` and deaths from `DeathEvent`, never both from
  one, or `game/scoring.ts` doubles.
- **Nothing derivable is a field.** No `headshot` (`zone === 'head'`), no
  `fatal` (`healthAfter <= 0`), no `friendlyFire`
  (`killerTeam === victimTeam`), no `label` on a refusal
  (`STREAK_DENIAL_LABELS[reason]`, `SHOT_REJECT_LABELS[reason]`).
- **`null` means unlimited**, in `MatchRules.durationMs`, `MatchRules.scoreLimit`,
  `KILL_LIMITS[0]` and `MatchStateMsg.endsAt`. It is why an explore mode with no
  clock and no cap needs no branch anywhere in the match machine.
- **`MatchPhaseEvent.endsAt` may be `Number.POSITIVE_INFINITY`; the wire's
  `MatchStateMsg.endsAt` may not.** Infinity is not JSON-able — it serialises to
  `null`. On the wire, `null` is the unlimited value.
- **`PlayerSample.hp`/`team`/`alive` are optional.** `net/room.ts` broadcasts
  state before a `GameHost` exists, and that file belongs to no Wave-0 lane.
  Absent means *no game authority yet*; branch on `undefined`, never substitute
  `100` / `0` / `true`.
- **A shot claim names no shooter and no victim.** `ShotMsg` carries origin,
  direction, seq, life epoch, weapon and fire time. The host knows the sender
  and resolves the hit — the same reason `InputMsg` carries no position.
- **`StreakStateMsg` carries level *and* edge**: the whole ledger plus the one
  transition that caused the update. An edge-only feed loses a refusal that
  arrives during a stall; a level-only feed can never show one at all.
- **`TeamId` lives in `vocab.ts`; `TEAM_A`/`TEAM_B` live in `rules.ts`.**
  `rules.ts` imports nothing by design, so it names the teams without owning
  their type. `TEAM_A` infers the literal `0`, which is exactly `TeamId`.
- **`LOBBY_MAX_PLAYERS` (6) is not `MAX_PLAYERS` (8).** The first is what a
  lobby offers, the second is what the transport carries. The invariant
  `LOBBY_MAX_PLAYERS <= MAX_PLAYERS` is asserted in the Wave-0 proof rather
  than imported, because `rules.ts` stays a leaf.

## Beyond the brief, flagged

`ShotRejectMsg` was not in the Wave-0 brief's list of seven messages. It is
here because `ShotRejectedEvent` otherwise has no wire: a guest's refused shot
would reach the host bus and stop, which is exactly the dead-key failure
IMPORT-PLAN §5.4 is written about. If the integrator disagrees, it is one
interface and one `case` to remove.

## The smoke contract (ordnance lane, 2026-09-19)

Gameplay never draws smoke. It ANNOUNCES it, and whatever renders smoke — the
placeholder puffs in `src/weapons/grenades.ts` today, the atmosphere lane's
volumetric fog tomorrow — reads exactly these two events and nothing else, so
the renderer can be swapped without touching a gameplay file.

| event | shape |
|---|---|
| `smoke-volume` | `{ type: 'smoke-volume', at, id, x, y, z, radius, bornAt, diesAt, kind: 'grenade' \| 'blast' }` |
| `smoke-volume-end` | `{ type: 'smoke-volume-end', at, id }` |

- The volume is a SPHERE of `radius` metres centred at `(x, y, z)`. It fills
  from nothing to `radius` over the first 1.5 s after `bornAt`
  (`world-query.ts:SMOKE_FILL_MS`) and dissolves over the last 5 s before
  `diesAt` (`SMOKE_DISSOLVE_MS`). A renderer that honours those two ramps
  agrees with what the bots can see.
- `kind: 'grenade'` is a smoke grenade (`ordnance.ts:SMOKE_RADIUS_M` = 5 m,
  `SMOKE_LIFETIME_MS` = 25 s). `kind: 'blast'` is the puff every detonation
  leaves — one tenth of a grenade's volume, a fifth of its life — and is
  drawn thinner (`SMOKE_DENSITY.blast` = 0.6).
- `id` is host-assigned and unique for the match; `smoke-volume-end` always
  follows for the same id, at expiry or match end. A renderer may also
  retire a volume itself at `diesAt`.
- Gameplay reads the same spheres through `src/game/world-query.ts`:
  `activeSmokeVolumes(world)` lists them and `losBlockedBySmoke(world, a, b)`
  answers a ray against the sphere list — the density-weighted chord length
  above `SMOKE_LOS_THRESHOLD_M` (1.5 m) blocks. A tangent is not blocked;
  through the centre is. `bot-sense.ts` uses it, so a bot does not see
  through the same smoke the renderer draws.

## Ordnance claims (ordnance lane)

A grenade throw, a knife swing and a pickup reach travel as `ShotMsg` claims
whose `weaponId` is one of `game/ordnance.ts:ORDNANCE_IDS` (`frag`, `flash`,
`smoke`, `knife`, `pickup`). `GameHost.submitShot` runs the same eight
admission rules and the same exactly-once window on them as on a bullet, then
routes them to `host-ordnance.ts`. A grenade is two claims: the first arms it
(a frag's fuse starts here — the cook), the second, with the same id, releases
it along the claim's direction. Refusals a bullet cannot have are
`ORDNANCE_REJECT_REASONS` on an `ordnance-rejected` event, each with a label.

The human's keys (`main.ts` → `weapons/controller.ts` → `weapons/ordnance-input.ts`):
**G** arms the frag and throws on release (hold to cook — the fuse runs on the
host from the arm claim), **Q** the same for the tactical, **V** the knife,
**E held 0.3 s** the pickup reach. F is `core/player.ts`'s fly toggle and Q/E
are its fly-mode vertical keys, so `main.ts` forwards these four on foot only.
`ui/bindings.ts` (lobby lane) lists `knife` as `KeyF`; the consumer reads
`KeyV`, and the table should say so.

## What a bot needs from `bots.ts` (ordnance lane → lobby lane handover)

Everything a bot decides is already in `bot-sense.ts` / `bot-ordnance.ts`
(this lane's files): `botIntent` answers `grenade` / `knife` / `scavengeX,Z`
when it is given the host's `BotSupply` (the four `ActorSnapshot` fields
`lethal`, `tactical`, `rounds`, `armed`) and the `HostSnapshot.ordnance.drops`
list, and `bot-ordnance.ts` builds the claims (`throwDirection`,
`knifeDirection`, `botOrdnanceClaim`). Scavenging needs no claim at all — the
host's walk-over takes ammo from any live actor inside 1.05 m, so steering the
bot onto the drop is the whole action. `bots.ts` (lobby lane) has to add:

1. `addActor(id, team, { bot: true, primaryId: weapon.id })` in `add()`, so a
   bot's corpse drops the gun the director gave it.
2. Pass `supply` and `drops` into `botIntent`, and take `intent.fire` into the
   preset trigger (`fire = intent.fire && ...`), so a tick that throws or
   stabs does not also shoot.
3. On `intent.grenade !== null`: two `submitShot` calls with
   `botOrdnanceClaim(b.life, intent.grenade, b.x, b.y + BOT_AIM_ORIGIN_Y, b.z,
   dir, ++b.shotSeq, now)` where `throwDirection(origin, sense.target, dir)`
   filled `dir`; then `b.grenadeAt = now`.
4. On `intent.knife`: one `submitShot` with `'knife'` along
   `knifeDirection(origin, sense.target, dir)`; set `b.cooldown` to at least
   `KNIFE_RECOVERY_MS / 1000`.
5. `tick(...)` takes `snap.ordnance.drops` (from `session-solo.ts`'s
   `h.snapshot()`) as its `drops` argument.

The exact lines are in the ordnance lane's report; `scripts/_verify-ordnance.mjs`
(`bots` scenario) proves both halves against the real host.
