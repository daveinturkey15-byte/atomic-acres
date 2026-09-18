/**
 * Nuketown 2025 — every shape that crosses the host boundary.
 *
 * Split out of `host.ts` at authoring time, not later: with these shapes in it
 * that file was 562 lines and AGENTS.md caps a file at 400. It is the same
 * split `events.ts`/`vocab.ts` made, and `host.ts` re-exports all of it, so
 * `import { ... } from './host'` sees the whole surface and no lane needs to
 * know it is three files.
 *
 * TYPES ONLY — no logic, no constants, no runtime value at all.
 *
 * There is NO `DamageQuery` and NO `SpawnChoice` here. Those were written as
 * lane-A stubs while lanes B and C were being written in parallel, and they
 * were deleted the moment `game/damage.ts` and `game/spawns.ts` landed:
 * `HostDeps` now names lane B's own `DamageInput`/`SpawnContext` types. A
 * host-side copy of a signature another lane owns is a mirror (§5.5), and the
 * first divergence would have been silent.
 *
 * Nothing here is a callback bag (§5.3). The two overridable functions are
 * pure — data in, data out — and `StreakRuntimePort` is a state machine that
 * answers in events. None of them calls back into the host, which is the
 * difference between a module and "`legacy-main` with the body moved".
 */

import type { ActorId, GameBus, ShotRejectReason, TeamId, WorldQuery } from './events';
import type { MatchStateMsg, StreakSlotState } from '../net/protocol';
import type { MatchRules } from './rules';
import type { DamageInput, DamageResult } from './damage';
import type { SpawnContext, SpawnSelection } from './spawns';
import type { StreakRuntimePort } from './host-streaks';

/**
 * `StreakRuntimePort` MOVED to `./host-streaks` by the integration lane, and
 * widened there against lane C's real `StreakRuntime`. Two of the eight
 * methods did not fit the shape declared here while lane C was being written
 * in parallel — `activate` had no room for the exactly-once material and
 * `advance` had no room for the host's actor table, so the sentry could never
 * fire. That file carries the argument; this one keeps `HostDeps` unchanged
 * in shape, and `host.ts` re-exports both.
 */

/**
 * Overrides. Every one defaults to the real module, so `new GameHost({ world })`
 * is a working host and a test supplies only what it wants to control.
 */
export interface HostDeps {
  /** Defaults to `game/damage.ts:resolveDamage`. */
  resolveDamage?: (input: DamageInput) => DamageResult;
  /** Defaults to `game/spawns.ts:selectSpawn`. */
  selectSpawn?: (ctx: SpawnContext) => SpawnSelection;
  streaks?: StreakRuntimePort;
}

export interface HostOptions {
  readonly world: WorldQuery;
  readonly rules?: MatchRules;
  readonly now?: number;
  readonly bus?: GameBus;
  readonly deps?: HostDeps;
  /** Host RNG seed. Every deterministic choice downstream derives from it. */
  readonly seed?: number;
}

export interface ShotAdmission {
  readonly accepted: boolean;
  readonly reason: ShotRejectReason | null;
  /** `SHOT_REJECT_LABELS[reason]`, resolved here so no caller has to (§5.4). */
  readonly label: string | null;
}

/** One actor as the host knows it. No coordinates: `net/room.ts` owns position. */
export interface ActorSnapshot {
  readonly id: ActorId;
  readonly team: TeamId;
  readonly bot: boolean;
  readonly hp: number;
  readonly alive: boolean;
  readonly life: number;
  readonly spawnIndex: number;
  readonly protectedUntil: number;
  /** Host time this actor redeploys; null when nothing is queued. */
  readonly respawnAt: number | null;
  readonly kills: number;
  readonly deaths: number;
  readonly score: number;
  readonly streak: number;
  readonly slots: readonly StreakSlotState[];
}

/** Counters, for a harness that needs a number rather than an adjective. */
export interface HostStats {
  readonly shotsAdmitted: number;
  readonly shotsRejected: number;
  readonly hitsLanded: number;
  readonly hitsBlocked: number;
}

export interface HostSnapshot {
  readonly at: number;
  readonly match: MatchStateMsg;
  readonly actors: readonly ActorSnapshot[];
  readonly stats: HostStats;
}
