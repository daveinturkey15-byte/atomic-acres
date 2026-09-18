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
